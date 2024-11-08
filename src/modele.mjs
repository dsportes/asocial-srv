import { encode, decode } from '@msgpack/msgpack'
import { ID, Cles, ESPTO, AppExc, A_SRV, F_SRV, E_SRV, Compteurs, AL, idTkToL6, AMJ } from './api.mjs'
import { config } from './config.mjs'
import { sleep, b64ToU8, crypter, quotes, sendAlMail } from './util.mjs'
import { Taches } from './taches.mjs'
import { GenDoc, compile, Versions, Comptes, Avatars, Groupes, 
  Chatgrs, Chats, Tickets, Sponsorings, Notes,
  Membres, Espaces, Partitions, Syntheses, Comptas, Comptis, Invits } from './gendoc.mjs'
import { genNotif, genLogin } from './notif.mjs'

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

/* Cache ************************************************************************
Cache des objets majeurs "tribus comptas avatars groupes" 
*/
export class Esp {
  static map = new Map()

  static orgs = new Map()

  static v = 0

  static dh = 0

  static async load (db) {
    const l = await db.getRowEspaces(Esp.v)
    l.forEach(r => {
      const ns = r.id
      Esp.map.set(ns, r)
      Esp.orgs.set(r.org, ns)
      if (r.v > Esp.v) Esp.v = r.v
    })
    Esp.dh = Date.now()
  }

  static actifs () {
    const l = []
    Esp.map.forEach(e => { if (!e.notif || e.notif.nr < 2) l.push(e.id) })
    return l
  }

  static inactifs () {
    const l = []
    Esp.map.forEach(e => { if (e.notif && e.notif.nr === 2) l.push(e.id) })
    return l
  }

  static async getEsp (op, ns, lazy, assert) {
    if (!lazy || (Date.now() - Esp.dh > ESPTO * 60000)) await Esp.load(op.db)
    if (!ns) { if (!assert) return null; assertKO(assert, 1, [op.ns]) }
    const espace = compile(Esp.map.get(ns))
    op.ns = ns
    op.org = espace.org
    return espace
  }

  static async getNsOrg (op, org, lazy) {
    if (!lazy || (Date.now() - Esp.dh > ESPTO * 60000)) await Esp.load(op.db)
    return Esp.orgs.get(org)
  }

  static async getEspOrg (op, org, lazy, assert) {
    const ns = await Esp.getNsOrg(op, org, lazy)
    if (!ns) { if (!assert) return null; assertKO(assert, 1, [ns]) }
    op.ns = ns
    op.org = org
    return compile(Esp.map.get(ns))
  }

  static updEsp(op, e) {
    const x = Esp.map.get(op.ns)
    if (!x || x.v < e.v) {
      const r = e.toRow(op)
      Esp.map.set(op.ns, r)
      Esp.orgs.set(e.org, op.ns)
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
      const n = await op.db.getV(nom, id, x.row.v)
      x.lru = now
      if (n && n.v > x.row.v) x.row = n // une version plus récente existe : mise en cache
      return x.row
    }
    const n = await op.db.getV(nom, id, 0)
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

/** class TrLog ******************************************************
Enregistre les changements:
- de l'espace
- du compte principal
- des versions des sous-arbres avatar et groupe
- des périmètres des comptes mis à jour quand ils ont changé
Un trLog peut concerner:
- un compte précis
- aucun compte précis pour une opération admin ou de GC notifiée
Une opération de GC non notifiée n'enregistra pas de trLog.
*/
class TrLog {
  constructor (op) {
    this.op = op
    if (!op.SYS) {
      this._maj = false
      this.vcpt = 0 // compte pas mis à jour
      this.vesp = 0 // espace du ns pas mis à jour
      this.avgr = new Map() // clé: ID de av / gr, valeur: version
      this.perimetres = new Map() // clé: ID du compte, valeur: {v, p} -version, périmètre
    }
  }

  fermer () {
    if (!this.op.SYS && this.op.compte && this.op.compte._maj) 
      this.vcpt = this.op.compte.v
  }

  get x () {
    const x = { vcpt: this.vcpt, vesp: this.vesp }
    const y = []
    for(const [id ,v] of this.avgr) 
      y.push([id, v])
    x.lag = y
    return x
  }

  get court () { 
    return !this.op.SYS ? this.x : null
  }

  get serialLong () {
    if (this.op.SYS) return null
    const x = this.x
    if (this.op.id) x.cid = this.op.id
    if (this.perimetres.size) {
      const y = []; for(const e of this.perimetres) y.push(e)
      x.lp = y
    }
    return encode(x)
  }

  addAvgr (ag, v) { if (!this.op.SYS) { this.avgr.set(ag, v.v); this._maj = true } }

  setEsp (vesp) { if (!this.op.SYS) { this.vesp = vesp; this._maj = true } }

  setCpt (cpt, p) {
    if (!this.op.SYS) {
      this._maj = true
      this.perimetres.set(cpt.id, { v: cpt.v, vpe: p ? cpt.v : 0, p: p})
    }
  }

}

/** class GD : gestionnaires des documents d'une opération ***************************/
class GD {
  constructor (op) {
    this.op = op

    this.trLog = new TrLog(op)

    this.espace = null
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
    const e = Espaces.nouveau(org, this.op.auj, cleES)
    this.espace = e
    this.synthese = Syntheses.nouveau(ns)
    return e
  }

  // Depuis Authentification : l'espace a été obtenu depuis org et non son id
  setEspace (espace) {
    this.espace = espace
  }

  async getEspace () { 
    if (!this.espace)
      this.espace = await this.op.setEspaceNs(this.op.ns, true)
    return this.espace
  }

  async getSY () {
    if (!this.synthese) {
      this.synthese = compile(await Cache.getRow(this.op, 'syntheses', ''))
      if (!this.synthese) throw assertKO('getSy', 16, [this.op.ns])
    }
    return this.synthese
  }

  /* Nouvelle partition de l'espace courant. Comptable est le compte courant */
  async nouvPA (id, qc) {
    const p = Partitions.nouveau(id, qc)
    this.partitions.set(id, p)
    const esp = await this.getEspace()
    esp.setPartition(p)
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
    c.mdcnx = Math.floor(AMJ.amjUtcDeT(this.op.dh) / 100)
    this.comptes.set(c.id, c)
    const compta = Comptas.nouveau(c.id, quotas, don || 0, c.estA)
    this.comptas.set(c.id, compta)
    const compti = Comptis.nouveau(c.id)
    this.comptis.set(compti.id, compti)
    const invit = Invits.nouveau(c.id)
    this.invits.set(invit.id, invit)
    return { compte:c, compta, compti, invit }
  }

  async getCO (id, assert, hXR) {
    let c
    let t = false
    if (id) {
      c = this.comptes.get(id)
      if (c) t = true; else c = compile(await this.op.getRowCompte(id))
    } else
      c = compile(await this.op.db.getCompteHk(ID.long(hXR, this.op.ns)))
    if (!c) { 
      if (!assert) return null; else assertKO(assert, 4, [c.id]) }
    if (!t) this.comptes.set(c.id, c)
    return c
  }

  async getCI (id, assert) {
    let c
    if (id) c = this.comptis.get(id)
    if (c) return c
    c = compile(await this.op.getRowCompti(id))
    if (!c || !await this.getCO(c.id)) { 
      if (!assert) return null; else assertKO(assert, 12, [c.id]) }
    this.comptis.set(id, c)
    return c
  }

  async getIN (id, assert) {
    let c
    if (id) c = this.invits.get(id)
    if (c) return c
    c = compile(await this.op.getRowInvit(id))
    if (!c || !await this.getCO(c.id)) { 
      if (!assert) return null; else assertKO(assert, 11, [id]) }
    this.invits.set(id, c)
    return c
  }

  async getCA (id, assert) {
    let c = this.comptas.get(id)
    if (c) return c
    c = compile(await this.op.getRowCompta(id))
    if (!c || !await this.getCO(c.id)) { 
      if (!assert) return null; else assertKO(assert, 3, [c.id]) }
    this.comptas.set(id, c)
    return c
  }

  nouvAV (args, cvA) {
    const a = Avatars.nouveau(args, cvA)
    a.idc = this.op.compte.id
    this.op.compte.ajoutAvatar(a, args.cleAK)
    this.avatars.set(a.id, a)
    this.nouvV(a.id)
    return a
  }

  async getAV (id, assert) {
    let a = this.avatars.get(id)
    if (a) return a
    a = compile(await this.op.getRowAvatar(id))
    if (!a) { 
      if (!assert) return null; else assertKO(assert, 8, [id]) }
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
    av = await this.op.db.getAvatarVCV(ID.long(id, this.op.ns) , vcv)
    disp = (!av)
    if (disp) return { disp }
    this.avatars.set(id, av)
    disp = false
    return av.vcv > vcv ? { av, disp } : { disp }
  }

  nouvGR (args) {
    const g = Groupes.nouveau(args)
    g.idh = this.op.compte.id
    this.op.compte.ajoutGroupe(g.id, args.ida, args.cleGK)
    this.groupes.set(g.id, g)
    this.nouvV(g.id)
    const ch = Chatgrs.nouveau(g.id)
    this.sdocs.set(g.id + '/CGR/', ch)
    return g
  }

  async getGR (id, assert) {
    let g = this.groupes.get(id)
    if (g) return g
    g = compile(await this.op.getRowGroupe(id))
    if (!g) { 
      if (!assert) return null; else assertKO(assert, 9, [g.id]) }
    this.groupes.set(id, g)
    return g
  }

  async getCGR (id, assert) {
    const k = id + '/CGR/'
    let d = this.sdocs.get(k)
    if (d) return d
    d = compile(await this.op.getRowChatgr(id))
    if (!d || !await this.getV(d.id)) { 
      if (!assert) return null; else assertKO(assert, 17, [k]) }
    this.sdocs.set(k, d)
    return d
  }

  async nouvMBR (id, im, cvA, cleAG, assert) {
    const k = id + '/MBR/' + im
    const g = await this.getGR(id, assert)
    const m = Membres.nouveau(id, im, cvA, cleAG)
    if (!g || !await this.getV(id)) { 
      if (!assert) return null; else assertKO(assert, 10, [k]) }
    this.sdocs.set(k, m)
    return m
  }

  async getMBR (id, im, assert) {
    const k = id + '/MBR/' + im
    let d = this.sdocs.get(k)
    if (d) return d
    d = compile(await this.op.getRowMembre(id, im))
    if (!d || !await this.getV(d.id)) { 
      if (!assert) return null; else assertKO(assert, 10, [k]) }
    this.sdocs.set(k, d)
    return d
  }

  async nouvCAV (args, assert) {
    const k = args.id + '/CAV/' + args.ids
    const d = Chats.nouveau(args)
    if (!await this.getV(d.id)) { 
      if (!assert) return null; else assertKO(assert, 5, [k]) }
    this.sdocs.set(k, d)
    return d
  }

  async getCAV (id, ids, assert) {
    const k = id + '/CAV/' + ids
    let d = this.sdocs.get(k)
    if (d) return d
    d = compile(await this.op.getRowChat(id, ids))
    if (!d || !await this.getV(d.id)) { 
      if (!assert) return null; else assertKO(assert, 5, [k]) }
    this.sdocs.set(k, d)
    return d
  }

  async getAllCAV (id) {
    const l = []
    for (const row of await this.op.db.scoll('chats', ID.long(id, this.op.ns), 0)) {
      const k = id + '/CAV/' + row.ids
      let d = this.sdocs.get(k)
      if (!d) {
        d = compile(row)
        await this.getV(d.id)
        this.sdocs.set(k, d)
      }
      l.push(d)
    }
    return l
  }

  async nouvTKT (id, args, assert) {
    const idc = ID.duComptable()
    const k = idc + '/TKT/' + args.ids

    const d = Tickets.nouveau(id, args)
    d.id = idc
    d.dg = this.op.auj
    if (!await this.getV(d.id)) { 
      if (!assert) return null; else assertKO(assert, 15, [k]) }
    this.sdocs.set(k, d)
    return d
  }

  async getTKT (ids, assert) {
    const idc = ID.duComptable()
    const k = idc + '/TKT/' + ids
    let d = this.sdocs.get(k)
    if (d) return d
    d = compile(await this.op.getRowTicket(idc, ids))
    if (!d || !await this.getV(d.id)) { 
      if (!assert) return null; else assertKO(assert, 15, [k]) }
    this.sdocs.set(idc + '/TKT/' + ids, d)
    return d
  }

  async nouvSPO (args, ids, assert) {
    const k = args.id + '/SPO/' + ids
    const d = Sponsorings.nouveau(args, ids)
    d.dh = this.op.dh
    if (!await this.getV(d.id)) { 
      if (!assert) return null; else assertKO(assert, 13, [k]) }
    this.sdocs.set(k, d)
    return d
  }

  async getSPO (id, ids, assert) {
    const k = id + '/SPO/' + ids
    let d = this.sdocs.get(k)
    if (d) return d
    d = compile(await this.op.getRowSponsoring(id, ids))
    if (!d || !await this.getV(d.id)) { 
      if (!assert) return null; else assertKO(assert, 13, [k]) }
    this.sdocs.set(k, d)
    return d
  }

  async nouvNOT (id, ids, par, assert) {
    const k = id + '/NOT/' + ids
    const d = Notes.nouveau(id, ids, par)
    if (!await this.getV(d.id)) { 
      if (!assert) return null; else assertKO(assert, 13, [k]) }
    this.sdocs.set(k, d)
    return d
  }

  async getNOT (id, ids, assert) {
    const k = id + '/NOT/' + ids
    let d = this.sdocs.get(k)
    if (d) return d
    d = compile(await this.op.getRowNote(id, ids))
    if (!d || !await this.getV(d.id)) { 
      if (!assert) return null; else assertKO(assert, 13, [k]) }
    this.sdocs.set(k, d)
    return d
  }

  async getV (id) {
    let v = this.versions.get(id)
    if (!v) {
      v = compile(await this.op.getRowVersion(id))
      if (v) this.versions.set(id, v)
    }
    return !v || v.dlv ? null : v
  }

  nouvV (id) {
    const v = Versions.nouveau(id)
    v.v = 0
    this.versions.set(id, v)
  }

  // Met à jour le version d'un doc ou sous-doc. S'il avait déjà été incrémenté, ne fait rien
  async majV (id, suppr) { 
    let v = this.versions.get(id)
    if (!v) {
      v = await this.getV(id)
      if (!v) assertKO('majV', 20, [id])
    }
    if (!v._maj) {
      v._vav = v.v
      v.v++
      v._maj = true
      if (suppr) v.dlv = this.op.auj
      const rv = v.toRow(this.op)
      if (v.v === 1) this.op.insert(rv); else this.op.update(rv)
      this.trLog.addAvgr(id, v)  
    }
    return v.v
  }

  async majdoc (d) {
    if (d._suppr) { 
      if (d.ids) { // pour membres, notes, chats, sponsorings, tickets
        await this.majV(d.id)
        this.op.delete({ _nom: d._nom, id: ID.long(d.id, this.op.ns), ids: ID.long(d.ids, this.op.ns) })
      } else { // pour groupes, avatars, comptes, comptas, invits, comptis
        await this.majV(d.id, true)
        this.op.delete({ _nom: d._nom, id: ID.long(d.id, this.op.ns) })
      }
    } else if (d._maj) {
      const ins = d.v === 0
      d._vav = d.v
      d.v = await this.majV(d.id)
      if (d._nom === 'avatars') {
        if (d.cvA && !d.cvA.v) { d.vcv = d.v; d.cvA.v = d.v }
      } else if (d._nom === 'groupes') {
        if (d.cvG && !d.cvG.v) d.cvG.v = d.v
      }
      if (ins) this.op.insert(d.toRow(this.op))
      else this.op.update(d.toRow(this.op))
    }
  }

  async majesp (d) {
    if (d._maj) {
      const ins = d.v === 0
      d._vav = d.v
      d.v++
      this.trLog.setEsp(d.v)
      if (ins) this.op.insert(d.toRow(this.op)); else this.op.update(d.toRow(this.op))
    }
  }

  async majCompta (compta) { // ET report dans compte -> partition
    if (compta._suppr) {
      this.op.delete({ _nom: 'comptas', id: ID.long(compta.id, this.op.ns) })
    } else if (compta._maj) {
      compta._vav = compta.v
      compta.v++
      const compte = await this.getCO(compta.id)
      await compte.reportDeCompta(compta, this)
      if (compta.v === 1) this.op.insert(compta.toRow(this.op)); else this.op.update(compta.toRow(this.op))
    }
  }

  async majCompti (compti) {
    if (compti._maj) {
      compti._vav = compti.v
      const compte = await this.getCO(compti.id)
      if (compte) compte.setCI()
    }
  }

  async majInvit (invit) {
    if (invit._maj) {
      invit._vav = invit.v
      const compte = await this.getCO(invit.id)
      if (compte) compte.setIN()
    }
  }

  async majCompte (compte) {
    if (compte._suppr) {
      this.op.delete({ _nom: 'comptes', id: ID.long(compte.id, this.op.ns) })
    } else if (compte._maj) {
      compte._vav = compte.v
      let compti, invit, p
      compte.v++
      if (compte.v === 1) {
        p = compte.perimetre
        compti = await this.getCI(compte.id); compti.v = 1
        invit = await this.getIN(compte.id); invit.v = 1
        compte.vci = 1; compte.vpe = 1; compte.vci = 1; compte.vin = 1
        this.op.insert(compte.toRow(this.op))
        this.op.insert(compti.toRow(this.op))
        this.op.insert(invit.toRow(this.op))
      } else {
        p = compte.perimetreChg
        if (p) compte.vpe = compte.v
        if (compte._majci) {
          compti = await this.getCI(compte.id); compti.v = compte.v
          compte.vci = compte.v
          this.op.update(compti.toRow(this.op))
        }
        if (compte._majin) {
          invit = await this.getIN(compte.id); invit.v = compte.v
          compte.vin = compte.v
          this.op.update(invit.toRow(this.op))
        }
        this.op.update(compte.toRow(this.op))
      }
      this.trLog.setCpt(compte, p)
    }
  }

  async majpart (p) {
    if (p._suppr) {
      this.op.delete({ _nom: 'partitions', id: ID.long(p.id, this.op.ns) })
    } else if (p._maj) {
      p._vav = p.v
      p.v++
      if (p.v === 1) this.op.insert(p.toRow(this.op)); else this.op.update(p.toRow(this.op))
      const s = await this.getSY()
      s.setPartition(p)
    }
  }

  async majsynth () {
    const s = this.synthese
    if (s && s._maj) {
      s._vav = s.v
      s.v++
      if (s.v === 1) this.op.insert(s.toRow(this.op)); else this.op.update(s.toRow(this.op))
    }
  }

  async maj () {
    for(const [,d] of this.avatars) await this.majdoc(d)
    for(const [,d] of this.groupes) await this.majdoc(d)
    for(const [,d] of this.sdocs) await this.majdoc(d)
    for(const [,d] of this.comptis) await this.majCompti(d)
    for(const [,d] of this.invits) await this.majInvit(d)
    if (this.espace) await this.majesp(this.espace)
    
    // comptas SAUF celle du compte courant
    for(const [id, d] of this.comptas) 
      if (id !== this.op.id) await this.majCompta(d)

    // comptes SAUF le compte courant
    for(const [id, d] of this.comptes) 
      if (id !== this.op.id) await this.majCompte(d)

    // Incorporation de la consommation dans compta courante
    if (!this.op.SYS && this.op.compte) {
      const compta = await this.getCA(this.op.compte.id)
      await compta.incorpConso(this.op)
      await this.majCompta(compta)
    }

    // maj compte courant
    if (this.op.compte) await this.majCompte(this.op.compte)

    // maj partitions (possiblement affectées aussi par maj des comptes O)
    for(const [,d] of this.partitions) await this.majpart(d)
    
    // maj syntheses possiblement affectées par maj des partitions
    if (this.synthese) await this.majsynth()
  }

}

/** Operation *****************************************************/
export class Operation {
  static mindh = new Date('2024-01-01').getTime()
  static maxdh = new Date('2099-12-31').getTime()

  /* Initialisé APRES constructor() dans l'invocation d'une opération
    this... isGet, db, storage, args, dh
  */
  constructor (nomop, authMode, excFige) { 
    this.nomop = nomop
    this.authMode = authMode
    this.excFige = excFige || 1
    this.dh = Date.now()
    this.ns = 0
    this.org = ''
  }

  reset () {
    this.dh = Date.now()
    this.auj = AMJ.amjUtcDeT(this.dh)
    if (config.mondebug) 
      config.logger.debug(this.nomop + ' : ' + new Date(this.dh).toISOString())
    this.flags = 0
    this.nl = 0; this.ne = 0; this.vd = 0; this.vm = 0
    this.result = { dh: this.dh }
    this.toInsert = []
    this.toUpdate = []
    this.toDelete = []
    this.compte = null
    this.gd = new GD(this)
  }

  /* Exécution de l'opération */
  async run (args, dbp, storage) {
    try {
      this.args = args
      this.dbp = dbp
      this.storage = storage
      if (!this.SYS) await this.auth1()
      this.phase1(this.args)

      for (let retry = 0; retry < 3; retry++) {
        this.reset()
        await dbp.connect(this)
        const [st, detail] = await this.db.doTransaction() // Fait un appel à transac
        if (st === 0) break // transcation OK
        if (st === 1) { // DB lock / contention
          if (retry === 2) throw new AppExc(E_SRV, 10, [detail])
          await sleep(1000)
        } else if (st === 2) // DB error
          throw new AppExc(E_SRV, 11, [detail])
      }

      /* Envoi en cache des objets majeurs mis à jour / supprimés */  
      const updated = [] // rows mis à jour / ajoutés
      const deleted = [] // paths des rows supprimés
      this.toInsert.forEach(row => { if (GenDoc.majeurs.has(row._nom)) updated.push(row) })
      this.toUpdate.forEach(row => { if (GenDoc.majeurs.has(row._nom)) updated.push(row) })
      this.toDelete.forEach(row => { if (GenDoc.majeurs.has(row._nom)) deleted.push(row._nom + '/' + row.id) })
      Cache.update(updated, deleted)
      if (this.gd.espace) Esp.updEsp(this, this.gd.espace)

      await this.phase3(this.args) // peut ajouter des résultas

      let nhb
      if (this.subJSON) {
        if (this.subJSON.startsWith('???'))
          console.log('subJSON=', this.subJSON)
        else
          nhb = await genLogin(this.ns, this.org, this.sessionId, this.subJSON, this.id, 
            this.compte.perimetre, this.compte.vpe)
      } else if (this.gd.trLog._maj) {
        this.gd.trLog.fermer()
        const sc = this.gd.trLog.court // sc: { vcpt, vesp, lag }
        if (sc) this.setRes('trlog', sc)
        
        const sl = this.gd.trLog.serialLong
        if (sl)
          nhb = await genNotif(this.ns, this.sessionId || null, sl)
      }
      if (nhb !== undefined) this.setRes('nhb', nhb)

      if (this.aTaches) Taches.startDemon(this)

      if (AL.has(this.flags, AL.RAL1)) await sleep(100)
      if (AL.has(this.flags, AL.RAL2)) await sleep(3000)
      
      return this.result
    } catch (e) {
      if (config.mondebug) 
        config.logger.error(this.nomop + ' : ' + new Date(this.dh).toISOString() + ' : ' + e.toString())
      throw e
    }
  }

  phase1 (args) { 
    args.x = '$'
    const op = this.nomop
    function ko (n) { 
      throw new AppExc(A_SRV, 13, [op, n]) 
    }
    if (this.targs) for (const n in this.targs) {
      const e = this.targs[n]
      const v = args[n]
      if (e.n && !v) continue
      const tof = Array.isArray(v) ? 'array' : (typeof v)
      switch (e.t) {
        case 'ida' : {
          if (ID.type(v) !== 3) ko(n)
          break
        }
        case 'idg' : {
          if (ID.type(v) !== 4) ko(n)
          break
        }
        case 'idag' : {
          if (ID.type(v) !== 3 && ID.type(v) !== 4) ko(n)
          break
        }
        case 'idp' : {
          if (ID.type(v) !== 2) ko(n)
          break  
        }
        case 'idf' : {
          if (ID.type(v) !== 8) ko(n)
          break  
        }
        case 'ids' : {
          if (!ID.estID(v)) ko(n)
          break
        }
        case 'org' : {
          if (tof !== 'string' || v.length <4 || v.length > 8
            || !v.match(ID.regorg) ) ko(n)
          break
        }
        case 'u8' : {
          if (v instanceof Uint8Array && v.length > 0) break
          ko(n)
        }
        case 'string' : {
          if (tof !== 'string') ko(n)
          break
        }
        case 'int' : {
          if (tof !== 'number' || !Number.isInteger(v)) ko(n)
          if (e.min !== undefined && v < e.min) ko(n)
          if (e.max !== undefined && v > e.max) ko(n)
          break
        }
        case 'dh' : {
          if (tof !== 'number' || !Number.isInteger(v)) ko(n)
          if (v < Operation.mindh || v > Operation.maxdh) ko(n)
          break
        }
        case 'bool' : {
          if (tof !== 'boolean') ko(n)
          break            
        }
        case 'q' : {
          if (tof !== 'object') ko(n)
          if (!Number.isInteger(v.qc) || v.qc < 0) ko(n)
          if (!Number.isInteger(v.qn) || v.qn < 0) ko(n)
          if (!Number.isInteger(v.qv) || v.qv < 0) ko(n)
          break
        }
        case 'q2' : {
          if (tof !== 'object') ko(n)
          if (!Number.isInteger(v.qn) || v.qn < 0) ko(n)
          if (!Number.isInteger(v.qv) || v.qv < 0) ko(n)
          break
        }
        case 'cv' : {
          if (tof !== 'object') ko(n)
          if (ID.type(v.id) !== 3 && ID.type(v.id) !== 4) ko(n)
          if (v.ph && !(v.ph instanceof Uint8Array || v.ph.length > 0)) ko(n)
          if (ID.estComptable(v.id)) {
            if (v.tx) ko(n)
          } else {
            if (!v.tx || !(v.tx instanceof Uint8Array || v.tx.length > 0)) ko(n)
          }
          break
        }
        case 'fic' : { // { idf, lg, ficN }
          if (tof !== 'object') ko(n)
          if (!v.idf || ID.type(v.idf) !== 8) ko(n)
          if (!v.lg || (!Number.isInteger(v.lg) || v.lg <= 0)) ko(n)
          if (!v.ficN || !(v.ficN instanceof Uint8Array)) ko(n)
          break
        }
        case 'ntf' : { // { nr, dh, texte }
          if (tof !== 'object') ko(n)
          if (typeof v.dh !== 'number' || !Number.isInteger(v.dh)) ko(n)
          if (v.dh < Operation.mindh || v.dh > Operation.maxdh) ko(n)
          if (!v.nr || !Number.isInteger(v.nr) || v.nr < 1 || v.nr > 3) ko(n)
          if (v.texte && !(v.texte instanceof Uint8Array)) ko(n)
          break
        }
        case 'lidf' : {
          if (tof !== 'array') ko(n)
          let b = true
          v.forEach(id => { if (ID.type(id) !== 8) b = false } )
          if (!b) ko(n)
          break
        }
        case 'lids' : {
          if (tof !== 'array') ko(n)
          let b = true
          v.forEach(id => { if (ID.type(id) !== 3 && ID.type(id) !== 4) b = false } )
          if (!b) ko(n)
          break
        }
        case 'idch' : {
          if (tof !== 'array' || v.length !== 2) ko(n)
          if (ID.type(v[0]) !== 3) ko(n)
          if (!ID.estID(v[1])) ko(n)
        }
        case 'array' : {
          if (v instanceof Array) break
          ko(n)
        }
        case 'ns' : {
          if (tof !== 'string' || v.length !== 1) ko(n)
          if (Cles.nsToInt(v) === -1) ko(n)
          break
        }
        case 'nvch' : { // chsp: { ccK, ccP, cleE1C, cleE2C, t1c, t2c }
          if (tof !== 'object') ko(n)
          if (!v.ccK || !(v.ccK instanceof Uint8Array)) ko(n)
          if (!v.ccP || !(v.ccP instanceof Uint8Array)) ko(n)
          if (!v.cleE1C || !(v.cleE1C instanceof Uint8Array)) ko(n)
          if (!v.cleE2C || !(v.cleE2C instanceof Uint8Array)) ko(n)
          break
        }
        case 'chsp' : { // chsp: { ccK, ccP, cleE1C, cleE2C, t1c, t2c }
          if (tof !== 'object') ko(n)
          if (!v.ccK || !(v.ccK instanceof Uint8Array)) ko(n)
          if (!v.ccP || !(v.ccP instanceof Uint8Array)) ko(n)
          if (!v.cleE1C || !(v.cleE1C instanceof Uint8Array)) ko(n)
          if (!v.cleE2C || !(v.cleE2C instanceof Uint8Array)) ko(n)
          if (!v.t1c || !(v.t1c instanceof Uint8Array)) ko(n)
          if (!v.t2c || !(v.t2c instanceof Uint8Array)) ko(n)
          break
        }
      }
    }
  }

  async phase2 () { return }

  async phase3 () { return }

  async transac () { // Appelé par this.db.doTransaction
    if (!this.SYS && !this.estAdmin && this.authMode !== 0)
      await this.auth2() // this.compta est accessible (si authentifié)
    if (this.phase2) await this.phase2(this.args)
    if (AL.has(this.flags, AL.FIGE)) return
    await this.gd.maj()
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
    - this.id this.ns this.estA
    - this.compte this.compta
    - this.flags : set des restictions
  */
  async auth1 () {
    const app_keys = config.app_keys
    if (this.authMode < 0 || this.authmode > 3) throw new AppExc(A_SRV, 19, [this.authMode]) 

    const t = this.args.token
    if (!t && this.authMode !== 0) { 
      await sleep(3000)
      throw new AppExc(F_SRV, 205) 
    } 
    this.authData = null
    this.estAdmin = false
    if (!t) {
      if (this.authMode === 3) { await sleep(3000); throw new AppExc(F_SRV, 999) }
      return
    }
    try { 
      this.authData = decode(b64ToU8(t))
      this.sessionId = this.authData.sessionId || ''
      if (this.authData.shax) {
        try {
          const shax64 = Buffer.from(this.authData.shax).toString('base64')
          if (app_keys.admin.indexOf(shax64) !== -1) {
            this.estAdmin = true
            this.ns = ''
          }
        } catch (e) { /* */ }
      }
      this.org = this.authData.org
    } catch (e) { 
      await sleep(3000)
      throw new AppExc(F_SRV, 206, [e.message])
    }
  }

  async auth2 () {
    this.flags = 0

    /* Espace: rejet de l'opération si l'espace est "clos" - Accès LAZY */
    const espace = await Esp.getEspOrg (this, this.org, true)
    if (!espace) { await sleep(3000); throw new AppExc(F_SRV, 996) }
    espace.excFerme()
    if (this.excFige === 2) espace.excFige()
    if (espace.fige) AL.add(this.flags, AL.FIGE)
    
    /* Compte */
    this.compte = await this.gd.getCO(0, null, this.authData.hXR)
    if (!this.compte || this.compte.hXC !== this.authData.hXC) { 
      await sleep(3000); throw new AppExc(F_SRV, 998) 
    }

    /* La dlv a été calculée à la fin de l'opération précédente, potentiellement des mois avant
    A cette date, elle a été fixée, d'après la date-heure de connexion et
    pour un compte A à la ddsn (date de début de solde négatif). 
    Celle-ci a été estimée en supposant aucune consommation, seulement sur l'impact
    du coût journalier d'abonnement sur le solde.
    Donc cette dlv (calculée peut-être il y a longtemps) est VALIDE maintenant.
    */
    if (this.compte.dlv < this.auj) { 
      await sleep(3000); throw new AppExc(F_SRV, 997) 
    }

    this.id = this.compte.id
    this.estComptable = ID.estComptable(this.id)
    this.estA = !this.compte.idp

    // Opération du seul Comptable
    if (this.authMode === 2 && !this.estComptable) { 
      await sleep(3000); throw new AppExc(F_SRV, 104) 
    }

    // Recherche des restrictions dans compta
    this.compta = await this.gd.getCA(this.id)
    this.compta.addFlags(this.flags)

    // Recherche des restrictions dans compte
    if (!this.estComptable && this.compte.idp) {
      const np = espace.tnotifP[this.compte.idp]
      let x = np ? np.nr : 0
      const nc = this.compte.notif
      if (nc && nc.nr > x) x = nc.nr
      if (x) {
        if (x === 2) AL.add(this.flags, AL.LSNTF)
        if (x === 3) AL.add(this.flags, AL.ARNTF)
      }
    }
  }

  async alerte (sub) {
    const al = config.alertes
    if (!al) return
    const al1 = sub === 'chat' ? al[this.org] : al['admin']
    if (!al1) return
    await sendAlMail(config.run.site, this.org || 'admin', al1, sub)
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

  /*
  idsChat (idI, idE) {
    return Cles.hash9(crypterSrv(this.db.appKey, Buffer.from(idI + '/' + idE)))
  }
  */

  async checkEspaceOrg (org, fige) {
    // espace seulement pour checking
    const espace = await Esp.getEspOrg(this, org, true, this.nomop + '-checkEspace') // set this.ns
    espace.excFerme()
    if (fige) espace.excFerme()
    this.ns = Esp.orgs.get(org)
    this.org = org
    return espace
  }

  async checkEspaceNs (ns, fige) {
    // espace seulement pour checking
    const espace = await Esp.getEsp(this, ns, true, this.nomop + '-checkEspace') // set this.ns
    espace.excFerme()
    if (fige) espace.excFerme()
    this.ns = ns
    this.org = espace.org
    return espace
  }

  async setEspaceOrg (org, fige) {
    const espace = await Esp.getEspOrg(this, org, false, this.nomop + '-checkEspace') // set this.ns
    if (fige) espace.excFerme()
    this.gd.setEspace(espace)
    this.ns = Esp.orgs.get(org)
    this.org = org
    return espace
  }

  async setEspaceNs (ns, fige) {
    const espace = await Esp.getEsp(this, ns, false, this.nomop + '-checkEspace') // set this.ns
    if (!this.estAdmin) espace.excFerme()
    if (fige) espace.excFerme()
    this.gd.setEspace(espace)
    this.ns = ns
    this.org = espace.org
    return espace
  }

  /*
  decrypt (k, x) { return decode(decrypterSrv(k, Buffer.from(x))) }

  crypt (k, x) { return crypterSrv(k, Buffer.from(encode(x))) }
  */

  /* Helper d'accès depuis Cache */

  async getRowPartition (id, assert) {
    const p = await Cache.getRow(this, 'partitions', id)
    if (assert && !p) throw assertKO('getRowPartition/' + assert, 2, [id])
    return p
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
  // async delAvGr (id) { await this.db.delAvGr(this, id)}

  // async coll (nom) { return await this.db.coll(this, nom) }

  // async collNs (nom, ns) { return this.db.collNs(nom, ns) }

  // async scoll (nom, id, v) { return this.db.scoll(nom, id, v) }

  // async delScoll (nom, id) { return this.db.delScollSql(this, nom, id) }

  async getRowNote (id, ids, assert) {
    const rs = await this.db.get('notes', ID.long(id, this.ns), ID.long(ids, this.ns))
    if (assert && !rs) throw assertKO('getRowNote/' + assert, 7, [ID.long(id, this.ns), ID.long(ids, this.ns)])
    return rs
  }

  async getRowChat (id, ids, assert) {
    const rc = await this.db.get('chats', ID.long(id, this.ns), ID.long(ids, this.ns))
    if (assert && !rc) throw assertKO('getRowChat/' + assert, 12, [ID.long(id, this.ns), ID.long(ids, this.ns)])
    return rc
  }
 
  async getRowTicket (id, ids, assert) {
    const rc = await this.db.get('tickets', ID.long(id, this.ns), ID.long(ids, this.ns))
    if (assert && !rc) throw assertKO('getRowTicket/' + assert, 17, [ID.long(id, this.ns), ID.long(ids, this.ns)])
    return rc
  }

  async getRowSponsoring (id, ids, assert) {
    const rs = await this.db.get('sponsorings', ID.long(id, this.ns), ID.long(ids, this.ns))
    if (assert && !rs) throw assertKO('getRowSponsoring/' + assert, 13, [ID.long(id, this.ns), ID.long(ids, this.ns)])
    return rs
  }

  async getRowMembre (id, ids, assert) {
    const rm = await this.db.get('membres', ID.long(id, this.ns), ID.long(ids, this.ns))
    if (assert && !rm) throw assertKO('getRowMembre/' + assert, 10, [ID.long(id, this.ns), ID.long(ids, this.ns)])
    return rm
  }

  async getRowChatgr (id, assert) {
    const rc = await this.db.get('chatgrs', ID.long(id, this.ns), ID.long(1, this.ns))
    if (assert && !rc) throw assertKO('getRowChatgr/' + assert, 10, [ID.long(id, this.ns), 1])
    return rc
  }

  async purgeTransferts (idag, idf) {
    await this.db.purgeTransferts(this.ns + idag, idf)
  }

  async setFpurge (idag, lidf) {
    const id = this.ns + ID.rnd()
    const _data_ = new Uint8Array(encode({ id, idag, lidf }))
    await this.db.setFpurge(id, _data_)
    return id
  }

  async unsetFpurge (id) {
    await this.db.unsetFpurge(id) 
  }

  /* Méthode de suppression d'un groupe */
  async supprGroupe (gr) {
    // suppression des invitations / contacts
    for (let im = 1; im < gr.st.length; im++) {
      const s = gr.st[im]
      if (s > 0 && s < 4) {
        const ida = gr.tid[im]
        const av = await this.gd.getAV(ida)
        if (av) {
          const invits = await this.gd.getIN(av.idc) 
          if (invits) invits.supprGrInvit(gr.id)
          const compte = await this.gd.getCO(av.idc)
          if (compte) {
            compte.supprGroupe(gr.id)
            const compta = await this.gd.getCA(av.idc)
            if (compta) {
              compta.ngPlus(-1)
              if (im === gr.imh) compta.finHeb(gr.nn, gr.vf)
            }
          }
        }
      }
    }
    gr.setZombi() // suppression du groupe et de son chatgrs
    this.delete({ _nom: 'chatgrs', id: gr.id, ids: 1 })
    // tâches de suppression de tous les membres et des notes
    await Taches.nouvelle(this, Taches.GRM, gr.id, 0)
    await Taches.nouvelle(this, Taches.AGN, gr.id, 0)
  }

  /* Méthode de mise à jour des CV des membres d'un groupe */
  async majCvMbr (idg) {
    let nc = 0, nv = 0
    const gr = await this.gd.getGR(idg)
    if (!gr) return [nc, nv]
    for (let im = 1; im < gr.tid.length; im++) {
      const idm = gr.tid[im]
      if (idm) {
        const mbr = await this.gd.getMBR(idg, im)
        if (mbr) {
          nv++
          /* Retourne { disp, av }
          - avatar s'il existe ET que sa CV est plus récente que vcv
          - disp: true avatar a disparu
          */
          const {disp, av} = await this.gd.getAAVCV(idm, mbr.vcv)
          if (!disp && av) { mbr.setCvA(av.cvA); nc++ }
        }
      }
    }
    return [nc, nv]
  }

  /* Méthode de contrôle des invitations d'un groupe
  vis à vis du statut d'anaimateur des invitants
  */
  async checkAnimInvitants (gr) {
    /* Vérifie que les invitants sont bien animateurs, sinon:
    - met à jour ou supprime invits
    - liste les ida des avatars dont les invitations sont à supprimer
    - Map des ida des avatars dont les invitations sont à mettre à jour:
      - value: set des ids des invitants
    */
    const idas= gr.majInvits()
    for (const [ida, {rc, setInv}] of idas) {
      const av = await this.gd.getAV(ida)
      if (av) {
        const invit = await this.gd.getIN(av.idc)
        if (invit) {
          if (rc) invit.retourContact(gr.id, ida)
          else invit.majInvpar(gr.id, ida, setInv)
        }
      }
    }
  }

  async resilAvatar (av) {
    /* Gestion de ses groupes et invits */
    const sg = new Set()
    const invits = await this.gd.getIN(av.idc)
    if (invits) invits.setDesGroupes(av.id, sg)
    this.compte.setDesGroupes(av.id, sg)

    for(const idg of sg) {
      const gr = await this.gd.getGR(idg)
      if (!gr) continue
      const { im, estHeb, nbActifs } = gr.supprAvatar(av.id)
      if (im) { // suppression du membre
        const mb = await this.gd.getMBR(gr.id, im)
        if (mb) mb.setZombi()
      }
      await this.checkAnimInvitants(gr)
      if (estHeb) { // fin d'hébergement éventuel
        this.compta.finHeb(gr.nn, gr.vf)
        gr.finHeb(this.auj)
      }
      this.compta.ngPlus(-1) // diminution du nombre de participations aux groupes
      if (!nbActifs) await this.supprGroupe(gr) // suppression éventuelle du groupe
    }

    this.compte.supprAvatar(av.id)
    
    /* Purges
    'notes': tache de purge, 
    'transferts': purge par le GC sur dlv,
    'sponsorings': suppressions ici,
    'chats': tache de purge ET de gestion de disparition sur idE,
    'tickets': le Comptable ne meurt jamais
    enfin l'avatar lui même ici (et dlv de son versions).
    */
    av.setZombi()
    await this.db.delScoll('sponsorings', av.id)

    await Taches.nouvelle(this, Taches.AVC, av.id, 0)
    await Taches.nouvelle(this, Taches.AGN, av.id, 0)
  }

  // eslint-disable-next-line no-unused-vars
  async resilCompte (c) {
    /* Gestion de ses groupes et invits */
    const sg = new Set()
    const invits = await this.gd.getIN(c.id)
    if (invits) invits.setTousGroupes(sg)
    c.setTousGroupes(sg)
    
    for(const idg of sg) {
      const gr = await this.gd.getGR(idg)
      if (!gr) continue
      let nbac = 0
      let esth = false
      for (const avid in c.mav) {
        const { im, estHeb, nbActifs } = gr.supprAvatar(avid)
        if (im) { // suppression du membre
          const mb = await this.gd.getMBR(gr.id, im)
          if (mb) mb.setZombi()
        }
        nbac = nbActifs
        if (estHeb) esth = true
      }
      if (esth) gr.finHeb(this.auj) // fin d'hébergement éventuel
      if (!nbac) await this.supprGroupe(gr) // suppression éventuelle du groupe
    }

    if (c.idp) {
      const p = await this.gd.getPA(c.idp)
      if (p) p.retraitCompte(c.id)
    }
    for (const avid in c.mav) {
      const av = await this.gd.getAV(avid)
      if (av) av.setZombi()
      await Taches.nouvelle(this, Taches.AVC, avid, 0)
    }
    invits.setZombi()
    const compta = await this.gd.getCA(c.id)
    if (compta) compta.setZombi()
    const compti = await this.gd.getCI(c.id)
    if (compti) compti.setZombi()
    c.setZombi()
  }

  // Création d'un fichier CSV d'une compta
  async creationC (org, ns, cleES, mois, mr) {
    const sep = ','
    const lignes = []
    lignes.push(Compteurs.CSVHDR(sep))
    await this.db.collNs(
      'comptas', 
      ns, 
      (data) => { Compteurs.CSV(lignes, mr, sep, data) }
    )
    const buf = Buffer.from(lignes.join('\n'))
    const buf2 = crypter(cleES, buf)
    // const buf3 = decrypter(cleES, buf2)
    // console.log('' + buf3)
    await this.storage.putFile(org, ID.duComptable(), 'C_' + mois, buf2)
  }

  // Création d'un fichier CSV des tickets d'un mois
  async creationT (org, ns, cleES, mois) {
    const cptM = ['IDS', 'TKT', 'DG', 'DR', 'MA', 'MC', 'REFA', 'REFC']
    const sep = ','
    const lignes = []
    lignes.push(cptM.join(sep))
    // async selTickets (op, id, aamm, fnprocess)
    /* Ticket
    - `ids` : numéro du ticket - ns + aamm + 10 chiffres rnd
    - `dg` : date de génération.
    - `dr`: date de réception. Si 0 le ticket est _en attente_.
    - `ma`: montant déclaré émis par le compte A.
    - `mc` : montant déclaré reçu par le Comptable.
    - `refa` : texte court (32c) facultatif du compte A à l'émission.
    - `refc` : texte court (32c) facultatif du Comptable à la réception.
    */
    await this.db.selTickets(
      ID.duComptable(ns), 
      ns,
      mois,
      (data) => { 
        const d = decode(data)
        const ids = '"' + d.ids + '"'
        const tkt = quotes(idTkToL6(d.ids))
        const dg = d.dg
        const dr = d.dr
        const ma = d.ma
        const mc = d.mc
        const refa = quotes(d.refa)
        const refc = quotes(d.refc)
        lignes.push([ids, tkt, dg, dr, ma, mc, refa, refc].join(sep))
      }
    )
    const buf = Buffer.from(lignes.join('\n'))
    const buf2 = crypter(cleES, buf)
    // const buf3 = decrypter(this.cleES, buf2)
    // console.log('' + buf3)
    await this.storage.putFile(org, ID.duComptable(), 'T_' + mois, buf2)
  }
}
