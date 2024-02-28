import { encode, decode } from '@msgpack/msgpack'
import { FLAGS, d14, rowCryptes } from './api.mjs'
import { operations } from './cfgexpress.mjs'
import { decrypterSrv, crypterSrv } from './util.mjs'
import { Compteurs, ID } from './api.mjs'
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
    gcvols: ['id', '_data_'],
    tribus: ['id', 'v', '_data_'],
    syntheses: ['id', 'v', '_data_'],
    comptas: ['id', 'v', 'hps1', '_data_'],
    versions: ['id', 'v', 'dlv', '_data_'],
    avatars: ['id', 'v', 'vcv', 'hpc', '_data_'],
    notes: ['id', 'ids', 'v', '_data_'],
    transferts: ['id', 'ids', 'dlv', '_data_'],
    sponsorings: ['id', 'ids', 'v', 'dlv', '_data_'],
    chats: ['id', 'ids', 'v', 'vcv', '_data_'],
    tickets: ['id', 'ids', 'v', '_data_'],
    groupes: ['id', 'v', 'dfh', '_data_'],
    membres: ['id', 'ids', 'v', 'vcv', 'dlv', '_data_'],
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

export class Espaces extends GenDoc { constructor () { super('espaces') } }

export class Tickets extends GenDoc { constructor () { super('tickets') } }

export class Gcvols extends GenDoc { constructor () { super('gcvols') } }

export class Fpurges extends GenDoc {constructor () { super('fpurges') } }

export class Partitions extends GenDoc { 
  constructor () { super('partitions') } 

  setNotifs (notifs, it) {
    if (this.notif) notifs.P = this.notif ; else delete notifs.P
    if (it < this.tcpt.length) {
      const nc = this.tcpt[it].notif
      if (nc) notifs.C = nc ; else delete notifs.C
    }
  }

}

export class Syntheses extends GenDoc { constructor () { super('syntheses') } }

/* Documents `comptes`
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
- `cleKXR` : clé K cryptée par XR.

_Comptes "O" seulement:_
- `clePA` : clé P de la partition cryptée par la clé A de l'avatar principal du compte.
- `del` : `true` si le compte est délégué de la partition.
- idp : 
- `it` : index du compte dans les tables `tcpt` de son document `partitions`.

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
      - _valeur_: indice `im` du membre dans la table `tmb` du groupe (`ids` du membre).

**Comptable seulement:**
- `cleEK` : Clé E de l'espace cryptée par la clé K.
- `tp` : table des partitions : `{c, qc, q1, q2}`.
  - `c` : `{ cleP, cleD, code }` crypté par la clé K du comptable
    - `cleP` : clé P de la partition.
    - `code` : texte très court pour le seul usage du comptable.
  - `qc, q1, q2` : quotas globaux de la partition.

La première partition d'`id` 1 est celle du Comptable et est indestructible.
*/
export class Comptes extends GenDoc { 
  constructor() { super('comptes') } 

  get ns () { return ID.ns(this.id) }

  majPerimetreDataSync (ds) {
    for(const idx in this.mav) {
      const idac = parseInt(idx)
      const rds = this.mav[idx].rds
      if (!ds.avatars.has(idac)) 
        ds.avatars.set(idac, { id: idac, rds: rds, vs: 0, vc: 0, vb: 0 })
    }
    // avatars hors périmètre à supprimer
    ds.forEach(x => { if (!this.mav[x.id]) x.vb = -1 })

    for(const idx in this.mpg) {
      const idgc = parseInt(idx)
      const rds = this.mpg[idx].rds
      if (!ds.groupes.has(idgc)) 
        ds.groupes.set(idgc, { id: idgc, rds: rds, vs: 0, vc: 0, vb: 0 })
    }
    // groupes hors périmètre à supprimer
    ds.forEach(x => { if (!this.mpg[x.id]) x.vb = -1 })
  }
}

export class Comptas extends GenDoc { 
  constructor() { super('comptas') } 

  compile () {
    this._maj = false
    const c = new Compteurs(this.compteurs)
    this._Q = c.notifQ 
    this._X = c.estA ? c.notifS(c.total) : c.notifX
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

export class Avatars extends GenDoc { constructor() { super('avatars') } }

export class Notes extends GenDoc { constructor() { super('notes') } }

export class Transferts extends GenDoc { constructor() { super('transferts') } }

export class Sponsorings extends GenDoc { constructor() { super('sponsorings') } }

export class Chats extends GenDoc { constructor() { super('chats') } }

export class Groupes extends GenDoc { 
  constructor() { super('groupes') }

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
