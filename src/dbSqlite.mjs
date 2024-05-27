import path from 'path'
import { existsSync } from 'node:fs'
import { Database } from './loadreq.mjs'
import { decode, encode } from '@msgpack/msgpack'
import { config } from './config.mjs'
import { app_keys } from './keys.mjs'
import { GenDoc, compile, prepRow, decryptRow } from './gendoc.mjs'
import { d14, ID, d10 } from './api.mjs'

export class SqliteProvider {
  constructor (site, code) {
    this.code = code
    this.appKey = Buffer.from(app_keys.sites[site], 'base64')
    const p = path.resolve(config[code].path)
    if (!existsSync(p)) {
      config.logger.info('Path DB (création)= [' + p + ']')
    } else {
      config.logger.info('Path DB= [' + p + ']')
    }
    const options = {
      verbose: (msg) => {
        if (config.mondebug) config.logger.debug(msg)
        this.lastSql.unshift(msg)
        if (this.lastSql.length > 3) this.lastSql.length = 3
      } 
    }
    this.sql = Database(p, options)
    this.lastSql = []
    this.cachestmt = { }
  }

  get type () { return 'sqlite' }

  get hasWS () { return true }

  async ping () {
    try {
      const sts = this._stmt('PINGS', 'SELECT _data_ FROM singletons WHERE id = 1')
      const t = sts.get()
      const d = new Date()
      const v = d.getTime()
      const _data_ = d.toISOString()
      if (t) {
        const stu = this._stmt('PINGU', 'UPDATE singletons SET _data_ = @_data_, v = @v  WHERE id = 1')
        stu.run({ v, _data_ })
      } else {
        const sti = this._stmt('PINGI', 'INSERT INTO singletons (id, v, _data_) VALUES (1, @v, @_data_)')
        sti.run({ v, _data_ })
      }
      return 'Sqlite ping OK: ' + (t && t._data_ ? t._data_ : '?') + ' <=> ' + _data_
    } catch (e) {
      return 'Sqlite ping KO: ' + e.toString()
    }
  }

  excInfo () {
    return this.lastSql.join('\n')
  }

  // eslint-disable-next-line no-unused-vars
  setSyncData(op) {
  }

  async doTransaction (op) {
    try {
      this._stmt('begin', 'BEGIN').run()
      await op.transac()
      this._stmt('commit', 'COMMIT').run()
    } catch (e) {
      this._stmt('rollback', 'ROLLBACK').run()
      throw e
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

  /** Ecritures groupées ***********************************************/
  deleteRows (op, rows) {
    for (const row of rows) {
      const code = 'DEL' + row._nom
      const st = this._stmt(code, this._delStmt(row._nom))
      st.run(row) // row contient id et ids
    }
  }

  async setVdlv (op, id, dlv) {
    const st = this._stmt('UPDVDLV', 
      'UPDATE versions SET dlv = @dlv, _data_ = NULL WHERE id = @id')
    st.run({ id, dlv })
  }

  async insertRows (op, rows) {
    for (const row of rows) {
      const r = await prepRow(op, row)
      const code = 'INS' + row._nom
      const st = this._stmt(code, this._insStmt(row._nom))
      st.run(r)
    }
  }

  async updateRows (op, rows) {
    for (const row of rows) {
      const code = 'UPD' + row._nom
      const st = this._stmt(code, this._updStmt(row._nom))
      const r = await prepRow(op, row)
      st.run(r)
    }
  }

  async getRowEspaces(op, v) {
    const code = 'SELESP'
    const st = this._stmt(code, 'SELECT * FROM espaces WHERE v > @v')
    const rows = st.all({ v })
    const r = []
    for (const row of rows) {
      const x = await decryptRow(op, row)
      x._nom = 'espaces'
      r.push(row)
    }
    return r
  }

  /* Retourne le row d'une collection de nom / id si sa version est postérieure à v
  */
  async getV(op, nom, id, v) {
    const code = 'SELV' + nom
    const st = this._stmt(code, 'SELECT * FROM ' + nom + '  WHERE id = @id AND v > @v')
    const row = st.get({ id : id, v: v })
    if (row) {
      row._nom = nom
      op.nl++
      return await decryptRow(op, row)
    }
    return null
  }
  
  /* Retourne le row d'une collection de nom / id (sans version))
  */
  async getNV(op, nom, id) {
    const code = 'SELNV' + nom
    const st = this._stmt(code, 'SELECT * FROM ' + nom + '  WHERE id = @id')
    const row = st.get({ id : id})
    if (row) {
      row._nom = nom
      op.nl++
      return await decryptRow(op, row)
    }
    return null
  }
    
  /* Retourne le row d'un objet d'une sous-collection nom / id / ids */
  async get(op, nom, id, ids) {
    const code = 'SEL' + nom
    const st = this._stmt(code, 'SELECT * FROM ' + nom + '  WHERE id = @id AND ids = @ids')
    const row = st.get({ id : id, ids: ids })
    if (row) {
      row._nom = nom
      op.nl++
      return await decryptRow(op, row)
    }
    return null
  }
  
  /*
  async getEspaceOrg(op, org) {
    const code = 'SELORG'
    const st = this._stmt(code, 'SELECT * FROM espaces WHERE org = @org')
    const row = st.get({ org })
    if (row) {
      row._nom = 'espaces'
      op.nl++
      return await decryptRow(op, row)
    }
    return null
  }
  */

  /* Retourne l'avatar si sa CV est PLUS récente que celle détenue en session (de version vcv)
  */
  async getAvatarVCV(op, id, vcv) {
    const st = this._stmt('SELCV', 'SELECT * FROM avatars WHERE id = @id AND vcv > @vcv')
    const row = st.get({ id : id, vcv: vcv })
    if (row) {
      row._nom = 'avatars'
      op.nl++
      const b = await decryptRow(op, row)
      const a = compile(b)
      return a
    }
    return null
  }
  
  /* Retourne LE chat si sa CV est MOINS récente que celle détenue en session (de version vcv)
  */
  async getChatVCV(op, id, ids, vcv) {
    const st = this._stmt('SELCHCV', 'SELECT * FROM chats WHERE id = @id AND ids = @ids AND vcv < @vcv')
    const row = st.get({ id : id, ids: ids, vcv: vcv })
    if (row) {
      row._nom = 'chats'
      op.nl++
      return compile(await decryptRow(op, row))
    }
    return null
  }

  /* Retourne LE row ticket si sa version est plus récente que celle détenue en session (de version v)
  */
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

  /* Retourne LE membre si sa CV est MOINS récente que celle détenue en session (de version vcv)
  */
  async getMembreVCV(op, id, ids, vcv) {
    const st = this._stmt('SELMBCV', 'SELECT * FROM membres WHERE id = @id AND ids = @ids AND vcv < @vcv')
    const row = st.get({ id : id, ids: ids, vcv: vcv })
    if (row) {
      row._nom = 'membres'
      op.nl++
      return compile(await decryptRow(op, row))
    }
    return null
  }
  
  async getCompteHXR(op, hxr) {
    const st = this._stmt('SELHPS1', 'SELECT * FROM comptes WHERE hxr = @hxr')
    const row = st.get({ hxr })
    if (row) {
      row._nom = 'comptes'
      op.nl++
      return await decryptRow(op, row)
    }
    return null
  }
  
  async getAvatarHpc(op, hpc) {
    const st = this._stmt('SELHPC', 'SELECT * FROM avatars WHERE hpc = @hpc')
    const row = st.get({ hpc })
    if (row) {
      row._nom = 'avatars'
      op.nl++
      return await decryptRow(op, row)
    }
    return null
  }
  
  async getSponsoringIds(op, ids) {
    const st = this._stmt('SELSPIDS', 'SELECT * FROM sponsorings WHERE ids = @ids')
    const row = st.get({ ids })
    if (row) {
      row._nom = 'sponsorings'
      op.nl++
      return await decryptRow(op, row)
    }
    return null
  }
  
  /* Retourne l'array des ids des "versions" dont la dlv est entre min et max exclue */
  async getVersionsSuppr(op, supprmin, supprmax) {
    const st = this._stmt('SELVSUPPR', 'SELECT id FROM versions WHERE suppr >= @supprmin AND dlv < @supprmax')
    const rows = st.all({ supprmin, supprmax })
    const r = []
    if (rows) rows.forEach(row => { r.push(row.id)})
    op.nl += r.length
    return r
  }
  
  /* Retourne l'array des couples [id, ids] des membres ayant passé leur dlv, PAS les rows */
  async getMembresDlv(op, dlvmax) {
    const st = this._stmt('SELMDLV', 'SELECT id, ids FROM membres WHERE dlv < @dlvmax')
    const rows = st.all({ dlvmax })
    const r = []
    if (rows) rows.forEach(row => { r.push([row.id, row.ids])})
    op.nl += r.length
    return r
  }
  
  /* Retourne l'array des couples [id, ids] des membres du ns
  ayant pour dlv dlvat, PAS les rows */
  async getMembresDlvat(op, ns, dlvat) {
    const ns1 = ns * d14
    const ns2 = (ns + 1) * d14
    const st = this._stmt('SELMDLVAT', 'SELECT id, ids FROM membres WHERE dlv = @dlvat AND id >= @ns1 AND id < @ns2')
    const rows = st.all({ dlvat, ns1, ns2 })
    const r = []
    if (rows) rows.forEach(row => { r.push([row.id, row.ids])})
    op.nl += r.length
    return r
  }

  /* Retourne l'array des id des versions du ns
  ayant pour dlv dlvat, PAS les rows */
  async getVersionsDlvat(op, ns, dlvat) {
    const ns1 = ns * d14
    const ns2 = (ns + 1) * d14
    const st = this._stmt('SELVDLVAT', 'SELECT id FROM versions WHERE dlv = @dlvat AND id >= @ns1 AND id < @ns2')
    const rows = st.all({ dlvat, ns1, ns2 })
    const r = []
    if (rows) rows.forEach(row => { r.push(row.id)})
    op.nl += r.length
    return r
  }
  
  /* Retourne l'array des ids des "groupes" dont la fin d'hébergement 
  est inférieure à dfh */
  async getGroupesDfh(op, dfh) {
    const st = this._stmt('SELGDFH', 'SELECT id FROM groupes WHERE dfh > 0 AND dfh < @dfh')
    const rows = st.all({ dfh })
    const r = []
    if (rows) rows.forEach(row => { r.push(row.id)})
    op.nl += r.length
    return r
  }
  
  /* Retourne la collection de nom 'nom' : pour avoir tous les espaces */
  async coll (op, nom) {
    const code = 'COLV' + nom
    const st = this._stmt(code, 'SELECT * FROM ' + nom)
    const rows = st.all({ })
    if (!rows) return []
    const r = []
    for (const row of rows) {
      row._nom = nom
      r.push(await decryptRow(op, row))
    }
    op.nl += r.length
    return r
  }
  
  /* Retourne la collection de nom 'nom' 
  SI la fonction "fnprocess" est présente 
  elle est invoquée à chaque row pour traiter son _data_
  plutôt que d'accumuler les rows.
  */
  async collNs (op, nom, ns, fnprocess) {
    const ns1 = ns * d14
    const ns2 = (ns + 1) * d14
    const code = 'COLNS' + nom
    const st = this._stmt(code, 'SELECT * FROM ' + nom + ' WHERE id >= @ns1 AND id < @ns2')
    const rows = st.all({ ns1, ns2 })
    if (!rows) return []
    const r = []
    for (const row of rows) {
      row._nom = nom
      const rx = await decryptRow(op, row)
      op.nl++
      if (!fnprocess) r.push(rx); else fnprocess(op, rx._data_)
    }
    return !fnprocess ? r : null
  }
    
  /* Retourne la sous-collection de 'nom' du document majeur id
  Si v est donnée, uniquement les documents de version supérieurs à v.
  */
  async scoll (op, nom, id, v) {
    const code = (v ? 'SCOLV' : 'SCOLB') + nom
    const st = this._stmt(code, 'SELECT * FROM ' + nom + ' WHERE id = @id' + (v ? ' AND v > @v' : ''))
    const rows = st.all({ id: id, v: v })
    if (!rows) return []
    const r = []
    for (const row of rows) {
      row._nom = nom
      r.push(await decryptRow(op, row))
    }
    op.nl += r.length
    return r
  }
  
  /* Retourne les tickets du comptable id et du mois aamm ou antérieurs
  */
  async selTickets (op, id, aamm, fnprocess) {
    const mx = ((aamm % 10000) * d10) + 9999999999
    const st = this._stmt('SELTKTS', 'SELECT * FROM tickets WHERE id = @id AND ids <= @mx')
    const rows = st.all({ id, mx })
    if (!rows) return []
    const r = []
    for (const row of rows) {
      row._nom = 'tickets'
      const rx = await decryptRow(op, row)
      op.nl++
      if (!fnprocess) r.push(rx); else fnprocess(op, rx._data_)
    }
    return !fnprocess ? r : null
  }

  async delScoll (op, nom, id) {
    const code = 'DELSCOL'+ nom
    const st = this._stmt(code, 'DELETE FROM ' + nom + ' WHERE id = @id')
    const info = st.run({id : id})
    op.ne += info.changes
    return info.changes
  }

  async delTickets (op, id, aamm) {
    const mx = ((aamm % 10000) * d10) + 9999999999
    const code = 'DELTKT'
    const st = this._stmt(code, 'DELETE FROM tickets WHERE id = @id AND ids <= @mx')
    const info = st.run({id, mx})
    op.ne += info.changes
    return info.changes
  }

  async delAvGr (op, id) {
    const nom = ID.estGroupe(id) ? 'groupes' : 'avatars'
    const code = 'DELAVGR'+ nom
    const st = this._stmt(code, 'DELETE FROM ' + nom + ' WHERE id = @id')
    st.run({id : id})
    op.ne++
  }
  
  // Retourne les data (sérialisées) des singletons
  async getSingletons (op) { 
    const r = []
    const st = this._stmt('SELSINGL', 'SELECT _data_ FROM singletons')
    const rows = st.all({ })
    if (rows) rows.forEach(row => {
      r.push(row._data_)
    })
    op.nl += r.length
    return r
  }

  // Stocke le singleton dont le data est donné: data.id est son id
  async setSingleton (op, data) { 
    let st = this._stmt('DELSINGL', 'DELETE FROM singletons WHERE id = @id')
    st.run({ id: data.id })
    const _data_ = encode(data)
    st = this._stmt('INSSINGL', 'INSERT INTO singletons (id, v, _data_) VALUES (@id, @v, @_data_)')
    st.run({ id: data.id, v: data.v || 0, _data_ })
  }

  async org (op, ns) {
    const st = this._stmt('SELORG', 'SELECT * FROM espaces WHERE id = @id')
    const row = st.get({ id: ns })
    if (row) {
      row._nom = 'espaces'
      op.nl++
      return await decryptRow(op, row)
    }
    return null
  }

  async setFpurge (op, id, _data_) {
    const st = this._stmt('INSFPURGE', 'INSERT INTO fpurges (id, _data_) VALUES (@id, @_data_)')
    st.run({ id, _data_ })
    op.ne++
  }

  async unsetFpurge (op, id) {
    const st = this._stmt('DELFPURGE', 'DELETE FROM fpurges WHERE id = @id')
    st.run({ id })
    op.ne++
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
  async listeTransfertsDlv (op, dlv) {
    const r = []
    const st = this._stmt('SELTRADLV', 'SELECT * FROM transferts WHERE dlv <= @dlv')
    const rows = st.all({ dlv })
    if (rows) rows.forEach(row => {
      r.push([row.id, row.ids])
    })
    op.nl += r.length
    return r
  }

  async purgeTransferts (op, id, ids) {
    const st = this._stmt('DELTRA', 'DELETE FROM transferts WHERE id = @id AND ids = @ids')
    st.run({ id, ids })
    op.ne++
  }

  async purgeDlv (op, nom, dlv) { // nom: sponsorings, versions
    const st = this._stmt('DELDLV' + nom, 'DELETE FROM ' + nom + ' WHERE dlv < @dlv')
    const info = st.run({ dlv })
    const n = info.changes
    op.ne += n
    return n
  }

  async deleteNS(log, log2, ns) {
    const min = ns * d14
    const max = (ns + 1) * d14
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