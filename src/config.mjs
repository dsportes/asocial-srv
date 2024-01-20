export const mode = 2
/*
1:GAE 
2:Test usuel
3:Test local après build
*/

export const config = {
  // path du fichier externe de configuration confidentiel
  pathconfig: './config',

  // URL externe d'appel du serveur 
  rooturl: mode === 1 ? 'asocial-test1.ew.r.appspot.com' : 'https://test.sportes.fr:8443',

  // Hébergement par Google App Engine (sinon serveur node standard)
  gae: mode === 1 ? true : false,
  
  // Port d'écoute si NON gae
  port: 8443, // port: 443,
  
  // Origines autorisées
  origins: [ 'localhost:8343' ],

  // Id du projet Google : pour les providers gc_* et fs_*
  projectId: 'asocial-test1', 

  // HTTP server: configuration des paths des URL
  prefixop: '/op',
  prefixapp: '/app',
  pathapp: mode === 1 ? '' : './app',
  prefixwww: '/www',
  pathwww: mode === 1 ? '' : './www',

  pathlogs: mode === 2 ? './logs' : '../logs',
  
  // Providers: db et storage
  storage_provider: mode === 1 ? 'gc_a' : 'fs_a',
  db_provider: mode === 1 ? 'firestore_a' : 'sqlite_a',

  s3_a: {
    bucket: 'asocial'
  },

  fs_a: {
    rootpath: mode === 2 ? './fsstorage' : '../fsstorage'
  },

  fs_b: {
    rootpath: mode === 2 ? './fsstorageb' : '../fsstorageb'
  },

  gc_a: {
    bucket: 'asocial-test1.appspot.com', // Pour emulator
    // bucket: 'asocial' // Pour prod, quoi que ...
    storage_emulator: 'http://127.0.0.1:9199' // 'http://' est REQUIS
  },

  sqlite_a: {
    path: '../sqlite/test.db3'
  },

  sqlite_b: {
    path: '../sqlite/test1.db3'
  },

  firestore_a: {
    emulator: false,
    firestore_emulator: 'localhost:8080',
  },

  tarifs: [
    { am: 202201, cu: [0.45, 0.10, 80, 200, 15, 15] },
    { am: 202305, cu: [0.45, 0.10, 80, 200, 15, 15] },
    { am: 202309, cu: [0.45, 0.10, 80, 200, 15, 15] }
  ]

}
