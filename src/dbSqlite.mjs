/* En ES6, le buil par webpack est incoorect et produit une erreur en exécution:
TypeError: Cannot read properties of undefined (reading 'indexOf')
*/
// import Database from 'better-sqlite3'

import { createRequire } from 'module'
const require = createRequire(import.meta.url)
export const Database = require('better-sqlite3')

import path from 'path'
import { existsSync } from 'node:fs'
import { decode } from '@msgpack/msgpack'
import { config } from './config.mjs'
import { app_keys } from './keys.mjs'
import { GenDoc, compile, prepRow, decryptRow } from './gendoc.mjs'

export class SqliteProvider {
  constructor (site, code) {
    this.type = 'sqlite'
    this.code = code
    this.appKey = Buffer.from(app_keys.sites[site], 'base64')
    this.path = path.resolve(config[code].path)
    if (!existsSync(this.path)) {
      config.logger.info('Path DB inaccessible= [' + this.path + ']')
      this.ko = true
    } else {
      config.logger.info('Path DB= [' + this.path + ']')
    }
    this.pragma = 'journal_mode = WAL'
  }

  async connect(op) {
    return await new Connx().connect(op, this)
  }
}

class Connx {

  // Méthode PUBLIQUE de coonexion: retourne l'objet de connexion à la base
  async connect (op, dbp) {
    this.op = op
    this.provider = dbp
    this.lastSql = []
    this.cachestmt = { }
    this.appKey = dbp.appKey
    this.options = {
      verbose: (msg) => {
        if (config.mondebug) config.logger.debug(msg)
        this.lastSql.unshift(msg)
        if (this.lastSql.length > 3) this.lastSql.length = 3
      } 
    }
    this.sql = new Database(dbp.path, this.options);
    this.sql.pragma(dbp.pragma)
    return this
  }

  // Méthode PUBLIQUE de déconnexion, impérative et sans exception
  disconnect () {
    try { this.close() } catch (e2) { /* */ }
  }

  /* Méthode PUBLIQUE d'exécution de la transaction:
  - se placer en mode transaction
  - invoquer la méthode transac() de l'opération
  - mise à jour finale eff"ective de la transaction: (écritures groupées à la fin)
  - commit et déconnexion
  - retour [0, '']
  Erreurs trappées
  - pas une exception de DB: trow de l'exception
  - si c'est une erreur de LOCK: retourne [1, 'msg de détail] - Le retry fonctionnera
  - sinon (autre erreur de DB, retry inutile): retourne [2, 'msg de détail]
  */
  async doTransaction () {
    try {
      this._stmt('begin', 'BEGIN').run()
      await this.op.transac()
      if (this.op.toInsert.length) await this.insertRows(this.op.toInsert)
      if (this.op.toUpdate.length) await this.updateRows(this.op.toUpdate)
      if (this.op.toDelete.length) await this.deleteRows(this.op.toDelete)
      this._stmt('commit', 'COMMIT').run()
      this.disconnect()
      return [0, '']
    } catch (e) {
      try { this._stmt('rollback', 'ROLLBACK').run() } catch (e2) { /* */ }
      this.disconnect()
      return this.trap(e)
    }
  }

  // PRIVATE
  trap (e) {
    if (e.constructor.name !== 'SqliteError') throw e
    const s = (e.code || '???') + '\n' + this.lastSql.join('\n')
    if (e.code && e.code.startsWith('SQLITE_BUSY')) return [1, s]
    return [2, s]
  }

  // Méthode PUBLIQUE de test: retour comme doTransaction [0 / 1 / 2, detail]
  async ping () {
    try {
      const sts = this._stmt('PINGS', 'SELECT _data_ FROM singletons WHERE id = \'1\'')
      const t = sts.get()
      const d = new Date()
      const v = d.getTime()
      const _data_ = d.toISOString()
      if (t) {
        const stu = this._stmt('PINGU', 'UPDATE singletons SET _data_ = @_data_, v = @v  WHERE id = \'1\'')
        stu.run({ v, _data_ })
      } else {
        const sti = this._stmt('PINGI', 'INSERT INTO singletons (id, v, _data_) VALUES (\'1\', @v, @_data_)')
        sti.run({ v, _data_ })
      }
      return [0, 'Sqlite ping OK: ' + (t && t._data_ ? t._data_ : '?') + ' <=> ' + _data_]
    } catch (e) {
      return this.trap(e)
    }
  }

  /** PRIVATE : retourne le prepare SQL du statement et le garde en cache avec un code 
  L'argument SQL n'est pas requis si on est certain que le code donné a bien été enregistré
  */
  _stmt (code, sql) {
    let s = this.cachestmt[code]
    if (!s) {
      if (!sql) return null
      s = this.sql.prepare(sql)
      this.cachestmt[code] = s
    }
    return s
  }

  /* PRIVATE : retourne un insert statement SQL 
   Syntaxe : INSERT INTO matable (c1, c2) VALUES (@c1, @c2)
  */
  _insStmt (nom) {
    const x = ['INSERT INTO ' + nom + ' (']
    const la = GenDoc._attrs[nom]
    x.push(la.join(', '))
    x.push(') VALUES (')
    const vals = []
    for(const c of la) vals.push('@' + c)
    x.push(vals.join(', '))
    x.push(')')
    return x.join('')
  }

  /* PRIVATE : retourne un update statement SQL 
   Syntaxe : UPDATE matable SET c1 = @c1, c2 = @c2 WHERE id = @id
  */
  _updStmt (nom) {
    const vals = []
    const x = ['UPDATE ' + nom + ' SET ']
    const la = GenDoc._attrs[nom]
    for(const c of la) if (c !== 'id' && c!== 'ids') vals.push(c + ' = @' + c)
    x.push(vals.join(', '))
    x.push(' WHERE id = @id ')
    if (la.indexOf('ids') !== -1) x.push(' AND ids = @ids')
    return x.join('')
  }

  /* PRIVATE : retourne un delete statement SQL 
   Syntaxe : DELETE FROM matable WHERE id = @id
  */
  _delStmt (nom) {
    const x = ['DELETE FROM ' + nom + ' WHERE id = @id ']
    const la = GenDoc._attrs[nom]
    if (la.indexOf('ids') !== -1) x.push(' AND ids = @ids')
    return x.join('')
  }

  /** PRIVATE Ecritures groupées ******************************************/
  deleteRows (rows) {
    for (const row of rows) {
      const code = 'DEL' + row._nom
      const st = this._stmt(code, this._delStmt(row._nom))
      st.run(row) // row contient id et ids
    }
  }

  async insertRows (rows) {
    for (const row of rows) {
      const r = await prepRow(this.appKey, row)
      const code = 'INS' + row._nom
      const st = this._stmt(code, this._insStmt(row._nom))
      st.run(r)
    }
  }

  async updateRows (rows) {
    for (const row of rows) {
      const code = 'UPD' + row._nom
      const st = this._stmt(code, this._updStmt(row._nom))
      const r = await prepRow(this.appKey, row)
      st.run(r)
    }
  }
  
  /** Méthodes PUBLIQUES FONCTIONNELLES ****************************************/
  async setTache (t) {
    const st = this._stmt('SETTACHE',
      'INSERT INTO taches (op, ns, id, ids, dh, exc) VALUES (@op, @ns, @id, @ids, @dh, @exc) ON CONFLICT (op, id, ids) DO UPDATE SET ns = excluded.ns, dh = excluded.dh, exc = excluded.exc')
    st.run({ 
      op: t.op,
      ns: t.ns, 
      id: t.id || '', 
      ids: t.ids || '',
      dh: t.dh, 
      exc: t.exc })
  }

  async delTache (top, ns, id, ids) {
    const st = this._stmt('DELTACHE', 'DELETE FROM taches WHERE op = @op AND ns = @ns AND id = @id AND ids = @ids')
    st.run({ op: top, ns, id, ids })
  }

  async prochTache (dh, lst) {
    const lst2 = new Array(lst.length + 1)
    lst2[0] = ''
    lst.forEach((x, n) => { lst2[n + 1] = '\'' + x + '\''})
    const lns = lst.join(',')
    const st = this._stmt('PROCHTACHE' + lns, 
      'SELECT * FROM taches WHERE dh < @dh AND ns IN (' + lns + ') ORDER BY dh ASC LIMIT 1')
    const rows = st.all({ dh })
    return !rows.length ? null : rows[0]
  }

  async nsTaches (ns) {
    const st = this._stmt('NSTACHES', 'SELECT * FROM taches WHERE ns = @ns')
    return st.all({ ns })
  }

  async getRowEspaces(v) {
    const code = 'SELESP'
    const st = this._stmt(code, 'SELECT * FROM espaces WHERE v > @v')
    const rows = st.all({ v })
    const r = []
    for (const row of rows) {
      const x = await decryptRow(this.appKey, row)
      x._nom = 'espaces'
      r.push(row)
    }
    return r
  }

  /* Retourne le row d'une collection de nom / id si sa version est postérieure à v
  */
  async getV(nom, id, v) {
    const code = 'SELV' + nom
    const st = this._stmt(code, 'SELECT * FROM ' + nom + '  WHERE id = @id AND v > @v')
    const row = st.get({ id : id, v: v })
    if (row) {
      row._nom = nom
      this.op.nl++
      return await decryptRow(this.appKey, row)
    }
    return null
  }
  
  /* Retourne le row d'une collection de nom / id (sans version))
  */
  async getNV(nom, id) {
    const code = 'SELNV' + nom
    const st = this._stmt(code, 'SELECT * FROM ' + nom + '  WHERE id = @id')
    const row = st.get({ id : id})
    if (row) {
      row._nom = nom
      this.op.nl++
      return await decryptRow(this.appKey, row)
    }
    return null
  }
    
  /* Retourne le row d'un objet d'une sous-collection nom / id / ids */
  async get(nom, id, ids) {
    const code = 'SEL' + nom
    const st = this._stmt(code, 'SELECT * FROM ' + nom + '  WHERE id = @id AND ids = @ids')
    const row = st.get({ id : id, ids: ids })
    if (row) {
      row._nom = nom
      this.op.nl++
      return await decryptRow(this.appKey, row)
    }
    return null
  }

  /* Retourne l'avatar si sa CV est PLUS récente que celle détenue en session (de version vcv)
  */
  async getAvatarVCV(id, vcv) {
    const st = this._stmt('SELCV', 'SELECT * FROM avatars WHERE id = @id AND vcv > @vcv')
    const row = st.get({ id : id, vcv: vcv })
    if (row) {
      row._nom = 'avatars'
      this.op.nl++
      const b = await decryptRow(this.appKey, row)
      const a = compile(b)
      return a
    }
    return null
  }

  /* Retourne LE row ticket si sa version est plus récente que celle détenue en session (de version v)
  async getRowTicketV(op, id, ids, v) {
    const st = this._stmt('SELTKV', 'SELECT * FROM tickets WHERE id = @id AND ids = @ids AND v > @v')
    const row = st.get({ id : id, ids: ids, v: v })
    if (row) {
      row._nom = 'tickets'
      op.nl++
      return await decryptRow(op, row)
    }
    return null
  }
  */
  async getCompteHk(hk) {
    const st = this._stmt('SELHPS1', 'SELECT * FROM comptes WHERE hk = @hk')
    const row = st.get({ hk })
    if (row) {
      row._nom = 'comptes'
      this.op.nl++
      return await decryptRow(this.appKey, row)
    }
    return null
  }
  
  async getAvatarHk(hk) {
    const st = this._stmt('SELHPC', 'SELECT * FROM avatars WHERE hk = @hk')
    const row = st.get({ hk })
    if (row) {
      row._nom = 'avatars'
      this.op.nl++
      return await decryptRow(this.appKey, row)
    }
    return null
  }
  
  async getSponsoringIds(ids) {
    const st = this._stmt('SELSPIDS', 'SELECT * FROM sponsorings WHERE ids = @ids')
    const row = st.get({ ids })
    if (row) {
      row._nom = 'sponsorings'
      this.op.nl++
      return await decryptRow(this.appKey, row)
    }
    return null
  }
  
  /* Retourne l'array des ids des "groupes" dont la fin d'hébergement 
  est inférieure à dfh */
  async getGroupesDfh(dfh) {
    const st = this._stmt('SELGDFH', 'SELECT id FROM groupes WHERE dfh > 0 AND dfh < @dfh')
    const rows = st.all({ dfh })
    const r = []
    if (rows) rows.forEach(row => { r.push(row.id)})
    return r
  }
  
  /* Retourne l'array des id des comptes ayant passé leur dlv */
  async getComptesDlv(dlvmax) {
    const st = this._stmt('SELCDLV', 'SELECT id FROM comptes WHERE dlv < @dlvmax')
    const rows = st.all({ dlvmax })
    const r = []
    if (rows) rows.forEach(row => { r.push(row.id)})
    return r
  }

  /* Retourne l'array des id des comptes du ns donné dont la dlv est:
  - bridée par la dlvat actuelle
  - ou supérieure à la dlvat future
  Plus complexe en FIrestore ?
  */
  async getComptesDlvat(ns, dla, dlf) {
    const ns1 = ns
    const ns2 = ns + '{'
    const st = this._stmt('SELCDLVAT', 'SELECT id FROM comptes WHERE id >= @ns1 AND id < @ns2 AND (dlv > @dlf OR dlv = @dla)')
    const rows = st.all({ dla, dlf, ns1, ns2 })
    const r = []
    if (rows) rows.forEach(row => { r.push(row.id)})
    return r
  }

  /* Retourne la collection de nom 'nom' : pour avoir tous les espaces */
  async coll (nom) {
    const code = 'COLV' + nom
    const st = this._stmt(code, 'SELECT * FROM ' + nom)
    const rows = st.all({ })
    if (!rows) return []
    const r = []
    for (const row of rows) {
      row._nom = nom
      r.push(await decryptRow(this.appKey, row))
    }
    this.op.nl += r.length
    return r
  }
  
  /* Retourne la collection de nom 'nom' 
  SI la fonction "fnprocess" est présente 
  elle est invoquée à chaque row pour traiter son _data_
  plutôt que d'accumuler les rows.
  */
  async collNs (nom, ns, fnprocess) {
    const ns1 = ns
    const ns2 = ns + '{'
    const code = 'COLNS' + nom
    const st = this._stmt(code, 'SELECT * FROM ' + nom + ' WHERE id >= @ns1 AND id < @ns2')
    const rows = st.all({ ns1, ns2 })
    if (!rows) return []
    const r = []
    for (const row of rows) {
      row._nom = nom
      const rx = await decryptRow(this.appKey, row)
      this.op.nl++
      if (!fnprocess) r.push(rx); else fnprocess(rx._data_)
    }
    return !fnprocess ? r : null
  }
    
  /* Retourne la sous-collection de 'nom' du document majeur id
  Si v est donnée, uniquement les documents de version supérieurs à v.
  */
  async scoll (nom, id, v) {
    const code = (v ? 'SCOLV' : 'SCOLB') + nom
    const st = this._stmt(code, 'SELECT * FROM ' + nom + ' WHERE id = @id' + (v ? ' AND v > @v' : ''))
    const rows = st.all({ id: id, v: v })
    if (!rows) return []
    const r = []
    for (const row of rows) {
      row._nom = nom
      r.push(await decryptRow(this.appKey, row))
    }
    this.op.nl += r.length
    return r
  }
  
  /* Retourne les tickets du comptable id et du mois aamm ou antérieurs
  */
  async selTickets (id, ns, aamm, fnprocess) {
    const mx = ns + (aamm % 10000) + '9999999999'
    const st = this._stmt('SELTKTS', 'SELECT * FROM tickets WHERE id = @id AND ids <= @mx')
    const rows = st.all({ id, mx })
    if (!rows) return []
    const r = []
    for (const row of rows) {
      row._nom = 'tickets'
      const rx = await decryptRow(this.appKey, row)
      this.op.nl++
      if (!fnprocess) r.push(rx); else fnprocess(rx._data_)
    }
    return !fnprocess ? r : null
  }

  async delScoll (nom, id) {
    const code = 'DELSCOL'+ nom
    const st = this._stmt(code, 'DELETE FROM ' + nom + ' WHERE id = @id')
    const info = st.run({id : id})
    this.op.ne += info.changes
    return info.changes
  }

  async delTickets (id, ns, aamm) {
    const mx = ns + (aamm % 10000) + '9999999999'
    const code = 'DELTKT'
    const st = this._stmt(code, 'DELETE FROM tickets WHERE id = @id AND ids <= @mx')
    const info = st.run({id, mx})
    this.op.ne += info.changes
    return info.changes
  }

  async setFpurge (id, _data_) {
    const st = this._stmt('INSFPURGE', 'INSERT INTO fpurges (id, _data_) VALUES (@id, @_data_)')
    st.run({ id, _data_ })
    this.op.ne++
  }

  async unsetFpurge (id) {
    const st = this._stmt('DELFPURGE', 'DELETE FROM fpurges WHERE id = @id')
    st.run({ id })
    this.op.ne++
  }

  /* Retourne une liste d'objets  { id, idag, lidf } PAS de rows */
  async listeFpurges (op) {
    const r = []
    const st = this._stmt('SELFPURGES', 'SELECT _data_ FROM fpurges')
    const rows = st.all({ })
    if (rows) rows.forEach(row => {
      r.push(decode(row._data_))
    })
    op.nl += r.length
    return r
  }

  /* Retourne une liste de couples [id, ids] PAS de rows */
  async listeTransfertsDlv (dlv) {
    const r = []
    const st = this._stmt('SELTRADLV', 'SELECT * FROM transferts WHERE dlv <= @dlv')
    const rows = st.all({ dlv })
    if (rows) rows.forEach(row => {
      r.push([row.id, row.idf])
    })
    this.op.nl += r.length
    return r
  }

  async purgeTransferts (id, idf) {
    const st = this._stmt('DELTRA', 'DELETE FROM transferts WHERE id = @id AND idf = @idf')
    st.run({ id, idf })
    this.op.ne++
  }

  async purgeVER (suppr) {
    const st = this._stmt('DELVER', 'DELETE FROM versions WHERE dlv > 0 AND dlv < @suppr')
    const info = st.run({ suppr })
    const n = info.changes
    this.op.ne += n
    return n
  }

  async purgeSPO (dlv) { // nom: sponsorings
    const st = this._stmt('DELSPO', 'DELETE FROM sponsorings WHERE dlv < @dlv')
    const info = st.run({ dlv })
    const n = info.changes
    this.op.ne += n
    return n
  }

  async deleteNS(log, log2, ns) {
    const min = ns
    const max = ns + '{'
    const dels = {}
    GenDoc.collsExp1.forEach(nom => {
      dels[nom] = this.sql.prepare(
        `DELETE FROM ${nom} WHERE id = ${ns};`)
    })
    GenDoc.collsExp2.forEach(nom => {
      dels[nom] = this.sql.prepare(
        `DELETE FROM ${nom} WHERE id >= ${min} AND id < ${max};`)
    })
    GenDoc.sousColls.forEach(nom => {
      dels[nom] = this.sql.prepare(
        `DELETE FROM ${nom} WHERE id >= ${min} AND id < ${max};`)
    })

    for (const nom in GenDoc._attrs) {
      const st = dels[nom]
      const info = st.run({})
      log(`delete ${nom} - ${info.changes} rows`)
    }
  }
}