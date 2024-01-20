
import { existsSync } from 'node:fs'
import { stdin, stdout } from 'node:process'
import path from 'path'
import Database from 'better-sqlite3'

import { collsExp1, collsExp2, majeurs, collsExpA, collsExpG, sousColls, GenDoc, compile } from './modele.mjs'
import { d14, ID } from './api.mjs'
import { encode, decode } from '@msgpack/msgpack'
import { getStorageProvider, getDBProvider } from './server.js'
import { Firestore } from '@google-cloud/firestore'
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

const ctx = {}

class Gen {
  getfs () {
    this.fs = new Firestore()
  }

  log2 (l) { stdout.write('\r' + l.padEnd(40, ' ')) }

  log (l) { stdout.write(l + '\n') }

  prepareSetDocs () {
    this.setNom1 = new Set(collsExp1)
    this.setNom2 = new Set(collsExp2)
    this.setNom3 = new Set(sousColls)
  }

  queryExp2 (nom) {
    if (!majeurs.has(nom)) {
      return this.fs.collection(nom)
        .where('id', '>=', this.minout)
        .where('id', '<', this.maxout)
    }
    return this.fs.collection(nom)
      .where('id_v', '>=', this.minout + '000000000')
      .where('id_v', '<', this.maxout + '000000000')
  }
}

export class UTest extends Gen{
  constructor () {
    super()
  }

  // eslint-disable-next-line no-unused-vars
  async run (args) {
    this.pin = getStorageProvider(args.in)
    const org = args.org
    const data = Buffer.from('Données de test')
    await this.pin.putFile (org, 1515, 29, data)
    const buf = await this.pin.getFile (org, 1515, 29)
    console.log(buf.length)
    /*
    await this.pin.putFile (org, 1515, 30, data)
    await this.pin.putFile (org, 1789, 29, data)
    await this.pin.putFile (org, 1789, 30, data)
    await this.pin.putFile (org, 1968, 29, data)
    */
    const ids = await this.pin.listFiles(org, 1515)
    console.log(ids.length)
    /*
    const data = Buffer.from('Données de test')
    await this.pin.putFile (org, 1515, 29, data)
    await this.pin.putFile (org, 1789, 29, data)
    await this.pin.putFile (org, 1789, 30, data)
    */
    await this.pin.getUrl(org, 1515, 29)
    /*
    const data2 = await this.pin.getFile (org, 1515, 29)
    console.log(data2.toString())
    */
    // await this.pin.getUrl(org, 1515, 29)
  }
}

/* Test1 ****************************************************************/
export class Test2 extends Gen{
  constructor () {
    super()
  }

  /* Retourne la collection 'nom' : pour la liste des espaces */
  static async collDoc (transaction, nom) {
    const p = GenDoc._collPath(nom)
    const q = ctx.fs.collection(p)
    const qs = await transaction.get(q)
    if (qs.empty) return []
    const rows = []
    for (const qds of qs.docs) { 
      const x = qds.data()
      x._nom = nom
      rows.push(x)
    }
    return rows
  }
  
  static async getDocAvatarVCV (transaction, id, vcv) {
    const min = id + (''+vcv).padStart(9, '0')
    const max = id + '999999999'
    const q = ctx.fs.collection('avatars').where('id_vcv', '>', min).where('id_vcv', '<', max)
    const qs = await transaction.get(q)
    if (qs.empty) return null
    const row = qs.docs[0].data()
    row._nom = 'avatars'
    return compile(row)
  }

  static async getDocV (transaction, nom, id, v) {
    let row = null
    if (majeurs.has(nom)) {
      const min = id + (''+v).padStart(9, '0')
      const max = id + '999999999'
      const q = ctx.fs.collection(nom).where('id_v', '>', min).where('id_v', '<', max)
      let qs
      if (transaction !== 'fake') {
        qs = await transaction.get(q) // qs: QuerySnapshot
      } else {
        qs = await q.get()
      }
      if (!qs.empty) row = qs.docs[0].data()
      if (row) row._nom = nom
      return row
    }
    const dr = ctx.fs.doc(nom + '/' + id)
    let ds
    if (transaction !== 'fake') {
      ds = await transaction.get(dr) // qs: QuerySnapshot
    } else {
      ds = await dr.get()
    }
    if (ds.exists) {
      row = ds.data()
      row._nom = nom
    }
    return row
  }

  async run () {
    this.getfs()
    ctx.fs = this.fs

    const resp = await prompt('Test de FS. (o/N) ?')
    if (resp === 'n' || resp === 'N') {
      console.log('Test avorté !')
      return false
    }
    
    this.ix = 3210266028675707

    const row = await UTest.getDocV('fake', 'avatars', this.ix, 5)
    if (row) console.log(row.v)

    await this.fs.runTransaction(async (transaction) => {
      const row = await UTest.getDocV(transaction, 'avatars', this.ix, 5)
      if (row) console.log(row.v)
      const obj = await UTest.getDocAvatarVCV(transaction, this.ix, 5)
      if (obj) console.log(obj.vcv)
      const rows = await UTest.collDoc(transaction, 'espaces')
      console.log(rows.length)
    })
  }
}

/* Export ****************************************************************/
export class UExport extends Gen{
  constructor () {
    super()
    this.fs = null // firestore
    this.nsin = 0
    this.nsout = 0
    this.min = 0
    this.max = 0
    this.minout = 0
    this.maxout = 0
    this.sqlin = null
    this.sqlout = null
    this.scollIds = []
    this.selects = { }
    this.inserts = { }
    this.deletes = { }
  }

  async run (args, utils) { 
    // ifn: 1-export 2-delete
    const ifn = utils === 'export' ? 1 : (utils === 'delete' ? 2 : 3)
    if (ifn !== 1 && ifn !== 2) {
      this.log(`Syntaxe :
      node src/server.mjs export ...
      node src/server.mjs delete ...
      `)
      return false
    }

    if (ifn === 1) {
      if (!args.in || !args.out || !args.nsin || !args.nsout ) {
        this.log(`Syntaxe :
        node src/server.mjs export --in madbin.db3 --out madbout.db3 --nsin 10 --nsout 24
        node src/server.mjs export --in fs --out madbout.db3 --nsin 10 --nsout 24
        node src/server.mjs export --in madbin.db3 --out fs --nsin 10 --nsout 24
        `)
        return false
      }
      if (args.in === 'fs' && args.out === 'fs') {
        this.log('Export : Firestore peut être IN ou OUT mais PAS les deux')
        return false
      }  
    } else {
      if (!args.in || !args.nsin) {
        this.log(`Syntaxe :
        node src/server.mjs delete --in madbin.db3 --nsin 10
        node src/server.mjs delete --in fs --nsin 10
        `)
        return false
      }
    }

    if (args.in === 'fs' || args.out === 'fs') {
      this.getfs()
      if (ifn === 1) this.log(args.in === 'fs' ? 'EXPORT depuis fs' : 'IMPORT dans fs')
      if (ifn === 2) this.log('DELETE dans fs')
    }

    if (args.in !== 'fs') {
      const psrc = path.resolve(args.in)
      const ok = existsSync(psrc)
      if (ifn === 1) this.log(`EXPORT depuis [${psrc}] ${!ok ? '  !!!non trouvée!!!' : ''}`)
      if (ifn === 2) this.log(`DELETE dans [${psrc}] ${!ok ? '  !!!non trouvée!!!' : ''}`)
      if (!ok) return false
      this.sqlin = new Database(psrc, { fileMustExist: true })
    }

    if (ifn === 1 && args.out !== 'fs') {
      if (args.out === args.in) {
        this.log('La base OUT doit être différente de la base IN')
        return false
      }
      const psrc = path.resolve(args.out)
      const ok = existsSync(psrc)
      this.log(`EXPORT dans [${psrc}] ${!ok ? '!!!non trouvée!!!' : ''}`)
      if (!ok) return false
      this.sqlout = new Database(psrc, { fileMustExist: true })
    }

    if (ifn === 1 && (args.nsin < 10 || args.nsin > 59 || args.nsout < 10 || args.nsout > 59)) {
      this.log('Les numéros d\'espace nsin et nsout doivent être compris entre 10 et 59')
      return false
    }
    if (ifn === 2 && (args.nsin < 10 || args.nsin > 59)) {
      this.log('Le numéro d\'espace nsin doit être compris entre 10 et 59')
      return false
    }

    this.nsin = args.nsin
    this.nsout = args.nsout || 0
    this.min = this.nsin * d14
    this.max = (this.nsin + 1) * d14

    if (ifn === 1) {
      this.minout = this.nsout * d14
      this.maxout = (this.nsout + 1) * d14
      this.log(`Renumérotation des IDs de ${this.nsin} en ${this.nsout}`)

      const resp = await prompt('Continuer export (o/N) ?')
      if (resp === 'n' || resp === 'N') {
        console.log('export avorté !')
        return false
      }
  
      if (this.sqlin) { 
        this.prepareSelects()
      }
      if (this.sqlout) { 
        this.prepareInserts()
        this.prepareDeletes() 
      } else {
        this.prepareSetDocs()
      }
      if (this.sqlout) {
        await this.deletesSQL()
      } else {
        await this.deletesFS()
      }
      if (this.sqlin) {
        await this.exportDeSQL()
      } else {
        await this.exportDeFS()
      }
      this.log('Export OK')
      return true
    }

    if (ifn === 2) {
      const resp = await prompt('Continuer delete (o/N) ?')
      if (resp === 'n' || resp === 'N') {
        console.log('delete avorté !')
        return false
      }

      this.sqlout = this.sqlin
      this.nsout = this.nsin
      this.minout = this.nsin * d14
      this.maxout = (this.nsin + 1) * d14

      this.log(`Delete de l'espace ${this.nsin}`)
      if (this.sqlin) this.prepareDeletes()
      if (this.sqlin) await this.deletesSQL(); else await this.deletesFS()
      this.log('Delete OK')
      return true
    }
  }

  prepareSelects () {
    collsExp1.forEach(nom => {
      this.selects[nom] = this.sqlin.prepare(
        `SELECT * FROM ${nom} WHERE id = ${this.nsin};`
      )
    })
    collsExp2.forEach(nom => {
      this.selects[nom] = this.sqlin.prepare(
        `SELECT * FROM ${nom} WHERE id >= ${this.min} AND id < ${this.max};`
      )
    })
    sousColls.forEach(nom => {
      this.selects[nom] = this.sqlin.prepare(
        `SELECT * FROM ${nom} WHERE id = @id;`
      )
    })
  }

  prepareInserts () {
    for (const nom in GenDoc._attrs) {
      this.inserts[nom] = this.sqlout.prepare(GenDoc._insStmt(nom))
    }
  }

  prepareDeletes () {
    collsExp1.forEach(nom => {
      this.deletes[nom] = this.sqlout.prepare(
        `DELETE FROM ${nom} WHERE id = ${this.nsout};`)
    })
    collsExp2.forEach(nom => {
      this.deletes[nom] = this.sqlout.prepare(
        `DELETE FROM ${nom} WHERE id >= ${this.minout} AND id < ${this.maxout};`)
    })
    sousColls.forEach(nom => {
      this.deletes[nom] = this.sqlout.prepare(
        `DELETE FROM ${nom} WHERE id >= ${this.minout} AND id < ${this.maxout};`)
    })
  }

  changeNS1 (row) {
    if (this.nsin !== this.nsout) {
      if (row._data_) {
        const d = decode(row._data_)
        d.id = this.nsout
        row._data_ = encode(d)
      }
      row.id = this.nsout
    }
    return row
  }

  changeNS2 (row) {
    if (this.nsin !== this.nsout) {
      const id = (row.id % d14) + (this.nsout * d14)
      if (row._data_) {
        const d = decode(row._data_)
        d.id = id
        row._data_ = encode(d)
      }
      row.id = id
    }
    return row
  }

  async deletesSQL() {
    for (const nom in GenDoc._attrs) {
      this.deletes[nom].run({})
      this.log(`delete ${nom}`)
    }
  }

  async deletesFS() {
    let n = 0
    for (const nom of collsExp1) { // ['espaces', 'syntheses']
      const p = GenDoc._path(nom, this.nsout)
      await this.fs.doc(p).delete()
      this.log(`delete ${nom} - ${n} rows`)
    }

    /* Les documents "versions" têtes de leurs sous-collections (notes, chats ...)
    NE DOIVENT PAS être détruits AVANT leurs sous-collections qui sinon
    deviendraient inaccessibles */
    const lpavgr = []
    for (const nom of collsExp2) { // ['fpurges', 'gcvols', 'tribus', 'comptas', 'avatars', 'groupes', 'versions']
      n = 0
      const query = this.queryExp2(nom)
      const qs = await query.get()
      for (const doc of qs.docs) {
        if (nom === 'versions') {
          const id = doc.get('id')
          lpavgr.push(id)
        } else { 
          n++
          await doc.ref.delete() 
        }
      }
      if (nom !== 'versions') this.log(`delete ${nom} - ${n} rows`)
    } 
    
    let na = 0, ng = 0, nra = 0, nrg = 0
    for (const id of lpavgr) {
      const g = ID.estGroupe(id)
      const p = 'versions/' + id
      // ['notes', 'transferts', 'sponsorings', 'chats'] OU ['notes', 'transferts', 'membres']
      const c = g ? collsExpG : collsExpA
      for (const nom of c) { 
        const query = this.fs.collection(p + '/' + nom)
        const qs = await query.get()
        for (const doc of qs.docs) { 
          if (g) nrg++; else nra++
          await doc.ref.delete()
        }
      }
      if (g) ng++; else na++
      await this.fs.doc(p).delete()
      this.log2(`delete ${p}`)
    }
    this.log(`\rdelete ${na} avatars - ${nra} rows`)
    this.log(`delete ${ng} groupes - ${nrg} rows`)
  }

  async setFS (nom, row) {
    let doc
    if (majeurs.has(nom)) {
      const v = ('' + row.v).padStart(9, '0')
      row.id_v = row.id + v
      if (row.vcv !== undefined) {
        const vcv = ('' + row.vcv).padStart(9, '0')
        row.id_vcv = row.id + vcv  
      }
    }
    if (this.setNom1.has(nom) || this.setNom2.has(nom)) {
      doc = this.fs.doc(nom + '/' + row.id)
    } else { // sous-collections de versions
      doc = this.fs.doc('versions/' + row.id + '/' + nom + '/' + row.ids)
    }
    await doc.set(row)
  }

  async exportDeSQL () {
    for (const nom of collsExp1) {
      const row = this.selects[nom].get({})
      this.changeNS1(row)
      if (this.sqlout) {
        this.inserts[nom].run(row)
      } else {
        await this.setFS(nom, row)
      }
      this.log(`export ${nom}`)
    }

    for (const nom of collsExp2) {
      const v = nom === 'versions'
      const rows = this.selects[nom].all({})
      for (const row of rows) {
        if (v) this.scollIds.push(row.id)
        this.changeNS2(row)
        if (this.sqlout) {
          this.inserts[nom].run(row)
        } else {
          await this.setFS(nom, row)
        }
      }
      this.log(`export ${nom} - ${rows.length}`)
    }

    let n = 0
    const stats = {}
    sousColls.forEach(nom => { stats[nom] = 0 })
    for (const id of this.scollIds) {
      n++
      const sc = ID.estGroupe(id) ? collsExpG : collsExpA
      for (const nom of sc) {
        const rows = this.selects[nom].all({ id: id})
        for (const row of rows) {
          stats[nom]++
          this.changeNS2(row)
          if (this.sqlout) {
            this.inserts[nom].run(row)
          } else {
            await this.setFS(nom, row)
          }
        }
      }
      this.log2(`export ${id} ${this.scollIds.length} / ${n}`)
    }
    this.log2(`export ${this.scollIds.length} détails: OK`)
    const lg = []
    sousColls.forEach(nom => { lg.push(nom + ':' + stats[nom]) })
    this.log(`\nexport ${this.scollIds.length} Versions : ${n} ` + lg.join('  '))
  }

  async exportDeFS () { // toujours dans SQL (FS -> FS impossible)
    for (const nom of collsExp1) {
      const doc = await this.fs.doc(nom + '/' + this.nsin).get()
      const row = this.changeNS1(doc.data())
      this.inserts[nom].run(row)
      this.log(`export ${nom}`)
    }

    for (const nom of collsExp2) {
      const v = nom === 'versions'
      const query = this.queryExp2(nom)
      const qs = await query.get()
      let i = 0
      if (!qs.empty) for (const doc of qs.docs) {
        i++
        const row = this.changeNS2(doc.data())
        if (v) this.scollIds.push(row.id)
        this.inserts[nom].run(row)
      }
      this.log(`export ${nom} - ${i}`)
    }

    let n = 0
    const stats = {}
    sousColls.forEach(nom => { stats[nom] = 0 })
    for (const id of this.scollIds) {
      const estG = ID.estGroupe(id)
      n++
      const sc = estG ? collsExpG : collsExpA
      for (const nom of sc) {
        const p = 'versions/' + id + '/' + nom
        const query = this.fs.collection(p)
        const qs = await query.get()
        if (!qs.empty) for (const doc of qs.docs) {
          stats[nom]++
          const row = this.changeNS2(doc.data())
          this.inserts[nom].run(row)
        }
      }
      this.log2(`export ${id} ${this.scollIds.length} / ${n}`)
    }
    this.log2(`export ${this.scollIds.length} détails: OK`)
    const lg = []
    sousColls.forEach(nom => { lg.push(nom + ':' + stats[nom]) })
    this.log(`\nexport ${this.scollIds.length} Versions : ${n} ` + lg.join(' '))
  }

}

/* Storage ****************************************************************/
export class UStorage extends Gen{
  constructor () {
    super()
  }

  syntaxe () {
    this.log(`Syntaxe :
    node src/server.mjs storage (-s) --in fs --out s3 --orgin coltes --orgout doda
    -s : transfert simulé (lecture de in seulement) - si absent REEL
    --in / --out : fs | s3 | gc (in et out doivent être différents)
    `)
    return false
  }

  // eslint-disable-next-line no-unused-vars
  async run (args) {
    const espaces = '                                                                           '
    if (!args.in || !args.out || !args.orgin || !args.orgout ) return this.syntaxe()
    if (args.in === args.out) return this.syntaxe()
    this.pin = getStorageProvider(args.in)
    if (!this.pin) return this.syntaxe()
    this.pout = getStorageProvider(args.out)
    if (!this.pout) return this.syntaxe()
    this.orgin = args.orgin
    this.orgout = args.orgout

    const resp = await prompt(`Transfert ${args.s ? 'simulé' : 'REEL'} des fichers:  ${args.in} / ${args.orgin} ==> ${args.out} / ${args.orgout}. Continuer (o/N) ? `)
    if (resp === 'n' || resp === 'N') {
      console.log('transfert avorté !')
      return false
    }
    
    if (!args.s) await this.pout.delOrg(this.orgout)

    this.ids = await this.pin.listIds(this.orgin)
    if (!this.ids.length) {
      this.log('Terminé : aucun fichier à tranférer')
      return false
    }

    let nbav = 0, nbgr = 0, nbfav = 0, volav = 0, nbfgr = 0, volgr = 0, n = 0
    this.ids.forEach(id => { if (ID.estGroupe(id)) nbgr++; else nbav++ })
    this.log(`Fichiers de ${nbav} avatar(s) et ${nbgr} groupe(s)`)

    for (const id of this.ids) {
      n++
      const estG = ID.estGroupe(id)
      const lstf = await this.pin.listFiles(this.orgin, id)
      if (estG) nbfgr += lstf.length; else nbfav += lstf.length
      for (const idf of lstf) {
        const data = await this.pin.getFile (this.orgin, id, idf)
        if (!data) {
          this.log(`\r\nSTORAGE CORROMPU : fichier perdu [${this.orgin}/${id}/${idf}` + espaces + '\n')
        } else {
          if (estG) volgr += data.length; else volav += data.length
          if (!args.s) await this.pout.putFile(this.orgout, id, idf, data)
          this.log2(`groupe/avatar ${n} / ${this.ids.length} - [${id}] - ${nbfav + nbfgr} fichier(s) - ${volav + volgr} bytes`)
        }
      }
    }
    this.log(`\r${nbav} avatar(s) - ${nbfav} fichier(s) - ${volav} bytes` + espaces)
    this.log(`${nbgr} groupe(s) - ${nbfgr} fichier(s) - ${volgr} bytes`)
    this.log(`Transfert ${args.s ? 'simulé' : 'REEL'} terminé avec succès.`)
  }

}
