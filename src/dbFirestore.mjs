import { Firestore } from '@google-cloud/firestore'
import { config } from './config.mjs'
import { GenConnx, GenDoc } from './gendoc.mjs'

export class FirestoreProvider {
  constructor (code, site) {
    const app_keys = config.app_keys
    this.type = 'firestore'
    this.site = app_keys.sites[site]
    this.appKey = Buffer.from(this.site.k, 'base64')

    const cfg = config[code]
    const kn = cfg.key
    this.service_account = config[kn]
    this.emulator = config.env.FIRESTORE_EMULATOR_HOST
  }

  async connect(op) {
    return await new Connx().connect(op, this)
  }

  // PRIVATE
  /* path pour tous les documents (sauf singletons)*/
  static _path (nom, id, ids) {
    if (!ids) return nom + '/' + id
    if (nom === 'transferts') return 'transferts/' + id + '_' + ids
    return 'versions/' + id + '/' + nom + '/' + ids
  }

  /* path des collections et sous collections */
  static _collPath (nom, id) {
    if (!id) return nom
    return 'versions/' + id + '/' + nom
  }

}

class Connx extends GenConnx {

  // Méthode PUBLIQUE de coonexion: retourne l'objet de connexion à la base
  async connect (op, provider) {
    super.connect(op, provider)

    const sa = this.provider.service_account
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
      return [0, '']
    } catch (e) {
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
  async deleteOrg(log) {
    const min = this.cOrg + '@'
    const max = this.cOrg + '@{'

    for (const nom of GenDoc.collsExp1) {
      const p = nom + '/' + this.cOrg
      await this.fs.doc(p).delete()
    }
    for (const nom of GenDoc.collsExp2) {
      const q = this.fs.collection(nom).where('id', '>=', min).where('id', '<', max)
      const qs = await q.get()
      let n = 0
      for (const ds of qs.docs) {
        n++
        if (nom === 'versions') {
          const id = ds.get('id')
          for (const scol of GenDoc.sousColls) {
            const cref = this.fs.collection('versions/' + id + '/' + scol)
            const bw = this.fs.bulkWriter()
            await this.fs.recursiveDelete(cref, bw)
          }
          await this.fs.doc('versions/' + id).delete()
         } else
          ds.ref.delete()
      }
    }
  }
  
  async batchInsertRows (rows) {
    const wb = this.fs.batch()
    for (const row of rows) {
      const r = this.prepRow(row)
      const dr = this.fs.doc(FirestoreProvider._path(row._nom, r.id, r.ids))
      wb.set(dr, r)
    }
    await wb.commit()
  }

  /*********************************************************************/
  // Retourne un dr (document reference)
  tacheP (top, org, id) {
    return this.fs.doc('taches/' + top + ';' + org + ';' + id)
  }

  async setTache (t) {
    const r = { 
      op: t.op,
      org: this.cryptedOrg(t.org),
      id: this.cryptedId(t.id),
      dh: t.dh, 
      exc: t.exc
    }
    const dr = this.tacheP(r.op, r.org, r.id)
    await dr.set(r)
  }

  async delTache (top, porg, pid) {
    const org = this.cryptedOrg(porg)
    const id = this.cryptedId(pid)
    const dr = this.tacheP(top, org, id)
    await dr.delete()
  }

  async recTache (top, porg, pid, dhf, nb) {
    const org = this.cryptedOrg(porg)
    const id = this.cryptedId(pid)
    const dr = this.tacheP(top, org, id)
    const ds = await dr.get()
    const r = ds.exists ? ds.data() : null
    if (r) {
      r.dhf = dhf
      r.nb = nb
      await dr.set(r)  
    }
  }

  /* Obtention de la prochaine tâche
  Sur taches: index composite sur dh / ns
  */
  async prochTache (dh) {
    const q = this.fs.collection('taches')
      .where('dh', '<', dh)
      .orderBy('dh')
      .limit(1)
    const qs = await q.get()
    if (qs.empty) return null
    const r = qs.docs[0].data()
    if (r.org) r.org = this.decryptedOrg(r.org)
    if (r.id) r.id = this.decryptedId(r.id)
    return r
  }

  /* Obtention des taches d'un ns
  Sur taches: index sur ns
  */
  async orgTaches (porg) {
    const org = this.cryptedOrg(porg) 
    const q = this.fs.collection('taches').where('org', '==', org)
    const qs = await q.get()
    const rows = []
    if (!qs.empty) for (const qds of qs.docs) {
      const row = qds.data()
      if (row.org) row.org = this.decryptedOrg(row.org)
      if (row.id) row.id = this.decryptedId(row.id)
      rows.push(row)
    }
    return rows
  }

  async toutesTaches () {
    const q = this.fs.collection('taches')
    const qs = await q.get()
    const rows = []
    if (!qs.empty) for (const qds of qs.docs) {
      const row = qds.data()
      if (row.org) row.org = this.decryptedOrg(row.org)
      if (row.id) row.id = this.decryptedId(row.id)
      rows.push(row)
    }
    return rows
  }

  /* Obtention des espaces modifiés après v
  Sur espaces: index sur v
  */
  async getRowEspaces() {
    const q = this.fs.collection('espaces')
    const qs = await q.get()
    const r = []
    if (!qs.empty) for (const qds of qs.docs) {
      const row = qds.data()
      row._nom = 'espaces'
      this.op.nl++
      const x = this.decryptRow(row)
      x._org = this.decryptedOrg(row.id)
      r.push(x)
    }
    return r
  }
  
  async getRowEspacesCalc (dpt) {
    const q = this.fs.collection('espaces').where('dpt', '<=', dpt)
    const qs = await q.get()
    const r = []
    if (!qs.empty) for (const qds of qs.docs) {
      const row = qds.data()
      row._nom = 'espaces'
      this.op.nl++
      const x = this.decryptRow(row)
      x._org = this.decryptedOrg(row.id)
      r.push(x)
    }
    return r
  }
  
  /* Retourne le row d'une collection de nom / id si sa version est postérieure à v
  Sur majeurs ['partitions', 'comptes', 'comptas', 'comptis', 'invits', 'versions', 'avatars', 'groupes']
  index composite id / v
  */
  async getV (nom, pid, v) {
    const id = this.idLong(pid)
    let row = null
    if (v && GenDoc.majeurs.has(nom)) {
      const q = this.fs.collection(nom).where('id', '==', id).where('v', '>', v)
      const qs = this.transaction ? await this.transaction.get(q) : await q.get()
      if (!qs.empty) row = qs.docs[0].data()
      if (row) {
        row._nom = nom
        this.op.nl++
        return this.decryptRow(row)
      }
      return null
    }

    const dr = this.fs.doc(FirestoreProvider._path(nom, id))
    const ds = this.transaction ? await this.transaction.get(dr) : await dr.get()
    if (ds.exists) {
      row = ds.data()
      row._nom = nom
      this.op.nl++
      return this.decryptRow(row)
    }
    return null
  }

  /* Retourne LE row de la collection nom / id (sans version)
  */
  async getNV (nom, pid, exportDb) {
    const id = this.idLong(pid)
    let row = null
    const dr = this.fs.doc(FirestoreProvider._path(nom, id)) // dr: DocumentReference
    // ds: DocumentSnapshot N'EXISTE PAS TOUJOURS
    const ds = this.transaction ? await this.transaction.get(dr) : await dr.get()
    if (ds.exists) {
      row = ds.data()
      row._nom = nom
      this.op.nl++
      return exportDb ? row : this.decryptRow(row)
    }
    return null
  }

  /* Retourne le row d'un objet d'une sous-collection nom / id / ids */
  async get (nom, pid, pids) {
    const id = this.idLong(pid)
    const ids = this.cryptedId(pids)
    let row = null
    const dr = this.fs.doc(FirestoreProvider._path(nom, id, ids)) // dr: DocumentReference
    // ds: DocumentSnapshot N'EXISTE PAS TOUJOURS
    const ds = this.transaction ? await this.transaction.get(dr) : await dr.get()
    if (ds.exists) {
      row = ds.data()
      row._nom = nom
      this.op.nl++
      return this.decryptRow(row)
    }
    return null
  }

  /* Retourne l'avatar si sa CV est PLUS récente que celle détenue en session (de version vcv)
  Sur avatars: index sur vcv
  */
  async getAvatarVCV (pid, vcv) {
    const id = this.idLong(pid)
    const q = this.fs.collection(FirestoreProvider._collPath('avatars'))
      .where('id', '==', id).where('vcv', '>', vcv)
    const qs = this.transaction ? await this.transaction.get(q) : await q.get()
    if (qs.empty) return null
    const row = qs.docs[0].data()
    row._nom = 'avatars'
    this.op.nl++
    return this.decryptRow(row)
  }

  /* Obtention d'un compte par sa hk */
  async getCompteHk (phk) {
    const hk = this.idLong(phk)
    const q = this.fs.collection(FirestoreProvider._collPath('comptes')).where('hk', '==', hk)
    const qs = this.transaction ? await this.transaction.get(q) : await q.get()
    if (qs.empty) return null
    const row = qs.docs[0].data()
    row._nom = 'comptes'
    this.op.nl++
    return this.decryptRow(row)
  }

  /* Obtention d'un avatar par sa hk */
  async getAvatarHk (phk) {
    const hk = this.idLong(phk)
    const q = this.fs.collection(FirestoreProvider._collPath('avatars')).where('hk', '==', hk)
    const qs = this.transaction ? await this.transaction.get(q) : await q.get()
    if (qs.empty) return null
    const row = qs.docs[0].data()    
    row._nom = 'avatars'
    this.op.nl++
    return this.decryptRow(row)
  }

  /* Obtention d'un sponsorings par son ids
  Sur sponsorings: index COLLECTION_GROUP sur ids
  */
  async getSponsoringIds (pids) {
    const ids = this.cryptedId(ids)
    const q = this.fs.collectionGroup(FirestoreProvider._collPath('sponsorings')).where('ids', '==', ids)
    const qs = this.transaction ? await this.transaction.get(q) : await q.get()
    if (qs.empty) return null
    const row = qs.docs[0].data()
    row._nom = 'sponsorings'
    this.op.nl++
    return this.decryptRow(row)
  }

  /* Retourne l'array des ids des "groupes" dont la fin d'hébergement 
  est inférieure à dfh 
  */
  async getGroupesDfh (dfh) {
    const q = this.fs.collection(FirestoreProvider._collPath('groupes')).where('dfh', '>', 0).where('dfh', '<', dfh) 
    const qs = this.transaction ? await this.transaction.get(q) : await q.get()
    const r = []
    if (!qs.empty) qs.forEach(qds => { 
      r.push(this.orgId(qds.get('id'))) 
    })
    return r
  }

  /* Retourne l'array des id des comptes ayant passé leur dlv 
  */
  async getComptasDlv (dlvmax) {
    const q = this.fs.collection(FirestoreProvider._collPath('comptas')).where('dlv', '<', dlvmax) 
    const qs = this.transaction ? await this.transaction.get(q) : await q.get()
    const r = []
    if (!qs.empty) qs.forEach(qds => { 
      r.push(this.orgId(qds.get('id'))) 
    })
    return r
  }

  /* Retourne la collection de nom 'nom' : pour avoir tous les espaces */
  async coll (nom) {
    const q = this.fs.collection(FirestoreProvider._collPath(nom))
    const qs = this.transaction ? await this.transaction.get(q) : await q.get()
    if (qs.empty) return []
    const r = []
    for (const qds of qs.docs) { 
      const row = qds.data()
      row._nom = nom
      this.op.nl++
      r.push(this.decryptRow(row))
    }
    this.op.nl += r.length
    return r
  }

  /* Retourne la collection de nom 'nom' 
  SI la fonction "fnprocess" est présente 
  elle est invoquée à chaque row pour traiter son _data_
  plutôt que d'accumuler les rows.
  */
  async collOrg (nom, fnprocess, exportDb) {
    const c = this.cryptedOrg(this.op.org)
    const min = c + '@'
    const max = c + '@{'
    const q = this.fs.collection(FirestoreProvider._collPath(nom)).where('id', '>=', min).where('id', '<', max) 
    const qs = this.transaction ? await this.transaction.get(q) : await q.get()
    if (qs.empty) return []
    const r = []
    for (const qds of qs.docs) { 
      const row = qds.data()
      row._nom = nom
      if (exportDb) r.push(row)
      else {
        const rx = this.decryptRow(row)
        this.op.nl++
        if (!fnprocess) r.push(rx)
        else fnprocess(rx._data_)
      }
    }
    return !fnprocess ? r : null
  }

  /* Retourne la sous-collection de 'nom' du document majeur id
  Si v est donnée, uniquement les documents de version supérieurs à v.
  */
  async scoll (nom, pid, v, exportDb) {
    const id = this.idLong(pid)
    const q = this.fs.collection(FirestoreProvider._collPath(nom, id)).where('v', '>', v)
    const qs = this.transaction ? await this.transaction.get(q) : await q.get()
    if (qs.empty) return []
    const r = []
    for (const qds of qs.docs) { 
      const row = qds.data()
      row._nom = nom
      r.push(exportDb ? row : this.decryptRow(row))
    }
    this.op.nl += r.length
    return r
  }

  /* Retourne les tickets du comptable id et du mois aamm ou antérieurs
  */
  async selTickets (pid, dlv, fnprocess) {
    const id = this.idLong(pid)
    const q = this.fs.collection(FirestoreProvider._collPath('tickets', id)).where('dlv', '<=', dlv)
    const qs = this.transaction ? await this.transaction.get(q) : await q.get()
    if (qs.empty) return []
    const r = []
    for (const qds of qs.docs) { 
      const row = qds.data()
      row._nom = 'tickets'
      const rx = this.decryptRow(row)
      this.op.nl++
      if (!fnprocess) r.push(rx)
      else fnprocess(rx._data_)
    }
    return !fnprocess ? r : null
  }
  
  async delScoll (nom, pid) {
    const id = this.idLong(pid)
    let n = 0
    const q = this.fs.collection(FirestoreProvider._collPath(nom, id))
    const qs = this.transaction ? await this.transaction.get(q) : await q.get()
    if (!qs.empty) {
      for (const doc of qs.docs) { n++; doc.ref.delete() }
    }
    this.op.ne += n
    return n
  }

  async delTickets (pid, dlv) {
    const id = this.idLong(pid)
    let n = 0
    const q = this.fs.collection(FirestoreProvider._collPath('tickets', id)).where('dlv', '<=', dlv)
    const qs = this.transaction ? await this.transaction.get(q) : await q.get()
    if (!qs.empty) {
      for (const doc of qs.docs) { n++; doc.ref.delete() }
    }
    this.op.ne += n
    return n
  }

  /* Retourne une liste d'objets  { id, idag, lidf } PAS de rows */
  async listeFpurges () {
    const r = []
    const q = this.fs.collection(FirestoreProvider._collPath('fpurges'))
    const qs = this.transaction ? await this.transaction.get(q) : await q.get()
    if (!qs.empty) {
      for (const qds of qs.docs) { 
        const row = qds.data()
        const d = GenDoc.compile(this.decryptRow(row))
        d.org = this.orgId(row.id)[0]
        this.op.nl++
        r.push(d)
      }
    }
    return r
  }

   /* Retourne une liste de {org, id, ids} des transferts hors date (à purger) */
   async listeTransfertsDlv (dlv) {
    const r = []
    const q = this.fs.collectionGroup('transferts').where('dlv', '<=', dlv)
    const qs = this.transaction ? await this.transaction.get(q) : await q.get()
    if (!qs.empty) {
      for (const qds of qs.docs) { 
        const row = qds.data()
        row._nom = 'Transferts'
        const d = GenDoc.compile(this.decryptRow(row))
        d.org = this.orgId(row.id)[0]
        this.op.nl++
        r.push(d)
      }
    }
    return r
  }


  async purgeFpurge (pid) {
    const id = this.idLong(pid)
    const dr = this.fs.doc(FirestoreProvider._path('fpurges', id))
    if (this.transaction)
      this.transaction.delete(dr)
    else
      await dr.delete()
    this.op.ne++
  }

  async purgeTransferts (pid) {
    const id = this.idLong(pid)
    const dr = this.fs.doc(FirestoreProvider._path('transferts', id))
    if (this.transaction)
      this.transaction.delete(dr)
    else
      await dr.delete()
    this.op.ne++
  }

  async purgeVER (suppr) { // nom: sponsorings, versions
    let n = 0
    const q = this.fs.collectionGroup('versions').where('dlv', '>', 0).where('dlv', '<', suppr)
    const qs = this.transaction ? await this.transaction.get(q) : await q.get()
    if (!qs.empty) {
      for (const doc of qs.docs) { n++; doc.ref.delete() }
    }
    this.op.ne += n
    return n
  }

  async purgeSPO (dlv) { // nom: sponsorings, versions
    let n = 0
    const q = this.fs.collectionGroup(FirestoreProvider._collPath('sponsorings')).where('dlv', '<', dlv)
    const qs = this.transaction ? await this.transaction.get(q) : await q.get()
    if (!qs.empty) {
      for (const doc of qs.docs) { n++; doc.ref.delete() }
    }
    this.op.ne += n
    return n
  }

  /* deleteRows : les rows n'ont que { _nom, id, ids } */
  async deleteRows (rows) {
    for (const row of rows) {
      const id = this.idLong(row.id)
      const ids = this.idLong(row.ids)
      const dr = this.fs.doc(FirestoreProvider._path(row._nom, id, ids))
      if (this.transaction)
        this.transaction.delete(dr)
      else
        await dr.delete()
    }
  }

  async insertRows (rows) { await this.setRows(rows) }

  async updateRows (rows) { await this.setRows(rows) }

  async setRows (rows) {
    for (const row of rows) {
      const r = this.prepRow(row)
      const dr = this.fs.doc(FirestoreProvider._path(row._nom, r.id, r.ids))
      if (this.transaction)
        this.transaction.set(dr, r)
      else
        await dr.set(r)
    }
  }

}