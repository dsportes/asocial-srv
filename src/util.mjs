import crypto from 'crypto'
import { toByteArray, fromByteArray } from './base64.mjs'
import { ctx } from './server.js'

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
