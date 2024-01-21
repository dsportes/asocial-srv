
import { stdin, stdout } from 'node:process'
import { getStorageProvider, getDBProvider, ctx } from './server.js'
import { AMJ } from './api.mjs'
import { createInterface } from 'readline'

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
      this.args = ctx.cmdargs
      this.outil = this.args.positionals[0]
      this.cfg = {}
      switch (this.outil) {
      case 'export-db' : {
        this.setCfg('in', true)
        this.setCfg('out', true)
        await this.exportDb()
        break
      }
      case 'export-st' : {
        this.setCfg('in', false)
        this.setCfg('out', false)
        await this.exportSt()
        break
      }
      case 'test-db' : {
        this.setCfg('in', false)
        await this.testDb()
        break
      }
      case 'test-st' : {
        this.setCfg('in', false)
        await this.testSt()
        break
      }
      default : {
        throw 'Premier argument attendu: export-db export-st test-db test-st. Trouvé [' + this.outil + ']'
      }
      }
      return [0, '']
    } catch (e) {
      return [1, e]
    }
  }

  log2 (l) { stdout.write('\r' + l.padEnd(40, ' ')) }

  log (l) { stdout.write(l + '\n') }

  setCfg (io, db) {
    const e = {}
    const arg = this.args[io]
    if (!arg) throw 'Argument --' + io + ' non trouvé'
    const x = arg.split(',')
    if (x.length !== db ? 4 : 3) 
      throw 'Argument --' + io + ' : erreur de syntaxe. Attendu: 32,doda,sqlite_a' + (db ? ',A' : '')
    e.ns = parseInt(x[0])
    if (e.ns < 10 || e.ns > 59)
      throw 'Argument --' + io + ' : Attendu: ns,org,provider' + (db ? ',site' : '') + '. ns [' + e.ns + ']: doit être 10 et 60'
    e.org = x[1]
    if (!e.org)
      throw 'Argument --' + io + ' : Attendu: ns,org,provider' + (db ? ',site' : '') + '. org [' + e.org + ']: non trouvé'
    if (db) {
      e.appKey = ctx.site(x[3])
      e.site = x[3]
      if (!e.appKey)
        throw 'Argument --' + io + ' : Attendu: ns,org,provider,site . Pas de key pour le site [' + e.x[3] + ']'
    }
    e.pname = x[2]
    e.prov = db ? getDBProvider(x[2], e.appKey) : getStorageProvider(x[2])
    if (!e.prov)
      throw 'Argument --' + io + ' : Attendu: ns,org,provider' + (db ? ',site' : '') + '. provider [' + e.x[2] + ']: non trouvé'
    this.cfg[io] = e
  }

  async exportDb() {
    const cin = this.cfg.in
    const cout = this.cfg.out
    let msg = 'export-db:'
    msg += cin.ns === cout.ns ? ' ns:' + cin.ns : 'ns:' + cin.ns + '=>' + cout.ns
    msg += cin.org === cout.org ? ' org:' + cin.org : ' org:' + cin.org + '=>' + cout.org
    msg += cin.pname === cout.pname ? ' provider:' + cin.pname : ' provider:' + cin.pname + '=>' + cout.pname
    msg += cin.site === cout.site ? ' site:' + cin.site : ' site:' + cin.site + '=>' + cout.site
    const resp = await prompt(msg + '\nValider (o/N) ?')
    if (resp === 'n' || resp === 'N') throw 'Exécution interrompue.'

  }

  async exportSt() {
    const cin = this.cfg.in
    const cout = this.cfg.out
    let msg = 'export-st:'
    msg += cin.ns === cout.ns ? ' ns:' + cin.ns : 'ns:' + cin.ns + '=>' + cout.ns
    msg += cin.org === cout.org ? ' org:' + cin.org : ' org:' + cin.org + '=>' + cout.org
    msg += cin.pname === cout.pname ? ' provider:' + cin.pname : ' provider:' + cin.pname + '=>' + cout.pname
    const resp = await prompt(msg + '\nValider (o/N) ?')
    if (resp === 'n' || resp === 'N') throw 'Exécution interrompue.'

  }

  async testDb() {
    const cin = this.cfg.in
    let msg = 'test-db:'
    msg += ' ns:' + cin.ns
    msg += ' org:' + cin.org
    msg += ' provider:' + cin.pname
    msg += ' site:' + cin.site
    const resp = await prompt(msg + '\nValider (o/N) ?')
    if (resp === 'n' || resp === 'N') throw 'Exécution interrompue.'

  }

  async testSt() {
    const cin = this.cfg.in
    let msg = 'test-db:'
    msg += ' ns:' + cin.ns
    msg += ' org:' + cin.org
    msg += ' provider:' + cin.pname
    const resp = await prompt(msg + '\nValider (o/N) ?')
    if (resp === 'n' || resp === 'N') throw 'Exécution interrompue.'

  }

} 

