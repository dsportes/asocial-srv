import { env } from 'process'
// eslint-disable-next-line no-unused-vars
import { app_keys, service_account } from './keys.mjs'
import { Tarif } from './api.mjs'

export const config = {
  mondebug: true, // (env.NODE_ENV === 'mondebug'),

  // Paramètres fonctionnels
  tarifs: [
    { am: 202201, cu: [0.45, 0.10, 80, 200, 15, 15] },
    { am: 202305, cu: [0.45, 0.10, 80, 200, 15, 15] },
    { am: 202309, cu: [0.45, 0.10, 80, 200, 15, 15] }
  ],

  // paramètres ayant à se retrouver en variables d'environnement
  env: {
    // NORMALEMENT on n'utilise pas env pour ça:
    // GOOGLE_CLOUD_PROJECT: 'asocial-test1',
    // GOOGLE_APPLICATION_CREDENTIALS: './keys/service_account.json', // NORMALEMENT on n'utilise pas un json et env

    // EMULATOR
    // STORAGE_EMULATOR_HOST: 'http://127.0.0.1:9199', // 'http://' est REQUIS
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
    nom: 'test asocial-fs/gc',
    serveur: true,

    // Provider DB
    // storage_provider: 'fs_a',
    storage_provider: 'gc_a',
    // Provider Storage
    // db_provider: 'sqlite_a',

    db_provider: 'firestore_a',

    // Running dans GAE
    gae: !(!env['GAE_DEPLOYMENT_ID']),
  
    projectId: 'asocial-test1', // Si utilisation d'un provider Google

    site: 'A',

    /* ZONE réservée à un serveur NON GAE **************************/

    croninterne: '30 3 * * *', // A 3h30 du matin tous les jours OU false

    /* URL externe d'appel du serveur
    Ne sert qu'à un provider de storage qui doit utiliser le serveur pour 
    délivrer une URL get / put file.
    - storageFS / storageGC en mode emulator
    */
    rooturl: 'https://test.sportes.fr:8443',

    // Port d'écoute
    port: 8443
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
