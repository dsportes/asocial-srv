/*********************************************** 
IMPLEMENTATION de webcrypto.js EN UTILISANT NODE (crypto)
************************************************/
import crypto from 'crypto'

import { toByteArray, fromByteArray } from './base64.mjs'

export function u8ToInt (u8) {
  if (!u8 || !u8.length || u8.length > 8) return 0
  let r = 0
  for (let i = u8.length - 1; i > 0; i--) {
    r += u8[i] * (p2[i - 1] + 1)
  }
  r += u8[0]
  return r
}

const p2 = [255, (256 ** 2) - 1, (256 ** 3) - 1, (256 ** 4) - 1, (256 ** 5) - 1, (256 ** 6) - 1, (256 ** 7) - 1]
export function intToU8 (n) {
  if (n < 0) n = -n
  let l = 8
  for (let i = 6; i >= 0; i--, l--) if (n > p2[i]) break
  const u8 = new Uint8Array(l)
  for (let i = 0; i < 8; i++) {
    u8[i] = n % 256
    n = Math.floor(n / 256)
  }
  return u8
}

export function intToB64 (n) {
  return u8ToB64(intToU8(n), true)
}

export function b64ToInt (s) {
  return u8ToInt(b64ToU8(s, true))
}

export function idToSid (n) {
  return u8ToB64(intToU8(n), true)
}

export function sidToId (s) {
  return u8ToInt(b64ToU8(s, true))
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

export function sha256 (buffer) {
  return crypto.createHash('sha256').update(buffer).digest()
}

export function random (nbytes) { return crypto.randomBytes(nbytes) }

const CLE = new Uint8Array(32)
{
  const s = new Uint8Array([5, 255, 10, 250, 15, 245, 20, 240, 25, 235, 30, 230, 35, 225, 40, 220])
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 16; j++) CLE[i + j] = (s[j] + i) % 256
  }
}
const IV = CLE.slice(8, 24)

export function crypterSrv (buffer) {
  const cipher = crypto.createCipheriv('aes-256-cbc', CLE, IV)
  const x1 = cipher.update(buffer)
  const x2 = cipher.final()
  return Buffer.concat([x1, x2])
}

export function decrypterSrv (buffer) {
  const decipher = crypto.createDecipheriv('aes-256-cbc', CLE, IV)
  const x1 = decipher.update(buffer)
  const x2 = decipher.final()
  return Buffer.concat([x1, x2])
}

