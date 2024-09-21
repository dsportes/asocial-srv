// const functions = require('@google-cloud/functions-framework')
// import functions from '@google-cloud/functions-framework'

// import { app_keys } from './keys.mjs'
import { appExpress } from './src/cfgexpress2.mjs'
import { appKeyBin, config } from './src/config.mjs'
import { pubsubStart } from './notif.mjs'

{
  const app_keys = config.keys.app_keys
  const vpub = app_keys.vapid_public_key
  const vpriv = app_keys.vapid_private_key
  const appKey = appKeyBin(config.run.site)
  const pubsubURL = config.run.pubsubURL
  pubsubStart(appKey, pubsubURL, vpub, vpriv, config.logger, config.NOPURGESESSIONS)
}

export const asocialGCF = appExpress()
