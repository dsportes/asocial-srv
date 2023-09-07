import { mode, config } from './config.mjs'

function getHP (url) {
  let origin = url
  let i = origin.indexOf('://')
  if (i !== -1) origin = origin.substring(i + 3)
  i = origin.indexOf('/')
  if (i !== -1) origin = origin.substring(0, i)
  i = origin.indexOf(':')
  const hn = i === -1 ? origin : origin.substring(0, i)
  const po = i === -1 ? 0 : parseInt(origin.substring(i + 1))
  return [hn, po]
}

export const ctx = { 
  config: config,
  logger: null,
  port: 0,
  fs: null, 
  sql: null, 
  lastSql: [],
  auj: 0,
  utils: '',
  args: {}
}

// import Database from 'better-sqlite3'
// webpack ne build pas correctement
import { Database } from './loadreq.mjs'

if (!config.firestore) {
  const db = Database(mode === 2 ? './test.db3' : '../test.db3')
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(1)
  console.log(row.id, row.name)
}

import http from 'http'
import https from 'https'
import { existsSync, readFileSync } from 'node:fs'
import path from 'path'
import { exit, env } from 'process'
import { parseArgs } from 'node:util'

import { Firestore } from '@google-cloud/firestore'
import winston from 'winston'

// import { LoggingWinston } from '@google-cloud/logging-winston'

import express from 'express'
import { WebSocketServer } from 'ws'
import { encode, decode } from '@msgpack/msgpack'

import { faviconb64 } from './favicon.mjs'
import { toByteArray } from './base64.mjs'
import { decode3, FsProvider, S3Provider, GcProvider } from './storage.mjs'
import { UExport, UTest, UStorage } from './export.mjs'
import { atStart, operations } from './operations.mjs'
import { SyncSession, startWs } from './ws.mjs'
import { version, isAppExc, AppExc, E_SRV, A_SRV, F_SRV, AMJ } from './api.mjs'

export function getStorageProvider (stcode) {
  const t = stcode.substring(0, 2)
  const cfg = config[stcode + 'config']
  switch (t) {
  case 'fs' : { return new FsProvider(cfg) }
  case 's3' : { return new S3Provider(cfg) }
  case 'gc' : { return new GcProvider(cfg) }
  }
  return null
}

if (!config.gae) {
  const x = parseArgs({
    allowPositionals: true,
    options: { 
      outil: { type: 'string', short: 'o' },
      in: { type: 'string' },
      out: { type: 'string' },
      orgin: { type: 'string' },
      orgout: { type: 'string' },
      nsin: { type: 'string' },
      nsout: { type: 'string' },
      simulation: { type: 'boolean', short: 's'}
    }
  })
  ctx.utils = x.positionals[0]
  ctx.args = x.values
}

// Setup Logging ***********************************************
const myFormat = winston.format.printf(({ level, message, timestamp }) => {
  return `${timestamp} ${level}: ${message}`
})

const BUGGOOGLEWINSTON = true
if (!BUGGOOGLEWINSTON && config.gae) {
  // Imports the Google Cloud client library for Winston
  const loggingWinston = null // new LoggingWinston()
  // Logs will be written to: "projects/YOUR_PROJECT_ID/logs/winston_log"
  ctx.logger = winston.createLogger({
    level: 'info',
    transports: [
      new winston.transports.Console(),
      // Add Cloud Logging
      loggingWinston,
    ],
  })
} else {
  // const { format, transports } = require('winston')
  // const { combine, timestamp, label, printf } = format
  const fne = config.pathlogs + '/error.log'
  const fnc = config.pathlogs + '/combined.log'
  ctx.logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(winston.format.timestamp(), myFormat),
    // defaultMeta: { service: 'user-service' },
    transports: [
      // - Write all logs with importance level of `error` or less to `error.log`
      // - Write all logs with importance level of `info` or less to `combined.log`
      new winston.transports.File({ filename: fne, level: 'error' }),
      new winston.transports.File({ filename: fnc }),
    ],
  })
  // If we're not in production then log to the `console
  if (env.NODE_ENV !== 'production')
    ctx.logger.add(new winston.transports.Console())
}
ctx.logger.info('Logs configurés')

// Chargement de la configuation **************************
try { // Récupération de la configuration et définition du contexte d'exécution
  if (env.NODE_ENV === 'mondebug') {
    ctx.logger.info('Mode mondebug')
    ctx.debug = true
  }

  if (config.projectId) {
    if (!config.gae) // GAE n'accepte pas de modifier une de SES variables
      env['GOOGLE_CLOUD_PROJECT'] = config.projectId
    ctx.logger.info('GOOGLE_CLOUD_PROJECT=' + config.projectId)
  }

  if (config.emulator && config.firestore_emulator) {
    env['FIRESTORE_EMULATOR_HOST'] = config.firestore_emulator
    ctx.logger.info('FIRESTORE_EMULATOR_HOST=' +  config.firestore_emulator)
    ctx.config.emulator = config.firestore_emulator
  }

  if (config.emulator && config.storage_emulator) {
    env['STORAGE_EMULATOR_HOST'] = config.storage_emulator
    ctx.logger.info('STORAGE_EMULATOR_HOST=' +  config.storage_emulator)
  }

  {
    const p = path.resolve(config.pathconfig + '/service_account.json')
    if (existsSync(p)) {
      env['GOOGLE_APPLICATION_CREDENTIALS'] = p
      ctx.logger.info('GOOGLE_APPLICATION_CREDENTIALS=' + p)
      // Pour permettre, si nécessaire un jour, à la création
      // du Provider GC : new Storage(opt)
      // de spécifier en opt l'objet contenant ce service account
      // Code commenté dans storage.mjs.
      const x = readFileSync(p)
      ctx.config.service_account = JSON.parse(x)
    }
  }

  {
    const p = path.resolve(config.pathconfig + '/s3_config.json')
    if (existsSync(p)) {
      ctx.logger.info('s3_config=' + p)
      const x = readFileSync(p)
      ctx.config.s3_config = JSON.parse(x)
    }
  }

  {
    const p = path.resolve(config.pathconfig + '/firebase_config.json')
    if (existsSync(p)) {
      const x = readFileSync(p)
      config.fscredentials = JSON.parse(x)
      ctx.logger.info('FIREBASE_CONFIG=' + p)
    }
  }

  if (!config.gae) {
    const pc = path.resolve(config.pathconfig + '/fullchain.pem')
    const pk = path.resolve(config.pathconfig + '/privkey.pem')
    if (existsSync(pc) && existsSync(pk)) {
      config.certkey = readFileSync(pk)
      config.certcert = readFileSync(pc)
      ctx.logger.info('Certificat trouvé')
    }
  }

  ctx.port = env.PORT || config.port
  ctx.logger.info('PORT=' + ctx.port)
  if (config.rooturl) {
    const [hn, po] = getHP(config.rooturl)
    const pox = config.gae || po === 0 ? ctx.port : po
    config.origins.push(hn + ':' + pox)
    config.origins.push(hn)
  }

  if (!config.favicon) {
    ctx.favicon = Buffer.from(toByteArray(faviconb64))
  } else {
    ctx.favicon = readFileSync(path.resolve(config.pathconfig + '/' + config.favicon))
    // writeFileSync('./faviconb64', ctx.favicon)
  }

  if (config.firestore) {
    // Ne marche PAS
    // const opt = { projectId: config.projectId, keyFilename: './config/service_account.json' }
    // ctx.fs = new Firestore(opt)
    ctx.fs = new Firestore()
    {
      const dr = ctx.fs.doc('singletons/ping')
      await dr.set({ dh: new Date().toISOString() })
    }
    ctx.sql = null
    ctx.logger.info('DB=Firestore')
  } else {
    const p = path.resolve(config.pathsql)
    if (!existsSync(p)) {
      ctx.logger.info('DB (créée)=' + p)
    } else {
      ctx.logger.info('DB=' + p)
    }
    const options = {
      verbose: (msg) => {
        if (ctx.debug) ctx.logger.debug(msg)
        ctx.lastSql.unshift(msg)
        if (ctx.lastSql.length > 3) ctx.lastSql.length = 3
      } 
    }
    console.log('7 avant db')
    ctx.sql = Database(p, options)
    console.log('8 après db')
    ctx.fs = null
  }
  ctx.storage = getStorageProvider(config.storage_provider)
  await ctx.storage.ping()
  ctx.logger.info('Storage=' + config.storage_provider)

} catch (e) {
  ctx.logger.error(e.toString())
  exit(1)
}

// Utils ********************************************************
if (ctx.utils) {
  let ok
  if (ctx.utils === 'export' || ctx.utils === 'delete') {
    ok = await new UExport().run(ctx.args, ctx.utils)
  } else if (ctx.utils === 'storage') {
    ok = await new UStorage().run(ctx.args, ctx.utils)
  } else if (ctx.utils === 'test') { 
    ok = await new UTest().run(ctx.args, ctx.utils)
  } else {
    ctx.logger.info('Syntaxe: node/server.js export|delete|storage|test ...')
  }
  exit(ok ? 0 : 1)
}

//***************************************************************************

// positionne les headers et le status d'une réponse. Permet d'accepter des requêtes cross origin des browsers
function setRes(res, status, respType) {
  res.status(status).set({
    'Access-Control-Allow-Origin' : '*',
    'Access-Control-Allow-Methods' : 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Access-Control-Allow-Headers, Authorization, X-Requested-With, X-API-version'
  })
  return res.type(respType ? respType : 'application/octet-stream')
}

const app = express()

if (config.pathapp) {
  const ap = path.resolve(config.pathapp)
  ctx.logger.info('PATH_APP=' + ap)
  app.use(config.prefixapp, express.static(ap))
}

if (config.pathwww) {
  const ap = path.resolve(config.pathwww)
  ctx.logger.info('PATH_WWW=' + ap)
  app.use(config.prefixwww, express.static(ap))
}

// OPTIONS est toujours envoyé pour tester les appels cross origin
app.use('/', (req, res, next) => {
  if (req.method === 'OPTIONS')
    setRes(res, 200, 'text/plain').send('')
  else
    next()
})

//*** fs ou sql ****
app.get('/fs', (req, res) => {
  setRes(res, 200, 'text/plain').send(ctx.fs ? 'true' : 'false')
})

//**** favicon.ico du sites ****
app.get('/favicon.ico', (req, res) => {
  setRes(res, 200, 'image/x-icon').send(ctx.favicon)
})

//**** robots.txt du sites ****
const rob = 'User-agent: *\nDisallow: /\n'
app.get('/robots.txt', (req, res) => {
  setRes(res, 200, 'text/plain').send(rob)
})

//**** ping du site ***
app.get('/ping', (req, res) => {
  setRes(res, 200, 'text/plain').send('V11 ' + new Date().toISOString())
})

app.get('/storage/:arg', async (req, res) => {
  try {
    const [org, id, idf] = decode3(req.params.arg)
    const bytes = await ctx.storage.getFile(org, id, idf)
    if (bytes) {
      setRes(res, 200, 'application/octet-stream').send(bytes)
    } else {
      setRes(res, 404).send('Fichier non trouvé')
    }
  } catch (e) {
    setRes(res, 404).send('Fichier non trouvé')
  }
})

app.put('/storage/:arg', async (req, res) => {
  try {
    const [org, idcap, idf] = decode3(req.params.arg)
    const bufs = [];
    req.on('data', (chunk) => {
      bufs.push(chunk);
    }).on('end', async () => {
      const bytes = Buffer.concat(bufs)
      await ctx.storage.putFile(org, idcap, idf, bytes)
      setRes(res, 200).send('OK')
    })
  } catch (e) {
    setRes(res, 404).send('File not uploaded')
  }
})

//**** appels des opérations ****
app.use(ctx.config.prefixop + '/:operation', async (req, res) => {
  // push the data to body
  const body = [];
  req.on('data', (chunk) => {
    body.push(Buffer.from(chunk))
  }).on('end', async () => {
    req.body = Buffer.concat(body)
    await operation(req, res)
  })
})

if (config.prefixapp) app.get('/', function (req, res) {
  res.redirect(config.prefixapp + '/index.html');
})

//***** starts listen ***************************
// Modes possibles : (ctx.mode)
// - 1: serveur node.js dans un environnement dédié
// - 2: GAE - node.js dans GoogleAppEngine
// - 3: passenger - node.js dans un site Web partagé
// Pour installation sur o2switch
// https://faq.o2switch.fr/hebergement-mutualise/tutoriels-cpanel/app-nodejs

if (typeof(PhusionPassenger) !== 'undefined') {
  // eslint-disable-next-line no-undef
  PhusionPassenger.configure({ autoInstall: false })
  ctx.mode = 3
} else {
  ctx.mode = config.gae ? 2 : 1
}

try {
  if (ctx.sql) startWs()

  let server
  switch (ctx.mode) {
  case 3 : {
    const port = 'passenger'
    server = http.createServer(app).listen(port, () => {
      ctx.logger.info('PASSENGER_HTTP_SERVER')
      try {
        atStart()
      } catch (e) {
        ctx.logger.error('Passenger HTTP server atStart erreur : ' + e.message)
      }
    })
    break
  }
  case 2 : {
    const port = ctx.port
    server = http.createServer(app).listen(port, () => {
      ctx.logger.info('GAE HTTP_SERVER_PORT=' + port)
      try {
        atStart()
      } catch (e) {
        ctx.logger.error('GAE HTTP server atStart erreur : ' + e.message)
      }
    })  
    break
  }
  case 1 : {
    // Création en https avec un certificat et sa clé de signature
    const port = config.port
    server = https.createServer({key:config.certkey, cert:config.certcert}, app).listen(port, () => {
      ctx.logger.info('HTTPS_SERVER_PORT=' + port)
      try {
        atStart()
      } catch (e) {
        console.error('HTTPS server atStart erreur : ' + e.message)
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
    console.error('server.mjs : HTTP error = ' + e.message)
  })

} catch(e) { // exception générale. Ne devrait jamais être levée
  console.error('server.mjs : catch global = ' + e.message)
}

//************************************************************* 
// vérification que l'origine appartient à la liste des origines autorisées (q'il y en a une)
// localhost passe toujours

function checkOrigin(req) {
  let origin = req.headers['origin']
  if (!origin || origin === 'null') {
    const referer = req.headers['referer']
    if (referer) origin = referer
  }
  if (!origin || origin === 'null') origin = req.headers['host']
  // eslint-disable-next-line no-unused-vars
  const [hn, po] = getHP(origin)
  const x = hn + ':' + po
  if (ctx.config.origins.indexOf(hn) !== -1 || 
    ctx.config.origins.indexOf(x) !== -1 
  ) return true
  ctx.logger.error('Origine refusée : ' + origin)
  throw new AppExc(E_SRV, 1, [origin])
}

// Traitement générique d'une opération

async function operation(req, res) {
  let pfx = new Date().toISOString() // prefix de log
  ctx.auj = AMJ.amjUtc()
  try {
    const isGet = req.method === 'GET'
    const opName = req.params.operation

    if (opName === 'yo'){
      setRes(res, 200, 'text/plain').send('yo ' + pfx)
      return
    }

    // vérification de l'origine de la requête
    checkOrigin(req)

    if (opName === 'yoyo'){
      setRes(res, 200, 'text/plain').send('yoyo ' + pfx)
      return
    }

    // vérification de la version de l'API
    const apiv = req.headers['x-api-version']
    if (!apiv || apiv !== version) throw new AppExc(E_SRV, 5, [version, apiv || '???'])
    
    // récupétration de la fonction de ce module traitant l'opération
    const opClass = operations[opName]
    if (!opClass) throw new AppExc(E_SRV, 3, [opName || '???'])

    //**************************************************************
    // Appel de l'opération
    //   args : objet des arguments
    // Retourne un objet result :
    // Pour un GET :
    //   result.type : type mime
    //   result.bytes : si le résultat est du binaire
    // Pour un POST :
    //   OK : result : objet résultat à sérialiser - HTTP status 200
    // 
    // Exception : AppExc : AppExc sérialisé en JSON
    //   400 : F_SRV - erreur fonctionnelle
    //   401 : A_SRV - assertion
    //   402 : E_SRV - inattendue trappée DANS l'opération
    //   403 : E_SRV - inattendue NON trappée par l'opération (trappée ici)
    // *****************************************************************
    //  const args = isGet ? req.query : decode(req.body)
    let args, apitk
    if (isGet) {
      args = req.query
    } else {
      const x = decode(req.body)
      args = x[0]
      apitk = x[1]
      if (apitk !== ctx.config.apitk) {
        throw new AppExc(E_SRV, 7, [apitk || '???'])
      }
    }
    if (isGet) args.isGet = true
    pfx += ' op=' + opName
    if (ctx.debug) ctx.logger.debug(pfx)
    const op = new opClass(opName)
    const result = await op.run(args)

    if (ctx.debug) ctx.logger.debug(pfx + ' 200')
    if (isGet)
      setRes(res, 200, result.type || 'application/octet-stream').send(Buffer.from(result.bytes))
    else {
      setRes(res, 200).send(Buffer.from(encode(result)))
    }         
  } catch(e) {
    let httpst
    let s
    // exception non prévue ou prévue
    if (isAppExc(e)) { // erreur trappée déjà mise en forme en tant que AppExc F_SRV A_SRV E_SRV
      httpst = e.majeur *1000 === F_SRV ? 400 : (e.majeur * 1000 === A_SRV ? 401 : 402)
      delete e.stack
      s = e.toString() // JSON
    } else {
      // erreur non trappée : mise en forme en AppExc
      httpst = 403
      const xx = (e.stack ? e.stack + '\n' : '') + (ctx.sql ? ctx.lastSql.join('\n') : '')
      s = new AppExc(E_SRV, 0, [e.message], xx).toString()
    }
    if (ctx.debug) ctx.logger.debug(pfx + ' ' + httpst + ' : ' + s)
    setRes(res, httpst).send(Buffer.from(s))
  }
}
