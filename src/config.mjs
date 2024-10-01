import { env } from 'process'
import { icon } from './icon.mjs'
import { b642Obj } from './genicon.mjs'
import { Tarif } from './api.mjs'

export const config = { // Valeurs par défaut et / ou obligatoires
  mondebug: true, // (env.NODE_ENV === 'mondebug'),
  debugsql: false,
  NOPURGESESSIONS: true, // En test ne pas purger les sessions dans notif

  tarifs: [
    { am: 202201, cu: [0.45, 0.10, 80, 200, 15, 15] },
    { am: 202305, cu: [0.45, 0.10, 80, 200, 15, 15] },
    { am: 202309, cu: [0.45, 0.10, 80, 200, 15, 15] }
  ],

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
  sqlite_a: { path: './sqlite/test.db3' },
  sqlite_b: { path: './sqlite/testb.db3' },
  firestore_a: { key: 'service_account'},

  // Configuations nommées des providers storage
  s3_a: { bucket: 'asocial', key: 's3_config' },
  fs_a: { rootpath: './fsstorage' },
  fs_b: { rootpath: './fsstorageb' },
  gc_a: { bucket: 'asocial-test1.appspot.com', key: 'service_account' /* fixé pour emulator ? */ },

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
    site: 'A', // Donne sa clé de cryptage DB
    // origins: new Set(['http://localhost:8080']),

    nom: 'test asocial-sql',
    // URL du serveur
    // N'EST UTILE QUE QUAND storage fs OU gc en mode EMULATOR
    rooturl: 'http://test.sportes.fr:8443',

    pubsubURL: null, // Si serveur OP+PUBSUB
    // pubsubURL: 'https://test.sportes.fr/pubsub/', // dans les autres cas
    // pubsubURL: 'http://localhost:8444/pubsub/',

    // SI "serveur"
    mode: 'http', // 'http' 'https' 'gae' 'passenger'
    port: 8443, // port d'écoute

    db_provider: 'sqlite_a', //  Provider DB : service OP - 'firestore_a' 'sqlite_a'
    storage_provider: 'fs_a' // Provider Storage : service OP - 'gc_a', 'fs_a'
  }
}
// croninterne: '30 3 * * *', // A 3h30 du matin tous les jours OU false

const obj = b642Obj(icon)
for(let k in obj) config[k] = obj[k]
Tarif.init(config.tarifs)

for (const n in config.env) env[n] = config.env[n]

class Logger {
  info (m) { console.log(m) }

  error (m) { console.error(m) }
  
  debug (m) { console.log(m) }
}
config.logger = new Logger()

export function appKeyBin (site) { return Buffer.from(config.app_keys.sites[site], 'base64') }
