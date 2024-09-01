/*
Exemple export-db:
node src/tools.mjs export-db --in 1,doda,sqlite_a,A --out 2,coltes,sqlite_b,B
node src/tools.mjs export-db --in 32,doda,sqlite_a,A --out 32,doda,firestore_a,A
node src/tools.mjs export-db --in 32,doda,firestore_a,A --out 32,doda,sqlite_b,A

Exemple export-st:
node src/tools.mjs export-db --in doda,fs_a --out doda,gc_a

Exemple purge-db
node src/tools.mjs purge-db --in 2,coltes,firebase_b,A
node src/tools.mjs purge-db --in 2,coltes,sqlite_b,B

*/
import { exit } from 'process'
import { parseArgs } from 'node:util'
import { stdin, stdout } from 'node:process'
import { createInterface } from 'readline'

import path from 'path'
import { writeFileSync } from 'node:fs'
// import { existsSync, readFileSync } from 'node:fs'

import { getStorageProvider, getDBProvider } from './util.mjs'
import { config } from './config.mjs'
import { app_keys } from './keys.mjs'
import { AMJ, ID, Cles } from './api.mjs'
import { GenDoc, NsOrg } from './gendoc.mjs'
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
  constructor (storage) {
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
    const e = {}
    const arg = this.args.values[io]
    if (!arg) throw 'Argument --' + io + ' non trouvé'
    const x = arg.split(',')
    
    if (x.length !== 4) 
      throw 'Argument --' + io + ' : erreur de syntaxe. Attendu: N,asso,sqlite_a,A + ( ns,org,provider,site)'
    
    e.ns = x[0]
    if (Cles.nsToInt(e.ns) === -1)
      throw 'Argument --' + io + ' : Attendu: N,org,provider,site : N [' + e.ns + ']: doit être 0..1 OU a..z OU A..Z'
    
    e.org = x[1]
    if (!e.org || e.org.length < 4 || e.org.length > 8)
      throw 'Argument --' + io + ' : Attendu: N,org,provider,site : org [' + e.org + ']: de 4 à 8 caractères'

    e.site = x[3]
    e.appKey = app_keys.sites[e.site]
    if (!e.appKey)
      throw 'Argument --' + io + ' : Attendu: N,org,provider,site . site [' + e.site + '] inconnu'

    e.pname = x[2]
    e.dbp = await getDBProvider(e.pname, e.site)
    if (e.dbp.ko)
      throw 'Argument --' + io + ' : Attendu: N,org,provider,site : provider [' + e.pname + ']: non trouvé'

    this.cfg[io] = e
  }

  async setCfgSt (io) {
    const e = {}
    const arg = this.args.values[io]
    if (!arg) throw 'Argument --' + io + ' non trouvé'
    const x = arg.split(',')
    if (x.length !== 2) 
      throw 'Argument --' + io + ' : erreur de syntaxe. Attendu: doda,fs_a'
    e.org = x[0]
    if (!e.org || e.org.length < 4 || e.org.length > 12)
      throw 'Argument --' + io + ' : Attendu: org,provider : org [' + e.org + ']: est un code de 4 à 12 caractères'
    e.pname = x[1]
    e.storage = await getStorageProvider(x[1])
    if (e.storage.ko)
      throw 'Argument --' + io + ' : Attendu: org,provider : provider [' + x[1] + ']: non trouvé'
    this.cfg[io] = e
  }

  async exportDb() {
    const cin = this.cfg.in
    const cout = this.cfg.out
    if (cin.dbp.type === 'firestore' && cout.dbp.type === 'firestore' && cin.dbp.code !== cout.dbp.code)
      throw 'Il n\'est pas possible d\'exporter directement d\'un Firestore vers un autre Firestore' 
    if ((cin.ns === cout.ns) && (cin.dbp.code === cout.dbp.code)) 
      throw 'Il n\'est pas possible d\'exporter un ns d\'une base dans la même base sans changer de ns' 

    const opin = new OpSimple(null)
    await cin.dbp.connect(opin)
    const opout = new OpSimple(null)
    await cout.dbp.connect(opout)
 
    let msg = 'export-db:'
    msg += cin.ns === cout.ns ? ' ns:' + cin.ns : ' ns:' + cin.ns + '=>' + cout.ns
    msg += cin.org === cout.org ? ' org:' + cin.org : ' org:' + cin.org + '=>' + cout.org
    msg += cin.pname === cout.pname ? ' provider:' + cin.pname : ' provider:' + cin.pname + '=>' + cout.pname
    msg += cin.site === cout.site ? ' site:' + cin.site : ' site:' + cin.site + '=>' + cout.site
    const resp = await prompt(msg + '\nValider (o/N) ?')
    if (resp !== 'o' && resp !== 'O') throw 'Exécution interrompue.'

    // Opérations fake qui permettent de passer appKey aux méthodes decryptRow / preoRow
    // const opin = { db: {appKey: cin.prov.appKey }, nl: 0, ne: 0, fake: true}
    // const opout = { db: {appKey: cout.prov.appKey }, nl: 0, ne: 0, fake: true}
    const scollIds = []
    const ch = new NsOrg(cin, cout)

    for (const nom of GenDoc.collsExp1) {
      const row = await opin.db.getNV(nom, cin.ns)
      if (!this.simu) await opout.db.batchIinsertRows([ch.chRow(row)])
      this.log(`export ${nom}`)
    }

    for (const nom of GenDoc.collsExp2) {
      const v = nom === 'versions'
      const rows = await opin.db.collNs(nom, cin.ns)
      const lstRows = []
      for (const row of rows) {
        if (v) scollIds.push(row.id)
        lstRows.push(ch.chRow(row))
      }
      if (!this.simu) await opout.db.batchInsertRows(lstRows)
      this.log(`export ${nom} - ${rows.length}`)
    }

    let n = 0
    const stats = {}
    GenDoc.sousCollsExp.forEach(nom => { stats[nom] = 0 })
    for (const id of scollIds) {
      n++
      const sc = ID.estGroupe(ID.court(id)) ? GenDoc.collsExpG : GenDoc.collsExpA
      for (const nom of sc) {
        const rows = await opin.db.scoll(nom, id, 0)
        const lstRows = []
        for (const row of rows) {
          stats[nom]++
          lstRows.push(ch.chRow(row))
        }
        if (!this.simu) await opout.db.batchInsertRows(lstRows)
      }
      this.log2(`export ${id} ${scollIds.length} / ${n}`)
    }
    this.log2(`export ${scollIds.length} détails: OK`)
    const lg = []
    GenDoc.sousCollsExp.forEach(nom => { lg.push(nom + ':' + stats[nom]) })
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

    const pin = cin.prov
    const pout = cout.prov
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
    const opin = new OpSimple(null)
    await cin.dbp.connect(opin)
    let msg = 'purge-db:'
    msg += ' ns:' + cin.ns
    msg += ' provider:' + cin.pname
    const resp = await prompt(msg + '\nValider (o/N) ?')
    if (resp !== 'o' && resp !== 'O') throw 'Exécution interrompue.'

    await opin.db.deleteNS(this.log, cin.ns)
  }

  async purgeSt() {
    const cin = this.cfg.in
    let msg = 'purge-db:'
    msg += ' org:' + cin.org
    msg += ' provider:' + cin.pname
    msg += this.simu ? ' SIMULATION' : ' !!! REEL !!!'
    const resp = await prompt(msg + '\nValider (o/N) ?')
    if (resp !== 'o' && resp !== 'O') throw 'Exécution interrompue.'

    const p = cin.prov
    if (!this.simu) {
      await p.delOrg(cin.org)
      this.log('\nPurge de ' + cin.org + ' terminée')
    } else {
      this.log('\nPurge de ' + cin.org + ' a priori possible')
    }
  }

  async genVapidKeys() {
    const msg = 'generate vpid keys dans ./vapid.json'
    const resp = await prompt(msg + '\nValider (o/N) ?')
    if (resp !== 'o' && resp !== 'O') throw 'Exécution interrompue.'
    const t = genVapidKeys().replace(',', ',\n').replace('{', '{\n').replace('}', '\n}\n')
    const pout = path.resolve('./vapid.json')
    writeFileSync(pout, t)
    this.log('OK')
    this.log(t) 
  }

  /*
  async genMjs () {
    const pin = path.resolve(this.cfg.in)
    const pout = path.resolve(this.cfg.out)
    if (existsSync(pin)) {
      const msg = 'Conversion de "'+ pin + '" en "' + pout + '"'
      const resp = await prompt(msg + '\nValider (o/N) ?')
      if (resp !== 'o' && resp !== 'O') throw 'Exécution interrompue.'
      const bin = readFileSync(pin)
      const t = bin.toString('base64')
      const h = 'export default Buffer.from(\'' + t + '\', \'base64\')'
      const bout = Buffer.from(h, 'utf-8')
      writeFileSync(pout, bout)
      this.log('OK')   
    } else {
      this.log('\nKO : fichier non trouvé')
    }
  }
  */

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

