
import { stdin, stdout } from 'node:process'
import { createInterface } from 'readline'

import { getStorageProvider, getDBProvider, ctx } from './server.js'
import { AMJ, ID } from './api.mjs'
import { compile, GenDoc, NsOrg } from './gendoc.mjs'

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

// eslint-disable-next-line no-unused-vars
class OpSimple {
  constructor (db, storage) {
    this.nl = 0
    this.ne = 0
    this.auj = AMJ.amjUtc()
    this.result = {}
    this.db = db
    this.storage = storage
    this.toInsert = []
    this.toUpdate = []
    this.toDelete = []
    this.result = {}
  }

  /* Fixe LA valeur de la propriété 'prop' du résultat (et la retourne)*/
  setRes(prop, val) {
    this.result[prop] = val
    return val
  }

  /* AJOUTE la valeur en fin de la propriété Array 'prop' du résultat (et la retourne)*/
  addRes(prop, val) {
    const r = this.result
    let l = r[prop]; if (!l) { l = []; r[prop] = l }
    l.push(val)
    return val
  }
  
  /* Inscrit row dans les rows à insérer en phase finale d'écritue, juste après la phase2 */
  insert (row) {
    this.toInsert.push(row)
    return row
  }

  /* Inscrit row dans les rows à mettre à jour en phase finale d'écritue, juste après la phase2 */
  update (row) {
    this.toUpdate.push(row)
    return row
  }

  /* Inscrit row dans les rows à détruire en phase finale d'écritue, juste après la phase2 */
  delete (row) {
    this.toDelete.push(row)
    return row
  }

  // eslint-disable-next-line no-unused-vars
  async phase2 (args) { // A surcharger
  }

  async flush () {
    if (this.toInsert.length) await this.db.insertRows(this, this.toInsert)
    if (this.toUpdate.length) await this.db.updateRows(this, this.toUpdate)
    if (this.toDelete.length) await this.db.deleteRows(this, this.toDelete)
    this.toInsert = []; this.toUpdate = []; this.toDelete = []
  }
}

export class Outils {
  async run () {
    try {
      this.log('======================================================')
      this.args = ctx.cmdargs
      this.outil = this.args.positionals[0]
      this.simu = this.args.values.simulation
      this.cfg = {}
      switch (this.outil) {
      case 'export-db' : {
        this.setCfgDb('in')
        this.setCfgDb('out')
        await this.exportDb()
        break
      }
      case 'export-st' : {
        this.setCfgSt('in')
        this.setCfgSt('out')
        await this.exportSt()
        break
      }
      case 'test-db' : {
        this.setCfgDb('in')
        await this.testDb()
        break
      }
      case 'test-st' : {
        this.setCfgSt('in')
        await this.testSt()
        break
      }
      case 'purge-db' : {
        this.setCfgDb('in')
        await this.purgeDb()
        break
      }
      case 'purge-st' : {
        this.setCfgSt('in')
        await this.purgeSt()
        break
      }
      default : {
        throw 'Premier argument attendu: export-db export-st test-db test-st. Trouvé [' + this.outil + ']'
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

  setCfgDb (io) {
    const e = {}
    const arg = this.args.values[io]
    if (!arg) throw 'Argument --' + io + ' non trouvé'
    const x = arg.split(',')
    
    if (x.length !== 4) 
      throw 'Argument --' + io + ' : erreur de syntaxe. Attendu: 32,asso,sqlite_a,A + ( ns,org,provider,site)'
    
    e.ns = parseInt(x[0])
    if (e.ns < 10 || e.ns > 59)
      throw 'Argument --' + io + ' : Attendu: ns,org,provider,site : ns [' + e.ns + ']: doit être 10 et 60'
    
    e.org = x[1]
    if (!e.org || e.org.length < 4 || e.org.length > 8)
      throw 'Argument --' + io + ' : Attendu: ns,org,provider,site : org [' + e.org + ']: de 4 à 8 caractères'

    e.site = x[3]
    e.appKey = ctx.site(e.site)
    if (!e.appKey)
      throw 'Argument --' + io + ' : Attendu: ns,org,provider,site . site [' + e.site + '] inconnu'

    e.pname = x[2]
    e.prov = getDBProvider(e.pname, e.site)
    if (!e.prov)
      throw 'Argument --' + io + ' : Attendu: ns,org,provider,site : provider [' + e.pname + ']: non trouvé'

    this.cfg[io] = e
  }

  setCfgSt (io) {
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
    e.prov = getStorageProvider(x[1])
    if (!e.prov)
      throw 'Argument --' + io + ' : Attendu: org,provider : provider [' + x[1] + ']: non trouvé'
    this.cfg[io] = e
  }

  async exportDb() {
    const cin = this.cfg.in
    const cout = this.cfg.out
    const pin = cin.prov
    const pout = cout.prov
 
    if (pin.type === 'firestore' && pout.type === 'firestore' && pin.code !== pout.code)
      throw 'Il n\'est pas possible d\'exporter directement d\'un Firestore vers un autre Firestore' 
    if ((cin.ns === cout.ns) && (pin.code === pout.code)) 
      throw 'Il n\'est pas possible d\'exporter un ns d\'une base dans la même base sans changer de ns' 

    let msg = 'export-db:'
    msg += cin.ns === cout.ns ? ' ns:' + cin.ns : ' ns:' + cin.ns + '=>' + cout.ns
    msg += cin.org === cout.org ? ' org:' + cin.org : ' org:' + cin.org + '=>' + cout.org
    msg += cin.pname === cout.pname ? ' provider:' + cin.pname : ' provider:' + cin.pname + '=>' + cout.pname
    msg += cin.site === cout.site ? ' site:' + cin.site : ' site:' + cin.site + '=>' + cout.site
    const resp = await prompt(msg + '\nValider (o/N) ?')
    if (resp !== 'o' && resp !== 'O') throw 'Exécution interrompue.'

    // Opérations fake qui permettent de passer appKey aux méthodes decryptRow / preoRow
    const opin = { db: {appKey: cin.prov.appKey }, nl: 0, ne: 0}
    const opout = { db: {appKey: cout.prov.appKey }, nl: 0, ne: 0}
    const scollIds = []
    const ch = new NsOrg(cin, cout)

    for (const nom of GenDoc.collsExp1) {
      const row = await pin.getNV(opin, nom, cin.ns)
      await pout.insertRows(opout, [ch.chRow(row)])
      this.log(`export ${nom}`)
    }

    for (const nom of GenDoc.collsExp2) {
      const v = nom === 'versions'
      const rows = await pin.collNs(opin, nom, cin.ns)
      for (const row of rows) {
        if (v) scollIds.push(row.id)
        await pout.insertRows(opout, [ch.chRow(row)])
      }
      this.log(`export ${nom} - ${rows.length}`)
    }

    let n = 0
    const stats = {}
    GenDoc.sousColls.forEach(nom => { stats[nom] = 0 })
    for (const id of scollIds) {
      n++
      const sc = ID.estGroupe(id) ? GenDoc.collsExpG : GenDoc.collsExpA
      for (const nom of sc) {
        const rows = await pin.scoll(opin, nom, id, 0)
        for (const row of rows) {
          stats[nom]++
          await pout.insertRows(opout, [ch.chRow(row)])
        }
      }
      this.log2(`export ${id} ${scollIds.length} / ${n}`)
    }
    this.log2(`export ${scollIds.length} détails: OK`)
    const lg = []
    GenDoc.sousColls.forEach(nom => { lg.push(nom + ':' + stats[nom]) })
    this.log(`\nexport ${scollIds.length} Versions : ${n} ` + lg.join('  '))
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

  async testDb() {
    const cin = this.cfg.in
    let msg = 'test-db:'
    msg += ' ns:' + cin.ns
    msg += ' provider:' + cin.pname
    msg += ' site:' + cin.site
    const resp = await prompt(msg + '\nValider (o/N) ?')
    if (resp !== 'o' && resp !== 'O') throw 'Exécution interrompue.'

    const op = new OpTest1(this.cfg.in.prov, null)
    op.args = cin
    await op.phase2(cin)
  }

  async testSt() {
    const cin = this.cfg.in
    let msg = 'test-db:'
    msg += ' org:' + cin.org
    msg += ' provider:' + cin.pname
    const resp = await prompt(msg + '\nValider (o/N) ?')
    if (resp !== 'o' && resp !== 'O') throw 'Exécution interrompue.'
    const p = cin.prov
    await p.ping()
    this.log('\nEcriture de la date-heure dans /ping.txt')
  }

  async purgeDb() {
    const cin = this.cfg.in
    let msg = 'purge-db:'
    msg += ' ns:' + cin.ns
    msg += ' provider:' + cin.pname
    const resp = await prompt(msg + '\nValider (o/N) ?')
    if (resp !== 'o' && resp !== 'O') throw 'Exécution interrompue.'

    const p = cin.prov
    await p.deleteNS(this.log, this.log2, cin.ns)
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

}

class OpTest1 extends OpSimple {
  constructor (provider) {
    super(provider, null)
  }

  async phase2 (args) {
    const row = await this.db.org(this, args.ns)
    const espace = compile(row)
    console.log(espace.org)
  }
}
