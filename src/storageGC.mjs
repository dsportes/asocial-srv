import { Storage } from '@google-cloud/storage'
import { encode3 } from './util.mjs'
import { config } from './config.mjs'
// import { service_account } from './keys.mjs'

const cors = {
  origin: ['*'],
  method: ['GET', 'PUT'],
  responseHeader: ['Content-Type'],
  maxAgeSeconds: 3600
}

/* GcProvider ********************************************************************/
export class GcProvider {
  constructor (codeProvider) {
    // const service_account = config.service_account
    const cfg = config[codeProvider]
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

  async getUrl (org, id, idf) {
    if (this.emulator) {
      const url = this.storageUrlGenerique(org, id, idf)
      return url  
    }
    const fileName = org + '/' + id + '/' + idf
    // These options will allow temporary read access to the file
    const options = {
      version: 'v4', // defaults to 'v2' if missing.
      action: 'read',
      expires: Date.now() + 1000 * 60 * 60, // one hour
    }
    // Get a v4 signed URL for the file
    const [url] = await this.bucket.file(fileName).getSignedUrl(options)
    return url
  }

  async putUrl (org, id, idf) {
    if (this.emulator) {
      const url = this.storageUrlGenerique(org, id, idf)
      return url  
    }
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
    const [url] = await this.bucket.file(fileName).getSignedUrl(options)
    return url
    /* You can use this URL with any user agent, for example:
    curl -X PUT -H 'Content-Type: application/octet-stream' --upload-file my-file ${url}
    */
  }

  async getFile (org, id, idf) {
    try {
      const fileName = org + '/' + id + '/' + idf
      const contents = await this.bucket.file(fileName).download()
      return contents[0]
    } catch (err) {
      config.logger.info(err.toString())
      return null
    }
  }

  async putFile (org, id, idf, data) {
    const fileName = org + '/' + id + '/' + idf
    await this.bucket.file(fileName).save(Buffer.from(data))
  }

  async delFiles (org, id, lidf) {
    if (!lidf || !lidf.length) return
    const deleteOptions = {
      ignoreNotFound: true // ne fait rien !
    }
    for (const idf of lidf) {
      const fileName = org + '/' + id + '/' + idf
      try {
        await this.bucket.file(fileName).delete(deleteOptions)
      } catch (err) {
        config.logger.info(err.toString())
      }
    }
  }

  async delId (org, id) {
    return new Promise((resolve) => {
      const options = {
        prefix: org + '/' + (id === -1 ? '' : id + '/'),
        force: true
      }
      this.bucket.deleteFiles(options, () => {
        resolve(true)
      })
    })
  }

  async delOrg (org) {
    await this.delId(org, -1)
  }

  async listFiles (org, id) {
    const prefix = org + '/' + id + '/'
    const lg = prefix.length
    // Lists files in the bucket, filtered by a prefix
    // eslint-disable-next-line no-unused-vars
    const [files] = await this.bucket.getFiles({prefix})
    const lst = []
    files.forEach(file => {
      lst.push(file.name.substring(lg))
    }) 
    return lst
  }

  async listIds (org) {
    return new Promise((resolve, reject) => {
      const lg = org.length + 1
      const options = {
        prefix: org + '/',
        delimiter: '/',
        autoPaginate: false
      }
      this.bucket.getFiles(options, 
        (err, files, nextQuery, apiResponse) => {
          if (err) reject(err)
          const l = []
          const lst = apiResponse.prefixes
          if (lst) lst.forEach(p => {
            l.push(p.substring(lg, p.length - 1))
          })
          resolve(l)
        })
    })
  }

}
