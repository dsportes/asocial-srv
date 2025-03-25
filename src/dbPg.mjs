import pg from 'pg'
const { Pool } = pg

import { config } from './config.mjs'
import { GenConnx, GenDoc } from './gendoc.mjs'

export class PgProvider {
  constructor (code, site) {
    const app_keys = config.app_keys
    this.type = 'pg'
    this.code = code
    this.site = app_keys.sites[site]
    this.appKey = Buffer.from(this.site.k, 'base64')
    
    const cfg = config[code]
    const kn = cfg.key
    this.pool = new Pool(config[kn])
  }

  async connect(op) {
    return await new Connx().connect(op, this)
  }
}

class Connx extends GenConnx {

  // Méthode PUBLIQUE de coonexion: retourne l'objet de connexion à la base
  async connect (op, provider) {
    super.connect(op, provider)
    this.client = await provider.pool.connect()
    this.op.db = this
    return this
  }

  // Méthode PUBLIQUE de déconnexion, impérative et sans exception
  async disconnect () {
    try { this.client.release() } catch (e2) { /* */ }
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
      await this.client.query('BEGIN')
      await this.op.transac()
      if (this.op.toInsert.length) await this.insertRows(this.op.toInsert)
      if (this.op.toUpdate.length) await this.updateRows(this.op.toUpdate)
      if (this.op.toDelete.length) await this.deleteRows(this.op.toDelete)
      await this.client.query('COMMIT')
      return [0, '']
    } catch (e) {
      try { await this.client.query('ROLLBACK') } catch (e2) { /* */ }
      return this.trap(e)
    }
  }

  // PRIVATE
  trap (e) {
    const c = e.code
    if (c === 'undefined' || typeof c !== 'string' || c.length !== 5) 
      throw e
    const s = (e.code || '???') + '\n' + (e.message || '') + '\n' + 
      (e.stack ? e.stack + '\n' : '')
    if (c === '40P01') return [1, s]
    return [2, s]
  }

  // Méthode PUBLIQUE de test: retour comme doTransaction [0 / 1 / 2, detail]
  async ping () {
    try {
      let text = 'SELECT _data_, v FROM singletons WHERE id = \'1\''
      const res = await this.client.query(text, [])
      const t = res.rows.length ? res.rows[0]._data_ : null
      let dav = '?', v = 1
      if (t) {
        dav = Buffer.from(t).toString()
        v = res.rows[0].v + 1
      }
      const d = new Date().toISOString()
      const _data_ = Buffer.from(d)
      if (t) text ='UPDATE singletons SET _data_ = $1, v = $2  WHERE id = \'1\''
      else text = 'INSERT INTO singletons (id, v, _data_) VALUES (\'1\', $2, $1)'
      await this.client.query(text, [_data_, v])
      return [0, 'PG ping OK: ' + dav + ' <=> ' + d]
    } catch (e) {
      return this.trap(e)
    }
  }

  /** PUBLIQUES POUR EXPORT / PURGE ******************************************/
  async deleteOrg(log) {
    const min = this.cOrg + '@'
    const max = this.cOrg + '@{'
    const dels = {}
    for(const nom of GenDoc.collsExp1){
      const query = {
        name: 'DELCOL' + row._nom,
        text: `DELETE FROM ${nom} WHERE id = $1;`,
        values: [this.cOrg]
      }
      const res = await this.client.query(query)
      dels[nom] = res.rowCount
    }
    for(const nom of GenDoc.collsExp2){
      const query = {
        name: 'DELCOL' + row._nom,
        text: `DELETE FROM ${nom} WHERE id >= $1 AND id < $2;`,
        values: [min, max]
      }
      const res = await this.client.query(query)
      dels[nom] = res.rowCount
    }
    for(const nom of GenDoc.sousColls){
      const query = {
        name: 'DELCOL' + row._nom,
        text: `DELETE FROM ${nom} WHERE id >= $1 AND id < $2;`,
        values: [min, max]
      }
      const res = await this.client.query(query)
      dels[nom] = res.rowCount
    }
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
    const text = 'INSERT INTO taches (op, org, id, dh, exc, dhf, nb) VALUES ($1, $2, $3, $4, $5, 0, 0) ON CONFLICT (op, org, id) DO UPDATE SET dh = excluded.dh, exc = excluded.exc'
    const values = [
      t.op,
      this.cryptedOrg(t.org),
      this.cryptedId(t.id),
      t.dh, 
      t.exc
    ]
    await this.client.query(text, values)
  }

  async delTache (op, org, id) {
    const values = [op, this.cryptedOrg(org), this.cryptedId(id)]
    const text = 'DELETE FROM taches WHERE op = $1 AND org = $2 AND id = $3'
    await this.client.query(text, values)
  }

  async recTache (op, org, id, dhf, nb) {
    const values = [op, this.cryptedOrg(org), this.cryptedId(id), dhf, nb]
    const text = 'UPDATE taches SET dhf = $4, nb = $5 WHERE op = $1 AND org = $2 AND id = $3'
    await this.client.query(text, values)
  }

  async prochTache (dh) {
    const text = 'SELECT * FROM taches WHERE dh < $1 ORDER BY dh DESC LIMIT 1'
    const values = [dh]
    const rows = (await this.client.query(text, values)).rows
    if (!rows.length) return null
    const r = rows[0]
    if (r.org) r.org = this.decryptedOrg(r.org)
    if (r.id) r.id = this.decryptedId(r.id)
    return r
  }

  async orgTaches (org) {
    const values = [this.cryptedOrg(org)]
    const text = 'SELECT * FROM taches WHERE org = $1'
    const rows = (await this.client.query(text, values)).rows
    for(const row of rows) {
      row.dh = parseInt(row.dh)
      row.dhf = parseInt(row.dhf)
      if (row.org) row.org = this.decryptedOrg(row.org)
      if (row.id) row.id = this.decryptedId(row.id)
    }
    return rows
  }

  async toutesTaches () {
    const text = 'SELECT * FROM taches'
    const rows = (await this.client.query(text)).rows
    for(const row of rows) {
      row.dh = parseInt(row.dh)
      row.dhf = parseInt(row.dhf)
      if (row.org) row.org = this.decryptedOrg(row.org)
      if (row.id) row.id = this.decryptedId(row.id)
    }
    return rows
  }

  async getRowEspaces () {
    const text = 'SELECT * FROM espaces'
    const rows = (await this.client.query(text)).rows
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
    const query = {
      name: 'SELESPCALC',
      text: 'SELECT * FROM espaces where dpt <= $1',
      values: [dpt]
    }
    const rows = (await this.client.query(query)).rows
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
    const query = {
      name: 'SELV' + nom,
      text: 'SELECT * FROM ' + nom + '  WHERE id = $1 AND v > $2',
      values: [this.idLong(id), v]
    }
    // const res = await this.client.query(query)
    const row = (await this.client.query(query)).rows[0]
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
    const query = {
      name: 'SELNV' + nom,
      text: 'SELECT * FROM ' + nom + '  WHERE id = $1',
      values: [this.idLong(id)]
    }
    const row = (await this.client.query(query)).rows[0]
    if (row) {
      row._nom = nom
      this.op.nl++
      return exportDb ? row : this.decryptRow(row)
    }
    return null
  }
    
  /* Retourne le row d'un objet d'une sous-collection nom / id / ids */
  async get (nom, id, ids) {
    const query = {
      name: 'SEL' + nom,
      text: 'SELECT * FROM ' + nom + '  WHERE id = $1 AND ids = $2',
      values: [this.idLong(id), this.cryptedId(ids)]
    }
    const row = (await this.client.query(query)).rows[0]
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
    const query = {
      name: 'SELCV',
      text: 'SELECT * FROM avatars WHERE id = $1 AND vcv > $2',
      values: [this.idLong(id), vcv]
    }
    const row = (await this.client.query(query)).rows[0]
    if (row) {
      row._nom = 'avatars'
      this.op.nl++
      return this.decryptRow(row)
    }
    return null
  }

  async getCompteHk (hk) {
    const query = {
      name: 'SELHPS1',
      text: 'SELECT * FROM comptes WHERE hk = $1',
      values: [this.idLong(hk)]
    }
    const row = (await this.client.query(query)).rows[0]
    if (row) {
      row._nom = 'comptes'
      this.op.nl++
      return this.decryptRow(row)
    }
    return null
  }
  
  async getAvatarHk (hk) {
    const query = {
      name: 'SELHPC',
      text: 'SELECT * FROM avatars WHERE hk = $1',
      values: [this.idLong(hk)]
    }
    const row = (await this.client.query(query)).rows[0]
    if (row) {
      row._nom = 'avatars'
      this.op.nl++
      return this.decryptRow(row)
    }
    return null
  }
  
  async getSponsoringIds (hk) {
    const query = {
      name: 'SELSPIDS',
      text: 'SELECT * FROM avatars WHERE hk = $1',
      values: [this.idLong(hk)]
    }
    const row = (await this.client.query(query)).rows[0]
    if (row) {
      row._nom = 'sponsorings'
      this.op.nl++
      return this.decryptRow(row)
    }
    return null
  }
  
  /* Retourne l'array des [org, id] des "groupes" dont la fin d'hébergement est inférieure à dfh */
  async getGroupesDfh (dfh) {
    const query = {
      name: 'SELGDFH',
      text: 'SELECT id FROM groupes WHERE dfh > 0 AND dfh < $1',
      values: [dfh]
    }
    const rows = (await this.client.query(query)).rows
    const r = []
    if (rows) rows.forEach(row => {
      r.push(this.orgId(row.id))
    })
    return r
  }
  
  /* Retourne l'array des [org, id] des comptes ayant passé leur dlv */
  async getComptasDlv (dlvmax) {
    const query = {
      name: 'SELCDLV',
      text: 'SELECT id FROM comptas WHERE dlv < $1',
      values: [dlvmax]
    }
    const rows = (await this.client.query(query)).rows
    const r = []
    if (rows) rows.forEach(row => { 
      r.push(this.orgId(row.id))
    })
    return r
  }

  /* Retourne la collection de nom 'nom' : pour avoir tous les espaces */
  async coll (nom) {
    const query = {
      name: 'COLV' + nom,
      text: 'SELECT * FROM ' + nom,
      values: []
    }
    const rows = (await this.client.query(query)).rows
    if (!rows || !rows.length) return []
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
    const query = {
      name: 'COLNS' + nom,
      text: 'SELECT * FROM ' + nom + ' WHERE id >= $1 AND id < $2',
      values: [min, max]
    }
    const rows = (await this.client.query(query)).rows
    if (!rows || !rows.length) return []
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
    const query = {
      name: (v ? 'SCOLV' : 'SCOLB') + nom,
      text: 'SELECT * FROM ' + nom + ' WHERE id = $1' + (v ? ' AND v > $2' : ''),
      values: [this.idLong(id)]
    }
    if (v) query.values.push(v)
    const rows = (await this.client.query(query)).rows
    if (!rows || !rows.length) return []
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
    const query = {
      name: 'SELTKTS',
      text: 'SELECT * FROM tickets WHERE id = $1 AND dlv <= $2',
      values: [this.idLong(id), dlv]
    }
    const rows = (await this.client.query(query)).rows
    if (!rows || !rows.length) return []
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
    const query = {
      name: 'DELSCOL'+ nom,
      text: 'DELETE FROM ' + nom + ' WHERE id = $1',
      values: [this.idLong(id)]
    }
    const res = await this.client.query(query)
    this.op.ne += res.rowCount
    return res.rowCount
  }

  async delTickets (id, dlv) {
    const query = {
      name: 'DELTKT',
      text: 'DELETE FROM tickets WHERE id = $1 AND dlv <= $2',
      values: [this.idLong(id), dlv]
    }
    const res = await this.client.query(query)
    this.op.ne += res.rowCount
    return res.rowCount
  }

  /* Retourne une liste d'objets  { org, id, idag, lidf } */
  async listeFpurges () {
    const r = []
    const text = 'SELECT _data_ FROM fpurges'
    const rows = (await this.client.query(text)).rows
    if (rows && rows.length) rows.forEach(row => {
      row._nom = 'fpurges'
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
    const query = {
      name: 'SELTRADLV',
      text: 'SELECT * FROM transferts WHERE dlv <= $1',
      values: [dlv]
    }
    const rows = (await this.client.query(query)).rows
    if (rows && rows.length) rows.forEach(row => {
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
    const query = {
      text: 'DELETE FROM fpurges WHERE id = $1',
      values: [this.idLong(id)]
    }
    await this.client.query(query)
    this.op.ne++
  }

  async purgeTransferts (id) {
    const query = {
      text: 'DELETE FROM transferts WHERE id = $1',
      values: [this.idLong(id)]
    }
    await this.client.query(query)
    this.op.ne++
  }

  async purgeVER (suppr) {
    const query = {
      name: 'DELVER',
      text: 'DELETE FROM versions WHERE dlv > 0 AND dlv < $1',
      values: [suppr]
    }
    const res = await this.client.query(query)
    this.op.ne += res.rowCount
    return res.rowCount
  }

  async purgeSPO (dlv) { // nom: sponsorings
    const query = {
      name: 'DELSPO',
      text: 'DELETE FROM sponsorings WHERE dlv < $1',
      values: [dlv]
    }
    const res = await this.client.query(query)
    this.op.ne += res.rowCount
    return res.rowCount
  }

  // PRIVATE /////////////////////////////////////////// 
  async deleteRows (rows) {
    for (const row of rows) {
      const aids = GenDoc._attrs[row._nom].indexOf('ids') !== -1
      const query = {
        name: 'DEL' + row._nom,
        text: this._delStmt(row._nom),
        values: []
      }
      query.values.push(row.id)
      if (aids) query.values.push(row.ids)
      await this.client.query(query)
    }
  }

  async insertRows (rows) {
    for (const row of rows) {
      const la = GenDoc._attrs[row._nom]
      const query = {
        name: 'INS' + row._nom,
        text: this._insStmt(row._nom),
        values: new Array(la.length)
      }
      for(let i = 0; i < la.length; i++) query.values[i] = row[la[i]]
      await this.client.query(query)
    }
  }

  async updateRows (rows) {
    for (const row of rows) {
      const la = GenDoc._attrs[row._nom]
      const query = {
        name: 'UPD' + row._nom,
        text: this._updStmt(row._nom),
        values: new Array(la.length)
      }
      for(let i = 0; i < la.length; i++) query.values[i] = row[la[i]]
      await this.client.query(query)
    }
  }

  /* PRIVATE : retourne un insert statement SQL 
   Syntaxe : INSERT INTO matable (c1, c2) VALUES (@1, @2)
  */
  _insStmt (nom) {
    const x = ['INSERT INTO ' + nom + ' (']
    const la = GenDoc._attrs[nom]
    x.push(la.join(', '))
    x.push(') VALUES (')
    const vals = []
    for(let i = 0; i < la.length; i++) vals.push('$' + (i + 1))
    x.push(vals.join(', '))
    x.push(')')
    return x.join('')
  }

  /* PRIVATE : retourne un update statement SQL 
   Syntaxe : UPDATE matable SET c1 = $3, c2 = $4 WHERE id = @1 AND ids = @2
  */
  _updStmt (nom) {
    const vals = []
    const x = ['UPDATE ' + nom + ' SET ']
    const la = GenDoc._attrs[nom]
    for(let i = 0; i < la.length; i++) {
      const c = la[i]
      if (c !== 'id' && c!== 'ids') vals.push(c + ' = $' + (i + 1))
    }
    x.push(vals.join(', '))
    x.push(' WHERE id = $1 ')
    if (la.indexOf('ids') !== -1) x.push(' AND ids = $2')
    return x.join('')
  }

  /* PRIVATE : retourne un delete statement SQL 
   Syntaxe : DELETE FROM matable WHERE id = @id
  */
  _delStmt (nom) {
    const x = ['DELETE FROM ' + nom + ' WHERE id = $1 ']
    if (GenDoc._attrs[nom].indexOf('ids') !== -1) x.push(' AND ids = $2')
    return x.join('')
  }

}