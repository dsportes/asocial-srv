import { encode, decode } from '@msgpack/msgpack'
import { FLAGS, F_SRV, AppExc, d14 } from './api.mjs'
import { operations } from './cfgexpress.mjs'
import { decrypterSrv, crypterSrv } from './util.mjs'
import { Compteurs, ID, AMJ, limitesjour, synthesesPartition, DataSync } from './api.mjs'

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

  static collsExp2 = ['fpurges', 'partitions', 'comptes', 'comptas', 'comptis', 'avatars', 'groupes', 'versions']

  static collsExpA = ['notes', 'transferts', 'sponsorings', 'chats', 'tickets']

  static collsExpG = ['notes', 'transferts', 'membres', 'chatgrs']

  // Gérés en Cache - Pour Firestore gère une propriété id_V (A REVOIR)
  static majeurs = new Set(['partitions', 'comptes', 'comptas', 'comptis', 'versions', 'avatars', 'groupes'])

  static sousColls = new Set(['notes', 'transferts', 'sponsorings', 'chats', 'membres', 'chatgrs', 'tickets'])
  
  /* Liste des attributs des (sous)collections- sauf singletons */
  static _attrs = {
    espaces: ['id', 'org', 'v', '_data_'],
    fpurges: ['id', '_data_'],
    partitions: ['id', 'v', '_data_'],
    syntheses: ['id', 'v', '_data_'],
    comptes: ['id', 'v', 'hxr', '_data_'],
    comptis: ['id', 'v', '_data_'],
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
- `notifP` : pour un délégué, la notification de sa partition.
- `opt`: option des comptes autonomes.
- `nbmi`: nombre de mois d'inactivité acceptable pour un compte O fixé par le comptable. Ce changement n'a pas d'effet rétroactif.
- `tnotifP` : table des notifications de niveau _partition_.
  - _index_ : id (numéro) de la partition.
  - _valeur_ : notification (ou `null`), texte crypté par la clé P de la partition.
*/
export class Espaces extends GenDoc { 
  constructor () { 
    super('espaces') 
    this._maj = false
  } 

  static nouveau (ns, org, auj, cleES) {
    return new Espaces().init({
      _ins: true,
      _maj: true,
      id: ns,
      org: org,
      v: 0,
      creation: auj,
      moisStat: 0,
      moisStatT: 0,
      nprof: 0,
      notifE: null,
      notifP: null,
      dlvat: 0,
      opt: 0,
      nbmi: 12,
      tnotifP: [null],
      cleES: cleES
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

  /* Restriction pour les délégués de la partition idp
  **Propriétés accessibles :**
    - administrateur technique : toutes de tous les espaces.
    - Comptable : toutes de _son_ espace.
    - Délégués : sur leur espace seulement,
      - `id v org creation notifE opt`
    - tous comptes: la notification de _leur_ partition est recopiée de tnotifP[p] en notifP.
  */
  toShortRow () {
    delete this.moisStat; delete this.moisStatT; delete this.dlvat; delete this.nbmi
    return this.toRow()
  }
}

export class Tickets extends GenDoc { 
  constructor () { super('tickets') } 

  static nouveau (idc, ids, ma, refa) {
    return new Tickets().init( {
      idc: ID.court(idc), ids, ma, refa: refa || '', refc: '',
      mc: 0, di: 0, dr: 0, dg: AMJ.amjUtc()
    })
  }

  shortTk () {
    return {
      ids: this.ids, ma: this.ma, refa: this.refa, 
      mc: this.mc, refc: this.refc, di: this.di, dr: this.dr, dg: this.dg
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
    - `nr`: niveau de restriction de la notification de niveau _compte_ (0 s'il n'y en a pas, 1 (sans restriction), 2 ou 3).
    - `cleAP` : clé A du compte crypté par la clé P de la partition.
    - `del`: `true` si c'est un délégué.
    - `q` : `qc qn qv c2m nn nc ng v` extraits du document `comptas` du compte.
      - `c2m` est le compteur `conso2M` de compteurs, montant moyen _mensualisé_ de consommation de calcul observé sur M/M-1 (observé à `dhic`). 
*/
export class Partitions extends GenDoc { 
  constructor () { 
    super('partitions')
    this._maj = false
  }

  static qz = {qc: 0, qn: 0, qv: 0, c2m: 0, nn: 0, nc: 0, ng: 0, v: 0 }

  static nouveau (ns, id, q) { // // qc: apr[0], qn: apr[1], qv: apr[2],
    return new Partitions().init( {
      _ins: true, _maj: true, id: ID.long(id, ns), q: q, v: 1, nrp: 0, mcpt: {}
    })
  }

  toShortRow (del) {
    if (!del) {
      const m = {}
      for(const idx in this.mcpt) {
        const e = this.mcpt[idx]
        if (e.del) m[idx] = {  del: true, nr: 0, qv: Partitions.qz, cleAP: e.cleAP }
      }
      this.mcpt = m
    }
    return this.toRow()
  }

  setQuotas (q) {
    this.q.qc = q.qc; this.q.qn = q.qn; this.q.qv = q.qv
    this._maj = true
  }

  ajoutCompte (compta, cleAP, del) { // compta: { id, qv }
    const id = ID.court(compta.id)
    const r = { cleAP, nr: 0, q: { ...compta.qv }}
    if (del) r.del = true
    r.q.c2m = compta._c2m
    this.mcpt[id] = r
    this._maj = true
  }

  setNotifC (id, notif) {
    const e = this.mcpt[ID.court(id)]
    if (e) {
      e.nr = notif ? notif.nr : 0
      e.notif = notif
    }
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
    return new Syntheses().init({id: ns, v: 0, tsp: [], _ins: true})
  }

  compile () {
    if (this.v > 10000) this.v = 10
    return this
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
- `hXR` : `ns` + `hXR`, hash du PBKFD d'un extrait de la phrase secrète.
- `dlv` : dernier jour de validité du compte.

- `rds` : null en session.
- `hXC`: hash du PBKFD de la phrase secrète complète (sans son `ns`).
- `cleKXC` : clé K cryptée par XC (PBKFD de la phrase secrète complète).
- `cleEK` : clé de l'espace cryptée par la clé K du compte, à la création de l'espace pour le Comptable. Permet au comptable de lire les reports créés sur le serveur et cryptés par cette clé E.

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
  constructor() { 
    super('comptes')
    this._maj = false
  } 

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

  static nouveau (id, hXR, hXC, cleKXC, rdsav, cleAK, clePK, cleEK, qvc, o, tpk) {
    const qv = { qc: qvc.qc, qn: qvc.qn, qv: qvc.qv, pcc: 0, pcn: 0, pcv: 0, nbj: 0 }
    const r = {
      _ins: true, _maj: true, id: id, v: 0, rds: ID.rds(ID.RDSCOMPTE),
      hxr: hXR, dlv: AMJ.max, cleKXC, hXC, idp: 0, qv: qv, clePK,
      mav: {}, mpg: {}
    }
    if (cleEK) r.cleEK = cleEK
    r.mav[ID.court(id)] = { rds: rdsav, cleAK: cleAK }
    if (o) { r.clePA = o.clePA; r.idp = o.idp; r.del = o.del }
    if (tpk) r.tpk = [null, tpk]
    return new Comptes().init(r)
  }

  get ns () { return ID.ns(this.id) }

  get _estA () { return this.idp === 0 }

  /* Mise à niveau des listes avatars / groupes du dataSync
  en fonction des avatars et groupes listés dans mav/mpg du compte 
  Ajoute les manquants dans ds, supprime ceux de ids absents de mav / mpg
  */
  majPerimetreDataSync (ds) {

    // Ajout dans ds des avatars existants dans le compte et inconnus de ds
    for(const idx in this.mav) {
      const ida = ID.long(parseInt(idx), this.ns)
      const rds = ID.long(this.mav[idx].rds, this.ns)
      ds.idRds[ida] = rds; ds.rdsId[rds] = ida
      if (!ds.avatars.has(ida)) ds.avatars.set(ida, { ...DataSync.vide, id: ida})
    }
    /* Suppression de ds des avatars qui y étaient cités et sont inconnus du compte
    Suppression de leurs entrées dans idRds / rdsId */
    const sa = new Set(); for(const [ida,] of ds.avatars) sa.add(ida)
    for(const ida of sa) if (!this.mav[ID.court(ida)]) {
      const rds = ds.idRds[ida]
      ds.avatars.delete(ida)
      if (rds) { delete ds.idRds[ida]; delete ds.rdsId[rds] }
    }

    // Ajout dans ds des groupes existants dans le compte et inconnus de ds
    for(const idx in this.mpg) {
      const idg = ID.long(parseInt(idx), this.ns)
      const rds = ID.long(this.mpg[idx].rds, this.ns)
      ds.idRds[idg] = rds; ds.rdsId[rds] = idg
      if (!ds.groupes.has(idg)) ds.groupes.set(idg,{ ...DataSync.videg, id: idg} )
    }
    /* Suppression de ds des groupes qui y étaient cités et sont inconnus du compte
    Suppression de leurs entrées dans idRds / rdsId */
    const sg = new Set(); for(const [idg,] of ds.groupes) sg.add(idg)
    for(const idg of sg) if (!this.mpg[ID.court(idg)]) {
      const rds = ds.idRds[idg]
      ds.avatars.delete(idg)
      if (rds) { delete ds.idRds[idg]; delete ds.rdsId[rds] }
    }
  }

  // Set des indices membres des participations au groupe idg (court)
  imGr (idg) {
    const s = new Set()
    const x = this.mpg[ID.court(idg)]
    if (!x) return s
    for(const ida in x.lav) s.add(ida)
    return s
  }
}

/* Comptis **************************************************/
export class Comptis extends GenDoc { 
  constructor() { super('comptis') } 

  static nouveau (id, rds) {
    return new Comptes().init({ id, v: 1, rds, mc: {} })
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
    - Pour un don :
      - `dg` est la date du don.
      - `ma` est le montant du don (positif ou négatif)
      - `iddb`: id du donateur / bénéficiaire (selon le signe de `ma`).
*/
export class Comptas extends GenDoc { 
  constructor() { super('comptas') } 

  get ns () { return ID.ns(this.id) }

  static nouveau (id, qv) {
    const c = new Compteurs(null, qv)
    return new Comptas().init({
      _ins: true, 
      _maj: true, 
      id: id, 
      v: 0, 
      qv: {...qv}, 
      solde: 0,
      compteurs: c.serial,
      _estA: c.estA,
      _c2m: c.conso2M
    })
  }

  compile () {
    const c = new Compteurs(this.compteurs)
    this._estA = c.estA 
    this._nbj = c.estA ? c.nbj(this.solde) : 0
    this._c2m = c.conso2M
    return this
  }

  setQcnv (q) {
    q.n = this.qv.nn + this.qv.nc + this.qv.ng
    q.v = this.qv.v
    const c = new Compteurs(this.compteurs)
    q.c = c.conso2M
  }

  quotas (q) { // q: { qc: qn: qv: }
    this.qv.qc = q.qc
    this.qv.qn = q.qn
    this.qv.qv = q.qv
    const c = new Compteurs(this.compteurs, this.qv)
    this._nbj = c.estA ? c.nbj(this.solde) : 0
    this._c2m = c.conso2M
    this._pc = c.pourcents
    this.compteurs = c.serial
    this._maj = true
  }

  ncPlus (q) {
    this.qv.nc += q
    const c = new Compteurs(this.compteurs, this.qv)
    this.compteurs = c.serial
    this._maj = true
  }

  nnPlus (q) {
    this.qv.nn += q
    const c = new Compteurs(this.compteurs, this.qv)
    this.compteurs = c.serial
    this._maj = true
  }

  ngPlus (q) {
    this.qv.ng += q
    const c = new Compteurs(this.compteurs, this.qv)
    this.compteurs = c.serial
    this._maj = true
  }

  addTk (tk) {
    if (!this.tickets) this.tickets = {}
    this.tickets[tk.ids] = tk.shortTk()
    this._maj = true
  }

  donDB (don) {
    if (this.total < don + 2) throw new AppExc(F_SRV, 215, [don, this.total])
    this.total -= don
    this._maj = true
  }

  donCR (don) {
    this.total += don
    this._maj = true
  }

  reporter (pc, nbj, qvc) {
    if (Math.floor(qvc.pcn / 20) !== Math.floor(pc.pcn / 20)) return true
    if (Math.floor(qvc.pcv / 20) !== Math.floor(pc.pcv / 20)) return true
    if (qvc.qc && (Math.floor(qvc.pcc / 20) !== Math.floor(pc.pcc / 20))) return true
    if (!qvc.qc && (Math.floor(qvc.nbj / 20) !== Math.floor(nbj / 20))) return true
    return false
  }

  /* Les compteurs de consommation d'un compte extraits de `comptas` sont recopiés à l'occasion de la fin d'une opération:
  - dans les compteurs `{ qc, qn, qv, pcc, pcn, pcv, nbj }` du document `comptes`,
  - dans les compteurs `q: { qc qn qv c2m nn nc ng v }` de l'entrée du compte dans son document `partitions`.
    - par conséquence la ligne de synthèse de sa partition est reportée dans l'élément correspondant de son document `syntheses`.
  - afin d'éviter des mises à jour trop fréquentes, la procédure de report n'est engagée qui si les compteurs `pcc pcn pcv` passe un cap de 5% ou que `nbj` passe un cap de 5 jours.
  */
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
}

export class Versions extends GenDoc { 
  constructor() { super('versions') } 
}

export class Avatars extends GenDoc { 
  constructor() { super('avatars') } 

  static nouveau (id, rdsav, pub, privK, cvA) {
    return new Avatars().init({ id, v: 1, rds: rdsav, pub, privK, cvA })
  }

  toShortRow () {
    const x1 = this.rds
    delete this.rds
    const r = this.toRow()
    this.rds = x1
    return r
  }
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
    - hYR : hash du PBKFD de la phrase de sponsoring réduite
    - `psK` : texte de la phrase de sponsoring cryptée par la clé K du sponsor.
    - `YCK` : PBKFD de la phrase de sponsoring cryptée par la clé K du sponsor.
    - `hYC`: hash du PNKFD de la phrase de sponsoring.
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
    this.ids = (ID.ns(args.id) * d14) + (args.hYR % d14)
    this.dlv = AMJ.amjUtcPlusNbj(AMJ.amjUtc(), limitesjour.sponsoring)
    this.st = 0
    this.psK = args.psK
    this.YCK = args.YCK
    this.hYC = args.hYC,
    this.cleAYC = args.cleAYC
    this.nomYC = args.nomYC
    this.cvA = args.cvA
    this.ardYC = args.ardYC
    this.dconf = args.dconf || false
    if (!args.partitionId) { // compte A
      this.don = args.don
      this.quotas = { qc: 0, qn: 1, qv: 1 }
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
    if (!m) { delete this.tid; delete this.lng; delete this.lnc }
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
