import { encode } from '@msgpack/msgpack'
import { ID, PINGTO } from './api.mjs'
import { ctx } from './server.mjs'

export function startWs () {
  // eslint-disable-next-line no-unused-vars
  const gcSessions = setInterval(() => {
    const dh1 = new Date().getTime()
    const max = PINGTO * 6 * 10000 * (ctx.debug ? 1000 : 1)
    if (ctx.debug) ctx.logger.debug('PINGTO ' + max)
    SyncSession.sessionsmortes.clear()
    SyncSession.sessions.forEach((session, sessionId) => {
      const dh2 = session.dhping
      if (dh2 !== 0 && ((dh1 - dh2) > max)) SyncSession.sessionsmortes.add(sessionId)
    })
    SyncSession.sessionsmortes.forEach(sessionId => {
      SyncSession.sessions.delete(sessionId)
    })
    SyncSession.sessionsmortes.clear()
  }, PINGTO * 1000)
}

/* 
Appelé sur l'événement 'connection' reçu du Web Server
- request : requête Http correspondante : on ne sait rien en faire a priori
- wss1 : server web socket
*/
export class SyncSession {
  static sessions = new Map()

  // Array des syncList en attente de synchronisation (syncList : {sessionId, dh, rows})
  static syncListQueue = []

  static sessionsmortes = new Set()

  static get (id) { return SyncSession.sessions.get(id) }

  constructor (ws /*, request, wss1*/) {
    this.ws = ws
    this.dhping = 0
    this.sessionId = null
    this.aboIds = new Set()
    this.compteId = 0
    this.nbpings = 0
    this.ws.onerror = (e) => {
      ctx.logger.error(e)
      if (this.sessionId) SyncSession.sessions.delete(this.sessionId)
    }
    this.ws.onclose = (/* e */) => {
      if (this.sessionId) SyncSession.sessions.delete(this.sessionId)
      if (ctx.debug) ctx.logger.debug('Fermeture de session détectée:' + this.sessionId)
    }
    this.ws.onmessage = (m) => {
      // seul message reçu : ping avec le sessionid
      this.nbpings++
      const newid = m.data
      const d = new Date()
      this.dhping = d.getTime()
      if (newid !== this.sessionId) {
        // nouvelle session
        if (this.sessionId) SyncSession.sessions.delete(this.sessionId)
        this.sessionId = newid
        SyncSession.sessions.set(newid, this)
        if (ctx.debug) ctx.logger.debug('Ouverture de session reçue: ' + newid + ' / ' + d.toISOString())
      } else {
        if (ctx.debug) ctx.logger.debug('Ping reçu: ' + newid + ' / ' + d.toISOString())
      }
      // réponse pong
      if (this.nbpings < 1000000) { // pour tester et ne plus envoyer de pong au delà de N pings
        const pong = { sessionId: newid, dh: new Date().getTime() }
        const buf = new Uint8Array(encode(pong))
        this.ws.send(buf)
      }
    }
  }

  setCompte (id) {
    this.aboIds.clear()
    this.compteId = id
    this.ns = ID.ns(id)
    this.aboIds.add(id)
  }

  setTribuCId (id) { // uniquement pour le comptable
    this.tribuCId = id
  }

  plus (id) { this.aboIds.add(id) }

  moins (id) { this.aboIds.delete(id) }

  traiteSyncList (syncList) { // syncList : { sessionId, rows }
    // filtre dans rows ceux concernés par la session et envoie (éventuellement) le message
    const msg = { sessionId: this.sessionId, rows: [] }
    syncList.rows.forEach(row => {
      if (this.aboIds.has(row.id) || 
        (row._nom === 'espaces' && row.id === this.ns) ||
        (ID.estComptable(this.compteId) && row._nom === 'tribus' && row.id === this.tribuCId))
        msg.rows.push(row)
    })
    if (msg.rows.length) {
      const buf = new Uint8Array(encode(msg))
      setImmediate(() => {
        this.ws.send(buf)
      })
    }
  }

  static toSync(rows) {
    if (rows && rows.length) {
      SyncSession.syncListQueue.push( { rows: rows })
      setImmediate(() => { 
        while (SyncSession.syncListQueue.length) {
          const syncList = SyncSession.syncListQueue[0]
          SyncSession.sessions.forEach((session) => { // pas pour admin
            if (session.compteId) session.traiteSyncList(syncList)
          })
          SyncSession.syncListQueue.splice(0, 1)
        }
      })
    }
  }
}
