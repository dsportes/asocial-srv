// const functions = require('@google-cloud/functions-framework')
// import functions from '@google-cloud/functions-framework'

import { appExpress } from './src/cfgexpress2.mjs'
import { config } from './src/config.mjs'
import { pubsubStart } from './notif.mjs'

function appKeyBin () { 
  return Buffer.from(config.app_keys.sites[config.run.site], 'base64') 
}

{
  const vpub = config.vapid_public_key
  const vpriv = config.vapid_private_key
  const appKey = appKeyBin()
  const pubsubURL = config.run.pubsubURL
  pubsubStart(appKey, pubsubURL, vpub, vpriv, config.logger, config.NOPURGESESSIONS)
}

export const asocialGCF = appExpress()
