import crypto from 'crypto'
import { encode, decode } from '@msgpack/msgpack'

import { toByteArray, fromByteArray } from './base64.mjs'
import { AppExc, A_SRV } from './api.mjs'
import { appKeyBin, config } from './config.mjs'

export function u8ToB64 (u8, url) {
  if (!u8 || !u8.length) return ''
  const s = fromByteArray(u8)
  return !url ? s : s.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

export function b64ToU8 (s) {
  if (!s || !s.length) return new Uint8Array(0)
  const diff = s.length % 4
  const x = !diff ? s : s + '===='.substring(0, 4 - diff)
  return Buffer.from(toByteArray(x.replace(/-/g, '+').replace(/_/g, '/')))
}

const IV = new Uint8Array([5, 255, 10, 250, 15, 245, 20, 240, 25, 235, 30, 230, 35, 225, 40, 220])

export function crypterSrv (k, buffer) {
  const b = buffer || new Uint16Array([])
  const cipher = crypto.createCipheriv('aes-256-cbc', k, IV)
  const x1 = cipher.update(b)
  const x2 = cipher.final()
  return Buffer.concat([x1, x2])
}

export function decrypterSrv (k, b) {
  const decipher = crypto.createDecipheriv('aes-256-cbc', k, IV)
  const x1 = decipher.update(b)
  const x2 = decipher.final()
  return Buffer.concat([x1, x2])
}
/*
export function crypterSrv (k, buffer) {
  const b = buffer || new Uint16Array([])
  const cipher = crypto.createCipheriv('aes-256-cbc', k, IV)
  const x0 = Buffer.from([k[0], k[1], k[2], k[3]])
  const x1 = cipher.update(b)
  const x2 = cipher.final()
  return Buffer.concat([x0, x1, x2])
}

export function decrypterSrv (k, b) {
  if (b[0] !== k[0] || b[1] !== k[1] || b[2] !== k[2] || b[3] !== k[3]) return b
  const decipher = crypto.createDecipheriv('aes-256-cbc', k, IV)
  const x1 = decipher.update(b.slice(4))
  const x2 = decipher.final()
  return Buffer.concat([x1, x2])
}
*/

const SALTS = new Array(256)

{
  const s = new Uint8Array([5, 255, 10, 250, 15, 245, 20, 240, 25, 235, 30, 230, 35, 225, 40, 220])
  SALTS[0] = s
  for (let i = 1; i < 256; i++) {
    const x = new Uint8Array(16)
    for (let j = 0; j < 16; j++) x[j] = (s[j] + i) % 256
    SALTS[i] = x
  }
}

/* Retourne le couple [hostname, port] d'une URL */
export function getHP (url) {
  let origin = url
  let i = origin.indexOf('://')
  if (i !== -1) origin = origin.substring(i + 3)
  i = origin.indexOf('/')
  if (i !== -1) origin = origin.substring(0, i)
  i = origin.indexOf(':')
  const hn = i === -1 ? origin : origin.substring(0, i)
  const po = i === -1 ? 0 : parseInt(origin.substring(i + 1))
  return [hn, po]
}

export function encode3 (org, id, idf) {
  const y = crypterSrv(appKeyBin('A'), Buffer.from(encode(([org, id, idf]))))
  const z = u8ToB64(y, true)
  return z
}

export function decode3 (arg) { // retourne [org, id, idf]
  return decode(Buffer.from((decrypterSrv(appKeyBin('A'), b64ToU8(arg)))))
}

export function eqU8 (a, b) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

export function sleep (delai) {
  if (delai <= 0) return
  return new Promise((resolve) => { setTimeout(() => resolve(), delai) })
}

export function quotes (v) {
  if (!v) return '""'
  const x = v.replaceAll('"', '_')
  return '"' + x + '"'
}

export function random (n) { return crypto.randomBytes(n) }

export function crypter (cle, u8, idxIV) { // u8: Buffer
  try {
    const hdr = !idxIV ? random(1) : new Uint8Array([idxIV])
    const nx = hdr[0]
    const iv = SALTS[nx]
    const cipher = crypto.createCipheriv('aes-256-cbc', cle, Buffer.from(iv))
    const x1 = cipher.update(u8)
    const x2 = cipher.final()
    const r = Buffer.concat([hdr, x1, x2])
    return r
  } catch (e) {
    throw new AppExc(A_SRV, 100, [e.toString()], e.stack)
  }
}

export function decrypter (cle, u8) { // u8: Buffer
  try {
    const n = u8[0]
    const iv = SALTS[n]
    const decipher = crypto.createDecipheriv('aes-256-cbc', cle, Buffer.from(iv))
    const x1 = decipher.update(u8.subarray(1) )
    const x2 = decipher.final()
    const r = Buffer.concat([x1, x2])
    return r
  } catch (e) {
    throw new AppExc(A_SRV, 100, [e.toString()], e.stack)
  }
}

export async function sendAlMail (site, org, to, sub, txt) {
  const s = '[' + site + '] '  + org + ' : ' + sub
  const url = config.alertes._url
  const pwd = config.alertes._pwd
  if (!url || !pwd) {
    config.logger.info('Simulation send mail. to:' + to + ' subject:' + s)
    return  
  }

  // Test avec le script server.php
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers:{
        'Content-Type': 'application/x-www-form-urlencoded'
      },    
      body: new URLSearchParams({ 
        mailer: 'A',
        mdp: pwd, 
        subject: s, 
        to, 
        text:  txt || '-'
      })
    })
    const t = await response.text()
    if (t.startsWith('OK'))
      config.logger.info('sendAlMail: [' + url + '] -  ' + t)
    else
      config.logger.error('sendAlMail: [' + url + '] -  ' + t)
  } catch (e) {
    config.logger.error('sendAlMail: [' + url + '] -  ' + e.toString())
  }
}

/*
export function sha256 (buffer) {
  return crypto.createHash('sha256').update(buffer).digest()
}
*/

/*
export function abToPem (ab, pubpriv) { // ArrayBuffer
  const s = fromByteArray(new Uint8Array(ab))
  let i = 0
  const a = ['-----BEGIN ' + pubpriv + ' KEY-----']
  while (i < s.length) {
    a.push(s.substring(i, i + 64))
    i += 64
  }
  a.push('-----END ' + pubpriv + ' KEY-----')
  return a.join('\n')
}

export function keyToU8 (pem, pubpriv) {
  const d = '-----BEGIN ' + pubpriv + ' KEY-----'
  const f = '-----END ' + pubpriv + ' KEY-----'
  const s = pem.substring(d.length, pem.length - f.length)
  return toByteArray(s.replace(/\n/g, ''))
}

export function crypterRSA (pub, u8) {
  try {
    const pubkey = abToPem(pub, 'PUBLIC')
    const r = crypto.publicEncrypt(
      {
        key: pubkey,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        // sha1 et non sha256 pour compatibilité avec window.crypto.subtle
        oaepHash: 'sha1' 
      },
      // We convert the data string to a buffer using `Buffer.from`
      Buffer.from(u8)
    )
    return r
  } catch (e) {
    throw new AppExc(A_SRV, 101, [e.toString()])
  }
}
*/

/* Cryptage générique d'un binaire lisible par connaissance,
- soit de la clé privée RSA de l'avatar
- soit de la clé du site avec comme IV les 16 premiers bytes de celle-ci.

- pub: clé publique RSA (en binaire)
- data: contenu binaire
- gz: true s'il faut compresser avant cryptage

Le binaire retourné a plusieurs parties:
- soit X le descriptif du cryptage:
  - 32 bytes: la clé AES générée
  - 16 bytes: l'IV utilisé
  - 1 byte: 1 si gz
- soit p3 le cryptage de X par la clé du site avec comme IV les 16 premiers bytes de celle-ci.

- tranche p1: 256 bytes - cryptage RSA de X
- tranche p2: 1 byte - longueur de p3
- tranche p3:
- tranche p4: texte de data, gzippé ou non, crypté par la clé AES générée.

export function crypterRaw (k, pub, data, gz) {
  const aes = new Uint8Array(crypto.randomBytes(32))
  const g = new Uint8Array([gz ? 1 : 0])
  const x = Buffer.concat([Buffer.from(aes), Buffer.from(IV), Buffer.from(g)])

  const hdr = crypterRSA (pub, x)

  const IVX = new Uint8Array(Buffer.from(k).subarray(0, 16))
  const cipher1 = crypto.createCipheriv('aes-256-cbc', k, IVX)
  const k1 = cipher1.update(x)
  const k2 = cipher1.final()
  const k3 = Buffer.concat([k1, k2])
  const lk3 = Buffer.from(new Uint8Array([k3.length]))

  const b1 = Buffer.from(data)
  const b2 = gz ? deflateSync(b1) : b1
  const cipher2 = crypto.createCipheriv('aes-256-cbc', aes, IV)
  const x1 = cipher2.update(b2)
  const x2 = cipher2.final()
  const r = Buffer.concat([hdr, lk3, k3, x1, x2])
  return r
}

export function decrypterRaw (k, data) {
  if (!data) return null
  const bin = Buffer.from(data)
  const bk = Buffer.from(k)

  // const p1 = data.slice(0, 256)
  const p2 = new Uint8Array(bin.subarray(256, 257))[0]
  const p3 = bin.subarray(257, 257 + p2)
  const p4 = bin.subarray(257 + p2)

  if (!p4 || !p4.length) return new Uint8Array(0)

  const ivx = Buffer.from(bk.subarray(0, 16))
  const decipher1 = crypto.createDecipheriv('aes-256-cbc', bk, ivx)
  const x1 = decipher1.update(p3)
  const x2 = decipher1.final()
  const b3 = Buffer.concat([x1, x2])

  const aes = b3.subarray(0, 32)
  const iv = b3.subarray(32, 48)
  const gz = new Uint8Array(b3.subarray(48, 49))[0]

  const decipher2 = crypto.createDecipheriv('aes-256-cbc', aes, iv)
  const y1 = decipher2.update(p4)
  const y2 = decipher2.final()
  const r = Buffer.concat([y1, y2])

  if (!gz) return r
  return inflateSync(r)
}
*/
