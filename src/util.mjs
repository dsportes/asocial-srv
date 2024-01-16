import crypto from 'crypto'
import { deflateSync } from 'zlib'
import { toByteArray, fromByteArray } from './base64.mjs'
import { ctx } from './server.js'
import { AppExc, E_SRV } from './api.mjs'

export function sleep (delai) {
  if (delai <= 0) return
  return new Promise((resolve) => { setTimeout(() => resolve(), delai) })
}

const p2 = [255, (256 ** 2) - 1, (256 ** 3) - 1, (256 ** 4) - 1, (256 ** 5) - 1, (256 ** 6) - 1, (256 ** 7) - 1]
export function rnd6 () {
  const u8 = crypto.randomBytes(6)
  let r = u8[0]
  for (let i = 5; i > 0; i--) r += u8[i] * (p2[i - 1] + 1)
  return r
}

export function u8ToB64 (u8, url) {
  const s = fromByteArray(u8)
  if (!url) return s
  return s.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

export function b64ToU8 (s) {
  const diff = s.length % 4
  let x = s
  if (diff) {
    const pad = '===='.substring(0, 4 - diff)
    x = s + pad
  }
  return toByteArray(x.replace(/-/g, '+').replace(/_/g, '/'))
}

const IV = new Uint8Array([5, 255, 10, 250, 15, 245, 20, 240, 25, 235, 30, 230, 35, 225, 40, 220])

export function crypterSrv (buffer) {
  const k = ctx.config.app_key
  const cipher = crypto.createCipheriv('aes-256-cbc', k, IV)
  const x0 = Buffer.from([k[0], k[1], k[2], k[3]])
  const x1 = cipher.update(buffer)
  const x2 = cipher.final()
  return Buffer.concat([x0, x1, x2])
}

export function decrypterSrv (b) {
  const k = ctx.config.app_key
  if (b[0] !== k[0] || b[1] !== k[1] || b[2] !== k[2] || b[3] !== k[3]) return b
  const decipher = crypto.createDecipheriv('aes-256-cbc', k, IV)
  const x1 = decipher.update(b.slice(4))
  const x2 = decipher.final()
  return Buffer.concat([x1, x2])
}

/*
export function sha256 (buffer) {
  return crypto.createHash('sha256').update(buffer).digest()
}
*/

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
    throw new AppExc(E_SRV, 8, [e.toString()])
  }
}

/* Cryptage générique d'un binaire lisible par connaissance de la clé privée RSA:
- pub: clé publique RSA (en binaire)
- data: contenu binaire
- gz: true s'il faut compresser avant cryptage
Retourne un binaire dont,
- les 256 premiers bytes cryptent par la clé publique RSA: aes, iv, gz (0 /1)
  - 32 bytes - aes: clé AES unique générée, 
  - 16 bytes - iv: vecteur IV utilisé,
  - 1 byte - gz: 1 si gzippé, 0 sinon
- les suivants sont le texte de data, gzippé ou non, crypté par la clé AES générée.
*/
export function crypterRaw (pub, data, gz) {
  const aes = new Uint8Array(crypto.randomBytes(32))
  const g = new Uint8Array([gz ? 1 : 0])
  const x = Buffer.concat([Buffer.from(aes), Buffer.from(IV), Buffer.from(g)])
  const hdr = crypterRSA (pub, x)

  const b1 = Buffer.from(data)
  const b2 = gz ? deflateSync(b1) : b1
  const cipher = crypto.createCipheriv('aes-256-cbc', aes, IV)
  const x1 = cipher.update(b2)
  const x2 = cipher.final()

  return Buffer.concat([hdr, x1, x2])
}
