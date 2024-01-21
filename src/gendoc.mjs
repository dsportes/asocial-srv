import { encode, decode } from '@msgpack/msgpack'
import { FLAGS } from './api.mjs'
import { ctx } from './server.js'
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

export function compile (row) {
  if (!row) return null
  const d = GenDoc._new(row._nom)
  const z = row.dlv && row.dlv <= ctx.auj
  if (z || !row._data_) {
    d._zombi = true
  } else {
    const obj = decode(Buffer.from(row._data_))
    for (const [key, value] of Object.entries(obj)) d[key] = value
  }
  return d
}

export async function decryptRow (op, row) {
  if (!row || !GenDoc.rowCryptes.has(row._nom)) return row
  const d = row._data_
  if (!d || d.length < 4) return row
  const dc = await decrypterSrv(op.db.appKey, d)
  row._data_ = new Uint8Array(dc)
  return row
}

export async function prepRow (op, row) {
  const b = GenDoc.rowCryptes.has(row._nom)
  const la = GenDoc._attrs[row._nom]
  const r = {}
  la.forEach(a => {
    const x = row[a]
    if (b && a === '_data_') r[a] = x === undefined ? null : crypterSrv(op.db.appKey, x)
    else r[a] = x === undefined ?  null : x
  })
  return r
}

export class GenDoc {
  /* Descriptifs des collections et sous-collection */
  static collsExp1 = ['espaces', 'tickets', 'syntheses']

  static collsExp2 = ['fpurges', 'gcvols', 'tribus', 'comptas', 'avatars', 'groupes', 'versions']

  static collsExpA = ['notes', 'transferts', 'sponsorings', 'chats', 'tickets']

  static collsExpG = ['notes', 'transferts', 'membres', 'chatgrs']

  static majeurs = new Set(['tribus', 'comptas', 'versions', 'avatars', 'groupes'])

  static syncs = new Set(['singletons', 'espaces', 'tribus', 'comptas', 'versions'])

  static sousColls = new Set(['notes', 'transferts', 'sponsorings', 'chats', 'membres', 'chatgrs'])

  static rowCryptes = new Set(['comptas'])
  
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
    case 'gcvols' : { obj = new Gcvols(); break }
    case 'tribus' : { obj = new Tribus(); break }
    case 'syntheses' : { obj = new Syntheses(); break }
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
    const z = this.dlv && this.dlv <= ctx.auj
    if (!z && !this._zombi) {
      const d = {}
      for (const [key, value] of Object.entries(this)) if (!key.startsWith('_')) d[key] = value
      row._data_ = Buffer.from(encode(d))
    }
    return row
  }
}

export class Espaces extends GenDoc { constructor () { super('espaces') } }

export class Tickets extends GenDoc { constructor () { super('tickets') } }

export class Gcvols extends GenDoc { constructor () { super('gcvols') } }

export class Fpurges extends GenDoc {constructor () { super('fpurges') } }

export class Tribus extends GenDoc { constructor () { super('tribus') } }

export class Syntheses extends GenDoc { constructor () { super('syntheses') } }

export class Comptas extends GenDoc { constructor() { super('comptas') } }

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
