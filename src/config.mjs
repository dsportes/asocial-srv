/* eslint-disable no-unused-vars */

const optA = 2
/*
1:GAE 
2:Test local sans build
3:Test local avec build

Exemple export-db:
node src/server.js export-db --in 32,doda,sqlite_a,A --out 24,coltes,sqlite_b,A

Exemple export-st:

*/

const optB = 1

const keys0 = {
  app: 'app_keys.json',
  favicon: 'favicon.ico',
  firebase_config: 'firebase_config.json',
  pub: 'fullchain.pem',
  priv: 'privkey.pem',
  s3_config: 's3_config.json',
  service_account: 'service_account.json'
}

const keys1 = {
  app: 'app_keys.json',
  favicon: 'favicon.ico',
  pub: 'fullchain.pem',
  priv: 'privkey.pem',
  firebase_config: 'firebase_config.json',
  service_account: 'service_account.json'
}

const keys2 = {
  app: 'app_keys.json',
  favicon: 'favicon.ico',
  firebase_config: 'firebase_config.json',
  pub: 'fullchain.pem',
  priv: 'privkey.pem',
  s3_a: 's3_config.json'
}

const env1 = {
  GOOGLE_CLOUD_PROJECT: 'asocial-test1',
  GOOGLE_APPLICATION_CREDENTIALS: '@service_account',
  STORAGE_EMULATOR_HOST: 'http://127.0.0.1:9199', // 'http://' est REQUIS
  FIRESTORE_EMULATOR_HOST: 'localhost:8080'
}

const run1 = {
  croninterne: optA === 1 ? false : '30 3 * * *', // A 3h30 du matin tous les jours

  site: 'A',
  // URL externe d'appel du serveur 
  rooturl: optA === 1 ? 'asocial-test1.ew.r.appspot.com' : 'https://test.sportes.fr:8443',
  // Port d'écoute si NON gae
  port: optA !== 1 ? 8443 : 0, // port: 443,
  // Origines autorisées
  origins: [ 'localhost:8343' ],
  // Provider DB
  storage_provider: optA === 1 ? 'gc_a' : 'fs_a',
  // Provider Storage
  db_provider: optA === 1 ? 'firestore_a' : 'sqlite_a',
}

const run2 = {
  croninterne: optA === 1 ? false : '30 3 * * *', // '53 16 * * *'

  site: 'A',
  // URL externe d'appel du serveur 
  rooturl: optA === 1 ? 'asocial-test1.ew.r.appspot.com' : 'https://test.sportes.fr:8443',
  // Port d'écoute si NON gae
  port: optA !== 1 ? 8443 : 0, // port: 443,
  // Origines autorisées
  origins: [ 'localhost:8343' ],
  // Provider DB
  storage_provider: optA === 1 ? 'gc_a' : 'fs_b',
  // Provider Storage
  db_provider: optA === 1 ? 'firestore_a' : 'sqlite_b',
}

export const config = {
  // Paramètres fonctionnels
  tarifs: [
    { am: 202201, cu: [0.45, 0.10, 80, 200, 15, 15] },
    { am: 202305, cu: [0.45, 0.10, 80, 200, 15, 15] },
    { am: 202309, cu: [0.45, 0.10, 80, 200, 15, 15] }
  ],

  // HTTP server: configuration des paths des URL
  prefixop: '/op',
  prefixapp: '/app',
  pathapp: optA === 1 ? '' : './app',
  prefixwww: '/www',
  pathwww: optA === 1 ? '' : './www',
  pathlogs: optA === 2 ? './logs' : '../logs',
  pathkeys: './keys',

  keys: keys1,

  env: env1,

  run: run1,

  s3_a: {
    bucket: 'asocial'
  },

  fs_a: {
    rootpath: optA === 2 ? './fsstorage' : '../fsstorage'
  },

  fs_b: {
    rootpath: optA === 2 ? './fsstorageb' : '../fsstorageb'
  },

  gc_a: {
    bucket: 'asocial-test1.appspot.com', // Pour emulator
    // bucket: 'asocial' // Pour prod, quoi que ...
  },

  sqlite_a: {
    path: './sqlite/test.db3'
  },

  sqlite_b: {
    path: './sqlite/testb.db3'
  },

  firestore_a: {
  }

}
