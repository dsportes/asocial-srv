import { config } from './config.mjs' // Avant Providers DB

import http from 'http'
import https from 'https'
import { existsSync, readFileSync } from 'node:fs'
import path from 'path'
import { exit, env } from 'process'
import { parseArgs } from 'node:util'

import winston from 'winston'
// eslint-disable-next-line no-unused-vars
// import { LoggingWinston } from '@google-cloud/logging-winston'

import express from 'express'
import { WebSocketServer } from 'ws'
import { encode, decode } from '@msgpack/msgpack'

import { decode3, FsProvider, S3Provider, GcProvider } from './storage.mjs'
import { SqliteProvider } from './sqlite.mjs'
import { FirestoreProvider } from './firestore.mjs'
import { Outils } from './export.mjs'
import { atStart, operations } from './operations.mjs'
import { SyncSession, startWs } from './ws.mjs'
import { Tarif, version, isAppExc, AppExc, E_SRV, A_SRV, F_SRV } from './api.mjs'

class Context {
  constructor () {
    this.keys = {}
    this.env = {}
  }

  get adminKey () { return this.keys.app.admin }

  get apitk () { return this.keys.app.apitk }

  site (s) { return this.keys.app.sites[s] }

}
export const ctx = new Context()

// Running dans GAE
ctx.gae = !(!env['GAE_DEPLOYMENT_ID'])
ctx.mondebug = (env.NODE_ENV === 'mondebug')

ctx.cmdargs = ctx.gae ? null : parseArgs({
  allowPositionals: true,
  options: { 
    outil: { type: 'string', short: 'o' },
    in: { type: 'string' },
    out: { type: 'string' },
    simulation: { type: 'boolean', short: 's'}
  }
})

const util = ctx.cmdargs.positionals.length > 0

// Setup Logging ***********************************************
function setLogger () {
  const BUGGOOGLEWINSTON = true
  if (!BUGGOOGLEWINSTON && ctx.gae) {
    // Imports the Google Cloud client library for Winston
    const loggingWinston = null // new LoggingWinston()
    // Logs will be written to: "projects/YOUR_PROJECT_ID/logs/winston_log"
    return winston.createLogger({
      level: 'info',
      transports: [
        new winston.transports.Console(),
        // Add Cloud Logging
        loggingWinston,
      ],
    })
  }

  // const { format, transports } = require('winston')
  // const { combine, timestamp, label, printf } = format
  const fne = config.pathlogs + '/error.log'
  const fnc = config.pathlogs + '/combined.log'
  const myFormat = winston.format.printf(({ level, message, timestamp }) => {
    return `${timestamp} ${level}: ${message}`
  })
  const logger = winston.createLogger({
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
    logger.add(new winston.transports.Console())
  return logger
}

ctx.logger = setLogger()
ctx.logger.info('Logs configurés' + (ctx.mondebug ? ' : MONDEBUG' : ''))

Tarif.tarifs = config.tarifs

/* Retourne le couple [hostname, port] d'une URL */
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

export function getStorageProvider (codeProvider) {
  const cfg = config[codeProvider]
  if (!cfg) return null
  const t = codeProvider.substring(0, codeProvider.indexOf('_'))
  switch (t) {
  case 'fs' : { return new FsProvider(cfg) }
  case 's3' : { return new S3Provider(cfg) }
  case 'gc' : { return new GcProvider(cfg) }
  }
  return null
}

export function getDBProvider (codeProvider, site) {
  const cfg = config[codeProvider]
  if (!cfg) return null
  const t = codeProvider.substring(0, codeProvider.indexOf('_'))
  switch (t) {
  case 'sqlite' : { return new SqliteProvider(cfg, site, codeProvider) }
  case 'firestore' : { return new FirestoreProvider(cfg, site, codeProvider) }
  }
  return null
}

try { 
  // Chargement des fichiers de configuration confidentiels
  for (const kn in config.keys) {
    const nf = config.keys[kn]
    const p = path.resolve(config.pathkeys + '/' + nf)
    if (existsSync(p)) {
      ctx.logger.info('KEY ' + nf + '= [' + p + ']')
      const x = readFileSync(p)
      if (nf.endsWith('json')) {
        const y = JSON.parse(x)
        ctx.keys[kn] = y
      } else ctx.keys[kn] = x
    }
  }

  // Variables d'environnement
  for (const n in config.env) {
    const v = config.env[n]
    if (v.startsWith('@')) {
      const nf = config.keys[v.substring(1)]
      const p = path.resolve(config.pathkeys + '/' + nf)
      env[n] = p
      ctx.env[n] = ctx.keys[v.substring(1)]
      ctx.logger.info('ENV ' + n + '=@ [' + p + ']')
    } else {
      env[n] = v
      ctx.env[n] = v
      ctx.logger.info('ENV ' + n + '= [' + v + ']')
    }
  }

  if (!util) {
    const site = config.run.site
    ctx.logger.info('SITE= [' + site + ']')
    ctx.appKey = ctx.site(site)
    ctx.rooturl = config.run.rooturl
    ctx.logger.info('ROOTURL= [' + ctx.rooturl + ']')
    ctx.port = env.PORT || config.run.port
    ctx.logger.info('PORT= [' + ctx.port + ']')
      
    ctx.origins = config.run.origins
    if (ctx.rooturl) {
      const [hn, po] = getHP(ctx.rooturl)
      const pox = ctx.gae || po === 0 ? ctx.port : po
      ctx.origins.push(hn + ':' + pox)
      ctx.origins.push(hn)
    }

    ctx.logger.info('DB= [' + config.run.db_provider + ']')
    ctx.db = getDBProvider(config.run.db_provider, site)
    if (!ctx.db) {
      ctx.logger.error('DB provider non trouvé:' + config.db_provider)
      exit(1)
    }
    await ctx.db.ping()

    ctx.logger.info('Storage= [' + config.run.storage_provider + ']')
    ctx.storage = getStorageProvider(config.run.storage_provider)
    if (!ctx.storage) {
      ctx.logger.error('Storage provider non trouvé:' + config.storage_provider)
      exit(1)
    }
    await ctx.storage.ping()
  }

} catch (e) {
  ctx.logger.error(e.toString())
  exit(1)
}

// Utils ********************************************************
if (util) {
  const [n, msg] = await new Outils().run()
  if (!n) {
    ctx.logger.info(msg)
    exit(0)
  } else {
    ctx.logger.error(msg)
    exit(n)
  }
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

// Configuration express

const app = express()

if (config.pathapp) {
  const ap = path.resolve(config.pathapp)
  ctx.logger.info('PATH_APP= [' + ap + ']')
  app.use(config.prefixapp, express.static(ap))
}

if (config.pathwww) {
  const ap = path.resolve(config.pathwww)
  ctx.logger.info('PATH_WWW= [' + ap + ']')
  app.use(config.prefixwww, express.static(ap))
}

// OPTIONS est toujours envoyé pour tester les appels cross origin
app.use('/', (req, res, next) => {
  if (req.method === 'OPTIONS')
    setRes(res, 200, 'text/plain').send('')
  else
    next()
})

//*** fs 
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
app.use(config.prefixop + '/:operation', async (req, res) => {
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

let mode
if (typeof(PhusionPassenger) !== 'undefined') {
  // eslint-disable-next-line no-undef
  PhusionPassenger.configure({ autoInstall: false })
  mode = 3
} else {
  mode = config.gae ? 2 : 1
}

try {
  if (ctx.db.hasWS) startWs()

  let server
  switch (mode) {
  case 3 : {
    const port = 'passenger'
    server = http.createServer(app).listen(port, () => {
      ctx.logger.info('PASSENGER HTTP_SERVER écoute [' + port + ']')
      try {
        atStart()
        if (ctx.mondebug) ctx.logger.debug('Server atStart OK')
      } catch (e) {
        ctx.logger.error('Server atStart erreur : ' + e.message)
      }
    })
    break
  }
  case 2 : {
    const port = ctx.port
    server = http.createServer(app).listen(port, () => {
      ctx.logger.info('GAE HTTP_SERVER écoute [' + port +']')
      try {
        atStart()
        if (ctx.mondebug) ctx.logger.debug('Server atStart OK')
      } catch (e) {
        ctx.logger.error('Server atStart erreur : ' + e.message)
      }
    })  
    break
  }
  case 1 : {
    // Création en https avec un certificat et sa clé de signature
    const port = ctx.port
    server = https.createServer({key: ctx.keys.priv, cert: ctx.keys.pub}, app).listen(port, () => {
      ctx.logger.info('HTTPS écoute [' + port + ']')
      try {
        atStart()
        if (ctx.mondebug) ctx.logger.debug('Server atStart OK')
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
    console.error('server.js : HTTP error = ' + e.message)
  })

} catch(e) { // exception générale. Ne devrait jamais être levée
  console.error('server.js : catch global = ' + e.message)
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
  if (ctx.origins.indexOf(hn) !== -1 || 
    ctx.origins.indexOf(x) !== -1 
  ) return true
  ctx.logger.error('Origine refusée : ' + origin)
  throw new AppExc(E_SRV, 1, [origin])
}

// Traitement générique d'une opération

async function operation(req, res) {
  let pfx = new Date().toISOString() // prefix de log
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
      if (apitk !== ctx.apitk) {
        throw new AppExc(E_SRV, 7, [apitk || '???'])
      }
    }
    if (isGet) args.isGet = true
    pfx += ' op=' + opName
    if (ctx.mondebug) ctx.logger.debug(pfx)
    const op = new opClass(opName)
    const result = await op.run(args)

    if (ctx.mondebug) ctx.logger.debug(pfx + ' 200')
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
      const xx = (e.stack ? e.stack + '\n' : '') + (ctx.db ? ctx.db.excInfo() : '')
      s = new AppExc(E_SRV, 0, [e.message], xx).toString()
    }
    if (ctx.mondebug) ctx.logger.debug(pfx + ' ' + httpst + ' : ' + s)
    setRes(res, httpst).send(Buffer.from(s))
  }
}
