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

  // eslint-disable-next-line no-unused-vars
  notif (sid, log) { // log: { vcpt, vesp, lag, lp } - sid null (admin, GC)
    // TODO
  }

  login (sessionId, subscription, compteId) {
    const s = { sid: sessionId, subscription, cid: compteId }
    // TODO
    this.sessions.set(sessionId, s)
  }
}

export async function genNotif(ns, sid, s) {
  const log = decode(s)
  Session.getSession(ns).notif(sid, log)
  return true
}
