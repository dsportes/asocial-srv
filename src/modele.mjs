import { encode, decode } from '@msgpack/msgpack'
import { ID, AppExc, A_SRV, F_SRV, E_SRV, Compteurs, AL, idTkToL6, AMJ } from './api.mjs'
import { config } from './config.mjs'
import { sleep, b64ToU8, crypter, quotes, sendAlMail } from './util.mjs'
import { Taches } from './taches.mjs'
import { GenDoc, Versions, Comptes, Avatars, Groupes, Transferts, Fpurges,
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
  config.logger.error(msg)
  if (args) args.unshift(src)
  return new AppExc(A_SRV, code, !args ? [src || '???'] : args)
}

/* Cache ************************************************************************
Cache des objets majeurs "tribus comptas avatars groupes" 
*/
export class Cache {
  static MAX_CACHE_SIZE = 1000
  static LAZY_MS = 3000

  static map = new Map()

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
    const k = nom + '/' + op.org + '/' + id
    const x = Cache.map.get(k)
    if (x) {
      if (!lazy || (now - x.lru > Cache.LAZY_MS)) {
        // on vérifie qu'il n'y en pas une postérieure (pas lue si elle n'y en a pas)
        const n = await op.db.getV(nom, id, x.row.v)
        x.lru = now
        if (n && n.v > x.row.v) x.row = n // une version plus récente existe : mise en cache
      }
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
  static aVersion (op, nom, id, v) {
    const k = nom + '/' + op.org + '/' + id
    const x = Cache.map.get(k)
    return x && x.v >= v ? x : null
  }

  static opFake = { fake: true, nl: 0, ne: 0 }
  
  /*
  Enrichissement de la cache APRES le commit de la transaction avec
  tous les rows créés, mis à jour ou accédés (en ayant obtenu la "dernière")
  */
  static update (op, newRows, delRowPaths) { // set des path des rows supprimés
    if (op && op.org) {
      for(const row of newRows) {
        if (GenDoc.sousColls.has(row._nom)) continue
        const k = row._nom + '/' + op.org + '/' + row.id
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
    this._maj = false
    this.vcpt = 0 // version du compte
    this.vesp = 0 // version de espace
    this.vadq = 0 // version de compta quand adq a changé
    this.avgr = new Map() // clé: ID de av / gr, valeur: version
    this.perimetres = new Map() // clé: ID du compte, valeur: {v, vpe, p}
  }

  fermer () {
    if (!this.op.SYS && this.op.compte && this.op.compte._maj) 
      this.vcpt = this.op.compte.v
  }

  get court () {
    const x = { }
    if (this.vcpt) x.vcpt = this.vcpt
    if (this.vesp) x.vesp = this.vesp
    if (this.vadq) x.vadq = this.vadq
    if (this.avgr.size) {
      const y = []
      for(const [id ,v] of this.avgr) y.push([id, v])
      x.lag = y
    }
    return x
  }

  get serialLong () {
    const x = { ...this.court }
    if (this.op.id) x.cid = this.op.id
    if (this.perimetres.size) {
      const y = []; for(const e of this.perimetres) y.push(e)
      x.lp = y
    }
    return encode(x)
  }

  addAvgr (ag, v) { if (!this.op.SYS) { this.avgr.set(ag, v.v); this._maj = true } }

  setEsp (vesp) { this.vesp = vesp; this._maj = true }
  
  setAdq (vcompta) { if (!this.op.SYS) { this.vadq = vcompta; this._maj = true } }

  setCpt (cpt, p) {
    if (!this.op.SYS) {
      this.perimetres.set(cpt.id, { v: cpt.v, vpe: p ? cpt.v : 0, p: p})
      this._maj = true
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

    this.fpurges = new Map()
    this.transferts = new Map()

    this.transfertsApurger = []
  }

  /* Création conjointe de espace et synthese */
  nouvES (cleES, cleET, hTC) {
    const e = Espaces.nouveau(this.op.auj, cleES, cleET, hTC)
    this.espace = e
    this.synthese = Syntheses.nouveau()
    return e
  }

  async getEspace (assert) { // Pour mise à jour
    const espace = GenDoc.compile(await Cache.getRow(this.op, 'espaces', ''))
    if (!espace && assert) throw assertKO(assert, 15, [this.op.org])
    this.espace = espace
    this.op.espace = espace
    return espace
  }

  async getSY () {
    if (!this.synthese) {
      this.synthese = GenDoc.compile(await Cache.getRow(this.op, 'syntheses', ''))
      if (!this.synthese) throw assertKO('getSy', 16, [this.op.org])
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
    p = GenDoc.compile(await this.op.getRowPartition(idp))
    if (!p) {
      if (!assert) return null
      throw assertKO(assert, 2, [idp]) 
    }
    this.partitions.set(idp, p)
    return p
  }

  nouvCO (args, sp, quotas, don) {
    const c = Comptes.nouveau(args, sp)
    this.comptes.set(c.id, c)
    const compta = Comptas.nouveau(c.id, quotas, don || 0, c.idp || '')
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
      if (c) t = true
      else c = GenDoc.compile(await this.op.getRowCompte(id))
    } else
      c = GenDoc.compile(await this.op.db.getCompteHk(hXR))
    if (!c) { 
      if (!assert) return null
      else throw assertKO(assert, 4, [c.id]) }
    if (!t) this.comptes.set(c.id, c)
    return c
  }

  async getCI (id, assert) {
    let c
    if (id) c = this.comptis.get(id)
    if (c) return c
    c = GenDoc.compile(await this.op.getRowCompti(id))
    if (!c || !await this.getCO(c.id)) { 
      if (!assert) return null
      else throw assertKO(assert, 12, [c.id]) }
    this.comptis.set(id, c)
    return c
  }

  async getIN (id, assert) {
    let c
    if (id) c = this.invits.get(id)
    if (c) return c
    c = GenDoc.compile(await this.op.getRowInvit(id))
    if (!c || !await this.getCO(c.id)) { 
      if (!assert) return null
      else throw assertKO(assert, 11, [this.org + '@' + id]) }
    this.invits.set(id, c)
    return c
  }

  async getCA (id, assert) {
    let c = this.comptas.get(id)
    if (c) return c
    c = GenDoc.compile(await this.op.getRowCompta(id))
    if (!c || !await this.getCO(c.id)) { 
      if (!assert) return null
      else throw assertKO(assert, 3, [c.id]) }
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
    a = GenDoc.compile(await this.op.getRowAvatar(id))
    if (!a) { 
      if (!assert) return null
      else throw assertKO(assert, 8, [this.org + '@' + id]) }
    this.avatars.set(id, a)
    return a
  }

  /* Retourne l'avatar si sa CV est plus récente que vcv
  En cas de retour null, ça peut être parce que l'avatar n'existe plus
  */
  async getAAVCV (id, vcv) {
    let av = this.avatars.get(id)
    if (!av)
      av = GenDoc.compile(await this.op.db.getAvatarVCV(id , vcv))
    return av && av.vcv > vcv ? av : null
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
    g = GenDoc.compile(await this.op.getRowGroupe(id))
    if (!g) { 
      if (!assert) return null
      else throw assertKO(assert, 9, [g.id]) }
    this.groupes.set(id, g)
    return g
  }

  async getCGR (id, assert) {
    const k = id + '/CGR/'
    let d = this.sdocs.get(k)
    if (d) return d
    d = GenDoc.compile(await this.op.getRowChatgr(id))
    if (!d || !await this.getV(d.id)) { 
      if (!assert) return null
      else throw assertKO(assert, 17, [k]) }
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
    d = GenDoc.compile(await this.op.getRowMembre(id, im))
    if (!d || !await this.getV(d.id)) { 
      if (!assert) return null
      else throw assertKO(assert, 10, [k]) }
    this.sdocs.set(k, d)
    return d
  }

  async nouvCAV (args, assert) {
    const k = args.id + '/CAV/' + args.ids
    const d = Chats.nouveau(args)
    if (!await this.getV(d.id)) { 
      if (!assert) return null
      else throw assertKO(assert, 5, [k]) }
    this.sdocs.set(k, d)
    return d
  }

  async getCAV (id, ids, assert) {
    const k = id + '/CAV/' + ids
    let d = this.sdocs.get(k)
    if (d) return d
    d = GenDoc.compile(await this.op.getRowChat(id, ids))
    if (!d || !await this.getV(d.id)) { 
      if (!assert) return null
      else throw assertKO(assert, 5, [k]) }
    this.sdocs.set(k, d)
    return d
  }

  async getAllCAV (id) {
    const l = []
    for (const row of await this.op.db.scoll('chats', id, 0)) {
      const k = id + '/CAV/' + row.ids
      let d = this.sdocs.get(k)
      if (!d) {
        d = GenDoc.compile(row)
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
      if (!assert) return null
      else throw assertKO(assert, 15, [k]) }
    this.sdocs.set(k, d)
    return d
  }

  async getTKT (ids, assert) {
    const idc = ID.duComptable()
    const k = idc + '/TKT/' + ids
    let d = this.sdocs.get(k)
    if (d) return d
    d = GenDoc.compile(await this.op.getRowTicket(idc, ids))
    if (!d || !await this.getV(d.id)) { 
      if (!assert) return null
      else throw assertKO(assert, 15, [k]) }
    this.sdocs.set(idc + '/TKT/' + ids, d)
    return d
  }

  async nouvSPO (args, ids, assert) {
    const k = args.id + '/SPO/' + ids
    const d = Sponsorings.nouveau(args, ids)
    d.dh = this.op.dh
    if (!await this.getV(d.id)) { 
      if (!assert) return null
      else throw assertKO(assert, 13, [k]) }
    this.sdocs.set(k, d)
    return d
  }

  async getSPO (id, ids, assert) {
    const k = id + '/SPO/' + ids
    let d = this.sdocs.get(k)
    if (d) return d
    d = GenDoc.compile(await this.op.getRowSponsoring(id, ids))
    if (!d || !await this.getV(d.id)) { 
      if (!assert) return null
      else throw assertKO(assert, 13, [k]) }
    this.sdocs.set(k, d)
    return d
  }

  async nouvNOT (id, ids, par, assert) {
    const k = id + '/NOT/' + ids
    const d = Notes.nouveau(id, ids, par)
    if (!await this.getV(d.id)) { 
      if (!assert) return null
      else throw assertKO(assert, 13, [k]) }
    this.sdocs.set(k, d)
    return d
  }

  async getNOT (id, ids, assert) {
    const k = id + '/NOT/' + ids
    let d = this.sdocs.get(k)
    if (d) return d
    d = GenDoc.compile(await this.op.getRowNote(id, ids))
    if (!d || !await this.getV(d.id)) { 
      if (!assert) return null
      else throw assertKO(assert, 13, [k]) }
    this.sdocs.set(k, d)
    return d
  }

  nouvTRA (avgrid, idf) {
    const dlv = AMJ.amjUtcPlusNbj(this.op.auj, 1)
    const d = Transferts.nouveau(avgrid, idf, dlv)
    this.transferts.set(d.id, d)
  }

  nouvFPU (avgrid, lidf) {
    const id = ID.rnd()
    const d = Fpurges.nouveau(id, avgrid, lidf)
    this.fpurges.set(id, d)
    return id
  }

  setTransfertsApurger (avgrid, idf) {
    this.transfertsApurger.push(avgrid + '_' + idf)
  }
  
  async getV (id) {
    let v = this.versions.get(id)
    if (!v) {
      v = GenDoc.compile(await this.op.getRowVersion(id))
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
      if (!v && !suppr) throw assertKO('majV', 20, [this.op.org + '@' + id])
      if (!v && suppr) return 0
    }
    if (!v._maj) {
      v._vav = v.v
      v.v++
      v._maj = true
      if (suppr) {
        v.dlv = this.op.auj
        v._zombi = true
      }
      if (v.v === 1) this.op.insert(v); else this.op.update(v)
      this.trLog.addAvgr(id, v)  
    }
    return v.v
  }

  async majDoc (d) {
    if (d._suppr) { 
      if (d.ids) { // pour membres, notes, chats, sponsorings, tickets
        await this.majV(d.id)
        this.op.delete(GenDoc._new(d._nom).init({id: d.id, ids: d.ids }))
      } else { // pour groupes, avatars, comptes, comptas, invits, comptis
        await this.majV(d.id, true)
        this.op.delete(GenDoc._new(d._nom).init({id: d.id}))
      }
    } else if (d._maj) {
      const ins = d.v === 0
      d._vav = d.v
      d.v = await this.majV(d.id)
      if (d._nom === 'avatars') {
        if (d.cvA && !d.cvA.v) { d.vcv = d.v; d.cvA.v = d.v }
      } else if (d._nom === 'groupes') {
        if (d.cvG && !d.cvG.v) d.cvG.v = d.v
      } else if (d._nom === 'chats') {
        if (d.cvE) d.vcv = d.cvE.v
      }
      if (ins) this.op.insert(d)
      else this.op.update(d)
    }
  }

  async majEsp (d) {
    if (d._maj) {
      const ins = d.v === 0
      d._vav = d.v
      d.v++
      this.trLog.setEsp(d.v)
      if (ins) this.op.insert(d)
      else this.op.update(d)
    }
  }

  async majCompta (compta) { // ET report éventuel dans partition / synthese
    if (compta._suppr) {
      this.op.delete(GenDoc._new('comptas').init({id: compta.id}))
    } else {
      compta._vav = compta.v
      compta.v++
      // compta du compte courant
      if (this.op.compte.id === compta.id) {
        const esp = await this.getEspace()
        const { chgAdq, chgQv, idp } = compta.finOp(this.op, esp)
        if (chgAdq) {
          this.trLog.setAdq(compta.v)
          if (idp && chgQv) {
            // Maj partition
            const part = await this.getPA(idp, 'modele.majCompta')
            part.majQC(compta.id, compta.adq.qv)
            // Maj synthese
            const synth = await this.getSY()
            synth.setPartition(part)
          }
        }
      }
      if (compta.v === 1) this.op.insert(compta)
      else this.op.update(compta)
    }
  }

  async majCompti (compti) {
    if (compti._suppr) {
      this.op.delete(GenDoc._new('comptis').init({id: compti.id}))
    } else if (compti._maj) {
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

  async majFpurge (fpurge) {
    if (fpurge._maj) {
      this.op.insert(fpurge)
    }
  }

  async majTransfert (transfert) {
    if (transfert._maj) {
      this.op.insert(transfert)
    }
  }

  async majCompte (compte) {
    if (compte._suppr) {
      this.op.delete(GenDoc._new('comptes').init({id: compte.id}))
    } else if (compte._maj) {
      compte._vav = compte.v
      let compti, invit, p
      compte.v++
      if (compte.v === 1) {
        p = compte.perimetre
        compti = await this.getCI(compte.id); compti.v = 1
        invit = await this.getIN(compte.id); invit.v = 1
        compte.vci = 1; compte.vpe = 1; compte.vci = 1; compte.vin = 1
        this.op.insert(compte)
        this.op.insert(compti)
        this.op.insert(invit)
      } else {
        p = compte.perimetreChg
        if (p) compte.vpe = compte.v
        if (compte._majci) {
          compti = await this.getCI(compte.id); compti.v = compte.v
          compte.vci = compte.v
          this.op.update(compti)
        }
        if (compte._majin) {
          invit = await this.getIN(compte.id); invit.v = compte.v
          compte.vin = compte.v
          this.op.update(invit)
        }
        this.op.update(compte)
      }
      this.trLog.setCpt(compte, p)
    }
  }

  async majPart (p) {
    if (p._suppr) {
      this.op.delete({ _nom: 'partitions', id: p.id })
    } else if (p._maj) {
      p._vav = p.v
      p.v++
      if (p.v === 1) this.op.insert(p)
      else this.op.update(p)
      const s = await this.getSY()
      s.setPartition(p)
    }
  }

  async majSynth () {
    const s = this.synthese
    if (s && s._maj) {
      s._vav = s.v
      s.v++
      if (s.v === 1) this.op.insert(s)
      else this.op.update(s)
    }
  }

  async maj () {
    for(const [,d] of this.avatars) await this.majDoc(d)
    for(const [,d] of this.groupes) await this.majDoc(d)
    for(const [,d] of this.sdocs) await this.majDoc(d)
    for(const [,d] of this.comptis) await this.majCompti(d)
    for(const [,d] of this.invits) await this.majInvit(d)
    for(const [,d] of this.fpurges) await this.majFpurge(d)
    for(const [,d] of this.transferts) await this.majTransfert(d)
    if (this.espace) await this.majEsp(this.espace)
    
    for(const [id, d] of this.comptes) await this.majCompte(d)

    // comptas SAUF celle du compte courant
    for(const [id, d] of this.comptas)
      if (id !== this.op.id) await this.majCompta(d)

    /* compta du compte courant: fin de l'opération
    Le plus tard possible pour accumuler dans la compta le maximum de
    lectures / écritures.
    Les mises à jour de partition et synthese PEUVENT résulter de la fin
    d'opération enregistrée dans compta et figurent donc après:
    leurs coûts ne sont pas comptabilisés (par commodité).
    */
    if (!this.op.SYS && this.op.compta) {
      // anticipation des coûts d'écriture
      this.op.ne += this.transfertsApurger.length
      this.op.compta._maj = true
      await this.majCompta(this.op.compta)
    }

    // maj partitions (possiblement affectées aussi par maj de compta)
    for(const [,d] of this.partitions) await this.majPart(d)
    
    // maj syntheses possiblement affectées par maj des partitions
    if (this.synthese) await this.majSynth()
    
    // PLUS DE LECTURES A PARTIR D'ICI
    if (this.transfertsApurger.length) 
      for(const id of this.transfertsApurger)
        await this.op.db.purgeTransferts(id)
  }

}

/** Operation *****************************************************/
export class Operation {
  static mindh = new Date('2024-01-01').getTime()
  static maxdh = new Date('2099-12-31').getTime()

  /* Initialisé APRES constructor() dans l'invocation d'une opération
  authMode:
    0 : pas de contrainte d'accès (public)
    1 : le compte doit être authentifié
    2 : et ça doit être le comptable
    3 : administrateur technique requis
  excFige: (toujours 0 si authMode 3)
    1 : pas d'exception à l'authentification si figé. Lecture seulement ou estFige testé dans l'opération
    2 : exception à l'authentification si figé
  */
  constructor (nomop, authMode, excFige) { 
    this.nomop = nomop
    this.authMode = authMode
    this.excFige = authMode === 3 ? 0 : (excFige || 1)
    this.dh = Date.now()
    this.org = ''
    this.result = { dh: this.dh, srvBUILD: config.BUILD }
    this.flags = 0
  }

  reset () {
    this.dh = Date.now()
    this.auj = AMJ.amjUtcDeT(this.dh)
    if (config.mondebug) 
      config.logger.info(this.nomop + ' : ' + new Date(this.dh).toISOString())
    this.flags = 0
    this.nl = 0; this.ne = 0; this.vd = 0; this.vm = 0
    this.result = { dh: this.dh, srvBUILD: config.BUILD }
    this.toInsert = []
    this.toUpdate = []
    this.toDelete = []
    this.compte = null
    this.gd = new GD(this)
  }

  setOrg (org) {
    this.org = org
    this.db.setOrg(org)
  }

  async transac () { // Appelé par this.db.doTransaction
    if (!this.SYS && !this.estAdmin && this.authMode !== 0)
      await this.auth2() // this.compta est accessible (si authentifié)
    if (this.phase2) {
      await this.phase2(this.args)
      if (!this.fige) await this.gd.maj()
    }
  }

  /* Exécution de l'opération */
  async run (args, dbp, storage) {
    try {
      this.args = args
      this.dbp = dbp
      this.storage = storage
      await dbp.connect(this)
      if (!this.SYS) await this.auth1()
      if (this.phase1) await this.phase1(this.args)

      if (this.phase2) for (let retry = 0; retry < 3; retry++) {
        this.reset()
        const [st, detail] = await this.db.doTransaction() // Fait un appel à transac
        if (st === 0) break // transcation OK
        if (st === 2) {
          trace ('Op.run.phase2', 'DB error', detail, true)
          throw new AppExc(E_SRV, 11, [detail]) // DB error
        }
        // st === 1 - DB lock / contention
        if (retry === 2) {
          trace ('Op.run.phase2', 'DB lock', detail, true)
          throw new AppExc(E_SRV, 10, [detail])
        }
        await sleep(config.D1)
        // retry - deconnexion / reconnexion
        this.db.disconnect()
        await dbp.connect(this)
        if (this.op.org) this.setOrg(this.op.org)
      }

      if (this.phase2) {
        /* Envoi en cache des objets majeurs mis à jour / supprimés */  
        const updated = [] // rows mis à jour / ajoutés
        const deleted = [] // paths des rows supprimés
        this.toInsert.forEach(row => { if (GenDoc.majeurs.has(row._nom)) updated.push(row) })
        this.toUpdate.forEach(row => { if (GenDoc.majeurs.has(row._nom)) updated.push(row) })
        this.toDelete.forEach(row => { if (GenDoc.majeurs.has(row._nom)) deleted.push(row._nom + '/' + row.id) })
        Cache.update(this.op, updated, deleted)
      }

      await this.phase3(this.args) // peut ajouter des résultats et db HORS transaction

      if (this.phase2) {
        if (this.subJSON) { // de Sync exclusivement
          if (this.subJSON.startsWith('???')) {
            if (config.mondebug) config.logger.error('subJSON=' + this.subJSON)
            } else {
              await genLogin(this.org, this.sessionId, this.subJSON, this.nhb, this.id, 
                this.compte.perimetre, this.compte.vpe)
            }
        }
        
        if (this.gd.trLog._maj) {
          this.gd.trLog.fermer()
          if (!this.estAdmin) { // sessions ADMIN ne reçoivent jamais de synchro
            const sc = this.gd.trLog.court // sc: { vcpt, vesp, vadq, lag }
            if (sc) this.setRes('trlog', sc)
          }
          
          const sl = this.gd.trLog.serialLong
          if (sl) {
            const sid = this.SYS ? null : (this.sessionId || null)
            this.nhb = await genNotif(this.org, sid, sl)
          }
        }
        if (this.nhb !== undefined && this.nhb !== -1) 
          this.setRes('nhb', { sessionId: this.sessionId, nhb: this.nhb, op: this.nomop })

        if (this.compta) {
          const c = this.compta.compteurs
          const adq = {
            dh: this.dh,
            v: this.compta.v,
            flags: this.flags,
            dlv: this.compta.dlv,
            nl: this.nl, 
            ne: this.ne,
            vd: this.vd, 
            vm: this.vm,
            qv: { ...c.qv }
          }
          this.setRes('adq', adq)
        }
      }

      if (this.aTaches) 
        Taches.prochTache(this.dbp, this.storage)
      
      await this.db.disconnect()

      await this.attente(1)
      return this.result
    } catch (e) {
      if (this.db) await this.db.disconnect()
      if (config.mondebug) 
        config.logger.error(this.nomop + ' : ' + new Date(this.dh).toISOString() + ' : ' + e.toString())
      throw e
    }
  }

  // m : coeff d'attente pour 1 Mo de transfert. 
  // Si m = 1, attente pour op de calcul
  async attente (m) {
    if (!this.estAdmin && !this.estComptable && AL.has(this.flags, AL.RAL)) {
      const tx = AL.txRal(this.compta.qv)
      await sleep(m * (1 + (tx / 10)) * 1000 )
    }
  }

  async phase1 (args) { 
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
        case 'mois' : {
          if (tof !== 'number' || !Number.isInteger(v)) ko(n)
          const a = Math.floor(e / 100)
          if (a < 2025 || a > 2099) ko(n)
          const m = a % 100
          if (m < 1 || a > 12) ko(n)
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
        case 'ntfesp' : { // { nr, dh, texte }
          if (tof !== 'object') ko(n)
          if (typeof v.dh !== 'number' || !Number.isInteger(v.dh)) ko(n)
          if (v.dh < Operation.mindh || v.dh > Operation.maxdh) ko(n)
          if (!v.nr || !Number.isInteger(v.nr) || v.nr < 1 || v.nr > 3) ko(n)
          if (v.texte && (typeof v.texte !== 'string')) ko(n)
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

  /* Authentification ****************************************************
  Après auth1 sont disponibles:
    - this.id this.org this.estAdmin this.sessionId
    - this.espace (LAZY)
    - this.fige this.flags (FIGE seulement)
  Après auth2 sont disponibles
    - this.compte this.compta this.estA this.estComptable
    - this.flags: set des restictions
  */
  async auth1 () {
    const app_keys = config.app_keys
    if (this.authMode < 0 || this.authmode > 3) throw new AppExc(A_SRV, 19, [this.authMode]) 

    const t = this.args.token
    if (!t && this.authMode !== 0) { 
      await sleep(config.D1)
      throw new AppExc(F_SRV, 205) 
    } 
    this.authData = null
    this.estAdmin = false
    if (!t) {
      if (this.authMode === 3) { await sleep(config.D1); throw new AppExc(F_SRV, 999) }
      return
    }
    try { 
      this.authData = decode(b64ToU8(t))
      this.sessionId = this.authData.sessionId || ''
      if (this.authData.shax) {
        try {
          const shax64 = Buffer.from(this.authData.shax).toString('base64')
          if (app_keys.admin.indexOf(shax64) !== -1) 
            this.estAdmin = true
        } catch (e) { /* */ }
      }      
      /* Espace: rejet de l'opération si l'espace est "clos" - Accès LAZY */
    } catch (e) { 
      await sleep(config.D1)
      throw new AppExc(F_SRV, 206, [e.message])
    }

    if (this.authData.org && this.authData.org !== 'admin') {
      await this.getEspaceOrg(this.authData.org, this.excFige)
      if (!this.espace) {
        await sleep(config.D1)
        throw new AppExc(F_SRV, 996)
      }
    }

  }

  async getEspaceOrg (org, excFige, noExcClos) {
    this.setOrg(org)
    /* Espace: rejet de l'opération si l'espace est "clos" - Accès LAZY */
    this.espace = GenDoc.compile(await Cache.getRow(this, 'espaces', '', true))
    if (!this.espace) return
    let cf = this.espace.clos
    if (!noExcClos && cf) throw new AppExc(A_SRV, 999, [cf.texte || '?'])
    cf = this.espace.fige
    if (excFige && cf) 
      throw new AppExc(F_SRV, 101, [op.nomop, cf.texte || '?'])
    if (cf) this.flags = AL.add(this.flags, AL.FIGE)
    this.fige = AL.has(this.flags, AL.FIGE)
  }

  async auth2 () {
    this.flags = 0
    if (this.fige) this.flags = AL.add(this.flags, AL.FIGE)
    
    /* Compte */
    this.compte = await this.gd.getCO(0, null, this.authData.hXR)
    if (!this.compte || this.compte.hXC !== this.authData.hXC) { 
      await sleep(config.D1); throw new AppExc(F_SRV, 998) 
    }

    this.id = this.compte.id
    this.estComptable = ID.estComptable(this.id)
    this.estA = !this.compte.idp

    // Opération du seul Comptable
    if (this.authMode === 2 && !this.estComptable) {
      await sleep(config.D1)
      throw new AppExc(F_SRV, 104) 
    }

    // Recherche des restrictions dans compta: ajout de celles-ci dans this.flags
    this.compta = await this.gd.getCA(this.id)
    this.flags = this.compta.compteurs.addFlags(this.flags)

    // Recherche des restrictions dans compte
    if (!this.estComptable && this.compte.idp) {
      const np = this.espace.getNotifP(this.compte.idp)
      this.compta.setNotifP(np || null)
      let x = np ? np.nr : 0
      const nc = this.compte.notif
      if (nc && nc.nr > x) x = nc.nr
      if (x) {
        if (x === 2) this.flags = AL.add(this.flags, AL.LSNTF)
        if (x === 3) this.flags = AL.add(this.flags, AL.ARNTF)
      }
    }
  }

  async alerte (sub) {
    const to = sub === 'chat' ? this.org : 'admin'
    await sendAlMail(config.run.nom, this.org || 'admin', to, sub)
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

  /* Helper d'accès depuis Cache */

  async getRowPartition (id, assert) {
    const p = await Cache.getRow(this, 'partitions', id)
    if (assert && !p) throw assertKO('getRowPartition/' + assert, 2, [this.org + '@' + id])
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
    if (assert && !cp) throw assertKO('getRowCompte/' + assert, 4, [this.org + '@' + id])
    return cp
  }

  async getRowCompta (id, assert) {
    const cp = await Cache.getRow(this, 'comptas', id)
    if (assert && !cp) throw assertKO('getRowCompta/' + assert, 3, [this.org + '@' + id])
    return cp
  }

  async getRowCompti (id, assert) {
    const cp = await Cache.getRow(this, 'comptis', id)
    if (assert && !cp) throw assertKO('getRowCompti/' + assert, 12, [this.org + '@' + id])
    return cp
  }

  async getRowInvit (id, assert) {
    const cp = await Cache.getRow(this, 'invits', id)
    if (assert && !cp) throw assertKO('getRowInvit/' + assert, 12, [this.org + '@' + id])
    return cp
  }

  async getRowVersion (id, assert) {
    const v = await Cache.getRow(this, 'versions', id)
    if (assert && !v) throw assertKO('getRowVersion/' + assert, 14, [this.org + '@' + id])
    return v
  }

  async getRowAvatar (id, assert) {
    const av = await Cache.getRow(this, 'avatars', id)
    if (assert && !av) throw assertKO('getRowAvatar/' + assert, 8, [this.org + '@' + id])
    return av
  }

  async getRowGroupe (id, assert) {
    const rg = await Cache.getRow(this, 'groupes', id)
    if (assert && !rg) throw assertKO('getRowGroupe/' + assert, 9, [this.org + '@' + id])
    return rg
  }

  async getRowNote (id, ids, assert) {
    const rs = await this.db.get('notes', id, ids)
    if (assert && !rs) throw assertKO('getRowNote/' + assert, 7, [this.org + '@' + id, ids])
    return rs
  }

  async getRowChat (id, ids, assert) {
    const rc = await this.db.get('chats', id, ids)
    if (assert && !rc) throw assertKO('getRowChat/' + assert, 12, [this.org + '@' + id, ids])
    return rc
  }
 
  async getRowTicket (id, ids, assert) {
    const rc = await this.db.get('tickets', id, ids)
    if (assert && !rc) throw assertKO('getRowTicket/' + assert, 17, [this.org + '@' + id, ids])
    return rc
  }

  async getRowSponsoring (id, ids, assert) {
    const rs = await this.db.get('sponsorings', id, ids)
    if (assert && !rs) throw assertKO('getRowSponsoring/' + assert, 13, [this.org + '@' + id, ids])
    return rs
  }

  async getRowMembre (id, ids, assert) {
    const rm = await this.db.get('membres', id, '' + ids)
    if (assert && !rm) throw assertKO('getRowMembre/' + assert, 10, [this.org + '@' + id, ids])
    return rm
  }

  async getRowChatgr (id, assert) {
    const rc = await this.db.get('chatgrs', id, '1')
    if (assert && !rc) throw assertKO('getRowChatgr/' + assert, 10, [this.org + '@' + id, 1])
    return rc
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
    this.delete(new Chatgrs().init({ id: gr.id, ids: '1' }))
    // tâches de suppression de tous les membres et des notes
    await Taches.nouvelle(this, Taches.GRM, gr.id)
    await Taches.nouvelle(this, Taches.AGN, gr.id)
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
  vis à vis du statut d'animateur des invitants
  */
  async checkAnimInvitants (gr) {
    /* Vérifie que les invitants sont bien animateurs, sinon:
    - met à jour ou supprime invits
    - liste les ida des avatars dont les invitations sont à supprimer
    - Map des ida des avatars dont les invitations sont à mettre à jour:
      - value: set des ids des invitants
    */
    const idas = gr.majInvits()
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

  /* Résiliation d'un compte **************************/
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
      await Taches.nouvelle(this, Taches.AVC, avid)
    }
    invits.setZombi()
    const compta = await this.gd.getCA(c.id)
    if (compta) compta.setZombi()
    const compti = await this.gd.getCI(c.id)
    if (compti) compti.setZombi()
    c.setZombi()
  }

  // Création d'un fichier CSV d'une compta
  async creationC (cleES, mois) {
    const sep = ','
    const lignes = []
    lignes.push(Compteurs.CSVHDR(sep))
    await this.db.collOrg(
      'comptas',
      (data) => { Compteurs.CSV(lignes, mois, sep, data) }
    )
    const buf = Buffer.from(lignes.join('\n'))
    return crypter(cleES, buf)
  }

  // Création d'un fichier CSV des tickets d'un mois
  async creationT (cleES, mois) {
    const cptM = ['IDS', 'TKT', 'DG', 'DR', 'MA', 'MC', 'REFA', 'REFC']
    const sep = ','
    const lignes = []
    const dlv = AMJ.djMoisN((mois * 100) + 1, 2)
    lignes.push(cptM.join(sep))
    // async selTickets (op, id, aamm, fnprocess)
    /* Ticket
    - `ids` : numéro du ticket - aa mm rrrrrrrr
    - `dg` : date de génération.
    - `dr`: date de réception. Si 0 le ticket est _en attente_.
    - `ma`: montant déclaré émis par le compte A.
    - `mc` : montant déclaré reçu par le Comptable.
    - `refa` : texte court (32c) facultatif du compte A à l'émission.
    - `refc` : texte court (32c) facultatif du Comptable à la réception.
    */
    await this.db.selTickets(
      ID.duComptable(),
      dlv,
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
    return crypter(cleES, buf)
  }
}
