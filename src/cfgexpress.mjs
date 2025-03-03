/* eslint-disable no-unused-vars */
import express from 'express'
import { encode, decode } from '@msgpack/msgpack'

import { config } from './config.mjs'
import { decode3, getHP, sendAlMail, sleep } from './util.mjs'
import { AMJ, APIVERSION, isAppExc, AppExc, E_SRV, A_SRV, F_SRV } from './api.mjs'
import { pubsub } from './notif.mjs'

// Toutes les opérations
export const operations = {
  auj: 0,
  nex: 1
}

// positionne les headers et le status d'une réponse. Permet d'accepter des requêtes cross origin des browsers
function setRes(res, status, respType) {
  res.status(status)
  addCors(res)
  return res.type(respType ? respType : 'application/octet-stream')
}

function addCors (res) {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
  res.header('Access-Control-Allow-Headers', 'Origin, Content-Type, Accept')
  return res
}

// Configuration express: retourne le "app"
export function appExpress(dbp, storage) {
  const app = express()

  app.use((req, res, next) => {
    // http://enable-cors.org/server_expressjs.html
    res.header('Access-Control-Allow-Origin', '*')
    res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
    res.header('Access-Control-Allow-Headers', 'Origin, Content-Type, Accept')
    next();
  })

  // OPTIONS est toujours envoyé pour tester les appels cross origin
  app.use('/', (req, res, next) => {
    if (req.method === 'OPTIONS')
      setRes(res, 200, 'text/plain').send('')
    else
      next()
  })

  //**** Pour un "vrai" serveur robots.txt du sites ****
  if (config.run.mode) {
    const rob = 'User-agent: *\nDisallow: /\n'
    app.get('/robots.txt', (req, res) => {
      setRes(res, 200, 'text/plain').send(rob)
    })
  }

  //**** ping du site ***
  app.get('/ping', async (req, res) => {
    await sleep(config.D1)
    setRes(res, 200, 'text/plain').send((config.run.nom ? config.run.nom + ' - ' : '') + new Date().toISOString())
  })

  if (config.run.rooturl) app.get('/storage/:arg', async (req, res) => {
    try {
      const [org, id, idf] = decode3(req.params.arg)
      const bytes = await storage.getFile(org, id, idf)
      if (bytes) {
        setRes(res, 200, 'application/octet-stream').send(bytes)
      } else {
        setRes(res, 404).send('Fichier non trouvé')
      }
    } catch (e) {
      setRes(res, 404).send('Fichier non trouvé')
    }
  })

  if (config.run.rooturl) app.put('/storage/:arg', async (req, res) => {
    try {
      const [org, idcap, idf] = decode3(req.params.arg)
      const bufs = [];
      req.on('data', (chunk) => {
        bufs.push(chunk);
      }).on('end', async () => {
        const bytes = Buffer.concat(bufs)
        await storage.putFile(org, idcap, idf, bytes)
        setRes(res, 200).send('OK')
      })
    } catch (e) {
      setRes(res, 404).send('File not uploaded')
    }
  })

  //**** appels des opérations ****
  app.use('/op/:operation', async (req, res) => {
    if (!req.rawBody) {
      const body = [];
      req.on('data', (chunk) => {
        body.push(Buffer.from(chunk))
      }).on('end', async () => {
        req.rawBody = Buffer.concat(body)
        await operation(req, res, dbp, storage)
      })
    } else
      await operation(req, res, dbp, storage)
  })

  //**** appels des services PUBSUB ****
  app.use('/pubsub/:operation', async (req, res) => {
    if (!req.rawBody) {
      const body = [];
      req.on('data', (chunk) => {
        body.push(Buffer.from(chunk))
      }).on('end', async () => {
        req.rawBody = Buffer.concat(body)
        await pubsub(req, res)
      })
    } else
      await pubsub(req, res)
  })

  return app
}

/*************************************************************/
function checkOrigin(req) {
  const o = config.run.origins
  let origin = req.headers['origin']
  if (o.has(origin)) return true
  if (!origin || origin === 'null') {
    const referer = req.headers['referer']
    if (referer) origin = referer
  }
  if (o.has(origin)) return true
  if (!origin || origin === 'null') origin = req.headers['host']
  const [hn, po] = getHP(origin)
  const x = hn + ':' + po
  if (config.run.origins.has(hn) || config.run.origins.has(x)) return true
  config.logger.error('Origine refusée : ' + origin)
  throw new AppExc(E_SRV, 1, [origin])
}

/************************************************************* 
 * Traitement générique d'une opération
*************************************************************/

async function operation(req, res, dbp, storage) {
  operations.auj = AMJ.amjUtc()
  const opName = req.params.operation
  let op = null
  try {
    const isGet = req.method === 'GET'

    if (opName === 'yo'){
      await sleep(2000)
      setRes(res, 200, 'text/plain').send('yo ' + new Date().toISOString())
      return
    }

    if (config.run.origins && config.run.origins.size) checkOrigin(req)

    if (opName === 'yoyo'){
      await sleep(2000)
      setRes(res, 200, 'text/plain').send('yoyo ' + new Date().toISOString())
      return
    }
  
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
    let args
    if (isGet)
      args = req.query
    else {
      args = decode(req.rawBody)
    }
    op = new opClass(opName)
    if (isGet) op.isGet = true

    if (args.APIVERSION && args.APIVERSION !== APIVERSION)
      throw new AppExc(E_SRV, 5, [APIVERSION, args.APIVERSION])

    const result = await op.run(args, dbp, storage)
    if (op.isGet) {
      if (!result.type)
        setRes(res, 200, 'application/octet-stream').send(Buffer.from(result.bytes))
      else
        setRes(res, 200, result.type).send(Buffer.from(result.bytes))
    } else {
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
      if (op && e.code > 9000 && e.code < 9999) {
        const al = config.alertes
        if (al) {
          const al1 = al['admin']
          if (al1)
            await sendAlMail(config.run.nom, op.org || 'admin', al1, 'assert-' + e.code)
        }
      }
    } else {
      // erreur non trappée : mise en forme en AppExc
      httpst = 403
      const xx = e.stack ? e.stack + '\n' : ''
      s = new AppExc(E_SRV, 0, [e.message], xx).toString()
    }
    setRes(res, httpst).send(Buffer.from(s))
  }
}
