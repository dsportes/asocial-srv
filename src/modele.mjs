import { encode, decode } from '@msgpack/msgpack'
import { ID, PINGTO, AppExc, A_SRV, E_SRV, F_SRV, d14, V99, hash } from './api.mjs'
import { config } from './config.mjs'
import { app_keys } from './keys.mjs'
import { SyncSession } from './ws.mjs'
import { rnd6, sleep, b64ToU8, crypterSrv } from './util.mjs'
import { GenDoc, compile, Versions, Comptes, Avatars, Groupes, 
  Chatgrs, Chats, Tickets, Sponsorings, /*Notes,*/
  Membres, Espaces, Partitions, Syntheses, Comptas, Comptis, Invits } from './gendoc.mjs'

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
  // Comptes O : compte.qv.pcc > 80% / 90%
  // Comptes A : compte.qv.nbj < 20 / 10

  static RAL2 = 2 // Ralentissement des opérations
  // Comptes O : compte.qv.pcc > 90% / 100%
  // Comptes A : compte.qv.nbj < 10

  static NRED = 3 // Nombre de notes / chats /groupes en réduction
  // compte.qv.pcn > 100

  static VRED = 4 // Volume de fichier en réduction
  // compte.qv.pcv > 100

  static LECT = 5 // Compte en lecture seule (sauf actions d'urgence)
  // Comptes 0 : espace.notifP compte.notifC de nr == 2

  static MINI = 6 // Accès minimal, actions d'urgence seulement
  // Comptes O : espace.notifP compte.notifC de nr == 3
  // Comptes O : compte.qv.pcc > 100%
  // Comptes A : compte.qv.nbj < 0

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
export class Esp {
  static map = new Map()

  static orgs = new Map()

  static v = 0

  static dh = 0

  static async load (op) {
    const l = await op.db.getRowEspaces(op, Esp.v)
    l.forEach(r => { 
      const ns = ID.ns(r.id)
      Esp.map.set(ns, r)
      Esp.orgs.set(r.org, r.ns)
      if (r.v > Esp.v) Esp.v = r.v
    })
    Esp.dh = Date.now()
  }

  static actifs () {
    const l = []
    this.map.forEach(e => { if (!e.notif || e.notif.nr < 2) l.push(e.id) })
    return l
  }

  static async getEsp (op, ns, lazy) {
    if (!lazy || (Date.now() - Esp.dh > PINGTO * 60000)) await Esp.load(op)
    return compile(this.map.get(ns))
  }

  static async getNsOrg (op, org, lazy) {
    if (!lazy || (Date.now() - Esp.dh > PINGTO * 60000)) await Esp.load(op)
    return this.orgs.get(org)
  }

  static async getEspOrg (op, org, lazy) {
    const ns = await Esp.getNsOrg(op, org, lazy)
    return compile(this.map.get(ns))
  }

  static updEsp(op, e) {
    const x = Esp.map.get(e.id)
    if (!x || x.v < e.v) {
      const r = e.toRow(op)
      Esp.map.set(e.id, r)
      Esp.orgs.set(e.org, r)
    }
  }

}

export class Cache {
  static MAX_CACHE_SIZE = 1000

  static map = new Map()

  /* Obtient le row de la cache ou va le chercher.
  Si le row actuellement en cache est le plus récent on a évité une lecture effective
   (ça s'est limité à un filtre sur index qui ne coûte rien en FireStore).
  Si le row n'était pas en cache ou que la version lue est plus récente IL Y EST MIS:
  certes la transaction peut échouer, mais au pire on a lu une version,
  pas forcément la dernière, mais plus récente.
  */
  static async getRow (op, nom, idc) {
    if (this.map.size > Cache.MAX_CACHE_SIZE) Cache._purge()
    const now = Date.now()
    const id = ID.long(idc, op.ns)
    const k = nom + '/' + id
    const x = Cache.map.get(k)
    if (x) {
      // on vérifie qu'il n'y en pas une postérieure (pas lue si elle n'y en a pas)
      const n = await op.db.getV(op, nom, id, x.row.v)
      x.lru = now
      if (n && n.v > x.row.v) x.row = n // une version plus récente existe : mise en cache
      return x.row
    }
    const n = await op.db.getV(op, nom, id, 0)
    if (n) { // dernière version si elle existe
      const y = { lru: now, row: n }
      this.map.set(k, y)
    }
    return n
  }

  /* La cache a-t-elle une version supérieure ou égale à v pour le document nom/id */
  static aVersion (op, nom, idc, v) {
    const id = ID.long(idc, op.ns)
    const k = nom + '/' + id
    const x = Cache.map.get(k)
    return x && x.v >= v ? x : null
  }

  static opFake = { fake: true, nl: 0, ne: 0 }
  
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

/** class GD : gestionnaires des documents d'une opération **************************

*/
class GD {
  constructor (op) {
    this.op = op

    this.espace = null
    this.lazy = true
    this.synthese = null

    this.comptes = new Map()
    this.comptis = new Map()
    this.invits = new Map()

    this.avatars = new Map()
    this.groupes = new Map()
    this.sdocs = new Map()
    this.versions = new Map()

    this.comptas = new Map()
    this.partitions = new Map()
    
  }

  /* Création conjointe de espace et synthese */
  nouvES (ns, org, cleES) {
    const e = Espaces.nouveau(ns, org, this.op.auj, cleES)
    this.op.ns = ns
    this.op.org = e.org
    this.espace = e
    this.lazy = false
    this.synthese = Syntheses.nouveau(ns)
    const v = Versions.nouveau(ns)
    v.v = 0
    this.versions.set(ns, v)
    return e
  }

  // Depuis Authentification : l'espace a été obtenu depuis org et non son id
  setEspace (espace) {
    this.espace = espace
    this.lazy = true
  }

  async getESOrg (org, fige) {
    const espace = await Esp.getEspOrg(this.op, org, true)
    if (!espace) { await sleep(3000); throw new AppExc(F_SRV, 102) }
    if (espace.clos) throw new AppExc(A_SRV, 999, espace.clos)
    this.op.org = org
    this.op.ns = espace.id
    this.espace = espace
    this.lazy = true
    if (espace.fige)
      if (fige) throw new AppExc(F_SRV, 101, espace.fige)
      else this.op.setR.add(R.FIGE)
    return espace
  }

  /* Gère l'espace courant unique d'une opération */
  async getES (lazy, assert) {
    if (this.espace && !lazy && !this.lazy) return this.espace
    if (this.espace && lazy) return this.espace
    this.espace = await Esp.getEsp(this.op, this.op.ns, lazy)
    if (!this.espace) {
      if (!assert) return null; assertKO(assert, 1, [this.op.ns]) }
    this.lazy = lazy
    return this.espace
  }

  async getSY (ns) {
    if (!this.synthese) {
      this.synthese = compile(await Cache.getRow(this, 'syntheses',  0))
      if (!this.synthese) throw assertKO('getSy', 16, [ns])
    }
    return this.synthese
  }

  /* Nouvelle partition de l'espace courant. Comptable est le compte courant */
  async nouvPA (np, qc) {
    const p = Partitions.nouveau(this.op.ns, np, qc)
    this.partitions.set(p.id, p)
    const espace = await this.getES()
    espace.setPartition(np)
    return p
  }

  async getPA (idp, assert) {
    let p = this.partitions.get(idp)
    if (p) return p
    p = compile(await this.op.getRowPartition(idp))
    if (!p) {
      if (!assert) return null; assertKO(assert, 2, [idp]) }
    this.partitions.set(idp, p)
    return p
  }

  nouvCO (args, sp, quotas, don) {
    const c = Comptes.nouveau(args, sp)
    c.rds = ID.rds(ID.RDSCOMPTE)
    this.comptes.set(c.id, c)
    this.nouvV(c.rds)
    const compta = Comptas.nouveau(c.id, quotas, don || 0)
    this.comptas.set(c.id, compta)
    const compti = Comptis.nouveau(c.id)
    compti.rds = c.rds
    this.comptis.set(compti.id, compti)
    const invit = Invits.nouveau(c.id)
    invit.rds = c.rds
    this.invits.set(invit.id, invit)
    return { compte:c, compta: compta, compti: compti, invit: invit }
  }

  async getCO (id, assert, hXR) {
    let c
    let t = false
    if (id) {
      c = this.comptes.get(id)
      if (c) t = true; else c = compile(await this.op.getRowCompte(id))
    } else
      c = compile(await this.op.db.getCompteHk(this.op, ID.long(hXR, this.op.ns)))
    if (!c || c.v === V99) { 
      if (!assert) return null; else assertKO(assert, 4, [c.id]) }
    if (!t) this.comptes.set(c.id, c)
    return c
  }

  async getCI (id, assert) {
    let c
    if (id) c = this.comptis.get(id)
    if (c) return c
    c = compile(await this.op.getRowCompti(id))
    if (!c || !await this.getV(c.rds)) { 
      if (!assert) return null; else assertKO(assert, 12, [c.id]) }
    this.comptis.set(id, c)
    return c
  }

  async getIN (id, assert) {
    let c
    if (id) c = this.invits.get(id)
    if (c) return c
    c = compile(await this.op.getRowInvit(id))
    if (!c || !await this.getV(c.rds)) { 
      if (!assert) return null; else assertKO(assert, 11, [c.id]) }
    this.invits.set(id, c)
    return c
  }

  async getCA (id, assert) {
    let c = this.comptas.get(id)
    if (c) return c
    c = compile(await this.op.getRowCompta(id))
    if (!c) { 
      if (!assert) return null; else assertKO(assert, 3, [c.id]) }
    this.comptas.set(id, c)
    return c
  }

  nouvAV (compte, args, cvA) {
    const a = Avatars.nouveau(args, cvA)
    a.rds = ID.rds(ID.RDSAVATAR)
    a.idc = ID.court(compte.id)
    compte.ajoutAvatar(a, args.cleAK)
    this.avatars.set(a.id, a)
    this.nouvV(a.rds)
    return a
  }

  async getAV (id, assert) {
    let a = this.avatars.get(id)
    if (a) return a
    a = compile(await this.op.getRowAvatar(id))
    if (!a || a.v === V99) { 
      if (!assert) return null; else assertKO(assert, 8, [a.id]) }
    this.avatars.set(id, a)
    return a
  }

  /* Retourne { disp, av }
  - avatar s'il existe ET que sa CV est plus récente que vcv
  - disp: true avatar a disparu
  */
  async getAAVCV (id, vcv) {
    let disp = false
    let av = this.avatars.get(id)
    if (av) return av.vcv > vcv ? { av, disp } : { disp }
    av = await this.op.db.getAvatarVCV(this.op, ID.long(id, this.op.ns) , vcv)
    disp = (!av || av.v === V99)
    if (disp) return { disp }
    this.avatars.set(id, av)
    disp = false
    return av.vcv > vcv ? { av, disp } : { disp }
  }

  nouvGR (args) {
    const g = Groupes.nouveau(args)
    g.rds = ID.rds(ID.RDSGROUPE)
    g.idh = ID.court(this.op.compte.id)
    this.op.compte.ajoutGroupe(g.id, args.ida, args.cleGK, g.rds)
    this.groupes.set(g.id, g)
    this.nouvV(g.rds)
    const ch = Chatgrs.nouveau(g.id)
    ch.rds = g.rds
    this.sdocs.set(g.id + '/', ch)
    return g
  }

  async getGR (id, assert) {
    let g = this.groupes.get(id)
    if (g) return g
    g = compile(await this.op.getRowGroupe(id))
    if (!g || g.v === V99) { 
      if (!assert) return null; else assertKO(assert, 9, [g.id]) }
    this.groupes.set(id, g)
    return g
  }

  async getCGR (id, assert) {
    const k = id + '/CGR/'
    let d = this.sdocs.get(k)
    if (d) return d
    d = compile(await this.op.getRowChatgr(id))
    if (!d || !await this.getV(d.rds)) { 
      if (!assert) return null; else assertKO(assert, 17, [k]) }
    this.sdocs.set(k, d)
    return d
  }

  async nouvMBR (id, im, cvA, cleAG, assert) {
    const k = id + '/MBR/' + im
    const g = await this.getGR(id, assert)
    const m = Membres.nouveau(id, im, cvA, cleAG)
    m.rds = g.rds
    if (!await this.getV(m.rds)) { 
      if (!assert) return null; else assertKO(assert, 10, [k]) }
    this.sdocs.set(k, m)
    return m
  }

  async getMBR (id, im, assert) {
    const k = id + '/MBR/' + im
    let d = this.sdocs.get(k)
    if (d) return d
    d = compile(await this.op.getRowMembre(id, im))
    if (!d || !await this.getV(d.rds)) { 
      if (!assert) return null; else assertKO(assert, 10, [k]) }
    this.sdocs.set(k, d)
    return d
  }

  async nouvCAV (args, assert) {
    const k = args.id + '/CAV/' + args.ids
    const a = await this.getAV(args.id, assert)
    const d = Chats.nouveau(args)
    d.rds = a.rds
    if (!await this.getV(d.rds)) { 
      if (!assert) return null; else assertKO(assert, 5, [k]) }
    this.sdocs.set(k, d)
    return d
  }

  async getCAV (id, ids, assert) {
    const k = id + '/CAV/' + ids
    let d = this.sdocs.get(k)
    if (d) return d
    d = compile(await this.op.getRowChat(id, ids))
    if (!d || !await this.getV(d.rds)) { 
      if (!assert) return null; else assertKO(assert, 5, [k]) }
    this.sdocs.set(k, d)
    return d
  }

  async getAllCAV (id) {
    const l = []
    for (const row of await this.op.db.scoll(this.op, 'chats', id, 0)) {
      const k = id + '/CAV/' + row.ids
      let d = this.sdocs.get(k)
      if (!d) {
        d = compile(row)
        await this.getV(d.rds)
        this.sdocs.set(k, d)
      }
      l.push(d)
    }
    return l
  }

  async nouvTKT (id, args, assert) {
    const idc = ID.duComptable(this.op.ns)
    const k = idc + '/TKT/' + args.ids
    const a = await this.getAV(idc, assert)
    const d = Tickets.nouveau(id, args)
    d.id = idc
    d.dg = this.op.auj
    d.rds = a.rds
    if (!await this.getV(d.rds)) { 
      if (!assert) return null; else assertKO(assert, 15, [k]) }
    this.sdocs.set(k, d)
    return d
  }

  async getTKT (ids, assert) {
    const idc = ID.duComptable(this.op.ns)
    const k = idc + '/TKT/' + ids
    let d = this.sdocs.get(k)
    if (d) return d
    d = compile(await this.op.getRowTicket(idc, ids))
    if (!d || !await this.getV(d.rds)) { 
      if (!assert) return null; else assertKO(assert, 15, [k]) }
    this.sdocs.set(idc + '/TKT/' + ids, d)
    return d
  }

  async nouvSPO (args, ids, assert) {
    const k = args.id + '/SPO/' + ids
    const a = await this.getAV(args.id, assert)
    const d = Sponsorings.nouveau(args, ids)
    d.rds = a.rds
    d.dh = this.op.dh
    if (!await this.getV(d.rds)) { 
      if (!assert) return null; else assertKO(assert, 13, [k]) }
    this.sdocs.set(k, d)
    return d
  }

  async getSPO (id, ids, assert) {
    const k = id + '/SPO/' + ids
    let d = this.sdocs.get(k)
    if (d) return d
    d = compile(await this.op.getRowSponsoring(id, ids))
    if (!d || !await this.getV(d.rds)) { 
      if (!assert) return null; else assertKO(assert, 13, [k]) }
    this.sdocs.set(k, d)
    return d
  }

  /*
  async nouvNOT (id, nex) {

  }

  async getNOT (id, ids, nex) {
    
  }
  */

  async getV (rds) { // cage: 1:compte 2:avatar, 3:groupe, 4:espace
    let v = this.versions.get(rds)
    if (!v) {
      v = compile(await this.op.getRowVersion(rds))
      if (v) this.versions.set(rds, v)
    }
    return !v || v.dlv ? null : v
  }

  nouvV (rds) {
    const v = Versions.nouveau(rds)
    v.v = 0
    this.versions.set(rds, v)
  }

  /* Met à jour le version d'un doc ou sous-doc,
  - SAUF pour cage, le version doit avoir été chargé par un getXX précédent, sinon EXCEPTION
  - pour cage, récupère le version
  - s'il avait déjà été incrémenté, ne fait rien
  */
  async majV (rds, id) { // id: seulement pour trace sur assert
    let v = this.versions.get(rds)
    if (!v) {
      v = await this.getV(rds)
      if (!v) assertKO('majV', 20, [rds, id])
    }
    if (!v._maj) {
      v.v++
      v._maj = true
      const rv = v.toRow(this.op)
      if (v.v === 1) this.op.insert(rv); else this.op.update(rv)
      this.op.versions.push(rv)  
    }
    return v.v
  }

  async majdoc (d) {
    if (d._maj) {
      const ins = d.v === 0
      d.v = await this.majV(d.rds, d.id + (d.ids ? '/' + d.ids : ''))
      if (d.cvA && !d.cvA.v) { d.vcv = d.v; d.cvA.v = d.v }
      if (d.cvG && !d.cvG.v) { d.vcv = d.v; d.cvG.v = d.v }
      if (ins) this.op.insert(d.toRow(this.op)); else this.op.update(d.toRow(this.op))
    }
  }

  async majesp (d) {
    if (d._maj) {
      const ins = d.v === 0
      d.v = await this.majV(d.id, d.id)
      if (ins) this.op.insert(d.toRow(this.op)); else this.op.update(d.toRow(this.op))
    }
  }

  async majCompta (compta) { // ET report dans compte -> partition
    if (compta._maj) {
      compta.v++
      const compte = await this.getCO(compta.id)
      await compte.reportDeCompta(compta, this)
      if (compta.v === 1) this.op.insert(compta.toRow(this.op)); else this.op.update(compta.toRow(this.op))
    }
  }

  async majpart (p) {
    if (p._maj) {
      p.v++
      if (p.v === 1) this.op.insert(p.toRow(this.op)); else this.op.update(p.toRow(this.op))
      const s = await this.getSY(p.ns)
      s.setPartition(p)
    }
  }

  async majsynth () {
    const s = this.synthese
    if (s && s._maj) {
      s.v++
      if (s.v === 1) this.op.insert(s.toRow(this.op)); else this.op.update(s.toRow(this.op))
    }
  }

  async maj () {
    for(const [,d] of this.avatars) await this.majdoc(d)
    for(const [,d] of this.groupes) await this.majdoc(d)
    for(const [,d] of this.sdocs) await this.majdoc(d)
    for(const [,d] of this.comptis) await this.majdoc(d)
    for(const [,d] of this.invits) await this.majdoc(d)
    if (this.espace) await this.majesp(this.espace)
    
    // comptas SAUF celle du compte courant
    for(const [id, d] of this.comptas) 
      if (id !== this.op.id) await this.majCompta(d)

    // comptes SAUF le compte courant
    for(const [id, d] of this.comptes) 
      if (id !== this.op.id) await this.majdoc(d, 1)

    // Incorporation de la consommation dans compta courante
    if (!this.op.SYS && this.op.compte) {
      const compta = await this.getCA(this.op.compte.id)
      await compta.incorpConso(this.op)
      await this.majCompta(compta)
    }

    // maj compte courant
    if (this.op.compte) await this.majdoc(this.op.compte, 1)

    // maj partitions (possiblement affectées aussi par maj des comptes O)
    for(const [,d] of this.partitions) await this.majpart(d)
    
    // maj syntheses possiblement affectées par maj des partitions
    if (this.synthese) await this.majsynth()
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
    this.ns = 0
    this.org = ''
    this.compte = null
  }

  /* Exécution de l'opération */
  async run () {
    console.log('Opération: ', this.nomop)
    this.gd = new GD(this)
    await this.phase1(this.args)

    await this.db.doTransaction(this) // Fait un appel à transac

    /* Envoi en cache des objets majeurs mis à jour / supprimés */  
    const updated = [] // rows mis à jour / ajoutés
    const deleted = [] // paths des rows supprimés
    this.toInsert.forEach(row => { if (GenDoc.majeurs.has(row._nom)) updated.push(row) })
    this.toUpdate.forEach(row => { if (GenDoc.majeurs.has(row._nom)) updated.push(row) })
    this.toDelete.forEach(row => { if (GenDoc.majeurs.has(row._nom)) deleted.push(row._nom + '/' + row.id) })
    Cache.update(updated, deleted)
    if (this.gd.espace) Esp.updEsp(this, this.gd.espace)

    await this.phase3(this.args) // peut ajouter des résultas

    if (this.db.hasWS && this.versions.length) SyncSession.toSync(this.versions)

    if (this.setR.has(R.RAL1)) await sleep(3000)
    if (this.setR.has(R.RAL2)) await sleep(6000)

    return this.result
  }

  async phase1 () { return }

  async phase2 () { return }

  async phase3 () { return }

  async transac () { // Appelé par this.db.doTransaction
    await this.auth() // this.compta est accessible (si authentifié)

    if (this.phase2) await this.phase2(this.args)

    this.result.dh = this.dh

    if (this.setR.has(R.FIGE)) return

    await this.gd.maj()

    if (this.toInsert.length) await this.db.insertRows(this, this.toInsert)
    if (this.toUpdate.length) await this.db.updateRows(this, this.toUpdate)
    if (this.toDelete.length) await this.db.deleteRows(this, this.toDelete)
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
    - this.compte this.compta
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
    if (t) 
      try { 
        authData = decode(b64ToU8(t)) 
        if (authData.shax) {
          try {
            const shax64 = Buffer.from(authData.shax).toString('base64')
            if (app_keys.admin.indexOf(shax64) !== -1) this.estAdmin = true
          } catch (e) { /* */ }
        }
        this.org = authData.org
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
    const espace = await this.gd.getESOrg(this.org, this.excFige === 2)
    
    /* Compte */
    this.compte = await this.gd.getCO(0, null, authData.hXR)
    if (!this.compte || this.compte.hXC !== authData.hXC) { 
      await sleep(3000); throw new AppExc(F_SRV, 998) 
    }
    this.id = this.compte.id
    this.estComptable = ID.estComptable(this.id)
    this.estA = !this.compte.idp
    // Opération du seul Comptable
    if (this.authMode === 2 && !ID.estComptable(this.id)) { 
      await sleep(3000); throw new AppExc(F_SRV, 104) 
    }
    // Recherche des restrictions
    if (!this.estComptable) {
      const ral = R.getRal(this.compte)
      if (ral) this.setR.add(ral)
      if (this.compte.qv.pcn >= 100) this.setR.add(R.NRED)
      if (this.compte.qv.pcv >= 100) this.setR.add(R.VRED)
      if (this.compte.idp) {
        if (this.compte.qv.pcc > 80) {
          if (this.compte.qv.pcc < 90) this.setR.add(R.RAL1)
          else if (this.compte.qv.pcc < 100) this.setR.add(R.RAL2)
          else this.setR.add(R.MINI)
        }
        const np = espace.tnotifP[this.compte.idp]
        let x = np ? np.nr : 0
        const nc = this.compte.notif
        if (nc && nc.nr > x) x = nc.nr
        if (x) {
          if (x === 2) this.setR.add(R.LECT)
          if (x === 3) this.setR.add(R.MINI)
        }
      } else {
        if (this.compte.qv.nbj < 20) {
          if (this.compte.qv.nbj <= 0) this.setR.add(R.MINI)
          else if (this.compte.qv.nbj < 10) this.setR.add(R.RAL2)
          else this.setR.add(R.RAL1)
        }
      }
    }

    // Facilité
    this.compta = await this.gd.getCA(this.id)
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

  idsChat (idI, idE) {
    return hash(crypterSrv(this.db.appKey, Buffer.from(ID.court(idI) + '/' + ID.court(idE)))) % d14
  }

  async getCheckEspace (fige) {
    const espace = await this.gd.getES(true)
    if (!espace || espace.clos) throw new AppExc(A_SRV, 999, espace.clos)
    if (fige && espace.fige) throw new AppExc(A_SRV, 999, espace.fige)
    return espace
  }

  /*
  decrypt (k, x) { return decode(decrypterSrv(k, Buffer.from(x))) }

  crypt (k, x) { return crypterSrv(k, Buffer.from(encode(x))) }
  */

  /* Helper d'accès depuis Cache */

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

  async getRowInvit (id, assert) {
    const cp = await Cache.getRow(this, 'invits', id)
    if (assert && !cp) throw assertKO('getRowInvit/' + assert, 12, [id])
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

  // async getVersionsDlv (dlvmin, dlvmax) { return this.db.getVersionsDlv(this, dlvmin, dlvmax) }

  // async getMembresDlv (dlvmax) {return this.db.getMembresDlv(this, dlvmax) }

  // async getMembresDlvat (ns, dlvat) {return this.db.getMembresDlvat(this, ns, dlvat) }

  // async getVersionsDlvat (ns, dlvat) {return this.db.getVersionsDlvat(this, ns, dlvat) }

  // async getGroupesDfh (dfh) { return this.db.getGroupesDfh(this, dfh) }

  // async setVdlv (id, dlv) { return this.db.setVdlv(this, id, dlv) }

  // async getChatVCV (id, ids, vcv) { return this.db.getChatVCV(this, id, ids, vcv) }

  // async getRowTicketV (id, ids, v) { return this.db.getRowTicketV(this, id, ids, v) }

  async getMembreVCV (id, ids, vcv) { return this.db.getMembreVCV(this, id, ids, vcv) }

  // async getAllRowsNote(id, v) { return await this.scoll('notes', id, v) }

  // async getAllRowsEspace () { return await this.coll('espaces') }

  // async getAllRowsChat(id, v) { return await this.scoll('chats', id, v)}

  // async getAllRowsTicket(id, v) { return await this.scoll('tickets', id, v) }

  // async getAllRowsSponsoring(id, v) { return await this.scoll('sponsorings', id, v) }

  // async getAllRowsMembre(id, v) { return await this.scoll('membres', id, v) }

  // async getAllRowsChatgr(id, v) { return await this.scoll('chatgrs', id, v) }

  async getRowNote (id, ids, assert) {
    const rs = await this.db.get(this, 'notes', ID.long(id, this.ns), ID.long(ids, this.ns))
    if (assert && !rs) throw assertKO('getRowNote/' + assert, 7, [ID.long(id, this.ns), ID.long(ids, this.ns)])
    return rs
  }

  async getRowChat (id, ids, assert) {
    const rc = await this.db.get(this, 'chats', ID.long(id, this.ns), ID.long(ids, this.ns))
    if (assert && !rc) throw assertKO('getRowChat/' + assert, 12, [ID.long(id, this.ns), ID.long(ids, this.ns)])
    return rc
  }
 
  async getRowTicket (id, ids, assert) {
    const rc = await this.db.get(this, 'tickets', ID.long(id, this.ns), ID.long(ids, this.ns))
    if (assert && !rc) throw assertKO('getRowTicket/' + assert, 17, [ID.long(id, this.ns), ID.long(ids, this.ns)])
    return rc
  }

  async getRowSponsoring (id, ids, assert) {
    const rs = await this.db.get(this, 'sponsorings', ID.long(id, this.ns), ID.long(ids, this.ns))
    if (assert && !rs) throw assertKO('getRowSponsoring/' + assert, 13, [ID.long(id, this.ns), ID.long(ids, this.ns)])
    return rs
  }

  async getRowMembre (id, ids, assert) {
    const rm = await this.db.get(this, 'membres', ID.long(id, this.ns), ID.long(ids, this.ns))
    if (assert && !rm) throw assertKO('getRowMembre/' + assert, 10, [ID.long(id, this.ns), ID.long(ids, this.ns)])
    return rm
  }

  async getRowChatgr (id, assert) {
    const rc = await this.db.get(this, 'chatgrs', ID.long(id, this.ns), 1)
    if (assert && !rc) throw assertKO('getRowChatgr/' + assert, 10, [ID.long(id, this.ns), 1])
    return rc
  }

  // async getSingletons () { return this.db.getSingletons(this) }

  // async setSingleton (data) { this.db.setSingleton(this, data) }

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

  /* Méthode de suppression d'un groupe */
  // eslint-disable-next-line no-unused-vars
  async supprGroupe (idg) {
    // TODO
  }

  /* Méthode de suppression d'un compte */
  // eslint-disable-next-line no-unused-vars
  async supprCompte (id) {
    // TODO
  }

}

