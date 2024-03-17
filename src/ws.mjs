import { encode } from '@msgpack/msgpack'
import { PINGTO } from './api.mjs'
import { config } from './config.mjs'

/* Constructor appelé sur l'événement 'connection' reçu du Web Server
- request : requête Http correspondante : on ne sait rien en faire a priori
- wss1 : server web socket
*/
export class SyncSession {
  static sessions = new Map()

  // Array des syncList en attente de synchronisation (syncList : {sessionId, dh, rows})
  static syncListQueue = []

  // GC des sessions inactives
  static start () {
    setInterval(() => {
      const sessionsmortes = new Set()
      const dh1 = Date.now()
      const max = PINGTO * 6 * 10000 * (config.mondebug ? 1000 : 1)
      if (config.mondebug) config.logger.debug('PINGTO ' + max)
      SyncSession.sessions.forEach((session, sessionId) => {
        const dh2 = session.dhping
        if (dh2 !== 0 && ((dh1 - dh2) > max)) sessionsmortes.add(sessionId)
      })
      sessionsmortes.forEach(sessionId => {
        SyncSession.sessions.delete(sessionId)
      })
    }, PINGTO * 1000)
  }

  static getSession (sid, dh) { 
    const s = SyncSession.sessions.get(sid) 
    if (s) s.dhping = dh
    return s
  }

  constructor (ws /*, request, wss1*/) {
    this.ws = ws
    this.dhping = 0
    this.sessionId = null
    this.aboRds = new Set()
    this.aboPartC = 0
    // this.nbpings = 0
    this.ws.onerror = (e) => {
      config.logger.error(e)
      if (this.sessionId) SyncSession.sessions.delete(this.sessionId)
    }
    this.ws.onclose = (/* e */) => {
      if (this.sessionId) SyncSession.sessions.delete(this.sessionId)
      if (config.mondebug) config.logger.debug('Fermeture de session détectée:' + this.sessionId)
    }
    this.ws.onmessage = (m) => {
      // seul message reçu : ping avec le sessionid
      // this.nbpings++
      const newid = m.data
      // let os = false
      if (newid !== this.sessionId) {
        // nouvelle session
        // os = true
        if (this.sessionId) SyncSession.sessions.delete(this.sessionId)
        if (newid) {
          this.sessionId = newid
          SyncSession.sessions.set(newid, this)
        }
      }
      const pong = { pong: true, sessionId: (newid || '(admin)'), dh: Date.now() }
      const buf = new Uint8Array(encode(pong))
      this.ws.send(buf)
    }
  }

  /*
  pingrecu (os) { 
    const d = new Date()
    this.dhping = d.getTime()
    if (config.debug) config.logger.debug(
      os ? 'Ouverture de session reçue: ' : 'Ping reçu: ' +
      this.sessionId + ' / ' + d.toISOString())
  }
  */

  setAboRds (s, dh) { // A chaque Sync
    this.dhping = dh
    this.aboRds = s
  }

  setAboPartC (rds, dh) { // A chaque lecture d'une partition courante pour le Comptable
    this.dhping = dh
    this.aboPartC = rds
  }

  // La session a-telle à transmettre des avis de changement de versions ?
  traiteSyncList (syncList) { // syncList : { sessionId, rows }
    // filtre dans rows ceux concernés par la session et envoie (éventuellement) le message
    const msg = { sessionId: this.sessionId, rows: [] }
    syncList.rows.forEach(row => {
      if (this.aboRds.has(row.rds) || this.aboPartC === row.rds)
        msg.rows.push(row)
    })
    if (msg.rows.length) {
      const buf = new Uint8Array(encode(msg))
      setImmediate(() => {
        this.ws.send(buf)
      })
    }
  }

  // Annonce de versions changées : quelles sessions sont abonnées ?
  toSync(rows) {
    if (rows && rows.length) {
      SyncSession.syncListQueue.push( { rows: rows })
      setImmediate(() => { 
        while (SyncSession.syncListQueue.length) {
          const syncList = SyncSession.syncListQueue[0]
          SyncSession.sessions.forEach((session) => { // pas pour admin
            session.traiteSyncList(syncList)
          })
          SyncSession.syncListQueue.splice(0, 1)
        }
      })
    }
  }
}
