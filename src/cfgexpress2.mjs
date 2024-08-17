/* eslint-disable no-unused-vars */
import express from 'express'

import { config } from './config.mjs'
import { pubsub } from './notif.mjs'

// positionne les headers et le status d'une réponse. Permet d'accepter des requêtes cross origin des browsers
function setRes(res, status, respType) {
  res.status(status)
  /*
    .set({
      'Access-Control-Allow-Origin' : '*',
      'Access-Control-Allow-Methods' : 'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Access-Control-Allow-Headers, Authorization, X-Requested-With, X-API-version'
    })
  */
  return res.type(respType ? respType : 'application/octet-stream')
}

// Configuration express: retourne le "app"
export function appExpress() {
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

  //**** ping du site ***
  app.get('/ping', (req, res) => {
    setRes(res, 200, 'text/plain').send('PUBSUB - ' + new Date().toISOString())
  })

  //**** appels des services PUBSUB ****
  app.use(config.prefixpubsub + '/:operation', async (req, res) => {
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
