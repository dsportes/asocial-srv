export const mode = 2
/*
1:GAE 
2:Test usuel
3:Test local après build
*/

export const config = {
  rooturl: mode === 1 ? 'asocial-test1.ew.r.appspot.com' : 'https://test.sportes.fr:8443',

  port: 8443, // port: 443,
  
  origins: [ 'localhost:8343' ],

  projectId: 'asocial-test1', // Pour Firestore et storage GC

  prefixop: '/op',
  prefixapp: '/app',
  pathapp: mode === 1 ? '' : './app',
  prefixwww: '/www',
  pathwww: mode === 1 ? '' : './www',
  pathsql: mode === 2 ? './sqlite/test.db3' : '../sqlite/test1.db3',
  pathlogs: mode === 2 ? './logs' : '../logs',
  // favicon: 'favicon.ico', 

  pathconfig: './config',

  firestore: mode === 1 ? true : false,
  gae: mode === 1 ? true : false,
  emulator: false,
  firestore_emulator: 'localhost:8080',
  storage_emulator: 'http://127.0.0.1:9199', // 'http://' est REQUIS

  storage_provider: mode === 1 ? 'gc' : 'fs',

  s3config: {
    bucket: 'asocial'
  },

  fsconfig: {
    rootpath: mode === 2 ? './fsstorage' : '../fsstorage'
  },

  fsbconfig: {
    rootpath: mode === 2 ? './fsstorageb' : '../fsstorageb'
  },

  gcconfig: {
    bucket: 'asocial-test1.appspot.com' // Pour emulator
    // bucket: 'asocial' // Pour prod, quoi que ...
  },

  tarifs: [
    { am: 202201, cu: [0.45, 0.10, 80, 200, 15, 15] },
    { am: 202305, cu: [0.45, 0.10, 80, 200, 15, 15] },
    { am: 202309, cu: [0.45, 0.10, 80, 200, 15, 15] }
  ]

}
