import { encode, decode } from '@msgpack/msgpack'
import { FLAGS, F_SRV, AppExc, d14, AMJ, 
  Compteurs, ID, limitesjour, synthesesPartition } from './api.mjs'
import { operations } from './cfgexpress.mjs'
import { config } from './config.mjs'
import { decrypterSrv, crypterSrv } from './util.mjs'

/* GenDoc **************************************************
Chaque instance d'une des classes héritant de GenDoc (Avatars, Groupes etc.)
est le contenu compilé d'un document.
- la fonction compile(row) => doc prend un row issu de la base (ou du réseau)
et retourne un objet de class appropriée héreitant de GenDoc.
- la méthode toRow() => row retourne un row (format DB / réseau)
depuis un objet.

compile / toRow forme un couple de désérilisation / sérialisation.

***********************************************************/
const ROWSENCLAIR = new Set(['versions'])

export function compile (row) {
  if (!row) return null
  const d = GenDoc._new(row._nom)
  const z = row.dlv && row.dlv <= operations.auj
  if (z || !row._data_) {
    d._zombi = true
  } else {
    const obj = decode(Buffer.from(row._data_))
    for (const [key, value] of Object.entries(obj)) d[key] = value
  }
  return d.compile()
}

export async function decryptRow (op, row) {
  if (!row || ROWSENCLAIR.has(row._nom)) return row
  const d = row._data_
  if (!d || d.length < 4) return row
  const dc = await decrypterSrv(op.db.appKey, d)
  row._data_ = new Uint8Array(dc)
  return row
}

export async function prepRow (op, row) {
  const b = !ROWSENCLAIR.has(row._nom)
  const la = GenDoc._attrs[row._nom]
  const r = {}
  la.forEach(a => {
    const x = row[a]
    if (b && a === '_data_') r[a] = x === undefined ? null : crypterSrv(op.db.appKey, x)
    else r[a] = x === undefined ?  null : x
  })
  return r
}

export class NsOrg {
  constructor (cin, cout) {
    this.ns = cout.ns
    this.org = cout.org
    this.chn = cin.ns !== this.ns
    this.ch = this.chn || cin.org !== this.org
  }

  static noms = { comptas: 'hps1', sponsorings: 'ids', avatars: 'hpc' }

  chRow (row) {
    if (!this.ch) return row
    const n = row._nom
    if (n === 'espaces' || n === 'syntheses') {
      const d = decode(row._data_)
      d.id = this.ns
      if (n === 'espaces') d.org = this.org
      row._data_ = encode(d)
      row.id = this.ns
      if (n === 'espaces') row.org = this.org
      return row
    }
    if (!this.chn) return row
    row.id = (row.id % d14) + (this.ns * d14)
    const d = decode(row._data_)
    d.id = row.id
    const c = NsOrg.noms[n]
    if (c && row[c]) {
      const v = (row[c] % d14) + (this.ns * d14)
      row[c] = v
      d[c] = v
    }
    row._data_ = encode(d)
    return row
  }

}

export class GenDoc {
  /* Descriptifs des collections et sous-collection */
  static collsExp1 = ['espaces', 'syntheses']

  static collsExp2 = ['fpurges', 'partitions', 'comptes', 'comptas', 'comptis', 'invits', 'avatars', 'groupes', 'versions']

  static collsExpA = ['notes', 'transferts', 'sponsorings', 'chats', 'tickets']

  static collsExpG = ['notes', 'transferts', 'membres', 'chatgrs']

  // Gérés en Cache - Pour Firestore gère une propriété id_V (A REVOIR)
  static majeurs = new Set(['partitions', 'comptes', 'comptas', 'comptis', 'invits', 'versions', 'avatars', 'groupes'])

  static sousColls = new Set(['notes', 'transferts', 'sponsorings', 'chats', 'membres', 'chatgrs', 'tickets'])
  
  /* Liste des attributs des (sous)collections- sauf singletons */
  static _attrs = {
    espaces: ['id', 'org', 'v', '_data_'],
    fpurges: ['id', '_data_'],
    partitions: ['id', 'v', '_data_'],
    syntheses: ['id', 'v', '_data_'],
    comptes: ['id', 'v', 'hxr', '_data_'],
    comptis: ['id', 'v', '_data_'],
    invits: ['id', 'v', '_data_'],
    comptas: ['id', 'v', '_data_'],
    versions: ['id', 'v', 'suppr', '_data_'],
    avatars: ['id', 'v', 'vcv', 'hpc', '_data_'],
    notes: ['id', 'ids', 'v', '_data_'],
    transferts: ['id', 'ids', 'dlv', '_data_'],
    sponsorings: ['id', 'ids', 'v', 'dlv', '_data_'],
    chats: ['id', 'ids', 'v', 'vcv', '_data_'],
    tickets: ['id', 'ids', 'v', '_data_'],
    groupes: ['id', 'v', 'dfh', '_data_'],
    membres: ['id', 'ids', 'v', 'vcv', '_data_'],
    chatgrs: ['id', 'ids', 'v', '_data_']
  }

  get _attrs () { return GenDoc._attrs[this._nom] }

  static _new (nom) {
    let obj
    switch (nom) {
    case 'espaces' : { obj = new Espaces(); break }
    case 'fpurges' : { obj = new Fpurges(); break }
    case 'partitions' : { obj = new Partitions(); break }
    case 'syntheses' : { obj = new Syntheses(); break }
    case 'comptes' : { obj = new Comptes(); break }
    case 'comptas' : { obj = new Comptas(); break }
    case 'comptis' : { obj = new Comptis(); break }
    case 'invits' : { obj = new Invits(); break }
    case 'versions' : { obj = new Versions(); break }
    case 'avatars' : { obj = new Avatars(); break }
    case 'notes' : { obj = new Notes(); break }
    case 'transferts' : { obj = new Transferts(); break }
    case 'sponsorings' : { obj =  new Sponsorings(); break }
    case 'chats' : { obj = new Chats(); break }
    case 'tickets' : { obj = new Tickets(); break }
    case 'groupes' : { obj = new Groupes(); break }
    case 'membres' : { obj =  new Membres(); break }
    case 'chatgrs' : { obj =  new Chatgrs(); break }
    }
    obj._nom = nom
    return obj
  }

  constructor (nom) { 
    const la = GenDoc._attrs[nom]
    this._nom = nom
    la.forEach(a => { this[a] = a !== '_data_' ? 0 : null })
  }

  init (d) {
    for (const c in d) this[c] = d[c]
    return this
  }

  /* Constitue un "row" depuis un objet:
    - en ignorant les attributs META (dont le nom commence par _)
    - en calculant les attributs calculés : iv ivb dhb icv
    - en produisant un _data_ null si l'objet n'a pas d'attributs NON META ou est _zombi
  */
  toRow () {
    const row = { _nom: this._nom }
    const la = this._attrs
    la.forEach(a => { if (a !== '_data_') row[a] = this[a] })
    /* le row est "zombi", c'est à dire sans _data_ quand,
    a) sa dlv est dépassée - mais il pouvait déjà l'être,
    b) son flag _zombi est à true
    Ca concerne :
    - les "versions" qui indiquent que leur groupe / avatar a disparu
    - les "notes" détruites (le row est conservé pour synchronisation)
    */
    const z = this.dlv && this.dlv <= operations.auj
    if (!z && !this._zombi) {
      const d = {}
      for (const [key, value] of Object.entries(this)) if (!key.startsWith('_')) d[key] = value
      row._data_ = Buffer.from(encode(d))
    }
    return row
  }

  compile () { return this }
}

/* Espaces *******************************************************
_data_ :
- `id` : de l'espace de 10 à 89.
- `v` : 1..N
- `org` : code de l'organisation propriétaire.

- `creation` : date de création.
- `moisStat` : dernier mois de calcul de la statistique des comptas.
- `moisStatT` : dernier mois de calcul de la statistique des tickets.
- `dlvat` : `dlv` de l'administrateur technique.
- `cleES` : clé de l'espace cryptée par la clé du site. Permet au comptable de lire les reports créés sur le serveur et cryptés par cette clé E.
- `notifE` : notification pour l'espace de l'administrateur technique. Le texte n'est pas crypté.
- `opt`: option des comptes autonomes.
- `nbmi`: nombre de mois d'inactivité acceptable pour un compte O fixé par le comptable. Ce changement n'a pas d'effet rétroactif.
- `tnotifP` : table des notifications de niveau _partition_.
  - _index_ : id (numéro) de la partition.
  - _valeur_ : notification (ou `null`), texte crypté par la clé P de la partition.
*/
export class Espaces extends GenDoc { 
  constructor () { super('espaces') } 

  get fige () { return this.notifE && this.notifE.nr === 2 }

  get clos () { const n = this.notifE
    return n && n.nr === 3 ? [n.texte, n.dh] : null
  }

  static nouveau (ns, org, auj, cleES) {
    return new Espaces().init({
      _maj: true, v: 0,
      id: ns,
      org: org,
      creation: auj,
      cleES: cleES,
      moisStat: 0,
      moisStatT: 0,
      nprof: 0,
      notifE: null,
      dlvat: 0,
      opt: 0,
      nbmi: 12,
      tnotifP: [null]
    })
  }

  setPartition (n) {
    for (let i = 0; i < n - this.tnotifP.length + 1; i++) this.tnotifP.push(null)
    this._maj = true
  }

  setNotifP (ntf, n) {
    if (n > this.tnotifP.length) throw new AppExc(F_SRV, 236)
    this.tnotifP[n] = ntf
    this._maj = true
  }

  setNotifE (ntf) {
    this.notifE = ntf || null
    this._maj = true
  }

  setNprof (nprof) {
    this.nprof = nprof
    this._maj = true
  }

  setOptions (args) {
    if (args.optionA) this.opt = args.optionA
    if (args.dlvat) this.dlvat = args.dlvat
    if (args.nbmi) this.nbmi = args.nbmi
    this._maj = true
  }

  /* Restriction pour les délégués de la partition idp
  **Propriétés accessibles :**
    - administrateur technique : toutes de tous les espaces.
    - Comptable : toutes de _son_ espace.
    - Délégués : pas stats dlvat ...
    - tous comptes: la notification de _leur_ partition sera seule lisible.
  */
  toShortRow () {
    const x1 = this.moisStat, x2 = this.moisStatT, x3 = this.dlvat, x4 = this.nbmi
    delete this.moisStat; delete this.moisStatT; delete this.dlvat; delete this.nbmi
    const r = this.toRow()
    this.moisStat = x1; this.moisStatT = x2; this.dlvat = x3; this.nbmi = x4
    return r
  }
}
/* Tickets **********************************************
_data_:
- `id`: id du Comptable.
- `ids` : numéro du ticket
- `v` : version du ticket.

- `rds`:
- `dg` : date de génération.
- `dr`: date de réception. Si 0 le ticket est _en attente_.
- `ma`: montant déclaré émis par le compte A.
- `mc` : montant déclaré reçu par le Comptable.
- `refa` : code court (32c) facultatif du compte A à l'émission.
- `refc` : code court (32c) facultatif du Comptable à la réception.
- `disp`: true si le compte était disparu lors de la réception.
- `idc`: id du compte générateur. Cette donnée n'est pas transmise aux sessions.
*/
export class Tickets extends GenDoc { 
  constructor () { super('tickets') } 

  static nouveau (idc, args) {
    return new Tickets().init( {
      _maj: true, v: 0,
      idc: ID.court(idc), 
      ids: args.ids, 
      ma: args.ma, 
      refa: args.refa || '', 
      refc: '',
      mc: 0, 
      dr: 0, 
      dg: AMJ.amjUtc()
    })
  }

  setZombi () {
    this._zombi = true
    this.maj = true
  }

  setDisp () {
    this.disp = true
    this._maj = true
  }

  reception (auj, mc, refc) {
    this.dr = auj
    this.mc = mc
    this.refc = refc
    this._maj = true
  }

  shortTk () {
    return {
      ids: this.ids, ma: this.ma, refa: this.refa, 
      mc: this.mc, refc: this.refc, dr: this.dr, dg: this.dg
    }
  }

  toShortRow () {
    const idc = this.idc; delete this.idc
    const row = this.toRow()
    this.idc = idc
    return row
  }
}

export class Fpurges extends GenDoc {constructor () { super('fpurges') } }

/** Partitions ********************************************
_data_:
- `id` : numéro de partition attribué par le Comptable à sa création.
- `v` : 1..N

- `nrp`: niveau de restriction de la notification (éventuelle) de niveau _partition_ mémorisée dans `espaces` et dont le texte est crypté par la clé P de la partition.
- `q`: `{ qc, qn, qv }` quotas globaux attribués à la partition par le Comptable.
- `mcpt` : map des comptes attachés à la partition. 
  - _clé_: id du compte.
  - _valeur_: `{ nr, cleAP, del, q }`
    - `notif`: notification du compte cryptée par la clé P de la partition (redonde celle dans compte).
    - `cleAP` : clé A du compte crypté par la clé P de la partition.
    - `del`: `true` si c'est un délégué.
    - `q` : `qc qn qv c2m nn nc ng v` extraits du document `comptas` du compte.
      - `q.c2m` est le compteur `conso2M` de compteurs, montant moyen _mensualisé_ de consommation de calcul observé sur M/M-1 (observé à `dhic`). 
*/
export class Partitions extends GenDoc { 
  constructor () { super('partitions') }

  get ns () { return ID.ns(this.id) }

  static qz = {qc: 0, qn: 0, qv: 0, c2m: 0, nn: 0, nc: 0, ng: 0, v: 0 }

  static nouveau (ns, id, q) { // // qc: apr[0], qn: apr[1], qv: apr[2],
    return new Partitions().init( {
      _maj: true, v: 0,
      id: ID.long(id, ns), 
      q: q, 
      nrp: 0, 
      mcpt: {}
    })
  }

  toShortRow (del) {
    if (del) return this.toRow()
    const sv = this.mcpt
    const m = {}
    for(const idx in this.mcpt) {
      const e = this.mcpt[idx]
      if (e.del) m[idx] = {  del: true, nr: 0, qv: Partitions.qz, cleAP: e.cleAP }
    }
    this.mcpt = m
    const r = this.toRow()
    this.mcpt = sv
    return r
  }

  majQC(idc, qv, c2m) {
    const e = this.mcpt[ID.court(idc)]
    if (e) {
      e.q = { ...qv }
      e.q.c2m = c2m
      this._maj = true
    }
  }

  setQuotas (q) {
    this.q.qc = q.qc; this.q.qn = q.qn; this.q.qv = q.qv
    this._maj = true
  }

  setNrp (notif) {
    this.nrp = notif ? notif.nr : 0
    this._maj = true
  }

  ajoutCompte (compta, cleAP, del, notif) { // id de compta, q: copie de qv de compta
    compta.compile()
    const id = ID.court(compta.id)
    const r = { cleAP, nr: 0, q: { ...compta.qv }}
    if (del) r.del = true
    if (notif) r.notif = notif
    r.q.c2m = compta._c2m
    this.mcpt[id] = r
    this._maj = true
  }

  retraitCompte (id) {
    const idc = ID.court(id)
    delete this.mcpt[idc]
    this._maj = true
  }

  setDel (id, del) {
    const e = this.mcpt[ID.court(id)]
    if (!e) return false
    e.del = del
    this._maj = true
    return true
  }

  setNotifC (id, notif) {
    const e = this.mcpt[ID.court(id)]
    if (e) e.notif = notif
    this._maj = true
  }

  estDel (id) {
    const e = this.mcpt[ID.court(id)]
    return e && e.del
  }

  getSynthese () {
    return synthesesPartition(this)
  }
}

/* Syntheses : un par espace ******************************
_data_:
_data_:
- `id` : ns de son espace.
- `v` : 

- `tsp` : table des _synthèses_ des partitions.
  - _index_: numéro de la partition.
  - _valeur_ : `synth`, objet des compteurs de synthèse calculés de la partition.
    - `id nbc nbd`
    - `ntfp[1,2,3]`
    - `q` : `{ qc, qn, qv }`
    - `qt` : { qc qn qv c2m n v }`
    - `ntf[1,2,3]`
    - `pcac pcan pcav pcc pcn pcv`

*/
export class Syntheses extends GenDoc { 
  constructor () { super('syntheses') }

  static nouveau (ns) { 
    return new Syntheses().init({
      _maj: true, v: 0,
      id: ns,
      tsp: []
    })
  }

  setPartition(p) {
    const n = ID.court(p.id)
    for(let i = this.tsp.length; i <= n; i++) this.tsp.push(null)
    this.tsp[n] = synthesesPartition(p)
    this._maj = true
  }
}

/* Comptes ************************************************************
_data_ :
- `id` : numéro du compte = id de son avatar principal.
- `v` : 1..N.
- `hxr` : `ns` + `hXR`, hash du PBKFD d'un extrait de la phrase secrète.
- `dlv` : dernier jour de validité du compte.

- `rds` : null en session.
- `hXC`: hash du PBKFD de la phrase secrète complète (sans son `ns`).
- `cleKXC` : clé K cryptée par XC (PBKFD de la phrase secrète complète).
- `cleEK` : clé de l'espace cryptée par la clé K du compte, à la création de l'espace pour le Comptable. Permet au comptable de lire les reports créés sur le serveur et cryptés par cette clé E.
- `privK` : clé privée RSA de son avatar principal cryptée par la clé K du compte.

- `dhvuK` : date-heure de dernière vue des notifications par le titulaire du compte, cryptée par la clé K.
- `qv` : `{ qc, qn, qv, pcc, pcn, pcv, nbj }`
  - `pcc, pcn, pcv, nbj` : remontés de `compta` en fin d'opération quand l'un d'eux passe un seuil de 5% / 5j, à la montée ou à la descente.
    - `pcc` : pour un compte O, pourcentage de sa consommation mensualisée sur M/M-1 par rapport à son quota `qc`.
    - `nbj` : pour un compta A, nombre de jours estimés de vie du compte avant épuisement de son solde en prolongeant sa consommation des 4 derniers mois et son abonnement `qn qv`.
    - `pcn` : pourcentage de son volume de notes / chats / groupes par rapport à son quota qn.
    - `pcv` : pourcentage de son volume de fichiers par rapport à son quota qv.
  - `qc qn qv` : maj immédiate en cas de changement des quotas.
    - pour un compte O identiques à ceux de son entrée dans partition.
    - pour un compte A, qn qv donné par le compte lui-même.
    - en cas de changement, les compteurs de consommation sont remontés. 
  - permet de calculer `notifQ`, `notifX` (O), `notifS` (A)

_Comptes "O" seulement:_
- `clePK` : clé P de la partition cryptée par la clé K du compte. Si cette clé a une longueur de 256, la clé P a été cryptée par la clé publique de l'avatar principal du compte suite à une affectation à une partition APRÈS sa création (changement de partition, passage de compte A à O)
- `idp` : id de la partition (son numéro).
- `del` : `true` si le compte est délégué de la partition.
- `notif`: notification de niveau _compte_ dont le texte est crypté par la clé P de la partition (`null` s'il n'y en a pas).

- `mav` : map des avatars du compte. 
  - _clé_ : id court de l'avatar.
  - _valeur_ : `{ rds, claAK }`
    - `rds`: de l'avatar (clé d'accès à son `versions`). null en session.
    - `cleAK`: clé A de l'avatar crypté par la clé K du compte.

- `mpg` : map des participations aux groupes:
  - _clé_ : id du groupe
  - _valeur_: `{ rds, cleGK, lav }`
    - `rds`: du groupe (clé d'accès à son `versions`). null en session.
    - `cleGK` : clé G du groupe cryptée par la clé K du compte.
    - `lav`: liste de ses avatars participant au groupe. compilé -> sav : Set

**Comptable seulement:**
- `tpk` : table des partitions `{cleP, code }` crypté par clé K du comptable. Son index est le numéro de la partition.
  - `cleP` : clé P de la partition.
  - `code` : code / commentaire court de convenance attribué par le Comptable
*/
export class Comptes extends GenDoc { 
  constructor() { super('comptes') }

  get ns () { return ID.ns(this.id) }

  get _estA () { return this.idp === 0 }

  toShortRow() {
    const x1 = this.rds
    const x2 = encode(this.mav)
    const x3 = encode(this.mpg)
    delete this.rds
    for(const idx in this.mav) delete this.mav[idx].rds
    for(const idx in this.mpg) delete this.mpg[idx].rds
    const row = this.toRow()
    this.rds = x1
    this.mav = decode(x2)
    this.mpg = decode(x3)
    return row
  }

  static nouveau (args, sp) {
    const ns = ID.ns(args.id)
    const r = {
      _maj: true, v: 0,
      id: args.id,
      hxr: (ns * d14) + (args.hXR % d14),
      hXC: args.hXC,
      dlv: AMJ.max, 
      cleKXC: args.cleKXC, 
      privK: args.privK,
      clePK: args.clePK,
      mav: {},
      mpg: {}
    }
    if (sp) { // sponsorisé
      if (sp.partitionId) {
        r.clePA = args.clePA
        r.idp = sp.partitionId
        r.del = sp.del
      } else {
        r.idp = 0
      }
      r.qv = { qc: sp.quotas.qc, qn: sp.quotas.qn, qv: sp.quotas.qv, pcc: 0, pcn: 0, pcv: 0, nbj: 0 }
    } else { // Comptable
      r.cleEK = args.cleEK
      r.clePA = args.clePA
      r.idp = 1
      r.del = true
      const aco = config.allocComptable
      r.qv = { qc: aco[0], qn: aco[1], qv: aco[2], pcc: 0, pcn: 0, pcv: 0, nbj: 0 }
      // args.ck: `{ cleP, code }` crypté par la clé K du comptable
      r.tpk = [null, args.ck]
    }
    return new Comptes().init(r)
  }

  chgPS (args) {
    this.hxr = (this.ns * d14) + args.hps1
    this.hXC = args.hXC
    this.cleKXC = args.cleKXC
    this._maj = true
  }

  chgPart (idp, clePK, notif) {
    this.clePK = clePK
    this.idp = ID.court(idp)
    this.notif = notif
    this.maj = true
  }

  setNotif (notif) {
    this.notif = notif
    this.maj = true
  }

  // Comptable seulement
  ajoutPartition (np, itemK) { // itemK: {cleP, code} crypté par la clé K du Comptable.
    if (np !== this.tpk.length) throw new AppExc(F_SRV, 228)
    this.tpk.push(itemK)
    this._maj = true
  }

  setCodePart (np, itemK) {
    const e = this.tpk ? this.tpk[np] : null
    if (e) {
      this.tpk[np] = itemK
      this._maj = true
      return true
    }
    return false
  }

  setDhvu (dhvu) {
    this.dhvuK = dhvu
    this._maj = true
  }

  reporter (pc, nbj) { // pc de compta, nbj de compta
    if (Math.floor(this.qv.pcn / 20) !== Math.floor(pc.pcn / 20)) return true
    if (Math.floor(this.qv.pcv / 20) !== Math.floor(pc.pcv / 20)) return true
    if (this.qv.qc && (Math.floor(this.qv.pcc / 20) !== Math.floor(pc.pcc / 20))) return true
    if (!this.qv.qc && (Math.floor(this.qv.nbj / 20) !== Math.floor(nbj / 20))) return true
    return false
  }

  /* Report de compta et calcul DLV: seulement si,
  - compte était déjà en maj
  - OU chgt DLV significatif
  - OU report des compteurs significatif
  */
  async reportDeCompta (compta, gd) {
    compta.compile() // calcul _nbj _c2m _pc

    const e = await gd.getES(true)
    // DLV maximale : N mois depuis aujourd'hui
    const dlvmax = !e ? 0 : (AMJ.djMois(AMJ.amjUtcPlusNbj(gd.op.auj, e.nbmi * 30)))
    // DLV maximale pour les comptes 0: dlvmax OU dlv de l'espace si plus proche
    const dlvmaxO = !e ? 0 :(e.dlvat && (dlvmax > e.dlvat) ? e.dlvat : dlvmax)

    let dlv
    if (this.idp) // Compte O
      dlv = dlvmaxO
    else { // Compte A
      const d = AMJ.djMois(AMJ.amjUtcPlusNbj(this.auj, compta._nbj))
      dlv = dlvmax > d ? d : dlvmax
    }
    let diff1 = AMJ.diff(dlv, this.dlv); if (diff1 < 0) diff1 = -diff1

    const rep = this._maj || diff1 || this.reporter(compta._pc, compta._nbj)
    if (rep) {
      this.dlv = dlv
      if (!this._estA) this.qv.pcc = compta._pc.pcc 
      else this.qv.nbj = compta._nbj
      this.qv.pcn = compta._pc.pcn
      this.qv.pcv = compta._pc.pcv
      this._maj = true
      if (!this._estA) { // maj partition
        const p = await gd.getPA(ID.long(this.idp, this.ns))
        p.majQC(this.id, compta.qv, compta._c2m)
      }
    }
  }

  ajoutAvatar (avatar, cleAK) {
    this.mav[ID.court(avatar.id)] = { rds: avatar.rds, cleAK: cleAK }
    this._maj = true
  }

  ajoutGroupe (idg, ida, cleGK, rds) {
    const idgc = ID.court(idg)
    let e = this.mpg[idgc]
    if (!e) { e = { cleGK, rds, lav: []}; this.mpg[idgc] = e }
    const idac = ID.court(ida)
    if (e.lav.indexOf(idac) === -1) e.lav.push(idac)
    this._maj = true
  }

  estAvc (id) { return this.mav[ID.court(id)] }

  /* Mise à niveau des listes avatars / groupes du dataSync
  en fonction des avatars et groupes listés dans mav/mpg du compte 
  Ajoute les manquants dans ds, supprime ceux de ids absents de mav / mpg
  */
  majPerimetreDataSync (ds, srds) {

    // Ajout dans ds des avatars existants dans le compte et inconnus de ds
    for(const idx in this.mav) {
      const ida = ID.long(parseInt(idx), this.ns)
      const rds = this.mav[idx].rds
      srds.add(ID.long(rds, this.ns))
      if (!ds.avatars.has(ida)) { ds.avatars.set(ida, { id: ida, rds, vs: 0, vb: 0 }) }
    }
    /* Suppression de ds des avatars qui y étaient cités et sont inconnus du compte
    Suppression de leurs entrées dans idRds / rdsId */
    const sa = new Set(); for(const [ida,] of ds.avatars) sa.add(ida)
    for(const ida of sa) if (!this.mav[ID.court(ida)]) {
      const dsav = ds.avatars.get(ida)
      srds.delete(ID.long(dsav.rds, this.ns))
      ds.avatars.delete(ida)
    }

    // Ajout dans ds des groupes existants dans le compte et inconnus de ds
    for(const idx in this.mpg) {
      const idg = ID.long(parseInt(idx), this.ns)
      const rds = this.mpg[idx].rds
      srds.add(ID.long(rds, this.ns))
      const x = { id: idg, rds, vs: 0, vb: 0, ms: false, ns: false, m: false, n:false }
      if (!ds.groupes.has(idg)) ds.groupes.set(idg, x)
    }
    /* Suppression de ds des groupes qui y étaient cités et sont inconnus du compte
    Suppression de leurs entrées dans idRds / rdsId */
    const sg = new Set(); for(const [idg,] of ds.groupes) sg.add(idg)
    for(const idg of sg) if (!this.mpg[ID.court(idg)]) {
      const dsgr = ds.groupes.get(idg)
      srds.delete(ID.long(dsgr.rds, this.ns))
      ds.groupes.delete(idg)
    }
  }

  // Set des id (long) des membres des participations au groupe idg (court)
  idMbGr (idg) {
    const s = new Set()
    const x = this.mpg[ID.court(idg)]
    if (!x) return s
    for(const ida of x.lav) s.add(ID.long(parseInt(ida), this.ns))
    return s
  }

  // Set des im des avatars du compte étant animateur */
  imAnimsDeGr (gr) {
    const s = new Set()
    const e = this.mpg[ID.court(gr.id)]
    if (!e || !e.lav || !e.lav.length) return s
    e.lav.forEach(idc => { 
      const im = gr.mmb.get(ID.long(idc, this.ns))
      if (im && gr.st[im] === 5) s.add(im)
    })
    return s
  }
}

/* Comptis *************************************************
_data_:
- `id` : id du compte.
- `v` : version.

- `mc` : map à propos des contacts (des avatars) et des groupes _connus_ du compte,
  - _cle_: `id` court de l'avatar ou du groupe,
  - _valeur_ : `{ ht, tx }`.
    - `ht` : liste des hashtags séparés par un espace attribués par le compte et cryptée par la clé K du compte.
    - `tx` : commentaire écrit par le compte gzippé et crypté par la clé K du compte.
*/
export class Comptis extends GenDoc { 
  constructor() { super('comptis') } 

  static nouveau (id) {
    return new Comptis().init({ 
      _maj: true, v: 0,
      id,
      mc: {} 
    })
  }

  setMc (args) {
    this.mc[ID.court(args.id)] = { ht: args.htK, tx: args.txK }
    this._maj = true
  }

  toShortRow() { return this.toRow() }
}

/* Invits *************************************************
_data_:
- `id` : id du compte.
- `v` : version.

- `rds`:
- `invits`: liste des invitations en cours:
  - _valeur_: `{idg, ida, cleGA, cvG, ivpar, dh}`
    - `idg`: id du groupe,
    - `ida`: id de l'avatar invité
    - `cleGA`: clé du groupe crypté par la clé A de l'avatar.
    - `cvG` : carte de visite du groupe (photo et texte sont cryptés par la clé G du groupe).
    - `flags` : d'invitation.
    - `invpar` : `[{ cleAG, cvA }]`
      - `cleAG`: clé A de l'avatar invitant crypté par la clé G du groupe.
      - `cvA` : carte de visite de l'invitant (photo et texte sont cryptés par la clé G du groupe). 
    - `msgG` : message de bienvenue / invitation émis par l'invitant.
*/
export class Invits extends GenDoc { 
  constructor() { super('invits') } 

  static nouveau (id) {
    return new Invits().init({ 
      _maj: true, v: 0,
      id, 
      invits: [] 
    })
  }

  toShortRow () { return this.toRow() }

  addInv (inv) {
    const l = []
    this.invits.forEach(i => { if (i.idg !== inv.idg || i.ida !== inv.ida) l.pudh(i)})
    l.push(inv)
    this.invits = l
    this._maj = true
  }

  supprInvit (idgl, idal) {
    const idg = ID.court(idgl)
    const ida = ID.court(idal)
    const l = []
    this.invits.forEach(i => { if (i.idg !== idg || i.ida !== ida) l.pudh(i)})
    this.invits = l
    this._maj = true
  }
}

/** Comptas ************************************************
_data_ :
_data_:
- `id` : numéro du compte = id de son avatar principal.
- `v` : 1..N.
- `qv` : `{qc, qn, qv, nn, nc, ng, v}`: quotas et nombre de groupes, chats, notes, volume fichiers. Valeurs courantes.
- `compteurs` sérialisation des quotas, volumes et coûts.
- _Comptes "A" seulement_
  - `solde`: résultat, 
    - du cumul des crédits reçus depuis le début de la vie du compte (ou de son dernier passage en compte A), 
    - plus les dons reçus des autres,
    - moins les dons faits aux autres.
  - `tickets`: map des tickets / dons:
    - _clé_: `ids`
    - _valeur_: `{dg, iddb, dr, ma, mc, refa, refc, di}`
  - `dons` : liste des dons effectués / reçus
    - `dh`: date-heure du don
    - `m`: montant du don (positif ou négatif)
    - `iddb`: id du donateur / bénéficiaire (selon le signe de `m`).
*/
export class Comptas extends GenDoc { 
  constructor() { super('comptas') } 

  get ns () { return ID.ns(this.id) }

  static nouveau (id, quotas, don) {
    const qv = { qc: quotas.qc, qn: quotas.qn, qv: quotas.qv, nn: 0, nc: 0, ng: 0, v: 0 }
    const c = new Compteurs(null, qv)
    const x = new Comptas().init({
      _maj: true, v: 0, 
      id: id, 
      qv, 
      solde: don || 0,
      compteurs: c.serial
    })
    return x.compile()
  }

  toShortRow () { return this.toRow() }

  majcpt (c) {
    this._estA = c.estA 
    this._nbj = c.estA ? c.nbj(this.solde) : 0
    this._c2m = c.conso2M
    this._pc = c.pourcents
  }

  compile () {
    const c = new Compteurs(this.compteurs)
    this.majcpt(c)
    return this
  }

  quotas (q) { // q: { qc: qn: qv: }
    this.qv.qc = q.qc
    this.qv.qn = q.qn
    this.qv.qv = q.qv
    const c = new Compteurs(this.compteurs, this.qv)
    this.compteurs = c.serial
    this.majcpt(c)
    this._maj = true
  }

  ncPlus (q) {
    this.qv.nc += q
    const c = new Compteurs(this.compteurs, this.qv)
    this.compteurs = c.serial
    this.majcpt(c)
    this._maj = true
  }

  nnPlus (q) {
    this.qv.nn += q
    const c = new Compteurs(this.compteurs, this.qv)
    this.compteurs = c.serial
    this.majcpt(c)
    this._maj = true
  }

  ngPlus (q) {
    this.qv.ng += q
    const c = new Compteurs(this.compteurs, this.qv)
    this.compteurs = c.serial
    this.majcpt(c)
    this._maj = true
  }

  plusTk (tk) {
    if (!this.tickets) this.tickets = {}
    this.tickets[tk.ids] = tk.shortTk()
    this._maj = true
  }

  moinsTk (tk) {
    if (this.tickets) delete this.tickets[tk.ids]
    this._maj = true
  }

  majSolde (m) {
    this.solde += m
    this.compile()
    this._maj = true
  }

  enregTk (tk, mc, refc) {
    if (!this.tickets) this.tickets = {}
    const m = mc < 0 ? 0 : mc
    tk.mc = m
    tk.refc = refc || ''
    this.tickets[tk.ids] = tk.shortTk()
    this.majSolde(m)
  }

  don (dh, m, iddb) {
    if (m < 0 && this.solde + m < 2) throw new AppExc(F_SRV, 215, [-m, this.total])
    this.majSolde(m)
    if (!this.dons) this.dons = []
    this.dons.push({dh, m, iddb: ID.court(iddb)})
  }

  async incorpConso (op) {
    const conso = { 
      nl: op.nl, 
      ne: op.ne + 1 + op.toInsert.length + op.toUpdate.length + op.toDelete.length,
      vd: op.vd, 
      vm: op.vm 
    }
    const x = { nl: conso.nl, ne: conso.ne, vd: conso.vd, vm: conso.vm }
    const c = new Compteurs(this.compteurs, null, x)
    this.compteurs = c.serial
    this.majcpt(c)
    this._maj = true
    op.setRes('conso', conso)
  }

  /* Les compteurs de consommation d'un compte extraits de `comptas` sont recopiés à l'occasion de la fin d'une opération:
  - dans les compteurs `{ qc, qn, qv, pcc, pcn, pcv, nbj }` du document `comptes`,
  - dans les compteurs `q: { qc qn qv c2m nn nc ng v }` de l'entrée du compte dans son document `partitions`.
    - par conséquence la ligne de synthèse de sa partition est reportée dans l'élément correspondant de son document `syntheses`.
  - afin d'éviter des mises à jour trop fréquentes, la procédure de report n'est engagée qui si les compteurs `pcc pcn pcv` passe un cap de 5% ou que `nbj` passe un cap de 5 jours.
  
  async finaliser (op) {
    const conso = { 
      nl: op.nl, 
      ne: op.ne + 1 + op.toInsert.length + op.toUpdate.length + op.toDelete.length,
      vd: op.vd, 
      vm: op.vm 
    }
    const x = { nl: conso.nl, ne: conso.ne, vd: conso.vd, vm: conso.vm }
    const c = new Compteurs(this.compteurs, null, x)
    const pc = c.pourcents
    this.compteurs = c.serial
    const nbj = op.compte._estA ? c.nbj(this.solde) : 0
    const qvc = op.compte.qv // `qv` : `{ qc, qn, qv, pcc, pcn, pcv, nbj }`
    const rep = op.compte._ins || this.reporter(pc, nbj, qvc)
    if (rep) {
      if (!op.compte._estA) qvc.pcc = pc.pcc; else qvc.nbj = nbj
      qvc.pcn = pc.pcn; qvc.pcv = pc.pcv
      op.compte._maj = true
      if (!op.compte._estA) {
        // qv de partition
        const p = await op.getPartition(ID.long(op.compte.idp, this.ns), 'partition-finaliser')
        const e = p.mcpt[ID.court(op.compte.id)]
        e.q = c.qv; e.q.c2m = c.conso2M
        p._maj = true
      }
    }
    this.v++
    const row = this.toRow()
    if (this._ins) op.insert(row); else op.update(row)
    return conso
  }
  */
}

/* Versions ************************************************************
*/
export class Versions extends GenDoc { 
  constructor() { super('versions') } 

  static nouveau (id) {
    return new Versions().init({
      v: 0,
      id: id,
      suppr: 0
    })
  }
}

/* Avatar *************************************************************
_data_:
- `id` : id de l'avatar.
- `v` : 1..N. Par convention, une version à 999999 désigne un **avatar logiquement détruit** mais dont les données sont encore présentes. L'avatar est _en cours de suppression_.
- `vcv` : version de la carte de visite afin qu'une opération puisse détecter (sans lire le document) si la carte de visite est plus récente que celle qu'il connaît.
- `hZR` : `ns` + hash du PBKFD de la phrase de contact réduite.

- `rds` :
- `cleAZC` : clé A cryptée par ZC (PBKFD de la phrase de contact complète).
- `pcK` : phrase de contact complète cryptée par la clé K du compte.
- `hZC` : hash du PBKFD de la phrase de contact complète.

- `cvA` : carte de visite de l'avatar `{id, v, photo, texte}`. photo et texte cryptés par la clé A de l'avatar.

- `pub privK` : couple des clés publique / privée RSA de l'avatar.
*/
export class Avatars extends GenDoc { 
  constructor() { super('avatars') } 

  get ns () { return ID.ns(this.id)}

  static nouveau (args, cvA) {
    cvA.v = 0
    return new Avatars().init({ 
      _maj: true, v: 0,
      id: args.id,
      pub: args.pub,
      privK: args.privK,
      vcv: 1,
      cvA
    })
  }

  setCv (cv) {
    cv.v = 0
    this.cvA = cv
    this._maj = true
  }

  setPC (args) {
    if (args.hZR) {
      this.hpc = ID.long(args.hZR, this.ns)
      this.hZC = args.hZC
      this.cleAZC = args.cleAZC
      this.pcK = args.pcK
    } else {
      this.hpc = 0
      delete this.hZR
      delete this.pcK
      delete this.cleAZC
    }
    this._maj = true
  }

  toShortRow () { return this.toRow() }
}

/* Classe Notes ******************************************************/
export class Notes extends GenDoc { 
  constructor() { super('notes') } 

  toShortRow (idc) { //idc : id du compte demandeur
    const htmx = this.htm
    if (idc && this.htm) {
      const ht = this.htm[ID.court(idc)]
      if (ht) this.ht = ht
      delete this.htm
    }
    const r = this.toRow()
    this.htm = htmx
    return r
  }
}

export class Transferts extends GenDoc { constructor() { super('transferts') } }

export class Sponsorings extends GenDoc { 
  constructor() { super('sponsorings') } 

  static nouveau (args, ids) {
    /* 
    - id : id du sponsor
    - hYR : hash du PBKFD de la phrase de sponsoring réduite
    - `psK` : texte de la phrase de sponsoring cryptée par la clé K du sponsor.
    - `YCK` : PBKFD de la phrase de sponsoring cryptée par la clé K du sponsor.
    - `hYC`: hash du PBKFD de la phrase de sponsoring.
    - `cleAYC` : clé A du sponsor crypté par le PBKFD de la phrase complète de sponsoring.
    - `partitionId`: id de la partition si compte 0    
    - `clePYC` : clé P de sa partition (si c'est un compte "O") cryptée par le PBKFD 
      de la phrase complète de sponsoring (donne l'id de la partition).
    - `nomYC` : nom du sponsorisé, crypté par le PBKFD de la phrase complète de sponsoring.
    - `cvA` : `{ v, photo, info }` du sponsor, textes cryptés par sa cle A.
    - `ardYC` : ardoise de bienvenue du sponsor / réponse du sponsorisé cryptée par le PBKFD de la phrase de sponsoring.

    - `quotas` : `[qc, q1, q2]` pour un compte O, quotas attribués par le sponsor.
      - pour un compte "A" `[0, 1, 1]`. Un tel compte n'a pas de `qc` et peut changer à loisir
      `[qn, qv]` qui sont des protections pour lui-même (et fixe le coût de l'abonnement).
    - don: montant du don pour un compte autonome sponsorisé par un compte autonome
    - dconf: true, si le sponsor demande la confidentialité (pas de chat à l'avcceptation)
    - del: true si le compte est délégué de la partition
    */
    const sp = new Sponsorings()
    sp._maj = true
    sp.v = 0
    sp.id = args.id
    sp.ids = ids
    sp.dlv = AMJ.amjUtcPlusNbj(AMJ.amjUtc(), limitesjour.sponsoring)
    sp.st = 0
    sp.psK = args.psK
    sp.YCK = args.YCK
    sp.hYC = args.hYC,
    sp.cleAYC = args.cleAYC
    sp.nomYC = args.nomYC
    sp.cvA = args.cvA
    sp.ardYC = args.ardYC
    sp.dconf = args.dconf || false
    if (!args.partitionId) { // compte A
      sp.don = args.don
      sp.quotas = { qc: 0, qn: 1, qv: 1 }
    } else {
      sp.clePYC = args.clePYC
      sp.partitionId = ID.court(args.partitionId)
      sp.quotas = args.quotas
      sp.del = args.del
    }
    return sp
  }

  prolonger (dh, args) {
    if (this.st === 0) {
      this.dh = dh
      if (args.dlv) {
        this.dlv = args.dlv
      } else {
        this.st = 3
      }
      this._maj = true
    }
  }

  acceptSp (dh, args) {
    this.dh = dh
    this.st = 2
    this.ardYC = args.ardYC
    this.dconf2 = args.dconf
    this._maj = true
  }

  refusSp (dh, args) {
    this.dh = dh
    this.st = 1
    this.ardYC = args.ardYC
    this._maj = true
  }

  toShortRow () { return this.toRow() }
}

/* Chats *************************************************/
export class Chats extends GenDoc { 
  constructor() { super('chats') } 

  static nouveau (arg) {
    const c = new Chats().init(arg)
    c._maj = true
    c.v = 0
    return c
  }

  chEdisp () {
    const st1 = Math.floor(this.st / 10)
    if (st1) { // était actif
      this.st = (st1 * 10) + 2 
      this.vcv = 0
      this.cvE = null
    } else { // était passif, disparait
      this._zombi = true
    }
    this._maj = true
  }

  addChatItem (item) {
    const nl = [item]
    let lg = item.t ? item.t.length : 0
    for (const it of this.items) {
      lg += it.t ? it.t.length : 0
      if (lg > 5000) break
      nl.push(it)
    }
    this.items = nl
    this._maj = true
  }

  razChatItem (dh) { 
    // a : 0:écrit par I, 1: écrit par E
    const nl = []
    for (const it of this.items) {
      if (it.dh === dh) {
        nl.push({a: it.a, dh, dhx: this.dh})
      } else {
        nl.push(it)
      }
    }
    this.items = nl
    this._maj = true
  }

  setCvE (cv) {
    this.vcv = cv.v
    this.cvE = cv
    this._maj = true
  }

  actifI () {
    this.st = 10 + (this.st % 10)
    this._maj = true
  }

  actifE () {
    this.st = (Math.floor(this.st / 10) * 10) + 1 
    this._maj = true
  }

  setZomi () {
    this._zombi = true
    this._maj = true
  }

  passifI () {
    this.st = this.st % 10
    this.items = []
    this._maj = true
  }

  passifE () {
    this.st = Math.floor(this.st / 10) * 10
    this._maj = true
  }

  get estPassif () { return Math.floor(this.st / 10) === 0 }

  toShortRow () { return this.toRow()}
}

/* Classe Groupe ****************************************************
_data_:
- `id` : id du groupe.
- `v` :  1..N, Par convention, une version à 999999 désigne un **groupe logiquement détruit** mais dont les données sont encore présentes. Le groupe est _en cours de suppression_.
- `dfh` : date de fin d'hébergement.

- `rds` :
- `nn qn vf qv`: nombres de notes actuel et maximum attribué par l'hébergeur, volume total actuel des fichiers des notes et maximum attribué par l'hébergeur.
- `idh` : id du compte hébergeur (pas transmise aux sessions).
- `imh` : indice `im` du membre dont le compte est hébergeur.
- `msu` : mode _simple_ ou _unanime_.
  - `null` : mode simple.
  - `[ids]` : mode unanime : liste des indices des animateurs ayant voté pour le retour au mode simple. La liste peut être vide mais existe.
- `invits` : map `{ fl, li[] }` des invitations en attente de vote ou de réponse.
- `tid` : table des ids courts des membres.
- `st` : table des statuts.
- `flags` : tables des flags.
- `lng` : liste noire _groupe_ des ids (courts) des membres.
- `lnc` : liste noire _compte_ des ids (courts) des membres.
- `cvG` : carte de visite du groupe, textes cryptés par la clé du groupe `{v, photo, info}`.

Calculée : mmb: Map des membres. Clé: id long du membre, Valeur: son im
*/
export class Groupes extends GenDoc { 
  constructor() { super('groupes') }

  get idgc () { return ID.court(this.id) }

  compile () {
    this.ns = ID.ns(this.id)
    this.mmb = new Map()
    this.tid.forEach((id, im) => { 
      if (im) this.mmb.set(ID.long(id, this.ns), im)
    })
    return this
  }

  static nouveau (args) {
    args.cvG.v = 0
    return new Groupes().init({
      _maj: true, v: 0,
      id: args.idg, // id du groupe
      tid: [0, ID.court(args.ida)], // id de l'avatar fondateur
      msu: args.msu, // mode simple (true) / unanime
      qn: args.quotas.qn,  // quotas.qn
      qv: args.quotas.qv, // quotas.qv
      cvG: args.cvG, // CV du groupe cryptée clé G
      dfh: 0, 
      imh: 1,
      nn: 0, 
      vf: 0, 
      invits: {},
      st: new Uint8Array([0, 5]),
      flags: new Uint8Array([0, 255]),
      lnc: [], 
      lng: []
    })
  }

  setCv (cv) {
    cv.v = 0
    this.cvG = cv
    this._maj = true
  }

  nvContact (ida) {
    const im = this.st.length
    this.tid.push(ID.court(ida))
    const x = new Uint8Array(this.flags.length + 1)
    this.flags.forEach((v, i) => {x[i] = v})
    x[this.flags.length] = 0
    this.flags = x
    const y = new Uint8Array(this.st.length + 1)
    this.st.forEach((v, i) => {y[i] = v})
    y[this.st.length] = 1
    this.st = y
    this._maj = true
    return im
  }

  /* - `msu` : mode _simple_ ou _unanime_.
    - `null` : mode simple.
    - `[ids]` : mode unanime : liste des indices des animateurs ayant voté pour le retour au mode simple. La liste peut être vide mais existe.
  */
  setMsu (simple, im) {
    if (!simple) this.msu = []
    else {
      // demande de retour au mode simple
      if (!this.msu) this.msu = []
      const s = new Set(this.msu)
      s.add(im)
      let ok = true
      this.anims.forEach(imx => { if (!s.has(imx)) ok = false })
      if (ok) {
        // tous les animateurs ont voté pour
        this.msu = null
      } else {
        this.msu = Array.from(s)
      }
    }
    this._maj = true
  }

  supprInvit (im, suppr) { // suppr: 1-contact, 2:radié, 3-radié + LN
    delete this.invits[im]
    this.st[im] = suppr > 1 ? 0 : 1
    if (suppr > 1) this.tid[im] = 0
    this.flags[im] = 0
    if (suppr === 3 && this.lmg.indexOf(this.idgc) === -1) 
      this.lmg.push(this.idgc)
    this._maj = true
  }

  setInvit (im, invit, aInviter) {
    this.invits[im] = invit
    this.st[im] = aInviter ? 3 : 2
    this._maj = true
  }

  acceptInvit (im, iam, ian) {
    const fl = this.invits[im].fl // flags d'invit
    const f = this.flags[im] // flags actuels
    let nf = 0
    if ((f & FLAGS.HM) || ((fl & FLAGS.DM) && iam)) nf |= FLAGS.HM
    if ((f & FLAGS.HN) || (((fl & FLAGS.DN) || (fl & FLAGS.DE)) && ian)) nf |= FLAGS.HN
    if ((f & FLAGS.HE) || ((fl & FLAGS.DE) && iam)) nf |= FLAGS.HE
    if (fl & FLAGS.DM) nf |= FLAGS.DM
    if (fl & FLAGS.DN) nf |= FLAGS.DN
    if (fl & FLAGS.DE) nf |= FLAGS.DE
    if (iam) nf |= FLAGS.AM
    if (ian) nf |= FLAGS.AN
    this.flags[im] = nf
    this.st[im] = (fl & FLAGS.AN) ? 5 : 4
    delete this.invits[im]
    this._maj = true
    return nf
  }

  refusInvit (im, cas) { // cas: 2:contact 3:radié 4:radié + LN
    const idmc = this.tid[im]
    this.st[im] = cas === 2 ? 1 : 0
    delete this.invits[im]
    if (cas > 2) {
      this.tid[im] = 0
      this.flags[im] = 0
      if (cas === 4 && this.lnc.indexOf(idmc) === -1) 
        this.lnc.push(idmc)
    }
    this._maj = true
  }

  setFlags (anc, st, im, iam, ian, idm, idn, ide) {
    this.st[im] = st
    const fl = this.flags[im]
    let nvfl = fl
    const iamav = fl & FLAGS.AM
    const ianav = fl & FLAGS.AN
    if (iam !== iamav || ian !== ianav) {
      if (!this.compte.estAvc(idm)) throw new AppExc(F_SRV, 265)
      if (iam) nvfl |= FLAGS.AM; else nvfl &= ~FLAGS.AM
      if (ian) nvfl |= FLAGS.AN; else nvfl &= ~FLAGS.AN
    }
    const idmav = fl & FLAGS.DM
    const idnav = fl & FLAGS.DN
    const ideav = fl & FLAGS.DE
    const chgFl = idm !== idmav || idn !== idnav || ide !== ideav
    if (chgFl) {
      if (!anc.size) throw new AppExc(F_SRV, 266)
      if (idm) nvfl |= FLAGS.DM; else nvfl &= ~FLAGS.DM
      if (idn) nvfl |= FLAGS.DN; else nvfl &= ~FLAGS.DN
      if (ide) nvfl |= FLAGS.DE; else nvfl &= ~FLAGS.DE
    }
    this.flags[im] = nvfl
    this._maj = true
    return chgFl
  }

  retourContact (im) {
    const fl = this.flags[im]
    this.st[im] = 1
    let nvfl = 0
    if (fl & FLAGS.HM) nvfl |= FLAGS.HM
    if (fl & FLAGS.HN) nvfl |= FLAGS.HN
    if (fl & FLAGS.HE) nvfl |= FLAGS.HE
    this.flags[im] = nvfl
    delete this.invits[im]
    this._maj = true
  }

  radiation (im, ln, moi) {
    const idmc = this.tid[im]
    this.st[im] = 0
    this.tid[im] = 0
    this.flags[im] = 0
    delete this.invits[im]
    if (ln) {
      if (moi) {
        if (this.lnc.indexOf(idmc) === -1) this.lnc.push(idmc)
      } else if (this.lng.indexOf(idmc) === -1) this.lng.push(idmc)
    }
  }

  /* Sérialisation en row après avoir enlevé 
  les champs non pertinents selon l'accès aux membres?
  Pas accès membre: tid ne contient que les entrées des avatars du compte */
  toShortRow (c, m) { // c : compte, m: le compte à accès aux membres
    let row
    const idh = this.idh; delete this.idh
    if (!m) {
      const tid = this.tid, lng = this.lng, lnc = this.lnc
      const tidn = new Array(tid.length)
      const s = new Set()
      for (const im of c.mmb(this.id)) s.add(im)
      for (let im = 0; im < tid.length; im++) tidn[im] = s.has(im) ? tid[im] : 0
      this.tid = tidn; delete this.lng; delete this.lnc
      row = this.toRow()
      this.tid = tid; this.lnc = lnc; this.lng = lng
    } else {
      row = this.toRow()
    }
    this.idh = idh
    return row
  }

  /* Accès [membres, notes] d'un set d'id (compte ou avatar en fait) */
  amAn (s) {
    let n = false, m = false
    for (const id of s) {
      const im = this.mmb.get(id)
      const f = this.flags[im]
      if ((f & FLAGS.AN) && (f & FLAGS.DN)) n = true 
      if ((f & FLAGS.AM) && (f & FLAGS.DM)) m = true 
    }
    return [m, n]
  }

  get anims () {
    const s = new Set()
    for (let im = 1; im < this.st.length; im++) if (this.st[im] === 5) s.add(im) 
    return s
  }

  get nbActifs () {
    let n = 0
    for (let im = 1; im < this.st.length; im++) if (this.st[im] >= 4) n++
    return n
  }
}

/* Membres ***********************************************************
- `id` : id du groupe.
- `ids`: identifiant, indice `im` de membre relatif à son groupe.
- `v` : 
- `vcv` : version de la carte de visite du membre.

- `rds`: 
- `dpc` : date de premier contact (ou de première invitation s'il a été directement invité).
- `ddi` : date de la dernière invitation (envoyée au membre, c'est à dire _votée_).
- **dates de début de la première et fin de la dernière période...**
  - `dac fac` : d'activité.
  - `dln fln` : d'accès en lecture aux notes.
  - `den fen` : d'accès en écriture aux notes.
  - `dam fam` : d'accès aux membres.
- `cleAG` : clé A de l'avatar membre cryptée par la clé G du groupe.
- `cvA` : carte de visite du membre `{id, v, photo, info}`, textes cryptés par la clé A de l'avatar membre.
- `msgG`: message d'invitation crypté par la clé G pour une invitation en attente de vote ou de réponse. 
*/
export class Membres extends GenDoc { 
  constructor() { super('membres') } 

  static nouveau(idg, im, cvA, cleAG, dx) {
    const m = new Membres().init({
      _maj: true, v: 0,
      id: idg, 
      im, 
      vcv: cvA.v, 
      cvA: cvA, 
      cleAG: cleAG,
      dpc: 0, ddi: 0, dac: 0, fac: 0, dln: 0, fln: 0, den: 0, fen: 0, dam: 0, fam: 0
    })
    if (dx) for (const f in dx) m[f] = dx[f]
    return m
  }

  supprRad (suppr) { // suppr: 1-retour contact, 2:radié, 3-radié + LN
    if (suppr === 1) this.msgG = null
    else this._zombi = true
    this._maj = true
  }

  setInvit (auj, aInviter, msgG) {
    if (aInviter) this.ddi = auj
    this.msgG = msgG
    this._maj = true
  }

  acceptInvit (auj, nf) {
    const ln = (nf & FLAGS.DN) && (nf & FLAGS.AN)
    const en = ln && (nf & FLAGS.DE)
    const am = (nf && FLAGS.DM) && (nf & FLAGS.AM)
    if (!this.dac) this.dac = auj
    if (!this.dln && ln) this.dln = auj
    if (!this.den && en) this.den = auj
    if (!this.dam && am) this.dam = auj
    this.msgG = null
    this._maj = true
  }

  setDates (auj, iam, ian, idm, idn, ide) {
    if (!this.dam && idm && iam) this.dam = auj
    if (this.dam && (!idm || !iam)) this.fam = auj
    if (!this.dan && idn && ian) this.dan = auj
    if (this.dam && (!idn || !ian)) this.fam = auj
    if (!this.den && ide && ian) this.den = auj
    if (this.den && (!ide || !ian)) this.fen = auj
    this._maj = true
  }

  retourContact (auj) {
    if (this.dac && !this.fac) this.fac = auj
    if (this.dam && !this.fam) this.fam = auj
    if (this.dan && !this.fan) this.fan = auj
    if (this.den && !this.fen) this.fen = auj
    this.msgG = null
    this._maj = true
  }

  setZombi () {
    this._zombi = true
    this._maj = true
  }

  toShortRow () { return this.toRow() }
}

/* Chatgrs ******************************************************
- `id` : id du groupe
- `ids` : `1`
- `v` : sa version.

- `items` : liste ordonnée des items de chat `{im, dh, dhx, t}`
  - `im` : im du membre auteur,
  - `dh` : date-heure d'écriture.
  - `dhx` : date-heure de suppression.
  - `t` : texte crypté par la clé G du groupe (vide s'il a été supprimé).
*/
export class Chatgrs extends GenDoc { 
  constructor() { super('chatgrs') } 

  static nouveau (idg) {
    return new Chatgrs().init({
      _maj: true, v: 0,
      id: idg, items: []
    })
  }

  toShortRow () { return this.toRow() }

  addItem (im, dh, t) {
    const it = { im, dh, dhx: 0, t }
    const l = [it]
    let sz = t.length
    for(const x of this.items) {
      sz += x.t.length
      if (sz > 5000) break
      l.push(x)
    }
    this.items = l
    this._maj = true
  } 
}
