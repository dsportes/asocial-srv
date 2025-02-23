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
import { GenConnx, GenDoc } from './gendoc.mjs'

export class SqliteProvider {
  constructor (code, site) {
    const app_keys = config.app_keys
    this.type = 'sqlite'
    this.code = code
    this.site = app_keys.sites[site]
    this.appKey = Buffer.from(this.site.k, 'base64')
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

class Connx extends GenConnx {

  // Méthode PUBLIQUE de coonexion: retourne l'objet de connexion à la base
  async connect (op, provider) {
    super.connect(op, provider)

    this.lastSql = []
    this.cachestmt = { }
    this.options = {
      verbose: (msg) => {
        if (config.debugsql) config.logger.debug(msg)
        this.lastSql.unshift(msg)
        if (this.lastSql.length > 3) this.lastSql.length = 3
      } 
    }
    this.sql = new Database(provider.path, this.options);
    this.sql.pragma(provider.pragma)
    this.op.db = this
    return this
  }

  // Méthode PUBLIQUE de déconnexion, impérative et sans exception
  async disconnect () {
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
      return [0, '']
    } catch (e) {
      try { this._stmt('rollback', 'ROLLBACK').run() } catch (e2) { /* */ }
      return this.trap(e)
    }
  }

  // PRIVATE
  trap (e) {
    if (e.constructor.name !== 'SqliteError') throw e
    const s = (e.code || '???') + '\n' + (e.message || '') + '\n' + 
      (e.stack ? e.stack + '\n' : '') + this.lastSql.join('\n')
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

  /** PUBLIQUES POUR EXPORT / PURGE ******************************************/
  async deleteOrg(log) {
    const min = this.cOrg + '@'
    const max = this.cOrg + '@{'
    const dels = {}
    GenDoc.collsExp1.forEach(nom => {
      dels[nom] = this.sql.prepare(
        `DELETE FROM ${nom} WHERE id = '${this.cOrg}';`)
    })
    GenDoc.collsExp2.forEach(nom => {
      dels[nom] = this.sql.prepare(
        `DELETE FROM ${nom} WHERE id >= '${min}' AND id < '${max}';`)
    })
    GenDoc.sousColls.forEach(nom => {
      dels[nom] = this.sql.prepare(
        `DELETE FROM ${nom} WHERE id >= '${min}' AND id < '${max}';`)
    })

    for (const nom in GenDoc._attrs) {
      const st = dels[nom]
      if (st) {
        const info = st.run({})
        log(`delete ${nom} - ${info.changes} rows`)
      }
    }
  }

  async batchInsertRows (rows) {
    await this.insertRows(rows)
  }

  /** Méthodes PUBLIQUES FONCTIONNELLES ****************************************/
  async setTache (t) {
    const st = this._stmt('SETTACHE',
      'INSERT INTO taches (op, org, id, dh, exc, dhf, nb) VALUES (@op, @org, @id, @dh, @exc, 0, 0) ON CONFLICT (op, org, id) DO UPDATE SET dh = excluded.dh, exc = excluded.exc')
    st.run({ 
      op: t.op,
      org: this.cryptedOrg(t.org),
      id: this.cryptedId(t.id),
      dh: t.dh, 
      exc: t.exc
    })
  }

  async delTache (op, org, id) {
    const arg = { op, org: this.cryptedOrg(org), id: this.cryptedId(id) }
    const st = this._stmt('DELTACHE2', 'DELETE FROM taches WHERE op = @op AND org = @org AND id = @id')
    st.run(arg)
  }

  async recTache (op, org, id, dhf, nb) {
    const arg = { op, org: this.cryptedOrg(org), id: this.cryptedId(id), dhf, nb }
    const st = this._stmt('UPDTACHE', 'UPDATE taches SET dhf = @dhf, nb = @nb WHERE op = @op AND org = @org AND id = @id')
    st.run(arg)
  }

  async prochTache (dh) {
    const st = this._stmt('PROCHTACHE', 'SELECT * FROM taches WHERE dh < @dh ORDER BY dh DESC LIMIT 1')
    const rows = st.all({ dh })
    if (!rows.length) return null
    const r = rows[0]
    if (r.org) r.org = this.decryptedOrg(r.org)
    if (r.id) r.id = this.decryptedId(r.id)
    return r
  }

  async orgTaches (org) {
    const arg = { org: this.cryptedOrg(org) }
    const st = this._stmt('ORGTACHES', 'SELECT * FROM taches WHERE org = @org')
    return st.all(arg)
  }

  async toutesTaches () {
    const st = this._stmt('TOUTESTACHES', 'SELECT * FROM taches')
    return st.all()
  }

  async getRowEspaces () {
    const code = 'SELESP'
    const st = this._stmt(code, 'SELECT * FROM espaces')
    const rows = st.all()
    const r = []
    for (const row of rows) {
      row._nom = 'espaces'
      this.op.nl++
      const x = this.decryptRow(row)
      x._org = this.decryptedOrg(row.id)
      r.push(x)
    }
    return r
  }

  async getRowEspacesCalc (dpt) {
    const code = 'SELESPCALC'
    const st = this._stmt(code, 'SELECT * FROM espaces where dpt <= @dpt')
    const rows = st.all({ dpt })
    const r = []
    for (const row of rows) {
      row._nom = 'espaces'
      this.op.nl++
      const x = this.decryptRow(row)
      x._org = this.decryptedOrg(row.id)
      r.push(x)
    }
    return r
  }

  /* Retourne le row d'une collection de nom / / org / id si sa version est postérieure à v
  */
  async getV (nom, id, v) {
    const idLong = this.idLong(id)
    const code = 'SELV' + nom
    const st = this._stmt(code, 'SELECT * FROM ' + nom + '  WHERE id = @id AND v > @v')
    const row = st.get({ id : idLong, v: v })
    if (row) {
      row._nom = nom
      this.op.nl++
      return this.decryptRow(row)
    }
    return null
  }
  
  /* Retourne le row d'une collection de nom / id (sans version))
  */
  async getNV (nom, id, exportDb) {
    const idLong = this.idLong(id)
    const code = 'SELNV' + nom
    const st = this._stmt(code, 'SELECT * FROM ' + nom + '  WHERE id = @id')
    const row = st.get({ id : idLong})
    if (row) {
      row._nom = nom
      this.op.nl++
      return exportDb ? row : this.decryptRow(row)
    }
    return null
  }
    
  /* Retourne le row d'un objet d'une sous-collection nom / id / ids */
  async get (nom, id, ids) {
    const code = 'SEL' + nom
    const st = this._stmt(code, 'SELECT * FROM ' + nom + '  WHERE id = @id AND ids = @ids')
    const row = st.get({ id : this.idLong(id), ids: this.cryptedId(ids) })
    if (row) {
      row._nom = nom
      this.op.nl++
      return this.decryptRow(row)
    }
    return null
  }

  /* Retourne l'avatar si sa CV est PLUS récente que celle détenue en session (de version vcv)
  */
  async getAvatarVCV (id, vcv) {
    const st = this._stmt('SELCV', 'SELECT * FROM avatars WHERE id = @id AND vcv > @vcv')
    const row = st.get({ id : this.idLong(id), vcv: vcv })
    if (row) {
      row._nom = 'avatars'
      this.op.nl++
      return this.decryptRow(row)
    }
    return null
  }

  async getCompteHk (hk) {
    const st = this._stmt('SELHPS1', 'SELECT * FROM comptes WHERE hk = @hk')
    const row = st.get({ hk: this.idLong(hk) })
    if (row) {
      row._nom = 'comptes'
      this.op.nl++
      return this.decryptRow(row)
    }
    return null
  }
  
  async getAvatarHk (hk) {
    const st = this._stmt('SELHPC', 'SELECT * FROM avatars WHERE hk = @hk')
    const row = st.get({ hk: this.idLong(hk) })
    if (row) {
      row._nom = 'avatars'
      this.op.nl++
      return this.decryptRow(row)
    }
    return null
  }
  
  async getSponsoringIds (ids) {
    const st = this._stmt('SELSPIDS', 'SELECT * FROM sponsorings WHERE ids = @ids')
    const row = st.get({ ids: this.cryptedId(ids) })
    if (row) {
      row._nom = 'sponsorings'
      this.op.nl++
      return this.decryptRow(row)
    }
    return null
  }
  
  /* Retourne l'array des [org, id] des "groupes" dont la fin d'hébergement est inférieure à dfh */
  async getGroupesDfh (dfh) {
    const st = this._stmt('SELGDFH', 'SELECT id FROM groupes WHERE dfh > 0 AND dfh < @dfh')
    const rows = st.all({ dfh })
    const r = []
    if (rows) rows.forEach(row => {
      r.push(this.orgId(row.id))
    })
    return r
  }
  
  /* Retourne l'array des [org, id] des comptes ayant passé leur dlv */
  async getComptasDlv (dlvmax) {
    const st = this._stmt('SELCDLV', 'SELECT id FROM comptas WHERE dlv < @dlvmax')
    const rows = st.all({ dlvmax })
    const r = []
    if (rows) rows.forEach(row => { 
      r.push(this.orgId(row.id))
    })
    return r
  }

  /* Retourne la collection de nom 'nom' : pour avoir tous les espaces */
  async coll (nom) {
    const code = 'COLV' + nom
    const st = this._stmt(code, 'SELECT * FROM ' + nom)
    const rows = st.all()
    if (!rows) return []
    const r = []
    for (const row of rows) {
      row._nom = nom
      this.op.nl++
      r.push(this.decryptRow(row))
    }
    return r
  }
  
  /* Retourne la collection de nom 'nom' d'une org
  SI la fonction "fnprocess" est présente 
  elle est invoquée à chaque row pour traiter son _data_
  plutôt que d'accumuler les rows.
  */
  async collOrg (nom, fnprocess, exportDb) {
    const c = this.cryptedOrg(this.op.org)
    const min = c + '@'
    const max = c + '@{'
    const code = 'COLNS' + nom
    const st = this._stmt(code, 'SELECT * FROM ' + nom + ' WHERE id >= @min AND id < @max')
    const rows = st.all({ min, max })
    if (!rows) return []
    const r = []
    for (const row of rows) {
      row._nom = nom
      if (exportDb) r.push(row)
      else {
        const rx = this.decryptRow(row)
        this.op.nl++
        if (!fnprocess) r.push(rx)
        else fnprocess(rx._data_)
      }
    }
    return !fnprocess ? r : null
  }
    
  /* Retourne la sous-collection de 'nom' du document majeur id
  Si v est donnée, uniquement les documents de version supérieurs à v.
  */
  async scoll (nom, id, v, exportDb) {
    const code = (v ? 'SCOLV' : 'SCOLB') + nom
    const st = this._stmt(code, 'SELECT * FROM ' + nom + ' WHERE id = @id' + (v ? ' AND v > @v' : ''))
    const rows = st.all({ id: this.idLong(id), v: v })
    if (!rows) return []
    const r = []
    for (const row of rows) {
      row._nom = nom
      r.push(exportDb ? row : this.decryptRow(row))
    }
    this.op.nl += r.length
    return r
  }
  
  /* Retourne les tickets du comptable id dont la dlv (dernier jour d'un mois)
  est inférieure ou égale à dlv
  */
  async selTickets (id, dlv, fnprocess) {
    const st = this._stmt('SELTKTS', 'SELECT * FROM tickets WHERE id = @id AND dlv <= @dlv')
    const rows = st.all({ id: this.idLong(id), dlv })
    if (!rows) return []
    const r = []
    for (const row of rows) {
      row._nom = 'tickets'
      const rx = this.decryptRow(row)
      this.op.nl++
      if (!fnprocess) r.push(rx)
      else fnprocess(rx._data_)
    }
    return !fnprocess ? r : null
  }

  async delScoll (nom, id) {
    const code = 'DELSCOL'+ nom
    const st = this._stmt(code, 'DELETE FROM ' + nom + ' WHERE id = @id')
    const info = st.run({id: this.idLong(id)})
    this.op.ne += info.changes
    return info.changes
  }

  async delTickets (id, dlv) {
    const code = 'DELTKT'
    const st = this._stmt(code, 'DELETE FROM tickets WHERE id = @id AND dlv <= @dlv')
    const info = st.run({id: this.idLong(id), dlv})
    this.op.ne += info.changes
    return info.changes
  }

  /* Retourne une liste d'objets  { org, id, idag, lidf } */
  async listeFpurges () {
    const r = []
    const st = this._stmt('SELFPURGES', 'SELECT _data_ FROM fpurges')
    const rows = st.all({ })
    if (rows) rows.forEach(row => {
      row._nom = 'Fpurges'
      const d = GenDoc.compile(this.decryptRow(row))
      d.org = this.orgId(row.id)[0]
      this.op.nl++
      r.push(d)
    })
    return r
  }

  /* Retourne une liste de {org, id, ids} des transferts hors date (à purger) */
  async listeTransfertsDlv (dlv) {
    const r = []
    const st = this._stmt('SELTRADLV', 'SELECT * FROM transferts WHERE dlv <= @dlv')
    const rows = st.all({ dlv })
    if (rows) rows.forEach(row => {
      row._nom = 'Transferts'
      const d = GenDoc.compile(this.decryptRow(row))
      d.org = this.orgId(row.id)[0]
      this.op.nl++
      r.push(d)
    })
    this.op.nl += r.length
    return r
  }

  async purgeFpurge (id) {
    const st = this._stmt('DELFPU', 'DELETE FROM fpurges WHERE id = @id')
    st.run({ id: this.idLong(id) })
    this.op.ne++
  }

  async purgeTransferts (id) {
    const st = this._stmt('DELTRA', 'DELETE FROM transferts WHERE id = @id')
    st.run({ id: this.idLong(id) })
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

  // PRIVATE /////////////////////////////////////////// 
  deleteRows (rows) {
    for (const row of rows) {
      const code = 'DEL' + row._nom
      const st = this._stmt(code, this._delStmt(row._nom))
      const r = this.prepRow(row)
      st.run(r) // row contient id et ids
    }
  }

  async insertRows (rows) {
    for (const row of rows) {
      const r = this.prepRow(row)
      const code = 'INS' + row._nom
      const st = this._stmt(code, this._insStmt(row._nom))
      st.run(r)
    }
  }

  async updateRows (rows) {
    for (const row of rows) {
      const code = 'UPD' + row._nom
      const st = this._stmt(code, this._updStmt(row._nom))
      const r = this.prepRow(row)
      st.run(r)
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

}