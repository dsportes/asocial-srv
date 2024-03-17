import { config } from './config.mjs' // Avant Providers DB

import http from 'http'
import https from 'https'
import path from 'path'
import { exit, env } from 'process'
import { existsSync, readFileSync } from 'node:fs'
import { WebSocketServer } from 'ws'
import schedule from 'node-schedule'

import { setLogger } from './logger.mjs'
import { SyncSession } from './ws.mjs'
import { getDBProvider, getStorageProvider } from './util.mjs'
import { appExpress, operations } from './cfgexpress.mjs'

// import{ load } from './operations.mjs'
// import{ load2 } from './operations2.mjs'
import{ load3 } from './operations3.mjs'
import{ load4 } from './operations4.mjs'

// load()
// load2()
load3()
load4()

let db = null, storage = null
const keys = ['favicon.ico', 'fullchain.pem', 'privkey.pem']
try {
  config.logger = setLogger()
  config.logger.info('Logs configurés' + (config.mondebug ? ' : MONDEBUG' : ''))
  config.logger.info('SITE= [' + config.run.site + ']')
  config.logger.info('ROOTURL= [' + config.run.rooturl + ']')
  const port = env.PORT || config.run.port
  config.logger.info('PORT= [' + port + ']')

  /*
  if (config.run.rooturl) {
    const [hn, po] = getHP(config.run.rooturl)
    const pox = config.run.gae || po === 0 ? config.port : po
    config.run.origins.add(hn + ':' + pox)
    config.run.origins.add(hn)
  }
  */

  db = await getDBProvider(config.run.db_provider, config.run.site)
  if (!db) exit(1)
  
  storage = await getStorageProvider(config.run.storage_provider)
  if (!storage) exit(1)

  for (const nf of keys) {
    const p = path.resolve(config.pathkeys + '/' + nf)
    const n = nf.substring(0, nf.indexOf('.'))
    if (existsSync(p)) {
      config.logger.info('KEY ' + n + ' : OK')
      config.run[n] = readFileSync(p)
    }
  }

} catch (e) {
  config.logger.error(e.toString() + '\n' + e.stack)
  exit(1)
}

//***************************************************************************

const app = appExpress(db, storage)

function atStart() {
  if (config.run && config.run.croninterne && operations.GCGen) {
    config.logger.info('Scheduler started')
    schedule.scheduleJob(config.run.croninterne, function(){
      new operations.GCGen(true).run()
    })
  }
}

//***** starts listen ***************************
// Modes possibles : (ctx.mode)
// - 1: serveur node.js dans un environnement dédié
// - 2: GAE - node.js dans GoogleAppEngine
// - 3: passenger - node.js dans un site Web partagé
// Pour installation sur o2switch
// https://faq.o2switch.fr/hebergement-mutualise/tutoriels-cpanel/app-nodejs

let mode
if (typeof(PhusionPassenger) !== 'undefined') {
  // eslint-disable-next-line no-undef
  PhusionPassenger.configure({ autoInstall: false })
  mode = 3
} else {
  mode = config.run.gae ? 2 : 1
}

try {
  if (db.hasWS) SyncSession.start()

  let server
  switch (mode) {
  
  case 3 : { // Passenger
    const port = 'passenger'
    server = http.createServer(app).listen(port, () => {
      config.logger.info('PASSENGER HTTP_SERVER écoute [' + port + ']')
      try {
        atStart()
        if (config.mondebug) config.logger.debug('Server atStart OK')
      } catch (e) {
        config.logger.error('Server atStart erreur : ' + e.message)
      }
    })
    break
  }

  case 2 : { // GAE
    const port = env.PORT
    server = http.createServer(app).listen(port, () => {
      config.logger.info('GAE HTTP_SERVER écoute [' + port +']')
    })  
    break
  }

  case 1 : { // HTTPS : certificat
    const port = config.run.port
    server = https.createServer({key: config.run.privkey, cert: config.run.fullchain}, app).listen(port, () => {
      config.logger.info('HTTPS écoute [' + port + ']')
      try {
        atStart()
        if (config.mondebug) config.logger.debug('Server atStart OK')
      } catch (e) {
        console.error('Server atStart erreur : ' + e.message)
      }
    })
    const wss = new WebSocketServer({ server })
    wss.on('connection', (ws, request) => {
      new SyncSession (ws, request, wss)
    })
    break
  }
  }

  server.on('error', (e) => { // les erreurs de création du server ne sont pas des exceptions
    console.error('server.js : HTTP error = ' + e.message + '\n' + e.stack)
  })

} catch(e) { // exception générale. Ne devrait jamais être levée
  console.error('server.js : catch global = ' + e.message + '\n' + e.stack)
}
