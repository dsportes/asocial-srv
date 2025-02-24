import { env } from 'process'
import { secret } from './secret.mjs'
import { b642Obj } from './gensecret.mjs'
import { Tarif } from './api.mjs'

// import { LoggingWinston } from '@google-cloud/logging-winston'
// export const GAELoggingWinston = new LoggingWinston()
export const GAELoggingWinston = null

import { smSendgrid } from './sendgrid.mjs'
// export const mySmSendgrid = smSendgrid
export const mySmSendgrid = null

import { FsProvider } from './storageFS.mjs'
// const FsProvider = null

import { GcProvider } from './storageGC.mjs'
// const GcProvider = null

// import { S3Provider } from './storageS3.mjs'
const S3Provider = null

import { SqliteProvider } from './dbSqlite.mjs'
// const SqliteProvider = null

import { FirestoreProvider } from './dbFirestore.mjs'
// const FirestoreProvider = null

export const config = { // Valeurs par défaut et / ou obligatoires
  mondebug: true, // (env.NODE_ENV === 'mondebug'),
  debugsql: false,
  NOPURGESESSIONS: true, // En test ne pas purger les sessions dans notif

  tarifs: [
    { am: 202401, cu: [0.45, 0.10, 8, 20, 15, 15] },
    { am: 202501, cu: [0.55, 0.15, 8, 18, 15, 15] },
    { am: 202506, cu: [0.65, 0.10, 8, 15, 15, 15] }
  ],
  creationComptable: { qn: 5, qv: 5, qc: 5, cr: 100, pqn: 10, pqv: 10, pqc: 10 },
  D1: 2000, // Délai d'attente sur exception et opérations non authentifiées

  // Paramètres fonctionnel
  gccode: '1234azerty', // Code d'habilitation du lancement du GC
  heuregc: [3, 30], // Heure du jour des tâches GC
  retrytache: 60, // Nombre de minutes avant le retry d'une tâche

  // On utilise env pour EMULATOR
  // Variables d'environnement déclarées en interne
  env: {
    STORAGE_EMULATOR_HOST: 'http://127.0.0.1:9199', // 'http://' est REQUIS
    FIRESTORE_EMULATOR_HOST: 'localhost:8080'
  },

  // Configuations nommées des providers db
  sqlite_a: { path: './sqlite/testa.db3' },
  sqlite_b: { path: './sqlite/testb.db3' },
  firestore_a: { key: 'service_account'},

  // Configuations nommées des providers storage
  s3_a: { bucket: 'asocial', key: 's3_config' },
  fs_a: { rootpath: './fsstoragea' },
  fs_b: { rootpath: './fsstorageb' },
  gc_a: { bucket: 'asocial-test1.appspot.com', key: 'service_account' /* fixé pour emulator ? */ },

  // Pour les "serveurs" seulement: configuration des paths locaux
  pathlogs: './logs',
  pathkeys: './keys',

  run: { // Configuration du "serveur"
    site: 'B', // Donne sa clé de cryptage DB
    // origins: new Set(['http://localhost:8080']),

    nom: 'test asocial-B',
    // URL du serveur
    // N'EST UTILE QUE QUAND storage fs OU gc en mode EMULATOR
    rooturl: 'http://test.sportes.fr:8443',

    pubsubURL: null, // Si serveur OP+PUBSUB
    // pubsubURL: 'https://test.sportes.fr/pubsub/', // dans les autres cas
    // pubsubURL: 'http://localhost:8444/pubsub/',

    // SI "serveur"
    mode: 'http', // 'http' 'https' 'gae' 'passenger'
    port: 8443, // port d'écoute

    db_provider: 'firestore_a', //  Provider DB : service OP - 'firestore_a' 'sqlite_a'
    storage_provider: 'gc_a' // Provider Storage : service OP - 'gc_a', 'fs_a'

    // db_provider: 'sqlite_b', //  Provider DB : service OP - 'firestore_a' 'sqlite_a'
    // storage_provider: 'fs_b' // Provider Storage : service OP - 'gc_a', 'fs_a'
  }
}
// croninterne: '30 3 * * *', // A 3h30 du matin tous les jours OU false

const obj = b642Obj(secret)
for(let k in obj) config[k] = obj[k]

Tarif.init(config.tarifs)

for (const n in config.env) env[n] = config.env[n]

/*******************************************************************/
export function appKeyBin (site) { return Buffer.from(config.app_keys.sites[site].k, 'base64') }

/*******************************************************************/
class Logger {
  info (m) { console.log(m) }

  error (m) { console.error(m) }
  
  debug (m) { console.log(m) }
}
config.logger = new Logger()

/*******************************************************************/
export async function getStorageProvider (codeProvider, site) {
  config.logger.info('Storage= [' + config.run.storage_provider + ']')
  let storage
  switch (codeProvider.substring(0, codeProvider.indexOf('_'))) {
  case 'fs' : { storage = FsProvider ? new FsProvider(codeProvider, site) : null; break }
  case 's3' : { storage = S3Provider ? new S3Provider(codeProvider, site) : null; break }
  case 'gc' : { storage = GcProvider ? new GcProvider(codeProvider, site) : null; break }
  }
  if (!storage) {
    config.logger.error('Storage provider non trouvé:' + config.run.storage_provider)
    return false
  }
  if (config.mondebug) {
    const m = await storage.ping()
    config.logger.info(m)
  }
  return storage
}

export async function getDBProvider (codeProvider, site) {
  config.logger.info('DB= [' + codeProvider + ']')
  let dbp
  switch (codeProvider.substring(0, codeProvider.indexOf('_'))) {
  case 'sqlite' : { dbp = SqliteProvider ? new SqliteProvider(codeProvider, site) : null; break }
  case 'firestore' : { dbp = FirestoreProvider ? new FirestoreProvider(codeProvider, site) : null; break }
  }
  if (!dbp || dbp.ko) {
    config.logger.error('DB provider non trouvé:' + codeProvider)
    return false
  }
  if (config.mondebug) {
    const db = await dbp.connect({})
    const [st, detail] = await db.ping()
    await db.disconnect()
    config.logger.info('PING DB status:' + st + ' detail:' + detail)
  }
  return dbp
}
