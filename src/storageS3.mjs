import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsCommand } from '@aws-sdk/client-s3'
import { /* getSignedUrl, */ S3RequestPresigner } from '@aws-sdk/s3-request-presigner'
import { createRequest } from '@aws-sdk/util-create-request'
import { Hash } from '@aws-sdk/hash-node'
import { formatUrl } from '@aws-sdk/util-format-url'

import { config } from './config.mjs'
// import { s3_config } from './keys.mjs'

function stream2buffer(stream) {
  return new Promise((resolve, reject) => {
    const _buf = []
    stream.on('data', (chunk) => _buf.push(chunk))
    stream.on('end', () => resolve(Buffer.concat(_buf)))
    stream.on('error', (err) => reject(err))
  })
}

/* S3Provider ********************************************************************/
export class S3Provider {
  constructor (codeProvider) {
    this.config = config.s3_config
    this.config.sha256 = Hash.bind(null, 'sha256')
    this.s3 = new S3Client(this.config)
    this.signer = new S3RequestPresigner(this.config)
    this.bucketName = config[codeProvider].bucket
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
    if (config.mondebug) config.logger.debug('getURL:' + getUrl)
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
    if (config.mondebug) config.logger.debug('putURL:' + putUrl)
    return putUrl
  }

  async getFile (org, id, idf) {
    try {
      const objectKey = '/' + org + '/' + id + '/' + idf
      const getCmd = new GetObjectCommand({ Bucket: this.bucketName, Key: objectKey })
      const res = await this.s3.send(getCmd)
      return await stream2buffer(res.Body)
    } catch (err) {
      config.logger.info(err.toString())
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
      config.logger.info(err.toString())
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
