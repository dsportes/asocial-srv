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
import { AMJ, ID, PINGTO, AppExc, A_SRV, E_SRV, F_SRV, Compteurs, UNITEV1, UNITEV2, d14, edvol, lcSynt } from './api.mjs'
import { ctx } from './server.js'
import { SyncSession } from './ws.mjs'
import { rnd6, sleep, b64ToU8 } from './util.mjs'
import { GenDoc, compile, Chats } from './gendoc.mjs'

export function trace (src, id, info, err) {
  const msg = `${src} - ${id} - ${info}`
  /*
  const t = new Date().toISOString()
  if (err) console.error(t + ' ' + msg); else console.log(t + ' ' +  msg)
  */
  if (err) ctx.logger.error(msg); else ctx.logger.info(msg)
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

/* Cache ************************************************************************
Cache des objets majeurs "tribus comptas avatars groupes" 
*/

class Cache {
  static MAX_CACHE_SIZE = 1000

  static map = new Map()

  static checkpoint = { id: 1, v: 0, _data_: null }

  static orgs = new Map() // clé: ns, value: org

  static orgs2 = new Map() // clé: org, value: ns

  static setNsOrg (ns, org) {
    Cache.orgs.set(ns, org)
    Cache.orgs2.set(org, ns)
  }

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
      const n = await op.db.getV(op, nom, id, x.row.v)
      x.lru = Date.now()
      if (n && n.v > x.row.v) x.row = n // une version plus récente existe : mise en cache
      if (x.row._nom === 'espaces' && !Cache.orgs.has(x.row.id))
        Cache.setNsOrg(x.row.id, x.row.org)
      return x.row
    }
    const n = await op.db.getV(op, nom, id, 0)
    if (n) { // dernière version si elle existe
      const y = { lru: Date.now(), row: n }
      this.map.set(k, y)
    }
    if (n && n._nom === 'espaces' && !Cache.orgs.has(n.id))
      Cache.setNsOrg(n.id, n.org)
    return n
  }

  static opFake = { fake: true, nl: 0, ne: 0 }

  /* Retourne l'espace depuis celui détenu en cache
  C'est seulement s'il a plus de PINGTO minutes d'âge qu'on vérifie sa version
  et qu'on la recharge le cas échéant.
  PAR PRINCIPE, elle est retardée: convient pour checker une restriction éventuelle
  */
  static async getEspaceLazy (op, ns) {
    const now = Date.now()
    const k = 'espaces/' + ns
    let x = Cache.map.get(k)
    if (x) {
      if ((now - x.lru) > PINGTO * 60000) {
        // Le row connu a plus de 5 minutes - if faut revérifier la version
        const e = await op.db.getV(Cache.opFake, 'espaces', ns, x.row.v)
        if (e) x.row = e
        x.lru = now
        if (!Cache.orgs.has(x.row.id)) Cache.setNsOrg(x.row.id, x.row.org)
      }
    } else {
      const e = await op.db.getV(Cache.opFake, 'espaces', ns, 0)
      if (!e) return null
      x = { lru: Date.now(), row: e }
      Cache.map.set(k, x)
    }
    if (!Cache.orgs.has(x.row.id)) Cache.setNsOrg(x.row.id, x.row.org)
    return compile(x.row)
  }

  static async getEspaceOrg (op, org) {
    let ns = Cache.orgs2.get(org)
    if (ns) return await Cache.getEspaceLazy(op, ns)
    const row = await op.db.getEspaceOrg(op, org)
    if (!row) return null
    ns = row.id
    Cache.map.set('espaces/' + ns, { lru: Date.now(), row: row })
    Cache.setNsOrg(row.id, row.org)
    return compile(row)
  }

  /*
  Enrichissement de la cache APRES le commit de la transaction avec
  tous les rows créés, mis à jour ou accédés (en ayant obtenu la "dernière")
  */
  static update (newRows, delRowPaths) { // set des path des rows supprimés
    for(const row of newRows) {
      if (GenDoc.sousColls.has(row._nom)) continue
      const k = row._nom + '/' + row.id
      const x = Cache.map.get(k)
      if (x) {
        if (x.row.v < row.v) x.row = row
      } else {
        this.map.set(k, { lru: Date.now(), row: row })
      }
      if (row._nom === 'espaces' && !Cache.orgs.has(row.id))
        Cache.setNsOrg(row.id, row.org)
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

  /* Retourne le dernier checkpoint enregistré parle GC.*/
  static async getCheckpoint (op) { 
    const x = await op.db.getCheckpoint(op, Cache.checkpoint.v)
    if (x) {
      Cache.checkpoint.v = x.v
      Cache.checkpoint._data_ = x._data_
    }
    return Cache.checkpoint._data_ ? decode(Cache.checkpoint._data_) : { v: 0 }
  }

  /* Enregistre en base et dans Cache le dernier objet de checkpoint défini par le GC.*/
  static async setCheckpoint (op, obj) {
    const x = obj || { v: 0 }
    x.v = Date.now()
    const _data_ = new Uint8Array(encode(x))
    const ins = !Cache.checkpoint._data_
    await op.db.setCheckpoint (op, x.v, _data_, ins)
    Cache.checkpoint.v = x.v
    Cache.checkpoint._data_ = _data_
  }

  /* Retourne le code de l'organisation pour un ns donné.*/
  static async org (op, id) { 
    const ns = id < 100 ? id : ID.ns(id)
    const org = Cache.orgs.get(ns)
    if (org) return org
    const row = await op.db.org(op, ns)
    if (row) {
      Cache.update([row], [])
      return row.org
    }
    return null
  }
}

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
  constructor (nomop) { 
    this.nomop = nomop; this.authMode = 0; this.lecture = false 
  }

  /* Exécution de l'opération */
  async run (args) {
    this.db = ctx.db
    this.storage = ctx.storage
    this.auj = AMJ.amjUtc()
    if (!Operation.nex) Operation.nex = 1
    this.nex = Operation.nex++
    this.args = args
    if (this.authMode <= 2) { // Sinon ce sont des "pings" (echo, test erreur, pingdb, recherche phrase sponsoring)
      const t = args.token
      if (!t) throw assertKO('Operation-1', 100, ['token?' + this.nomop])
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
    this.toInsert = []; this.toUpdate = []; this.toDelete = []

    if (this.phase1) {
      this.phase = 1
      await this.phase1(args)
    }

    if (!this.result.KO && this.phase2) {

      if (this.db.hasWS && this.session && args.abPlus && args.abPlus.length) {
        args.abPlus.forEach(id => { this.session.sync.plus(id) })
        args.abPlus.length = 0
      }

      await this.db.doTransaction(this)

      /* Fin de l'opération :
      - (A) suppressions éventuelles des abonnements (sql seulement)
      - (B) envoi en synchronisation des rows modifiés (sql seulement)
      */

      if (!this.result2.KO && this.db.hasWS) {
        // (A) suppressions éventuelles des abonnements
        if (this.session) {
          if (args.abMoins && args.abMoins.length) args.abMoins.forEach(id => { this.session.sync.moins(id) })
          if (args.abPlus && args.abPlus.length) args.abPlus.forEach(id => { this.session.sync.plus(id) })
        }
        // (B) envoi en synchronisation des rows modifiés
        const rows = []
        this.toUpdate.forEach(row => { if (GenDoc.syncs.has(row._nom)) rows.push(row) })
        this.toInsert.forEach(row => { if (GenDoc.syncs.has(row._nom)) rows.push(row) })
        if (rows.length) SyncSession.toSync(rows)
      }
    } else {
      this.result2 = null
    }

    /* Fin de l'opération :
    - (C) envoi en cache des objets majeurs mis à jour / supprimés
    - (D) finalisation du résultat (fusion résultats phase 1 / 2)
    */

    // (D) finalisation du résultat (fusion résultats phase 1 / 2)
    if (this.result2) for(const prop in this.result2) { this.result[prop] = this.result2[prop] }
    this.result.nl = this.nl
    this.result.ne = this.ne + this.toInsert.length + this.toUpdate.length + this.toDelete.length
  
    if (!this.result.KO) {
      // (C) envoi en cache des objets majeurs modifiés / ajoutés / supprimés
      const updated = [] // rows mis à jour / ajoutés
      const deleted = [] // paths des rows supprimés
      this.toInsert.forEach(row => { if (GenDoc.majeurs.has(row._nom)) updated.push(row) })
      this.toUpdate.forEach(row => { if (GenDoc.majeurs.has(row._nom)) updated.push(row) })
      this.toDelete.forEach(row => { if (GenDoc.majeurs.has(row._nom)) deleted.push(row._nom + '/' + row.id) })
      Cache.update(updated, deleted)

      if (this.phase3) await this.phase3(this.args) // peut ajouter des résultas
    }

    return this.result
  }

  async doPhase2 () {
    this.toInsert = []; this.toUpdate = []; this.toDelete = []; this.result2 = {}
    this.phase = 2
    await this.phase2(this.args)
    if (!this.result2.KO) {
      if (this.toInsert.length) await this.db.insertRows(this, this.toInsert)
      if (this.toUpdate.length) await this.db.updateRows(this, this.toUpdate)
      if (this.toDelete.length) await this.db.deleteRows(this, this.toDelete)
    }
  }

  async delAvGr (id) { await this.db.delAvGr(this, id)}

  async coll (nom) { return await this.db.coll(this, nom) }

  async collNs (nom, ns) { return this.db.collNs(this, nom, ns) }

  async scoll (nom, id, v) { return this.db.scoll(this, nom, id, v) }

  async delScoll (nom, id) { return this.db.delScollSql(this, nom, id) }

  async getVersionsDlv (dlvmin, dlvmax) { return this.db.getVersionsDlv(this, dlvmin, dlvmax) }

  async getMembresDlv (dlvmax) {return this.db.getMembresDlv(this, dlvmax) }

  async getGroupesDfh (dfh) { return this.db.getGroupesDfh(this, dfh) }

  async getGcvols (ns) { return this.db.collNs(this, 'gcvols', ns) }

  async setVdlv (id, dlv) { return this.db.setVdlv(this, id, dlv) }

  async getAvatarVCV (id, vcv) { return this.db.getAvatarVCV(this, id, vcv) }

  async getChatVCV (id, ids, vcv) { return this.db.getChatVCV(this, id, ids, vcv) }

  async getRowTicketV (id, ids, v) { return this.db.getRowTicketV(this, id, ids, v) }

  async getMembreVCV (id, ids, vcv) { return this.db.getMembreVCV(this, id, ids, vcv) }

  async getAvatarHpc (hpc) { return this.db.getAvatarHpc(this, hpc) }

  async getComptaHps1 (hps1) { return this.db.getComptaHps1(this, hps1) }

  async getSponsoringIds (ids) {return this.db.getSponsoringIds(this, ids) }

  async getAllRowsTribu () { return this.db.collNs(this, 'tribus', this.session.ns) }

  async getAllRowsNote(id, v) { return await this.scoll('notes', id, v) }

  async getAllRowsEspace () { return await this.coll('espaces') }

  async getAllRowsChat(id, v) { return await this.scoll('chats', id, v)}

  async getAllRowsTicket(id, v) { return await this.scoll('tickets', id, v) }

  async getAllRowsSponsoring(id, v) { return await this.scoll('sponsorings', id, v) }

  async getAllRowsMembre(id, v) { return await this.scoll('membres', id, v) }

  async getAllRowsChatgr(id, v) { return await this.scoll('chatgrs', id, v) }

  async getRowNote (id, ids, assert) {
    const rs = await this.db.get(this, 'notes', id, ids)
    if (assert && !rs) throw assertKO('getRowNote/' + assert, 7, [id, ids])
    return rs
  }

  async getRowChat (id, ids, assert) {
    const rc = await this.db.get(this, 'chats', id, ids)
    if (assert && !rc) throw assertKO('getRowChat/' + assert, 12, [id, ids])
    return rc
  }
 
  async getRowTicket (id, ids, assert) {
    const rc = await this.db.get(this, 'tickets', id, ids)
    if (assert && !rc) throw assertKO('getRowTicket/' + assert, 17, [id, ids])
    return rc
  }

  async getRowSponsoring (id, ids, assert) {
    const rs = await this.db.get(this, 'sponsorings', id, ids)
    if (assert && !rs) throw assertKO('getRowSponsoring/' + assert, 13, [id, ids])
    return rs
  }

  async getRowMembre (id, ids, assert) {
    const rm = await this.db.get(this, 'membres', id, ids)
    if (assert && !rm) throw assertKO('getRowMembre/' + assert, 10, [id, ids])
    return rm
  }

  async getRowChatgr (id, assert) {
    const rc = await this.db.get(this.transaction, 'chatgrs', id, 1)
    if (assert && !rc) throw assertKO('getRowChatgr/' + assert, 10, [id, 1])
    return rc
  }

  /* Depuis Cache */

  async org (ns) { return Cache.org(this, ns)}

  async getEspaceOrg (org) { return Cache.getEspaceOrg(this, org) }

  async getCheckpoint () { return Cache.getCheckpoint(this) }

  async setCheckpoint (obj) { return Cache.setCheckpoint(this, obj) }

  async getRowEspace (id, assert) {
    const tr = await Cache.getRow(this, 'espaces', id)
    if (assert && !tr) throw assertKO('getRowEspace/' + assert, 1, [id])
    return tr
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
    if ((assert && !v) || (nonZombi && v && v.dlv && v.dlv <= this.auj))
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

  /* fpurge, transferts */
  async setFpurge (idag, lidf) {
    const x = rnd6()
    const ns = ID.ns(idag)
    const id = (ns * d14) + (x % d14)
    const _data_ = new Uint8Array(encode({ id, idag, lidf }))
    this.db.setFpurge(this, id, _data_)
    return id
  }

  async unsetFpurge (id) {
    await this.db.unsetFpurge(this, id) 
  }

  async listeFpurges () {
    const r = this.db.listeFpurges(this)
    return r
  }

  async listeTransfertsDlv (dlv) {
    const r = this.db.listeTransfertsDlv(this, dlv)
    return r
  }

  async purgeTransferts (id, ids) {
    await this.db.purgeTransferts (this, id, ids)
  }

  async purgeDlv (nom, dlv) { // nom: sponsorings, versions
    return this.db.purgeDlv (this, nom, dlv)
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

  async propagerDlv (args) {
    for(const id of args.lavLmb[0]) {
      const version = compile(await this.getRowVersion(id, 'MajCredits-2'))
      version.dlv = args.dlv
      this.update(version.toRow())
    }
    for(const [idg, im] of args.lavLmb[1]) {
      const membre = compile(await this.getRowMembre(idg, im, 'MajCredits-3'))
      membre.dlv = args.dlv
      this.update(membre.toRow())
    }
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
    const s = await AuthSession.get(this)
    if (!this.authMode && s) {
      // la session est connue dans l'instance, OK
      this.session = s
      this.ttl = Date.now() + AuthSession.ttl
      if (this.session.sync) this.session.sync.pingrecu()
      return 
    } 

    if (this.authData.shax) { // admin
      const shax64 = Buffer.from(this.authData.shax).toString('base64')
      if (ctx.adminKey.indexOf(shax64) !== -1) {
        // session admin authentifiée
        this.session = await AuthSession.set(this, 0, true)
        return
      }
      await sleep(3000)
      throw new AppExc(F_SRV, 101) // pas reconnu
    }

    const espace = await Cache.getEspaceOrg(this, this.authData.org)
    if (!espace) { await sleep(3000); throw new AppExc(F_SRV, 101) }
    const hps1 = (espace.id * d14) + this.authData.hps1
    const rowCompta = await this.getComptaHps1(hps1)
    if (!rowCompta) { await sleep(3000); throw new AppExc(F_SRV, 101) }
    this.compta = compile(rowCompta)
    if (this.compta.hpsc !== this.authData.hpsc) throw new AppExc(F_SRV, 101)
    this.session = await AuthSession.set(this, this.compta.id, this.lecture)
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

  async setEspace (op) {
    if (!this.id) return this
    const esp = await Cache.getEspaceLazy(op, this.ns)
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
    if (op.lecture || !this.estFige) return this
    throw AppExc.notifG(this.notifG)
  }

  // Retourne la session identifiée par sessionId et en prolonge la durée de vie
  static async get (op) {
    const sessionId = op.authData.sessionId
    const t = Date.now()
    if (t - AuthSession.dernierePurge > AuthSession.ttl / 10) {
      AuthSession.map.forEach((s, k) => {
        if (t > s.ttl) AuthSession.map.delete(k)
      })
    }
    const s = AuthSession.map.get(sessionId)
    if (s) {
      await s.setEspace(op)
      s.ttl = t + AuthSession.ttl
      if (s.sync) s.sync.pingrecu()
      return s
    }
    return false
  }

  // Enregistre la session avec l'id du compte de la session
  static async set (op, id, noExcFige) {
    const sessionId = op.authData.sessionId
    let sync = null
    if (op.db.hasWS) {
      sync = SyncSession.get(sessionId)
      if (!sync) throw new AppExc(E_SRV, 4)
      if (id) sync.setCompte(id)
      sync.pingrecu()
    }
    const s = await new AuthSession(sessionId, id, sync).setEspace(op, noExcFige)
    AuthSession.map.set(sessionId, s)
    s.ttl = Date.now() + AuthSession.ttl
    return s
  }
}
