import { encode, decode } from '@msgpack/msgpack'
import { webPush } from './loadreq.mjs'
import { u8ToB64 } from './util.mjs'
import { HBINSECONDS, isAppExc, AppExc, E_SRV } from './api.mjs'
import { appKeyBin, config } from './config.mjs'
import { decrypterSrv, crypterSrv } from './util.mjs'
import fetch from 'node-fetch'

class Session {
  static toutes = new Map()

  static orgs = new Map() // donne le ns d'une org

  static getSession (ns) { return Session.toutes.get(ns) ||  new Session(ns) }

  static purge (boot) {
    if (!boot) {
      const dlv = Date.now() + (HBINSECONDS * 1000)
      for(const [, x] of Session.toutes) {
        for(const [rnd, s] of x.sessions) {
          if (s.dlv < dlv) {
            x.detachCpt(rnd, s.cid)
            x.sessions.delete(rnd)
          }
        }
      }
    }
    if (!config.NOPURGESESSIONS)
      setTimeout(() => { 
        Session.purge(false) 
      }, HBINSECONDS * 1500)
  }

  constructor (ns) {
    this.ns = ns
    Session.toutes.set(ns, this)
    this.sessions = new Map() // cle: rnd, valeur: { rnd, nc, subscription, cid, nhb, dlv }
    this.comptes = new Map() // clé: cid, valeur: {cid, vpe, perimettre, sessions: Set(rnd)}
    this.xrefs = new Map() // cle: id du sous-arbre, valeur: Set des cid l'ayant en périmètre 
  }

  // Emet une notification à la session enregistrée
  async sendNotification (sessionId, subJSON, trLog) { // trlog est un objet { vcpt, vesp, lag }
    try {
      const p = { sessionId: sessionId, trLog }
      const b = u8ToB64(encode(p))
      const subscription = JSON.parse(subJSON)
      await webPush.sendNotification(subscription, b, { TTL: 0 })
    } catch (error) {
      config.logger.error('sendNotification: ' + error.toString())
      // console.log(error)
    }
  }

  /* Enregistre / complète un meessage de notification
  - s : session à notifier
  - id : ID d'un avatar / compte du périmètre de son compte ayant changé
  - v : version correspondante
  - sid : SI notif a été invoquée depuis un compte (pas GC pas admin) sessionId
    - cid :  ID de ce compte
    - vesp : version de l'espace
    - vcpt : version du compte cid
  */
  setTrlog (trlogs, s, id, v, sid, cptid, vcpt, vesp) {
    const sessionId = s.rnd + '.' + s.nc
    if (sessionId === sid) return // On ne notifie pas la session appelante
    let e = trlogs.get(sessionId)
    if (!e) { 
      const trlog = { lag: []}
      if (sid) {
        if (vesp) trlog.vesp = vesp // version de l'espace ns (si changée)
        // Peut concerner une autre session du même compte que l'appelant
        if (cptid === s.cid && vcpt) trlog.vcpt = vcpt // si version du compte a changé
      }
      e = { subscription: s.subscription, trlog }
      trlogs.set(sessionId, e)
    }
    if (id) e.trlog.lag.push([id, v])
  }

  // Traitemnt des notifications aux sessions sur fin d'une opération de maj
  notif (sid, log) { // log: { vcpt, vesp, lag, lp } - sid null (admin, GC)
    // lag : [[id, v] ...]
    // lp : [[compteId, {v, p}] ... (vpe, périmètre}
    const dlv = Date.now()
    const perimetres = new Map()
    if (log.lp) log.lp.forEach(x => { perimetres.set(x[0], { v: x[1][0], p: x[1][1] }) })

    let s = null
    let nhbav = -1
    let cptid = null, vesp = 0, vcpt = 0

    if (sid) {
      const x = sid.split('.'); const rnd = x[0], nc = parseInt(x[1])
      s = this.sessions.get(rnd)
      if (s) { cptid = s.cid; vesp = log.vesp; vcpt = log.vcpt }
      if (s && s.nc === nc) nhbav = s.nhb
    }

    // Maj des périmètres modifiés des comptes
    for (const [cid, p] of perimetres) {
      const c = this.comptes.get(cid)
      if (c) this.majPerimetreC(c, p.v, p.p)
    }

    // préparation des notications à pousser ()
    const trlogs = new Map() // cle sid, valeur trlog : { vcpt, vesp, lag }

    log.lag.forEach(x => { // [id, v]
      const v = x[1]
      const id = x[0]
      const scids = this.xrefs.get(id)
      if (scids) scids.forEach(cid => {
        const c = this.comptes.get(cid)
        if (c) c.sessions.forEach(rnd => {
          const s = this.sessions.get(rnd)
          if (s && s.dlv > dlv) 
            this.setTrlog(trlogs, s, id, v, sid, cptid, vcpt, vesp)
        })
      })
    })

    if (cptid && (vcpt || vesp)) {
      const c = this.comptes.get(cptid)
      if (c) {
        c.sessions.forEach(rnd => {
          const s = this.sessions.get(rnd)
          if (s)
            this.setTrlog(trlogs, s, null, 0, sid, cptid, vcpt, vesp)
        })
      }
    }

    if (trlogs.size) setTimeout(async () => { 
      for (const [sessionId, e] of trlogs) {
        await this.sendNotification(sessionId, e.subscription, e.trlog) 
      }
    }, 1)

    return nhbav
  }

  supprId (cid, id) {
    const xref = this.xrefs.get(id)
    if (xref) {
      xref.delete(cid)
      if (xref.size === 0) this.xrefs.delete(id)
    }
  }

  // la session rnd ne référence plus le compte cid
  detachCpt (rnd, cid) {
    const c = this.comptes.get(cid)
    if (c) {
      c.sessions.delete(rnd)
      if (c.sessions.size === 0) {
        c.perimetre.forEach(id => { this.supprId(c.cid, id)})
        this.comptes.delete(cid)
      }
    }
  }

  addId (cid, id) {
    let xref = this.xrefs.get(id)
    if (!xref) { xref = new Set(); this.xrefs.set(id, xref)}
    xref.add(cid)
  }

  majPerimetreC (c, vpe, perimetre) {
    if (c.vpe < vpe) { // mise à jour du périmètre
      c.perimetre.forEach(id => { this.supprId(id)})
      perimetre.forEach(id => { this.addId(c.cid, id); c.perimetre.push(id)})
      c.vpe = vpe
    }
  }

  setCpt (rnd, cid, vpe, perimetre) {
    let c = this.comptes.get(cid)
    if (!c) { 
      c = { cid, vpe: 0, perimetre: [], sessions: new Set() }
      this.comptes.set(cid, c)
    }
    c.sessions.add(rnd)
    this.majPerimetreC(c, vpe, perimetre)
  }

  // Enregistrement d'une session
  login (sid, subscription, cid, perimetre, vpe) {
    const dlv = Date.now() + (HBINSECONDS * 1000)
    const x = sid.split('.'); const rnd = x[0], nc = parseInt(x[1])
    let s = this.sessions.get(rnd)
    if (s) {
      if (s.cid !== cid) { // Chgt de compte
        this.detachCpt(rnd, s.cid)
        this.setCpt (rnd, cid, vpe. perimetre)
      } else { // même compte, mais péimètre peut-être à rafraîchir
        const c = this.comptes.get(s.cid) // état du compte avant
        this.majPerimetreC(c, vpe, perimetre)
      }
      // rnd et subscription n'ont pas changé
      s.nc = nc
      s.cid = cid
      s.nhb = 0
      s.dlv = dlv
    } else {
      s = { rnd, nc, subscription, cid, nhb: 0, dlv: dlv }
      this.setCpt(rnd, cid, vpe, perimetre)
      this.sessions.set(rnd, s)
    }
    return 0
  }

  // Enregistrement du heartbeat d'une session
  heartbeat (sid, nhb) {
    const dlv = Date.now() + (HBINSECONDS * 1000)
    const x = sid.split('.'); const rnd = x[0], nc = parseInt(x[1])
    const s = this.sessions.get(rnd)
    if (nhb) {
      let nhbav = -1
      if (s) {
        if (s.nc === nc) {
          nhbav = s.nhb
          s.dlv = dlv
          s.nhb = nhb
        }
      }
      return nhbav
    } else {
      // déconnexion
      if (s) {
        this.detachCpt(rnd, s.cid)
        this.sessions.delete(rnd)
      }
      return 0
    }
  }
}

async function post (fn, args) {
  try {
    const body = crypterSrv(Session.appKey, encode(args))
    const response = await fetch(config.run.pubsubURL + fn, {
      method: 'post',
      body,
      headers: {'Content-Type': 'application/octet-stream'}
    })
    return response.ok ? await response.json() : 0
  } catch (e) {
    config.logger.error('post pubsub: ' + e.toString())
    return 0
  }
}

// Appel de fonction locale OU post au service PUBSUB
// Retourne le numéro de HB courant ou 0 si service NON joignable
export async function genNotif(ns, sid, trlogLong) {
  const log = decode(trlogLong)
  if (!Session.pubsubURL)
    return Session.getSession(ns).notif(sid, log)
  return await post('notif', { ns, sid, log })
}

// Appel de fonction locale OU post au service PUBSUB
// Retourne le numéro de HB courant ou 0 si service NON joignable
export async function genLogin(ns, org, sid, subscription, cid, perimetre, vpe) {
  if (!Session.pubsubURL) {
    Session.orgs.set(org, ns)
    return Session.getSession(ns).login(sid, subscription, cid, perimetre, vpe)
  }
  return await post('login', { ns, org, sid, subscription, cid, perimetre, vpe })
}

// Appel de fonction locale OU post au service PUBSUB
// Retourne le numéro de HB courant ou 0 si service NON joignable
export async function genHeartbeat(org, sid, nhb) {
  const ns = Session.orgs.get(org)
  return Session.getSession(ns).heartbeat(sid, nhb)
}

export function pubsubStart(){
  Session.appKey = appKeyBin(config.run.site)
  Session.pubsubURL = config.run.pubsubURL
  Session.purge(true)
}

// positionne les headers et le status d'une réponse. Permet d'accepter des requêtes cross origin des browsers
function setRes(res, status, type) {
  res.status(status)
  return res.type(type || 'application/octet-stream')
}

export async function pubsub (req, res) {
  try {
    const opName = req.params.operation
    let result
    switch (opName) {
    case 'heartbeat' : {
      const args = decode(req.rawBody)
      const ns = Session.orgs.get(args.org)
      result = await Session.getSession(ns).heartbeat(args.sid, args.nhb)
      break
    }
    case 'login' : {
      const args = decode(decrypterSrv(Session.appKey, req.rawBody))
      Session.orgs.set(args.org, args.ns)
      result = await Session.getSession(args.ns).login(args.sid, args.subscription, args.cid, args.perimetre, args.vpe)
      break
    }
    case 'notif' : {
      const args = decode(decrypterSrv(Session.appKey, req.rawBody))
      result = await Session.getSession(args.ns).notif(args.sid, args.log)
      break
    }
    }
    setRes(res, 200, 'text/plain').send(JSON.stringify(result))

  } catch (e) {
    // exception non prévue ou prévue
    if (isAppExc(e)) { // erreur trappée déjà mise en forme en tant que AppExc F_SRV A_SRV E_SRV
      delete e.stack
      setRes(res, 400).send(e.toString())
    } else {
      // erreur non trappée : mise en forme en AppExc
      const xx = e.stack ? e.stack + '\n' : ''
      setRes(res, 403).send(new AppExc(E_SRV, 0, [e.message], xx).toString())
    }
  }
}
