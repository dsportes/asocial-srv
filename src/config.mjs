const gaeFlag = false

export const config = {
  // rooturl: 'https://192.168.5.64:8443',
  rooturl: 'https://test.sportes.fr:8443',

  port: 8443, // port: 443,
  
  origins: [
    /*
    'fake.com',
    'https://localhost:8343',
    'https://192.168.5.64:8343',
    'https://localhost:8343/app',
    'localhost:8343',
    'https://test.sportes.fr:8443',
    'https://test.sportes.fr:8443/app',
    'test.sportes.fr:8443',
    'msi:8443',
    'https://msi:8443',
    'https://msi:8343',
    'https://localhost:8443',
    'https://localhost:8343',
    '192.168.5.64:8443'
    */
  ],

  projectId: 'asocial-test1', // Pour Firestore et storage GC

  admin:  ['tyn9fE7zrDhZ6N7GSA87GbF1ouPovsOP/dVsUNfS0zk='],
  ttlsessionMin: 60,

  apitk: 'VldNo2aLLvXRm0Q',
  prefixop: '/op',
  prefixapp: '/app',
  pathapp: gaeFlag ? '' : './app',
  prefixwww: '/www',
  pathwww: gaeFlag ? '' : './www',
  pathsql: './sqlite/test1.db3',
  pathlogs: './logs',
  // favicon: 'favicon.ico', 

  pathconfig: './config',

  firestore: gaeFlag || false,
  gae: gaeFlag || false,
  emulator: gaeFlag ? false : false,
  firestore_emulator: 'localhost:8080',
  storage_emulator: 'http://127.0.0.1:9199', // 'httpp://' est REQUIS

  storage_provider: gaeFlag ? 'gc' : 'fs',

  s3config: {
    bucket: 'asocial'
  },

  fsconfig: {
    rootpath: './fsstorage'
  },

  gcconfig: {
    bucket: 'asocial-test1.appspot.com' // Pour emulator
    // bucket: 'asocial' // Pour prod, quoi que ...
  }

}
