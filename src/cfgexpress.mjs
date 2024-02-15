import express from 'express'
import path from 'path'
import { encode, decode } from '@msgpack/msgpack'

import { app_keys } from './keys.mjs'
import { config } from './config.mjs'
import { decode3, getHP } from './util.mjs'
import { version, isAppExc, AppExc, E_SRV, A_SRV, F_SRV } from './api.mjs'

export const operations = {} // Toutes les opérations

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
export function appExpress(db, storage) {
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
  if (config.run.favicon) {
    app.get('/favicon.ico', (req, res) => {
      setRes(res, 200, 'image/x-icon').send(config.run.favicon)
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

  app.get('/storage/:arg', async (req, res) => {
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

  app.put('/storage/:arg', async (req, res) => {
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
    // push the data to body
    const body = [];
    req.on('data', (chunk) => {
      body.push(Buffer.from(chunk))
    }).on('end', async () => {
      req.body = Buffer.concat(body)
      await operation(req, res, db, storage)
    })
  })

  if (config.prefixapp) app.get('/', function (req, res) {
    res.redirect(config.prefixapp + '/index.html');
  })

  return app
}

//************************************************************* 
// vérification que l'origine appartient à la liste des origines autorisées (q'il y en a une)
// localhost passe toujours

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

async function operation(req, res, db, storage) {
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
      if (apitk !== app_keys.apitk) throw new AppExc(E_SRV, 7, [apitk || '???'])
    }
    if (isGet) args.isGet = true
    pfx += ' op=' + opName
    if (config.mondebug) config.logger.debug(pfx)
    const op = new opClass(opName)
    op.db = db
    op.storage = storage
    const result = await op.run(args)

    if (config.mondebug) config.logger.debug(pfx + ' 200')
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
      const xx = (e.stack ? e.stack + '\n' : '') + (db ? db.excInfo() : '')
      s = new AppExc(E_SRV, 0, [e.message], xx).toString()
    }
    if (config.mondebug) config.logger.debug(pfx + ' ' + httpst + ' : ' + s)
    setRes(res, httpst).send(Buffer.from(s))
  }
}
