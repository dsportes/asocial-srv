import { encode, decode } from '@msgpack/msgpack'
import { FLAGS, d14, rowCryptes } from './api.mjs'
import { operations } from './cfgexpress.mjs'
import { decrypterSrv, crypterSrv } from './util.mjs'
import { Compteurs, ID, Rds, lcSynt, AMJ, limitesjour, synthesesPartition } from './api.mjs'
import { config } from './config.mjs'
// import { assertKO } from './modele.mjs'

/* GenDoc **************************************************
Chaque instance d'une des classes héritant de GenDoc (Avatars, Groupes etc.)
est le contenu compilé d'un document.
- la fonction compile(row) => doc prend un row issu de la base (ou du réseau)
et retourne un objet de class appropriée héreitant de GenDoc.
- la méthode toRow() => row retourne un row (format DB / réseau)
depuis un objet.

compile / toRow forme un couple de désérilisation / sérialisation.

***********************************************************/

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
  if (!row || !rowCryptes.has(row._nom)) return row
  const d = row._data_
  if (!d || d.length < 4) return row
  const dc = await decrypterSrv(op.db.appKey, d)
  row._data_ = new Uint8Array(dc)
  return row
}

export async function prepRow (op, row) {
  const b = rowCryptes.has(row._nom)
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

  static collsExp2 = ['fpurges', 'gcvols', 'tribus', 'comptas', 'avatars', 'groupes', 'versions']

  static collsExpA = ['notes', 'transferts', 'sponsorings', 'chats', 'tickets']

  static collsExpG = ['notes', 'transferts', 'membres', 'chatgrs']

  static majeurs = new Set(['tribus', 'comptas', 'versions', 'avatars', 'groupes'])

  static syncs = new Set(['singletons', 'espaces', 'tribus', 'comptas', 'versions'])

  static sousColls = new Set(['notes', 'transferts', 'sponsorings', 'chats', 'membres', 'chatgrs', 'tickets'])
  
  /* Liste des attributs des (sous)collections- sauf singletons */
  static _attrs = {
    espaces: ['id', 'org', 'v', '_data_'],
    fpurges: ['id', '_data_'],
    partitions: ['id', 'v', '_data_'],
    syntheses: ['id', 'v', '_data_'],
    comptes: ['id', 'v', 'hxr', '_data_'],
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

/* Espaces ********************************************************/
export class Espaces extends GenDoc { 
  constructor () { 
    super('espaces') 
    this._maj = false
  } 

  static nouveau (op, ns, org, cleE) {
    const cleES = crypterSrv(op.db.appKey, cleE)
    const r = {
      id: ns,
      org: org,
      v: 1,
      rds: Rds.nouveau('espaces'),
      cleES: cleES,
      creation: op.auj,
      moisStat: 0,
      moisStatT: 0,
      notif: null,
      dlvat: 0,
      t: 1
    }
    return new Espaces().init(r)
  }
}

export class Tickets extends GenDoc { constructor () { super('tickets') } }

export class Fpurges extends GenDoc {constructor () { super('fpurges') } }

/** Partitions ********************************************
_data_:
- `id` : numéro d'ordre de création de la partition par le Comptable.
- `v` : 1..N

- `rds`
- `qc qn qv` : quotas totaux de la partition.
- `clePK` : clé P de la partition cryptée par la clé K du comptable.
- `notif`: notification de niveau _partition_ dont le texte est crypté par la clé P de la partition.

- `ldel` : liste des clés A des délégués cryptées par la clé P de la partition.

- `tcpt` : table des comptes attachés à la partition. L'index `it` dans cette table figure dans la propriété `it` du document `comptes` correspondant :
  - `notif`: notification de niveau compte dont le texte est crypté par la clé P de la partition (`null` s'il n'y en a pas).
  - `cleAP` : clé A du compte crypté par la clé P de la partition.
  - `del`: `true` si c'est un délégué.
  - `q` : `qc qn qv c n v` extraits du document `comptas` du compte. 
    - En cas de changement de `qc qn qv` la copie est immédiate, sinon c'est effectué seulement lors de la prochaine connexion du compte.
    - `c` : consommation moyenne mensuelle lissée sur M et M-1 (`conso2M` de compteurs)
    - `n` : nn + nc + ng nombre de notes, chats, participation aux groupes.
    - `v` : volume de fichiers effectivement occupé.
*/
export class Partitions extends GenDoc { 
  constructor () { 
    super('partitions')
    this._maj = false
  } 

  static nouveau (ns, id, clePK, cleAP) {
    const aco = config.allocComptable
    const apr = config.allocPrimitive
    const r = {
      id: ID.long(id, ns),
      v: 1, 
      rds: Rds.nouveau('partitions'),
      qc: apr[0], qn: apr[1], qv: apr[2],
      clePK, notif: null, ldel: [],
      tcpt: [null]
    }
    if (cleAP) { // Partition primitive
      const x = {
        notif: null,
        cleAP,
        del: true,
        q: { qc: aco[0], qn: aco[1], qv: aco[2], c: 0, n: 0, v: 0 }
      }
      r.tcpt.push(x)
    }
    return new Partitions().init(r)
  }

  toShortRow (del) {
    if (!del) delete this.tcpt
    return this.toRow()
  }

  setNotifs (notifs, it) {
    if (this.notif) notifs.P = this.notif ; else delete notifs.P
    if (it < this.tcpt.length) {
      const nc = this.tcpt[it].notif
      if (nc) notifs.C = nc ; else delete notifs.C
    }
  }

  getSynthese () {
    return synthesesPartition(this)
  }

  /* Retourne it : indice du compte dans la partition
  - notif
  - q : `qc qn qv c n v`
  - cleAP
  - del
  */
  ajoutCompte (notif, q, cleAP, del) {
    const x = { notif: notif || null, q: q, del: del, cleAP: cleAP }
    this.tcpt.push(x)
    if (del) this.ldel.push(cleAP)
    return this.tcpt.length - 1
  }
}

/* Syntheses : un par espace ******************************
_data_:
- `id` : id de l'espace.
- `v` : date-heure d'écriture (purement informative).

- `tp` : table des synthèses des partitions de l'espace. L'indice dans cette table est l'id court de la partition. Chaque élément est la sérialisation de:
  - id : id long de la partition (calculé localement)
  - `qc qn qv` : quotas de la partition.
  - `ac an av` : sommes des quotas attribués aux comptes attachés à la partition.
  - `c n v` : somme des consommations journalières et des volumes effectivement utilisés.
  - `ntr0` : nombre de notifications partition sans restriction d'accès.
  - `ntr1` : nombre de notifications partition avec restriction d'accès 1.
  - `ntr2` : nombre de notifications partition avec restriction d'accès 2_.
  - `nbc` : nombre de comptes.
  - `nbd` : nombre de comptes _délégués_.
  - `nco0` : nombres de comptes ayant une notification sans restriction d'accès.
  - `nco1` : nombres de comptes ayant une notification avec restriction d'accès 1.
  - `nco2` : nombres de comptes ayant une notification avec restriction d'accès 2.

  Claculés localement les _pourcentages_: 
  - pcac pcan pcav pcc pcn pcv

`tp[0]` est la somme des `tp[1..N]` calculé en session, pas stocké.

lcSynt = ['qc', 'qn', 'qv', 'ac', 'an', 'av', 'c', 'n', 'v', 
  'nbc', 'nbd', 'ntr0', 'ntr1', 'ntr2', 'nco0', 'nco1', 'nco2']
*/
export class Syntheses extends GenDoc { 
  constructor () { super('syntheses') }

  static nouveau (ns) { 
    const aco = config.allocComptable
    const apr = config.allocPrimitive
    const r = { 
      id: ns, 
      v: Date.now(), 
      tp: [null, null] 
    }
    const e = { }
    lcSynt.forEach(f => { e[f] = 0 })
    e.qc = apr[0]
    e.qn = apr[1]
    e.qv = apr[2]
    e.ac = aco[0]
    e.an = aco[1]
    e.av = aco[2]
    e.nbc = 1
    e.nbd = 1
    r.tp[1] = e
    return new Syntheses().init(r)
  }
}

/* Comptes ************************************************************
- Phrase secrète, clés K P D, rattachement à une partition
- Avatars du compte
- Groupes accédés du compte

_data_ :
- `id` : numéro du compte = id de son avatar principal.
- `v` : 1..N.
- `hXR` : `ns` + `hXR`, hash du PBKFD d'un extrait de la phrase secrète.
- `dlv` : dernier jour de validité du compte.

- `rds`
- `hXC`: hash du PBKFD de la phrase secrète complète (sans son `ns`).
- `cleKXC` : clé K cryptée par XC (PBKFD de la phrase secrète complète).

_Comptes "O" seulement:_
- `clePA` : clé P de la partition cryptée par la clé A de l'avatar principal du compte.
- `rdsp` : `rds` (court) du documents partitions.
- `idp` : id de la partition (pour le serveur) (sinon 0)
- `del` : `true` si le compte est délégué de la partition.
- `it` : index du compte dans `tcpt` de son document `partitions`.

- `mav` : map des avatars du compte. 
  - _clé_ : id court de l'avatar.
  - _valeur_ : `{ rds, claAK }`
    - `rds`: de l'avatar (clé d'accès à son `versions`).
    - `cleAK`: clé A de l'avatar crypté par la clé K du compte.

- `mpg` : map des participations aux groupes:
  - _clé_ : id du groupe
  - _valeur_: `{ cleGK, rds, lp }`
    - `cleGK` : clé G du groupe cryptée par la clé K du compte.
    - rds: du groupe (clé d'accès à son `versions`)
    - `lp`: map des participations: 
      - _clé_: id court de l'avatar.
      - _valeur_: indice `im` du membre dans la table `tid` du groupe (`ids` du membre).

**Comptable seulement:**
- `cleEK` : Clé E de l'espace cryptée par la clé K.
- `tp` : table des partitions : `{c, qc, q1, q2}`.
  - `c` : `{ cleP, code }` crypté par la clé K du comptable
    - `cleP` : clé P de la partition.
    - `code` : texte très court pour le seul usage du comptable.
  - `qc, qn, qv` : quotas globaux de la partition.

La première partition d'`id` 1 est celle du Comptable et est indestructible.
*/
export class Comptes extends GenDoc { 
  constructor() { 
    super('comptes')
    this._maj = false
  } 

  static nouveau (id, hXR, hXC, cleKXC, cleEK, rdsav, cleAK, o, cs) {
    const r = {
      id: id, v: 1, rds: Rds.nouveau('comptes'),
      hxr: hXR, dlv: AMJ.max, cleKXC, cleEK, hXC, it: 0,
      mav: {}, mpd: {}
    }
    r.mav[ID.court(id)] = { rds: rdsav, cleAK: cleAK }
    if (o) { r.clePA = o.clePA; r.rdsp = o.rdsp; r.idp = o.idp; r.del = o.del; r.it = o.it }
    if (cs) { 
      r.cleEK = cs.cleEK
      r.tp = [null, { c: cs.c, qc: cs.qc, qn: cs.qn, qv: cs.qv }]
    }
    return new Comptes().init(r)
  }

  get ns () { return ID.ns(this.id) }

  majPerimetreDataSync (ds) {
    for(const idx in this.mav) {
      const idac = parseInt(idx)
      const ida = ID.long(idac, this.ns)
      const rds = Rds.long(this.mav[idx].rds, this.ns)
      if (!ds.avatars.has(ida)) 
        ds.avatars.set(ida, { id: ida, rds: rds, vs: 0, vc: 0, vb: 0 })
    }

    for(const idx in this.mpg) {
      const idgc = parseInt(idx)
      const idg = ID.long(idgc, this.ns)
      const rds = Rds.long(this.mpg[idx].rds, this.ns)
      if (!ds.groupes.has(idg)) 
        ds.groupes.set(idg, { id: idg, rds: rds, vs: 0, vc: 0, vb: 0, m: 0, n: 0})
    }
  }

  // Set des indices membres des participations au groupe idg (court)
  imGr (idg) {
    const s = new Set()
    const x = this.mpg[idg]
    if (!x) return s
    for(const ida in x.lp) s.add(x.lp[ida])
    return s
  }
}

/** Comptas *************************************************/
export class Comptas extends GenDoc { 
  constructor() { super('comptas') } 

  compile () {
    this._maj = false
    const c = new Compteurs(this.compteurs)
    this.nbj = c.estA ? c.nbj(this.total) : 0
    this._Q = c.notifQ 
    this._X = c.estA ? c.notifS(c.total) : c.notifX
    return this
  }

  conso (op) {
    if (op.nl || op.ne || op.vd || op.vm) {
      const x = { nl: op.nl, ne: op.ne, vd: op.vd, vm: op.vm }
      const c = new Compteurs(this.compteurs, null, x)
      this._Q = c.notifQ 
      this._X = c.estA ? c.notifS(c.total) : c.notifX
      this.compteurs = c.serial
      this._maj = true
    }
  }

  quotas (q) { // q: { qc: q1: q2: }
    this.qv.qc = q.qc
    this.qv.q1 = q.q1
    this.qv.q2 = q.q2
    const c = new Compteurs(this.compteurs, q).serial
    this._Q = c.notifQ 
    this._X = c.estA ? c.notifS(c.total) : c.notifX
    this.compteurs = c.serial
    this._maj = true
  }

}

export class Versions extends GenDoc { constructor() { super('versions') } }

export class Avatars extends GenDoc { 
  constructor() { super('avatars') } 
}

/* Classe Notes ******************************************************/
export class Notes extends GenDoc { 
  constructor() { super('notes') } 

  toShortRow (idc) { //idc : id du compte demandeur
    if (this.htm) {
      const ht = this.htm[idc]
      if (ht) this.ht = ht
      delete this.htm
    }
    return this.toRow()
  }
}

export class Transferts extends GenDoc { constructor() { super('transferts') } }

export class Sponsorings extends GenDoc { 
  constructor() { super('sponsorings') } 

  toShortRow () {
    delete this.csp
    delete this.itsp
    return this.toRow()
  }

  nouveau (args) {
    /* 
    - id : id du sponsor
    - hYR : hash du PNKFD de la pharse de sponsoring réduite
    - `psK` : texte de la phrase de sponsoring cryptée par la clé K du sponsor.
    - `YCK` : PBKFD de la phrase de sponsoring cryptée par la clé K du sponsor.
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
    this.id = args.id
    this.ids = (ID.ns(args.id) * d14) + args.hYR
    this.dlv = AMJ.amjUtcPlusNbj(AMJ.amjUtc(), limitesjour.sponsoring)
    this.st = 0
    this.psK = args.psK
    this.YCK = args.YCK
    this.cleAYC = args.cleAYC
    this.nomYC = args.nomYC
    this.cvA = args.cvA
    this.ardYC = args.ardYC
    this.dconf = args.dconf || false
    if (!args.partitionId) { // compte A
      this.don = args.don
      this.quotas = [0, 1, 1]
    } else {
      this.clePYC = args.clePYC
      this.partitionId = ID.court(args.partitionId)
      this.quotas = args.quotas
      this.del = args.del
    }
    return this
  }
}

export class Chats extends GenDoc { constructor() { super('chats') } }

/* Classe Groupe ****************************************************
_data_:
- `id` : id du groupe.
- `v` :  1..N, Par convention, une version à 999999 désigne un **groupe logiquement détruit** mais dont les données sont encore présentes. Le groupe est _en cours de suppression_.
- `dfh` : date de fin d'hébergement.

- `rds`
- `nn qn v2 q2`: nombres de notes actuel et maximum attribué par l'hébergeur, volume total actuel des fichiers des notes et maximum attribué par l'hébergeur.
- `idh` : id du compte hébergeur (pas transmise aux sessions).
- `imh` : indice `im` du membre dont le compte est hébergeur.
- `msu` : mode _simple_ ou _unanime_.
  - `null` : mode simple.
  - `[ids]` : mode unanime : liste des indices des animateurs ayant voté pour le retour au mode simple. La liste peut être vide mais existe.
- `tid` : table des ids courts des membres.
- `flags` : tables des flags.
- `lng` : liste noire _groupe_ des ids (courts) des membres.
- `lnc` : liste noire _compte_ des ids (courts) des membres.
- `cvG` : carte de visite du groupe, textes cryptés par la clé du groupe `{v, photo, info}`.

Calculée : mmb: Map des membres. Clé: id long du membre, Valeur: son im
*/
export class Groupes extends GenDoc { 
  constructor() { super('groupes') }

  compile () {
    this.ns = ID.ns(this.id)
    this.mmb = new Map()
    this.tid.forEach((id, im) => { this.mmb.set(ID.long(id, this.ns), im)})
    return this
  }

  /* Sérialisation en row après avoir enlevé 
  les champs non pertinents selon l'accès aux membres */
  toShortRow (m) {
    delete this.idh
    if (m !== 1) { delete this.tid; delete this.lng; delete this.lnc }
    return this.toRow()
  }

  /* Accès [membres, notes] d'un set d'im (compte ou avatar en fait) */
  amAn (s) {
    let n = false, m = false
    for (const im of s) {
      const f = this.flags[im]
      if ((f & FLAGS.AN) && (f & FLAGS.DN)) n = true 
      if ((f & FLAGS.AM) && (f & FLAGS.DM)) m = true 
    }
    return [m, n]
  }

  get anims () {
    const s = new Set()
    for (let im = 1; im < this.flags.length; im++) { 
      const f = this.flags[im]
      if ((f & FLAGS.AC) && (f & FLAGS.PA)) s.add(im) 
    }
    return s
  }

  get aActifs () {
    for (let im = 1; im < this.flags.length; im++) { 
      const f = this.flags[im]
      if (f & FLAGS.AC) return true 
    }
    return false
  }
}

export class Membres extends GenDoc { constructor() { super('membres') } }

export class Chatgrs extends GenDoc { constructor() { super('chatgrs') } }
