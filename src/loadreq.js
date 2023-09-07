import { createRequire } from 'module'
const require = createRequire(import.meta.url)

const prompt = require('prompt-sync')({ sigint: true })
const Firestore = require('@google-cloud/firestore').Firestore
const Storage = require('@google-cloud/storage').Storage
const {LoggingWinston} = require('@google-cloud/logging-winston')
const Database = require('better-sqlite3')

export default { prompt, Database, Firestore, Storage, LoggingWinston }
