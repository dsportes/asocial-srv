/*
Les documents existent sous 3 formes: row et compilées serveur et UI.
A) "row". Simple objet Javascript pouvant avoir les attributs suivants, tous des entiers, SAUF _data_ (bin):
  - _nom: de la (sous) collection / tables dont il est issu
  - id : pour un document majeur, son id. Pour un sous-document, l'id de son document majeur.
  - ids : pour un document majeur 0. Pour un sous-document, son id relative à son document majeur.
  - v : sa version numéroté dans la séquence hébergée par le document majeur.
  - iv : est calculable depuis id et v
  - dh dhb idt ivb hps1 vcv ivc dds dlv ttl dfh: les autres attributs pouvant être clé primaire et/ou index.
  - _data_ : un Uint8Array qui porte la sérialisation des autres attributs (mais aussi des attributs ci-dessus).
  1) "row" est lu / écrit directement depuis SQL / FS : il faut toutefois lui ajouter son nom après lecture.
  2) "row" est échangé entre UI et serveur:
    - en paramètres des opérations,
    - en résultat des opérations quand elles en ont.
    - en synchronisation par WebService ou onSnapshot de FS (qui est en fait le row issu de la base). 
    - les collections synchronisables - toutes sauf singletons, gcvols, transferts qui restent sur le serveur)
      portent toujours les attributs _nom id ids v _data_ (mais peuvent en porter d'autres).
  3) "row" est stocké en session UI en IndexedDB
    - id (et ids le cas échéant) cryptés par la clé K du compte et en base64 forment la clé primaire.
    - _data_ est crypté par la clé K et forme l'unique attribut non clé
B) compilation en Objet serveur
  Il existe une classe par (sous) collection
  Les champs de l'objet résultent directement de la désérialisation de _data_
  Un tel Objet peut retourne un "row" contenant les attributs clés / index correspondant à sa classe.
  - ce row est utilisable, pour écriture en SQL / FS, résultat d'opération, synchronisation.
  - si la propriété dlv (date limite de validité) est supérieure à numéro du jour courant,
    _data_ est considéré absent / null et la propriété _zombi est à true
  C) compilation en Objet UI
  Il existe une classe par (sous) collection.
  Les champs de l'objet résultent de la désérialisation de _data_ PUIS d'un traitement local significatif.
  Un tel Objet peut retourne un "row" contenant id / ids / _data_, le strict nécessaire pour être inscrit en IDB.
*/

import { encode, decode } from '@msgpack/msgpack'
import { ID, PINGTO, AppExc, A_SRV, E_SRV, F_SRV, FLAGS, Compteurs, UNITEV1, UNITEV2, d14, edvol, lcSynt } from './api.mjs'
import { ctx } from './server.js'
import { SyncSession } from './ws.mjs'
import { rnd6, sleep, b64ToU8, decrypterSrv, crypterSrv } from './util.mjs'

export function trace (src, id, info, err) {
  const msg = `${src} - ${id} - ${info}`
  const t = new Date().toISOString()
  if (err) console.error(t + ' ' + msg); else console.log(t + ' ' +  msg)
  return msg
}

export function assertKO (src, code, args) {
  const x = args && args.length ? JSON.stringify(args) : ''
  const msg = `ASSERT : ${src} - ${x} - ${code}`
  const t = new Date().toISOString()
  console.error(t + ' ' + msg)
  const a = (args || []).unshift(src)
  return new AppExc(A_SRV, code, a)
}

/** Retourne le prepare SQL du statement et le garde en cache avec un code 
L'argument SQL n'est pas requis si on est certain que le code donné a bien été enregistré
*/
const cachestmt = { }
export function stmt (code, sql) {
  let s = cachestmt[code]
  if (!s) {
    if (!sql) return null
    s = ctx.sql.prepare(sql)
    cachestmt[code] = s
  }
  return s
}

export const collsExp1 = ['espaces', 'tickets', 'syntheses']

export const collsExp2 = ['fpurges', 'gcvols', 'tribus', 'comptas', 'avatars', 'groupes', 'versions']

export const collsExpA = ['notes', 'transferts', 'sponsorings', 'chats', 'tickets']

export const collsExpG = ['notes', 'transferts', 'membres', 'chatgrs']

export const majeurs = new Set(['tribus', 'comptas', 'versions', 'avatars', 'groupes'])

export const syncs = new Set(['singletons', 'espaces', 'tribus', 'comptas', 'versions'])

export const sousColls = new Set(['notes', 'transferts', 'sponsorings', 'chats', 'membres', 'chatgrs'])

/* Cache ************************************************************************
Cache des objets majeurs "tribus comptas avatars groupes" 
*/

class Cache {
  static MAX_CACHE_SIZE = 1000

  static map = new Map()

  static checkpoint = { id: 1, v: 0, _data_: null }

  static orgs = new Map()

  /* Obtient le row de la cache ou va le chercher.
  Si le row actuellement en cache est le plus récent on a évité une lecture effective
   (ça s'est limité à un filtre sur index qui ne coûte rien en FireStore).
  Si le row n'était pas en cache ou que la version lue est plus récente IL Y EST MIS:
  certes la transaction peut échouer, mais au pire on a lu une version,
  pas forcément la dernière, mais plus récente.
  */
  static async getRow (op, nom, id) {
    if (this.map.size > Cache.MAX_CACHE_SIZE) Cache._purge()
    const k = nom + '/' + id
    const x = Cache.map.get(k)
    if (x) { // on vérifie qu'il n'y en pas une postérieure (pas lue si elle n'y en a pas)
      const n = await GenDoc.getV(op.transaction, nom, id, x.row.v)
      x.lru = Date.now()
      if (n && n.v > x.row.v) x.row = n // une version plus récente existe : mise en cache
      if (x.row._nom === 'espaces' && !Cache.orgs.has(x.row.id))
        Cache.orgs.set(x.row.id, x.row.org)
      return x.row
    }
    const n = await GenDoc.getV(op.transaction, nom, id, 0)
    if (n) { // dernière version si elle existe
      op.nl++
      const y = { lru: Date.now(), row: n }
      this.map.set(k, y)
    }
    if (n && n._nom === 'espaces' && !Cache.orgs.has(n.id))
      Cache.orgs.set(n.id, n.org)
    return n
  }

  /* Retourne l'espace depuis celui détenu en cache
  C'est seulement s'il a plus de PINGTO minutes d'âge qu'on vérifie sa version
  et qu'on la recharge le cas échéant.
  PAR PRINCIPE, elle est retardée: convient pour checker une restriction éventuelle
  */
  static async getEspaceLazy (ns) {
    const now = Date.now()
    const k = 'espaces/' + ns
    let x = Cache.map.get(k)
    if (x) {
      if ((now - x.lru) > PINGTO * 60000) {
        // Le row connu a plus de 5 minutes - if faut revérifier la version
        const e = await GenDoc.getV('fake', 'espaces', ns, x.row.v)
        if (e) x.row = e
        x.lru = now
        if (!Cache.orgs.has(x.row.id)) Cache.orgs.set(x.row.id, x.row.org)
      }
    } else {
      const e = await GenDoc.getV('fake', 'espaces', ns, 0)
      if (!e) return null
      x = { lru: Date.now(), row: e }
      this.map.set(k, x)
    }
    if (!Cache.orgs.has(x.row.id)) Cache.orgs.set(x.row.id, x.row.org)
    return compile(x.row)
  }

  /*
  Enrichissement de la cache APRES le commit de la transaction avec
  tous les rows créés, mis à jour ou accédés (en ayant obtenu la "dernière")
  */
  static update (op, newRows, delRowPaths) { // set des path des rows supprimés
    for(const row of newRows) {
      if (sousColls.has(row._nom)) continue
      const k = row._nom + '/' + row.id
      const x = Cache.map.get(k)
      if (x) {
        if (x.row.v < row.v) x.row = row
      } else {
        this.map.set(k, { lru: Date.now(), row: row })
      }
      if (row._nom === 'espaces' && !Cache.orgs.has(row.id))
        Cache.orgs.set(row.id, row.org)
    }
    if (delRowPaths && delRowPaths.size) {
      delRowPaths.forEach(p => { Cache.map.delete(p) })
    }
  }

  static _purge () {
    const t = []
    Cache.map.forEach((value, key) => { t.push({ lru: value.lru, k: key }) } )
    t.sort((a, b) => { return a.lru < b.lru ? -1 : (a.lru > b.lru ? 1 : 0) })
    for (let i = 0; i < Cache.MAX_CACHE_SIZE / 2; i++) {
      const k = t[i].k
      Cache.map.delete(k)
    }
  }

  static async getCheckpoint (op) { 
    // INDEX singletons v
    if (!ctx.sql) {
      const q = ctx.fs.collection('singletons/1').where('v', '>', Cache.checkpoint.v )
      const qs = await q.get()
      if (!qs.empty()) for(const doc of qs.docs) {
        Cache.checkpoint._data_ = doc.get('_data_')
        Cache.checkpoint.v = doc.get('v')
        op.nl++
      }
    } else {
      const st = stmt('SELCHKPT', 'SELECT * FROM singletons WHERE id = 1 AND v > @v')
      const x = st.get({ v: Cache.checkpoint.v })
      if (x) {
        Cache.checkpoint.v = x.v
        Cache.checkpoint._data_ = x._data_
        op.nl++
      }
    }
    return Cache.checkpoint._data_ ? decode(Cache.checkpoint._data_) : { v: 0 }
  }

  static async setCheckpoint (op, obj) {
    const x = obj || { v: 0 }
    x.v = Date.now()
    const _data_ = new Uint8Array(encode(x))
    if (!ctx.sql) {
      Cache.checkpoint.v = x.v
      Cache.checkpoint._data_ = _data_
      const dr = ctx.fs.doc('singletons/1')
      await dr.set(Cache.checkpoint)
    } else {
      let st
      if (!Cache.checkpoint._data_) {
        st = stmt('INSCHKPT', 'INSERT INTO singletons (id, v,_data_) VALUES (1, @v, @_data_)')
      } else {
        st = stmt('UPDCHKPT', 'UPDATE singletons SET _data_ = @_data_, v = @v WHERE id = 1')
      }
      st.run({ v: x.v, _data_ })
      Cache.checkpoint.v = x.v
      Cache.checkpoint._data_ = _data_
    }
    op.ne++
  }

  static async org (op, id) {
    const ns = id < 100 ? id : ID.ns(id)
    const org = Cache.orgs.get(ns)
    if (org) return org
    let row
    if (!ctx.sql) {
      const dr = ctx.fs.doc('espaces/' + ns)
      const ds = await dr.get()
      if (ds.exists) row = ds.data()
    } else {
      const st = stmt('SELORG', 'SELECT * FROM espaces WHERE id = @id')
      row = st.get({ id: ns })
    }
    if (row) {
      op.nl++
      Cache.update(op, [row], [])
      return row.org
    }
    return null
  }
}

/* GenDoc *************************************************************************/
export function compile (row) {
  if (!row) return null
  const d = GenDoc._new(row._nom)
  const z = row.dlv && row.dlv <= ctx.auj
  if (z || !row._data_) {
    d._zombi = true
  } else {
    const obj = decode(Buffer.from(row._data_))
    for (const [key, value] of Object.entries(obj)) d[key] = value
  }
  return d
}

export class GenDoc {

  /* Liste des attributs des (sous)collections- sauf singletons */
  static _attrs = {
    espaces: ['id', 'org', 'v', '_data_'],
    fpurges: ['id', '_data_'],
    gcvols: ['id', '_data_'],
    tribus: ['id', 'v', '_data_'],
    syntheses: ['id', 'v', '_data_'],
    comptas: ['id', 'v', 'hps1', '_data_'],
    versions: ['id', 'v', 'dlv', '_data_'],
    avatars: ['id', 'v', 'vcv', 'hpc', '_data_'],
    notes: ['id', 'ids', 'v', '_data_'],
    transferts: ['id', 'ids', 'dlv', '_data_'],
    sponsorings: ['id', 'ids', 'v', 'dlv', '_data_'],
    chats: ['id', 'ids', 'v', 'vcv', '_data_'],
    tickets: ['id', 'ids', 'v', '_data_'],
    groupes: ['id', 'v', 'dfh', '_data_'],
    membres: ['id', 'ids', 'v', 'vcv', 'dlv', '_data_'],
    chatgrs: ['id', 'ids', 'v', '_data_']
  }

  get _attrs () { return GenDoc._attrs[this._nom] }

  static _new (nom) {
    let obj
    switch (nom) {
    case 'espaces' : { obj = new Espaces(); break }
    case 'fpurges' : { obj = new Fpurges(); break }
    case 'gcvols' : { obj = new Gcvols(); break }
    case 'tribus' : { obj = new Tribus(); break }
    case 'syntheses' : { obj = new Syntheses(); break }
    case 'comptas' : { obj = new Comptas(); break }
    case 'versions' : { obj = new Versions(); break }
    case 'avatars' : { obj = new Avatars(); break }
    case 'notes' : { obj = new Notes(); break }
    case 'transferts' : { obj = new Transferts(); break }
    case 'sponsorings' : { obj =  new Sponsorings(); break }
    case 'chats' : { obj = new Chats(); break }
    case 'tickets' : { obj = new Tickets(); break }
    case 'groupes' : { obj = new Groupes(); break }
    case 'membres' : { obj =  new Membres(); break }
    case 'chatgrs' : { obj =  new Chatgrs(); break }
    }
    obj._nom = nom
    return obj
  }

  constructor (nom) { 
    const la = GenDoc._attrs[nom]
    this._nom = nom
    la.forEach(a => { this[a] = a !== '_data_' ? 0 : null })
  }

  init (d) {
    for (const c in d) this[c] = d[c]
    return this
  }

  /* Constitue un "row" depuis un objet:
    - en ignorant les attributs META (dont le nom commence par _)
    - en calculant les attributs calculés : iv ivb dhb icv
    - en produisant un _data_ null si l'objet n'a pas d'attributs NON META ou est _zombi
  */
  toRow () {
    const row = { _nom: this._nom }
    const la = this._attrs
    la.forEach(a => { if (a !== '_data_') row[a] = this[a] })
    /* le row est "zombi", c'est à dire sans _data_ quand,
    a) sa dlv est dépassée - mais il pouvait déjà l'être,
    b) son flag _zombi est à true
    Ca concerne :
    - les "versions" qui indiquent que leur groupe / avatar a disparu
    - les "notes" détruites (le row est conservé pour synchronisation)
    */
    const z = this.dlv && this.dlv <= ctx.auj
    if (!z && !this._zombi) {
      const d = {}
      for (const [key, value] of Object.entries(this)) if (!key.startsWith('_')) d[key] = value
      row._data_ = Buffer.from(encode(d))
    }
    return row
  }

  /** SQL **********************************************************************************/
  /* Retourne un insert statement SQL 
   Syntaxe : INSERT INTO matable (c1, c2) VALUES (@c1, @c2)
  */
  static _insStmt (nom) {
    const x = ['INSERT INTO ' + nom + ' (']
    const la = GenDoc._attrs[nom]
    x.push(la.join(', '))
    x.push(') VALUES (')
    const vals = []
    for(const c of la) vals.push('@' + c)
    x.push(vals.join(', '))
    x.push(')')
    return x.join('')
  }

  /* Retourne un update statement SQL 
   Syntaxe : UPDATE matable SET c1 = @c1, c2 = @c2 WHERE id = @id
  */
  static _updStmt (nom) {
    const vals = []
    const x = ['UPDATE ' + nom + ' SET ']
    const la = GenDoc._attrs[nom]
    for(const c of la) if (c !== 'id' && c!== 'ids') vals.push(c + ' = @' + c)
    x.push(vals.join(', '))
    x.push(' WHERE id = @id ')
    if (la.indexOf('ids') !== -1) x.push(' AND ids = @ids')
    return x.join('')
  }

  /* Retourne un delete statement SQL 
   Syntaxe : DELETE FROM matable WHERE id = @id
  */
  static _delStmt (nom) {
    const x = ['DELETE FROM ' + nom + ' WHERE id = @id ']
    const la = GenDoc._attrs[nom]
    if (la.indexOf('ids') !== -1) x.push(' AND ids = @ids')
    return x.join('')
  }

  /** Firestore *********************************************************************************/
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
  static async deleteRowsDoc (transaction, rows) {
    for (const row of rows) {
      const p = GenDoc._path(row._nom, row.id, row.ids)
      await transaction.delete(ctx.fs.doc(p))
    }
  }

  static deleteRowsSql (rows) {
    for (const row of rows) {
      const code = 'DEL' + row._nom
      const st = stmt(code, GenDoc._delStmt(row._nom))
      st.run(row) // row contient id et ids
    }
  }

  static async setSqlVdlv (id, dlv) {
    const st = stmt('UPDVDLV', 
      'UPDATE versions SET dlv = @dlv, _data_ = NULL WHERE id = @id')
    st.run({ id, dlv })
  }

  static async setDocVdlv (id, dlv) {
    const p = GenDoc._path('versions', id)
    const doc = await ctx.fs.get(p)
    const row = doc.data()
    row.dlv = dlv
    row._data_ = null
    doc.set(row)
  }

  static async setRowsDoc (transaction, rows) {
    for (const row of rows) {
      const b = row._nom === 'comptas'
      const la = GenDoc._attrs[row._nom]
      const r = {}
      la.forEach(a => {
        const x = row[a]
        if (b && a === '_data_') r[a] = x === undefined ? null : crypterSrv(x)
        else r[a] = x === undefined ?  null : x
      })
      if (majeurs.has(row._nom)) {
        const v = ('' + row.v).padStart(9, '0')
        r.id_v = row.id + v
        if (row.vcv !== undefined) {
          const vcv = ('' + row.vcv).padStart(9, '0')
          r.id_vcv = row.id + vcv  
        }
      }
      const p = GenDoc._path(row._nom, r.id, r.ids)
      await transaction.set(ctx.fs.doc(p), r)
    }
  }

  static insertRowsSql (rows) {
    for (const row of rows) {
      const la = GenDoc._attrs[row._nom]
      const code = 'INS' + row._nom
      const st = stmt(code, GenDoc._insStmt(row._nom))
      const r = {}
      const b = row._nom === 'comptas'
      la.forEach(a => {
        const x = row[a]
        if (b && a === '_data_') r[a] = x === undefined ? null : crypterSrv(x)
        else r[a] = x === undefined ?  null : x
      })
      st.run(r)
    }
  }

  static async updateRowsSql (rows) {
    for (const row of rows) {
      const la = GenDoc._attrs[row._nom]
      const code = 'UPD' + row._nom
      const st = stmt(code, GenDoc._updStmt(row._nom))
      const r = {}
      const b = row._nom === 'comptas'
      la.forEach(a => {
        const x = row[a]
        if (b && a === '_data_') r[a] = x === undefined ? null : crypterSrv(x)
        else r[a] = x === undefined ?  null : x
      })
      st.run(r)
    }
  }

  /* Retourne le row d'une collection de nom / id si sa version est postérieure à v
  */
  static async getSqlV(nom, id, v) {
    const code = 'SELV' + nom
    const st = stmt(code, 'SELECT * FROM ' + nom + '  WHERE id = @id AND v > @v')
    const row = st.get({ id : id, v: v })
    if (row) row._nom = nom
    return row
  }

  /* Retourne le row d'une collection de nom / id (sans version))
  */
  static async getSqlNV(nom, id) {
    const code = 'SELNV' + nom
    const st = stmt(code, 'SELECT * FROM ' + nom + '  WHERE id = @id')
    const row = st.get({ id : id})
    if (row) row._nom = nom
    return row
  }
  
  /* Retourne le row d'un objet d'une sous-collection nom / id / ids */
  static async getSql(nom, id, ids) {
    const code = 'SEL' + nom
    const st = stmt(code, 'SELECT * FROM ' + nom + '  WHERE id = @id AND ids = @ids')
    const row = st.get({ id : id, ids: ids })
    if (row) row._nom = nom
    return row
  }

  static async getSqlAvatarVCV(id, vcv) {
    const st = stmt('SELCV', 'SELECT * FROM avatars WHERE id = @id AND vcv > @vcv')
    const row = st.get({ id : id, vcv: vcv })
    if (row) {
      row._nom = 'avatars'
      return compile(row)
    }
    return null
  }

  static async getSqlChatVCV(id, ids, vcv) {
    const st = stmt('SELCHCV', 'SELECT * FROM chats WHERE id = @id AND ids = @ids AND vcv < @vcv')
    const row = st.get({ id : id, ids: ids, vcv: vcv })
    if (row) {
      row._nom = 'chats'
      return compile(row)
    }
    return null
  }

  static async getSqlRowTicketV(id, ids, v) {
    const st = stmt('SELTKV', 'SELECT * FROM tickets WHERE id = @id AND ids = @ids AND v > @v')
    const row = st.get({ id : id, ids: ids, v: v })
    if (row) {
      row._nom = 'tickets'
      return row
    }
    return null
  }

  static async getSqlMembreVCV(id, ids, vcv) {
    const st = stmt('SELMBCV', 'SELECT * FROM membres WHERE id = @id AND ids = @ids AND vcv < @vcv')
    const row = st.get({ id : id, ids: ids, vcv: vcv })
    if (row) {
      row._nom = 'membres'
      return compile(row)
    }
    return null
  }

  static async getSqlComptaHps1(hps1) {
    const st = stmt('SELHPS1', 'SELECT * FROM comptas WHERE hps1 = @hps1')
    const row = st.get({ hps1 })
    if (row) row._nom = 'comptas'
    return row
  }

  static async getSqlAvatarHpc(hpc) {
    const st = stmt('SELHPC', 'SELECT * FROM avatars WHERE hpc = @hpc')
    const row = st.get({ hpc })
    if (row) row._nom = 'avatars'
    return row
  }

  static async getSqlSponsoringIds(ids) {
    const st = stmt('SELSPIDS', 'SELECT * FROM sponsorings WHERE ids = @ids')
    const row = st.get({ ids })
    if (row) row._nom = 'sponsorings'
    return row
  }

  static async getSqlVersionsDlv(dlvmin, dlvmax) {
    const st = stmt('SELVDLV', 'SELECT id FROM versions WHERE dlv >= @dlvmin AND dlv <= @dlvmax')
    const rows = st.all({ dlvmin, dlvmax })
    const r = []
    if (rows) rows.forEach(row => { r.push(row.id)})
    return r
  }

  static async getSqlMembresDlv(dlvmax) {
    const st = stmt('SELMDLV', 'SELECT id, ids FROM membres WHERE dlv <= @dlvmax')
    const rows = st.all({ dlvmax })
    const r = []
    if (rows) rows.forEach(row => { r.push([row.id, row.ids])})
    return r
  }

  static async getSqlGroupesDfh(dfh) {
    const st = stmt('SELGDFH', 'SELECT id FROM groupes WHERE dfh > 0 AND dfh <= @dfh')
    const rows = st.all({ dfh })
    const r = []
    if (rows) rows.forEach(row => { r.push(row.id)})
    return r
  }

  /* Retourne la collection de nom 'nom' : pour avoir tous les espaces */
  static async collSql (nom) {
    const code = 'COLV' + nom
    const st = stmt(code, 'SELECT * FROM ' + nom)
    const rows = st.all({ })
    if (!rows) return []
    const r = []
    rows.forEach(row => {
      row._nom = nom
      r.push(row)
    })
    return r
  }

  /* Retourne la collection de nom 'nom' */
  static async collNsSql (nom, ns) {
    const ns1 = ns * d14
    const ns2 = (ns + 1) * d14
    const code = 'COLNS' + nom
    const st = stmt(code, 'SELECT * FROM ' + nom + ' WHERE id >= @ns1 AND ID < @ns2')
    const rows = st.all({ ns1, ns2 })
    if (!rows) return []
    const r = []
    rows.forEach(row => {
      row._nom = nom
      r.push(row)
    })
    return r
  }
  
  /* Retourne la sous-collection de 'nom' du document majeur id
  Si v est donnée, uniquement les documents de version supérieurs à v.
  */
  static async scollSql (nom, id, v) {
    const code = (v ? 'SCOLV' : 'SCOLB') + nom
    const st = stmt(code, 'SELECT * FROM ' + nom + ' WHERE id = @id' + (v ? ' AND v > @v' : ''))
    const rows = st.all({ id: id, v: v })
    if (!rows) return []
    const r = []
    rows.forEach(row => {
      row._nom = nom
      r.push(row)
    })
    return r
  }

  static async delScollSql (nom, id) {
    const code = 'DELSCOL'+ nom
    const st = stmt(code, 'DELETE FROM ' + nom + ' WHERE id = @id')
    const info = st.run({id : id})
    return info.changes
  }

  static async delAvGrSql (id) {
    const nom = ID.estGroupe(id) ? 'groupes' : 'avatars'
    const code = 'DELAVGR'+ nom
    const st = stmt(code, 'DELETE FROM ' + nom + ' WHERE id = @id')
    st.run({id : id})
  }

  /*
  Retourne LE row de la collection nom / id (sans version)
  */
  static async getDocNV (transaction, nom, id) {
    let row = null
    const p = GenDoc._path(nom, id)
    const dr = ctx.fs.doc(p) // dr: DocumentReference
    // ds: DocumentSnapshot N'EXISTE PAS TOUJOURS
    let ds
    if (transaction !== 'fake') {
      ds = await transaction.get(dr)
    } else {
      ds = await dr.get()
    }
    if (ds.exists) {
      row = ds.data()
      row._nom = nom
    }
    return row
  }

  /*
  Retourne LE row de la collection nom / id et de version > v
  */
  static async getDocV (transaction, nom, id, v) {
    let row = null
    if (v && majeurs.has(nom)) {
      const min = id + (''+v).padStart(9, '0')
      const max = id + '999999999'
      const q = ctx.fs.collection(nom).where('id_v', '>', min).where('id_v', '<', max)
      let qs
      if (transaction !== 'fake') {
        qs = await transaction.get(q) // qs: QuerySnapshot
      } else {
        qs = await q.get()
      }
      if (!qs.empty) row = qs.docs[0].data()
      if (row) row._nom = nom
      return row
    }
    const dr = ctx.fs.doc(nom + '/' + id)
    let ds
    if (transaction !== 'fake') {
      ds = await transaction.get(dr) // qs: QuerySnapshot
    } else {
      ds = await dr.get()
    }
    if (ds.exists) {
      row = ds.data()
      row._nom = nom
    }
    return row
  }

  /* Retourne LE row de la sous-collection nom / id / ids (SANS se préoccuper de la version) */
  static async getDoc (transaction, nom, id, ids) {
    let row = null
    const p = GenDoc._path(nom, id, ids)
    const dr = ctx.fs.doc(p) // dr: DocumentReference
    // ds: DocumentSnapshot N'EXISTE PAS TOUJOURS
    let ds
    if (transaction !== 'fake') {
      ds = await transaction.get(dr)
    } else {
      ds = await dr.get()
    }
    if (ds.exists) {
      row = ds.data()
      row._nom = nom
    }
    return row
  }

  /* 
  Retourne l'avatar si sa CV est PLUS récente que celle détenue en session (de version vcv)
  */
  static async getDocAvatarVCV (transaction, id, vcv) {
    const min = id + (''+vcv).padStart(9, '0')
    const max = id + '999999999'
    const q = ctx.fs.collection('avatars').where('id_vcv', '>', min).where('id_vcv', '<', max)
    const qs = await transaction.get(q)
    if (qs.empty) return null
    const row = qs.docs[0].data()
    row._nom = 'avatars'
    return compile(row)
  }

  /* 
  Retourne LE chat si sa CV est MOINS récente que celle détenue en session (de version vcv)
  */
  static async getDocChatVCV (transaction, id, ids, vcv) {
    const p = GenDoc._path('chats', id, ids)
    // INDEX simple sur chats vcv
    const q = ctx.fs.collection(p).where('vcv', '>', vcv)
    const qs = await transaction.get(q)
    let row = null
    if (!qs.empty) {
      for (const qds of qs.docs) { row = qds.data(); break }
    }
    if (!row) return null
    row._nom = 'chats'
    return compile(row)
  }

  /* 
  Retourne LE row ticket si sa version est plus récente que celle détenue en session (de version v)
  */
  static async getDocRowTicketV (transaction, id, ids, v) {
    const p = GenDoc._path('tickets', id, ids)
    // INDEX simple sur chats vcv
    const q = ctx.fs.collection(p).where('v', '>', v)
    const qs = await transaction.get(q)
    let row = null
    if (!qs.empty) {
      for (const qds of qs.docs) { row = qds.data(); break }
    }
    if (row) row._nom = 'tickets'
    return row
  }

  /* 
  Retourne LE membre si sa CV est MOINS récente que celle détenue en session (de version vcv)
  */
  static async getDocMembreVCV (transaction, id, ids, vcv) {
    const p = GenDoc._path('membres', id, ids)
    // INDEX simple sur membres vcv
    const q = ctx.fs.collection(p).where('vcv', '>', vcv)
    const qs = await transaction.get(q)
    let row = null
    if (!qs.empty) {
      for (const qds of qs.docs) { row = qds.data(); break }
    }
    if (!row) return null
    row._nom = 'membres'
    return compile(row)
  }

  static async getDocComptaHps1(transaction, hps1) {
    const p = GenDoc._collPath('comptas')
    // INDEX simple sur comptas hps1
    const q = ctx.fs.collection(p).where('hps1', '==', hps1)
    let qs
    if (transaction !== 'fake') {
      qs = await transaction.get(q)
    } else {
      qs = await q.get()
    }
    let row = null
    if (!qs.empty) {
      for (const qds of qs.docs) { row = qds.data(); break }
    }
    if (!row) return null
    row._nom = 'comptas'
    return row
  }

  static async getDocAvatarHpc(transaction, hpc) {
    const p = GenDoc._collPath('avatars')
    // INDEX simple sur avatars hpc
    const q = ctx.fs.collection(p).where('hpc', '==', hpc)
    let qs
    if (transaction !== 'fake') {
      qs = await transaction.get(q)
    } else {
      qs = await q.get()
    }
    let row = null
    if (!qs.empty) {
      for (const qds of qs.docs) { row = qds.data(); break }
    }
    if (!row) return null
    row._nom = 'avatars'
    return row
  }

  static async getDocSponsoringIds(transaction, ids) {
    // INDEX COLLECTION_GROUP sur sponsorings ids
    const q = ctx.fs.collectionGroup('sponsorings').where('ids', '==', ids)
    let qs
    if (transaction !== 'fake') {
      qs = await transaction.get(q)
    } else {
      qs = await q.get()
    }
    let row = null
    if (!qs.empty) {
      for (const qds of qs.docs) { row = qds.data(); break }
    }
    if (!row) return null
    row._nom = 'sponsorings'
    return row
  }

  /* Retourne l'array des ids des "versions" dont la dlv est entre min et max incluses */
  static async getDocVersionsDlv (dlvmin, dlvmax) {
    const p = GenDoc._collPath('versions')
    // INDEX simple sur versions dlv
    const q = ctx.fs.collection(p).where('dlv', '>=', dlvmin).where('dlv', '<=', dlvmax) 
    const qs = await q.get()
    const r = []
    if (!qs.empty) qs.forEach(qds => { r.push(qds.get('id'))})
    return r
  }

  /* Retourne l'array des ids des "membres" dont la dlv est inférieure ou égale à dlvmax */
  static async getDocMembresDlv (dlvmax) { 
    // INDEX COLECTION_GROUP sur membres dlv
    const q = ctx.fs.collectionGroup('membres').where('dlv', '<=', dlvmax) 
    const qs = await q.get()
    const r = []
    if (!qs.empty) qs.forEach(qds => { r.push([qds.get('id'), qds.get('ids')])})
    return r
  }

  /* Retourne l'array des ids des "groupes" dont la fin d'hébergement 
  est inférieure ou égale à dfh */
  static async getDocGroupesDfh(dfh) {
    const p = GenDoc._collPath('groupes')
    // INDEX simple sur groupes dfh
    const q = ctx.fs.collection(p).where('dfh', '>', 0).where('dfh', '<=', dfh) 
    const qs = await q.get()
    const r = []
    if (!qs.empty) qs.forEach(qds => { r.push(qds.get('id')) })
    return r
  }
  
  /* Retourne la collection 'nom' : pour la liste des espaces */
  static async collDoc (transaction, nom) {
    const p = GenDoc._collPath(nom)
    const q = ctx.fs.collection(p)
    const qs = await transaction.get(q)
    if (qs.empty) return []
    const rows = []
    for (const qds of qs.docs) { 
      const x = qds.data()
      x._nom = nom
      rows.push(x)
    }
    return rows
  }

  /* Retourne la collection 'nom' pour un ns donné  */
  static async collNsDoc (transaction, nom, ns) {
    const ns1 = ns * d14
    const ns2 = (ns + 1) * d14
    const p = GenDoc._collPath(nom)
    // INDEX simple sur les collections id (avatars, groupes, versions ...) ! PAS les sous-collections
    const q = ctx.fs.collection(p).where('id', '>=', ns1).where('id', '<', ns2) 
    let qs
    if (transaction) {
      qs = await transaction.get(q)
    } else {
      qs = await q.get()
    }
    if (qs.empty) return []
    const rows = []
    for (const qds of qs.docs) { 
      const x = qds.data()
      x._nom = nom
      rows.push(x)
    }
    return rows
  }
  
  /* 
  Retourne la sous-collection 'nom' du document majeur id
  Uniquement les documents de version supérieurs à v.
  Chargement des chats sponsorings notes membres
  */
  static async scollDoc (transaction, nom, id, v) {
    const p = GenDoc._collPath(nom, id)
    // INDEX simple sur (chats sponsorings notes membres chatgrs) v
    const q = ctx.fs.collection(p).where('v', '>', v)
    const qs = await transaction.get(q)
    if (qs.empty) return []
    const rows = []
    for (const qds of qs.docs) { 
      const x = qds.data()
      x._nom = nom
      rows.push(x)
    }
    return rows
  }

  static async delScollDoc (nom, id) {
    let n = 0
    const p = GenDoc._collPath(nom, id)
    const q = ctx.fs.collection(p)
    const qs = await q.get()
    if (!qs.empty) {
      for (const doc of qs.docs) { n++; doc.ref.delete() }
    }
    return n
  }

  static async delAvGrDoc (id) {
    const p = (ID.estGroupe(id) ? 'groupes/' : 'avatars/') + id
    await ctx.fs.doc(p).delete()
  }

  static async decrypt (row) {
    if (!row || row._nom !== 'comptas') return row
    const d = row._data_
    if (!d || d.length < 4) return row
    const dc = await decrypterSrv(d)
    row._data_ = dc
    return row
  }

  /* Appels de lecture UNIVERSELS */
  static async getV (transaction, nom, id, v) {
    let row
    if (ctx.sql) row = await GenDoc.getSqlV(nom, id, v)
    else row = await GenDoc.getDocV(transaction, nom, id, v)
    return row ? await GenDoc.decrypt(row) : null
  }

  static async getNV (transaction, nom, id) {
    let row
    if (ctx.sql) row = await GenDoc.getSqlNV(nom, id)
    else row = await GenDoc.getDocNV(transaction, nom, id)
    return row ? await GenDoc.decrypt(row) : null
  }

  static async get (transaction, nom, id, ids) {
    if (ctx.sql) return await GenDoc.getSql(nom, id, ids)
    else return await GenDoc.getDoc(transaction, nom, id, ids)
  }
}

export class Espaces extends GenDoc { constructor () { super('espaces') } }
export class Tickets extends GenDoc { constructor () { super('tickets') } }
export class Gcvols extends GenDoc { constructor () { super('gcvols') } }
export class Fpurges extends GenDoc {constructor () { super('fpurges') } }
export class Tribus extends GenDoc { constructor () { super('tribus') } }
export class Syntheses extends GenDoc { constructor () { super('syntheses') } }
export class Comptas extends GenDoc { constructor() { super('comptas') } }
export class Versions extends GenDoc { constructor() { super('versions') } }
export class Avatars extends GenDoc { constructor() { super('avatars') } }
export class Notes extends GenDoc { constructor() { super('notes') } }
export class Transferts extends GenDoc { constructor() { super('transferts') } }
export class Sponsorings extends GenDoc { constructor() { super('sponsorings') } }
export class Chats extends GenDoc { constructor() { super('chats') } }
export class Groupes extends GenDoc { 
  constructor() { super('groupes') }

  get anims () {
    const s = new Set()
    for (let im = 1; im < this.flags.length; im++) { 
      const f = this.flags[im]
      if ((f & FLAGS.AC) && (f & FLAGS.PA)) s.add(im) 
    }
    return s
  }

  get aActifs () {
    for (let im = 1; im < this.flags.length; im++) { 
      const f = this.flags[im]
      if (f & FLAGS.AC) return true 
    }
    return false
  }
}
export class Membres extends GenDoc { constructor() { super('membres') } }
export class Chatgrs extends GenDoc { constructor() { super('chatgrs') } }

/** Operation *****************************************************
authMode == 3 : SANS TOKEN, pings et accès non authentifiés (recherche phrase de sponsoring)
authMode == 2 : AVEC TOKEN, créations de compte. Elles ne sont pas authentifiées elles vont justement enregistrer leur authentification.
authMode == 1 : AVEC TOKEN, première connexion à un compte : this.rowComptas et this.compta sont remplis
authMode == 0 : AVEC TOKEN, cas standard, vérification de l'authentification, voire enregistrement éventuel

Une opération a deux phases :
- phase1 : traite les arguments reçus, désérialisation, etc
  L'argument est l'objet 'args' et le résultat du travail est dans 'args'
  La vérification d'authentification a été faite.
  Les abonnements aux objets majeurs sont faits (ils sont dans args.abPlus)
  L'état du server n'est pas modifé.
- phase2 : traitement transactionnel produisant un résultat
  - phase2 n'effectue QUE des lectures.
  - phase2 peut sortir en exception.
  - phase2 va produire :
    - le résultat voulu
    - une liste, facultative, de 'rows' à mettre à jour (et à synchroniser si SQL)
-Abonnements aux objets majeurs (SQL seulement)
  -abPlus : array des ids à ajouter aux abonnements : abonnements en fin de phase 1
  -abMoins : array des ids à désabonner: désabonnements après la phase 2 (après commit)
*/
export class Operation {
  constructor (nomop) { this.nomop = nomop, this.authMode = 0, this.lecture = false }

  /* Exécution de l'opération */
  async run (args) {
    if (!Operation.nex) Operation.nex = 1
    this.nex = Operation.nex++
    this.args = args
    if (this.authMode <= 2) { // Sinon ce sont des "pings" (echo, test erreur, pingdb, recherche phrase sponsoring)
      const t = args.token
      if (!t) throw assertKO('Operation-1', 100, ['token?'])
      try {
        this.authData = decode(b64ToU8(t))
      } catch (e) {
        throw assertKO('Operation-2', 100, [e.message])
      }
      if (this.authMode < 2) await this.auth() // this.session est OK
    }
    this.dh = Date.now()
    this.nl = 0
    this.ne = 0
    this.result = { dh: this.dh, sessionId: this.authData ? this.authData.sessionId : '666' }

    if (this.phase1) {
      this.phase = 1
      await this.phase1(args)
    }

    this.toInsert = []; this.toUpdate = []; this.toDelete = []; this.result2 = {}

    if (!this.result.KO && this.phase2) {
      if (ctx.sql) {

        if (this.session && args.abPlus && args.abPlus.length) {
          args.abPlus.forEach(id => { this.session.sync.plus(id) })
          args.abPlus.length = 0
        }

        try {
          stmt('begin', 'BEGIN').run()
          // reset DANS le traitement de la transaction qui peut boucler (??? pouvait ???)
          this.transaction = null
          this.toInsert = []; this.toUpdate = []; this.toDelete = []; this.result2 = {}
          this.phase = 2
          await this.phase2(this.args)
          if (!this.result2.KO) {
            if (this.toInsert.length) GenDoc.insertRowsSql(this.toInsert)
            if (this.toUpdate.length) GenDoc.updateRowsSql(this.toUpdate)
            if (this.toDelete.length) GenDoc.deleteRowsSql(this.toDelete)
          }
          stmt('commit', 'COMMIT').run()
        } catch (e) {
          stmt('rollback', 'ROLLBACK').run()
          throw e
        }

        if (!this.result2.KO) {
        // (A) suppressions éventuelles des abonnements
          if (this.session) {
            if (args.abMoins && args.abMoins.length) args.abMoins.forEach(id => { this.session.sync.moins(id) })
            if (args.abPlus && args.abPlus.length) args.abPlus.forEach(id => { this.session.sync.plus(id) })
          }
          // (B) envoi en synchronisation des rows modifiés
          const rows = []
          this.toUpdate.forEach(row => { if (syncs.has(row._nom)) rows.push(row) })
          this.toInsert.forEach(row => { if (syncs.has(row._nom)) rows.push(row) })
          if (rows.length) SyncSession.toSync(rows)
        }
      } else {

        await ctx.fs.runTransaction(async (transaction) => {
          // reset DANS le traitement de la transaction qui peut boucler
          this.transaction = transaction
          this.toInsert = []; this.toUpdate = []; this.toDelete = []; this.result2 = {}
          this.phase = 2
          await this.phase2(this.args)
          if (!this.result2.KO) {
            if (this.toInsert.length) await GenDoc.setRowsDoc(this.transaction, this.toInsert)
            if (this.toUpdate.length) await GenDoc.setRowsDoc(this.transaction, this.toUpdate)
            if (this.toDelete.length) await GenDoc.deleteRowsDoc(this.transaction, this.toDelete)
          }
        })

      }
    }

    /* Fin de l'opération :
    - (A) suppressions éventuelles des abonnements (sql seulement)
    - (B) envoi en synchronisation des rows modifiés (sql seulement)
    - (C) envoi en cache des objets majeurs mis à jour / supprimés
    - (D) finalisation du résultat (fusion résultats phase 1 / 2)
    */

    // (D) finalisation du résultat (fusion résultats phase 1 / 2)
    for(const prop in this.result2) { this.result[prop] = this.result2[prop] }
    this.result.nl = this.nl
    this.result.ne = this.ne + this.toInsert.length + this.toUpdate.length + this.toDelete.length
  
    if (!this.result.KO) {
      // (C) envoi en cache des objets majeurs modifiés / ajoutés / supprimés
      const updated = [] // rows mis à jour / ajoutés
      const deleted = [] // paths des rows supprimés
      this.toInsert.forEach(row => { if (majeurs.has(row._nom)) updated.push(row) })
      this.toUpdate.forEach(row => { if (majeurs.has(row._nom)) updated.push(row) })
      this.toDelete.forEach(row => { if (majeurs.has(row._nom)) deleted.push(row._nom + '/' + row.id) })
      Cache.update(this, updated, deleted)

      if (this.phase3) await this.phase3(this.args) // peut ajouter des résultas
    }

    return this.result
  }

  async org (ns) { return Cache.org(this, ns)}

  async getCheckpoint () { return Cache.getCheckpoint(this) }

  async setCheckpoint (op, obj) { return Cache.setCheckpoint(this, obj) }

  async delAvGr (id) {
    if (ctx.sql) await GenDoc.delAvGrSql(id); else await GenDoc.delAvGrDoc(id)
    this.ne++
  }

  async coll (nom) {
    const r = ctx.sql ? await GenDoc.collSql(nom) : await GenDoc.collDoc(this.transaction, nom)
    this.nl += r.length
    return r
  }

  async collNs (nom, ns) {
    const r = ctx.sql ? await GenDoc.collNsSql(nom, ns) : await GenDoc.collNsDoc(this.transaction, nom, ns)
    this.nl += r.length
    return r
  }

  async scoll (nom, id, v) {
    const r = ctx.sql ? await GenDoc.scollSql(nom, id, v) : await GenDoc.scollDoc(this.transaction, nom, id, v)
    this.nl += r.length
    return r
  }

  async delScoll (nom, id) {
    const n = ctx.sql ? await GenDoc.delScollSql(nom, id) : await GenDoc.delScollDoc(nom, id)
    this.ne += n
    return n
  }

  async getVersionsDlv (dlvmin, dlvmax) {
    const r = ctx.sql ? await GenDoc.getSqlVersionsDlv(dlvmin, dlvmax)
      : await GenDoc.getDocVersionsDlv(dlvmin, dlvmax)
    this.nl += r.length
    return r
  }

  async getMembresDlv (dlvmax) {
    const r = ctx.sql ? await GenDoc.getSqlMembresDlv(dlvmax)
      : await GenDoc.getDocMembresDlv(dlvmax)
    this.nl += r.length
    return r
  }

  async getGroupesDfh (dfh) {
    const r = ctx.sql ? await GenDoc.getSqlGroupesDfh(dfh)
      : await GenDoc.getDocGroupesDfh(dfh)
    this.nl += r.length
    return r
  }

  async getGcvols (ns) {
    const r = ctx.sql ? await GenDoc.collNsSql('gcvols', ns)
      : await GenDoc.collNsDoc(null, 'gcvols', ns)
    this.nl += r.length
    return r
  }

  async setVdlv (id, dlv) {
    if (ctx.sql) await GenDoc.setSqlVdlv(id, dlv)
    else await GenDoc.setDocVdlv(id, dlv)
    this.ne++
  }

  async getAvatarVCV (id, vcv) {
    const r = ctx.sql ? await GenDoc.getSqlAvatarVCV(id, vcv)
      : await GenDoc.getDocAvatarVCV(this.transaction, id, vcv)
    if (r) this.nl++
    return r
  }

  async getChatVCV (id, ids, vcv) {
    const r = ctx.sql ? await GenDoc.getSqlChatVCV(id, ids, vcv)
      : await GenDoc.getDocChatVCV(this.transaction, id, ids, vcv)
    if (r) this.nl++
    return r
  }

  async getRowTicketV (id, ids, v) {
    const r = ctx.sql ? await GenDoc.getSqlRowTicketV(id, ids, v)
      : await GenDoc.getDocRowTicketV(this.transaction, id, ids, v)
    if (r) this.nl++
    return r
  }

  async getMembreVCV (id, ids, vcv) {
    const r = ctx.sql ? await GenDoc.getSqlMembreVCV(id, ids, vcv)
      : await GenDoc.getDocMembreVCV(this.transaction, id, ids, vcv)
    if (r) this.nl++
    return r
  }

  async getAvatarHpc (hpc) {
    const r = ctx.sql ? await GenDoc.getSqlAvatarHpc(hpc)
      : await GenDoc.getDocAvatarHpc(this.transaction, hpc)
    if (r) this.nl++
    return r
  }

  async getComptaHps1 (hps1, fake) {
    const r = ctx.sql ? await GenDoc.getSqlComptaHps1(hps1)
      : await GenDoc.getDocComptaHps1(fake ? 'fake' : this.transaction, hps1)
    if (r) this.nl++
    return GenDoc.decrypt(r)    
  }

  async getSponsoringIds (ids) {
    const r = ctx.sql ? await GenDoc.getSqlSponsoringIds(ids)
      : await GenDoc.getDocSponsoringIds(this.transaction, ids)
    if (r) this.nl++
    return r    
  }

  async getAllRowsEspace () {
    return await this.coll('espaces')
  }

  async getRowEspace (id, assert) {
    const tr = await Cache.getRow(this, 'espaces', id)
    if (assert && !tr) throw assertKO('getRowEspace/' + assert, 1, [id])
    return tr
  }

  async getAllRowsTribu () {
    const r = ctx.sql ? await GenDoc.collNsSql('tribus', this.session.ns)
      : await GenDoc.collNsDoc(this.transaction, 'tribus', this.session.ns)
    this.ns += r.length
    return r
  }

  async getRowTribu (id, assert) {
    const tr = await Cache.getRow(this, 'tribus', id)
    if (assert && !tr) throw assertKO('getRowTribu/' + assert, 2, [id])
    return tr
  }

  async getRowSynthese (id, assert) {
    const tr = await Cache.getRow(this, 'syntheses', id)
    if (assert && !tr) throw assertKO('getRowSynthese/' + assert, 16, [id])
    return tr
  }

  async getRowCompta (id, assert) {
    const cp = await Cache.getRow(this, 'comptas', id)
    if (assert && !cp) throw assertKO('getRowCompta/' + assert, 3, [id])
    return cp
  }

  async getRowVersion (id, assert, nonZombi) {
    const v = await Cache.getRow(this, 'versions', id)
    if ((assert && !v) || (nonZombi && v && v.dlv && v.dlv <= ctx.auj))
      throw assertKO('getRowVersion/' + assert, 14, [id])
    return v
  }

  async getRowAvatar (id, assert) {
    const av = await Cache.getRow(this, 'avatars', id)
    if (assert && !av) throw assertKO('getRowAvatar/' + assert, 8, [id])
    return av
  }

  async getRowGroupe (id, assert) {
    const rg = await Cache.getRow(this, 'groupes', id)
    if (assert && !rg) throw assertKO('getRowGroupe/' + assert, 9, [id])
    return rg
  }

  async getAllRowsNote(id, v) {
    return await this.scoll('notes', id, v)
  }

  async getRowNote (id, ids, assert) {
    const rs = await GenDoc.get(this.transaction, 'notes', id, ids)
    if (assert && !rs) throw assertKO('getRowNote/' + assert, 7, [id, ids])
    if (rs) this.nl++
    return rs
  }

  async getAllRowsChat(id, v) {
    return await this.scoll('chats', id, v)
  }

  async getRowChat (id, ids, assert) {
    const rc = await GenDoc.get(this.transaction, 'chats', id, ids)
    if (assert && !rc) throw assertKO('getRowChat/' + assert, 12, [id, ids])
    if (rc) this.nl++
    return rc
  }

  async getAllRowsTicket(id, v) {
    return await this.scoll('tickets', id, v)
  }

  async getRowTicket (id, ids, assert) {
    const rc = await GenDoc.get(this.transaction, 'tickets', id, ids)
    if (assert && !rc) throw assertKO('getRowTicket/' + assert, 17, [id, ids])
    if (rc) this.nl++
    return rc
  }

  async getAllRowsSponsoring(id, v) {
    return await this.scoll('sponsorings', id, v)
  }

  async getRowSponsoring (id, ids, assert) {
    const rs = await GenDoc.get(this.transaction, 'sponsorings', id, ids)
    if (assert && !rs) throw assertKO('getRowSponsoring/' + assert, 13, [id, ids])
    if (rs) this.nl++
    return rs
  }

  async getAllRowsMembre(id, v) {
    return await this.scoll('membres', id, v)
  }

  async getAllRowsChatgr(id, v) {
    return await this.scoll('chatgrs', id, v)
  }

  async getRowMembre (id, ids, assert) {
    const rm = await GenDoc.get(this.transaction, 'membres', id, ids)
    if (assert && !rm) throw assertKO('getRowMembre/' + assert, 10, [id, ids])
    if (rm) this.nl++
    return rm
  }

  async getRowChatgr (id, assert) {
    const rc = await GenDoc.get(this.transaction, 'chatgrs', id, 1)
    if (assert && !rc) throw assertKO('getRowChatgr/' + assert, 10, [id, 1])
    if (rc) this.nl++
    return rc
  }

  async setFpurge (idag, lidf) {
    const x = rnd6()
    const ns = ID.ns(idag)
    const id = (ns * d14) + (x % d14)
    const _data_ = new Uint8Array(encode({ id, idag, lidf }))
    if (!ctx.sql) {
      const p = GenDoc._path('fpurges', id)
      await this.transaction.set(ctx.fs.doc(p), { id, _data_})
    } else {
      const st = stmt('INSFPURGE', 'INSERT INTO fpurges (id, _data_) VALUES (@id, @_data_)')
      st.run({ id, _data_ })
    }
    this.ne++
    return id
  }

  async unsetFpurge (id) {
    if (!ctx.sql) {
      const p = GenDoc._path('fpurges', id)
      await ctx.fs.doc(p).delete()
    } else {
      const st = stmt('DELFPURGE', 'DELETE FROM fpurges WHERE id = @id')
      st.run({ id })
    }
    this.ne++
  }

  async listeFpurges () {
    const r = []
    if (!ctx.sql) {
      const p = GenDoc._collPath('fpurges')
      const q = ctx.fs.collection(p)
      const qs = await q.get()
      if (!qs.empty) {
        for (const qds of qs.docs) { 
          const row = qds.data()
          r.push(decode(row._data_))
        }
      }
    } else {
      const st = stmt('SELFPURGES', 'SELECT _data_ FROM fpurges')
      const rows = st.all({ })
      if (rows) rows.forEach(row => {
        r.push(decode(row._data_))
      })
    }
    this.nl += r.length
    return r
  }

  async listeTransfertsDlv (dlv) {
    const r = []
    if (!ctx.sql) {
      const p = GenDoc._collPath('transferts')
      const q = ctx.fs.collection(p).where('dlv', '<=', dlv)
      const qs = await q.get()
      if (!qs.empty) {
        for (const qds of qs.docs) { 
          const row = qds.data()
          r.push([row.id, row.ids]) // row: id, ids (idf), dlv}
        }
      }
    } else {
      const st = stmt('SELTRADLV', 'SELECT * FROM transferts WHERE dlv <= @dlv')
      const rows = st.all({ dlv })
      if (rows) rows.forEach(row => {
        r.push([row.id, row.ids])
      })
    }
    this.nl += r.length
    return r
  }

  async purgeTransferts (id, ids) {
    if (!ctx.sql) {
      const p = GenDoc._path('transferts', id, ids)
      await ctx.fs.doc(p).delete()
    } else {
      const st = stmt('DELTRA', 'DELETE FROM transferts WHERE id = @id AND ids = @ids')
      st.run({ id, ids })
    }
    this.ne++
  }

  async purgeDlv (nom, dlv) { // nom: sponsorings, versions
    let n = 0
    if (!ctx.sql) {
      const p = GenDoc._collPath(nom)
      const q = ctx.fs.collection(p).where('dlv', '<=', dlv)
      const qs = await q.get()
      if (!qs.empty) {
        for (const doc of qs.docs) { n++; doc.ref.delete() }
      }
    } else {
      const st = stmt('DELDLV' + nom, 'DELETE FROM ' + nom + ' WHERE dlv <= @dlv')
      const info = st.run({ dlv })
      n = info.changes
    }
    this.ne += n
    return n
  }

  /* Fixe LA valeur de la propriété 'prop' du résultat (et la retourne)*/
  setRes(prop, val) {
    const r = this.phase === 1 ? this.result : this.result2
    r[prop] = val
    return val
  }

  /* AJOUTE la valeur en fin de la propriété Array 'prop' du résultat (et la retourne)*/
  addRes(prop, val) {
    const r = this.phase === 1 ? this.result : this.result2
    let l = r[prop]; if (!l) { l = []; r[prop] = l }
    l.push(val)
    return val
  }
  
  /* Inscrit row dans les rows à insérer en phase finale d'écritue, juste après la phase2 */
  insert (row) {
    this.toInsert.push(row)
    return row
  }

  /* Inscrit row dans les rows à mettre à jour en phase finale d'écritue, juste après la phase2 */
  update (row) {
    this.toUpdate.push(row)
    return row
  }

  /* Inscrit row dans les rows à détruire en phase finale d'écritue, juste après la phase2 */
  delete (row) {
    if (row) this.toDelete.push(row)
    return row
  }

  async nvChat (args, xavatarE, xavatarI) {
    /*
    xavatarI et xavatarE : depuis AcceptionSponsoring
    - `idI idsI` : id du chat, côté _interne_.
    - `idE idsE` : id du chat, côté _externe_.
    - `ccKI` : clé cc du chat cryptée par la clé K du compte de I.
    - `ccPE` : clé cc cryptée par la clé **publique** de l'avatar E.
    - `naccI` : [nomI, cleI] crypté par la clé cc
    - `naccE` : [nomE, cleE] crypté par la clé cc
    - `txt1` : texte 1 du chat crypté par la clé cc.
    - `lgtxt1` : longueur du texte 1 du chat.
    - `txt2` : texte 2 du chat crypté par la clé cc.
    - `lgtxt2` : longueur du texte 2 du chat.
    */
    const avatarE = xavatarE || compile(await this.getRowAvatar(args.idE))
    if (!avatarE) return null

    const dh = Date.now()
    const itemsI = []
    itemsI.push({ a: 0, dh, txt: args.txt1, l: args.lgtxt1 })
    if (args.txt2) itemsI.push({ a: 1, dh: Date.now(), txt: args.txt2, l: args.lgtxt2 })

    const itemsE = []
    itemsE.push({ a: 1, dh, txt: args.txt1, l: args.lgtxt1 })
    if (args.txt2) itemsE.push({ a: 0, dh: Date.now(), txt: args.txt2, l: args.lgtxt2 })

    const cvE = avatarE.cva
    const vcvE = avatarE.vcv

    const avatarI = xavatarI || compile(await this.getRowAvatar(args.idI, 'NouveauChat-1'))
    const cvI = avatarI.cva
    const vcvI = avatarI.vcv

    let rowChatI = await this.getRowChat(args.idI, args.idsI)

    if (!rowChatI) {
      // cas normal : chatI n'existe pas
      let vI = 1
      if (!xavatarI) {
        // Depuis AcceptationSponsoring version I vient d'être créee
        const versionI = compile(await this.getRowVersion(args.idI, 'NouveauChat-5', true))
        versionI.v++
        vI = versionI.v
        this.update(versionI.toRow())
      }
      const chatI = new Chats().init({
        id: args.idI,
        ids: args.idsI,
        v: vI,
        vcv: vcvE,
        st: 10,
        cc: args.ccKI,
        nacc: args.naccE,
        cva: cvE || null,
        items: itemsI
      })
      rowChatI = this.insert(chatI.toRow())

      const versionE = compile(await this.getRowVersion(args.idE, 'NouveauChat-2', true))
      versionE.v++
      this.update(versionE.toRow())
      const chatE = new Chats().init({
        id: args.idE,
        ids: args.idsE,
        v: versionE.v,
        vcv: vcvI,
        st: 1,
        cc: args.ccPE,
        nacc: args.naccI,
        cva: cvI || null,
        items: itemsE
      })
      this.insert(chatE.toRow())

      this.setRes('st', 1)
      this.setRes('rowChat', rowChatI)

      if (!xavatarI) { // Si AcceptatinSponsoring, le nombre de chats est déjà fixé
        const compta = compile(await this.getRowCompta(this.session.id, 'majNbChat-1'))
        compta.v++
        compta.qv.nc += 1
        const c = new Compteurs(compta.compteurs, compta.qv)
        compta.compteurs = c.serial
        this.update(compta.toRow())
      }
    } else {
      // chatI existe création croisée malencontreuse 
      // soit par l'avatar E, soit par une autre session de I
      this.setRes('st', 2)
      this.setRes('rowChat', rowChatI)
    }
    return rowChatI
  }

  addChatgrItem (items, item) {
    const nl = [item]
    let lg = item.l
    for (const it of items) {
      lg += it.l
      if (lg > 5000) return nl
      nl.push(it)
    }
    return nl
  }

  razChatgrItem (items, im, dh) { 
    const nl = []
    let lg = 0
    for (const it of items) {
      if (it.dh === dh && it.im === im) {
        nl.push({im: it.im, l: 0, dh, dhx: Date.now()})
      } else {
        lg += it.l
        if (lg > 5000) return nl
        nl.push(it)
      }
    }
    return nl
  }

  addChatItem (items, item) {
    const nl = [item]
    let lg = item.l
    for (const it of items) {
      lg += it.l
      if (lg > 5000) return nl
      nl.push(it)
    }
    return nl
  }

  razChatItem (items, dh) { 
    // a : 0:écrit par I, 1: écrit par E
    const nl = []
    let lg = 0
    for (const it of items) {
      if (it.dh === dh) {
        nl.push({a: it.a, l: 0, dh, dhx: Date.now()})
      } else {
        lg += it.l
        if (lg > 5000) return nl
        nl.push(it)
      }
    }
    return nl
  }

  /* Met à jour les volumes du groupe TODO
  Refuse si le volume est ex expansion et qu'il dépasse le quota
  L'objet version du groupe est mis à jour et retourné
  */
  async majVolumeGr (idg, dv1, dv2, maj, assert) {
    const vg = compile(await this.getRowVersion(idg, assert))
    if (dv1 > 0 && vg.vols.v1 + dv1 > vg.vols.q1 * UNITEV1) 
      throw new AppExc(F_SRV, 65, [edvol(vg.vols.v1 + dv1), edvol(vg.vols.q1 * UNITEV1)])
    if (dv2 > 0 && vg.vols.v2 + dv2 > vg.vols.q2 * UNITEV2) 
      throw new AppExc(F_SRV, 65, [edvol(vg.vols.v2 + dv2), edvol(vg.vols.q2 * UNITEV2)])
    if (dv1 !== 0) vg.vols.v1 += dv1
    if (dv2 !== 0) vg.vols.v2 += dv2
    if (maj) {
      vg.v++
      this.update(vg.toRow())
    }
    return vg
  }

  /* Maj des compteurs de comptas
    Objet quotas et volumes `qv` : `{ qc, q1, q2, nn, nc, ng, v2 }`
    - `qc`: quota de consommation
    - `q1`: quota du nombre total de notes / chats / groupes.
    - `q2`: quota du volume des fichiers.
    - `nn`: nombre de notes existantes.
    - `nc`: nombre de chats existants.
    - `ng` : nombre de participations aux groupes existantes.
    - `v2`: volume effectif total des fichiers.
  */
  async diminutionVolumeCompta (idc, dnn, dnc, dng, dv2, assert) {
    const compta = compile(await this.getRowCompta(idc, assert))
    const qv = compta.qv
    qv.nn -= dnn
    qv.nc -= dnc
    qv.ng -= dng
    qv.v2 -= dv2
    const ser = new Compteurs(compta.compteurs, qv).serial
    compta.v++
    compta.compteurs = ser
    this.update(compta.toRow())
  }

  async augmentationVolumeCompta (idc, dnn, dnc, dng, dv2, assert) {
    const compta = compile(await this.getRowCompta(idc, assert))
    const qv = compta.qv
    qv.nn += dnn
    qv.nc += dnc
    qv.ng += dng
    const v1 = qv.nn + qv.nc + qv.ng
    if (v1 > qv.q1 * UNITEV1) throw new AppExc(F_SRV, 55, [v1, qv.q1])
    qv.v2 += dv2
    if (qv.v2 > qv.q2 * UNITEV2) throw new AppExc(F_SRV, 56, [qv.v2, qv.q2])
    const ser = new Compteurs(compta.compteurs, qv).serial
    compta.v++
    compta.compteurs = ser
    this.update(compta.toRow())
  }

  /* lcSynt = ['qc', 'q1', 'q2', 'ac', 'a1', 'a2', 'cj', 
  'v1', 'v2', 'ntr0', 'ntr1', 'ntr2', 'nbc', 'nbsp', 'nco0', 'nco1', 'nco2']
  */
  /* Mise à jour de Synthese suite à une mise à jour d'une tribu */
  async MajSynthese (tribu, noupd) {
    let synt = this.synt
    if (!synt) {
      synt = compile(await this.getRowSynthese(ID.ns(tribu.id), 'MajSynthese'))
      this.synt = synt
    }
    const idx = ID.court(tribu.id)
    const x = {}
    lcSynt.forEach(f => { x[f] = 0 })
    x.qc = tribu.qc || 0
    x.q1 = tribu.q1 || 0
    x.q2 = tribu.q2 || 0
    x.ntr0 = tribu.stn === 0 ? 1 : 0
    x.ntr1 = tribu.stn === 1 ? 1 : 0
    x.ntr2 = tribu.stn === 2 ? 1 : 0
    for (let i = 0; i < tribu.act.length; i++) {
      const c = tribu.act[i]
      if (c && !c.vide) {
        x.ac += c.qc || 0
        x.a1 += c.q1 || 0
        x.a2 += c.q2 || 0
        x.ca += c.ca || 0
        x.v1 += c.v1 || 0
        x.v2 += c.v2 || 0
        x.nbc++
        if (c.nasp) x.nbsp++
        if (c.stn === 0) x.nco0++
        if (c.stn === 1) x.nco1++
        if (c.stn === 2) x.nco2++
      }
    }
    const n = idx - synt.atr.length + 1
    if (n > 0) for (let i = 0; i < n; i++) synt.atr.push(null)
    synt.atr[idx] = encode(x)
    if (!noupd) {
      synt.v = Date.now()
      this.update(synt.toRow())
    }
  }

  /* Authentification ******************************************************************
  authMode == 1 : première connexion à un compte
  authMode == 0 : cas standard, vérification de l'authentification, voire enregistrement éventuel

  **En mode SQL**, un WebSocket a été ouvert avec une sessionId : 
  dans tous les cas, même les opérations qui n'ont pas à être authentifiées, 
  doivent porter un token pourtant sessionId afin de vérifier l'existence du socket ouvert.

  Toute opération porte un `token` portant lui-même un `sessionId`, 
  un numéro de session tiré au sort par la session et qui change à chaque déconnexion.
  - si le serveur retrouve dans la mémoire cache l'enregistrement de la session `sessionId` :
    - il en obtient l'id du compte,
    - il prolonge la `ttl` de cette session dans cette cache.
  - si le serveur ne trouve pas la `sessionId`, 
    - soit il y en bien une mais dans une autre instance, 
    - soit c'est une déconnexion pour dépassement de `ttl` de cette session.
    Dans les deux cas l'authentification va être refaite avec le `token` fourni.

  **`token`**
  - `sessionId`
  - `shax` : SHA de X, le PBKFD de la phrase complète.
  - `hps1` : hash du PBKFD de la ligne 1 de la phrase secrète.

  Le serveur recherche l'id du compte par `hps1` (index de `comptas`)
  - vérifie que le SHA de `shax` est bien celui enregistré dans `comptas` en `shay`.
  - inscrit en mémoire `sessionId` avec l'id du compte et un `ttl`.
  
  Pour une connexion, auth() positionne TOUJOURS dans le this de l'opération:
  - compta: l'objet compilé correspondant
  */
  async auth () {
    const s = AuthSession.get(this.authData.sessionId, this.lecture)
    if (!this.authMode && s) {
      // la session est connue dans l'instance, OK
      this.session = s
      this.ttl = Date.now() + AuthSession.ttl
      if (this.session.sync) this.session.sync.pingrecu()
      return 
    } 

    if (this.authData.shax) { // admin
      const shax64 = Buffer.from(this.authData.shax).toString('base64')
      if (ctx.config.admin.indexOf(shax64) !== -1) {
        // session admin authentifiée
        this.session = AuthSession.set(this.authData.sessionId, 0, true)
        return
      }
      await sleep(3000)
      throw new AppExc(F_SRV, 101) // pas reconnu
    }

    const rowCompta = await this.getComptaHps1(this.authData.hps1, true)
    if (!rowCompta) { await sleep(3000); throw new AppExc(F_SRV, 101) }
    this.compta = compile(rowCompta)
    if (this.compta.hpsc !== this.authData.hpsc) throw new AppExc(F_SRV, 101)
    this.session = AuthSession.set(this.authData.sessionId, this.compta.id, this.lecture)
  }
}

export class AuthSession {
  static map = new Map()

  static dernierePurge = 0

  static ttl = PINGTO * 60000 * 10 // en test éviter les peres de session en debug TODO

  constructor (sessionId, id, sync) { 
    this.sessionId = sessionId
    this.id = id
    this.ns = Math.floor(this.id / d14)
    this.sync = sync
    this.ttl = Date.now() + AuthSession.ttl
  }

  setEspace (noExcFige) {
    if (!this.id) return this
    const esp = Cache.getEspaceLazy(this.ns)
    this.notifG = null
    if (!esp) { 
      this.notifG = {
        nr: 2,
        texte: 'Organisation inconnue', 
        dh: Date.now()
      }
    } else this.notifG = esp.notif
    if (this.notifG && this.notifG.nr === 2) throw AppExc.notifG(this.notifG)
    if (this.notifG && this.notifG.nr === 1) this.estFige = true
    if (noExcFige || !this.estFige) return this
    throw AppExc.notifG(this.notifG)
  }

  // Retourne la session identifiée par sessionId et en prolonge la durée de vie
  static get (sessionId, noExcFige) {
    const t = Date.now()
    if (t - AuthSession.dernierePurge > AuthSession.ttl / 10) {
      AuthSession.map.forEach((s, k) => {
        if (t > s.ttl) AuthSession.map.delete(k)
      })
    }
    const s = AuthSession.map.get(sessionId)
    if (s) {
      s.setEspace(noExcFige)
      s.ttl = t + AuthSession.ttl
      if (s.sync) s.sync.pingrecu()
      return s
    }
    return false
  }

  // Enregistre la session avec l'id du compte de la session
  static set (sessionId, id, noExcFige) {
    let sync = null
    if (ctx.sql) {
      sync = SyncSession.get(sessionId)
      if (!sync) throw new AppExc(E_SRV, 4)
      if (id) sync.setCompte(id)
      sync.pingrecu()
    }
    const s = new AuthSession(sessionId, id, sync).setEspace(noExcFige)
    AuthSession.map.set(sessionId, s)
    s.ttl = Date.now() + AuthSession.ttl
    return s
  }
}
