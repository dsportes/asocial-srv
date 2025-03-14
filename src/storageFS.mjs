import { writeFile, readFile } from 'node:fs/promises'
import { existsSync, unlinkSync, rmSync, readdirSync, mkdirSync } from 'node:fs'
import path from 'path'

import { encode3 } from './util.mjs'
import { config } from './config.mjs'
import { GenStProvider } from './gendoc.mjs'

/* FsProvider ********************************************************************/
export class FsProvider extends GenStProvider {
  constructor (code, site) {
    super(code, site)
    this.rootpath = config[code].rootpath
    if (!existsSync(this.rootpath)) {
      config.logger.info('Path FsStorage inaccessible= [' + this.rootpath + ']')
      this.ko = true
    }
  }

  storageUrlGenerique (org, id, idf) {
    return config.run.rooturl + '/storage/' + encode3(org, id, idf)
  }

  async ping () {
    try {
      const txt = new Date().toISOString()
      const data = Buffer.from(txt)
      const p = path.resolve(this.rootpath, 'ping.txt')
      await writeFile(p, Buffer.from(data))
      return 'File_system ping.txt OK: ' + txt
    } catch (e) {
      return 'File_system ping.txt KO: ' + e.toString
    }
  }

  getUrl (org, id, idf) { 
    return this.storageUrlGenerique(org, id, idf) 
  }

  putUrl (org, id, idf) {
    return this.storageUrlGenerique(org, id, idf) 
  }

  async getFile (porg, pid, pidf) {
    try {
      const org = this.cryptedOrg(porg)
      const id = this.cryptedId(pid)
      const idf = this.cryptedIdf(pidf)
      const p = path.resolve(this.rootpath, ''+org, ''+id, ''+idf)
      return await readFile(p)
    } catch (err) {
      config.logger.info(err.toString())
      return null
    }
  }

  async putFile (porg, pid, pidf, data) {
    try {
      const org = this.cryptedOrg(porg)
      const id = this.cryptedId(pid)
      const idf = this.cryptedIdf(pidf)
      const dir = path.resolve(this.rootpath, ''+org, ''+id)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      const p = path.resolve(dir, ''+idf)
      await writeFile(p, Buffer.from(data))
    } catch (err) {
      config.logger.info(err.toString())
      throw err
    }
  }

  async delFiles (porg, pid, lidf) {
    if (!lidf || !lidf.length) return
    try {
      const org = this.cryptedOrg(porg)
      const id = this.cryptedId(pid)
      const dir = path.resolve(this.rootpath, ''+org, ''+id)
      if (existsSync(dir)) {
        for (let i = 0; i < lidf.length; i++) {
          const idf = this.cryptedIdf(lidf[i])
          const p = path.resolve(dir, '' + idf)
          try {
            unlinkSync(p)
          } catch (e) { /* rien*/ }
        }
      }
    } catch (err) {
      config.logger.info(err.toString())
      throw err
    }
  }

  async delId (porg, pid) {
    try {
      const org = this.cryptedOrg(porg)
      const id = this.cryptedId(pid)
      const dir = path.resolve(this.rootpath, ''+org, ''+id)
      if (existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true })
      }
    } catch (err) {
      config.logger.info(err.toString())
      throw err
    }
  }

  async delOrg (porg) {
    try {
      const org = this.cryptedOrg(porg)
      const dir = path.resolve(this.rootpath, ''+org)
      if (existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true })
      }
    } catch (err) {
      config.logger.info(err.toString())
      throw err
    }
  }

  async listFiles (porg, pid) {
    try {
      const org = this.cryptedOrg(porg)
      const id = this.cryptedId(pid)
      const lst = []
      const dir = path.resolve(this.rootpath, ''+org, ''+id)
      if (existsSync(dir)) {
        const files = readdirSync(dir)
        if (files && files.length) files.forEach(name => { 
          const dname = this.decryptedIdf(name)
          lst.push(dname) 
        })
      }
      return lst
    } catch (err) {
      config.logger.info(err.toString())
      throw err
    }
  }

  async listIds (porg) {
    try {
      const lst = []
      const org = this.cryptedOrg(porg)
      const dir = path.resolve(this.rootpath, ''+org)
      if (existsSync(dir)) {
        const files = readdirSync(dir)
        if (files && files.length) files.forEach(name => { 
          const dname = this.decryptedId(name)
          lst.push(dname) 
        })
      }
      return lst
    } catch (err) {
      config.logger.info(err.toString())
      throw err
    }
  }

}
