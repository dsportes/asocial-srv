import { writeFile, readFile } from 'node:fs/promises'
import { existsSync, unlinkSync, rmSync, readdirSync, mkdirSync } from 'node:fs'
import path from 'path'

import { encode3 } from './util.mjs'
import { config } from './config.mjs'

/* FsProvider ********************************************************************/
export class FsProvider {
  constructor (codeProvider) {
    this.rootpath = config[codeProvider].rootpath
  }

  storageUrlGenerique (org, id, idf) {
    return config.run.rooturl + '/storage/' + encode3(org, id, idf)
  }

  async ping () {
    const data = Buffer.from(new Date().toISOString())
    const p = path.resolve(this.rootpath, 'ping.txt')
    await writeFile(p, Buffer.from(data))
    return true
  }

  getUrl (org, id, idf) { return this.storageUrlGenerique(org, id, idf) }

  putUrl (org, id, idf) { return this.storageUrlGenerique(org, id, idf) }

  async getFile (org, id, idf) {
    try {
      const p = path.resolve(this.rootpath, ''+org, ''+id, ''+idf)
      return await readFile(p)
    } catch (err) {
      config.logger.info(err.toString())
      return null
    }
  }

  async putFile (org, id, idf, data) {
    const dir = path.resolve(this.rootpath, ''+org, ''+id)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const p = path.resolve(dir, ''+idf)
    await writeFile(p, Buffer.from(data))
  }

  async delFiles (org, id, lidf) {
    if (!lidf || !lidf.length) return
    try {
      const dir = path.resolve(this.rootpath, ''+org, ''+id)
      if (existsSync(dir)) {
        for (let i = 0; i < lidf.length; i++) {
          const p = path.resolve(dir, '' + lidf[i])
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

  async delId (org, id) {
    try {
      const dir = path.resolve(this.rootpath, ''+org, ''+id)
      if (existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true })
      }
    } catch (err) {
      config.logger.info(err.toString())
      throw err
    }
  }

  async delOrg (org) {
    try {
      const dir = path.resolve(this.rootpath, ''+org)
      if (existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true })
      }
    } catch (err) {
      config.logger.info(err.toString())
      throw err
    }
  }

  async listFiles (org, id) {
    try {
      const lst = []
      const dir = path.resolve(this.rootpath, ''+org, ''+id)
      if (existsSync(dir)) {
        const files = readdirSync(dir)
        if (files && files.length) files.forEach(name => { lst.push(name) })
      }
      return lst
    } catch (err) {
      config.logger.info(err.toString())
      throw err
    }
  }

  async listIds (org) {
    try {
      const lst = []
      const dir = path.resolve(this.rootpath, ''+org)
      if (existsSync(dir)) {
        const files = readdirSync(dir)
        if (files && files.length) files.forEach(name => { lst.push(name) })
      }
      return lst
    } catch (err) {
      config.logger.info(err.toString())
      throw err
    }
  }

}
