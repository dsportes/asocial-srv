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

  static duComptable (ns) { return (ns || '') + '300000000000' }
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

export const MSPARJOUR = 86400 * 1000
export const MSPARAN = 365 * MSPARJOUR
export const MSPARMOIS = 30 * MSPARJOUR
/* Nombre de jours sans connexion avant qu'une base locale 
ne soit considérée comme obsolète */
export const IDBOBS = 18 * 30
export const IDBOBSGC = 19 * 30

export const UNITEN = 100 // nombre de notes + chats + groupes
export const UNITEV = 100 * 1000 * 1000 // volume de fichiers
export const UNITEIO = 100 * 1000 // unité de lecture / écriture
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
  // Source: compta.compteurs
  static RAL = 1 << 1 // Ralentissement des opérations
  static NRED = 1 << 2 // Nombre de notes / chats /groupes en réduction
  static VRED = 1 << 3 // Volume de fichier en réduction
  static ARSN = 1 << 4 // Accès restreint par solde négatif
  // Source: notif compte OU notif partition dans espace
  static LSNTF = 1 << 5 // Lecture seule par notification de compte / partition
  static ARNTF = 1 << 6 // Accès restreint par notification pour compte O (actions d'urgence seulement)
  // Source: espace
  static FIGE = 1 << 7 // Espace figé en lecture

  static libs = ['RAL', 'NRED', 'VRED', 'ARSN', 'LSNTF', 'ARNTF', 'FIGE']

  // Le flag f a la valeur v (code ci-dessus)
  static has (f, v) { return f && v && (f & v) }

  // Ajouter la valeur v à f
  static add (f, v) { 
    if (v) f |= v
    return f
  }

  // Enlever la valeur v à f
  static del (f, v) {
    if (v) f &= ~v
    return f
  }

  static edit (f) {
    if (!f) return ''
    const s = []
    this.libs.forEach((l, i) => {
      if (f & (1 << i)) s.push(l)
    })
    return s.join(' ')
  }

  static fl2array (f) {
    const s = new Array(7)
    this.libs.forEach((l, i) => { s[i] = (f & (1 << i)) ? true : false })
    return s 
  }

  /* Taux de ralentissement: pourcentage (de 0 à 100) de **dépassement** d'un quota de calcul au delà de 100 
  S'applique à tous les "qv", de compta comme de compte */
  static txRal (qv) { 
    const pcc = qv.qc ? Math.round( (qv.cjm * 30 * 100) / qv.qc) : 999
    return pcc < 100 ? 0 : (pcc >= 200 ? 100 : (pcc - 100))
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

  // Retourne l'amj utc d'une epoch
  static aaaammjjDeT (t) {
    const d = new Date(t || Date.now())
    return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()]
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

/************************************************************************/
export const lqv = ['qn', 'qv', 'qc', 'nn', 'nc', 'ng', 'v', 'cjm']
export const qv0 = { qc: 0, qn: 0, qv: 0, nn: 0, nc: 0, ng: 0, v: 0, cjm: 0 }
export function assertQv (qv, src) {
  let c = ''
  let x = 'QV'
  if (qv === 'null') c = 'null'
  else if (qv === 'undefined') c = 'undefined'
  else if (typeof qv !== 'object') c = 'not-object'
  else {
    for (const f of lqv) {
      const v = qv[f]
      // if (f === 'cjm') console.log('cjm ', v)
      if (v === null) { c = 'null'; x = f; break }
      if (v === undefined) { c = 'undefined'; x = f; break }
      if (isNaN(v)) { 
        c = 'NaN'; x = f; break }
    }
  }
  if (c) {
    const y = x + '/' + c
    const msg = `ASSERT : ${src} - ${y} - 331`
    const t = new Date().toISOString()
    console.error(t + ' ' + msg)
    return new AppExc(A_SRV, 331, [src, x, c])
  }
}

/************************************************************************/
/* Un tarif correspond à,
- `am`: son premier mois d'application. Un tarif s'applique toujours au premier de son mois.
- `cu` : un tableau de 6 coûts unitaires `[u1, u2, ul, ue, um, ud]`
  - `u1`: abonnement mensuel en c à 100 notes / chats (100 = UNITEN)
  - `u2`: abonnement mensuel en c à 100Mo de fichiers (100Mo = UNITEV)
  - `ul`: UNITEIO de lectures en c
  - `ue`: UNITEIO d'écritures en c
  - `um`: UNITEV bytes de transfert montant en c
  - `ud`: UNITEV bytes de transfert descendant en c
- les coûts sont en centimes d'euros
*/
export class Tarif {
  static tarifs = [
    { am: 202401, cu: [0.45, 0.10, 8, 20, 15, 15] },
    { am: 202501, cu: [0.55, 0.15, 8, 18, 15, 15] },
    { am: 202506, cu: [0.65, 0.10, 8, 15, 15, 15] }
  ]

  static init(t) { Tarif.tarifs = t}

  static cu (a, m) {
    const am = (a * 100) + m
    const t = Tarif.tarifs
    if (am < t[0].am) return t[0].cu
    let cu; t.forEach(l => {if (am >= l.am) cu = l.cu})
    return cu
  }

  // abonnement à une ms de qn / qv dans le mois mm
  static cmsAbo (qn, qv, aaaa, mm) {
    const cu = Tarif.cu(aaaa, mm)
    return ((cu[0] * qn) + (cu[1] * qv)) / MSPARMOIS
  }

  // abonnement mensuel qn / qv aujourd'hui
  // [ total, AboN, AboV ]
  static abo (q) {
    const [aaaa, mm, jj] = AMJ.aaaammjjDeT()
    const cu = Tarif.cu(aaaa, mm)
    const n = (cu[0] * q.qn)
    const v = (cu[1] * q.qv)
    return [n + v, n, v]
  }
  
  static evalConso (ca, dh) { // ca: { nl, ne, vm, vd }
    return Tarif.evalConso2(ca, dh)[4]
  }

  static evalConso2 (ca, dh) { // ca: { nl, ne, vm, vd }
    const [a, m] = AMJ.am(dh || Date.now())
    const c = Tarif.cu(a, m)
    const x = [(ca.nl * c[2] / UNITEIO), (ca.ne * c[3] / UNITEIO), 
      (ca.vm * c[4] / UNITEV), (ca.vd * c[5] / UNITEV), 0]
    x[4] = x[0] + x[1] + x[2] + x[3]
    return x
  }

}

function e6 (x) {
  const s = '' + x
  const i = s.indexOf('.')
  if (i === -1) return s
  return s.substring(0, i + 1) + s.substring(i + 1, i + 7)
}

export const VMS = 0 
export const VQC = 1
export const VQN = 2 
export const VQV = 3 
export const VNL = 4 
export const VNE = 5 
export const VVM = 6
export const VVD = 7 
export const VNN = 8 
export const VNC = 9 
export const VNG = 10 
export const VV = 11 
export const VAC = 12
export const VAF = 13
export const VCC = 14
export const VCF = 15
export const VDB = 16
export const VCR = 17
export const VS = 18

/** Compteurs **********************************************************************
Unités:
- T : temps.
- D : nombre de document (note, chat, participations à un groupe).
- B : byte.
- L : lecture d'un document.
- E : écriture d'un document.
- € : unité monétaire.

quotas et volumes `qv` : `{ qc, qn, qv, nn, nc, ng, v, cjm }`
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

La structure est la suivante:
- `dh0` : date-heure de création du compte
- `dh` : date-heure de calcul actuelle
- `dhP` : date-heure de création ou de changement O <-> A (informative, n'intervient pas dans les calculs).
- `idp` : id de la partition pour un compte O.
- `qv` : quotas et volumes du dernier calcul `{ qc, qn, qv, nn, nc, ng, v, cjm }`.
- `ddsn` : date-heure de début de solde négatif.
- `vd` : [0..11] - vecteur détaillé pour les 12 mois de l'année (glissante)

Propriétés calculées:
- pcn : % dude qn utilisé
- pcv : % de qv utilisé
- pcc : % du cjm*30 à qc
- `cjm` : consommation moyenne de M M-1 ramenée à un jour.
- `njec` : nombre de jours estimés avant épuisement du crédit.
- `flags` : flags courants 
  - `RAL` : ralentissement (excès de calcul / quota)
  - `NRED` : documents en réduction (excès de nombre de documents / quota)
  - `VRED` : volume de fichiers en réduction (excès de volume / quota)
  - `ARSN` : accès restreint pour solde négatif
- `aaaa mm` : année / mois de dh.

**Vecteur `vd`** : pour chaque mois M de l'année glissante ([0] est janvier)
- MS 0 : nombre de ms dans le mois - si 0, le compte n'était pas créé
- moyennes des quotas:
  - QC 1 : moyenne de qc dans le mois (en c)
  - QN 2 : moyenne de qn dans le mois (en nombre de documents)
  - QV 3 : moyenne de qv dans le mois (en bytes)
- cumuls des consommations:
  - NL 4 : nb lectures cumulés sur le mois (L),
  - NE 5 : nb écritures cumulés sur le mois (E),
  - VM 6 : total des transferts montants (B),
  - VD 7 : total des transferts descendants (B).
- moyennes des compteurs:
  - NN 8 : nombre moyen de notes existantes.
  - NC 9 : nombre moyen de chats existants.
  - NG 10 : nombre moyen de participations aux groupes existantes.
  - V 11 : volume moyen effectif total des fichiers stockés.
- compteurs monétaires
  - AC 12 : coût de l'abonnement (dans le mois)
  - AF 13 : abonnement facturé (dans le mois)
  - CC 14 : coût de consommation (dans le mois)
  - CF 15 : consommation facturée (dans le mois)
  - DB 16 : débits du mois
  - CR 17 : crédits du mois
  - S 18 : solde au début du mois
  
Le solde en fin de mois est celui du début du mois suivant: S - DB + CR - CF - AF

Le principe de calcul est de partir avec la dernière photographie enregistrée à la date-heure `dh`.
- le calcul démarre _maintenant_ à la date-heure `now`.
- la première étape est d'établir le passé survenu entre `dh` et `now`: ce peut être quelques secondes comme 18 mois.
  - par principe aucun événement ne s'est produit entre ces deux instants, il s'agit donc de _prolonger_ l'état connu à `dh` jusqu'à `now`.
  - le mois M de la photo précédente à dh doit être prolonger, soit jusqu'à now, soit jusqu'à la fin du mois.
  - puis le cas échéant il _peut_ y avoir N mois entiers à prolonger dans l'état connu à fin M.
  - puis le cas échéant il _peut_ y avoir un dernier mois incomplet prolongeant le dernier calculé.

Quand on prolonge un mois selon les compteurs deux cas se présentent:
- soit c'est une addition : les nombres de lectures, écritures ... augmentent.
- soit c'est l'ajustement d'une _moyenne_ en fonction du nombre de millisecondes sur laquelle elle était calculée et celui sur laquelle elle est à prolonger.

Le calcul s'effectuant depuis le dernier mois calculé, mois par mois, le calcul peut s'effectuer sur plus de 12 mois, sachant que les onze derniers et le mois courant sont disponibles dans `vd`.

Après la phase de prolongation de dh à now, on met à jour le nouvel état courant:
- les compteurs qv peuvent être à mettre à jour,
- le statut O/A peut être à mettre à jour,
- une consommation peut être à enregistrer: c'est au cycle suivant qu'elle _coûtera_.

Le coût de calcul moyen sur M M-1 peut être effectué: 
si le nombre de ms de cette période est trop faible (moins de 10 jours) 
la moyenne peut être aberrante en survalorisant les opérations les plus récentes.
Cette moyenne considère qu'il y a toujours eu au moins 10 jours de vie, même si la création remonte à moins que cela.  
*/

export class Compteurs {
  static lp = ['dh0', 'dh', 'dhP', 'idp', 'qv', 'ddsn', 'vd']
  
  /*
  - serial : sérialisation de l'état antérieur, null pour une création (qv est alors requis)
  - qv: facultatif. compteurs de quotas et des nombres de notes, chats, groupes et v. 
    En cas de présence, mise à jour APRES recalcul à l'instant actuel.
  - conso: facultatif. compteurs de consommation à ajouter au mois courant.
  - idp: id de la partition O, '' si A.
  - dbcr: débit / crédit apporté au solde.
  - dh: normalement absent. Utilisé pour faire des tests indépendants de la date-heure courante.
  */
  constructor (serial, qv, conso, idp, dbcr, dh) {
    this.now = dh || Date.now()
    if (this.now % MSPARJOUR === 0) this.now++
    if (serial) {
      const x = decode(serial)
      Compteurs.lp.forEach(p => { this[p] = x[p]})
      const d = new Date(this.now)
      this.aaaa = d.getUTCFullYear()
      this.mm = d.getUTCMonth() + 1
      this.calculV()
      this.dh = this.now
    } else { // création - Les quotas sont initialisés, les consommations et montants monétaires nuls
      this.dh0 = this.now
      this.dhP = this.now
      this.dh = this.now // this.dh: date-heure de dernier calcul
      const d = new Date(this.dh)
      this.aaaa = d.getUTCFullYear()
      this.mm = d.getUTCMonth() + 1
      this.idp = ''
      this.ddsn = 0
      this.db = 0
      this.cr = 0
      this.qv = { ...qv0 }
      this.vd = new Array(12)
      for(let i = 0; i < 12; i++) this.vd[i] = new Array(VS + 1).fill(0)
      this.vd[this.mm - 1][VMS] = 1 // 1ms d'existence dans le mois
    }

    if (dbcr) {
      const v = this.vd[this.mm - 1]
      if (dbcr > 0) v[VCR] += dbcr; else v[VDB] -= dbcr
      const sc = this.soldeCourant
      if (sc >= 0) this.ddsn = 0
      else if (!this.ddsn) this.ddsn = this.dh // n'était pas négatif et maintenant l'est
      // si était négatif, inchangé
    }

    // fin de réactualisation. Préparation début nouvelle situation
    if (qv) this.qv = qv // valeurs de quotas / volumes à partir de maintenant

    if (idp !== undefined && idp !== null && idp !== this.idp) {
      this.idp = idp
      this.dhP = this.dh
    }

    const v = this.vd[this.mm - 1]

    if (conso) {
      v[VNL] += conso.nl
      v[VNE] += conso.ne
      v[VVD] += conso.vd
      v[VVM] += conso.vm
      const cout = Tarif.evalConso(conso, this.dh)
      v[VCC] += cout
      if (this.estA) v[VCF] += cout
    }

    // consommation moyenne journalière (en c) relevée sur le mois en cours et le précédent
    {
      const mp = this.mm === 1 ? 11 : this.mm - 2
      const vp = this.vd[mp]
      const ct = v[VCC] + vp[VCC]
      const nbj = (v[VMS] + vp[VMS]) / MSPARJOUR
      this.qv.cjm = ct / (nbj < 10 ? 10 : nbj)
      assertQv(this.qv, 'Calcul cjm')
    }
  }

  get estA () { return this.idp === ''}

  get serial() {
    assertQv(this.qv, 'serial')
    for (let m = 0; m < 12; m++) {
      const v = this.vd[m]
      for(let i = 0; i < 19; i++)
        if (isNaN(v[i]))
          throw new AppExc(A_SRV, 345, [m, i])
    }
    const x = {}; Compteurs.lp.forEach(p => { x[p] = this[p]})
    return new Uint8Array(encode(x))
  }

  get soldeCourant () { return this.soldeDeM(this.mm) }

  get pcn () { 
    const x = this.qv
    const n = x.nn + x.nc + x.ng
    if (x.qn === 0) return n > 0 ? 999 : 0
    return Math.round(n * 100 / (x.qn * UNITEN))
  }

  get pcv () { 
    const x = this.qv
    if (x.qv === 0) return x.v > 0 ? 999 : 0
    return Math.round(x.v * 100 / (x.qv * UNITEV))
  }

  get pcc () { 
    const x = this.qv
    const n = x.cjm * 30
    if (x.qc === 0) return n > 0 ? 999 : 0
    return Math.round(n * 100 / x.qc)
  }

  soldeDeM (m) {
    const vf = this.vd[m - 1]
    return vf[VS] - vf[VDB] + vf[VCR] - vf[VCF] - vf[VAF] // S - DB + CR - CF - AF
  }

  calculV () {
    const d = new Date(this.dh)
    const aaaa1 = d.getUTCFullYear()
    const mm1 = d.getUTCMonth() + 1
    if (aaaa1 === this.aaaa && mm1 === this.mm) this.prolongerM(this.aaaa, this.mm, this.now)
    else {
      // on termine le mois qui était en cours
      this.prolongerM(aaaa1, mm1, this.tfM(aaaa1, mm1))
      const vf = this.vd[mm1] // mois de dh fini
      let solde = this.soldeDeM(mm1)
      // insertion de N mois entiers
      let a = aaaa1, m = mm1
      while (true) {
        m++; if (m === 13) { m = 1; a++ }
        if (a === this.aaaa && m === this.mm) break
        solde = this.insererM(a, m, solde, this.tfM(a, m))
      }
      this.insererM(a, m, solde, this.now)
    }
  }

  insererM(a, m, solde, dhf) {
    const t0 = this.t0M(a, m)
    const q = this.qv
    const v = new Array(VS + 1).fill(0)
    this.vd[m - 1] = v
    v[VMS] = dhf - t0
    v[VQC] = q.qc
    v[VQN] = q.qn
    v[VQV] = q.qv
    v[VNN] = q.nn
    v[VNC] = q.nc
    v[VNG] = q.ng
    v[VV] = q.v
    const abo = Tarif.cmsAbo(q.qn, q.qv, a, m) * (dhf - t0)
    v[VAC] = abo 
    v[VCC] = 0
    v[VAF] = this.estA ? v[VAC] : 0
    v[VCF] = 0
    v[VS] = solde
    const soldeAp = this.soldeDeM(m)
    if (this.ddsn || soldeAp >= 0 ) return soldeAp // était déjà négatif au début du mois ou solde en fin positif
    const ms = Math.floor((v[VMS] * solde) / (solde - soldeAp)) // (soldeAp est < 0) - nombre de millis pour épuiser le solde initial
    this.ddsn = t0 + ms
    return soldeAp
  }

  t0M (a, m) { return Date.UTC(a, m - 1, 1) + 1 }

  tfM (a, m) { 
    let ax = a; let mx = m; if (mx === 12) { mx = 0; ax++ }
    const t = Date.UTC(ax, mx, 1) - 1
    const s = new Date(t).toISOString()
    return t // premier jour du mois suivant à minuit - 1ms
  }

  // m : indice mois, dhf: limite dans le mois
  prolongerM (a, m, dhf) {
    const t0 = this.t0M(a, m)
    const q = this.qv
    const v = this.vd[m - 1]
    const soldeCAv = this.soldeDeM(m) // solde courant AVANT
    const msav = v[VMS]
    const msap = this.dh0 <= t0 ? dhf - t0 : dhf - this.dh0
    if (msap <= 0) return
    const delta = msap - msav
    if (delta <= 0) return
    // Maj des quotas moyens au prorata de la prolongation
    v[VMS] = msap
    v[VQC] = ((v[VQC] * msav) + (q.qc * delta)) / msap
    v[VQN] = ((v[VQN] * msav) + (q.qn * delta)) / msap
    v[VQV] = ((v[VQV] * msav) + (q.qn * delta)) / msap
    // Maj des moyennes des nombres de documents et du volume au prorata de la prolongation
    v[VNN] = ((v[VNN] * msav) + (q.nn * delta)) / msap
    v[VNC] = ((v[VNC] * msav) + (q.nc * delta)) / msap
    v[VNG] = ((v[VNG] * msav) + (q.ng * delta)) / msap
    v[VV] = ((v[VV] * msav) + (q.v * delta)) / msap
    // Augmentation du COUT de l'abonnement et de la consommation
    const cabo = Tarif.cmsAbo (v[VQN], v[VQV], a, m) * delta
    v[VAC] += cabo
    if (this.estA) v[VAF] += cabo
    const soldeCAp = this.soldeDeM(m) // solde courant APRES
    if (soldeCAv < 0) { // était négatif
      if (soldeCAp > 0) {// devenu positif
        this.ddsn = 0
      } // else : toujours négatif, ddsn ne change pas
    } else { // était positif
      if (soldeCAp > 0) { // toujours positif
        this.ddsn = 0 // en fait ça ne change rien
      } else { // devenu négatif entre dh et dhf
        // consommation PASSEE (entre dh et dhf) par ms
        const consoMs = (soldeCAv - soldeCAp) / (dhf - this.dh) 
        const nbms = Math.floor(soldeCAv / consoMs) // nombre de ms pour ramener soldCav à 0 avec la conso calculée
        this.ddsn = this.dh + nbms
      }
    }
  }

  /* PRIVEE : cjAbo : coût journalier de l'abonnement qv à la date dh*/
  cjAbo (qv, dh) {
    const [ac, mc] = AMJ.am(dh)
    const cu = Tarif.cu(ac, mc)
    let m = 0
    m += cu[Compteurs.QN] * qv.qn
    m += cu[Compteurs.QV] * qv.qv
    m += cu[Compteurs.QC] * qv.qc
    return m / 30
  }

  // njec : nombre de jours estimés avant épuisement du crédit
  get njec () {
    const sc = this.soldeCourant
    const abo = Tarif.cmsAbo(this.qv.qn, this.qv.qv, this.aaaa, this.mm) * MSPARJOUR
    return sc <= 0 ? 0 : Math.floor(sc / (abo + this.qv.cjm))
  }

  // Ajoute les flags à f ou à 0 si f absent: retourne f
  addFlags (f) {
    const n = this.qv.nn + this.qv.nc + this.qv.ng
    let x = f || 0
    const pcc = this.qv.qc ? Math.round( (this.qv.cjm * 30 * 100) / this.qv.qc) : 999
    if (pcc >= 100) x = AL.add(x, AL.RAL)
    const pcn = this.qv.qn ? Math.round(n * 100 / UNITEN / this.qv.qn) : 999
    if (pcn >= 100) x = AL.add(x, AL.NRED)  
    const pcv = this.qv.qv ? Math.round(this.qv.v * 100 / UNITEV / this.qv.qv) : 999
    if (pcv >= 100) x = AL.add(x, AL.VRED)
    if (this.soldeCourant < 0) x = AL.add(x, AL.ARSN)
    return x
  }

  get flags () { return this.addFlags(0) }

  printhdr () {
    console.log('>> ' + (this.estA ? 'A' : 'O') + ' >> ' + this.aaaa + '/' + this.mm + ' >>>>>>>>>>>>>>>>')
    console.log('dh=' + new Date(this.dh).toISOString())
    console.log('dh0=' + new Date(this.dh0).toISOString())
    console.log('dhP=' + new Date(this.dhP).toISOString())
    console.log('flags=' + AL.edit(this.flags))
    const p = `QUOTAS -> qn=${this.qv.qn} qv=${this.qv.qn} qc=${this.qv.qn} 
  CPT -> N=${this.qv.nn + this.qv.nc + this.qv.ng} nn=${this.qv.nn} nc=${this.qv.nc} ng=${this.qv.ng} v=${e6(this.qv.v)} 
  cjm*30= ${e6(this.qv.cjm * 30)} njec= ${this.njec}`
    console.log(p)
  }
  
  printvd (n) {
    let m = this.mm
    for (let i = 0; i < 12; i++) {
      const v = this.vd[m - 1]
      if (!v[VMS]) break
      const nj = Math.floor(v[VMS] / MSPARJOUR)
      const p = 
`[${m} ${nj} jours]
  moy quotas:  qc=${e6(v[VQC])}  qn=${e6(v[VQN])}  qv=${e6(v[VQV])}
  moy vols: nn=${e6(v[VNN])}  nc=${e6(v[VNC])}  ng=${e6(v[VNG])}  v=${e6(v[VV])}
  conso:  nl=${v[VNL]}  ne=${v[VNE]}  vd=${v[VVD]}  vm=${v[VVM]}
  coûts:  ac=${e6(v[VAC])}  af=${e6(v[VAF])}  cc=${e6(v[VCC])}  cf=${e6(v[VAC])}
  soldes:  DB=${e6(v[VDB])}  CR=${e6(v[VCR])}  début=${e6(v[VS])}  fin=${e6(this.soldeDeM(m))}
`
      console.log(p)
      m--; if (m === 0) m = 12
    }
  }

  print () {
    this.printhdr()
    this.printvd()
    console.log('<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<')
  }

  static CSVHDR (sep) {
    return ['IP', 'NJ', 'QC', 'QN', 'QV', 'NL', 'NE', 'VM', 'VD', 
      'NN', 'NC', 'NG', 'V', 'AC', 'AF', 'CC', 'CF'].join(sep)
  }

  /* Cette méthode est invoquée par collNs en tant que 
  "processeur" de chaque row récupéré pour éviter son stockage en mémoire
  puis son traitement:
  - lignes : array de cumul des lignes générées.
  - mr : mois relatif
  - sep : séparateur CSV à utiliser
  - data : row sérialisé (non crypté) compta, contenant un champ compteurs (sérialisation des compteurs).
  */
  static CSV (lignes, mois, sep, data) {
    const dcomp = decode(data)
    const c = new Compteurs(dcomp.serialCompteurs)
    const m = mois % 100
    const vx = c.vd[m - 1]
    const ip = '\"' + c.idp + '\"'
    const nj = Math.ceil(vx[VMS] / MSPARMOIS)
    if (!nj) return
    
    const qc = Math.round(vx[VQC])
    const qn = Math.round(vx[VQN])
    const qv = Math.round(vx[VQV])
    const nl = Math.round(vx[VNL])
    const ne = Math.round(vx[VNE])
    const vm = Math.round(vx[VVM])
    const vd = Math.round(vx[VVD])
    const nn = Math.round(vx[VNN])
    const nc = Math.round(vx[VNC])
    const ng = Math.round(vx[VNG])
    const v = Math.round(vx[VV])
    const ac = Math.round(vx[VAC] * 100)
    const af = Math.round(vx[VAF] * 100)
    const cc = Math.round(vx[VCC] * 100)
    const cf = Math.round(vx[VCF] * 100)
    lignes.push([ip, nj, qc, qn, qv, nl, ne, vm, vd, nn, nc, ng, v, ac, af, cc, cf].join(sep))
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
    qt: { ...qv0 },
    ntf: [0, 0, 0],
    nbc: 0,
    nbd: 0
  }
  for(const idx in p.mcpt) {
    if (idx === '0') continue
    const x = p.mcpt[idx]
    lqv.forEach(f => { r.qt[f] += x.q[f] })
    if (x.notif && x.notif.nr) r.ntf[x.notif.nr - 1]++
    r.nbc++
    if (x.del) r.nbd++
  }
  synthesePartPC(r)
  return r
}

export function synthesePartPC (r) {
  r.pcac = !r.q.qc ? 0 : Math.round(r.qt.qc * 100 / r.q.qc) 
  r.pcan = !r.q.qn ? 0 : Math.round(r.qt.qn * 100 / r.q.qn) 
  r.pcav = !r.q.qv ? 0 : Math.round(r.qt.qv * 100 / r.q.qv) 
  r.pcc = !r.q.qc ? 0 : Math.round(r.qt.cjm * 30 * 100 / r.q.qc) 
  r.pcn = !r.q.qn ? 0 : Math.round((r.qt.nn + r.qt.nc + r.qt.ng) * 100 / (r.q.qn * UNITEN)) 
  r.pcv = !r.q.qv ? 0 : Math.round(r.qt.v * 100 / (r.q.qv * UNITEV)) 
}
