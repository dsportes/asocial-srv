import { encode, decode } from '@msgpack/msgpack'

export const version = '1'

export const d13 = 10 * 1000 * 1000 * 1000 * 1000
export const d14 = d13 * 10

export const interdits = '< > : " / \\ | ? *'
// eslint-disable-next-line no-control-regex
export const regInt = /[<>:"/\\|?*\x00-\x1F]/
// eslint-disable-next-line no-control-regex
export const regIntg = /[<>:"/\\|?*\x00-\x1F]/g
// eslint-disable-next-line no-control-regex
export const regInt2g = /[\u{0180}-\u{10FFFF}]/gu

export const limitesjour = { 
  dlv: 365, // résiliation automatique d'un compte non accédé
  margedlv: 30, // marge de purge des versions des comptes non accédés
  notetemp: 60, // durée de vie d'une note temporaire
  sponsoring: 14, // durée de vie d'un sponsoring
  groupenonheb: 120 // durée de vie d'un groupe non hébbergé
}

export function nomFichier (v) {
  if (!v) return ''
  return v.trim().replace(regIntg, '_').replace(regInt2g, '')
}

export const lcSynt = ['q1', 'q2', 'a1', 'a2', 'v1', 'v2', 'ntr1', 'ntr2', 'nbc', 'nbsp', 'nco1', 'nco2']

export class ID {
  /* Retourne l'id COURT depuis une id, longue ou courte, string ou number */
  static court (long) {
    if (!long) return 0
    const x = typeof long === 'string' ? parseInt(long) : long
    return x % d14
  }

  /* Retourne l'id LONG depuis,
  - un ns,
  - une id, longue ou courte, string ou number
  */
  static long (court, ns) { 
    return (ns * d14) + ID.court(court)
  }

  static estComptable (id) { return id % d13 === 0 }

  static estGroupe (id) { return Math.floor(id / d13) % 10 === 3 }

  static estTribu (id) { return Math.floor(id / d13) % 10 === 0 }

  static estAvatar (id) { return Math.floor(id / d13) % 10 < 3 }

  static ns (id) { return Math.floor(id / d14)}
}

export const UNITEV1 = 250000
export const UNITEV2 = 25000000
export const PINGTO = 60 // en secondes. valeur élevée en test

export const E_BRK = 1000 // Interruption volontaire de l'opération
export const E_WS = 2000 // Toutes erreurs de réseau
export const E_DB = 3000 // Toutes erreurs d'accès à la base locale
export const E_BRO = 4000 // Erreur inattendue trappée sur le browser
export const F_BRO = 5000 // Erreur fonctionnelle trappée sur le browser
export const A_BRO = 6000 // Situation inattendue : assertion trappée par le browser
export const E_SRV = 7000 // Erreur inattendue trappée sur le serveur
export const F_SRV = 8000 // Erreur fonctionnelle trappée sur le serveur
export const A_SRV = 9000 // Situation inattendue : assertion trappée sur le serveur

export class AppExc {
  constructor (majeur, mineur, args, stack) {
    this.name = 'AppExc'
    this.code = majeur + (mineur || 0)
    if (args) { this.args = args; this.message = JSON.stringify(args) }
    else { this.args = []; this.message = '???'}
    if (stack) this.stack = stack
  }

  get majeur () { return Math.floor(this.code / 1000) }

  toString () {
    return JSON.stringify(this)
  }
}

export function isAppExc (e) {
  return e && (typeof e === 'object') && (e.name === 'AppExc')
}

export function appexc (e, n) {
  if (isAppExc(e)) return e
  const m = e && e.message ? e.message : '???'
  const s = e && e.stack ? e.stack : ''
  return new AppExc(E_BRO, n || 0, [m], s)
}

/** Compteurs ***************************
- `j` : **date du dernier calcul enregistré** : par exemple le 17 Mai de l'année A
- **pour le mois en cours**, celui de la date ci-dessus :
  - `q1 q2`: quotas actuels.
  - `v1 v2 v1m v2m`: volume actuel des notes et moyens sur le mois en cours.
  - `trj` : transferts cumulés du jour.
  - `trm` : transferts cumulés du mois.
- `tr8` : log des volumes des transferts cumulés journaliers de pièces jointes 
  sur les 7 derniers jours + total (en tête) sur ces 7 jours.
- **pour les 12 mois antérieurs** `hist` (dans l'exemple ci-dessus Mai de A-1 à Avril de A),
  - `q1 q2` quotas q1 et q2 au dernier jour du mois.
  - `v1 v2` log des volumes moyens du mois (log de v1m v2m ci-dessus au dernier jour du mois)
  - `tr` log du total des transferts des pièces jointes dans le mois (log de trm à la fin du mois).
*/

const lch1 = ['v1', 'v1m', 'v2', 'v2m', 'q1', 'q2', 'trj', 'trm']
const NTRJ = 8

export class Compteurs {
  constructor (data) {
    const src = data ? decode(data) : null
    this.tr8 = new Array(NTRJ)
    this.tr8.fill(0, 0, NTRJ)
    this.hist = new Array(12)
    for (let i = 0; i < 12; i++) this.hist[i] = new Uint8Array([0, 0, 0, 0, 0])
    if (src) {
      this.j = src.j
      lch1.forEach(f => { this[f] = src[f] || 0 })
      if (src.tr8) for(let i = 0; i < NTRJ; i++) this.tr8[i] = src.tr8[i] || 0
      if (src.hist) for(let i = 0; i < 12; i++) {
        const h = src.hist[i] || new Uint8Array([0, 0, 0, 0, 0])
        for(let j = 0; j < 5; j++) this.hist[i][j] = h[j] || 0
      }
    } else {
      this.j = AMJ.amjUtc()
    }
    this.maj = false
    this.amj = AMJ.aaaammjj(this.j) // [aaaa, mm, jj] "avant"
    this.calculauj()
  }

  get serial () { // retourne un {...} contenant les champs (ce N'EST PAS un OBJET Compteurs)
    const c = { j: this.j, tr8: this.tr8, hist: this.hist }
    lch1.forEach(f => { c[f] = this[f] })
    return new Uint8Array(encode(c))
  }

  get volMoyTr7 () { return Math.round(pow(this.tr8[0]) / 7) }

  get volQ2 () { return this.q2 * UNITEV2 }

  setV1 (delta) {
    if (delta) {
      this.v1m = Math.round(((this.v1m * this.amj[2]) + delta) / this.amj[2])
      this.v1 = this.v1 + delta
      this.maj = true
    }
    return this.v1 <= this.q1 * UNITEV2
  }

  setV2 (delta) {
    if (delta) {
      this.v2m = Math.round(((this.v2m * this.amj[2]) + delta) / this.amj[2])
      this.v2 = this.v2 + delta
      this.maj = true
    }
    return this.v2 <= this.q2 * UNITEV2
  }

  setTr (delta) {
    if (delta) {
      this.trj += delta
      this.trm += delta
      this.maj = true
    }
  }

  setQ1 (q) {
    if (q !== this.q1) {
      this.q1 = q
      this.maj = true
    }
    return this.v1 <= this.q1 * UNITEV1
  }

  setQ2 (q) {
    if (q !== this.q2) {
      this.q2 = q
      this.maj = true
    }
    return this.v2 <= this.q2 * UNITEV2
  }

  shiftTr8 (nj) {
    if (nj >= NTRJ - 1) {
      this.tr8.fill(0, 0, NTRJ)
    } else {
      const a = new Array(NTRJ)
      a.fill(0, 0, NTRJ)
      let t = 0
      for(let i = nj + 1, j = 1; i < NTRJ; i++, j++) {
        a[j] = this.tr8[i]
        t += pow(a[j])
      }
      a[0] = log(t)
    }
  }

  calculauj () { // recalcul à aujourd'hui en fonction du dernier jour de calcul
    const dj = AMJ.amjUtc() // dj: entier aaaammjj
    if (dj === this.j) return // déjà normalisé, calculé aujourd'hui

    this.maj = true
    const [djaaa, djamm, djajj] = this.amj // "avant"
    const [djaa, djmm, djjj]  = AMJ.aaaammjj(dj) // "maintenant"

    // Dans tous les cas, shiftTr8
    const nj = AMJ.diff(dj, this.j)
    this.shiftTr8(nj) // shift de tr8

    if (djaaa === djaa && djamm === djmm) {
      // Dans le même mois : calcul des moyennes du mois
      this.v1m = Math.round(((this.v1m * djajj) + (this.v1 * (djjj - djajj))) / djjj)
      this.v2m = Math.round(((this.v2m * djajj) + (this.v2 * (djjj - djajj))) / djjj)
    } else {
      // Calcul de fin de mois du mois en cours : q1 q2 v1 v2 tr
      const nbjm = AMJ.djm(djaaa, djamm)
      const q1 = this.q1
      const q2 = this.q2
      const v1 = log(Math.round(((this.v1m * djajj) + (this.v1 * (nbjm - djajj))) / djajj))
      const v2 = log(Math.round(((this.v2m * djajj) + (this.v2 * (nbjm - djajj))) / djajj))
      const tr = log(this.trm)

      // Reset du mois en cours (q1 q2 v1 v2 v1m v2m sont inchangés)
      this.trj = 0
      this.trm = 0

      // Maj de hist du mois qui vient de se terminer: djaaa, djamm
      this.hist[djamm - 1] = new Uint8Array([q1, q2, v1, v2, tr])

      // Prolongation de cet historique (sauf tr) pour les mois suivants jusqu'à djaa, djmm exclus
      let a = djaaa, m = djamm
      // eslint-disable-next-line no-constant-condition
      while (true) {
        m++
        if (m === 13) { a++; m = 1 }
        if (a === djaa && m === djmm) break
        this.hist[m - 1] = new Uint8Array([q1, q2, v1, v2, 0])
      }
    }
    this.j = dj
    this.amj = [djaa, djmm, djjj]
  }
}

/* Une "amj" est un entier de la forme aaaammjj qui indique "un jour"
Le problème est que le même jour 2024-04-01 ne correspond pas un même instant,
- en "local à Tokyo"
- en "local à Paris"
- en UTC.
Ainsi "maintenant" doit être spécifié amjUtc() ou amjLoc() pour obtenir une amj :
- les valeurs seront différentes entre 0 et 2h du matin (UTC passe plus "tard" au jour suivant)

Une "amj" peut être interprtée comme Loc (locale) ou Utc, ce qu'il faut spécifier 
quand on l'utilise pour signifier un instant.
*/
export class AMJ {
  static get nbjm () { return [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] }

  // Dernier jour du mois M de l'année A
  static djm (a, m) { return (m === 2) && (a % 4 === 0) ? AMJ.nbjm[m] + 1 : AMJ.nbjm[m] }
  
  static zp (n) { return n > 9 ? '' + n: '0' + n }

  /* Retourne [a, m, j] depuis une amj */
  static aaaa (amj) { return Math.round(amj / 10000) }

  static mm (amj) { return Math.round((amj % 10000) / 100) }

  static jj (amj) { return amj % 100 }

  static aaaammjj (amj) { return [AMJ.aaaa(amj), AMJ.mm(amj), AMJ.jj(amj)] }
  
  /* Edite une amj avec des - séparateurs */
  static editDeAmj (amj, jma) { 
    if (!amj) return '?'
    const [a, m, j] = AMJ.aaaammjj(amj)
    return !jma ? ('' + a + '-' + AMJ.zp(m) + '-' + AMJ.zp(j)) :
      ('' + j + '/' + m + '/' + a)
  }
  
  /* Retourne une amj depuis une forme éditée 'aaaa-mm-jj' */
  static amjDeEdit (edit) { 
    const [a, m, j] = [ parseInt(edit.substring(0,4)), parseInt(edit.substring(5,7)), parseInt(edit.substring(8)) ]
    return (a * 10000) + (m * 100) + j
  }

  // epoch d'une amj représentant un jour local
  static tDeAmjLoc (amj) { const [a, m ,j] = AMJ.aaaammjj(amj); return new Date(a, m - 1, j).getTime() }
  
  // epoch d'une amj représentant un jour utc
  static tDeAmjUtc (amj) { const [a, m ,j] = AMJ.aaaammjj(amj); return Date.UTC(a, m - 1, j) }

  // Retourne l'amj locale d'une epoch
  static amjLocDeT (t) {
    const d = new Date(t); const [a, m, j] = [d.getFullYear(), d.getMonth() + 1, d.getDate()]
    return (a * 10000) + (m * 100) + j
  }

  // Retourne l'amj utc d'une epoch
  static amjUtcDeT (t) {
    const d = new Date(t); const [a, m, j] = [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()]
    return (a * 10000) + (m * 100) + j
  }

  // amj du jour actuel "local"
  static amjLoc () { return AMJ.amjLocDeT( Date.now() )}

  // amj du jour actuel "utc"
  static amjUtc () { return AMJ.amjUtcDeT( Date.now() )}

  // jour de la semaine de 1 (Lu) à 7 (Di) d'une amj locale
  static jDeAmjLoc (amj) { const d = new Date(AMJ.tDeAmjLoc(amj)); const j = d.getDay(); return j === 0 ? 7 : j }

  // jour de la semaine de 1 (Lu) à 7 (Di) d'une amj utc
  static jDeAmjUtc (amj) { const d = new Date(AMJ.tDeAmjUtc(amj)); const j = d.getDay(); return j === 0 ? 7 : j }

  // Retourne le nombre de jours entre 2 amj
  static diff (amj1, amj2) { return (AMJ.tDeAmjUtc(amj1) - AMJ.tDeAmjUtc(amj2)) / 86400000 }

  // Retourne l'amj + N jours (locale) de celle passée en argument
  static amjUtcPlusNbj(amj, nbj) {
    const d = new Date(AMJ.tDeAmjUtc(amj))
    return AMJ.amjUtcDeT(d.getTime() + (nbj * 86400000)) // OK parce que UTC
    // d.setDate(d.getDate() + nbj)
    // return AMJ.amjUtcDeT(d.getTime())
  }

  // Retourne l'amj + N jours (utc) de celle passée en argument
  static amjLocPlusNbj(amj, nbj) {
    const d = new Date(AMJ.tDeAmjLoc(amj))
    d.setDate(d.getDate() + nbj)
    return AMJ.amjLocDeT(d.getTime())
  }

  // Retourne l'amj de l'amj passée en argument + 1 mois (en restant dans les jours acceptables)
  static plusUnMois (amj) {
    const [a, m, j] = AMJ.aaaammjj(amj)
    if (m === 12) return ((a + 1) * 10000) + 100 + j
    const jm = AMJ.djm(a, m + 1)
    return (a * 10000) + ((m + 1) * 100) + (j < jm ? j : jm)
  }

  // Retourne l'amj de l'amj passée en argument - 1 mois (en restant dans les jours acceptables)
  static moinsUnMois (amj) {
    const [a, m, j] = AMJ.aaaammjj(amj)
    if (m === 1) return ((a - 1) * 10000) + 1200 + j
    const jm = AMJ.djm(a, m - 1)
    return (a * 10000) + ((m - 1) * 100) + (j < jm ? j : jm)
  }

  // Retourne l'amj du dernier jour du mois de celle passée en argument
  static djMois (amj) {
    const [a, m, ] = AMJ.aaaammjj(amj)
    return (a * 10000) + (m * 100) + AMJ.djm(a, m)
  }

  // Retourne l'amj du dernier jour du mois de celle passée en argument
  static pjMois (amj) {
    const [a, m, ] = AMJ.aaaammjj(amj)
    return (a * 10000) + (m * 100) + 1
  }

  // Retourne l'amj du dernier jour du mois de celle passée en argument
  static djMoisPrec (amj) {
    const [a, m, ] = AMJ.aaaammjj(amj)
    const [ap, mp] = m === 1 ? [a - 1, 12] : [a, m - 1]
    return (ap * 10000) + (mp * 100) + AMJ.djm(ap, mp)
  }

  // Retourne l'amj du dernier jour du mois de celle passée en argument
  static pjMoisSuiv (amj) {
    const [a, m, ] = AMJ.aaaammjj(amj)
    const [ap, mp] = m === 12 ? [a + 1, 1] : [a, m + 1]
    return (ap * 10000) + (mp * 100) + 1
  }

  // Retourne l'amj du dernier jour du mois de celle passée en argument
  static djAnnee (amj) {
    const [a, , ] = AMJ.aaaammjj(amj)
    return (a * 10000) + 1200 + 31
  }

  // Retourne l'amj du dernier jour du mois de celle passée en argument
  static pjAnnee (amj) {
    const [a, , ] = AMJ.aaaammjj(amj)
    return (a * 10000) + 100 + 1
  }

  // Retourne l'amj du dernier jour du mois de celle passée en argument
  static djAnneePrec (amj) {
    const [a, , ] = AMJ.aaaammjj(amj)
    return ((a - 1) * 10000) + 1200 + 31
  }

  // Retourne l'amj du dernier jour du mois de celle passée en argument
  static pjAnneeSuiv (amj) {
    const [a, , ] = AMJ.aaaammjj(amj)
    return ((a + 1) * 10000) + 100 + 1
  }
  
}

const K = 1000
const N = 20

export function log(v) {
  if (v === 0) return 0
  if (v <= 1000) return 1
  const x = Math.log10(v / K)
  return Math.round(x * N)
}

export function pow(l) {
  if (l === 0) return 0
  if (l === 1) return 1000
  const x = Math.pow(10, l / N)
  return Math.round(x * K)
}

export function edvol (vol) {
  const v = vol || 0
  if (v < 1000) return v + 'o'
  if (v < 1000000) return (v / 1000).toPrecision(3) + 'Ko'
  if (v < 1000000000) return (v / 1000000).toPrecision(3) + 'Mo'
  if (v < 1000000000000) return (v / 1000000000).toPrecision(3) + 'Go'
  if (v < 1000000000000000) return (v / 1000000000000).toPrecision(3) + 'To'
  return (v / 1000000000000000).toPrecision(3) + 'Po'
}
  
/* Tests
console.log(AMJ.amjLoc(), AMJ.amjUtc())

const t1 = Date.UTC(2023, 2, 2, 23, 30) // le 2 mars en UTC, le 3 mars en local
const t2 = new Date(2023, 2, 3, 0, 30).getTime() // le 2 mars en UTC, le 3 mars ebn local
console.log(AMJ.amjUtcDeT(t1), AMJ.amjLocDeT(t1))
console.log(AMJ.amjUtcDeT(t2), AMJ.amjLocDeT(t2))

const amj29f = 20240229
const amj1a = 20240401
console.log(AMJ.editDeAmj(amj29f))
console.log(AMJ.amjDeEdit('2024-02-29'))

const tl = AMJ.tDeAmjLoc(amj29f)
console.log(new Date(tl))
const tu = AMJ.tDeAmjUtc(amj29f)
console.log(tl, tu, (tl - tu) / 60000)
console.log(AMJ.jDeAmjLoc(amj29f), AMJ.amjLocDeT(tl), AMJ.amjUtcDeT(tl))

const x1 = AMJ.amjUtcPlusNbj(amj29f, 1)
console.log(x1)
console.log(AMJ.diff(x1, amj29f))
const x2 = AMJ.amjUtcPlusNbj(amj29f, 365)
console.log(x2)
console.log(AMJ.diff(x2, amj29f))
console.log(AMJ.amjUtcPlusNbj(amj1a, 365))

console.log(AMJ.djMois(amj29f), AMJ.pjMois(amj29f), AMJ.pjMoisSuiv(amj29f), AMJ.djMoisPrec(amj29f))
console.log(AMJ.djAnnee(amj29f), AMJ.pjAnnee(amj29f), AMJ.pjAnneeSuiv(amj29f), AMJ.djAnneePrec(amj29f))

const amj31j = 20230131
console.log(AMJ.plusUnMois(amj31j), AMJ.moinsUnMois(amj31j))
*/
