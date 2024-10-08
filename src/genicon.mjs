/*
Appel: node src/genicon.mjs
*/

import crypto from 'crypto'
import { encode, decode } from '@msgpack/msgpack'
import path from 'path'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { toByteArray, fromByteArray } from './base64.mjs'
import { argv } from 'node:process'

const kx = new Uint8Array(32)
for (let j = 0; j < 32; j++) kx[j] = j

const salt = new Uint8Array(16)
for (let j = 0; j < 16; j++) salt[j] = j + 47

function crypter (u8) { // u8: Buffer
  const x1 = Buffer.from(kx)
  const x2 = Buffer.from(salt)
  const cipher = crypto.createCipheriv('aes-256-cbc', x1, x2)
  const b1 = cipher.update(Buffer.from(u8))
  const b2 = cipher.final()
  return Buffer.concat([b1, b2])
}

function decrypter (u8) { // u8: Buffer
  const x1 = Buffer.from(kx)
  const x2 = Buffer.from(salt)
  const decipher = crypto.createDecipheriv('aes-256-cbc', x1, x2)
  const b1 = decipher.update(Buffer.from(u8))
  const b2 = decipher.final()
  return Buffer.concat([b1, b2])
}

export function obj2B64(obj) {
  const b = encode(obj)
  const cb = crypter(b)
  const s = fromByteArray(cb)
  const s2 = s.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  return s2
}

export function b642Obj(b64) {
  const l = b64.length % 4
  const pad = l ? '===='.substring(0, 4 - l) : ''
  const b = Buffer.from(toByteArray((b64 + pad).replace(/-/g, '+').replace(/_/g, '/')))
  const cb = decrypter(b)
  return decode(cb)
}

const x = argv[1]
if (x.endsWith('genicon.mjs')) {
  const pjson = path.resolve('./keys.json')
  if (!existsSync(pjson)) {
    console.log('fichier ./keys.json non trouvé')
  } else {
    try {
      const x = readFileSync(pjson)
      const js = JSON.parse(x)
      const t = obj2B64(js)
      const t2 = 'export const icon = \'' + t + '\'\n'
      const bout = Buffer.from(t2, 'utf-8')
      const pmjs = path.resolve('./src/icon.mjs')
      writeFileSync(pmjs, bout)
      console.log('OK')
    } catch (e) {
      console.log('fichier ./keys.json mal formé. ' + e.message)
    }
  }
}
