import { env } from 'process'
import { app_keys } from './keys.mjs'
import { Tarif } from './api.mjs'

export const config = {
  mondebug: true, // (env.NODE_ENV === 'mondebug'),
  debugsql: false,
  NOPURGESESSIONS: true, // En test ne pas purger les sessions dans notif

  // Paramètres fonctionnels
  allocComptable: [8, 2, 8],
  allocPrimitive: [256, 256, 256],
  heuregc: [3, 30], // Heure du jour des tâches GC
  retrytache: 60, // Nombre de minutes avant le retry d'une tâche

  // Variables d'environnement déclarées en interne
  env: {
    // NORMALEMENT on n'utilise pas env pour ça:
    // GOOGLE_CLOUD_PROJECT: 'asocial-test1',
    // GOOGLE_APPLICATION_CREDENTIALS: './keys/service_account.json', // NORMALEMENT on n'utilise pas un json et env

    // On utilise env pour EMULATOR
    STORAGE_EMULATOR_HOST: 'http://127.0.0.1:9199', // 'http://' est REQUIS
    FIRESTORE_EMULATOR_HOST: 'localhost:8080'
  },

  // Configuations nommées des providers db
  sqlite_a: { path: './sqlite/test.db3' },
  sqlite_b: { path: './sqlite/testb.db3' },
  firestore_a: { },

  // Configuations nommées des providers storage
  s3_a: { bucket: 'asocial' },
  fs_a: { rootpath: './fsstorage' },
  fs_b: { rootpath: './fsstorageb' },
  gc_a: { bucket: 'asocial-test1.appspot.com', /* fixé pour emulator ? */ },

  // Pour les "serveurs" seulement: configuration des paths des URL
  pathlogs: './logs',
  pathkeys: './keys',

  // En "serveur" (OP+PUBSUB), SI aussi CDN pour l'application
  prefixapp: '/app',
  pathapp: './app',

  // En "serveur" (OP+PUBSUB), SI aussi web statique documentaire
  prefixwww: '/www',
  pathwww: './www',

  run: { // Configuration du "serveur"
    site: 'A',
    // origins: new Set(['http://localhost:8080']),

    nom: 'test asocial-sql',
    pubsubURL: null, // Si serveur OP+PUBSUB
    // pubsubURL: 'https://test.sportes.fr/pubsub/', // dans les autres cas
    // pubsubURL: 'http://localhost:8444/pubsub/',

    mode: 'http', // Si "serveur": 'http' 'https' 'gae' 'passenger'
    port: 8443, // Si "serveur": port d'écoute

    // Provider DB : service OP
    db_provider: 'firestore_a', // 'firestore_a' 'sqlite_a'
  
    // Provider Storage : service OP
    storage_provider: 'fs_a', // 'gc_a',
    // URL externe d'appel du serveur: SI storage fs OU gc en mode EMULATOR
    rooturl: 'http://test.sportes.fr:8443',

    // Si utilisation d'un provider Google
    projectId: 'asocial-test1',
  }
}
// croninterne: '30 3 * * *', // A 3h30 du matin tous les jours OU false

const tarifs = [
  { am: 202201, cu: [0.45, 0.10, 80, 200, 15, 15] },
  { am: 202305, cu: [0.45, 0.10, 80, 200, 15, 15] },
  { am: 202309, cu: [0.45, 0.10, 80, 200, 15, 15] }
]
Tarif.init(tarifs)

for (const n in config.env) env[n] = config.env[n]

class Logger {
  info (m) { console.log(m) }

  error (m) { console.error(m) }
  
  debug (m) { console.log(m) }
}
config.logger = new Logger()

export function appKeyBin (site) { return Buffer.from(app_keys.sites[site], 'base64') }
