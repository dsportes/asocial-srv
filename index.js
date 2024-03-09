// const functions = require('@google-cloud/functions-framework')
// import functions from '@google-cloud/functions-framework'
import { exit } from 'process'

import { getDBProvider, getStorageProvider } from './src/util.mjs'
import { appExpress } from './src/cfgexpress.mjs'
import { config } from './src/config.mjs'
// import{ load } from './src/operations.mjs'
// import{ load2 } from './src/operations2.mjs'
import{ load3 } from './src/operations3.mjs'

// load()
// load2()
load3()

const db = await getDBProvider(config.run.db_provider, config.run.site)
if (!db) exit(1)

const storage = await getStorageProvider(config.run.storage_provider)
if (!storage) exit(1)

export const asocialGCF = appExpress(db, storage)
