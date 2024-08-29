// const functions = require('@google-cloud/functions-framework')
// import functions from '@google-cloud/functions-framework'
import { exit } from 'process'

import { getDBProvider, getStorageProvider } from './src/util.mjs'
import { appExpress } from './src/cfgexpress.mjs'
import { config } from './src/config.mjs'
import{ loadTaches } from './taches.mjs'
import{ load3 } from './operations3.mjs'
import{ load4 } from './operations4.mjs'

loadTaches()
load3()
load4()

const db = await getDBProvider(config.run.db_provider, config.run.site)
if (!db || db.ko) exit(1)

const storage = await getStorageProvider(config.run.storage_provider)
if (!storage) exit(1)

export const asocialGCF = appExpress(db, storage)
