import { env } from 'process'
import { app_keys } from './keys.mjs'
import { Tarif } from './api.mjs'

export const config = {
  mondebug: true, // (env.NODE_ENV === 'mondebug'),
  NOPURGESESSIONS: true, // En test ne pas purger les sessions dans notif

  // Paramètres fonctionnels
  tarifs: [
    { am: 202201, cu: [0.45, 0.10, 80, 200, 15, 15] },
    { am: 202305, cu: [0.45, 0.10, 80, 200, 15, 15] },
    { am: 202309, cu: [0.45, 0.10, 80, 200, 15, 15] }
  ],
  allocComptable: [8, 2, 8],
  allocPrimitive: [256, 256, 256],
  heuregc: [3, 30], // Heure du jour des tâches GC
  retrytache: 60, // Nombre de minutes avant le retry d'une tâche

  // paramètres ayant à se retrouver en variables d'environnement
  env: {
    // NORMALEMENT on n'utilise pas env pour ça:
    // GOOGLE_CLOUD_PROJECT: 'asocial-test1',
    // GOOGLE_APPLICATION_CREDENTIALS: './keys/service_account.json', // NORMALEMENT on n'utilise pas un json et env

    // EMULATOR
    // STORAGE_EMULATOR_HOST: 'http://127.0.0.1:9199', // 'http://' est REQUIS
    // FIRESTORE_EMULATOR_HOST: 'localhost:8080'
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
  prefixpubsub: '/pubsub',
  prefixapp: '/app',
  pathapp: './app',
  prefixwww: '/www',
  pathwww: './www',
  pathlogs: './logs',
  pathkeys: './keys',

  run: { // Configuration du "serveur"
    pubsubMode: 'http', // 'http' 'https' 'gae' 'passenger'
    pubsubPort: 8444, // Utilisé par pubsub.js

    nom: 'test asocial-sql',
    pubsubURL: null,
    // pubsubURL: 'https://test.sportes.fr/pubsub/',
    // pubsubURL: 'http://localhost:8444/pubsub/',

    mode: 'http', // 'http' 'https' 'gae' 'passenger'
    port: 8443, // Port d'écoute, utilisé par server.js

    // Provider DB
    storage_provider: 'fs_a',
    // storage_provider: 'gc_a',
    // Provider Storage
    db_provider: 'sqlite_a',
    // db_provider: 'firestore_a',

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
    rooturl: 'http://test.sportes.fr:8443'

  }

}

Tarif.init(config.tarifs)

for (const n in config.env) env[n] = config.env[n]

class Logger {
  info (m) { console.log(m) }

  error (m) { console.error(m) }
  
  debug (m) { console.log(m) }
}

config.logger = new Logger()

export function appKeyBin (site) { return Buffer.from(app_keys.sites[site], 'base64') }
