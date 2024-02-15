import { env } from 'process'
import { app_keys, service_account } from './keys.mjs'
import { Tarif } from './api.mjs'

export const config = {
  mondebug: (env.NODE_ENV === 'mondebug'),

  // Paramètres fonctionnels
  tarifs: [
    { am: 202201, cu: [0.45, 0.10, 80, 200, 15, 15] },
    { am: 202305, cu: [0.45, 0.10, 80, 200, 15, 15] },
    { am: 202309, cu: [0.45, 0.10, 80, 200, 15, 15] }
  ],

  // paramètres ayant à se retrouver en varaibles d'environnement
  env: {
    GOOGLE_CLOUD_PROJECT: 'asocial-test1',
    GOOGLE_APPLICATION_CREDENTIALS: service_account,
    STORAGE_EMULATOR_HOST: 'http://127.0.0.1:9199', // 'http://' est REQUIS
    FIRESTORE_EMULATOR_HOST: 'localhost:8080'
  },

  // Configuation nommées des providers db et storage
  s3_a: { bucket: 'asocial' },
  fs_a: { rootpath: './fsstorage' },
  fs_b: { rootpath: './fsstorageb' },
  gc_a: { bucket: 'asocial-test1.appspot.com', /* fixé pour emulator ? */ },
  sqlite_a: { path: './sqlite/test.db3' },
  sqlite_b: { path: './sqlite/testb.db3' },
  firestore_a: { },

  // Pour HTTP server seulement: configuration des paths des URL
  prefixop: '/op',
  prefixapp: '/app',
  pathapp: './app',
  prefixwww: '/www',
  pathwww: './www',
  pathlogs: './logs',
  pathkeys: './keys',

  run: { // Configuration du "serveur"
    nom: 'test Sqlite',
    croninterne: '30 3 * * *', // A 3h30 du matin tous les jours OU false
  
    site: 'A',
    // URL externe d'appel du serveur 
    // rooturl: 'asocial-test1.ew.r.appspot.com',
    rooturl: 'https://test.sportes.fr:8443',
    // Port d'écoute si NON gae
    port: 8443,
    // Origines autorisées
    origins: new Set(['localhost:8343']),
    // Provider DB
    storage_provider: 'fs_a',
    // Provider Storage
    db_provider: 'sqlite_a',
    // Running dans GAE
    gae: !(!env['GAE_DEPLOYMENT_ID'])
  }

}

Tarif.tarifs = config.tarifs

for (const n in config.env) env[n] = config.env[n]

class Logger {
  info (m) { console.log(m) }

  error (m) { console.error(m) }
  
  debug (m) { console.log(m) }
}

config.logger = new Logger()

export function appKeyBin (site) { return Buffer.from(app_keys.sites[site], 'base64') }
