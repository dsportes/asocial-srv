
// Nécessaire pour better-sqlite3
// En ES6, webpack build incorrecte
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
export const Database = require('better-sqlite3')
export const webPush = require('web-push')

/*
// const prompt = require('prompt-sync')({ sigint: true })
const Firestore = require('@google-cloud/firestore').Firestore
const Storage = require('@google-cloud/storage').Storage
const {LoggingWinston} = require('@google-cloud/logging-winston')

// export default { prompt, Firestore, Storage, LoggingWinston }
export default { Firestore, Storage, LoggingWinston }
*/
