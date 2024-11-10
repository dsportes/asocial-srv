/* eslint-disable lines-between-class-members */
import { encode, decode } from '@msgpack/msgpack'
import { sha256 as jssha256 } from 'js-sha256'
import { fromByteArray } from './base64.mjs'
import { random } from './util.mjs'

export const APIVERSION = '1'

/** Cles **********************************************************************/
export class Cles {
  // Retourne un hash string sur 12c en base64 URL (sans = + /) d'un u8
  static hash9 (u8) {
    const x = new Uint8Array(jssha256.arrayBuffer(u8))
    const y = new Uint8Array(9)
    for(let i = 0; i < 9; i++) y[i] = (x[i] ^ x[i+9]) ^ x[x+18]
    const s = fromByteArray(y)
    return s.replace(/=/g, '').replace(/\+/g, '0').replace(/\//g, '1')
  }

  static ns = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'

  static nsToInt (ns) { return Cles.ns.indexOf(ns)}

  static espace() { const rnd = random(32); rnd[0] = 1; return rnd }
  static partition () { const rnd = random(32); rnd[0] = 2; return rnd }
  static comptable() { const rnd = new Uint8Array(32); rnd[0] = 3; return rnd }
  static avatar() { const rnd = random(32); rnd[0] = 3; return rnd }
  static groupe() { const rnd = random(32); rnd[0] = 4; return rnd }

  static id (cle) {
    const t = cle[0]
    if (t === 3) {
      let c = true
      for (let i = 1; i < 32; i++) if (cle[i] !== 0) { c = false; break }
      if (c) return ID.duComptable()
    }
    return t + Cles.hash9(cle).substring(1)
  }

  static lnoms = ['espaces', 'partitions', 'avatars', 'avatars', 'groupes', 'espaces']

  static nom (cle) { return Cles.lnoms[cle[0]] }
}

const p2 = [255, (256 ** 2) - 1, (256 ** 3) - 1, (256 ** 4) - 1, (256 ** 5) - 1, (256 ** 6) - 1, (256 ** 7) - 1]

/** ID **********************************************************************/
export class ID {
  static regid = new RegExp('^[0-9a-zA-Z]*$')

  static estID (id) { 
    if (typeof id !== 'string' || id.length !== 12) return false
    return ID.regid.test(id)
  }

  static type (id) { 
    return ID.estID(id) ? parseInt(id.charAt(0)) : -1
  }

  static rnd6 () {
    const u8 = random(6)
    let r = u8[0]
    for (let i = 5; i > 0; i--) r += u8[i] * (p2[i - 1] + 1)
    return r
  }

  static dunTicket (a, m) { /* Génère l'id d'un ticket: aa mm rrr rrr rrr*/
    const x1 = (((a % 100) * 100) + m)
    return '' + ((ID.rnd6() % d8) + (x1 * d8))
  }

  static duComptable () { return '300000000000' }
  static estPartition (id) { return id.charAt(0) === '2' }
  static estComptable (id) { return id === '300000000000' }
  static estAvatar (id) { return id.charAt(0) === '3' }
  static estGroupe (id) { return id.charAt(0) === '4' }
  static estNoteAv (id) { return id.charAt(0) === '5' }
  static estNoteGr (id) { return id.charAt(0) === '6' }
  static estNoteLoc (id) { return id.charAt(0) === '7' }
  static estFic (id) { return id.charAt(0) === '8' }

  static long (id, ns) { return ns + id}
  static court (id) { return id.substring(1)}
  static ns (id) { return id.substring(0, 1)}

  static rnd () {
    const s = fromByteArray(random(9))
    return s.replace(/=/g, '').replace(/\+/g, '0').replace(/\//g, '1')
  }

  static noteAv () { return '5' + ID.rnd().substring(1) }
  static noteGr () { return '6' + ID.rnd().substring(1) }
  static noteLoc () { return '7' + ID.rnd().substring(1) }
  static fic () { return '8' + ID.rnd().substring(1) }
}

export const HBINSECONDS = 20 // 120
export const ESPTO = 3 // en minutes : rechargement de la cache des espaces
export const DONCOMPTEO = 1

export const MSPARJOUR = 86400 * 1000
export const MSPARAN = 365 * MSPARJOUR
export const MSPARMOIS = 30 * MSPARJOUR
/* Nombre de jours sans connexion avant qu'une base locale 
ne soit considérée comme obsolète */
export const IDBOBS = 18 * 30
export const IDBOBSGC = 19 * 30

export const UNITEN = 250 // nombre de notes + chats + groupes
export const UNITEV = 100 * 1000 * 1000 // volume de fichiers
export const MAXTAILLEGROUPE = 100

export const limitesjour = { 
  sponsoring: 14, // durée de vie d'un sponsoring
  groupenonheb: 120 // durée de vie d'un groupe non hébbergé
}

// Nombre de mois de conservation en ligne des tickets
export const NBMOISENLIGNETKT = 3

// Liste des statistiques mensuelles et délai / mois courant
export const statistiques = { moisStat: 1, moisStatT: 3 }

/************************************************************************/
export const FLAGS = {
  AM: 1 << 0, // **a accès aux notes**: un membre _actif_ décide s'il souhaite ou non accéder aux notes (il faut qu'il en ait le _droit_): un non accès allège sa session.
  AN: 1 << 1, // **a accès aux membres**: un membre _actif_ décide s'il souhaite ou non accéder aux autres membres (il faut qu'il en ait le _droit_): un non accès allège sa session.
  DM: 1 << 2, // **droit d'accès à la liste des membres**: s'il est invité s'appliquera quand il sera actif.
  DN: 1 << 3, // **droit d'accès aux notes du groupe**:  s'il est invité s'appliquera quand il sera actif.
  DE: 1 << 4, // **droit d'écriture sur les notes du groupe**: s'il est invité s'appliquera quand il sera actif.
  HM: 1 << 5, // **a eu accès aux membres**
  HN: 1 << 6, // **a eu accès aux notes**
  HE: 1 << 7 // **a pu écrire des notes**
}

export const LFLAGS = [
  'a activé l\'accès aux membres', // AM
  'a activé l\'accès aux notes',  // AN
  'a accès de voir membres', // DM
  'a droit de voir les notes', // DN
  'a droit d\'éditer les notes', // DE
  'a pu voir les membres', // HM
  'a pu voir les notes', // HN
  'a pu éditer les notes' // HE
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

export class AL {
  static RAL1 = 1 << 0 // Ralentissement des opérations
  static RAL2 = 1 << 1 // Ralentissement max des opérations
  static NRED = 1 << 2 // Nombre de notes / chats /groupes en réduction
  static VRED = 1 << 3 // Volume de fichier en réduction
  static ARSN = 1 << 4 // Accès restreint par solde négatif
  static LSNTF = 1 << 5 // Lecture seule par notification de compte / partition
  static ARNTF = 1 << 6 // Accès restreint par notification pour compte O (actions d'urgence seulement)
  static FIGE = 1 << 7 // Espace figé en lecture

  static libs = ['RAL1', 'RAL2', 'NRED', 'VRED', 'ARSN', 'LSNTF', 'ARNTF', 'FIGE']

  // Le flag f a la valeur v (code ci-dessus)
  static has (f, v) { return f && v && (f << v) }

  // Ajouter la valeur v à f
  static add (f, v) { 
    if (f && v) f |= v
    return f
  }

  // Enlever la valeur v à f
  static del (f, v) {
    if (f && v) f &= ~v
    return f
  }

  static edit (f) {
    const s = []
    this.libs.forEach((l, i) => {
      const v = 1 << i
      if (f << v) s.push[l]
    })
    return s.join(' ')
  }
}

/************************************************************************/
/* retourne un code à 6 lettres majuscules depuis l'id d'un ticket 
id d'un ticket: aa mm rrr rrr rrr r 
*/
export const d8 = 100000000
export function idTkToL6 (tk) {
  const t = parseInt(tk)
  const am = Math.floor(t / d8)
  const m = am % 100
  const a = Math.floor(am / 100)
  let x = String.fromCharCode(a % 2 === 0 ? 64 + m : 76 + m)
  for (let i = 0, j = (t % d8); i < 5; i++) { x += String.fromCharCode(65 + (j % 26)); j = Math.floor(j / 26) }
  return x
}

/************************************************************************/
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
  static maxt = Date.parse('31 Dec 2099 23:59:59 UTC')
  static min = 20000101
  static mint = Date.parse('01 Jan 2000 00:00:00 UTC')
  
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
  static diff (amj1, amj2) { return (AMJ.tDeAmjUtc(amj1) - AMJ.tDeAmjUtc(amj2)) / MSPARJOUR }

  // Retourne l'amj + N jours de celle passée en argument
  static amjUtcPlusNbj(amj, nbj) {
    const d = new Date(AMJ.tDeAmjUtc(amj))
    const t = d.getTime() + (nbj * 86400000)
    return t >= AMJ.maxt ? AMJ.max : AMJ.amjUtcDeT(t) // OK parce que UTC
  }

  // Retourne l'amj + N jours de celle passée en argument
  static amjTPlusNbj(dh, nbj) {
    const t = dh + (nbj * MSPARJOUR)
    return t >= AMJ.maxt ? AMJ.max : AMJ.amjUtcDeT(t) // OK parce que UTC
  }
  
  // Retourne l'amj + N jours de celle passée en argument
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

  static nbMois (am1, am2) {
    const n1 = (Math.floor(am1 / 100) * 12) + (am1 % 100)
    const n2 = (Math.floor(am2 / 100) * 12) + (am2 % 100)
    return n1 - n2
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
  
  static am (t) { // retourne [aaaa, mm] d'une epoch
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
- `v`: volume effectif total des fichiers
- `cjm`: coût journalier moyen de calcul sur M et M-1.
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
  static QC = 0 // 0 quota de consommation
  static QN = 1 // 1 quota du nombre total de notes / chats / groupes.
  static QV = 2 // 2 quota du volume des fichiers.
  static NL = 0 // 3 nombre de lectures cumulées sur le mois.
  static NE = 1 // 4 nombre d'écritures.
  static VM = 2 // 5 volume _montant_ vers le Storage (upload).
  static VD = 3 // 6 volume _descendant_ du Storage (download).
  static NN = 0 // 7 nombre de notes existantes.
  static NC = 1 // 8 nombre de chats existants.
  static NG = 2 // 9 nombre de participations aux groupes existantes.
  static V = 3 // 10 volume effectif total des fichiers.
  static MS = Compteurs.X1 + Compteurs.X2 + Compteurs.X3 // 11 : nombre de ms dans le mois - si 0, le compte n'était pas créé
  static CA = Compteurs.MS + 1 // 12 : coût de l'abonnment pour le mois
  static CC = Compteurs.MS + 2 // 13 : coût de la consommation pour le mois

  static NBCD = Compteurs.X1 + Compteurs.X2 + Compteurs.X3 + Compteurs.X4

  static lp = ['dh0', 'dh', 'dhpc', 'estA', 'qv', 'solde', 'dhsn', 'vd', 'mm', 'aboma', 'consoma']
  static lqv = ['qc', 'qn', 'qv', 'nn', 'nc', 'ng', 'v']

  /* Propriétés stockées:
  dh0 : date-heure de création du compte
  dh : date-heure courante
  dhpc : dh de début de la dernière période de cumul abo / conso. (création ou changement O / A).
  estA : true si le compte est A.
  qv : quotas et volumes du dernier calcul `{ qc, qn, qv, nn, nc, ng, v, cjm }`.
    Quand on _prolonge_ l'état actuel pendant un certain temps AVANT d'appliquer de nouvelles valeurs,
    il faut pouvoir disposer de celles-ci.
  solde : en unité monétaire à dh.
  dhsn : date-heure de début de solde négatif dans le passé.
  vd : [0..3] - vecteurs détaillés pour M M-1 M-2 M-3.
  mm : [0..18] - coût abo + conso pour le mois M et les 17 mois antérieurs (si 0 pour un mois, le compte n'était pas créé)
  aboma : pour un compte A, somme des coûts d'abonnement des mois antérieurs au mois courant depuis la création du compte 
    OU le dernier passage A
  consoma : pour un compte A, somme des coûts consommation des mois antérieurs au mois courant depuis la création du compte
    OU le dernier passage A

  Propriéts calculées:
  cjm : consommation journalière moyenne estimée.
  njec` : nombre de jours estimés avant épuisement du crédit.
  cjAbo : coût journalier de l'abonnement actuel.
  resume` : propriétés de compteurs impactant les ralentissement / restrictions / dlv.

  Vecteur VD : pour chaque mois M à M-3, 14 (X1 + X2 + X3 + X4) compteurs:
  - X1 moyennes des quotas:
    - QC : moyenne de qc dans le mois (en c)
    - qn : moyenne de qn dans le mois (en nombre de documents)
    - qv : moyenne de qv dans le mois (en bytes)
  - X2 cumuls des consommations:
    - NL : nb lectures cumulés sur le mois (L),
    - NE : nb écritures cumulés sur le mois (E),
    - VM : total des transferts montants (B),
    - VD : total des transferts descendants (B).
  - X3 moyennes des compteurs:
    - NN : nombre moyen de notes existantes.
    - NC : nombre moyen de chats existants.
    - NG : nombre moyen de participations aux groupes existantes.
    - V : volume moyen effectif total des fichiers stockés.
  - X4 compteurs spéciaux
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
  - chgA: true devient A, false devient O, undefined inchangé.
  - dbcr: débit / crédit apporté au solde.
  - dh: normalement absent. Utilisé pour faire des tests indépendants de la date-heure courante.
  */
  constructor (serial, qv, conso, chgA, dbcr, dh) {
    this.now = dh || Date.now()
    if (this.now % MSPARJOUR === 0) this.now++
    if (serial) {
      const x = decode(serial)
      Compteurs.lp.forEach(p => { this[p] = x[p]})
      this.shift(this.now)
    } else { // création - Les quotas sont initialisés, les consommations et montants monétaires nuls
      this.dh0 = this.now
      this.dhpc = this.now
      this.estA = false
      this.solde = 0
      this.dhsn = 0
      this.qv = qv
      this.vd = new Array(Compteurs.NHD)
      for(let i = 0; i < Compteurs.NHD; i++) this.vd[i] = new Array(Compteurs.NBCD).fill(0)
      this.mm = new Array(Compteurs.NHM).fill(0)
      this.aboma = 0
      this.consoma = 0
    }
    this.dh = this.now // this.dh: date-heure de dernier calcul
    this.majCjm()
    this.majDhsn()
    // fin de réactualisation. Préparation début nouvelle situation
    if (qv) this.qv = qv // valeurs de quotas / volumes à partir de maintenant
    if (conso) this.majConso(conso)
    if (chgA !== undefined && chgA !== null && chgA !== this.estA) this.setA(chgA)
    if (dbcr) this.majsolde(dbcr)
  }

  get serial() {
    /* for (let i = 0; i < Compteurs.NHD; i++) {
        const v = this.vd[i]
        for (let j = 0; j < Compteurs.NBCD; j++) 
          if (isNaN(v[j])) throw new AppExc(A_SRV, 17, [i, j])
      } */
    const x = {}; Compteurs.lp.forEach(p => { x[p] = this[p]})
    return new Uint8Array(encode(x))
  }

  static CSVHDR (sep) {
    return ['QC', 'QN', 'QV', 'NL', 'NE', 'VM', 'VD', 
      'NN', 'NC', 'NG', 'V', 'NJ', 'CA', 'CC'].join(sep)
  }

  /* Cette méthode est invoquée par collNs en tant que 
  "processeur" de chaque row récupéré pour éviter son stockage en mémoire
  puis son traitement:
  - lignes : array de cumul des lignes générées.
  - mr : mois relatif
  - sep : séparateur CSV à utiliser
  - data : row sérialisé (non crypté) compta, contenant un champ compteurs (sérialisation des compteurs).
  */
  static CSV (lignes, mr, sep, data) {
    const dcomp = decode(data)
    const c = new Compteurs(dcomp.compteurs)
    const vx = c.vd[mr]
    const nj = Math.ceil(vx[Compteurs.MS] / 86400000)
    if (!nj) return
    
    const x1 = Compteurs.X1
    const x2 = Compteurs.X1 + Compteurs.X2
    const qc = Math.round(vx[Compteurs.QC])
    const qn = Math.round(vx[Compteurs.QN])
    const qv = Math.round(vx[Compteurs.QV])
    const nl = Math.round(vx[Compteurs.NL + x1])
    const ne = Math.round(vx[Compteurs.NE + x1])
    const vm = Math.round(vx[Compteurs.VM + x1])
    const vd = Math.round(vx[Compteurs.VD + x1])
    const nn = Math.round(vx[Compteurs.NN + x2])
    const nc = Math.round(vx[Compteurs.NC + x2])
    const ng = Math.round(vx[Compteurs.NG + x2])
    const v = Math.round(vx[Compteurs.V + x2])
    const ca = Math.round(vx[Compteurs.CA] * 100)
    const cc = Math.round(vx[Compteurs.CC] * 100)
    lignes.push([qc, qn, qv, nl, ne, vm, vd, nn, nc, ng, v, nj, ca, cc].join(sep))
  }

  /* nb de jours de la période de cumul abo+conso */
  get nbjCumref () { return (this.dh - this.dhpc) / MSPARJOUR }

  get cumulAbo () { return this.aboma + this.vd[0][Compteurs.CA] }

  get cumulConso () { return this.consoma + this.vd[0][Compteurs.CC] }

  get cumulCouts () { return this.cumulAbo + this.cumulConso }

  /* `cjm` : consommation journalière moyenne (en c) relevée sur le mois en cours et le précédent.
  */
  majCjm () {
    const nl = this.vd[0][Compteurs.X1 + Compteurs.NL] + this.vd[1][Compteurs.X1 + Compteurs.NL]
    const ne = this.vd[0][Compteurs.X1 + Compteurs.NN] + this.vd[1][Compteurs.X1 + Compteurs.NE]
    const vm = this.vd[0][Compteurs.X1 + Compteurs.VM] + this.vd[1][Compteurs.X1 + Compteurs.VM]
    const vd = this.vd[0][Compteurs.X1 + Compteurs.VD] + this.vd[1][Compteurs.X1 + Compteurs.VD]
    const [ac, mc] = AMJ.am(this.dh)
    const cu = Tarif.cu(ac, mc)
    let m = 0
    m += cu[Compteurs.CUCONSO + Compteurs.NL] * nl
    m += cu[Compteurs.CUCONSO + Compteurs.NE] * ne
    m += cu[Compteurs.CUCONSO + Compteurs.VM] * vm
    m += cu[Compteurs.CUCONSO + Compteurs.VD] * vd
    const ims = Compteurs.X1 + Compteurs.X2 + Compteurs.X3
    let ms = this.vd[0][ims] + this.vd[1][ims]
    if ((ms / MSPARJOUR) < 10) ms = 10 * MSPARJOUR
    this.qv.cjm = ms ? m / ms : 0
  }

  /* cjAbo : coût journalier de l'abonnement qv à la date dh*/
  cjAbo (qv, dh) {
    const [ac, mc] = AMJ.am(dh)
    const cu = Tarif.cu(ac, mc)
    let m = 0
    m += cu[Compteurs.QN] * qv.qn
    m += cu[Compteurs.QV] * qv.qv
    m += cu[Compteurs.QC] * qv.qc
    return m / 30
  }

  /* njec : nombre de jours estimés avant épuisement du crédit */
  get njec () {
    if (this.soldeCourant < 0) return 0
    const cj = this.cjAbo + this.cjm
    return Math.floor(this.soldeCourant / cj)
  }

  // Ajoute les flags à f ou à 0 si f absent: retourne f
  addFlags (f) {
    const n = this.qv.nn + this.qv.nc + this.qv.ng
    const x = f || 0
    const pcc = this.qv.qc ? Math.round( (this.qv.cjm * 30 * 100) / this.qv.qc) : 999
    if (pcc >= 100) AL.add(x, AL.RAL2) ; else if (pcc >= 80) AL.add(x, AL.RAL1)
    const pcn = this.qv.qn ? Math.round(n * 100 / UNITEN / this.qv.qn) : 999
    if (pcn >= 100) AL.add(x, AL.NRED)  
    const pcv = this.qv.qv ? Math.round(this.qv.v * 100 / UNITEV / this.qv.qv) : 999
    if (pcv >= 100) AL.add(x, AL.VRED)
    if (this.soldeCourant < 0) AL.add(x, AL.SN)
    return x
  }

  get flags () { return this.addFlags(0) }

  /* retourne true si le qv SSI a changé de manière significative par rapport à la valeur avant */
  deltaQV (av) {
    const ap = this.qv
    if (ap.qc !== av.qc || av.qn != ap.qn || av.qv !== ap.qv) return true
    function d5 (x) { 
      if ((av[x] && !ap[x]) || (!av[x] && ap[x])) return true
      let y = (av[x] - ap[x]) / av[x]; if (y < 0) y = -y
      return y > 1.05 || y < 0.95
    }
    return d5('nn') || d5('nc') || d5('ng') || d5('ng') || d5('v') || d5('cjm')
  }

  // Pour un compte A, le solde est amputé de la consommaton de la période référence
  // Pour un compte O, c'est le solde sans imputation compte "gratuit")
  get soldeCourant () { return this.solde -= (this.estA ? (this.aboma + this.consoma) : 0) }

  /* PRIVEE - Lors de la transition O <-> A : 
  raz des cumuls des abonnement / consommation des mois antérieurs */
  setA (estA) { 
    // le solde est "arrêté" au solde courant
    this.solde = this.soldeCourant
    this.estA = estA
    this.dhpc = this.dh
    this.aboma = 0
    this.consoma = 0
  }
  
  /* Date de début de solde négatif */
  majDhsn () {
    if (!this.estA) return // compte O : inchangée (gratuit)
    if (this.dhsn) return // était déjà négatif : inchangée
    if (this.soldeCourant >= 0) { 
      this.dhsn = 0
      return
    }
    const nbj = this.soldeCourant / this.cjAbo(this.qv, this.dh)
    this.dhsn = this.dh - (nbj * MSPARJOUR)
  }
  
  /* PRIVEE - Met à jour le solde et dhsn */
  majSolde (dbcr) {
    this.solde += dbcr || 0
    if (this.soldeCourant >= 0) {
      this.ddsn = 0
      return
    }
    // nouveau solde courant < 0
    if (this.dhsn) return // était négatif, l'est toujours, dh de sn inchangée
    this.dhsn = this.dh // était positif, devient négatif, dh de sn maintenant
  }

  /* PRIVEE - maj de la consommation */
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

  /* PRIVEE */
  deltam (ac, mc, a, m) { // nombre de mois entiers entre l'ancien mois courant [ac, mc] et le futur [a, m]
    let n = 0, ax = ac, mx = mc
    while(m !== mx || a !== ax) { 
      n++; mx++; 
      if (mx === 13) { mx = 1; ax++ } 
    }
    return n
  }

  /* PRIVEE */
  shift (t) {
    const [a, m, j] = AMJ.aaaammjj(AMJ.amjUtcDeT(t))
    const [ac, mc, jc] = AMJ.aaaammjj(AMJ.amjUtcDeT(this.dh))
    const [t0, avx, apx] = AMJ.t0avap(this.dh)
    if (a === ac && m === mc) { // le mois courant n'est pas fini
      const ap = t - this.dh // ap : temps restant entre dh et t
      // Si l'instant t est dans le mois de création, le nombre de ms AVANT dans le mois est moindre que avx
      const av = this.dh0 > t0 ? (this.dh - this.dh0) : avx 
      const v = this.calculMC(av, ap, this.vd[0], Tarif.cu(ac, mc))  
      this.mm[0] = v[Compteurs.CA] + v[Compteurs.CC] // le cout total du mois courant a changé
      this.vd[0] = v // le détail du mois courant a changé
      return
    }

    // le nouveau mois courant est un autre mois
    // on calcule les mois manquants entre l'ancien courant et le mois actuel
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

  /* PRIVEE */
  moy (av, ap, vav, vap) {
    return ((vav * av) + (vap * ap)) / (av + ap)
  }

  /* PRIVEE */
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

  /* PRIVEE */
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
    const z = c.cumref // [x, t, (this.dh - t) / MSPARJOUR]
    const ld = ['création', 'devenu A', 'devenu O'][z[0]] + 
    console.log('>> ' + (this.estA ? 'A' : 'O') + ' >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>')
    console.log('dh=' + new Date(c.dh).toISOString())
    console.log('dh0=' + new Date(c.dh0).toISOString())
    console.log('période ref: ' + new Date(z[1]).toISOString()) + ' *** ' 
      + ld + ' ' + z[2].toPrecision(2)
    console.log('flags: ' + AL.edit(this.flags))
    const p = `
  cumulCouts=${e6(c.cumulCouts)} cumulAbo=${e6(c.cumulAbo)} cumulConso=${e6(c.cumulConso)}
  aboma=${e6(c.aboma)} consoma=${e6(c.consoma)}
  QUOTAS -> qn=${c.qv.qn} qv=${c.qv.qn} qc=${c.qv.qn} 
  CPT -> N=${c.qv.nn + c.qv.nc + c.qv.ng} nn=${c.qv.nn} nc=${c.qv.nc} ng=${c.qv.ng} V=${e6(c.qv.v)} cjm*30= ${e6(c.qv.cjm * 30)} 
  njec= ${c.njec}`
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

/** DataSync ****************************************************/
export class DataSync {
  static vide = { vs: 0, vb: 0 }
  static videg = { id: '', vs: 0, vb: 0, ms: false, ns: false, m: false, n:false } 

  static deserial (serial) {
    const ds = new DataSync()
    const x = serial ? decode(serial) : {}
    ds.compte = x.compte || { ...DataSync.vide }
    ds.avatars = new Map()
    if (x.avatars) x.avatars.forEach(t => ds.avatars.set(t.id, t))
    ds.groupes = new Map()
    if (x.groupes) x.groupes.forEach(t => ds.groupes.set(t.id, t))
    return ds
  }

  serial () { // ns: donné côté serveur
    const x = {
      compte: this.compte || { ...DataSync.vide },
      avatars: [],
      groupes: []
    }
    if (this.avatars) this.avatars.forEach(t => x.avatars.push(t))
    if (this.groupes) this.groupes.forEach(t => x.groupes.push(t))
    return new Uint8Array(encode(x))
  }

  get estAJour() {
    if (this.compte.vs < this.compte.vb) return false
    for(const [,e] of this.avatars) if (e.vs < e.vb) return false
    for(const [,e] of this.groupes) if (e.vs < e.vb) return false
    return true
  }
}

/** Génération d'une synthèse d'une partition p **************************
Correspond à la ligne de la partition dans la synthèse de l'espace
*/
export function synthesesPartition (p) {
  const ntfp = [0,0,0]
  if (p.nrp) ntfp[p.nrp - 1] = 1
  const r = {
    id: p.id,
    ntfp: ntfp,
    q: { ...p.q },
    qt: { qc: 0, qn: 0, qv: 0, cjm: 0, n: 0, v: 0 },
    ntf: [0, 0, 0],
    nbc: 0,
    nbd: 0
  }
  for(const idx in p.mcpt) {
    if (idx === '0') continue
    const x = p.mcpt[idx]
    r.qt.qc += x.q.qc
    r.qt.qn += x.q.qn
    r.qt.qv += x.q.qv
    r.qt.cjm += x.q.cjm
    r.qt.n += x.q.nn + x.q.nc + x.q.ng
    r.qt.v += x.q.v
    if (x.notif && x.notif.nr) r.ntf[x.notif.nr - 1]++
    r.nbc++
    if (x.del) r.nbd++
  }
  r.pcac = !r.q.qc ? 0 : Math.round(r.qt.qc * 100 / r.q.qc) 
  r.pcan = !r.q.qn ? 0 : Math.round(r.qt.qn * 100 / r.q.qn) 
  r.pcav = !r.q.qv ? 0 : Math.round(r.qt.qv * 100 / r.q.qv) 
  r.pcc = !r.q.qc ? 0 : Math.round(r.qt.cjm * 30 * 100 / r.q.qc) 
  r.pcn = !r.q.qn ? 0 : Math.round(r.qt.n * 100 / (r.q.qn * UNITEN)) 
  r.pcv = !r.q.qv ? 0 : Math.round(r.qt.v * 100 / (r.q.qv * UNITEV)) 
  return r
}
