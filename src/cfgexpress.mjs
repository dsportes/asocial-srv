/* eslint-disable no-unused-vars */
import express from 'express'
import path from 'path'
import { encode, decode } from '@msgpack/msgpack'

import favicon from './favicon.mjs'
import { config } from './config.mjs'
import { decode3 } from './util.mjs'
import { version, AMJ, isAppExc, AppExc, E_SRV, A_SRV, F_SRV } from './api.mjs'

// Toutes les opérations
export const operations = {
  auj: 0,
  nex: 1
}

// positionne les headers et le status d'une réponse. Permet d'accepter des requêtes cross origin des browsers
function setRes(res, status, respType) {
  res.status(status).set({
    'Access-Control-Allow-Origin' : '*',
    'Access-Control-Allow-Methods' : 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Access-Control-Allow-Headers, Authorization, X-Requested-With, X-API-version'
  })
  return res.type(respType ? respType : 'application/octet-stream')
}

// Configuration express: retourne le "app"
export function appExpress(dbp, storage) {
  const app = express()

  if (config.pathapp) {
    const ap = path.resolve(config.pathapp)
    config.logger.info('PATH_APP= [' + ap + ']')
    app.use(config.prefixapp, express.static(ap))
  }

  if (config.pathwww) {
    const ap = path.resolve(config.pathwww)
    config.logger.info('PATH_WWW= [' + ap + ']')
    app.use(config.prefixwww, express.static(ap))
  }

  // OPTIONS est toujours envoyé pour tester les appels cross origin
  app.use('/', (req, res, next) => {
    if (req.method === 'OPTIONS')
      setRes(res, 200, 'text/plain').send('')
    else
      next()
  })

  //**** Pour un "vrai" serveur favicon.ico et robots.txt du sites ****
  if (config.run.serveur) {
    app.get('/favicon.ico', (req, res) => {
      setRes(res, 200, 'image/x-icon').send(favicon)
    })
    const rob = 'User-agent: *\nDisallow: /\n'
    app.get('/robots.txt', (req, res) => {
      setRes(res, 200, 'text/plain').send(rob)
    })
  }

  //**** ping du site ***
  app.get('/ping', (req, res) => {
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
  app.use(config.prefixop + '/:operation', async (req, res) => {
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

  if (config.prefixapp) app.get('/', function (req, res) {
    res.redirect(config.prefixapp + '/index.html');
  })

  return app
}

/************************************************************* 
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
*/

/************************************************************* 
 * Traitement générique d'une opération
*************************************************************/

async function operation(req, res, dbp, storage) {
  operations.auj = AMJ.amjUtc()
  const opName = req.params.operation
  try {
    const isGet = req.method === 'GET'

    if (opName === 'yo'){
      setRes(res, 200, 'text/plain').send('yo ' + new Date().toISOString())
      return
    }

    // checkOrigin(req)

    if (opName === 'yoyo'){
      setRes(res, 200, 'text/plain').send('yoyo ' + new Date().toISOString())
      return
    }

    if (!isGet) {
      // vérification de la version de l'API
      const apiv = req.headers['x-api-version']
      if (!apiv || apiv !== version) throw new AppExc(E_SRV, 5, [version, apiv || '???'])
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
    const op = new opClass(opName)
    if (isGet) op.isGet = true
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
    } else {
      // erreur non trappée : mise en forme en AppExc
      httpst = 403
      const xx = (e.stack ? e.stack + '\n' : '') + (dbp ? dbp.excInfo() : '')
      s = new AppExc(E_SRV, 0, [e.message], xx).toString()
    }
    setRes(res, httpst).send(Buffer.from(s))
  }
}
