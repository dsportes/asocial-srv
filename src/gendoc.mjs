import { encode, decode } from '@msgpack/msgpack'
import { FLAGS, F_SRV, A_SRV, AppExc, AMJ, UNITEN, UNITEV,
  Compteurs, ID, limitesjour, synthesesPartition } from './api.mjs'
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
  if (!row._data_ || !row._data_.length) {
    d._zombi = true
    d.id = ID.court(row.id)
    if (row.ids !== undefined) d.ids = ID.court(row.ids)
    if (row.hk !== undefined) d.hk = ID.court(row.hk)
    if (row.v !== undefined) d.v = row.v
    if (row.vcv !== undefined) d.vcv = row.vcv
    if (row.dlv !== undefined) d.dlv = row.dlv
    if (row.dfh !== undefined) d.dfh = row.dfh
    if (row.org !== undefined) d.org = row.org
  } else {
    const obj = decode(Buffer.from(row._data_))
    for (const [key, value] of Object.entries(obj)) d[key] = value
  }
  return d.compile()
}

export function decryptRow (appKey, row) {
  if (!row || ROWSENCLAIR.has(row._nom)) return row
  const d = row._data_
  if (!d || d.length < 4) return row
  const dc = decrypterSrv(appKey, d)
  row._data_ = new Uint8Array(dc)
  return row
}

export function prepRow (appKey, row) {
  const r = { ...row }
  if (!ROWSENCLAIR.has(row._nom)) 
    r._data_ = crypterSrv(appKey, row._data_)
  delete r._nom
  delete r._vav
  return r
}

/* Pour transcoder les rows dans un export-db */
export class NsOrg {
  constructor (cin, cout) {
    this.ns = cout.ns
    this.org = cout.org
    this.ch = cin.ns !== this.ns || cin.org !== this.org
    this.kin = cin.dbp.appKey
    this.kout = cout.dbp.appKey
  }

  chRow (row) {
    if (this.ch) {
      row.id = ID.long(ID.court(row.id), this.ns)
      if (row.ids !== undefined) row.ids = ID.long(ID.court(row.ids), this.ns)
      if (row.hk !== undefined) row.hk = ID.long(ID.court(row.hk), this.ns)
      if (row.org !== undefined) row.org = this.org
    }
    if (row._nom === 'espaces') {
      const r = compile(row)
      r.org = this.org
      row = r.toRow(this) // this ne sert qu'à récupérer ns
    }
    return row
  }

}

/* Classe GenDoc **************************************************/
export class GenDoc {
  /* Descriptifs des collections et sous-collection pour l'export*/
  static collsExp1 = ['espaces', 'syntheses']

  static collsExp2 = ['partitions', 'comptes', 'comptas', 'comptis', 'invits', 'avatars', 'groupes', 'versions']

  static collsExpA = ['notes', 'sponsorings', 'chats', 'tickets']

  static collsExpG = ['notes', 'membres', 'chatgrs']

  // Gérés en Cache - Pour Firestore gère une propriété id_V (A REVOIR)
  static majeurs = new Set(['partitions', 'comptes', 'comptas', 'comptis', 'invits', 'versions', 'avatars', 'groupes'])

  static sousColls = new Set(['notes', 'sponsorings', 'chats', 'membres', 'chatgrs', 'tickets'])

  /* Liste des attributs des (sous)collections- sauf singletons */
  static _attrs = {
    espaces: ['id', 'org', 'v', '_data_'],
    fpurges: ['id', '_data_'],
    partitions: ['id', 'v', '_data_'],
    syntheses: ['id', 'v', '_data_'],
    comptes: ['id', 'v', 'hk', 'dlv', '_data_'],
    comptis: ['id', 'v', '_data_'],
    invits: ['id', 'v', '_data_'],
    comptas: ['id', 'v', '_data_'],
    versions: ['id', 'v', 'dlv', '_data_'],
    avatars: ['id', 'v', 'vcv', 'hk', '_data_'],
    notes: ['id', 'ids', 'v', '_data_'],
    transferts: ['id', 'idf', 'dlv', '_data_'],
    sponsorings: ['id', 'ids', 'v', 'dlv', '_data_'],
    chats: ['id', 'ids', 'v', '_data_'],
    tickets: ['id', 'ids', 'v', '_data_'],
    groupes: ['id', 'v', 'dfh', '_data_'],
    membres: ['id', 'ids', 'v', '_data_'],
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
    la.forEach(a => { this[a] = a === '_data_' ? null : (a === 'org' ? '' : 0) })
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
  toRow (op) {
    const row = { _nom: this._nom, _vav: this._vav }
    row.id = ID.long(this.id, op.ns)
    if (this.ids !== undefined) row.ids = ID.long(this.ids, op.ns)
    if (this.hk !== undefined) row.hk = ID.long(this.hk, op.ns)
    if (this.v !== undefined) row.v = this.v
    if (this.vcv !== undefined) row.vcv = this.vcv
    if (this.dlv !== undefined) row.dlv = this.dlv
    if (this.dfh !== undefined) row.dfh = this.dfh
    if (this.org !== undefined) row.org = this.org
    if (this.idf !== undefined) row.idf = this.idf
    // le row est "zombi", c'est à dire sans _data_ quand son flag _zombi est à true
    if (!this._zombi) {
      const d = {}
      for (const [key, value] of Object.entries(this)) if (!key.startsWith('_')) d[key] = value
      d._nom = this._nom
      row._data_ = Buffer.from(encode(d))
    } else row._data_ = null
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

  excFerme() { if (this.clos) throw new AppExc(A_SRV, 999, this.clos); return this }

  excFige() { if (this.fige) throw new AppExc(F_SRV, 101, this.fige); return this }

  get fige () { return this.notifE && this.notifE.nr === 2 }

  get clos () { const n = this.notifE
    return n && n.nr === 3 ? [n.texte, n.dh] : null
  }

  static nouveau (org, auj, cleES) {
    return new Espaces().init({
      _maj: true, v: 0,
      id: '',
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
      tnotifP: {}
    })
  }

  cloneCourt () {
    return new Espaces().init({
      id: '',
      org: this.org,
      creation: this.creation,
      moisStat: this.moisStat,
      moisStatT: this.moisStatT,
      nprof: this.nprof,
      notifE: this.notifE,
      dlvat: this.dlvat,
      opt: this.opt,
      nbmi: this.nbmi,
      tnotifP: {}
    })
  }

  reset (cleET, hTC) {
    this.cleET = cleET
    this.hTC = hTC
    this._maj = true
  }

  comptableOK () {
    delete this.hTC
    this._maj = true
  }

  setPartition (id) {
    this.tnotifP[id] = null
    this._maj = true
  }

  supprPartition (id) {
    delete this.tnotifP[id]
    this._maj = true
  }

  setMoisStat (m) {
    this.moisStat = m
    this._maj = true
  }

  setMoisStatT (m) {
    this.moisStatT = m
    this._maj = true
  }

  setNotifP (ntf, id) {
    this.tnotifP[id] = ntf
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

  setOptions (optionA, nbmi) {
    if (optionA !== null) this.opt = optionA
    if (nbmi !== null) this.nbmi = nbmi
    this._maj = true
  }

  setDlvat (dlvat) {
    this.dlvat = dlvat
    this._maj = true
  }

  /* Restriction pour les délégués de la partition idp
  **Propriétés accessibles :**
    - administrateur technique : toutes de tous les espaces.
    - Comptable : toutes de _son_ espace.
    - Délégués : pas stats dlvat ...
    - tous comptes: la notification de _leur_ partition sera seule lisible.
  */
  toShortRow (op, ns) {
    const cl = this.cloneCourt()
    cl.ns = ns

    if (op.estAdmin) {
      cl.cleES = decrypterSrv(op.db.appKey, this.cleES)
      return cl.toRow(op)._data_
    }

    if (op.estComptable) {
      return cl.toRow(op)._data_
    }

    delete cl.moisStat; delete cl.moisStatT; delete cl.dlvat; delete cl.nbmi

    if (op.compte && op.compte.idp) {
      if (!op.compte.del) {
        const x = this.tnotifP[op.compte.idp]
        cl.tnotifP = x ? { x } : { }
      }
    } else { // par exemple depuis SyncSp
      delete cl.tnotifP
    }
    return cl.toRow(op)._data_
  }
}

/* Tickets **********************************************
_data_:
- `id`: id du Comptable.
- `ids` : numéro du ticket
- `v` : version du ticket.

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
      idc: idc, 
      ids: args.ids, 
      ma: args.ma, 
      refa: args.refa || '', 
      refc: '',
      mc: 0, 
      dr: 0
    })
  }

  setZombi () {
    this._suppr = true
    this._maj = true
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

  toShortRow (op) {
    const idc = this.idc; delete this.idc
    const row = this.toRow(op)._data_
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

  static qz = {qc: 0, qn: 0, qv: 0, c2m: 0, nn: 0, nc: 0, ng: 0, v: 0 }

  static nouveau (id, q) { // q: { qc, qn, qv } qc: apr[0], qn: apr[1], qv: apr[2],
    return new Partitions().init( {
      _maj: true, v: 0,
      id, q, nrp: 0, mcpt: {}
    })
  }

  toShortRow (op, del) {
    if (del) return this.toRow(op)._data_
    const sv = this.mcpt
    const m = {}
    for(const idx in this.mcpt) {
      const e = this.mcpt[idx]
      if (e.del) m[idx] = {  del: true, nr: 0, qv: Partitions.qz, cleAP: e.cleAP }
    }
    this.mcpt = m
    const row = this.toRow(op)._data_
    this.mcpt = sv
    return row
  }

  majQC(idc, qv, c2m) {
    const e = this.mcpt[idc]
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
    const r = { cleAP, nr: 0, q: { ...compta.qv }}
    if (del) r.del = true
    if (notif) r.notif = notif
    r.q.c2m = compta._c2m
    this.mcpt[compta.id] = r
    this._maj = true
  }

  retraitCompte (id) {
    delete this.mcpt[id]
    this._maj = true
  }

  setDel (id, del) {
    const e = this.mcpt[id]
    if (!e) return false
    e.del = del
    this._maj = true
    return true
  }

  setNotifC (id, notif) {
    const e = this.mcpt[id]
    if (e) e.notif = notif
    this._maj = true
  }

  estDel (id) {
    const e = this.mcpt[id]
    return e && e.del
  }

  getSynthese () {
    return synthesesPartition(this)
  }
}

/* Syntheses : un par espace ******************************
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

  static nouveau (/* ns */) { 
    return new Syntheses().init({
      _maj: true, v: 0,
      id: '',
      tsp: {}
    })
  }

  setPartition(p) {
    this.tsp[p.id] = synthesesPartition(p)
    this._maj = true
  }

  supprPartition(id) {
    delete this.tsp[id]
    this._maj = true
  }

  toShortRow (op) { return this.toRow(op)._data_}
}

/* Comptes ************************************************************
_data_ :
- `id` : numéro du compte = id de son avatar principal.
- `v` : 1..N.
- `hxr` : `ns` + `hXR`, hash du PBKFD d'un extrait de la phrase secrète.
- `dlv` : dernier jour de validité du compte.

- `vpe` : version du périmètre
- `vci` : version de Compti
- `vin` : version de Invit

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
  - _clé_ : id de l'avatar.
  - _valeur_ : `cleAK`: clé A de l'avatar crypté par la clé K du compte.

- `mpg` : map des participations aux groupes:
  - _clé_ : id du groupe
  - _valeur_: `{ cleGK, lav }`
    - `cleGK` : clé G du groupe cryptée par la clé K du compte.
    - `lav`: liste de ses avatars participant au groupe. compilé -> sav : Set

**Comptable seulement:**
- `tpk` : table des partitions `{cleP, code }` crypté par clé K du comptable. Son index est le numéro de la partition.
  - `cleP` : clé P de la partition.
  - `code` : code / commentaire court de convenance attribué par le Comptable
*/
export class Comptes extends GenDoc { 
  constructor() { super('comptes') }

  get _estA () { return !this.idp }

  get _estComptable () { return ID.estComptable(this.id) }

  toShortRow (op) {
    return this.toRow(op)._data_
  }

  get perimetre () {
    const p = []
    for (const ida in this.mav) p.push(ida)
    for (const idg in this.mpg) p.push(idg)
    p.sort((a,b) => { return a < b ? -1 : (a > b ? 1 : 0)})
    return p
  }

  compile () {
    this.perimetreAv = this.perimetre
    return this
  }

  get perimetreChg () { 
    const p = this.perimetre
    const pav = this.perimetreAv
    if (p.length !== pav.length) return p
    for (let i = 0; i < p.length; i++) if (p[i] !== pav[i]) return p
    return false
  }

  static nouveau (args, sp) {
    const r = {
      _maj: true, _majci: true, _majin: true,
      v: 0, vpe: 0, vci: 0, vin: 0,
      id: args.id,
      hk: args.hXR,
      hXC: args.hXC,
      dlv: AMJ.max, 
      cleKXC: args.cleKXC, 
      privK: args.privK,
      clePK: args.clePK,
      mav: {},
      mpg: {},
      tpk: {}
    }
    if (sp) { // sponsorisé
      if (sp.partitionId) {
        r.clePA = args.clePA
        r.idp = sp.partitionId
        r.del = sp.del
      } else {
        r.idp = ''
      }
      r.qv = { qc: sp.quotas.qc, qn: sp.quotas.qn, qv: sp.quotas.qv, pcc: 0, pcn: 0, pcv: 0, nbj: 0 }
    } else { // Comptable
      r.cleEK = args.cleEK
      r.clePA = args.clePA
      r.idp = args.idp
      r.del = true
      const aco = config.allocComptable
      r.qv = { qc: aco[0], qn: aco[1], qv: aco[2], pcc: 0, pcn: 0, pcv: 0, nbj: 0 }
      // args.ck: `{ cleP, code }` crypté par la clé K du comptable
      r.tpk[r.idp] = args.ck
    }
    r.perimetreAv = []
    return new Comptes().init(r)
  }

  setCI () { this._majci = true; this._maj = true }

  setIN () { this._majin = true; this._maj = true }

  setZombi () {
    this._suppr = true
    this._maj = true
  }

  setDesGroupes(ida, s) {
    this.lgr(ida).forEach(idg => { s.add(idg)})
  }

  setTousGroupes(s) {
    for(const idg in this.mpg) { s.add(idg) }
  }

  lgr (ida) { // liste des ids des groupes auxquels participe l'avatar ida
    const l = []
    for(const idg in this.mpg) {
      const e = this.mpg[idg]
      if (e.lav.indexOf(ida) !== -1) l.push(idg)
    }
    return l
  }

  chgPS (args) {
    this.hk = args.hps1
    this.hXC = args.hXC
    this.cleKXC = args.cleKXC
    this._maj = true
  }

  chgPart (idp, clePK, notif) {
    if (idp) {
      this.clePK = clePK
      this.idp = idp
      this.notif = notif || null
    } else {
      this.clePK = null
      this.idp = 0
      this.notif = null
    }
    this._maj = true
  }

  setDel (del) {
    if (this.idp) {
      this.del = del
      this._maj = true
    }
  }

  setNotif (notif) {
    this.notif = notif
    this._maj = true
  }

  // Comptable seulement
  ajoutPartition (idp, itemK) { // itemK: {cleP, code} crypté par la clé K du Comptable.
    this.tpk[idp] = itemK
    this._maj = true
  }

  supprPartition (idp) {
    delete this.tpk[idp]
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

  reporter (compta) { // pc de compta, nbj de compta
    const pc = compta._pc, nbj = compta._nbj, qv = compta.qv
    if (this.qv.qc !== qv.qc || this.qv.qn !== qv.qn || this.qv.qv !== qv.qv) return true
    if (Math.floor(this.qv.pcn / 20) !== Math.floor(pc.pcn / 20)) return true
    if (Math.floor(this.qv.pcv / 20) !== Math.floor(pc.pcv / 20)) return true
    if (this.qv.qc && (Math.floor(this.qv.pcc / 20) !== Math.floor(pc.pcc / 20))) return true
    if (!this.qv.qc && (Math.floor(this.qv.nbj / 20) !== Math.floor(nbj / 20))) return true
    return false
  }

  defDlv (e, auj, compta) {
    // DLV maximale : N mois depuis aujourd'hui
    const dlvmax = !e ? 0 : (AMJ.djMois(AMJ.amjUtcPlusNbj(auj, e.nbmi * 30)))
    // DLV maximale pour les comptes 0: dlvmax OU dlv de l'espace si plus proche
    const dlvmaxO = !e ? 0 :(e.dlvat && (dlvmax > e.dlvat) ? e.dlvat : dlvmax)

    let dlv
    if (this.idp) // Compte O
      dlv = ID.estComptable(this.id) ? AMJ.max : dlvmaxO
    else { // Compte A
      const d = AMJ.djMois(AMJ.amjUtcPlusNbj(auj, compta._nbj))
      dlv = dlvmax > d ? d : dlvmax
    }
    let diff1 = AMJ.diff(dlv, this.dlv)
    if (diff1 < 0) diff1 = -diff1
    return [dlv, diff1]
  }

  /* Report de compta et calcul DLV: seulement si,
  - compte était déjà en maj
  - OU chgt DLV significatif
  - OU report des compteurs significatif
  */
  async reportDeCompta (compta, gd) {
    compta.compile() // calcul _nbj _c2m _pc

    const e = await gd.getEspace()
    const [dlv, diff1] = this.defDlv (e, gd.op.auj, compta)

    const rep = this._maj || diff1 || this.reporter(compta)
    if (rep) {
      this.dlv = !ID.estComptable(this.id) ? dlv : AMJ.max
      if (!this._estA) this.qv.pcc = compta._pc.pcc 
      else this.qv.nbj = compta._nbj
      this.qv.pcn = compta._pc.pcn
      this.qv.pcv = compta._pc.pcv
      this.qv.qc = compta.qv.qc
      this.qv.qn = compta.qv.qn
      this.qv.qv = compta.qv.qv
      this._maj = true
      if (!this._estA) { // maj partition
        const p = await gd.getPA(this.idp)
        p.majQC(this.id, compta.qv, compta._c2m)
      }
    }
  }

  ajoutAvatar (avatar, cleAK) {
    this.mav[avatar.id] = cleAK
    this._maj = true
  }

  supprAvatar (ida) {
    delete this.mav[ida]
    this._maj = true
  }

  ajoutGroupe (idg, ida, cleGK) {
    let e = this.mpg[idg]
    if (!e) { e = { cleGK, lav: []}; this.mpg[idg] = e }
    if (e.lav.indexOf(ida) === -1) e.lav.push(ida)
    this._maj = true
  }

  supprGroupe (idg) {
    delete this.mpg[idg]
    this._maj = true
  }

  radier (idg, ida) {
    const e = this.mpg[idg]
    if (!e) return
    const i = e.lav.indexOf(ida)
    if (i === -1) return
    e.lav.splice(i, 1)
    if (e.lav.length === 0) delete this.mpg[idg]
    this._maj =true
  }

  estAvc (id) { return this.mav[id] }

  /* Mise à niveau des listes avatars / groupes du dataSync
  en fonction des avatars et groupes listés dans mav/mpg du compte 
  Ajoute les manquants dans ds, supprime ceux de ids absents de mav / mpg
  */
  majPerimetreDataSync (ds) {

    // Ajout dans ds des avatars existants dans le compte et inconnus de ds
    for(const ida in this.mav)
      if (!ds.avatars.has(ida)) 
        ds.avatars.set(ida, { id: ida, vs: 0, vb: 0 })
    
    /* Suppression de ds des avatars qui y étaient cités et sont inconnus du compte
    Suppression de leurs entrées dans idRds / rdsId */
    const sa = new Set(); for(const [ida,] of ds.avatars) sa.add(ida)
    for(const ida of sa) if (!this.mav[ida]) ds.avatars.delete(ida)

    // Ajout dans ds des groupes existants dans le compte et inconnus de ds
    for(const idg in this.mpg)
      if (!ds.groupes.has(idg)) 
        ds.groupes.set(idg, { id: idg, vs: 0, vb: 0, ms: false, ns: false, m: false, n:false })
    
    /* Suppression de ds des groupes qui y étaient cités et sont inconnus du compte
    Suppression de leurs entrées dans idRds / rdsId */
    const sg = new Set(); for(const [idg,] of ds.groupes) sg.add(idg)
    for(const idg of sg) if (!this.mpg[idg]) ds.groupes.delete(idg)
  }

  // Set des id des membres des participations au groupe idg
  idMbGr (idg) {
    const s = new Set()
    const x = this.mpg[idg]
    if (!x) return s
    for(const ida of x.lav) s.add(ida)
    return s
  }

  // Set des im des avatars du compte étant animateur */
  imAnimsDeGr (gr) {
    const s = new Set()
    const e = this.mpg[gr.id]
    if (!e || !e.lav || !e.lav.length) return s
    e.lav.forEach(idc => { 
      const im = gr.mmb.get(idc)
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

  setZombi () {
    this._suppr = true
    this._maj = true
  }

  setMc (id, ht, tx) {
    this.mc[id] = { ht, tx }
    this._maj = true
  }

  toShortRow (op) { return this.toRow(op)._data_ }
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

  setZombi () {
    this._suppr = true
    this._maj = true
  }

  toShortRow (op) { return this.toRow(op)._data_ }

  setDesGroupes(ida, s) {
    this.invits.forEach(i => { if (i.ida !== ida) s.push(i.idg)})
  }

  setTousGroupes(s) {
    this.invits.forEach(i => { s.push(i.idg)})
  }

  /* Ajoute / remplace l'entrée idg / ida par inv (contact) */
  setContact (inv) {
    const l = []
    this.invits.forEach(i => { if (i.idg !== inv.idg || i.ida !== inv.ida) l.push(i)})
    l.push(inv)
    this.invits = l
    this._maj = true
  }

  /* Supprime l'entrée idg / ida, n'est plus ni invité, ni contact */
  supprContact (idg, ida) {
    const l = []
    this.invits.forEach(i => { if (i.idg !== idg || i.ida !== ida) l.pudh(i)})
    this.invits = l
    this._maj = true
  }

  /* Ajoute / remplace l'entrée idg / ida par celle inv (invitation) */
  addInv (inv) {
    this.setContact(inv)
  }

  /* L'entrée idg / ida, si elle existe, redevient un contact */
  retourContact (idg, ida) {
    const l = []
    this.invits.forEach(i => { 
      if (i.idg === idg && i.ida === ida)
        l.push({ idg: i.idg, ida: i.ida, cleGA: i.cleGA, cvG: i.cvG, flags: 0 })
      else l.pudh(i)
    })
    this.invits = l
    this._maj = true
  }

  /* L'entrée idg / ida, si elle existe, est supprimée */
  supprInvit (idg, ida) {
    const l = []
    this.invits.forEach(i => { 
      if (i.idg !== idg || i.ida !== ida) l.pudh(i)
    })
    this.invits = l
    this._maj = true
  }

  /* L'entrée idg / ida, si elle existe, est supprimée */
  supprGrInvit (idg) {
    const l = []
    this.invits.forEach(i => { if (i.idg !== idg) l.pudh(i) })
    this.invits = l
    this._maj = true
  }
  
  majInvpar (idg, ida, setInv) {
    const l = []
    let m = false
    for (const inv of this.invits) {
      if (inv.idg === idg && inv.ida === ida) {
        const invpar = []
        for (const ip of inv.invpar) {
          const idcv = ip.cvA.id
          if (setInv.has(idcv)) invpar.push(ip)
        }
        if (invpar.length !== inv.invpar.length) {
          inv.invpar = invpar
          m = true
        }
      } else l.push(inv)
    }
    if (m) { this.invits = l; this._maj = true }
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

  setZombi () {
    this._suppr = true
    this._maj = true
  }

  toShortRow (op) { return this.toRow(op)._data_ }

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

  exN () {
    const x = this.qv.nn + this.qv.nc + this.qv.ng
    if (x > this.qv.qn * UNITEN) throw new AppExc(F_SRV, 55, [x, this.qv.qn * UNITEN])
  }

  exV () {
    const x = this.qv.v
    if (x > this.qv.qv * UNITEV) throw new AppExc(F_SRV, 56, [x, this.qv.qn * UNITEV])
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

  vPlus (q) {
    this.qv.v += q
    const c = new Compteurs(this.compteurs, this.qv)
    this.compteurs = c.serial
    this.majcpt(c)
    this._maj = true
  }

  finHeb (nn, vf) {
    this.qv.nn -= nn
    this.qv.v -= vf
    const c = new Compteurs(this.compteurs, this.qv)
    this.compteurs = c.serial
    this.majcpt(c)
    this._maj = true
  }

  debHeb (nn, vf) {
    this.qv.nn += nn
    this.qv.v += vf
    if ((this.qv.nn + this.qv.ng + this.qv.nc) > (this.qv.qn * UNITEN)) throw new AppExc(F_SRV, 281)
    if (this.qv.v > (this.qv.qv * UNITEV)) throw new AppExc(F_SRV, 282)
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

  reinitSoldeO () {
    this.solde = 0
    this.tickets = null
    this.compile()
    this._maj = true
  }

  reinitSoldeA () {
    this.solde = 2
    this.tickets = {}
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
    this.dons.push({dh, m, iddb})
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

}

/* Versions ************************************************************
*/
export class Versions extends GenDoc { 
  constructor() { super('versions') } 

  static nouveau (id) {
    return new Versions().init({
      v: 0,
      id: id,
      dlv: 0
    })
  }
}

/* Avatar *************************************************************
_data_:
- `id` : id de l'avatar.
- `v` : 1..N. Par convention, une version à 999999 désigne un **avatar logiquement détruit** mais dont les données sont encore présentes. L'avatar est _en cours de suppression_.
- `vcv` : version de la carte de visite afin qu'une opération puisse détecter (sans lire le document) si la carte de visite est plus récente que celle qu'il connaît.
- `hk` : hash du PBKFD de la phrase de contact réduite.

- `rds` :
- `cleAZC` : clé A cryptée par ZC (PBKFD de la phrase de contact complète).
- `pcK` : phrase de contact complète cryptée par la clé K du compte.
- `hZC` : hash du PBKFD de la phrase de contact complète.

- `cvA` : carte de visite de l'avatar `{id, v, photo, texte}`. photo et texte cryptés par la clé A de l'avatar.

- `pub privK` : couple des clés publique / privée RSA de l'avatar.
*/
export class Avatars extends GenDoc { 
  constructor() { super('avatars') } 

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

  setZombi () {
    this._suppr = true
    this._maj = true
  }

  setCv (cv) {
    cv.v = 0
    this.cvA = cv
    this._maj = true
  }

  setPC (args) {
    if (args.hZR) {
      this.hk = args.hZR
      this.hZC = args.hZC
      this.cleAZC = args.cleAZC
      this.pcK = args.pcK
    } else {
      this.hk = 0
      delete this.hZR
      delete this.pcK
      delete this.cleAZC
    }
    this._maj = true
  }

  toShortRow (op) { return this.toRow(op)._data_ }
}

/* Classe Notes *****************************************************
_data_:
- `id` : id de l'avatar ou du groupe.
- `ids` : identifiant aléatoire relatif à son avatar.
- `v` : 1..N.

- `rds`:
- `im` : exclusivité dans un groupe. L'écriture est restreinte au membre du groupe dont `im` est `ids`. 
- `vf` : volume total des fichiers attachés.
- `ht` : liste des hashtags _personnels_ cryptée par la clé K du compte.
  - En session, pour une note de groupe, `ht` est le terme de `htm` relatif au compte de la session.
- `htg` : note de groupe : liste des hashtags cryptée par la clé du groupe.
- `htm` : note de groupe seulement, hashtags des membres. Map:
    - _clé_ : id courte du compte de l'auteur,
    - _valeur_ : liste des hashtags cryptée par la clé K du compte.
    - non transmis en session.
- `l` : liste des _auteurs_ (leurs `im`) pour une note de groupe.
- `d` : date-heure de dernière modification du texte.
- `texte` : texte (gzippé) crypté par la clé de la note.
- `mfa` : map des fichiers attachés.
- `pid pids` : identifiant de sa note _parent_:
*/
export class Notes extends GenDoc { 
  constructor() { super('notes') } 

  static nouveau (id, ids, { im, dh, t, aut, pid, pids}) {
    const n = new Notes()
    n._maj = true
    n.id = id
    n.ids = ids,
    n.im = im
    n.vf = 0
    n.d = dh
    n.texte = t
    n.mfa = {}
    n.pid = pid || null
    n.pids = pid ? (pids || null) : null,
    n.ht = null
    if (ID.estGroupe(id)) {
      n.l = [aut]
      n.htg = null
      n.htm = {}
    }
    return n
  }

  toShortRow (op, idc) { //idc : id du compte demandeur
    if (this._zombi) {
      const x = { _nom: 'notes', id: this.id, ids: this.ids, v: this.v, _zombi: true}
      return encode(x)
    }
    const htmx = this.htm
    if (idc && this.htm) {
      const ht = this.htm[idc]
      if (ht) this.ht = ht
      delete this.htm
    }
    const r = this.toRow(op)._data_
    this.htm = htmx
    return r
  }

  setZombi () {
    this._zombi = true
    this._maj = true
  }

  setAut (im) {
    if (this.aut[0] === im) return
    const a = [im]; this.aut.forEach(i => { if (i !== im) a.push(i)})
    this.aut = a
    this._maj = true
  }

  setRef (pid, pids) {
    this.pid = pid
    this.pids = pid ? (pids || null) : null
    this._maj = true
  }

  setTexte (t, aut, dh) {
    this.d = dh
    this.texte = t
    if (aut) {
      const l = [aut]
      this.l.forEach(a => { if (a !== aut) l.push(a)})
      this.l = l
    }
    this._maj = true
  }

  setHT (htK, idc) {
    if (idc) {
      if (htK) this.htm[idc] = htK; else delete this.htm[idc]
    } else {
      if (htK) this.ht = htK; else this.ht = null
    }
    this._maj = true
  }

  setHTG (htG) {
    this.htg = htG;
    this._maj = true
  }

  setExclu (im) {
    this.im = im;
    this._maj = true
  }

  setFic (fic) {
    this.mfa[fic.idf] = fic
    this._maj = true
  }

  delFic (idf) {
    delete this.mfa[idf]
    this._maj = true
  }

  setVF () {
    let v = 0
    for (const idf in this.mfa) v += this.mfa[idf].lg 
    if (v > (this.qv * UNITEV)) throw new AppExc(F_SRV, 311)
    this.vf = v
    this._maj = true
  }
}

export class Transferts extends GenDoc { 
  constructor() { super('transferts') } 
}

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
      sp.partitionId = args.partitionId
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

  toShortRow (op) { return this.toRow(op)._data_ }
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
    this.cvE = cv
    this._maj = true
  }

  get stI() { return Math.floor(this.st / 10) }

  get stE () { return this.st % 10 }

  chEdisp () {
    if (this.stI) { // était actif
      this.st = (this.stI * 10) + 2 
      this.cvE = null
    } else { // était passif, disparait
      this._zombi = true
    }
    this._maj = true
  }

  actifI () {
    const x = 10 + this.stE
    if (x !== this.st) { this.st = x; this._maj = true }
  }

  actifE () {
    const x = (this.stI * 10) + 1
    if (x !== this.st) { this.st = x; this._maj = true }
  }

  setZombi () {
    this._zombi = true
    this._maj = true
  }

  passifI () {
    const x = this.stE
    if (x !== this.st || this.items.length) { this.st = x; this.items = []; this._maj = true }
  }

  passifE () {
    const x = this.stI * 10
    if (x !== this.st) { this.st = x; this._maj = true }
  }

  get estPassif () { return this.stI === 0 }

  toShortRow (op) { 
    if (this._zombi) {
      const x = { _nom: 'chats', id: this.id, ids: this.ids, v: this.v, _zombi: true}
      return encode(x)
    }
    return this.toRow(op)._data_
  }
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

  compile () {
    this.mmb = new Map()
    this.tid.forEach((id, im) => { 
      if (im) this.mmb.set(id, im)
    })
    return this
  }

  static nouveau (args) {
    args.cvG.v = 0
    return new Groupes().init({
      _maj: true, v: 0,
      id: args.idg, // id du groupe
      tid: [null, args.ida], // id de l'avatar fondateur
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

  setZombi () {
    this._suppr = true
    this._maj = true
  }

  estActif (im) { return this.st[im] >= 4 }

  accesNote2 (im) {
    const f = im ? this.flags[im] : 0
    const x = im && this.estActif(im) && (f & FLAGS.AN) && (f & FLAGS.DN) 
    if (!x) return 0
    return (f & FLAGS.DE) ? 2 : 1
  }

  finHeb (auj) {
    this.imh = 0
    this.idh = 0
    this.dfh = auj
    this.qn = 0
    this.qv = 0
    this._maj = true
  }

  majHeb (qn, qv, idh, imh) {
    this.dfh = 0
    this.idh = idh
    this.imh = imh
    this.qn = qn
    this.qv = qv
    this._maj = true
  }

  setNV (dn, dv) {
    this.nn += dn
    this.vf += dv
    this._maj = true
  }

  exN () { if (this.nn > this.qn * UNITEN) throw new AppExc(F_SRV, 65, [this.nn, this.qn * UNITEN]) }

  exV () { if (this.vf > this.qv * UNITEV) throw new AppExc(F_SRV, 66, [this.vf, this.qv * UNITEV]) }

  setCv (cv) {
    cv.v = 0
    this.cvG = cv
    this._maj = true
  }

  nvContact (ida) {
    const im = this.st.length
    this.tid.push(ida)
    const x = new Uint8Array(im + 1)
    this.flags.forEach((v, i) => {x[i] = v})
    x[im] = 0
    this.flags = x
    const y = new Uint8Array(im + 1)
    this.st.forEach((v, i) => {y[i] = v})
    y[im] = 1
    this.st = y
    this._maj = true
    return im
  }

  anContact (im, ln) {
    this.flags[im] = 0
    this.st[im] = 0
    const ida = this.tid[im]
    this.tid[im] = null
    if (ln && this.lnc.indexOf(ida) === -1) this.lnc.push(ida)
    this._maj = true
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
    const idm = this.tid[im]
    if (suppr > 1) this.tid[im] = 0
    this.flags[im] = 0
    if (suppr === 3 && this.lmg.indexOf(idm) === -1) 
      this.lmg.push(idm)
    this._maj = true
  }

  /* Vérifie que les invitants sont bien animateurs, sinon:
  - met à jour ou supprime invits
  - Map des ida des avatars dont les invitations sont à mettre à jour:
    - clé: ida
    - value: 
      - rc: true: retour contact, sinon maj de setInv
      - setInv: set des ids des invitants
  */
  majInvits () {
    const idas = new Map() // cle: ida, value: {rc, setInv}
    for (const imx in this.invits) {
      const im = parseInt(imx)
      const invit = this.invits[imx]
      const li = []
      for (const imi of invit.li) if (this.st[imi] === 5) li.push(imi)
      if (li.length === invit.li.length) continue // rien n'a changé pour cet avatar
      if (!li.length) { // redevient contact
        idas.set(this.tid[im], { rc: true, setInv: null })
        delete this.invits[imx]
        this.st[im] = 1
      } else {
        const setInv = new Set()
        for (const ix of li) setInv.add(this.tid[ix])
        idas.set(this.tid[im], { rc: false, setInv })
        invit.li = li
      }
      this._maj = true
    }
    return idas
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
    this._maj = true
  }

  /* Sérialisation en row après avoir enlevé 
  les champs non pertinents selon l'accès aux membres.
  Pas accès membre: tid ne contient que les entrées des avatars du compte */
  toShortRow (op, c, m) { // c : compte, m: le compte à accès aux membres
    let row
    const idh = this.idh; delete this.idh
    if (!m) {
      const tid = this.tid, lng = this.lng, lnc = this.lnc
      const tidn = new Array(tid.length)
      const s = new Set()
      const e = c.mpg[this.id]
      if (e) for (const ida of e.lav) {
        const im = this.mmb.get(ida)
        if (im) s.add(im)
      }
      for (let im = 0; im < tid.length; im++) tidn[im] = s.has(im) ? tid[im] : 0
      this.tid = tidn; delete this.lng; delete this.lnc
      row = this.toRow(op)._data_
      this.tid = tid; this.lnc = lnc; this.lng = lng
    } else {
      row = this.toRow(op)._data_
    }
    this.idh = idh
    return row
  }

  am (im) {
    const f = this.flags[im]
    return ((f & FLAGS.AM) && (f & FLAGS.DM))
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

  estAnim (s) { // s: set des id de membres (avatars d'un compte)
    for(const ida of s) {
      const im = this.mmb.get(ida)
      if (im && this.st[im] === 5) return true
    }
    return false
  }

  get nbActifs () {
    let n = 0
    for (let im = 1; im < this.st.length; im++) if (this.st[im] >= 4) n++
    return n
  }

  /* suppression du role de l'avatar dans le groupe
  Retour: { im, estHeb, nbActifs }
  */
  supprAvatar (ida) {
    const im = this.mmb.get(ida)
    const estHeb = im && im === this.imh
    if (im) {
      delete this.invits[im]
      this.st[im] = 0
      this.flags[im] = 0
      this.tid[im] = 0
      this.mmb.delete(im)
    }
    this._maj = true
    return { im, estHeb, nbActifs: this.nbActifs }
  }
}

/* Membres ***********************************************************
- `id` : id du groupe.
- `ids`: identifiant, indice `im` de membre relatif à son groupe.
- `v` : 

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
      ids: '' + im, 
      cvA: cvA, 
      cleAG: cleAG,
      dpc: 0, ddi: 0, dac: 0, fac: 0, dln: 0, fln: 0, den: 0, fen: 0, dam: 0, fam: 0
    })
    if (dx) for (const f in dx) m[f] = dx[f]
    return m
  }

  setZombi () {
    this._suppr = true
    this._maj = true
  }

  setCvA (cv) {
    this.cvA = cv
    this._maj = true
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

  toShortRow (op) { 
    if (this._zombi) {
      const x = { _nom: 'membres', id: this.id, ids: this.ids, v: this.v, _zombi: true}
      return encode(x)
    }
    return this.toRow(op)._data_
  }
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
      id: idg, ids: '1', items: []
    })
  }

  toShortRow (op) { return this.toRow(op)._data_ }

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

  supprItem (dh, dhx) {
    const l = []
    for(const x of this.items) {
      if (x.dh === dh) {
        l.push({ im: x.im, dh: x.dh, dhx: dhx, t: ''})
      } else l.push(x)
    }
    this.items = l
    this._maj = true
  }
}
