/* eslint-disable lines-between-class-members */
import { encode, decode } from '@msgpack/msgpack'
import { rnd6, random } from './util.mjs'

export const version = '1'

export const WSHEARTBEAT = false
export const PINGTO = 5 // en minutes : session auto close après PINGTO minutes d'inactivité
export const PINGTO2 = 4 // en minutes : rafraîchissement des compteurs de consommation

export const MSPARJOUR = 86400 * 1000
export const MSPARAN = 365 * MSPARJOUR
export const MSPARMOIS = 30 * MSPARJOUR
/* Nombre de jours sans connexion avant qu'une base locale 
ne soit considérée comme obsolète */
export const IDBOBS = 18 * 30
export const IDBOBSGC = 19 * 30

// Liste des statistiques mensuelles et délai / mois courant
export const statistiques = { moisStat: 1, moisStatT: 3 }

export const d13 = 10 * 1000 * 1000 * 1000 * 1000
export const d14 = d13 * 10
export const d10 = 10000000000

export const p2 = [255, (256 ** 2) - 1, (256 ** 3) - 1, (256 ** 4) - 1, (256 ** 5) - 1, (256 ** 6) - 1, (256 ** 7) - 1]

export const UNITEN = 250 // nombre de notes + chats + groupes
export const UNITEV = 100 * 1000 * 1000 // volume de fichiers

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

/************************************************************************/
export const FLAGS = {
  AC: 1 << 0, // **est _actif_**
  IN: 1 << 1, // **a une invitation en cours**
  AN: 1 << 2, // **a accès aux notes**: un membre _actif_ décide s'il souhaite ou non accéder aux notes (il faut qu'il en ait le _droit_): un non accès allège sa session.
  AM: 1 << 3, // **a accès aux membres**: un membre _actif_ décide s'il souhaite ou non accéder aux autres membres (il faut qu'il en ait le _droit_): un non accès allège sa session.
  DM: 1 << 4, // **droit d'accès à la liste des membres**: s'il est invité s'appliquera quand il sera actif.
  DN: 1 << 5, // **droit d'accès aux notes du groupe**:  s'il est invité s'appliquera quand il sera actif.
  DE: 1 << 6, // **droit d'écriture sur les notes du groupe**: s'il est invité s'appliquera quand il sera actif.
  PA: 1 << 7, // **pouvoir d'animateur du groupe**: s'il est invité s'appliquera quand il sera actif. _Remarque_: un animateur sans droit d'accès aux notes peut déclarer une invitation et être hébergeur.
  HA: 1 << 8, // **a été actif**
  HN: 1 << 9, // **a eu accès aux notes**
  HM: 1 << 10, // **a eu accès aux membres**
  HE: 1 << 11 // **a pu écrire des notes**
}

export const LFLAGS = [
  'est actif',
  'a une invitation en cours',
  'a accès aux notes', 
  'a accès aux membres',
  'a droit d\'accès à la liste des membres',
  'a droit d\'accès aux notes du groupe',
  'a droit d\'écriture sur les notes',
  'a pouvoir d\'animateur',
  'a été actif',
  'a eu accès aux notes',
  'a eu accès aux membres',
  'a pu écrire des notes'
]

// function t (intl) { return intl}

// t : pour intl passer $t
export function edit (n, t, sep) {
  const x = []
  for (let i = 0; i < LFLAGS.length; i++)
    if (n & (1 << i)) x.push(t ? t('FLAGS' + i) : LFLAGS[i])
  return x.join(sep || ', ')
}

export function flagListe (n) {
  const x = []
  for (let i = 0; i < LFLAGS.length; i++) if (n & (1 << i)) x.push(i)
  return x
}

/*
Ajouter un ou des flags: n |= FLAGS.HA | FLAGS.AC | FLAGS.IN
Enlever un ou des flags: n &= ~FLAGS.AC & ~FLAGS.IN
Toggle un ou des flags: n ^= FLAGS.HE ^ FLAGS.DN
*/

/************************************************************************/
/* retourne un code à 6 lettres majuscules depuis l'id d'un ticket 
id d'un ticket: aa mm rrr rrr rrr r 
*/
export function idTkToL6 (t) {
  const am = Math.floor(t / d10)
  const m = am % 100
  const a = Math.floor(am / 100)
  let x = String.fromCharCode(a % 2 === 0 ? 64 + m : 76 + m)
  for (let i = 0, j = (t % d10); i < 5; i++) { x += String.fromCharCode(65 + (j % 26)); j = Math.floor(j / 26) }
  return x
}

/************************************************************************/
export function nomFichier (v) {
  if (!v) return ''
  return v.trim().replace(regIntg, '_').replace(regInt2g, '')
}

/************************************************************************/
/* retourne un safe integer (53 bits) hash:
- d'un string
- d'un u8
*/
export function hash (arg) {
  const t = typeof arg
  const bin = t !== 'string'
  /* https://stackoverflow.com/questions/7616461/generate-a-hash-from-string-in-javascript
    Many of the answers here are the same String.hashCode hash function taken 
    from Java. It dates back to 1981 from Gosling Emacs, 
    is extremely weak, and makes zero sense performance-wise in
    modern JavaScript. 
    In fact, implementations could be significantly faster by using ES6 Math.imul,
    but no one took notice. 
    We can do much better than this, at essentially identical performance.
    Here's one I did—cyrb53, a simple but high quality 53-bit hash. 
    It's quite fast, provides very good* hash distribution,
    and because it outputs 53 bits, has significantly lower collision rates
    compared to any 32-bit hash.
    Also, you can ignore SA's CC license as it's public domain on my GitHub.
  */
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57
  for (let i = 0, ch; i < arg.length; i++) {
    ch = bin ? arg[i] : arg.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return 4294967296 * (2097151 & h2) + (h1 >>> 0)
}

/** Rds **********************************************************************/
export class Rds {
  static DOCS = ['', 'comptes', 'avatars', 'groupes']
  static COMPTE = 1
  static AVATAR = 2
  static GROUPE = 3

  static nouveau (type) { return (type * d13) + (rnd6() % d13) }

  static deId (id) { return id % d14 }

  static toId (rds, ns) { return (ns * d14) + rds }

  static type (rds) { return Math.floor((rds % d14) / d13)}

  static typeS (type) { return Rds.DOCS[type]}

}

/** Cles **********************************************************************/
export class Cles {
  /* Génération des clés pour les CCEP */

  /* idx : numéro de partition */
  static partition (idx) {
    const rnd = random(32)
    rnd[0] = 0
    rnd[1] = Math.floor(idx / 256)
    rnd[2] = idx % 256
    return rnd
  }

  static comptable() {
    const rnd = new Uint8Array(32)
    rnd[0] = 1
    return rnd
  }

  static avatar() {
    const rnd = random(32)
    rnd[0] = 2
    return rnd
  }

  static groupe() {
    const rnd = random(32)
    rnd[0] = 3
    return rnd
  }

  static espace() {
    const rnd = random(32)
    rnd[0] = 4
    return rnd
  }

  /* Retourne l'id courte ou longue depuis une clé */
  static id (cle, ns) {
    if (!cle) return 0
    let id = 0
    if (cle[0] === 0) id = (cle[1] * 256) + cle[2]
    else if (cle[0] !== 4) {
      let z = true; for (let i = 1; i < 32; i++) if(cle[i]) { z = false; break }
      const n = z ? 0 : (hash(cle) % d13)
      id = (cle[0] * d13) + n
    }
    return !ns ? id : ((ns * d14) + id)
  }

  static lnoms = ['partitions', 'avatars', 'avatars', 'groupes', 'espaces']

  static nom (cle) { return Cles.lnoms[cle[0]] }
}

/** ID **********************************************************************/
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
    const x = typeof court === 'string' ? parseInt(court) : court
    return x > d14 ? x : ((ns * d14) + x)
  }

  static duComptable (ns) { 
    return ((ns * 10) + 1) * d13
  }

  static estComptable (id) { return id % d13 === 0 }

  static estGroupe (id) { return Math.floor(id / d13) % 10 === 3 }

  static estPartition (id) { return Math.floor(id / d13) % 10 === 0 }

  static estAvatar (id) { return Math.floor(id / d13) % 10 < 3 }

  static ns (id) { return id < 100 ? id : Math.floor(id / d14)}
}

export const E_BRK = 1000 // Interruption volontaire de l'opération
export const E_WS = 2000 // Toutes erreurs de réseau
export const E_DB = 3000 // Toutes erreurs d'accès à la base locale
export const E_BRO = 4000 // Erreur inattendue trappée sur le browser
export const F_BRO = 5000 // Erreur fonctionnelle trappée sur le browser
export const A_BRO = 6000 // Situation inattendue : assertion trappée par le browser
export const E_SRV = 7000 // Erreur inattendue trappée sur le serveur
export const F_SRV = 8000 // Erreur fonctionnelle trappée sur le serveur
export const A_SRV = 9000 // Situation inattendue : assertion trappée sur le serveur

/************************************************************************/
export class AppExc {
  constructor (majeur, mineur, args, stack) {
    this.name = 'AppExc'
    this.code = majeur + (mineur || 0)
    if (args) { this.args = args; this.message = JSON.stringify(args) }
    else { this.args = []; this.message = '???'}
    if (stack) this.stack = stack
  }

  get majeur () { return Math.floor(this.code / 1000) }

  toString () { return JSON.stringify(this) }
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

/************************************************************************/
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
  static max = 20991231
  static min = 20000101
  
  static lx = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

  // Dernier jour du mois M de l'année A (nombre de jours du mois)
  static djm (a, m) { return (m === 2) && (a % 4 === 0) ? AMJ.lx[m] + 1 : AMJ.lx[m] }
  
  static zp (n) { return n > 9 ? '' + n: '0' + n }

  /* Retourne [a, m, j] depuis une amj */
  static aaaa (amj) { return Math.round(amj / 10000) }

  static mm (amj) { return Math.round((amj % 10000) / 100) }

  static jj (amj) { return amj % 100 }

  static aaaammjj (amj) { return [AMJ.aaaa(amj), AMJ.mm(amj), AMJ.jj(amj)] }

  static amjDeAMJ (a, m, j) { return (((a * 100) + m) * 100) + j}
  
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

  static moisPlus (am, n) {
    const a = Math.floor(am / 100)
    const m = am % 100
    let a2 = a
    let m2 = m + n
    while (m2 > 12) { a2++; m2 -= 12}
    return (a2 * 100) + m2
  }

  static moisMoins (am, n) {
    const a = Math.floor(am / 100)
    const m = am % 100
    let a2 = a
    let m2 = m - n
    while (m2 < 1) { a2--; m2 += 12}
    return (a2 * 100) + m2
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

  /* Retourne le "mois logique d'une dlv de compte":
  - dernier jour du mois d'une dlv si pas jour 1
  - si amj est un jour 1, retourne le dernier jour du mois précédent
  */
  static dlv (amj) {
    return amj % 100 === 1 ? AMJ.djMoisPrec(amj) : amj
  }

  // Retourne l'amj du premier jour du mois de celle passée en argument
  static pjMois (amj) {
    const [a, m, ] = AMJ.aaaammjj(amj)
    return (a * 10000) + (m * 100) + 1
  }

  // Retourne l'amj du dernier jour du mois précédent celle passée en argument
  static djMoisPrec (amj) {
    const [a, m, ] = AMJ.aaaammjj(amj)
    const [ap, mp] = m === 1 ? [a - 1, 12] : [a, m - 1]
    return (ap * 10000) + (mp * 100) + AMJ.djm(ap, mp)
  }

  // Retourne l'amj du dernier jour du mois M de amj, M -n ou M + n
  static djMoisN (amj, n) {
    if (n === 0) return AMJ.djMois(amj)
    let m = amj
    if (n < 0) for (let i = 0; i < -n; i++) m = AMJ.djMoisPrec(m)
    else for (let i = 0; i < n; i++) m = AMJ.djMoisSuiv(m)
    return m
  }

  // Retourne l'amj du dernier jour du mois suivant celle passée en argument
  static djMoisSuiv (amj) {
    const [a, m, ] = AMJ.aaaammjj(amj)
    const [as, ms] = m === 12 ? [a + 1, 1] : [a, m + 1]
    return (as * 10000) + (ms * 100) + AMJ.djm(as, ms)
  }
  
  // Retourne l'amj du premier jour du mois suivant celle passée en argument
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
  
  static am(t) { // retourne [aaaa, mm] d'une epoch
    const d = new Date(t); return [d.getUTCFullYear(), d.getUTCMonth() + 1]
  }

  static t0avap (t) { // t0 du début du mois, nombre de ms du début du mois à t, de t à la fin du mois
    const [a, m] = AMJ.am(t)
    const t0 = Date.UTC(a, m - 1, 1, 0, 0, 0) // t0 du début du mois
    // console.log(new Date(t0).toISOString())
    // console.log(new Date(t).toISOString())
    const a2 = m === 12 ? a + 1 : a
    const m2 = m === 12 ? 0 : m
    const t1 = Date.UTC(a2, m2, 1, 0, 0, 0) // t1 du premier du mois suivant
    // console.log(new Date(t1).toISOString())
    return [t0, t - t0, t1 - t]
  }

  static t0MoisM (a, m) {
    return Date.UTC(a, m - 1, 1, 0, 0, 0)
  }
}

export function edvol (vol, u) {
  const v = vol || 0
  if (v < 1000) return v + (u || 'o')
  if (v < 1000000) return (v / 1000).toPrecision(3) + 'K' + (u || 'o')
  if (v < 1000000000) return (v / 1000000).toPrecision(3) + 'M' + (u || 'o')
  if (v < 1000000000000) return (v / 1000000000).toPrecision(3) + 'G' + (u || 'o')
  if (v < 1000000000000000) return (v / 1000000000000).toPrecision(3) + 'T' + (u || 'o')
  return (v / 1000000000000000).toPrecision(3) + 'P' + (u || 'o')
}

/************************************************************************/
/* Un tarif correspond à,
- `am`: son premier mois d'application. Un tarif s'applique toujours au premier de son mois.
- `cu` : un tableau de 6 coûts unitaires `[u1, u2, ul, ue, um, ud]`
  - `u1`: abonnement mensuel en c à 250 notes / chats (250 = UNITEN)
  - `u2`: abonnement mensuel en c à 100Mo de fichiers (100Mo = UNITEV)
  - `ul`: 1 million de lectures en c
  - `ue`: 1 million d'écritures en c
  - `um`: 1 GB de transfert montant en c
  - `ud`: 1 GB de transfert descendant en c
- les coûts sont en centimes d'euros
*/
export class Tarif {
  static tarifs = [
    { am: 202201, cu: [0.45, 0.10, 80, 200, 15, 15] },
    { am: 202305, cu: [0.45, 0.10, 80, 200, 15, 15] },
    { am: 202309, cu: [0.45, 0.10, 80, 200, 15, 15] }
  ]

  static init(t) { Tarif.tarifs = t}

  static cu (a, m) {
    const am = (a * 100) + m
    const t = Tarif.tarifs
    if (am < t[0].am) return t[0].cu
    let cu; t.forEach(l => {if (am >= l.am) cu = l.cu})
    return cu
  }

  static evalConso (ca, dh) {
    const [a, m] = AMJ.am(dh || Date.now())
    const c = Tarif.cu(a, m)
    const x = [(ca.nl * c[2] / Compteurs.MEGA) 
      , (ca.ne * c[3] / Compteurs.MEGA) 
      , (ca.vm * c[4] / Compteurs.GIGA)
      , (ca.vd * c[5] / Compteurs.GIGA)]
    let t = 0
    x.forEach(i => { t += i })
    x.push(t)
    return x
  }
}

function e6 (x) {
  const s = '' + x
  const i = s.indexOf('.')
  if (i === -1) return s
  return s.substring(0, i + 1) + s.substring(i + 1, i + 7)
}

/** Compteurs **********************************************************************
Unités:
- T : temps.
- D : nombre de document (note, chat, participations à un groupe).
- B : byte.
- L : lecture d'un document.
- E : écriture d'un document.
- € : unité monétaire.

quotas et volumes `qv` : `{ qc, qn, qv, nn, nc, ng, v }`
- `qc`: limite de consommation
- `qn`: quota du nombre total de notes / chats / groupes.
- `qv`: quota du volume des fichiers.
- `nn`: nombre de notes existantes.
- `nc`: nombre de chats existants.
- `ng` : nombre de participations aux groupes existantes.
- `v`: volume effectif total des fichiers.
consommations `conso` : `{ nl, ne, vm, vd }`
- `nl`: nombre absolu de lectures depuis la création du compte.
- `ne`: nombre d'écritures.
- `vm`: volume _montant_ vers le Storage (upload).
- `vd`: volume _descendant_ du Storage (download).
*/
export class Compteurs {
  static VALIDMOYC = 86400 * 1000 * 7
  static MEGA = 1000000
  static GIGA = Compteurs.MEGA * 1000
  static COEFFCONSO = [Compteurs.MEGA, Compteurs.MEGA, Compteurs.GIGA, Compteurs.GIGA]

  static NHD = 4 // nombre de mois d'historique détaillé (dont le mois en cours)
  static NHM = 18 // nombre de mois d'historique des montants des coûts (dont le mois en cours)

  static X1 = 3 // nombre de compteurs de quotas (qc qn qv)
  static X2 = 4 // nombre de compteurs de consommation (lect, ecr, vm, vd)
  static X3 = 4 // nombre de compteurs de volume (notes, chats, groupes, v)
  static X4 = 3 // nombre de compteurs techniques (ms ca cc)

  static CUCONSO = Compteurs.X1 - 1 // indice du premier CU de consommation
  static QC = 0 // quota de consommation
  static QN = 1 // quota du nombre total de notes / chats / groupes.
  static QV = 2 // quota du volume des fichiers.
  static NL = 0 // nombre de lectures cumulées sur le mois.
  static NE = 1 // nombre d'écritures.
  static VM = 2 // volume _montant_ vers le Storage (upload).
  static VD = 3 // volume _descendant_ du Storage (download).
  static NN = 0 // nombre de notes existantes.
  static NC = 1 // nombre de chats existants.
  static NG = 2 // nombre de participations aux groupes existantes.
  static V = 3 // volume effectif total des fichiers.
  static MS = Compteurs.X1 + Compteurs.X2 + Compteurs.X3 // nombre de ms dans le mois - si 0, le compte n'était pas créé
  static CA = Compteurs.MS + 1 // coût de l'abonnment pour le mois
  static CC = Compteurs.MS + 2 // coût de la consommation pour le mois

  static NBCD = Compteurs.X1 + Compteurs.X2 + Compteurs.X3 + Compteurs.X4

  static lp = ['dh0', 'dh', 'dhraz', 'qv', 'vd', 'mm', 'aboma', 'consoma', 'dec', 'dhdec', 'njdec']
  static lqv = ['qc', 'qn', 'qv', 'nn', 'nc', 'ng', 'v']

  /*
  dh0 : date-heure de création du compte
  dh : date-heure courante
  dhraz: date-heure du dernier changement O / A
  qv : quotas et volumes du dernier calcul `{ qc, qn, qv, nn, nc, ng, v }`.
    Quand on _prolonge_ l'état actuel pendant un certain temps AVANT d'appliquer de nouvelles valeurs,
    il faut pouvoir disposer de celles-ci.
  vd : [0..3] - vecteurs détaillés pour M M-1 M-2 M-3.
  mm : [0..18] - coût abo + conso pour le mois M et les 17 mois antérieurs (si 0 pour un mois, le compte n'était pas créé)
  aboma : somme des coûts d'abonnement des mois antérieurs depuis la création du compte
  consoma : somme des coûts consommation des mois antérieurs depuis la création du compte

  Pour chaque mois M à M-3, il y a un **vecteur** de 14 (X1 + X2 + X3 + X4) compteurs:
  - X1_moyennes et X2 cumuls servent au calcul au montant du mois
    - QC : moyenne de qc dans le mois (€)
    - qn : moyenne de qn dans le mois (D)
    - qv : moyenne de qv dans le mois (B)
    - X1 + NL : nb lectures cumulés sur le mois (L),
    - X1 + NE : nb écritures cumulés sur le mois (E),
    - X1 + VM : total des transferts montants (B),
    - X1 + VD : total des transferts descendants (B).
  - X2 compteurs de _consommation moyenne sur le mois_ qui n'ont qu'une utilité documentaire.
    - X2 + NN : nombre moyen de notes existantes.
    - X2 + NC : nombre moyen de chats existants.
    - X2 + NG : nombre moyen de participations aux groupes existantes.
    - X2 + V : volume moyen effectif total des fichiers stockés.
  - 3 compteurs spéciaux
    - MS : nombre de ms dans le mois - si 0, le compte n'était pas créé
    - CA : coût de l'abonnement pour le mois
    - CC : coût de la consommation pour le mois
  */

  /*
  - serial : sérialisation de l'état antérieur, null pour une création (qv est alors requis)
  - qv: facultatif. compteurs de quotas et des nombres de notes, chats, groupes et v. 
    En cas de présence, mise à jour APRES recalcul à l'instant actuel.
  - conso: facultatif. compteurs de consommation à ajouter au mois courant.
    En cas de présence, ajouts APRES recalcul à l'instant actuel.
  - dh: normalement absent. Utilisé pour faire des tests indépendants de la date-heure courante.
  */
  constructor (serial, qv, conso, dh) {
    this.now = Date.now()
    const t = dh || this.now
    if (serial) {
      const x = decode(serial)
      Compteurs.lp.forEach(p => { this[p] = x[p]})
      this.shift(t)
      if (qv) this.qv = qv // valeurs de quotas / volumes à partir de maintenant
      if (conso) this.majConso(conso)
      /*
      if (this.dec) {
        if (this.dhdec + (MSPARJOUR * this.nbj) < t) {
          this.dhdec = 0; this.dec = 0; this.njdec = 0
        }
      }
      */
    } else { // création - Les quotas sont initialisés, les consommations et montants monétaires nuls
      this.dh0 = t
      this.dh = t
      this.dhraz = 0
      this.qv = qv
      this.vd = new Array(Compteurs.NHD)
      for(let i = 0; i < Compteurs.NHD; i++) this.vd[i] = new Array(Compteurs.NBCD).fill(0)
      this.mm = new Array(Compteurs.NHM).fill(0)
      this.aboma = 0
      this.consoma = 0
      // this.dhdec = 0
      // this.njdec = 0
      // this.dec = 0
    }
  }

  get serial() {
    const x = {}; Compteurs.lp.forEach(p => { x[p] = this[p]})
    return new Uint8Array(encode(x))
  }

  /* début de la période de référence [x, dh] : (compte O seulment)
  x: 0 -> création du compte
  x: 1 -> début du mois précédent
  x: 2 -> compte devient autonome
  x: 3 -> compte devient organisation
  */
  get debref () {
    let x = 0, t = 0
    const [a, m] = AMJ.am(this.dh)
    let ax = a, mx = m - 1
    if (mx === 0) { mx = 12; ax--}
    const tmp = AMJ.t0MoisM(ax, mx)
    if (this.dhraz && this.dhraz > tmp) {
      x = 3
      t = this.dhraz
    } else {
      if (tmp < this.dh0) { x = 0; t = this.dh0 }
      else { x = 1; t = tmp }
    }
    const r = [x, t, Math.floor((this.dh - t) / MSPARJOUR)]
    return r
  }

  /* période de cumul abo+conso [x, dh]
  x: 0 -> création du compte
  x: 2 -> compte devient autonome
  x: 3 -> compte devient organisation
  */
  get cumref () {
    const x = this.dhraz ? (this.estA ? 2 : 3) : 0
    const t = this.dhraz || this.dh0
    const r = [x, t, Math.floor((this.now - t) / MSPARJOUR)]
    return r
  }

  get estA () { return this.qv.qc === 0 }

  get cumulAbo () { 
    return this.aboma + this.vd[0][Compteurs.CA]
  }

  get cumulConso () { 
    return this.consoma + this.vd[0][Compteurs.CC]
  }

  get cumulCouts () { 
    return this.cumulAbo + this.cumulConso
  }

  /* Rythme MENSUEL (en fait 30 jours) de consommation sur les mois M et M-1
  - pour M le nombre de jours est le jour du mois, 
  - pour M-1 c'est le nombre de jours du mois.
  */
  get conso2M () {
    const [ac, mc] = AMJ.am(this.dh)
    const mja = AMJ.djm(mc === 1 ? ac - 1 : ac, mc === 1 ? 12 : mc - 1)
    return mc + mja === 0 ? 0 : (this.conso2B * 30 / (mc + mja))
  }

  get conso2B () {
    return this.vd[0][Compteurs.CC] + this.vd[1][Compteurs.CC]
  }

  /* Moyenne _mensualisée_ de la consommation sur le mois en cours et les 3 précédents
  Si le nombre de jours d'existence est inférieur à 30, retourne conso2M
  */
  get conso4M () {
    let c = 0, ms = 0
    for(let i = 0; i < Compteurs.NHD; i++) { 
      c += this.vd[i][Compteurs.CC]
      ms += this.vd[i][Compteurs.MS]
    }
    const nbj = Math.floor(ms / MSPARJOUR)
    return nbj < 30 ? this.conso2M : (c * 30 / nbj)
  }

  /* Moyenne _mensualisée_ de l'abonnement sur le mois en cours et les 3 précédents
  */
  get abo4M () {
    let ams = 0, ms = 0
    for(let i = 0; i < Compteurs.NHD; i++) { 
      ms += this.vd[i][Compteurs.MS]
      ams += (this.vd[i][Compteurs.CA] * ms )
    }
    if (ms === 0) {
      const [ac, mc] = AMJ.am(this.dh)
      const cu = Tarif.cu(ac, mc)
      return (this.qv.qn * cu[0]) + (this.qv.qv * cu[1])
    } else {
      return ams / ms * MSPARMOIS
    }
  }

  get n () { return this.qv.nn + this.qv.nc + this.qv.ng }

  get v () { return this.qv.v }

  /*
  pcc : consommation mensualisée sur M et M-1 / limite mensuelle qc
  pcn : nombre actuel de notes, chats, groupes / abonnement qn
  pcv : volume actuel des fichiers / abonnement qv
  max : max de pcc pcn pcv
  */
  get pourcents () {
    let pcc = 0
    if (this.qv.qc) {
      // c'est un compte O
      pcc = Math.round( (this.conso2M * 100) / this.qv.qc)
      if (pcc > 999) pcc = 999  
    }
    const pcn = Math.round(this.n * 100 / UNITEN / this.qv.qn)
    const pcv = Math.round(this.v * 100 / UNITEV / this.qv.qv)
    let max = pcc; if (pcn > max) max = pcn; if (pcv > max) max = pcv
    return {pcc, pcn, pcv, max}
  }

  get notifQ () { // notitication de dépassement de quotas
    const pcn = Math.round(this.n * 100 / UNITEN / this.qv.qn)
    const pcv = Math.round(this.v * 100 / UNITEV / this.qv.qv)
    const max = pcn > pcv ? pcn : pcv
    const ntf = { dh: this.dh }
    if (max >= 100) { ntf.nr = 2; ntf.texte = '%qv' }
    else if (max >= 90) { ntf.nr = 0; ntf.texte = '%Q0' }
    return ntf.texte ? ntf : null
  }
  
  get notifX () { // consommation excessive
    const ntf = { dh: this.dh }
    if (this.qv.qc) {
      const { pcc } = this.pourcents
      if (pcc >= 100) { ntf.nr = 2; ntf.texte = '%X2' }
      else if (pcc >= 90) { ntf.nr = 0; ntf.texte = '%X0' }
    }
    return ntf.texte ? ntf : null
  }

  /* Nombre de jours avant que le solde devienne négatif
  en prolongeant le coût d'abonnement et ceux de consommation sur les 4 derniers mois
  raz: true pour une mutation de compte O en A. Le nombre de jours
  ignore le coût antérieur accummulé.
  */
  nbj (credits, raz) {
    const solde = raz ? credits : (credits - this.cumulCouts)
    if (solde <= 0) return 0
    const [ac, mc] = AMJ.am(this.dh)
    const cu = Tarif.cu(ac, mc)
    const abo = (this.qv.qn * cu[0]) + (this.qv.qv * cu[1])
    return Math.floor(solde / (abo + this.conso4M) * 30)
  }

  notifS (credits) { // notification de dépassement des crédits
    const ntf = { dh: Date.now() }
    // const solde = credits + this.dec - this.cumulCouts
    const solde = credits - this.cumulCouts
    if (solde < 0) { ntf.nr = 2; ntf.texte = '%S2' }
    else {
      const nbj = this.nbj(credits)
      if (nbj < 60) {
        ntf.nr = 0
        ntf.texte = '%S0'
      }
    }
    return ntf.texte ? ntf : null
  }

  /* Lors de la transition O <-> A : raz abonnement / consommation des mois antérieurs */
  razma () {
    this.dhraz = Date.now()
    this.aboma = 0
    this.consoma = 0
    // this.dhdec = 0
    // this.njdec = 0
    // this.dec = 0
    return this
  }

  // Méthodes privées
  majConso (conso) { // { nl, ne, vm, vd }
    const [ac, mc] = AMJ.am(this.dh)
    const cu = Tarif.cu(ac, mc)
    const v = this.vd[0]
    let m = 0
    if (conso.nl) {
      v[Compteurs.X1 + Compteurs.NL] += conso.nl
      m += cu[Compteurs.CUCONSO + Compteurs.NL] * conso.nl / Compteurs.COEFFCONSO[Compteurs.NL]
    }
    if (conso.ne) {
      v[Compteurs.X1 + Compteurs.NE] += conso.ne
      m += cu[Compteurs.CUCONSO + Compteurs.NE] * conso.ne / Compteurs.COEFFCONSO[Compteurs.NE]
    }
    if (conso.vd) {
      v[Compteurs.X1 + Compteurs.VD] += conso.vd
      m += cu[Compteurs.CUCONSO + Compteurs.VD] * conso.vd / Compteurs.COEFFCONSO[Compteurs.VD]
    }
    if (conso.vm) {
      v[Compteurs.X1 + Compteurs.VM] += conso.vm
      m += cu[Compteurs.CUCONSO + Compteurs.VM] * conso.vm / Compteurs.COEFFCONSO[Compteurs.VM]
    }
    v[Compteurs.CC] += m
  }

  deltam (ac, mc, a, m) { // nombre de mois entiers entre l'ancien mois courant [ac, mc] et le futur [a, m]
    let n = 0, ax = ac, mx = mc
    while(m !== mx || a !== ax) { 
      n++; mx++; 
      if (mx === 13) { mx = 1; ax++ } 
    }
    return n
  }

  shift (t) {
    const [t0, avx, apx] = AMJ.t0avap(this.dh)
    if (t < t0 + avx + apx) {
      const [ac, mc] = AMJ.am(this.dh)
      // le mois courant n'est pas fini : il est prolongé.
      const ap = t - this.dh // ap : temps restant entre dh et t
      // Si l'instant t est dans le mois de création, le nombre de ms AVANT dans le mois est moindre qua avx
      const av = this.dh0 > t0 ? (this.dh - this.dh0) : avx 
      const v = this.calculMC(av, ap, this.vd[0], Tarif.cu(ac, mc))  
      this.mm[0] = v[Compteurs.CA] + v[Compteurs.CC] // le cout total du mois courant a changé
      this.vd[0] = v // le détail du mois courant a changé
      this.dh = t // la date-heure du dernier calcul a changé
      return
    }
    // le nouveau mois courant est un autre mois
    // on calcule les mois manquants entre l'ancien courant et le mois actuel
    const [a, m] = AMJ.am(t)
    const [ac, mc] = AMJ.am(this.dh)
    const n = this.deltam(ac, mc, a, m) // nombre de mois à créer et calculer (au moins 1, le futur courant)
    // init de la structure temporaire vd / mm
    const _vd = new Array(Compteurs.NHD)
    for(let i = 0; i < Compteurs.NHD; i++) _vd[i] = new Array(Compteurs.NBCD).fill(0)
    const _mm = new Array(Compteurs.NHM).fill(0)

    { 
      // Mois courant "nouveau"
      const [, msmois, ] = AMJ.t0avap(t) // nb de ms AVANT t
      const v = this.calculNM (Tarif.cu(a, m), msmois)
      _mm[0] = v[Compteurs.CA] + v[Compteurs.CC] // le cout total du mois courant a changé
      _vd[0] = v // le détail du mois courant a changé
    }

    let ax = ac; let mx = mc
    for(let i = 1; i < n; i++) {
      // Mois intermédiaires "nouveaux" à créer APRES le courant (créé ci-dessus) 
      // et AVANT l'ancien courant recalculé ci-dessous (qui devient antérieur)
      if (mx === 11) { ax++; mx = 1} else mx++
      const msmois = AMJ.djm(ax, mx) * MSPARJOUR // nombre de millisecondes du mois
      const v = this.calculNM (Tarif.cu(ax, mx), msmois)
      this.aboma += v[Compteurs.CA]
      this.consoma += v[Compteurs.CC]
      if (i < Compteurs.NHD) _vd[i] = v
      if (i < Compteurs.NHM) _mm[i] = v[Compteurs.CA] + v[Compteurs.CC] // le cout total du nouveau mois a été calculé
    }

    {
      // Recalcul de "l'ex" mois courant, prolongé jusqu'à sa fin et devenant antérieur
      // si c'était le mois de création, le nombre de ms AVANT n'est pas avx celui depuis le début du mois
      const av = this.dh0 > t0 ? (this.dh - this.dh0) : avx
      const v = this.calculMC(av, apx, this.vd[0], Tarif.cu(ac, mc))
      // le mois "ex" courant est dvenu antérieur
      this.aboma += v[Compteurs.CA] 
      this.consoma += v[Compteurs.CC]
      if (n < Compteurs.NHD) _vd[n] = v
      if (n < Compteurs.NHM) _mm[n] = v[Compteurs.CA] + v[Compteurs.CC] // le cout total de l'ex mois courant a été calculé
    }

    /* completer _vd si nécessaire. On a créé n mois. 
    - ajouter dans _vd les mois antérieurs dans la limite de NHD
    - ajouter dans _mm les mois antérieurs dans la limite de NHM
    */
    let mq = Compteurs.NHD - n - 1
    if (mq > 0) {
      for(let i = 0; i < mq; i++) _vd[n + 1 + i] = this.vd[i + 1]
    }
    mq = Compteurs.NHM - n - 1
    if (mq > 0) {
      for(let i = 0; i < mq; i++) _mm[n + 1 +i] = this.mm[i + 1]
    }
    this.vd = _vd
    this.mm = _mm
  }

  moy (av, ap, vav, vap) {
    return ((vav * av) + (vap * ap)) / (av + ap)
  }

  calculMC (av, ap, vmc, cu) { // calcul du mois courant par extension
    const v = new Array(Compteurs.NBCD).fill(0)
    v[Compteurs.MS] = av + ap // nombre de millisecondes du mois
    // Les compteurs sont des moyennes de quotas
    for(let i = 0; i < Compteurs.X1; i++)
      v[i] = this.moy(av, ap, vmc[i], this.qv[Compteurs.lqv[i]])
    // Les X2 suivants sont des cumuls de consommation
    for(let i = 0, j = Compteurs.X1; i < Compteurs.X2; i++, j++)
      v[j] = vmc[j]
    // Les X3 suivants sont des moyennes de volumes
    for(let i = 0, j = Compteurs.X1 + Compteurs.X2; i < Compteurs.X3; i++, j++) {
      const y = Compteurs.lqv[Compteurs.X1 + i]
      v[j] = this.moy(av, ap, vmc[j], this.qv[y])
    }
    // calcul du montant par multiplication par leur cout unitaire.
    // pour les "abonnements" qn et qv le cu est annuel: 
    // on le calcule au prorata des ms du mois / ms d'un an
    const px = v[Compteurs.MS] / MSPARAN
    for(let i = 1; i < Compteurs.X1; i++)
      v[Compteurs.CA] += v[i] * cu[i - 1] * px
    // pour les X2 suivants, coût unitaire est par Mega ou Giga
    for(let i = Compteurs.X1, c = 0; i < Compteurs.X1 + Compteurs.X2; i++, c++)
      v[Compteurs.CC] += v[i] * cu[Compteurs.CUCONSO + c] / Compteurs.COEFFCONSO[c]
    return v
  }

  calculNM (cu, msmois) { // calcul d'un nouveau mois ENTIER
    const v = new Array(Compteurs.NBCD).fill(0)
    v[Compteurs.MS] = msmois// nombre de millisecondes du mois
    // Les X1 premiers compteurs sont des quotas à initialiser
    for(let i = 0; i < Compteurs.X1; i++)
      v[i] = this.qv[Compteurs.lqv[i]]
    // Les X2 suivants sont des cumuls de consommation à mettre à 0
    for(let i = 0, j = Compteurs.X1; i < Compteurs.X2; i++, j++)
      v[j] = 0
    // Les X3 suivants sont des nombres de notes ... existantes
    for(let i = 0, j = Compteurs.X1 + Compteurs.X2; i < Compteurs.X3; i++, j++) {
      const y = Compteurs.lqv[Compteurs.X1 + i]
      v[j] = this.qv[y]
    }
    // Seuls qn et qv accroissent l'abonnement. Il n'y a pas de consommation
    for(let i = 0; i < Compteurs.X1; i++) {
      v[Compteurs.CA] += v[i] * cu[i] * (msmois / MSPARAN)
    }
    return v
  }

  printhdr () {
    const c = this
    console.log('>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>')
    console.log('dh =' + new Date(c.dh).toISOString())
    console.log('dh0=' + new Date(c.dh0).toISOString())
    const p = `
  cumulCouts=${e6(c.cumulCouts)}
  aboma=${e6(c.aboma)} consoma=${e6(c.consoma)}
  cumulAbo= ${e6(c.cumulAbo)} cumulConso= ${e6(c.cumulConso)}
  conso2M= ${e6(c.conso2M)}  conso4M= ${e6(c.conso4M)}`
    console.log(JSON.stringify(c.qv) + p)
  }
  
  printvd (n) {
    if (!this.vd[n][Compteurs.MS]) return
    const m = this.vd[n]
    const a = Compteurs.X1
    const b = a + Compteurs.X2
    const p = 
  `[${n}] abom=${e6(m[Compteurs.CA])}  consom=${e6(m[Compteurs.CC])}
    moy quotas: ${e6(m[Compteurs.QC])} ${e6(m[Compteurs.QN])} ${e6(m[Compteurs.QV])}
    conso:  nl=${m[a + Compteurs.NL]}  ne=${m[a + Compteurs.NE]}  vd=${m[a + Compteurs.VD]}  vm=${m[a + Compteurs.VM]}
    vols: nn=${e6(m[b + Compteurs.NN])}  nc=${e6(m[b + Compteurs.NC])}  ng=${e6(m[b + Compteurs.NG])}  v=${e6(m[b + Compteurs.V])}`
    console.log(p)
  }

  printmm () {
    const r = []
    for(let m = 0; m < this.mm.length; m++) { 
      const x = this.mm[m]
      if (x) r.push(`[${m}] ${e6(x)}`)
    }
    console.log('mm  ' + r.join(' | '))
  }

  print () {
    this.printhdr()
    for(let n = 0; n < Compteurs.NHD; n++) this.printvd(n)
    this.printmm()
    console.log('<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<')
  }
}

/** DataSync ****************************************************
sync : { id (long), rds (long), vs, vc, vb }
*/
export class DataSync {
  static vide = { id: 0, rds: 0, vs: 0, vb: 0 }
  static videg = { id: 0, rds: 0, vs: [0,0,0,0], vb: [0,0,0,0], m: false, n:false } 
  // vs / vb : versions [générale, groupe, membres, notes]

  static nouveau () {
    const x = {
      dh: 0,
      dhc: 0,
      compte: { ...DataSync.vide },
      avatars: [],
      groupes: []
    }
    return new DataSync(null, x)
  }

  /* Depuis, soit une sérialisation, soit un objet */
  constructor (serial, obj) {
    const x = obj || decode(serial)
    this.dh = x.dh || 0
    this.dhc = x.dhc || 0
    this.compte = x.compte || { ...DataSync.vide },
    this.avatars = new Map()
    if (x.avatars) x.avatars.forEach(t => this.avatars.set(t.id, t))
    this.groupes = new Map()
    if (x.groupes) x.groupes.forEach(t => this.groupes.set(t.id, t))
  }

  get serial () {
    const x = {
      dh: this.dh,
      dhc: this.dhc,
      compte: this.compte,
      avatars: [],
      groupes: []
    }
    this.avatars.forEach(t => x.avatars.push(t))
    this.groupes.forEach(t => x.groupes.push(t))
    return new Uint8Array(encode(x))
  }

  setAv (e) { this.avatars.set(e.id, e) }

  delAv (id) { this.avatars.delete(id) }

  setGr (e) { this.groupes.set(e.id, e) }

  delGr (id) { this.groupes.delete(id) }

  get grIdSet () { const s = new Set(); this.groupes.forEach(x => { s.add(x.id) }); return s}

  get avIdSet () { const s = new Set(); this.avatars.forEach(x => { s.add(x.id) }); return s}

  get tousRds () {
    const s = new Set()
    s.add(this.compte.rds)
    this.avatars.forEach(x => { s.add(x.rds) })
    this.groupes.forEach(x => { s.add(x.rds) })
    return s
  }

  /*
  idType (rds) {
    if (this.compte.rds === rds) return [this.compte.id, 'comptes']
    for(const [id, t] of this.avatars) if (t.rds === rds) return [id, 'avatars']
    for(const [id, t] of this.groupes) if (t.rds === rds) return [id, 'groupes']
    return [0, '']
  }

  rdsType (id) {
    if (this.espace.id === id) return [this.espace.rds, 'espaces']
    if (this.partition.id === id) return [this.partition.rds, 'partitions']
    if (this.compte.id === id) return [this.compte.rds, 'comptes']
    if (this.comptas.id === id) return [this.comptas.rds, 'comptas']
    let t = this.avatars.get(id)
    if (t) return [t.rds, 'avatars']
    t = this.groupes.get(id)
    if (t) return [t.rds, 'groupes']
    return [0, '']
  }
  */

  /* Tous les documents ont leurs versions de base égales aux versions de cohérence 
  get estCoherent () {
    if (!this.compte.vc || !this.compta.vc || !this.espace.vc) return false
    if (this.compte.vc !== this.compte.vb) return false
    if (this.compta.vc !== this.compta.vb) return false
    if (this.espace.vc !== this.espace.vb) return false
    if (this.partition.id && (this.partition.vc !== this.partition.vb)) return false
    for(const [, t] of this.avatars) if (t.vc && (t.vc !== t.vb)) return false
    for(const [, t] of this.groupes) if (t.vc && (t.vc !== t.vb[0])) return false
    return true
  }
  */

  /* Tous les documents ont leurs versions de session égales aux versions de base */
  get estComplet () {
    if (!this.compte.vb || this.compte.vs !== this.compte.vb) return false
    for(const [, t] of this.avatars) if (t.vc && (t.vs !== t.vb)) return false
    for(const [, t] of this.groupes) if (t.vc && !this.equal(t.vs, t.vb)) return false
    return true
  }
  
  equal (a, b) {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
    return true
  }
}

export const lcSynt = ['qc', 'qn', 'qv', 'ac', 'an', 'av', 'c', 'n', 'v', 'nbc', 'nbd', 'ntr0', 'ntr1', 'ntr2', 'nco0', 'nco1', 'nco2']

/** Génération d'une synthèse d'une partition p **************************
Correspond à la ligne de la partition dans la synthèse de l'espace
*/
export function synthesesPartition (p) {
  const r = { notif: p.notif, id: p.id }
  lcSynt.forEach(f => { r[f] = 0 })
  r.qc = p.qc
  r.qn = p.qn
  r.qv = p.qv
  r.ntr0 = p.notif && p.notif.nr === 0 ? 1 : 0
  r.ntr1 = p.notif && p.notif.nr === 1 ? 1 : 0
  r.ntr2 = p.notif && p.notif.nr === 2 ? 1 : 0
  p.tcpt.forEach(x => {
    if (x) {
      r.ac += x.q.qc
      r.an += x.q.qn
      r.av += x.q.qv
      r.c += x.q.c
      r.n += x.q.n
      r.v += x.q.v
      r.nbc++
      if (x.del) r.nbd++
      if (x.notif) {
        if (x.notif.nr === 0) r.nco0++
        else if (x.notif.nr === 1) r.nco1++
        else if (x.notif.nr === 2) r.nco2++
      }
    }
  })
  r.pcac = !r.qc ? 0 : Math.round(r.ac * 100 / r.qc) 
  r.pcan = !r.qn ? 0 : Math.round(r.an * 100 / r.qn) 
  r.pcav = !r.qv ? 0 : Math.round(r.av * 100 / r.qv) 
  r.pcc = !r.qc ? 0 : Math.round(r.c * 100 / r.qc) 
  r.pcn = !r.qn ? 0 : Math.round(r.n * 100 / r.qn) 
  r.pcv = !r.qv ? 0 : Math.round(r.v * 100 / r.qv) 
  return r
}
