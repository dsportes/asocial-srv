import { encode, decode } from '@msgpack/msgpack'
import { ID, AMJ, PINGTO, AppExc, A_SRV, E_SRV, F_SRV, Compteurs, 
  UNITEN, UNITEV, d14, edvol, hash } from './api.mjs'
import { config } from './config.mjs'
import { app_keys } from './keys.mjs'
import { SyncSession } from './ws.mjs'
import { rnd6, sleep, b64ToU8, decrypterSrv, crypterSrv } from './util.mjs'
import { GenDoc, compile, Chats, Versions } from './gendoc.mjs'

export function trace (src, id, info, err) {
  const msg = `${src} - ${id} - ${info}`
  if (err) config.logger.error(msg); else config.logger.info(msg)
  return msg
}

export function assertKO (src, code, args) {
  const x = args && args.length ? JSON.stringify(args) : ''
  const msg = `ASSERT : ${src} - ${x} - ${code}`
  const t = new Date().toISOString()
  console.error(t + ' ' + msg)
  if (args) args.unshift(src)
  return new AppExc(A_SRV, code, !args ? [src || '???'] : args)
}

export class R { // Restrictions
  static RAL1 = 1 // Ralentissement des opérations

  static RAL2 = 2 // Ralentissement des opérations
  // Comptes O : compte.qv.pcc > 90% / 100%
  // Comptes A : compte.qv.nbj < 20 / 10

  static NRED = 3 // Nombre de notes / chats /groupes en réduction
  // compte.qv.pcn > 100

  static VRED = 4 // Volume de fichier en réduction
  // compte.qv.pcv > 100

  static LECT = 5 // Compte en lecture seule (sauf actions d'urgence)
  // Comptes 0 : espace.notifP compte.notifC de nr == 2

  static MINI = 6 // Accès minimal, actions d'urgence seulement
  // Comptes 0 : espace.notifP compte.notifC de nr == 3

  static FIGE = 8 // Espace figé en lecture

  static CLOS = 9 // Espace figé en lecture

  static getRal (c) {
    if (c.idp) {
      if (c.qv.pcc >= 100) return 2
      if (c.qv.pcc >= 90) return 1
    } else {
      if (c.qv.nbj <= 10) return 2
      if (c.qv.nbj <= 20) return 1
    }
    return 0
  }

  // true si une des restrictions du set s est grave (>= 5)
  static estGrave(s) {
    for(const r in s) if (r >= 5) return true
    return false
  }
}

/* Cache ************************************************************************
Cache des objets majeurs "tribus comptas avatars groupes" 
*/

export class Cache {
  static MAX_CACHE_SIZE = 1000

  static map = new Map()

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
  static async getRow (op, nom, id, lazy) {
    if (this.map.size > Cache.MAX_CACHE_SIZE) Cache._purge()
    const now = Date.now()
    const k = nom + '/' + id
    const x = Cache.map.get(k)
    if (x) {
      /* En mode "lazy" si le row (espaces / partitions) est récent (moins de 5 minutes)
      on ne revérifie pas que c'est la dernière version.
      Les notifications peuvent donc mettre 5 minutes à être effectives
      */
      if (lazy && ((now - x.lru) > PINGTO * 60000)) return x.row
      // on vérifie qu'il n'y en pas une postérieure (pas lue si elle n'y en a pas)
      const n = await op.db.getV(op, nom, id, x.row.v)
      x.lru = now
      if (n && n.v > x.row.v) x.row = n // une version plus récente existe : mise en cache
      if (x.row._nom === 'espaces' && !Cache.orgs.has(x.row.id))
        Cache.setNsOrg(x.row.id, x.row.org)
      return x.row
    }
    const n = await op.db.getV(op, nom, id, 0)
    if (n) { // dernière version si elle existe
      const y = { lru: now, row: n }
      this.map.set(k, y)
    }
    if (n && n._nom === 'espaces' && !Cache.orgs.has(n.id))
      Cache.setNsOrg(n.id, n.org)
    return n
  }

  /* La cache a-t-elle une version supérieure ou égale à v pour le document nom/id */
  static aVersion (nom, id, v) {
    const k = nom + '/' + id
    const x = Cache.map.get(k)
    return x && x.v >= v ? x : null
  }

  static opFake = { fake: true, nl: 0, ne: 0 }

  /* Retourne l'objet `espaces` depuis son code org */
  static async getEspaceOrg (op, org, lazy) {
    let ns = Cache.orgs2.get(org)
    if (ns) return compile(await Cache.getRow(op, 'espaces', ns, lazy))
    const row = await op.db.getEspaceOrg(op, org)
    if (!row) return null
    ns = row.id
    Cache.map.set('espaces/' + ns, { lru: Date.now(), row: row })
    Cache.setNsOrg(row.id, row.org)
    return compile(row)
  }

  /* Retourne le code de l'organisation pour un id/ns donné.*/
  static async org (op, idns) { 
    const ns = ID.ns(idns)
    const org = Cache.orgs.get(ns)
    if (org) return org
    const row = await Cache.getRow(op, 'espaces', ns, true)
    return row ? row.org : null
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

}

/** Operation *****************************************************/
export class Operation {
  /* Initialisé APRES constructor() dans l'invocation d'une opération
    this... isGet, db, storage, args, dh
  */
  constructor (nomop, authMode, excFige) { 
    this.nomop = nomop
    this.estSync = this.nomop === 'Sync'
    this.authMode = authMode
    this.excFige = excFige || 1
    this.setR = new Set()
    this.nl = 0; this.ne = 0; this.vd = 0; this.vm = 0
    this.result = { }
    this.toInsert = []; this.toUpdate = []; this.toDelete = []; this.versions = []
  }

  /* Exécution de l'opération */
  async run () {
    await this.db.doTransaction(this) // Fait un appel à transac

    /* Envoi en cache des objets majeurs mis à jour / supprimés */  
    if (!this.result.KO) {
      const updated = [] // rows mis à jour / ajoutés
      const deleted = [] // paths des rows supprimés
      this.toInsert.forEach(row => { if (GenDoc.majeurs.has(row._nom)) updated.push(row) })
      this.toUpdate.forEach(row => { if (GenDoc.majeurs.has(row._nom)) updated.push(row) })
      this.toDelete.forEach(row => { if (GenDoc.majeurs.has(row._nom)) deleted.push(row._nom + '/' + row.id) })
      Cache.update(updated, deleted)

      await this.phase3(this.args) // peut ajouter des résultas

      if (this.db.hasWS && this.versions.length) SyncSession.toSync(this.versions)
    }

    return this.result
  }

  async phase2 () { return }

  async phase3 () { return }

  calculDlv () {
    if (ID.estComptable(this.compte.id)) return AMJ.max
    const dlvmax = AMJ.djMois(AMJ.amjUtcPlusNbj(this.auj, this.espace.nbmi * 30))
    if (this.compte.idp) // Compte O
      return this.espace.dlvat && (dlvmax > this.espace.dlvat) ? this.espace.dlvat : dlvmax
    // Compte A
    const d = AMJ.djMois(AMJ.amjUtcPlusNbj(this.auj, this.compta._nbj))
    return dlvmax > d ? d : dlvmax
  }

  async transac () { // Appelé par this.db.doTransaction
    await this.auth() // this.compta est accessible (si authentifié)

    if (this.phase2) await this.phase2(this.args)

    this.result.dh = this.dh

    if (this.setR.has(R.FIGE)) return

    // Maj espace
    if (this.espace && this.espace._maj) {
      if (this.espace._ins) this.espace.v = 1; else this.espace.v++
      const row= this.espace.toRow()
      this.setNV(this.espace)
      if (this.espace._ins) this.insert(row); else this.update(row)
    }
    
    // Maj dlv si nécessaire) et pas de restriction grave
    if (this.compte && this.espace && this.compta && !R.estGrave(this.setR)) {
      const dlv = this.calculDlv()
      let diff1 = AMJ.diff(dlv, this.compte.dlv); if (diff1 < 0) diff1 = -diff1
      if (diff1) {
        /* Pour éviter des modifications mineures sur comptes, on ne met à jour la dlv que :
        - si elle est dans moins de 20 jours
        - si elle diffère de l'actuelle de plus de 10 jours
        */
        if (AMJ.diff(dlv, this.auj) < 20 || diff1 > 10) {
          this.compte.dlv = dlv
          this.compte._maj = true
        }
      }
    }

    // Incorporation de consommation dans compta et insert/update compta
    const conso = this.compta ? await this.compta.finaliser(this) : null

    if (this.compte && this.compte._maj) {
      if (this.compte._ins) this.compte.v = 1; else this.compte.v++
      const row = this.compte.toRow()
      this.setNV(this.compte)
      if (this.compte._ins) this.insert(row); else this.update(row)
    }

    /* Maj des partitions modifiées dans l'opération */
    if (this.partitions && this.partitions.size) {
      for(const [, p] of this.partitions) if (p._maj) {
        if (p._ins) p.v = 1; else p.v++
        // réintegration dans synthese
        if (!this.synthese)
          this.synthese = compile(await this.getRowSynthese(this.ns, 'transac-fin'))
        this.synthese.setPartition(p)
        const row = p.toRow()
        if (p._ins) this.insert(row); else this.update(row)
      }
    }

    /* Maj de la synthese de l'espace si elle a été modifiée dans l'opération
    par intégration / maj d'une partition */
    if (this.synthese && this.synthese._maj) {
      this.synthese.dh = this.dh
      const row = this.synthese.toRow()
      if (this.synthese._ins) this.insert(row); else this.update(row)
    }
    
    if (conso) this.result.conso = conso

    if (!this.result.KO) {
      if (this.toInsert.length) await this.db.insertRows(this, this.toInsert)
      if (this.toUpdate.length) await this.db.updateRows(this, this.toUpdate)
      if (this.toDelete.length) await this.db.deleteRows(this, this.toDelete)
    }
  }

  /* Authentification *************************************************************
  authMode:
    0 : pas de contrainte d'accès (public)
    1 : le compte doit être authentifié
    2 : et ça doit être le comptable
    3 : administrateur technique requis
  excFige: (toujours 0 si authMode 3)
    1 : pas d'exception si figé. Lecture seulement ou estFige testé dans l'opération
    2 : exception si figé
  Après authentification, sont disponibles:
    - this.id this.ns this.estA this.sync (ou null) 
    - this.compte this.compta this.espace
    - this.setR : set des restictions
      `1-RAL1  2-RAL2` : Ralentissement des opérations
        - Comptes O : compte.qv.pcc > 90% / 100%
        - Comptes A : compte.qv.nbj < 20 / 10
      `3-NRED` : Nombre de notes / chats /groupes en réduction
        - compte.qv.pcn > 100
      `4-VRED` : Volume de fichier en réduction
        - compte.qv.pcv > 100
      `5-LECT` : Compte en lecture seule (sauf actions d'urgence)
        - Comptes 0 : espace.notifP compte.notifC de nr == 2
      `6-MINI` : Accès minimal, actions d'urgence seulement
        - Comptes 0 : espace.notifP compte.notifC de nr == 3
      `9-FIGE` : Espace figé en lecture
        - espace.notif.nr == 2
  */
  async auth() {
    if (this.authMode < 0 || this.authmode > 3) throw new AppExc(A_SRV, 19, [this.authMode]) 

    const t = this.args.token
    if (!t && this.authMode !== 0) { 
      await sleep(3000)
      throw new AppExc(F_SRV, 205) 
    } 
    let authData = null
    this.estAdmin = false
    if (t) try { 
      authData = decode(b64ToU8(t)) 
      if (authData.shax) {
        try {
          const shax64 = Buffer.from(authData.shax).toString('base64')
          if (app_keys.admin.indexOf(shax64) !== -1) this.estAdmin = true
        } catch (e) { /* */ }
      }
    } catch (e) { 
      await sleep(3000)
      throw new AppExc(F_SRV, 206, [e.message])
    }

    if (this.estAdmin) return

    if (this.authMode === 3) { await sleep(3000); throw new AppExc(F_SRV, 999) } 

    if (authData && authData.sessionId) {
      /* Récupérer la session WS afin de pouvoir lui transmettre les évolutions d'abonnements */
      this.sync = SyncSession.getSession(authData.sessionId, this.dh)
      if (!this.sync) throw new AppExc(E_SRV, 4)
    }

    if (this.authMode === 0) return

    /* Espace: rejet de l'opération si l'espace est "clos" - Accès LAZY */
    this.espace = await Cache.getEspaceOrg(this, authData.org, true)
    if (!this.espace) { await sleep(3000); throw new AppExc(F_SRV, 102) }
    this.ns = this.espace.id
    const n = this.espace.notifE
    if (n) {
      // Espace bloqué
      if (n.nr === 3) // application close
        throw new AppExc(A_SRV, 999, [n.texte, n.dh])
      if (n.nr === 2) {
        this.setR.add(R.FIGE)
        if (this.excFige === 2) throw new AppExc(F_SRV, 101, [n.texte])
      }
    }
    
    /* Compte */
    const hXR = (this.espace.id * d14) + authData.hXR
    const rowCompte = await this.db.getCompteHXR(this, hXR)
    if (!rowCompte) { await sleep(3000); throw new AppExc(F_SRV, 998) }
    this.compte = compile(rowCompte)
    if (this.compte.hXC !== authData.hXC) { await sleep(3000);  throw new AppExc(F_SRV, 998) }
    if (this.compte.dlv < this.auj)  { await sleep(3000); throw new AppExc(F_SRV, 998) }
    this.id = this.compte.id
    this.estComptable = ID.estComptable(this.id)
    this.estA = !this.compte.idp
    // Opération du seul Comptable
    if (this.authMode === 2 && !ID.estComptable(this.id)) { 
      await sleep(3000); throw new AppExc(F_SRV, 104) 
    }
    // Recherche des restrictions
    const ral = R.getRal(this.compte)
    if (ral) this.setR.add(ral)
    if (this.compte.qv.pcn >= 100) this.setR.add(R.NRED)
    if (this.compte.qv.pcv >= 100) this.setR.add(R.VRED)
    if (this.compte.idp) {
      const np = this.espace.tnotifP[this.compte.idp]
      let x = np ? np.nr : 0
      const nc = this.compte.notif
      if (nc && nc.nr > x) x = nc.nr
      if (x) {
        if (x === 2) this.setR.add(R.LECT)
        if (x === 3) this.setR.add(R.MINI)
      }
    }

    /* Compta : requis en fin d'opération, autant le charger maintenant */
    this.compta = compile(await this.getRowCompta(this.id, 'auth-compta'))
  }

  /* Fixe LA valeur de la propriété 'prop' du résultat (et la retourne)*/
  setRes(prop, val) { this.result[prop] = val; return val }

  /* AJOUTE la valeur en fin de la propriété Array 'prop' du résultat (et la retourne)*/
  addRes(prop, val) {
    let l = this.result[prop]; if (!l) { l = []; this.result[prop] = l }
    l.push(val)
    return val
  }
  
  /* Inscrit row dans les rows à insérer en phase finale d'écritue, juste après la phase2 */
  insert (row) { this.toInsert.push(row); return row }

  /* Inscrit row dans les rows à mettre à jour en phase finale d'écritue, juste après la phase2 */
  update (row) { this.toUpdate.push(row); return row }

  /* Inscrit row dans les rows à détruire en phase finale d'écritue, juste après la phase2 */
  delete (row) { if (row) this.toDelete.push(row); return row }

  async getV (doc, src) {
    const id = ID.long(doc.rds, this.ns)
    return compile(await this.getRowVersion(id, src))
  }

  setV (version) {
    const r = version.toRow()
    if (version.v === 1) this.insert(r); else this.update(r)
    this.versions.push(r)
    return version
  }

  setNV (doc) {
    const version = new Versions()
    version.v = doc.v
    if (doc._nom === 'espaces') {
      version.id = doc.id
      version.notif = doc.notifE || null
    } else version.id = ID.long(doc.rds, ID.ns(doc.id))
    this.setV(version)
  }

  async getVAvGr (id, src) {
    const avgr = compile(
      ID.estGroupe(id) ? await this.getRowGroupe(id, src) : await this.getRowAvatar(id, src))
    return await this.getV(avgr, src)
  }

  decrypt (k, x) { return decode(decrypterSrv(k, Buffer.from(x))) }

  crypt (k, x) { return crypterSrv(k, Buffer.from(encode(x))) }

  idsChat (idI, idE) {
    return hash(crypterSrv(this.db.appKey, Buffer.from(ID.court(idI) + '/' + ID.court(idE)))) % d14
  }

  /* Helper d'accès depuis Cache */

  async org (ns) { return Cache.org(this, ns)}

  async getEspaceOrg (org) { return Cache.getEspaceOrg(this, org) }

  async getRowEspace (id, assert) {
    const tr = await Cache.getRow(this, 'espaces', id)
    if (assert && !tr) throw assertKO('getRowEspace/' + assert, 1, [id])
    return tr
  }

  async getEspaceLazy (id, assert) {
    this.espace = compile(await Cache.getRow(this, 'espaces', id, true))
    if (assert && !this.espace) throw assertKO('getRowEspace/' + assert, 1, [id])
    this.ns = this.espace.id
    this.notifE = this.espace.notifE
    if (this.notifE) {
      // Espace bloqué
      if (this.notifE.nr === 3) this.setR.add(R.CLOS)
      else if (this.notifE.nr === 2) this.setR.add(R.FIGE)
    }
  }

  async getRowPartition (id, assert) {
    const tr = await Cache.getRow(this, 'partitions', id)
    if (assert && !tr) throw assertKO('getRowPartition/' + assert, 2, [id])
    return tr
  }

  async getPartition (id, assert) {
    if (!this.partitions) this.partitions = new Map()
    let p = this.partitions.get(id)
    if (!p) {
      p = compile (await this.getRowPartition(id, assert))
      this.partitions.set(id, p)
    }
    return p
  }

  async getRowSynthese (id, assert) {
    const tr = await Cache.getRow(this, 'syntheses', id)
    if (assert && !tr) throw assertKO('getRowSynthese/' + assert, 16, [id])
    return tr
  }

  async getRowCompte (id, assert) {
    const cp = await Cache.getRow(this, 'comptes', id)
    if (assert && !cp) throw assertKO('getRowCompte/' + assert, 4, [id])
    return cp
  }

  async getRowCompta (id, assert) {
    const cp = await Cache.getRow(this, 'comptas', id)
    if (assert && !cp) throw assertKO('getRowCompta/' + assert, 3, [id])
    return cp
  }

  async getRowCompti (id, assert) {
    const cp = await Cache.getRow(this, 'comptis', id)
    if (assert && !cp) throw assertKO('getRowCompti/' + assert, 12, [id])
    return cp
  }

  async getRowVersion (id, assert) {
    const v = await Cache.getRow(this, 'versions', id)
    if (assert && !v) throw assertKO('getRowVersion/' + assert, 14, [id])
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

  // HELPERS d'accès à la base
  async delAvGr (id) { await this.db.delAvGr(this, id)}

  async coll (nom) { return await this.db.coll(this, nom) }

  async collNs (nom, ns) { return this.db.collNs(this, nom, ns) }

  async scoll (nom, id, v) { return this.db.scoll(this, nom, id, v) }

  async delScoll (nom, id) { return this.db.delScollSql(this, nom, id) }

  async getVersionsDlv (dlvmin, dlvmax) { return this.db.getVersionsDlv(this, dlvmin, dlvmax) }

  async getMembresDlv (dlvmax) {return this.db.getMembresDlv(this, dlvmax) }

  async getMembresDlvat (ns, dlvat) {return this.db.getMembresDlvat(this, ns, dlvat) }

  async getVersionsDlvat (ns, dlvat) {return this.db.getVersionsDlvat(this, ns, dlvat) }

  async getGroupesDfh (dfh) { return this.db.getGroupesDfh(this, dfh) }

  async setVdlv (id, dlv) { return this.db.setVdlv(this, id, dlv) }

  async getAvatarVCV (id, vcv) { return this.db.getAvatarVCV(this, id, vcv) }

  async getChatVCV (id, ids, vcv) { return this.db.getChatVCV(this, id, ids, vcv) }

  async getRowTicketV (id, ids, v) { return this.db.getRowTicketV(this, id, ids, v) }

  async getMembreVCV (id, ids, vcv) { return this.db.getMembreVCV(this, id, ids, vcv) }

  async getAvatarHpc (hpc) { return this.db.getAvatarHpc(this, hpc) }

  async getComptaHps1 (hps1) { return this.db.getComptaHps1(this, hps1) }

  async getSponsoringIds (ids) {return this.db.getSponsoringIds(this, ids) }

  async getAllRowsTribu () { return this.db.collNs(this, 'tribus', this.ns) }

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

  async getSingletons () { return this.db.getSingletons(this) }

  async setSingleton (data) { this.db.setSingleton(this, data) }

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
        // Depuis SyncSp version I vient d'être créee
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
        const compta = compile(await this.getRowCompta(this.id, 'majNbChat-1'))
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
  
  /* Met à jour les volumes du groupe
  Refuse si le volume est ex expansion et qu'il dépasse le quota
  L'objet version du groupe est mis à jour et retourné
  */
  async majVolumeGr (idg, dv1, dv2, maj, assert) {
    const vg = compile(await this.getRowVersion(idg, assert))
    if (dv1 > 0 && vg.vols.v1 + dv1 > vg.vols.q1 * UNITEN) 
      throw new AppExc(F_SRV, 65, [edvol(vg.vols.v1 + dv1), edvol(vg.vols.q1 * UNITEN)])
    if (dv2 > 0 && vg.vols.v2 + dv2 > vg.vols.q2 * UNITEV) 
      throw new AppExc(F_SRV, 65, [edvol(vg.vols.v2 + dv2), edvol(vg.vols.q2 * UNITEV)])
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
    if (v1 > qv.q1 * UNITEN) throw new AppExc(F_SRV, 55, [v1, qv.q1])
    qv.v2 += dv2
    if (qv.v2 > qv.q2 * UNITEV) throw new AppExc(F_SRV, 56, [qv.v2, qv.q2])
    const ser = new Compteurs(compta.compteurs, qv).serial
    compta.v++
    compta.compteurs = ser
    this.update(compta.toRow())
  }

  /* Mise à jour de Synthese suite à une mise à jour d'une tribu */
  // A SUPPRIMER
  async MajSynthese () {
  
  }
}
