import { Firestore, Filter } from '@google-cloud/firestore'
import { decode } from '@msgpack/msgpack'
import { config } from './config.mjs'
// import { app_keys, service_account } from './keys.mjs'
import { GenDoc, compile, prepRow, decryptRow } from './gendoc.mjs'

export class FirestoreProvider {
  constructor (site, codeProvider) {
    const cfg = config[codeProvider]
    const kn = cfg.key
    this.service_account = config[kn]
    const app_keys = config.app_keys
    this.type = 'firestore'
    this.appKey = Buffer.from(app_keys.sites[site], 'base64')
    this.emulator = config.env.FIRESTORE_EMULATOR_HOST
  }

  async connect(op) {
    return await new Connx().connect(op, this)
  }

  // PRIVATE
  /* path pour tous les documents (sauf singletons)*/
  static _path (nom, id, ids) {
    if (!ids) return nom + '/' + id
    return 'versions/' + id + '/' + nom + '/' + ids
  }

  /* path des collections et sous collections */
  static _collPath (nom, id) {
    if (!id) return nom + '/'
    return 'versions/' + id + '/' + nom + '/'
  }

}

class Connx {

  // Méthode PUBLIQUE de coonexion: retourne l'objet de connexion à la base
  async connect (op, provider) {
    this.op = op
    this.provider = provider
    const sa = this.provider.service_account
    this.appKey = provider.appKey
    this.fs = new Firestore({ 
      projectId : sa.project_id,
      credentials: sa
    })
    this.op.db = this
    return this
  }

  // Méthode PUBLIQUE de déconnexion, impérative et sans exception
  async disconnect () {
    try { await this.fs.terminate() } catch (e2) { /* */ }
  }
  
  async doTransaction () {
    try {
      await this.fs.runTransaction(async (transaction) => {
        this.transaction = transaction
        await this.op.transac()
        if (this.op.toInsert.length) await this.insertRows(this.op.toInsert)
        if (this.op.toUpdate.length) await this.updateRows(this.op.toUpdate)
        if (this.op.toDelete.length) await this.deleteRows(this.op.toDelete)
      })
      await this.disconnect()
      return [0, '']
    } catch (e) {
      await this.disconnect()
      return this.trap(e)
    }
  }

  // PRIVATE
  trap (e) {
    if (e.constructor.name !== 'FirestoreError') throw e
    const s = (e.code || '???') + ' - ' + (e.message || '?')
    if (e.code && e.code === 'ABORTED') return [1, s]
    return [2, s]
  }

  async ping () {
    try {
      let t = '?'
      const dr = this.fs.doc('singletons/1')
      const ds = await dr.get()
      if (ds.exists) t = ds.get('_data_')
      const d = new Date()
      const v = d.getTime()
      const _data_ = d.toISOString()
      await dr.set({ id: 1, v, _data_ })
      return [0, 'Firestore ping OK: ' + (t || '?') + ' <=> ' + _data_]
    } catch (e) {
      return this.trap(e)
    }
  }

  /** PUBLIQUES POUR EXPORT / PURGE ******************************************/
  /* Purge d'un ns
  Sur collsExp2 ['partitions', 'comptes', 'comptas', 'comptis', 'invits', 'avatars', 'groupes', 'versions']: index sur id
  */
  async deleteNS(log, ns) {
    const min = ns
    const max = ns + '{'

    for (const nom of GenDoc.collsExp1) {
      const p = nom + '/' + ns
      await this.fs.doc(p).delete()
      log(`delete ${nom} - 1 row`)
    }
    for (const nom of GenDoc.collsExp2) {
      const q = this.fs.collection(nom).where('id', '>=', min).where('id', '<', max)
      const qs = await q.get()
      let n = 0
      for (const qds of qs) {
        n++
        if (nom === 'versions') {
          const id = qds.get('id')
          const cref = this.fs.collection('versions/' + id)
          const bw = this.fs.bulkWriter()
          await this.fs.recursiveDelete(cref, bw)
        } else
          qds.delete()
      }
      log(`delete ${nom} - ${n} rows`)
    }
  }
  
  async batchInsertRows (rows) {
    const wb = this.fs.batch()
    for (const row of rows) {
      const r = await prepRow(this.appKey, row)
      if (GenDoc.majeurs.has(row._nom)) {
        r.id = row.id
        r.v = row.v
        if (row.vcv !== undefined) r.vcv = row.vcv
      }
      const p = FirestoreProvider._path(row._nom, r.id, r.ids)
      wb.set(this.fs.doc(p), r)
    }
    await wb.commit()
  }

  /*********************************************************************/
  tacheP (top, ns, id, ids) {
    return 'taches/' + top + ';' + ns + ';' + id + (ids ? ';' + ids : '')
  }

  async setTache (t) {
    const r = { 
      op: t.op,
      ns: t.ns, 
      id: t.id || '', 
      ids: t.ids || '',
      dh: t.dh, 
      exc: t.exc
    }
    const p = this.tacheP(r.op, r.ns, r.id, r.ids)
    if (this.transaction)
      await this.transaction.set(this.fs.doc(p), r)
    else
      await this.fs.doc(p).set(r)
  }

  async delTache (top, ns, id, ids) { // t: {op, id, ids}
    const p = this.tacheP(top, ns, id, ids)
    if (this.transaction)
      await this.transaction.delete(this.fs.doc(p))
    else
      await this.fs.doc(p).delete()
  }

  /* Obtention de la prochaine tâche
  Sur taches: index composite sur dh / ns
  */
  async prochTache (dh, x, lns) { // ns inactifs
    const q = this.fs.collection('taches')
      .where('dh', '<', dh)
      .where('ns', 'not-in', lns)
      .orderBy('dh')
      .limit(1)
    const qs = await q.get()
    return !qs.empty ? qs.docs[0].data() : null
  }

  /* Obtention des taches d'un ns
  Sur taches: index sur ns
  */
  async nsTaches (ns) {
    const q = this.fs.collection('taches').where('ns', '==', ns)
    const qs = await q.get()
    const rows = []
    if (!qs.empty) for (const qds of qs.docs) { rows.push(qds.data()) }
    return rows
  }

  async toutesTaches (ns) {
    const q = this.fs.collection('taches')
    const qs = await q.get()
    const rows = []
    if (!qs.empty) for (const qds of qs.docs) { rows.push(qds.data()) }
    return rows
  }

  /* Obtention des espaces modifiés après v
  Sur espaces: index sur v
  */
  async getRowEspaces(v) {
    const q = this.fs.collection('espaces').where('v', '>', v)
    const qs = await q.get()
    const r = []
    if (!qs.empty) for (const qds of qs.docs) {
      const row = qds.data()
      const x = await decryptRow(this.appKey, row)
      x._nom = 'espaces'
      r.push(row)
    }
    return r
  }
  
  /* Retourne le row d'une collection de nom / id si sa version est postérieure à v
  Sur majeurs ['partitions', 'comptes', 'comptas', 'comptis', 'invits', 'versions', 'avatars', 'groupes']
  index composite id / v
  */
  async getV (nom, id, v) {
    let row = null
    if (v && GenDoc.majeurs.has(nom)) {
      const q = this.fs.collection(nom).where('id', '==', id).where('v', '<', v)
      let qs; if (this.transaction) qs = await this.transaction.get(q); else qs = await q.get()
      if (!qs.empty) row = qs.docs[0].data()
      if (row) {
        row._nom = nom
        this.op.nl++
        return await decryptRow(this.appKey, row)
      }
      return null
    }

    const dr = this.fs.doc(nom + '/' + id)
    let ds
    if (this.transaction) {
      ds = await this.transaction.get(dr) // qs: QuerySnapshot
    } else {
      ds = await dr.get()
    }
    if (ds.exists) {
      row = ds.data()
      row._nom = nom
      this.op.nl++
      return await decryptRow(this.appKey, row)
    }
    return null
  }

  /* Retourne LE row de la collection nom / id (sans version)
  */
  async getNV (nom, id) {
    let row = null
    const p = FirestoreProvider._path(nom, id)
    const dr = this.fs.doc(p) // dr: DocumentReference
    // ds: DocumentSnapshot N'EXISTE PAS TOUJOURS
    let ds
    if (this.transaction) {
      ds = await this.transaction.get(dr)
    } else {
      ds = await dr.get()
    }
    if (ds.exists) {
      row = ds.data()
      row._nom = nom
      this.op.nl++
      return await decryptRow(this.appKey, row)
    }
    return null
  }

  /* Retourne le row d'un objet d'une sous-collection nom / id / ids */
  async get (nom, id, ids) {
    let row = null
    const p = FirestoreProvider._path(nom, id, ids)
    const dr = this.fs.doc(p) // dr: DocumentReference
    // ds: DocumentSnapshot N'EXISTE PAS TOUJOURS
    let ds
    if (this.transaction) {
      ds = await this.transaction.get(dr)
    } else {
      ds = await dr.get()
    }
    if (ds.exists) {
      row = ds.data()
      row._nom = nom
      this.op.nl++
      return await decryptRow(this.appKey, row)
    }
    return null
  }

  /* Retourne l'avatar si sa CV est PLUS récente que celle détenue en session (de version vcv)
  Sur avatars: index sur vcv
  */
  async getAvatarVCV (id, vcv) {
    const p = FirestoreProvider._path('avatars', id)
    const q = this.fs.collection(p).where('vcv', '<', vcv)
    let qs; if (this.transaction) qs = await this.transaction.get(q); else qs = await q.get()
    if (qs.empty) return null
    const row = qs.docs[0].data()
    this.op.nl++
    return compile(await decryptRow(this.appKey, row))
  }

  /* Obtention d'un compte par sa hk
  Sur comptes: index sur hk
  */
  async getCompteHk (hk) {
    const p = FirestoreProvider._collPath('comptes')
    // INDEX simple sur comptas hps1
    const q = this.fs.collection(p).where('hk', '==', hk)
    let qs; if (this.transaction) qs = await this.transaction.get(q); else qs = await q.get()
    let row = null
    if (!qs.empty) {
      for (const qds of qs.docs) { row = qds.data(); break }
    }
    if (!row) return null
    row._nom = 'comptes'
    this.op.nl++
    return await decryptRow(this.appKey, row)
  }

  /* Obtention d'un avatar par sa hk
  Sur avatars: index sur hk
  */
  async getAvatarHk (hk) {
    const p = FirestoreProvider._collPath('avatars')
    // INDEX simple sur avatars hpc
    const q = this.fs.collection(p).where('hk', '==', hk)
    let qs; if (this.transaction) qs = await this.transaction.get(q); else qs = await q.get()
    let row = null
    if (!qs.empty) for (const qds of qs.docs) { row = qds.data(); break }
    if (!row) return null
    row._nom = 'avatars'
    this.op.nl++
    return await decryptRow(this.appKey, row)
  }

  /* Obtention d'un sponsorings par son ids
  Sur sponsorings: index COLLECTION_GROUP sur ids
  */
  async getSponsoringIds (ids) {
    const q = this.fs.collectionGroup('sponsorings').where('ids', '==', ids)
    let qs; if (this.transaction) qs = await this.transaction.get(q); else qs = await q.get()
    let row = null
    if (!qs.empty) for (const qds of qs.docs) { row = qds.data(); break }
    if (!row) return null
    row._nom = 'sponsorings'
    this.op.nl++
    return await decryptRow(this.appKey, row)
  }

  /* Retourne l'array des ids des "groupes" dont la fin d'hébergement 
  est inférieure à dfh 
  Sur groupes: index sur dfh
  */
  async getGroupesDfh (dfh) {
    const p = FirestoreProvider._collPath('groupes')
    // INDEX simple sur groupes dfh
    const q = this.fs.collection(p).where('dfh', '>', 0).where('dfh', '<', dfh) 
    let qs; if (this.transaction) qs = await this.transaction.get(q); else qs = await q.get()
    const r = []
    if (!qs.empty) qs.forEach(qds => { r.push(qds.get('id')) })
    this.op.nl += r.length
    return r
  }

  /* Retourne l'array des id des comptes ayant passé leur dlv 
  Sur comptes: index sur dlv
  */
  async getComptesDlv (dlvmax) {
    const p = FirestoreProvider._collPath('comptes')
    // INDEX simple sur comptes dlv
    const q = this.fs.collection(p).where('dlv', '>', dlvmax) 
    let qs; if (this.transaction) qs = await this.transaction.get(q); else qs = await q.get()
    const r = []
    if (!qs.empty) qs.forEach(qds => { r.push(qds.get('id')) })
    this.op.nl += r.length
    return r
  }

  /* Retourne l'array des id des comptes du ns donné dont la dlv est:
  - dla: bridée par la dlvat actuelle
  - dlf: ou supérieure à la dlvat future
  Sur comptes : index composite ns / dlv
  async getComptesDlvat (ns, dla, dlf) {
    const ns1 = ns
    const ns2 = ns + '{'
    const r = []
    const p = FirestoreProvider._collPath('comptes')
    {
      const q = this.fs.collection(p)
        .where('id', '>=', ns1)
        .where('id', '<', ns2)
        .where(
          Filter.or(
            Filter.where('dlv', '==', dla),
            Filter.where('dlv', '>', dlf)
          )
        )
      let qs; if (this.transaction) qs = await this.transaction.get(q); else qs = await q.get()
      if (!qs.empty) qs.forEach(qds => { r.push(qds.get('id')) })
      this.op.nl += r.length
    }
    return r
  }
  */

  // Versions si restriction de query sur inégalité sur un seul champ
  async getComptesDlvat2 (ns, dla, dlf) {
    const ns1 = ns
    const ns2 = ns + '{'
    const r = []
    const p = FirestoreProvider._collPath('comptes')
    {
      const q = this.fs.collection(p)
        .where('id', '>=', ns1)
        .where('id', '<', ns2)
        .where('dlv', '==', dla)
      let qs; if (this.transaction) qs = await this.transaction.get(q); else qs = await q.get()
      if (!qs.empty) qs.forEach(qds => { r.push(qds.get('id')) })
      this.op.nl += r.length
    }
    {
      const q = this.fs.collection(p).where('dlv', '>', dlf)
      let qs; if (this.transaction) qs = await this.transaction.get(q); else qs = await q.get()
      if (!qs.empty) qs.forEach(qds => { 
        const id = qds.get('id')
        if (id >= ns1 && id < ns2) r.push(id) 
      })
      this.op.nl += r.length
    }
    return r
  }

  /* Retourne la collection de nom 'nom' : pour avoir tous les espaces */
  async coll (nom) {
    const p = FirestoreProvider._collPath(nom)
    const q = this.fs.collection(p)
    let qs; if (this.transaction) qs = await this.transaction.get(q); else qs = await q.get()
    if (qs.empty) return []
    const r = []
    for (const qds of qs.docs) { 
      const x = qds.data()
      x._nom = nom
      r.push(x)
    }
    this.op.nl += r.length
    return r
  }

  /* Retourne la collection de nom 'nom' 
  SI la fonction "fnprocess" est présente 
  elle est invoquée à chaque row pour traiter son _data_
  plutôt que d'accumuler les rows.
  Sur collsExp2 ['partitions', 'comptes', 'comptas', 'comptis', 'invits', 'avatars', 'groupes', 'versions']: index sur id
  */
  async collNs (nom, ns, fnprocess) {
    const ns1 = ns
    const ns2 = ns + '{'
    const p = FirestoreProvider._collPath(nom)
    // INDEX simple sur les collections id (avatars, groupes, versions ...) ! PAS les sous-collections
    const q = this.fs.collection(p).where('id', '>=', ns1).where('id', '<', ns2) 
    let qs; if (this.transaction) qs = await this.transaction.get(q); else qs = await q.get()
    if (qs.empty) return []
    const r = []
    for (const qds of qs.docs) { 
      const x = qds.data()
      x._nom = nom
      const rx = await decryptRow(this.appKey, x)
      this.op.nl++
      if (!fnprocess) r.push(rx); else fnprocess(rx._data_)
    }
    return !fnprocess ? r : null
  }

  /* Retourne la sous-collection de 'nom' du document majeur id
  Si v est donnée, uniquement les documents de version supérieurs à v.
  Sur sousColls ['notes', 'sponsorings', 'chats', 'membres', 'chatgrs', 'tickets']: index sur v
  */
  async scoll (nom, id, v) {
    const p = FirestoreProvider._collPath(nom, id)
    // INDEX simple sur (chats sponsorings notes membres chatgrs) v
    const q = this.fs.collection(p).where('v', '>', v)
    let qs; if (this.transaction) qs = await this.transaction.get(q); else qs = await q.get()
    if (qs.empty) return []
    const r = []
    for (const qds of qs.docs) { 
      const x = qds.data()
      x._nom = nom
      r.push(await decryptRow(this.appKey, x))
    }
    this.op.nl += r.length
    return r
  }

  /* Retourne les tickets du comptable id et du mois aamm ou antérieurs
  Sur tickets: index sur ids
  */
  async selTickets (id, ns, aamm, fnprocess) {
    const mx = ns + (aamm % 10000) + '9999999999'
    const p = FirestoreProvider._collPath('tickets', id)
    // INDEX simple sur (chats sponsorings notes membres chatgrs) v
    const q = this.fs.collection(p).where('ids', '<=', mx)
    let qs; if (this.transaction) qs = await this.transaction.get(q); else qs = await q.get()
    if (qs.empty) return []
    const r = []
    for (const qds of qs.docs) { 
      const x = qds.data()
      x._nom = 'tickets'
      const rx = await decryptRow(this.appKey, x)
      this.op.nl++
      if (!fnprocess) r.push(rx); else fnprocess(rx._data_)
    }
    return !fnprocess ? r : null
  }
  
  async delScoll (nom, id) {
    let n = 0
    const p = FirestoreProvider._collPath(nom, id)
    const q = this.fs.collection(p)
    let qs; if (this.transaction) qs = await this.transaction.get(q); else qs = await q.get()
    if (!qs.empty) {
      for (const doc of qs.docs) { n++; doc.ref.delete() }
    }
    this.op.ne += n
    return n
  }

  async delTickets (id, ns, aamm) {
    let n = 0
    const mx = ns + (aamm % 10000) + '9999999999'
    const p = FirestoreProvider._collPath('tickets', id)
    const q = this.fs.collection(p).where('ids', '<=', mx)
    let qs; if (this.transaction) qs = await this.transaction.get(q); else qs = await q.get()
    if (!qs.empty) {
      for (const doc of qs.docs) { n++; doc.ref.delete() }
    }
    this.op.ne += n
    return n
  }

  async setFpurge (id, _data_) {
    const p = FirestoreProvider._path('fpurges', id)
    const r =  { id, _data_}
    if (this.transaction)
      await this.transaction.set(this.fs.doc(p), r)
    else
      await this.fs.doc(p).set(r)
    this.op.ne++
  }

  async unsetFpurge (id) {
    const p = FirestoreProvider._path('fpurges', id)
    if (this.transaction)
      await this.transaction.delete(this.fs.doc(p))
    else
      await this.fs.doc(p).delete()
    this.op.ne++
  }

  /* Retourne une liste d'objets  { id, idag, lidf } PAS de rows */
  async listeFpurges () {
    const r = []
    const p = FirestoreProvider._collPath('fpurges')
    const q = this.fs.collection(p)
    let qs; if (this.transaction) qs = await this.transaction.get(q); else qs = await q.get()
    if (!qs.empty) {
      for (const qds of qs.docs) { 
        const row = qds.data()
        r.push(decode(row._data_))
      }
    }
    this.op.nl += r.length
    return r
  }

  /* Retourne une liste de couples [id, ids] PAS de rows 
  Sur transferts: index COLLECTION_GROUP sur dlv
  */
  async listeTransfertsDlv (dlv) {
    const r = []
    const p = FirestoreProvider._collPath('transferts')
    const q = this.fs.collectionGroup(p).where('dlv', '<=', dlv)
    let qs; if (this.transaction) qs = await this.transaction.get(q); else qs = await q.get()
    if (!qs.empty) {
      for (const qds of qs.docs) { 
        const row = qds.data()
        r.push([row.id, row.ids]) // row: id, ids, dlv}
      }
    }
    this.op.nl += r.length
    return r
  }

  async purgeTransferts (id, idf) {
    const p = FirestoreProvider._path('transferts', id, idf)
    if (this.transaction)
      await this.transaction.delete(this.fs.doc(p))
    else
      await this.fs.doc(p).delete()
    this.op.ne++
  }

  /* Purge des versions sur dlv
  Sur versions: index sur dlv
  */
  async purgeVER (suppr) { // nom: sponsorings, versions
    let n = 0
    const q = this.fs.collection('versions').where('dlv', '>', 0).where('dlv', '<', suppr)
    let qs; if (this.transaction) qs = await this.transaction.get(q); else qs = await q.get()
    if (!qs.empty) {
      for (const doc of qs.docs) { n++; doc.ref.delete() }
    }
    this.op.ne += n
    return n
  }

  /* Purge des sponsorings sur dlv
  Sur sponsorings: index COLLECTION_GROUP sur dlv
  */
  async purgeSPO (dlv) { // nom: sponsorings, versions
    let n = 0
    const p = FirestoreProvider._collPath('sponsorings')
    const q = this.fs.collection(p).where('dlv', '<', dlv)
    let qs; if (this.transaction) qs = await this.transaction.get(q); else qs = await q.get()
    if (!qs.empty) {
      for (const doc of qs.docs) { n++; doc.ref.delete() }
    }
    this.op.ne += n
    return n
  }

  /** Ecritures groupées ***********************************************/

  /* deleteRows : les rows n'ont que { _nom, id, ids } */
  async deleteRows (rows) {
    for (const row of rows) {
      const p = FirestoreProvider._path(row._nom, row.id, row.ids)
      if (this.transaction)
        await this.transaction.delete(this.fs.doc(p))
      else
        await this.fs.doc(p).delete()
    }
  }

  async insertRows (rows) { await this.setRows(rows) }

  async updateRows (rows) { await this.setRows(rows) }

  async setRows (rows) {
    for (const row of rows) {
      const r = await prepRow(this.appKey, row)
      if (GenDoc.majeurs.has(row._nom)) {
        r.id = row.id
        r.v = row.v
        if (row.vcv !== undefined) r.vcv = row.vcv
      }
      const p = FirestoreProvider._path(row._nom, r.id, r.ids)
      if (this.transaction)
        await this.transaction.set(this.fs.doc(p), r)
      else
        await this.fs.doc(p).set(r)
    }
  }

}