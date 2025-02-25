import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, 
  ListObjectsCommand } from '@aws-sdk/client-s3'
import { /* getSignedUrl, */ S3RequestPresigner } from '@aws-sdk/s3-request-presigner'
import { createRequest } from '@aws-sdk/util-create-request'
import { Hash } from '@aws-sdk/hash-node'
import { formatUrl } from '@aws-sdk/util-format-url'

import { config } from './config.mjs'
import { GenStProvider } from './gendoc.mjs'
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
export class S3Provider extends GenStProvider {
  constructor (code, site) {
    super(code, site)

    // this.config = config.s3_config
    const kn = config[code].key
    this.config = config[kn]
    this.config.sha256 = Hash.bind(null, 'sha256')
    this.s3 = new S3Client(this.config)
    this.signer = new S3RequestPresigner(this.config)
    this.bucketName = config[code].bucket
  }

  async ping () {
    const objectKey = '/ping.txt'
    const data = Buffer.from(new Date().toISOString())
    const bucketParams = { Bucket: this.bucketName, Key: objectKey, Body: data }
    const putCmd = new PutObjectCommand(bucketParams)
    await this.s3.send(putCmd)
    return true
  }

  async getUrl (porg, pid, pidf) {
    const org = this.cryptedOrg(porg)
    const id = this.cryptedId(pid)
    const idf = this.cryptedIdf(pidf)
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

  async putUrl (porg, pid, pidf) {
    const org = this.cryptedOrg(porg)
    const id = this.cryptedId(pid)
    const idf = this.cryptedIdf(pidf)
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

  async getFile (porg, pid, pidf) {
    try {
      const org = this.cryptedOrg(porg)
      const id = this.cryptedId(pid)
      const idf = this.cryptedIdf(pidf)
      const objectKey = '/' + org + '/' + id + '/' + idf
      const getCmd = new GetObjectCommand({ Bucket: this.bucketName, Key: objectKey })
      const res = await this.s3.send(getCmd)
      return await stream2buffer(res.Body)
    } catch (err) {
      config.logger.info(err.toString())
      return null
    }
  }

  async putFile (porg, pid, pidf, data) {
    const org = this.cryptedOrg(porg)
    const id = this.cryptedId(pid)
    const idf = this.cryptedIdf(pidf)
    const objectKey = '/' + org + '/' + id + '/' + idf
    const bucketParams = { Bucket: this.bucketName, Key: objectKey, Body: data }
    const putCmd = new PutObjectCommand(bucketParams)
    await this.s3.send(putCmd)
  }

  async delFiles (porg, pid, lidf) {
    if (!lidf || !lidf.length) return
    try {
      const org = this.cryptedOrg(porg)
      const id = this.cryptedId(pid)
      for (let i = 0; i < lidf.length; i++) {
        const idf = this.cryptedIdf(lidf[i])
        const objectKey = '/' + org + '/' + id + '/' + idf
        const delCmd = new DeleteObjectCommand({ Bucket: this.bucketName, Key: objectKey })
        await this.s3.send(delCmd)
      }
    } catch (err) {
      config.logger.info(err.toString())
    }
  }

  async delId (porg, pid) {
    const org = this.cryptedOrg(porg)
    const id = this.cryptedId(pid)
    const pfx = org + '/' + id + '/'
    const lst = []
    const bucketParams = { Bucket: this.bucketName, Prefix: pfx, Delimiter: '/', MaxKeys: 10000 }
    let truncated = true
    while (truncated) {
      const response = await this.s3.send(new ListObjectsCommand(bucketParams))
      if (response.CommonPrefixes) response.CommonPrefixes.forEach((item) => { 
        lst.push(item.Prefix)
      })
      truncated = response.IsTruncated
      if (truncated) bucketParams.Marker = response.NextMarker
    }
    for (let i = 0; i < lst.length; i++) {
      const delCmd = new DeleteObjectCommand({ Bucket: this.bucketName, Key: lst[i] })
      await this.s3.send(delCmd)
    }
  }

  async delOrg (porg) {
    const org = this.cryptedOrg(porg)
    const pfx = org + '/'
    const lst = []
    /* ICI PAS DE Delimiter: '/'
    Sinon ça ne renvoie QUE le premier niveau en dessous
    (el l'occurrence la liste des Ids et de plus c'est
    récupéré dans response.CommonPrefixes et pas dans response.Contents)
    */
    const bucketParams = { Bucket: this.bucketName, Prefix: pfx, MaxKeys: 10000 }
    let truncated = true
    while (truncated) {
      const response = await this.s3.send(new ListObjectsCommand(bucketParams))
      if (response.Contents) response.Contents.forEach((item) => { 
        lst.push(item.Key) 
      })
      truncated = response.IsTruncated
      if (truncated) bucketParams.Marker = response.NextMarker
    }
    console.log(lst.length)
    for (let i = 0; i < lst.length; i++) {
      const delCmd = new DeleteObjectCommand({ Bucket: this.bucketName, Key: lst[i] })
      await this.s3.send(delCmd)
    }
  }

  async listFiles (porg, pid) {
    const org = this.cryptedOrg(porg)
    const id = this.cryptedId(pid)
    const lst = []
    const pfx = org + '/' + id + '/'
    const l = pfx.length
    /* ICI il y a Delimiter: '/'
    MAIS on comme c'est le dernier niveau on aurait pu s'en passer
    et lire la liste dans reponse.Contents */
    const bucketParams = { Bucket: this.bucketName, Prefix: pfx, Delimiter: '/', MaxKeys: 10000 }
    let truncated = true
    while (truncated) {
      const response = await this.s3.send(new ListObjectsCommand(bucketParams))
      if (response.CommonPrefixes) response.CommonPrefixes.forEach((item) => {
        const name = item.Prefix.substring(l)
        const dname = this.decryptedIdf(name)
        lst.push(dname) 
      })
      truncated = response.IsTruncated
      if (truncated) bucketParams.Marker = response.NextMarker
    }
    return lst
  }

  async listIds (porg) {
    const org = this.cryptedOrg(porg)
    const lst = []
    const l = (org + '/').length
    /* ICI il FAUT Delimiter: '/' */
    const bucketParams = { Bucket: this.bucketName, Prefix: org + '/', Delimiter: '/', MaxKeys: 10000 }
    let truncated = true
    while (truncated) {
      const response = await this.s3.send(new ListObjectsCommand(bucketParams))
      if (response.CommonPrefixes) response.CommonPrefixes.forEach((item) => {
        const s = item.Prefix
        const name = s.substring(l, s.length - 1)
        const dname = this.decryptedIdf(name)
        lst.push(dname) 
      })
      truncated = response.IsTruncated
      if (truncated) bucketParams.Marker = response.NextMarker
    }
    return lst
  }

}
