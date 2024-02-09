import { Firestore } from '@google-cloud/firestore'

import { decode } from '@msgpack/msgpack'
import { ctx } from './server.js'
import { GenDoc, compile, prepRow, decryptRow } from './gendoc.mjs'
import { d14, ID, d10 } from './api.mjs'

export class FirestoreProvider {
  constructor (cfg, site, code) {
    this.code = code
    this.site = site
    this.appKey = Buffer.from(ctx.site(site), 'base64')
    this.emulator = ctx['FIRESTORE_EMULATOR_HOST']
    this.fscredentials = ctx.keys.firebase_config
    this.fs = new Firestore()
  }

  get type () { return 'firestore' }

  get hasWS () { return false }

  async ping () {
    const dr = this.fs.doc('singletons/ping')
    await dr.set({ dh: new Date().toISOString() })
    return true
  }

  excInfo () {
    return ''
  }

  setSyncData(op) {
    op.setRes('credentials', ctx.keys.firebase_config)
    op.setRes('emulator', ctx.env.FIRESTORE_EMULATOR_HOST || null)
  }

  async doTransaction (op) {
    await this.fs.runTransaction(async (transaction) => {
      // reset DANS le traitement de la transaction qui peut boucler
      op.transaction = transaction
      await op.doPhase2()
    })
  }

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

  /** Ecritures groupées ***********************************************/

  /* deleteRows : les rows n'ont que { _nom, id, ids } */
  async deleteRows (op, rows) {
    for (const row of rows) {
      const p = FirestoreProvider._path(row._nom, row.id, row.ids)
      await op.transaction.delete(this.fs.doc(p))
    }
  }

  async setVdlv (id, dlv) {
    const p = FirestoreProvider._path('versions', id)
    const doc = await this.fs.get(p)
    const row = doc.data()
    row.dlv = dlv
    row._data_ = null
    doc.set(row)
  }

  async insertRows (op, rows) {
    await this.setRows(op, rows)
  }

  async updateRows (op, rows) {
    await this.setRows(op, rows)
  }

  async setRows (op, rows) {
    for (const row of rows) {
      const r = await prepRow(op, row)
      if (GenDoc.majeurs.has(row._nom)) {
        const v = ('' + row.v).padStart(9, '0')
        r.id_v = row.id + v
        if (row.vcv !== undefined) {
          const vcv = ('' + row.vcv).padStart(9, '0')
          r.id_vcv = row.id + vcv  
        }
      }
      const p = FirestoreProvider._path(row._nom, r.id, r.ids)
      await op.transaction.set(this.fs.doc(p), r)
    }
  }

  /* Retourne LE row de la collection nom / id et de version > v
  */
  async getV (op, nom, id, v) {
    let row = null
    if (v && GenDoc.majeurs.has(nom)) {
      const min = id + (''+v).padStart(9, '0')
      const max = id + '999999999'
      const q = this.fs.collection(nom).where('id_v', '>', min).where('id_v', '<', max)
      let qs
      if (!op.fake) {
        qs = await op.transaction.get(q) // qs: QuerySnapshot
      } else {
        qs = await q.get()
      }
      if (!qs.empty) row = qs.docs[0].data()
      if (row) {
        row._nom = nom
        op.nl++
        return await decryptRow(op, row)
      }
      return null
    }

    const dr = this.fs.doc(nom + '/' + id)
    let ds
    if (!op.fake) {
      ds = await op.transaction.get(dr) // qs: QuerySnapshot
    } else {
      ds = await dr.get()
    }
    if (ds.exists) {
      row = ds.data()
      row._nom = nom
      op.nl++
      return await decryptRow(op, row)
    }
    return null
  }

  /* Retourne LE row de la collection nom / id (sans version)
  */
  async getNV (op, nom, id) {
    let row = null
    const p = FirestoreProvider._path(nom, id)
    const dr = this.fs.doc(p) // dr: DocumentReference
    // ds: DocumentSnapshot N'EXISTE PAS TOUJOURS
    let ds
    if (!op.fake) {
      ds = await op.transaction.get(dr)
    } else {
      ds = await dr.get()
    }
    if (ds.exists) {
      row = ds.data()
      row._nom = nom
      op.nl++
      return await decryptRow(op, row)
    }
    return null
  }

  /* Retourne LE row de la sous-collection nom / id / ids (SANS se préoccuper de la version) */
  async get (op, nom, id, ids) {
    let row = null
    const p = FirestoreProvider._path(nom, id, ids)
    const dr = this.fs.doc(p) // dr: DocumentReference
    // ds: DocumentSnapshot N'EXISTE PAS TOUJOURS
    let ds
    if (!op.fake) {
      ds = await op.transaction.get(dr)
    } else {
      ds = await dr.get()
    }
    if (ds.exists) {
      row = ds.data()
      row._nom = nom
      op.nl++
      return await decryptRow(op, row)
    }
    return null
  }

  async getEspaceOrg(op, org) {
    const q = this.fs.collection('espaces').where('org', '==', org)
    const qs = await op.transaction.get(q)
    if (qs.empty) return null
    const row = qs.docs[0].data()
    op.nl++
    return compile(await decryptRow(op, row))
  }

  /* Retourne l'avatar si sa CV est PLUS récente que celle détenue en session (de version vcv)
  */
  async getAvatarVCV (op, id, vcv) {
    const min = id + (''+vcv).padStart(9, '0')
    const max = id + '999999999'
    const q = this.fs.collection('avatars').where('id_vcv', '>', min).where('id_vcv', '<', max)
    const qs = await op.transaction.get(q)
    if (qs.empty) return null
    const row = qs.docs[0].data()
    op.nl++
    return compile(await decryptRow(op, row))
  }

  /* Retourne LE chat si sa CV est MOINS récente que celle détenue en session (de version vcv)
  */
  async getChatVCV (op, id, ids, vcv) {
    const p = FirestoreProvider._path('chats', id, ids)
    // INDEX simple sur chats vcv
    const q = this.fs.collection(p).where('vcv', '>', vcv)
    const qs = await op.transaction.get(q)
    let row = null
    if (!qs.empty) {
      for (const qds of qs.docs) { row = qds.data(); break }
    }
    if (!row) return null
    row._nom = 'chats'
    op.nl++
    return compile(await decryptRow(op, row))
  }

  /* Retourne LE row ticket si sa version est plus récente que celle détenue en session (de version v)
  */
  async getRowTicketV (op, id, ids, v) {
    const p = FirestoreProvider._path('tickets', id, ids)
    // INDEX simple sur chats vcv
    const q = this.fs.collection(p).where('v', '>', v)
    const qs = await op.transaction.get(q)
    let row = null
    if (!qs.empty) {
      for (const qds of qs.docs) { row = qds.data(); break }
    }
    if (row) {
      row._nom = 'tickets'
      op.nl++
      return await decryptRow(op, row)
    }
    return null
  }

  /* Retourne LE membre si sa CV est MOINS récente que celle détenue en session (de version vcv)
  */
  async getMembreVCV (op, id, ids, vcv) {
    const p = FirestoreProvider._path('membres', id, ids)
    // INDEX simple sur membres vcv
    const q = this.fs.collection(p).where('vcv', '>', vcv)
    const qs = await op.transaction.get(q)
    let row = null
    if (!qs.empty) {
      for (const qds of qs.docs) { row = qds.data(); break }
    }
    if (!row) return null
    row._nom = 'membres'
    op.nl++
    return compile(await decryptRow(op, row))
  }

  async getComptaHps1(op, hps1) {
    const p = FirestoreProvider._collPath('comptas')
    // INDEX simple sur comptas hps1
    const q = this.fs.collection(p).where('hps1', '==', hps1)
    let qs
    if (!op.fake) {
      qs = await op.transaction.get(q)
    } else {
      qs = await q.get()
    }
    let row = null
    if (!qs.empty) {
      for (const qds of qs.docs) { row = qds.data(); break }
    }
    if (!row) return null
    row._nom = 'comptas'
    op.nl++
    return await decryptRow(op, row)
  }

  async getAvatarHpc(op, hpc) {
    const p = FirestoreProvider._collPath('avatars')
    // INDEX simple sur avatars hpc
    const q = this.fs.collection(p).where('hpc', '==', hpc)
    let qs
    if (!op.fake) {
      qs = await op.transaction.get(q)
    } else {
      qs = await q.get()
    }
    let row = null
    if (!qs.empty) {
      for (const qds of qs.docs) { row = qds.data(); break }
    }
    if (!row) return null
    row._nom = 'avatars'
    op.nl++
    return await decryptRow(op, row)
  }

  async getSponsoringIds(op, ids) {
    // INDEX COLLECTION_GROUP sur sponsorings ids
    const q = this.fs.collectionGroup('sponsorings').where('ids', '==', ids)
    let qs
    if (!op.fake) {
      qs = await op.transaction.get(q)
    } else {
      qs = await q.get()
    }
    let row = null
    if (!qs.empty) {
      for (const qds of qs.docs) { row = qds.data(); break }
    }
    if (!row) return null
    row._nom = 'sponsorings'
    op.nl++
    return await decryptRow(op, row)
  }

  /* Retourne l'array des ids des "versions" dont la dlv est entre min incluse et max exclu */
  async getVersionsDlv (op, dlvmin, dlvmax) {
    const p = FirestoreProvider._collPath('versions')
    // INDEX simple sur versions dlv
    const q = this.fs.collection(p).where('dlv', '>=', dlvmin).where('dlv', '<', dlvmax) 
    const qs = await q.get()
    const r = []
    if (!qs.empty) qs.forEach(qds => { r.push(qds.get('id'))})
    op.nl += r.length    
    return r
  }

  /* Retourne l'array des [id, ids] des "membres" dont la dlv est inférieure à dlvmax */
  async getMembresDlv (op, dlvmax) { 
    // INDEX COLECTION_GROUP sur membres dlv
    const q = this.fs.collectionGroup('membres').where('dlv', '<', dlvmax) 
    const qs = await q.get()
    const r = []
    if (!qs.empty) qs.forEach(qds => { r.push([qds.get('id'), qds.get('ids')])})
    op.nl += r.length
    return r
  }

  /* Retourne l'array des ids des "groupes" dont la fin d'hébergement 
  est inférieure à dfh */
  async getGroupesDfh(op, dfh) {
    const p = FirestoreProvider._collPath('groupes')
    // INDEX simple sur groupes dfh
    const q = this.fs.collection(p).where('dfh', '>', 0).where('dfh', '<', dfh) 
    const qs = await q.get()
    const r = []
    if (!qs.empty) qs.forEach(qds => { r.push(qds.get('id')) })
    op.nl += r.length
    return r
  }
  
  /* Retourne la collection 'nom' : pour la liste des espaces */
  async coll (op, nom) {
    const p = FirestoreProvider._collPath(nom)
    const q = this.fs.collection(p)
    const qs = await op.transaction.get(q)
    if (qs.empty) return []
    const r = []
    for (const qds of qs.docs) { 
      const x = qds.data()
      x._nom = nom
      r.push(x)
    }
    op.nl += r.length
    return r
  }

  /* Retourne la collection de nom 'nom' 
  SI la fonction "fnprocess" est présente 
  elle est invoquée à chaque row pour traiter son _data_
  plutôt que d'accumuler les rows.
  */
  async collNs (op, nom, ns, fnprocess) {
    const ns1 = ns * d14
    const ns2 = (ns + 1) * d14
    const p = FirestoreProvider._collPath(nom)
    // INDEX simple sur les collections id (avatars, groupes, versions ...) ! PAS les sous-collections
    const q = this.fs.collection(p).where('id', '>=', ns1).where('id', '<', ns2) 
    let qs
    if (op.transaction) {
      qs = await op.transaction.get(q)
    } else {
      qs = await q.get()
    }
    if (qs.empty) return []
    const r = []
    for (const qds of qs.docs) { 
      const x = qds.data()
      x._nom = nom
      const rx = await decryptRow(op, x)
      if (!fnprocess) r.push(rx); else fnprocess(op, rx._data_)
    }
    op.nl += r.length
    return !fnprocess ? r : null
  }
  
  /* 
  Retourne la sous-collection 'nom' du document majeur id
  Uniquement les documents de version supérieurs à v.
  Chargement des chats sponsorings notes membres
  */
  async scoll (op, nom, id, v) {
    const p = FirestoreProvider._collPath(nom, id)
    // INDEX simple sur (chats sponsorings notes membres chatgrs) v
    const q = this.fs.collection(p).where('v', '>', v)
    const qs = await op.transaction.get(q)
    if (qs.empty) return []
    const r = []
    for (const qds of qs.docs) { 
      const x = qds.data()
      x._nom = nom
      r.push(x)
    }
    op.nl += r.length
    return r
  }

  /* Retourne les tickets du comptable id et du mois aamm ou antérieurs
  */
  async selTickets (op, id, aamm, fnprocess) {
    const mx = ((aamm % 10000) * d10) + 9999999999
    const p = FirestoreProvider._collPath('tickets', id)
    // INDEX simple sur (chats sponsorings notes membres chatgrs) v
    const q = this.fs.collection(p).where('ids', '<=', mx)
    const qs = await op.transaction.get(q)
    if (qs.empty) return []
    const r = []
    for (const qds of qs.docs) { 
      const x = qds.data()
      x._nom = 'tickets'
      const rx = await decryptRow(op, x)
      op.nl++
      if (!fnprocess) r.push(rx); else fnprocess(op, rx._data_)
    }
    return !fnprocess ? r : null
  }
  
  async delScoll (op, nom, id) {
    let n = 0
    const p = FirestoreProvider._collPath(nom, id)
    const q = this.fs.collection(p)
    const qs = await q.get()
    if (!qs.empty) {
      for (const doc of qs.docs) { n++; doc.ref.delete() }
    }
    op.ne += n
    return n
  }

  async delTickets (op, id, aamm) {
    let n = 0
    const mx = ((aamm % 10000) * d10) + 9999999999
    const p = FirestoreProvider._collPath('tickets', id)
    const q = this.fs.collection(p).where('ids', '<=', mx)
    const qs = await q.get()
    if (!qs.empty) {
      for (const doc of qs.docs) { n++; doc.ref.delete() }
    }
    op.ne += n
    return n
  }

  async delAvGr (op, id) {
    const p = (ID.estGroupe(id) ? 'groupes/' : 'avatars/') + id
    await this.fs.doc(p).delete()
    op.ne++
  }

  async getCheckpoint (op, v) { 
    const q = this.fs.collection('singletons/1').where('v', '>', v )
    const qs = await q.get()
    if (!qs.empty()) for(const doc of qs.docs) {
      const x = {
        _data_: doc.get('_data_'),
        v:  doc.get('v')
      }
      op.nl++
      return x
    }
    return null
  }

  async setCheckpoint (op, v, _data_ /*, ins */) {
    const dr = this.fs.doc('singletons/1')
    await dr.set({ v, _data_ })
    op.ne++
  }

  async org (op, ns) {
    const dr = this.fs.doc('espaces/' + ns)
    const ds = await dr.get()
    if (ds.exists) {
      op.nl++
      const row = ds.data()
      row._nom = 'espaces'
      return await decryptRow(op, row)
    }
    return null
  }

  async setFpurge (op, id, _data_) {
    const p = FirestoreProvider._path('fpurges', id)
    await op.op.transaction.set(this.fs.doc(p), { id, _data_})
    op.ne++
  }

  async unsetFpurge (op, id) {
    const p = FirestoreProvider._path('fpurges', id)
    await this.fs.doc(p).delete()
    op.ne++
  }

  /* Retourne une liste d'objets  { id, idag, lidf } PAS de rows */
  async listeFpurges (op) {
    const r = []
    const p = FirestoreProvider._collPath('fpurges')
    const q = this.fs.collection(p)
    const qs = await q.get()
    if (!qs.empty) {
      for (const qds of qs.docs) { 
        const row = qds.data()
        r.push(decode(row._data_))
      }
    }
    op.nl += r.length
    return r
  }

  /* Retourne une liste de couples [id, ids] PAS de rows */
  async listeTransfertsDlv (op, dlv) {
    const r = []
    const p = FirestoreProvider._collPath('transferts')
    const q = this.fs.collection(p).where('dlv', '<=', dlv)
    const qs = await q.get()
    if (!qs.empty) {
      for (const qds of qs.docs) { 
        const row = qds.data()
        r.push([row.id, row.ids]) // row: id, ids (idf), dlv}
      }
    }
    op.nl += r.length
    return r
  }

  async purgeTransferts (op, id, ids) {
    const p = FirestoreProvider._path('transferts', id, ids)
    await this.fs.doc(p).delete()
    op.ne++
  }

  async purgeDlv (op, nom, dlv) { // nom: sponsorings, versions
    let n = 0
    const p = FirestoreProvider._collPath(nom)
    const q = this.fs.collection(p).where('dlv', '<', dlv)
    const qs = await q.get()
    if (!qs.empty) {
      for (const doc of qs.docs) { n++; doc.ref.delete() }
    }
    op.ne += n
    return n
  }

  // Util: suppression d'un ns
  _queryExp2 (ns, nom) {
    const min = ns * d14
    const max = (ns + 1) * d14
    if (!GenDoc.majeurs.has(nom)) {
      return this.fs.collection(nom)
        .where('id', '>=', min)
        .where('id', '<', max)
    }
    return this.fs.collection(nom)
      .where('id_v', '>=', min + '000000000')
      .where('id_v', '<', max + '000000000')
  }

  async deleteNS(log, log2, ns) {
    let n = 0
    // ['espaces', 'syntheses']
    for (const nom of GenDoc.collsExp1) { 
      const p = FirestoreProvider._path(nom, ns)
      await this.fs.doc(p).delete()
      log(`delete ${nom} - ${n} rows`)
    }

    /* Les documents "versions" têtes de leurs sous-collections (notes, chats ...)
    NE DOIVENT PAS être détruits AVANT leurs sous-collections qui sinon
    deviendraient inaccessibles */
    const lpavgr = []
    // ['fpurges', 'gcvols', 'tribus', 'comptas', 'avatars', 'groupes', 'versions']
    for (const nom of GenDoc.collsExp2) { 
      n = 0
      const query = this._queryExp2(ns, nom)
      const qs = await query.get()
      for (const doc of qs.docs) {
        if (nom === 'versions') {
          const id = doc.get('id')
          lpavgr.push(id)
        } else { 
          n++
          await doc.ref.delete() 
        }
      }
      if (nom !== 'versions') log(`delete ${nom} - ${n} rows`)
    } 
    
    let na = 0, ng = 0, nra = 0, nrg = 0
    for (const id of lpavgr) {
      const g = ID.estGroupe(id)
      const p = 'versions/' + id
      // ['notes', 'transferts', 'sponsorings', 'chats', 'tickets']
      // OU ['notes', 'transferts', 'membres', 'chatgrs']
      const c = g ? GenDoc.collsExpG : GenDoc.collsExpA
      for (const nom of c) { 
        const query = this.fs.collection(p + '/' + nom)
        const qs = await query.get()
        for (const doc of qs.docs) { 
          if (g) nrg++; else nra++
          await doc.ref.delete()
        }
      }
      if (g) ng++; else na++
      // versions lui-même
      await this.fs.doc(p).delete()
      log2(`delete ${p}`)
    }
    log(`\rdelete ${na} avatars - ${nra} rows`)
    log(`delete ${ng} groupes - ${nrg} rows`)
  }
}