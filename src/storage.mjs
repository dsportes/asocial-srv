import { writeFile, readFile } from 'node:fs/promises'
import { existsSync, unlinkSync, rmSync, readdirSync, mkdirSync } from 'node:fs'
import path from 'path'

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsCommand } from '@aws-sdk/client-s3'
import { /* getSignedUrl, */ S3RequestPresigner } from '@aws-sdk/s3-request-presigner'
import { createRequest } from '@aws-sdk/util-create-request'
import { Hash } from '@aws-sdk/hash-node'
import { formatUrl } from '@aws-sdk/util-format-url'

import { encode, decode } from '@msgpack/msgpack'

import { ctx } from './server.js'
import { Storage } from '@google-cloud/storage'

import { b64ToU8, u8ToB64, crypterSrv, decrypterSrv } from './util.mjs'

function serial (arg) { return Buffer.from(encode(arg)) }

function deserial (arg) { return decode(Buffer.from(arg)) }

function encode3 (org, id, idf) {
  const x = serial([org, id, idf])
  const y = crypterSrv(ctx.appKeyBin, x)
  const z = u8ToB64(y, true)
  return z
}

export function decode3 (arg) { // retourne [org, id, idf]
  return deserial(decrypterSrv(ctx.appKeyBin, b64ToU8(arg)))
}

function stream2buffer(stream) {
  return new Promise((resolve, reject) => {
    const _buf = []
    stream.on('data', (chunk) => _buf.push(chunk))
    stream.on('end', () => resolve(Buffer.concat(_buf)))
    stream.on('error', (err) => reject(err))
  })
}

/* FsProvider ********************************************************************/
export class FsProvider {
  constructor (config) {
    this.rootpath = config.rootpath
  }

  async ping() {
    const data = Buffer.from(new Date().toISOString())
    const p = path.resolve(this.rootpath, 'ping.txt')
    await writeFile(p, Buffer.from(data))
    return true
  }

  storageUrl (org, id, idf) {
    return ctx.rooturl + '/storage/' + encode3(org, id, idf)
  }

  getUrl (org, id, idf) { return this.storageUrl (org, id, idf) }

  putUrl (org, id, idf) { return this.storageUrl (org, id, idf) }

  async getFile (org, id, idf) {
    try {
      const p = path.resolve(this.rootpath, ''+org, ''+id, ''+idf)
      return await readFile(p)
    } catch (err) {
      ctx.logger.info(err.toString())
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
      ctx.logger.info(err.toString())
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
      ctx.logger.info(err.toString())
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
      ctx.logger.info(err.toString())
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
      ctx.logger.info(err.toString())
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
      ctx.logger.info(err.toString())
      throw err
    }
  }

}

/* S3Provider ********************************************************************/
export class S3Provider {
  constructor (config) {
    this.config = ctx.keys.s3_config
    this.s3 = new S3Client(this.config)
    this.config.sha256 = Hash.bind(null, 'sha256')
    this.signer = new S3RequestPresigner(this.config)
    this.bucketName = config.bucket
  }

  async ping () {
    const objectKey = '/ping.txt'
    const data = Buffer.from(new Date().toISOString())
    const bucketParams = { Bucket: this.bucketName, Key: objectKey, Body: data }
    const putCmd = new PutObjectCommand(bucketParams)
    await this.s3.send(putCmd)
    return true
  }

  async getUrl (org, id, idf) {
    const objectKey = '/' + org + '/' + id + '/' + idf
    const getCmd = new GetObjectCommand({ Bucket: this.bucketName, Key: objectKey })
    const getReq = await createRequest(this.s3, getCmd)
    // Append the port to generate a valid signature. // contournement de bug proposé par S3
    getReq.headers.host = `${ getReq.hostname }:${ getReq.port }`
    const url = await this.signer.presign(getReq)
    const getUrl = formatUrl(url)
    if (ctx.mondebug) ctx.logger.debug('getURL:' + getUrl)
    return getUrl
  }

  async putUrl (org, id, idf) {
    const objectKey = '/' + org + '/' + id + '/' + idf
    const putCmd = new PutObjectCommand({ Bucket: this.bucketName, Key: objectKey })
    // const putUrl = await getSignedUrl(s3, putCmd, { expiresIn: 3600 }) // KO : voir bug ci-dessus
    const putReq = await createRequest(this.s3, putCmd)
    // Append the port to generate a valid signature. // contournement de bug proposé par S3
    putReq.headers.host = `${ putReq.hostname }:${ putReq.port }`
    const url = await this.signer.presign(putReq)
    const putUrl = formatUrl(url)
    if (ctx.mondebug) ctx.logger.debug('putURL:' + putUrl)
    return putUrl
  }

  async getFile (org, id, idf) {
    try {
      const objectKey = '/' + org + '/' + id + '/' + idf
      const getCmd = new GetObjectCommand({ Bucket: this.bucketName, Key: objectKey })
      const res = await this.s3.send(getCmd)
      return await stream2buffer(res.Body)
    } catch (err) {
      ctx.logger.info(err.toString())
      return null
    }
  }

  async putFile (org, id, idf, data) {
    const objectKey = '/' + org + '/' + id + '/' + idf
    const bucketParams = { Bucket: this.bucketName, Key: objectKey, Body: data }
    const putCmd = new PutObjectCommand(bucketParams)
    await this.s3.send(putCmd)
  }

  async delFiles (org, id, lidf) {
    if (!lidf || !lidf.length) return
    try {
      for (let i = 0; i < lidf.length; i++) {
        const objectKey = '/' + org + '/' + id + '/' + lidf[i]
        const delCmd = new DeleteObjectCommand({ Bucket: this.bucketName, Key: objectKey })
        await this.s3.send(delCmd)
      }
    } catch (err) {
      ctx.logger.info(err.toString())
    }
  }

  async delId (org, id) {
    const pfx = org + '/' + (id === -1 ? '' : id + '/')
    const lst = []
    const bucketParams = { Bucket: this.bucketName, Prefix: pfx, Delimiter: '/', MaxKeys: 10000 }
    let truncated = true
    while (truncated) {
      const response = await this.s3.send(new ListObjectsCommand(bucketParams))
      if (response.Contents) response.Contents.forEach((item) => { lst.push(item.Key) })
      truncated = response.IsTruncated
      if (truncated) bucketParams.Marker = response.NextMarker
    }
    for (let i = 0; i < lst.length; i++) {
      const delCmd = new DeleteObjectCommand({ Bucket: this.bucketName, Key: lst[i] })
      await this.s3.send(delCmd)
    }
  }

  async delOrg (org) {
    await this.delId(org, -1)
  }

  async listFiles (org, id) {
    const lst = []
    const pfx = org + '/' + id + '/'
    const l = pfx.length
    const bucketParams = { Bucket: this.bucketName, Prefix: pfx, Delimiter: '/', MaxKeys: 10000 }
    let truncated = true
    while (truncated) {
      const response = await this.s3.send(new ListObjectsCommand(bucketParams))
      if (response.Contents) response.Contents.forEach((item) => {
        const s = item.Key
        const s2 = s.substring(l, s.length - 1)
        lst.push(s2)
      })
      truncated = response.IsTruncated
      if (truncated) bucketParams.Marker = response.NextMarker
    }
    return lst
  }

  async listIds (org) {
    const lst = []
    const l = (org + '/').length
    const bucketParams = { Bucket: this.bucketName, Prefix: org + '/', Delimiter: '/', MaxKeys: 10000 }
    let truncated = true
    while (truncated) {
      const response = await this.s3.send(new ListObjectsCommand(bucketParams))
      if (response.CommonPrefixes) response.CommonPrefixes.forEach((item) => {
        const s = item.Prefix
        const s2 = s.substring(l, s.length - 1)
        lst.push(s2)
      })
      truncated = response.IsTruncated
      if (truncated) bucketParams.Marker = response.NextMarker
    }
    return lst
  }

}

/* GcProvider ********************************************************************/
export class GcProvider {
  constructor (cfg) {
    // Imports the Google Cloud client library
    // const {Storage} = require('@google-cloud/storage')
    // For more information on ways to initialize Storage, please see
    // https://googleapis.dev/nodejs/storage/latest/Storage.html

    /*
    const opt = {
      projectId: ctx.config.projectId,
      credentials: ctx.config.service_account
    }
    this.bucket = new Storage(opt).bucket(c.bucket)
    */
    this.emulator = ctx['STORAGE_EMULATOR_HOST']
    this.bucket = new Storage().bucket(cfg.bucket)
    if (!this.emulator) {
      const cors = {
        // origin: ctx.config.origins2,
        origin: ['*'],
        method: ['GET', 'PUT'],
        responseHeader: ['Content-Type'],
        maxAgeSeconds: 3600
      }
      this.bucket.setCorsConfiguration([cors])
    } /* else {
      this.rootpath = cfg.rootpathEmulator
    } */
  }

  async ping () {
    const fileName = 'ping.txt'
    await this.bucket.file(fileName).save(Buffer.from(new Date().toISOString()))
    return true
  }

  storageUrl (org, id, idf) {
    return ctx.rooturl + '/storage/' + encode3(org, id, idf)
  }

  async getUrl (org, id, idf) {
    if (this.emulator) {
      const url = this.storageUrl (org, id, idf)
      // console.log(url)
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
    // console.log(url)
    return url
  }

  async putUrl (org, id, idf) {
    if (this.emulator) {
      const url = this.storageUrl (org, id, idf)
      // console.log(url)
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
    // console.log(url)
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
      ctx.logger.info(err.toString())
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
        ctx.logger.info(err.toString())
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
      lst.push(parseInt(file.name.substring(lg)))
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
            l.push(parseInt(p.substring(lg, p.length - 1)))
          })
          resolve(l)
        })
    })
  }

}
