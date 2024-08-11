import { encode, decode } from '@msgpack/msgpack'
import { webPush } from './loadreq.mjs'
import { u8ToB64 } from './util.mjs'

class Session {
  static toutes = new Map()

  static getSession (ns) { return Session.toutes.get(ns) ||  new Session(ns) }

  constructor (ns) {
    this.ns = ns
    Session.toutes.set(ns, this)
    this.sessions = new Map()
    this.comptes = new Map()
    this.xrefs = new Map()
  }

  /* Emet une notification à la session enregistrée
  trlog est un objet { qui sera sérialisé
  */
  async sendNotification (session, trLog) { // trlog est un objet { vcpt, vesp, lag }
    try {
      const p = { sessionId: session.sid, trLog }
      const b = u8ToB64(encode(p))
      await webPush.sendNotification(session.subscription, b, { TTL: 0 })
    } catch (error) {
      console.log(error)
    }
  }

  // Traitemnt des notifications aux sessions sur fin d'une opération de maj
  notif (sid, log) { // log: { vcpt, vesp, lag, lp } - sid null (admin, GC)
    // lp : [[compteId, {v, p}] ... (vpe, périmètre}
    const perimetres = new Map()
    if (log.lp) log.lp.forEach(x => { perimetres.set(x[0], { v: x[1][0], p: x[1][1] }) })
    // TODO
    if (sid) {
      const s = this.sessions.get(sid)
      return s ? s.nhb : 0
    } else return 0
  }

  // Enregistrement d'une session
  login (sid, subscription, cid, perimetre) {
    const s = { 
      sid, 
      subscription, 
      cid, 
      perimetre,
      nhb: 0
    }
    // TODO
    this.sessions.set(sid, s)
    return s.nhb
  }

  // Enregistrement du heartbeat d'une session
  // eslint-disable-next-line no-unused-vars
  heartbeat (sid, nhb) {
    const s = this.sessions.get(sid)
    // TODO
    return s.nhb
  }
}

// Appel de fonction locale OU post au service PUBSUB
// Retourne le numéro de HB courant ou 0 si service NON joignable
export async function genNotif(ns, sid, trlogLong) {
  const log = decode(trlogLong)
  return Session.getSession(ns).notif(sid, log)
}

// Appel de fonction locale OU post au service PUBSUB
// Retourne le numéro de HB courant ou 0 si service NON joignable
export async function genLogin(ns, sid, subscription, cid, perimetre) {
  return Session.getSession(ns).login(sid, subscription, cid, perimetre)
}

// Appel de fonction locale OU post au service PUBSUB
// Retourne le numéro de HB courant ou 0 si service NON joignable
export async function genHeartbeat(ns, sid, nhb) {
  return Session.getSession(ns).heartbeat(sid, nhb)
}
