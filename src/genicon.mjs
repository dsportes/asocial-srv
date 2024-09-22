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
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(kx), Buffer.from(salt))
  return Buffer.concat([cipher.update(Buffer.from(u8)), cipher.final()])
}

function decrypter (u8) { // u8: Buffer
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(kx), Buffer.from(salt))
  return Buffer.concat([decipher.update(Buffer.from(u8)), decipher.final()])
}

export function obj2B64(obj) {
  const b = encode(obj)
  const s = fromByteArray(crypter(b))
  return s.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

export function b642Obj(b64) {
  const pad = '===='.substring(0, 4 - (b64.length % 4))
  const b = Buffer.from(toByteArray((b64 + pad).replace(/-/g, '+').replace(/_/g, '/')))
  return decode(decrypter(b))
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
