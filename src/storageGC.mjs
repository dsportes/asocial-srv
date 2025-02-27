import { Storage } from '@google-cloud/storage'
import { encode3 } from './util.mjs'
import { config } from './config.mjs'
// import { service_account } from './keys.mjs'
import { GenStProvider } from './gendoc.mjs'

const cors = {
  origin: ['*'],
  method: ['GET', 'PUT'],
  responseHeader: ['Content-Type'],
  maxAgeSeconds: 3600
}

/* GcProvider ********************************************************************/
export class GcProvider extends GenStProvider {
  constructor (code, site) {
    super(code, site)
    // const service_account = config.service_account
    const cfg = config[code]
    const kn = cfg.key
    const service_account = config[kn]
    this.emulator = config.env.STORAGE_EMULATOR_HOST

    // Imports the Google Cloud client library
    // const {Storage} = require('@google-cloud/storage')
    // For more information on ways to initialize Storage, please see
    // https://googleapis.dev/nodejs/storage/latest/Storage.html

    const opt = { projectId: service_account.project_id, credentials: service_account }
    this.bucket = new Storage(opt).bucket(cfg.bucket)
    // this.bucket = new Storage().bucket(cfg.bucket) // Par env

    if (!this.emulator) this.bucket.setCorsConfiguration([cors])
  }

  storageUrlGenerique (org, id, idf) {
    return config.run.rooturl + '/storage/' + encode3(org, id, idf)
  }

  async ping () {
    try {
      const txt = new Date().toISOString()
      const fileName = 'ping.txt'
      await this.bucket.file(fileName).save(Buffer.from(txt))
      return 'Google storage ping.txt OK: ' + txt
    } catch (e) {
      return 'Google storage ping.txt KO: ' + e.toString
    }
  }

  async getUrl (porg, pid, pidf) {
    if (this.emulator) {
      const url = this.storageUrlGenerique(porg, pid, pidf)
      return url  
    }
    const org = this.cryptedOrg(porg)
    const id = this.cryptedId(pid)
    const idf = this.cryptedIdf(pidf)
    const fileName = org + '/' + id + '/' + idf
    // These options will allow temporary read access to the file
    const options = {
      version: 'v4', // defaults to 'v2' if missing.
      action: 'read',
      expires: Date.now() + 1000 * 60 * 60, // one hour
    }
    // Get a v4 signed URL for the file
    const f = this.bucket.file(fileName)
    const [url] = await f.getSignedUrl(options)
    return url
  }

  async putUrl (porg, pid, pidf) {
    if (this.emulator) {
      const url = this.storageUrlGenerique(porg, pid, pidf)
      return url  
    }
    const org = this.cryptedOrg(porg)
    const id = this.cryptedId(pid)
    const idf = this.cryptedIdf(pidf)
    const fileName = org + '/' + id + '/' + idf
    // These options will allow temporary uploading of the file with outgoing
    // Content-Type: application/octet-stream header.
    const options = {
      version: 'v4',
      action: 'write',
      expires: Date.now() + 15 * 60 * 1000, // 15 minutes
      contentType: 'application/octet-stream',
    }
    // Get a v4 signed URL for uploading file
    const f = this.bucket.file(fileName)
    const [url] = await f.getSignedUrl(options)
    return url
    /* You can use this URL with any user agent, for example:
    curl -X PUT -H 'Content-Type: application/octet-stream' --upload-file my-file ${url}
    */
  }

  async getFile (porg, pid, pidf) {
    try {
      const org = this.cryptedOrg(porg)
      const id = this.cryptedId(pid)
      const idf = this.cryptedIdf(pidf)
      const fileName = org + '/' + id + '/' + idf
      const contents = await this.bucket.file(fileName).download()
      return contents[0]
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
      const fileName = org + '/' + id + '/' + idf
      await this.bucket.file(fileName).save(Buffer.from(data))
    } catch (err) {
      config.logger.info(err.toString())
      throw err
    }
  }

  async delFiles (porg, pid, lidf) {
    if (!lidf || !lidf.length) return
    const org = this.cryptedOrg(porg)
    const id = this.cryptedId(pid)
    const deleteOptions = {
      ignoreNotFound: true // ne fait rien !
    }
    for (const pidf of lidf) {
      const idf = this.cryptedId(pidf)
      const fileName = org + '/' + id + '/' + idf
      try {
        await this.bucket.file(fileName).delete(deleteOptions)
      } catch (err) {
        config.logger.info(err.toString())
      }
    }
  }

  async delId (porg, pid) {
    return new Promise((resolve) => {
      const org = this.cryptedOrg(porg)
      const id = this.cryptedId(pid)
      const options = {
        prefix: org + '/' + id + '/',
        force: true
      }
      this.bucket.deleteFiles(options, () => {
        resolve(true)
      })
    })
  }

  async delOrg (porg) {
    return new Promise((resolve) => {
      const org = this.cryptedOrg(porg)
      const options = {
        prefix: org + '/',
        force: true
      }
      this.bucket.deleteFiles(options, () => {
        resolve(true)
      })
    })
  }

  async listFiles (porg, pid) {
    try {
      const org = this.cryptedOrg(porg)
      const id = this.cryptedId(pid)
      const prefix = org + '/' + id + '/'
      const lg = prefix.length
      // Lists files in the bucket, filtered by a prefix
      // eslint-disable-next-line no-unused-vars
      const [files] = await this.bucket.getFiles({prefix})
      const lst = []
      files.forEach(file => {
        const name = file.name.substring(lg)
        const dname = this.decryptedIdf(name)
        lst.push(dname) 
      }) 
      return lst
    } catch (err) {
      config.logger.info(err.toString())
      throw err
    }
  }

  async listIds (porg) {
    const org = this.cryptedOrg(porg)
    const lg = org.length + 1
    const options = { prefix: org }
    const s = new Set()
    const [files] = await this.bucket.getFiles(options)
    files.forEach(p => {
      const n = p.name.substring(lg)
      const x = n.substring(0, n.indexOf('/'))
      s.add(x)
    })
    const lst = []
    s.forEach(name => {
      const dname = this.decryptedIdf(name)
      lst.push(dname)
    })
    return lst
  }

}
