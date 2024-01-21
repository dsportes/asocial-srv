import path from 'path'
import { existsSync } from 'node:fs'
import { Database } from './loadreq.mjs'
import { decode } from '@msgpack/msgpack'
import { ctx } from './server.js'
import { GenDoc, prepRow, decryptRow } from './gendoc.mjs'
import { d14, ID } from './api.mjs'

export class SqliteProvider {
  constructor (cfg, site) {
    this.site = site
    this.appKey = Buffer.from(ctx.site(site), 'base64')
    const p = path.resolve(cfg.path)
    if (!existsSync(p)) {
      ctx.logger.info('Path DB (création)= [' + p + ']')
    } else {
      ctx.logger.info('Path DB= [' + p+ ']')
    }
    const options = {
      verbose: (msg) => {
        if (ctx.mondebug) ctx.logger.debug(msg)
        this.lastSql.unshift(msg)
        if (this.lastSql.length > 3) this.lastSql.length = 3
      } 
    }
    this.sql = Database(p, options)
    this.lastSql = []
    this.cachestmt = { }
  }

  get hasWS () { return true }

  async ping () {
    return true
  }

  excInfo () {
    return this.lastSql.join('\n')
  }

  async doTransaction (op) {
    try {
      this._stmt('begin', 'BEGIN').run()
      await op.doPhase2()
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
      const st = this._stmt(code, GenDoc._delStmt(row._nom))
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
      const r = prepRow(op, row)
      const code = 'INS' + row._nom
      const st = this._stmt(code, GenDoc._insStmt(row._nom))
      st.run(r)
    }
  }

  async updateRows (op, rows) {
    for (const row of rows) {
      const code = 'UPD' + row._nom
      const st = this._stmt(code, GenDoc._updStmt(row._nom))
      const r = prepRow(op, row)
      st.run(r)
    }
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
  
  /* Retourne l'avatar si sa CV est PLUS récente que celle détenue en session (de version vcv)
  */
  async getAvatarVCV(op, id, vcv) {
    const st = this._stmt('SELCV', 'SELECT * FROM avatars WHERE id = @id AND vcv > @vcv')
    const row = st.get({ id : id, vcv: vcv })
    if (row) {
      row._nom = 'avatars'
      op.nl++
      return await decryptRow(op, row)
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
      return await decryptRow(op, row)
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
      return await decryptRow(op, row)
    }
    return null
  }
  
  async getComptaHps1(op, hps1) {
    const st = this._stmt('SELHPS1', 'SELECT * FROM comptas WHERE hps1 = @hps1')
    const row = st.get({ hps1 })
    if (row) {
      row._nom = 'comptas'
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
  
  /* Retourne l'array des ids des "versions" dont la dlv est entre min et max incluses */
  async getVersionsDlv(op, dlvmin, dlvmax) {
    const st = this._stmt('SELVDLV', 'SELECT id FROM versions WHERE dlv >= @dlvmin AND dlv <= @dlvmax')
    const rows = st.all({ dlvmin, dlvmax })
    const r = []
    if (rows) rows.forEach(row => { r.push(row.id)})
    op.nl += r.length
    return r
  }
  
  static async getMembresDlv(op, dlvmax) {
    const st = this._stmt('SELMDLV', 'SELECT id, ids FROM membres WHERE dlv <= @dlvmax')
    const rows = st.all({ dlvmax })
    const r = []
    if (rows) rows.forEach(row => { r.push([row.id, row.ids])})
    op.nl += r.length
    return r
  }
  
  static async getGroupesDfh(op, dfh) {
    const st = this._stmt('SELGDFH', 'SELECT id FROM groupes WHERE dfh > 0 AND dfh <= @dfh')
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
  
  /* Retourne la collection de nom 'nom' */
  async collNs (op, nom, ns) {
    const ns1 = ns * d14
    const ns2 = (ns + 1) * d14
    const code = 'COLNS' + nom
    const st = this._stmt(code, 'SELECT * FROM ' + nom + ' WHERE id >= @ns1 AND ID < @ns2')
    const rows = st.all({ ns1, ns2 })
    if (!rows) return []
    const r = []
    for (const row of rows) {
      row._nom = nom
      r.push(await decryptRow(op, row))
    }
    op.nl += r.length
    return r
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
  
  async delScoll (op, nom, id) {
    const code = 'DELSCOL'+ nom
    const st = this._stmt(code, 'DELETE FROM ' + nom + ' WHERE id = @id')
    const info = st.run({id : id})
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
  
  async getCheckpoint (op, v) { 
    // INDEX singletons v
    const st = this._stmt('SELCHKPT', 'SELECT * FROM singletons WHERE id = 1 AND v > @v')
    const x = st.get({ v: v })
    if (x) {
      op.nl++
      return x
    }
    return null
  }

  async setCheckpoint (op, x, _data_, ins) {
    let st
    if (ins) {
      st = this._stmt('INSCHKPT', 'INSERT INTO singletons (id, v,_data_) VALUES (1, @v, @_data_)')
    } else {
      st = this._stmt('UPDCHKPT', 'UPDATE singletons SET _data_ = @_data_, v = @v WHERE id = 1')
    }
    st.run({ v: x.v, _data_ })
    op.ne++
  }

  async org (op, ns) {
    const st = this._stmt('SELORG', 'SELECT * FROM espaces WHERE id = @id')
    const row = st.get({ id: ns })
    if (row) {
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
    const st = this._stmt('DELDLV' + nom, 'DELETE FROM ' + nom + ' WHERE dlv <= @dlv')
    const info = st.run({ dlv })
    const n = info.changes
    op.ne += n
    return n
  }
}