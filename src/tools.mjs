/*
Exemple export-db:
node src/tools.mjs export-db --in demo,sqlite_a,A --out demo2,sqlite_b,B
node src/tools.mjs export-db --in demo,sqlite_a,A --out demo,firestore_a,A
node src/tools.mjs export-db --in demo,sqlite_b,A --out demo,firestore_a,A
node src/tools.mjs export-db --in demo,firestore_a,A --out demo,sqlite_b,A

node src/tools.mjs export-db --in doda,firestore_a,A --out doda,sqlite_b,A

Exemple export-st:
node src/tools.mjs export-st --in demo,fs_a,A --out demo,gc_a,A
node src/tools.mjs export-st --in demo,gc_a,A --out demo,fs_b,A

Exemple purge-db
node src/tools.mjs purge-db --in coltes,firebase_b,A
node src/tools.mjs purge-db --in demo,sqlite_b,A

Exemple purge-st
node src/tools.mjs purge-st --in demo2,fs_b
*/
import { exit } from 'process'
import { parseArgs } from 'node:util'
import { stdin, stdout } from 'node:process'
import { createInterface } from 'readline'
import path from 'path'
import { readFileSync, writeFileSync } from 'node:fs'
import { decode } from '@msgpack/msgpack'

import { config, getStorageProvider, getDBProvider } from './config.mjs'
import { AMJ, ID } from './api.mjs'
import { GenDoc, MuterRow } from './gendoc.mjs'
import { genVapidKeys } from './notif.mjs'

const cmdargs = parseArgs({
  allowPositionals: true,
  options: { 
    outil: { type: 'string', short: 'o' },
    in: { type: 'string' },
    out: { type: 'string' },
    simulation: { type: 'boolean', short: 's'}
  }
})

/***************************************************************** */

function prompt (q) {
  return new Promise((resolve) => {
    const opt = { input: stdin, output: stdout }
    const readline = createInterface(opt)
    readline.question(q, rep => {
      readline.close()
      resolve(rep)
    })    
  })
}

class OpSimple {
  constructor (storage, org) {
    this.org = org
    this.nl = 0
    this.ne = 0
    this.auj = AMJ.amjUtc()
    this.result = {}
    this.storage = storage
    this.toInsert = []
    this.toUpdate = []
    this.toDelete = []
    this.result = {}
  }
}

export class Outils {
  async run () {
    try {
      this.log('======================================================')
      this.args = cmdargs
      this.outil = this.args.positionals[0]
      this.simu = this.args.values.simulation
      this.cfg = {}
      switch (this.outil) {
      case 'export-db' : {
        await this.setCfgDb('in')
        await this.setCfgDb('out')
        await this.exportDb()
        break
      }
      case 'export-st' : {
        await this.setCfgSt('in')
        await this.setCfgSt('out')
        await this.exportSt()
        break
      }
      case 'purge-db' : {
        await this.setCfgDb('in')
        await this.purgeDb()
        break
      }
      case 'purge-st' : {
        await this.setCfgSt('in')
        await this.purgeSt()
        break
      }
      case 'vapid' : {
        await this.genVapidKeys()
        break
      }
      case 'data' : {
        await this.decodeData()
        break
      }
      default : {
        throw 'Premier argument attendu: export-db export-st vapid. Trouvé [' + this.outil + ']'
      }
      }
      return [0, this.outil + ' OK']
    } catch (e) {
      if (typeof e === 'string') return [1, e]
      return [1, e.toString() + '\n' + e.stack]
    }
  }

  log2 (l) { stdout.write('\r' + l.padEnd(40, ' ')) }

  log (l) { stdout.write(l + '\n') }

  async setCfggm () {
    let arg = this.args.values['in']
    if (!arg) throw 'Argument --in non trouvé. Path du fichier à transformer en module'
    this.cfg.in = arg
    arg = this.args.values['out']
    if (!arg) throw 'Argument --out non trouvé. Path du module'
    this.cfg.out = arg
  }

  async setCfgDb (io) {
    const app_keys = config.app_keys
    const e = {}
    const arg = this.args.values[io]
    if (!arg) throw 'Argument --' + io + ' non trouvé'
    const x = arg.split(',')
    
    if (x.length !== 3) 
      throw 'Argument --' + io + ' : erreur de syntaxe. Attendu: org1,sqlite_a,A + ( org,provider,site)'
        
    e.org = x[0]
    if (!e.org || e.org.length < 4 || e.org.length > 8)
      throw 'Argument --' + io + ' : Attendu: org,provider,site : org [' + e.org + ']: de 4 à 8 caractères'

    e.site = x[2]
    e.appKey = app_keys.sites[e.site]
    if (!e.appKey)
      throw 'Argument --' + io + ' : Attendu: org,provider,site . site [' + e.site + '] inconnu'

    e.pname = x[1]
    e.dbp = await getDBProvider(e.pname, e.site)
    if (!e.dbp || e.dbp.ko)
      throw 'Argument --' + io + ' : Attendu: org,provider,site : provider [' + e.pname + ']: non trouvé'

    this.cfg[io] = e
  }

  async setCfgSt (io) {
    const app_keys = config.app_keys
    const e = {}
    const arg = this.args.values[io]
    if (!arg) throw 'Argument --' + io + ' non trouvé'
    const x = arg.split(',')
    if (x.length !== 3) 
      throw 'Argument --' + io + ' : erreur de syntaxe. Attendu: doda,fs_a,A'
    e.org = x[0]
    if (!e.org || e.org.length < 4 || e.org.length > 12)
      throw 'Argument --' + io + ' : Attendu: org,provider,site : org [' + e.org + ']: est un code de 4 à 12 caractères'
    e.site = x[2]
    e.appKey = app_keys.sites[e.site]
    if (!e.appKey)
      throw 'Argument --' + io + ' : Attendu: org,provider,site . site [' + e.site + '] inconnu'
    e.pname = x[1]
    e.storage = await getStorageProvider(x[1], e.site, true)
    if (e.storage.ko)
      throw 'Argument --' + io + ' : Attendu: org,provider,site : provider [' + x[1] + ']: non trouvé'
    this.cfg[io] = e
  }

  async exportDb() {
    const cin = this.cfg.in
    const cout = this.cfg.out
    if (cin.dbp.type === 'firestore' && cout.dbp.type === 'firestore' && cin.dbp.code !== cout.dbp.code)
      throw 'Il n\'est pas possible d\'exporter directement d\'un Firestore vers un autre Firestore' 
    if ((cin.org === cout.org) && (cin.dbp.code === cout.dbp.code)) 
      throw 'Il n\'est pas possible d\'exporter une organisation d\'une base dans la même base sans changer son nom' 

    const opin = new OpSimple(null, cin.org)
    await cin.dbp.connect(opin)
    opin.db.setOrg(cin.org)
    const opout = new OpSimple(null, cout.org)
    await cout.dbp.connect(opout)
    opout.db.setOrg(cout.org)
 
    let msg = 'export-db:'
    msg += cin.org === cout.org ? ' org:' + cin.org : ' org:' + cin.org + '=>' + cout.org
    msg += cin.pname === cout.pname ? ' provider:' + cin.pname : ' provider:' + cin.pname + '=>' + cout.pname
    msg += cin.site === cout.site ? ' site:' + cin.site : ' site:' + cin.site + '=>' + cout.site
    const resp = await prompt(msg + '\nValider (o/N) ?')
    if (resp !== 'o' && resp !== 'O') throw 'Exécution interrompue.'

    const muteur = new MuterRow(opin.db, opout.db)

    // Opérations fake qui permettent de passer appKey aux méthodes decryptRow / preoRow
    // const opin = { db: {appKey: cin.prov.appKey }, nl: 0, ne: 0, fake: true}
    // const opout = { db: {appKey: cout.prov.appKey }, nl: 0, ne: 0, fake: true}
    const scollIds = []
    // const ch = new NsOrg(cin, cout)

    for (const nom of GenDoc.collsExp1) {
      const row = await opin.db.getNV(nom, '', true)
      if (!this.simu) await opout.db.batchInsertRows([muteur.mute(row)])
      this.log(`export ${nom}`)
    }

    for (const nom of GenDoc.collsExp2) {
      const v = nom === 'versions'
      const rows = await opin.db.collOrg(nom, null, true)
      const lstRows = []
      for (const row of rows) {
        if (v) {
          const [co, ci] = opin.db.orgId(row.id)
          scollIds.push(ci)
        }
        lstRows.push(muteur.mute(row))
      }
      if (!this.simu) await opout.db.batchInsertRows(lstRows)
      this.log(`export ${nom} - ${rows.length}`)
    }

    let n = 0
    const stats = {}
    GenDoc.sousColls.forEach(nom => { stats[nom] = 0 })
    for (const id of scollIds) {
      n++
      const sc = ID.estGroupe(id) ? GenDoc.collsExpG : GenDoc.collsExpA
      for (const nom of sc) {
        const rows = await opin.db.scoll(nom, id, 0, true)
        const lstRows = []
        for (const row of rows) {
          stats[nom]++
          lstRows.push(muteur.mute(row))
        }
        if (!this.simu) await opout.db.batchInsertRows(lstRows)
      }
      this.log2(`export ${id} ${scollIds.length} / ${n}`)
    }
    this.log2(`export ${scollIds.length} détails: OK`)
    const lg = []
    GenDoc.sousColls.forEach(nom => { lg.push(nom + ':' + stats[nom]) })
    this.log(`\nexport ${scollIds.length} Versions: ${n} ` + lg.join('  '))
  }

  async exportSt() {
    const espaces = '                                                                           '
    const cin = this.cfg.in
    const cout = this.cfg.out
    let msg = 'export-st:'
    msg += cin.org === cout.org ? ' org:' + cin.org : ' org:' + cin.org + '=>' + cout.org
    msg += cin.pname === cout.pname ? ' provider:' + cin.pname : ' provider:' + cin.pname + '=>' + cout.pname
    msg += this.simu ? ' SIMULATION' : ' !!! REEL !!!'
    const resp = await prompt(msg + '\nValider (o/N) ?')
    if (resp !== 'o' && resp !== 'O') throw 'Exécution interrompue.'

    const pin = cin.storage
    const pout = cout.storage
    const ids = await pin.listIds(cin.org)
    if (!ids.length) {
      this.log('Terminé : aucun fichier à exporter')
      return
    }

    let nbav = 0, nbgr = 0, nbfav = 0, volav = 0, nbfgr = 0, volgr = 0, n = 0
    ids.forEach(id => { if (ID.estGroupe(id)) nbgr++; else nbav++ })
    this.log(`Fichiers de ${nbav} avatar(s) et ${nbgr} groupe(s)`)

    for (const id of ids) {
      n++
      const estG = ID.estGroupe(id)
      const lstf = await pin.listFiles(cin.org, id)
      if (estG) nbfgr += lstf.length; else nbfav += lstf.length
      for (const idf of lstf) {
        const data = await pin.getFile (cin.org, id, idf)
        if (!data) {
          this.log(`\r\nSTORAGE CORROMPU : fichier perdu [${cin.org}/${id}/${idf}` + espaces + '\n')
        } else {
          if (estG) volgr += data.length; else volav += data.length
          if (!this.simu) await pout.putFile(cout.org, id, idf, data)
          this.log2(`groupe/avatar ${n} / ${ids.length} - [${id}] - ${nbfav + nbfgr} fichier(s) - ${volav + volgr} bytes`)
        }
      }
    }
    this.log(`\r${nbav} avatar(s) - ${nbfav} fichier(s) - ${volav} bytes` + espaces)
    this.log(`${nbgr} groupe(s) - ${nbfgr} fichier(s) - ${volgr} bytes`)
    this.log(`Export ${this.simu ? 'simulé' : 'REEL'} terminé avec succès.`)
  
  }

  async purgeDb() {
    const cin = this.cfg.in
    const opin = new OpSimple(null, cin.org)
    await cin.dbp.connect(opin)
    opin.db.setOrg(cin.org)
    let msg = 'purge-db:'
    msg += ' org:' + cin.org
    msg += ' provider:' + cin.pname
    const resp = await prompt(msg + '\nValider (o/N) ?')
    if (resp !== 'o' && resp !== 'O') throw 'Exécution interrompue.'

    await opin.db.deleteOrg(this.log)
  }

  async purgeSt() {
    const cin = this.cfg.in
    let msg = 'purge-st:'
    msg += ' org:' + cin.org
    msg += ' provider:' + cin.pname
    msg += this.simu ? ' SIMULATION' : ' !!! REEL !!!'
    const resp = await prompt(msg + '\nValider (o/N) ?')
    if (resp !== 'o' && resp !== 'O') throw 'Exécution interrompue.'

    const p = cin.storage
    if (!this.simu) {
      await p.delOrg(cin.org)
      this.log('\nPurge de ' + cin.org + ' terminée')
    } else {
      this.log('\nPurge de ' + cin.org + ' a priori possible')
    }
  }

  async genVapidKeys () {
    const msg = 'generate vpid keys dans ./vapid.json'
    const resp = await prompt(msg + '\nValider (o/N) ?')
    if (resp !== 'o' && resp !== 'O') throw 'Exécution interrompue.'
    const t = genVapidKeys().replace(',', ',\n').replace('{', '{\n').replace('}', '\n}\n')
    const pout = path.resolve('./vapid.json')
    writeFileSync(pout, t)
    this.log('OK')
    this.log(t) 
  }

  async decodeData () {
    const pin = path.resolve('./tmp/data.bin')
    const b = new Uint8Array(readFileSync(pin))
    const obj = decode(b)
    const t = JSON.stringify(obj)
    const pout = path.resolve('./tmp/data.json')
    writeFileSync(pout, t)
    console.log(t)
  }

}

/*****************************************************/
const [n, msg] = await new Outils().run()
if (!n) {
  config.logger.info(msg)
  exit(0)
} else {
  config.logger.error(msg)
  exit(n)
}

