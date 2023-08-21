import { random /*, crypterSrv, decrypterSrv*/ } from './webcrypto.mjs'

export function sleep (delai) {
  if (delai <= 0) return
  return new Promise((resolve) => { setTimeout(() => resolve(), delai) })
}

const p2 = [255, (256 ** 2) - 1, (256 ** 3) - 1, (256 ** 4) - 1, (256 ** 5) - 1, (256 ** 6) - 1, (256 ** 7) - 1]
export function rnd6 () {
  const u8 = random(6)
  let r = u8[0]
  for (let i = 5; i > 0; i--) r += u8[i] * (p2[i - 1] + 1)
  return r
}

/* crypterFichier ******************************************************
export async function crypterFichier (infile, outfile) {
  const configjson = fs.readFileSync(path.resolve(infile))
  const crypt = await crypterSrv(configjson)
  fs.writeFileSync(path.resolve(outfile), crypt)

  const dcrypt = await decrypterSrv(crypt)
  const configjson2 = new TextDecoder().decode(dcrypt)
  if (configjson2 === configjson.toString()) console.log('OK')
}
*/
