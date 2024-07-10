import { AppExc, F_SRV, ID, FLAGS, d14, AMJ } from './api.mjs'
import { config } from './config.mjs'
import { operations } from './cfgexpress.mjs'
import { eqU8, rnd6 } from './util.mjs'

import { Operation, R } from './modele.mjs'
import { compile, Transferts } from './gendoc.mjs'

// Pour forcer l'importation des opérations
export function load4 () {
  if (config.mondebug) config.logger.debug('Operations: ' + operations.auj)
}

/* Constructeur des opérations
  super (nom, authMode, excFige)
  authMode:
    0 : pas de contrainte d'accès (public)
    1 : le compte doit être authentifié
    2 : le compte doit être le comptable
    3 : administrateur technique requis
  excFige: (toujours 0 si authMode 3)
    1 : pas d'exception si figé. Lecture seulement ou estFige testé dans l'opération
    2 : exception si figé
  Après authentification, sont disponibles dans this:
    isGet, db, storage, args, dh
    id estA sync (ou null) setR 
    compte espace (lazy)
*/

/*`SetEspaceOptionA` : changement de l'option A, nbmi, dlvat par le Comptable
- `token` : jeton d'authentification du compte de **l'administrateur**
- `optionA` : 0 1 2.
- nbmi:
Retour: rien
*/
operations.SetEspaceOptionA = class SetEspaceOptionA extends Operation {
  constructor (nom) { super(nom, 2, 2)}

  async phase2 (args) {
    const espace = await this.getCheckEspace(true)
    espace.setOptions(args.optionA, args.nbmi)
  }
}

/*`SetEspaceDlvat` : changement de dlvat par l'administrateur
- `token` : jeton d'authentification du compte de **l'administrateur**
- ns: 
- dlvat: aaaammjj
Retour: rien
*/
operations.SetEspaceDlvat = class SetEspaceDlvat extends Operation {
  constructor (nom) { super(nom, 1, 0)}

  async phase2 (args) {
    this.ns = args.ns
    const espace = await this.gd.getES(true)
    espace.setDlvat(args.dlvat)
    // TODO : créer et réveiller la tache de nettoyage
  }
}

/** Ajout d\'un sponsoring ****************************************************
- `token` : éléments d'authentification du comptable / compte délégué de la partition.
- id : id du sponsor
- hYR : hash du PNKFD de la phrase de sponsoring réduite (SANS ns)
- `psK` : texte de la phrase de sponsoring cryptée par la clé K du sponsor.
- `YCK` : PBKFD de la phrase de sponsoring cryptée par la clé K du sponsor.
- `hYC` : hash du PBKFD de la phrase de sponsoring,
- `hYR` : hash du PBKFD de la phrase réduite de sponsoring,
- `cleAYC` : clé A du sponsor crypté par le PBKFD de la phrase complète de sponsoring.
- `partitionId`: id de la partition si compte 0    
- `cleAP` : clé A du COMPTE sponsor crypté par la clé P de la partition.
- `clePYC` : clé P de sa partition (si c'est un compte "O") cryptée par le PBKFD 
  de la phrase complète de sponsoring (donne l'id de la partition).
- `nomYC` : nom du sponsorisé, crypté par le PBKFD de la phrase complète de sponsoring.
- `cvA` : { id, v, ph, tx } du sponsor, (ph, tx) cryptés par sa cle A.
- `ardYC` : ardoise de bienvenue du sponsor / réponse du sponsorisé cryptée par le PBKFD de la phrase de sponsoring.

- `quotas` : `{qc, qn, qv}` pour un compte O, quotas attribués par le sponsor.
  - pour un compte "A" `[0, 1, 1]`. Un tel compte n'a pas de `qc` et peut changer à loisir
   `[qn, qv]` qui sont des protections pour lui-même (et fixe le coût de l'abonnement).
- don: montant du don pour un compte autonome sponsorisé par un compte autonome
- dconf: true, si le sponsor demande la confidentialité (pas de chat à l'avcceptation)
- del: true si le compte est délégué de la partition
Retour:
*/
operations.AjoutSponsoring = class AjoutSponsoring extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) {
    if (this.setR.has(R.LECT)) throw new AppExc(F_SRV, 801)
    if (this.setR.has(R.MINI)) throw new AppExc(F_SRV, 802)

    if (!this.compte.mav.has(args.id)) throw new AppExc(F_SRV, 308)

    if (await this.db.getSponsoringIds(this, (this.ns * d14) + args.hYR)) 
      throw new AppExc(F_SRV, 207)

    if (args.partitionId) { // compte O
      const partition = await this.gd.getPA(args.partitionId, 'AjoutSponsoring')
      if (!this.estComptable) {
        const e = partition.mcpt[this.compte.id]
        if (!e || !eqU8(e.cleAP, args.cleAP)) 
          throw new AppExc(F_SRV, 209, [args.partitionId, this.compte.id])
        if (!e.del) 
          throw new AppExc(F_SRV, 210, [args.partitionId, this.compte.id])
      }
      const s = partition.getSynthese()
      const q = args.quotas
      // restants à attribuer suffisant pour satisfaire les quotas ?
      if (q.qc > (s.q.qc - s.qt.qc) || q.qn > (s.q.qn - s.qt.qn) || q.qv > (s.q.sv - s.qt.qv))
        throw new AppExc(F_SRV, 211, [args.partitionId, this.compte.id])
    } else {
      if (this.estComptable || !this.compte._estA) args.don = 2
      else {
        if (this.compta.solde <= args.don + 2)
          throw new AppExc(F_SRV, 212, [this.compta.solde, args.don])
      }
    }

    await this.gd.nouvSPO(args, args.id, 'AjoutSponsoring')
  }
}

/* `ProlongerSponsoring` : prolongation d'un sponsoring existant
Change la date limite de validité du sponsoring pour une date plus lointaine. Ne fais rien si le sponsoring n'est pas _actif_ (hors limite, déjà accepté ou refusé).
POST:
- `token` : éléments d'authentification du comptable / compte sponsor de sa tribu.
- `id ids` : identifiant du sponsoring.
- `dlv` : nouvelle date limite de validité `aaaammjj`ou 0 pour une  annulation.

Retour: 
*/
operations.ProlongerSponsoring = class ProlongerSponsoring extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2(args) {
    if (this.setR.has(R.LECT)) throw new AppExc(F_SRV, 801)
    if (this.setR.has(R.MINI)) throw new AppExc(F_SRV, 802)

    const sp = await this.gd.getSPO(args.id, args.ids, 'ProlongerSponsoring')
    sp.prolonger(this.dh, args)
  }
}

/* GetCompta : retourne la compta d'un compte
- `token` : jeton d'authentification du compte
- `id` : du compte
Retour: rowCompta
*/
operations.GetCompta = class GetCompta extends Operation {
  constructor (nom) { super(nom, 1)}

  async phase2 (args) {
    const id = args.id || this.id
    if (id !== this.id && !this.estComptable) {
      if (!this.compte.del) throw new AppExc(F_SRV, 218)
      const partition = await this.gd.getPA(this.compte.idp, 'GetCompta-2')
      const e = partition.mcpt[id]
      if (!e) throw new AppExc(F_SRV, 219)
    }
    const compta = await this.gd.getCA(id, 'GetCompta-1')
    this.setRes('rowCompta', compta.toShortRow(this))
  }
}

/* `SetDhvuCompte` : enregistrement de la date-heure de _vue_ des notifications dans une session
POST: 
- `token` : éléments d'authentification du compte.
- `dhvu` : date-heure cryptée par la clé K.

Assertion sur l'existence du row `Comptas` du compte.
*/
operations.SetDhvuCompte = class SetDhvuCompte extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) {
    this.compte.setDhvu(args.dhvu)
  }
}

/** Récupération d\'un avatar par sa phrase de contact *******
- token: éléments d'authentification du compte.
- hZR: hash de la phrase de contact réduite
- hZC: hash de la phrase de contact complète
Retour:
- cleAZC : clé A cryptée par ZC (PBKFD de la phrase de contact complète)
- cvA: carte de visite cryptée par sa clé A
- collision: true si la phrase courte pointe sur un  autre avatar
*/
operations.GetAvatarPC = class GetAvatarPC extends Operation {
  constructor (nom) { super(nom, 1) }

  async phase2 (args) {
    const av = compile(await this.db.getAvatarHk(this, ID.long(args.hZR, this.ns)))
    if (!av) return
    const avatar = await this.gd.getAV(av.id, 'GetAvatarPC')
    if (avatar && avatar.hZC === args.hZC) {
      this.setRes('cleAZC', avatar.cleAZC)
      this.setRes('cvA', avatar.cvA)
    } else this.setRes('collision', true)
  }
}

/* OperationCh : super classe permettant d'utiliser la méthode intro() */
class OperationCh extends Operation {

  async intro1 () {
    if (this.setR.has(R.MINI)) await this.checkR()
  }

  // Vérification des restrictions, initialisations de :
  async intro2 () {
    this.chI = await this.gd.getCAV(this.args.id, this.args.ids, 'Chat-intro')
    this.chE = await this.gd.getCAV(this.chI.idE, this.chI.idsE)
    if (!this.chE) return false
    if (this.setR.has(R.MINI)) await this.checkR()
    return true
  }

  /* Restriction MINI : ne pas l'appliquer: 
  - Au Compatble ni en I ni en E.
  - Quand le chat est utilisé "en cas d'urgence", 
    c'est à dire si le compte souhaite s'adresser à un délégué de sa partition
  - A un délégué quand il s'adresse à un compte de sa partition.
  */
  async checkR () { // Le chat E existe
    if (this.compte._estA || this.estComptable || ID.estComptable(this.args.idE)) return
    const avE = await this.gd.getAV(this.args.idE)
    const cptE = await this.gd.getCO(avE.idc, 'Chat-intro') // cptE pas null (chE existe)
    if (this.compte.del && cptE.idp === this.compte.idp) return
    if (this.cptE.del && cptE.idp === this.compte.idp) return
    throw new AppExc(F_SRV, 802)
  }
}

/* OP_NouveauChat: 'Création d\'un nouveau chat' *********************************
- token: éléments d'authentification du compte.
- idI
- idE
- mode 
  - 0: par phrase de contact - hZC en est le hash
  - 1: idE est délégué de la partition de idI
  - idg: idE et idI sont co-membres du groupe idg (idI a accès aux membres)
- hZC : hash du PBKFD de la phrase de contact compléte pour le mode 0
- ch: { cck, ccP, cleE1C, cleE2C, t1c }
  - ccK: clé C du chat cryptée par la clé K du compte de idI
  - ccP: clé C du chat cryptée par la clé publique de idE
  - cleE1C: clé A de l'avatar E (idI) cryptée par la clé du chat.
  - cleE2C: clé A de l'avatar E (idE) cryptée par la clé du chat.
  - txt: item crypté par la clé C

Retour:
- `rowChat` : row du chat I.
*/
operations.NouveauChat = class NouveauChat extends OperationCh {
  constructor (nom) { super(nom, 1) }

  async phase2 (args) {
    if (this.compte.mav[args.idE]) throw new AppExc(F_SRV, 226)

    const avI = await this.gd.getAV(args.idI, 'NouveauChat-1')
    const avE = await this.gd.getAV(args.idE, 'NouveauChat-2')

    if (!args.mode) {
      if (avE.hZC !== args.hZC) throw new AppExc(F_SRV, 221)
    } else if (args.mode === 1) {
      if (!ID.estComptable(args.idE)) throw new AppExc(F_SRV, 225)
    } else if (args.mode === 2) {
      const partition = await this.gd.getPA(this.compte.idp)
      if (!partition || !partition.estDel(args.idE)) throw new AppExc(F_SRV, 222)
    } else {
      const groupe = await this.gd.getGR(args.mode)
      if (!groupe) throw new AppExc(F_SRV, 223)
      const imI = groupe.mmb.get(args.idI)
      const imE = groupe.mmb.get(args.idE)
      if (!imI || !imE) throw new AppExc(F_SRV, 223)
      const fI = groupe.flags[imI]
      if (!(fI & FLAGS.AC) && (fI & FLAGS.AM) && (fI & FLAGS.DM)) throw new AppExc(F_SRV, 223)
      if (!(fI & FLAGS.AC)) throw new AppExc(F_SRV, 223)
    }

    await this.intro1()

    const idsI = this.idsChat(args.idI, args.idE)
    const idsE = this.idsChat(args.idE, args.idI)

    let chI = await this.gd.getCAV(args.idI, idsI)
    if (chI) { this.setRes('rowChat', chI.toShortRow(this)); return}

    chI = await this.gd.nouvCAV({ 
      id: args.idI,
      ids: idsI,
      st: 11,
      idE: args.idE,
      idsE: idsE,
      cvE: avE.cvA,
      cleCKP: args.ch.ccK,
      cleEC: args.ch.cleE2C,
      items: [{a: 1, dh: this.dh, t: args.ch.txt}]
    })
    this.setRes('rowChat', chI.toShortRow(this))
    this.compta.ncPlus(1)

    await this.gd.nouvCAV({
      id: args.idE,
      ids: idsE,
      st: 11,
      idE: args.idI,
      idsE: idsI,
      cvE: avI.cvA,
      cleCKP: args.ch.ccP,
      cleEC: args.ch.cleE1C,
      items: [{a: 0, dh: this.dh, t: args.ch.txt}]
    })
    const comptaE = await this.gd.getCA(args.idE, 'NouveauChat-3')
    comptaE.ncPlus(1)
  }
}

/* Ajout ou suppression d\'un item à un chat ***************************************
- `token` : éléments d'authentification du compte auteur
- id, ids: id du chat
- t: texte gzippé crypté par la clé C du chat (null si suppression)
- dh : 0 ou date-heure de l'item du chat à supprimer
- don : montant du don de I à E
Retour:
- disp: true si E a disparu (pas de maj faite)
*/
operations.MajChat = class MajChat extends OperationCh {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) {
    if (!await this.intro2(args)) { 
      this.chI.chEdisp() // pas de chatE
      return
    }

    // cas normal : maj sur chI et chE - avE et cptE existent
    const avI = await this.gd.getAV(args.id, 'MajChat-2')
    const avE = await this.gd.getAV(this.chI.idE, 'MajChat-2')

    if (args.don) {
      if (!this.compte._estA) throw new AppExc(F_SRV, 214)
      const cptE = await this.gd.getCO(avE.idc) // cptE existe puisque chE existe ici
      if (!cptE || !cptE._estA) throw new AppExc(F_SRV, 214)
      const comptaE = await this.gd.getCA(cptE.id, 'MajChat-1')
      comptaE.don(this.dh, args.don, this.id)
      this.compta.don(this.dh, -args.don, this.cptE.id) // ici chE existe, donc cptE
    }

    if (args.t) {
      const itemI = args.t ? { a: 0, dh: this.dh, t: args.t } : null
      const itemE = args.t ? { a: 1, dh: this.dh, t: args.t } : null  
      this.chI.addChatItem(itemI)
      this.chE.addChatItem(itemE)
    } else if (args.dh) {
      this.chI.razChatItem(args.dh)
      this.chE.razChatItem(args.dh)
    }

    // Maj CVs
    this.chI.setCvE(avE.cvA || {id: avE.id, v: 0 })
    this.chE.setCvE(avI.cvA || {id: avI.id, v: 0 })
   
    if (this.chI.stI === 0) this.compta.ncPlus(1) // I était passif, redevient actif
    this.chI.actifI()
    this.chE.actifE()
  }
}

/* `PassifChat` : rend le chat passif, nombre de chat - 1, items vidé
Mise en état "passif" d\'un chat
Nombre de chat - 1, items vidé
- token : éléments d'authentification du compte.
- id ids : id du chat
Retour
- disp: true si E a disparu
*/
operations.PassifChat = class PassifChat extends OperationCh {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) { 
    if (!await this.intro2()) { // E disparu. I voulait être passif, devient détruit
      this.chI.setZombi()
      this.setRes('suppr', true)
      return
    }

    if (this.chI.estPassif) return // était passif, reste passif, rien n'a changé

    // chI était actif, devient passif - E pas disparu, MAJ de cv et st
    const avI = await this.gd.getAV(args.id, 'PassifChat-1')

    this.compta.ncPlus(-1)
    const avE = await this.gd.getAV(this.chI.idE, 'PassifChat-2')
    this.chI.passifI()
    this.chI.setCvE(avE.cvA)
    this.chE.setCvE(avI.cvA)
    this.chE.passifE()
  }
}

/* OP_ChangementPC: 'Changement de la phrase de contact d\'un avatar' *************************
token: éléments d'authentification du compte.
- `id`: de l'avatar
- `hZR`: hash de la phrase de contact réduite (SUPPRESSION si null)
- `cleAZC` : clé A cryptée par ZC (PBKFD de la phrase de contact complète).
- `pcK` : phrase de contact complète cryptée par la clé K du compte.
- `hZC` : hash du PBKFD de la phrase de contact complète.
Exceptions:
F_SRV, 26: Phrase de contact trop proche d\'une phrase existante.
*/
operations.ChangementPC = class ChangementPC extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) { 
    if (args.hZR && await this.db.getAvatarHk(this, ID.long(args.hZR, this.ns))) 
      throw new AppExc(F_SRV, 26) // trop proche existante

    if (!this.compte.mav[args.id]) throw new AppExc(F_SRV, 224)

    const avatar = await this.gd.getAV(args.id, 'ChangementPC-1')
    avatar.setPC(args)
  }
}

/* OP_StatutAvatar: 'Vérification que le bénéficiaire envisagé d\'un don est bien un compte autonome'
indique si l'avatar donné en argument est 
un avatar principal ou non, d'un compte autonome ou non
- token : jeton d'authentification du compte de **l'administrateur**
- id : id de l'avatar
Retour: [idc, idp]
- `idc`: id du compte
- `idp`: numéro de tranche de quota si compte "0", 0 si compte "A"
*/
operations.StatutAvatar = class StatutAvatar extends Operation {
  constructor (nom) { super(nom, 1) }

  async phase2(args) {
    const avatar = await this.gd.getAV(args.id, 'StatutAvatar-1')
    const c = await this.gd.getCO(avatar.idc)
    this.setRes('idcidp', [c.id, c.idp || 0])
  }
}

/* OP_RafraichirCvsAv: 'Rafraichissement des CVs des membres / chats de l\'avatar'
- token : jeton d'authentification du compte de **l'administrateur**
- id : id de l'avatar
- lch : liste des chats. { ids, idE, vcv }
- lmb : liste des membres: { id, im, ida, vcv}
Retour: [nc, nv]
- `nc`: nombre de CV mises à jour
- `nv` : nombre de chats existants
Exception générique:
- 8001: avatar disparu
*/
operations.RafraichirCvsAv = class RafraichirCvsAv extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2(args) {
    /* Restriction MINI NE s'applique QUE si le compte n'est pas le comptable */
    if (this.setR.has(R.MINI) && !this.estComptable) 
      throw new AppExc(F_SRV, 802)
    if (!this.compte.mav[args.id])
      throw new AppExc(F_SRV, 227)

    const avatar = await this.gd.getAV(args.id) //
    if (!avatar) throw new AppExc(F_SRV, 1)
    let nc = 0, nv = 0

    for(const {ids, idE, vcv} of args.lch) {
      const { av, disp } = await this.gd.getAAVCV(idE, vcv)
      if (disp) {
        const ch = await this.gd.getCAV(args.id, ids)
        if (ch) { nv++; ch.chEdisp() }
      } else if (av) {
        const ch = await this.gd.getCAV(args.id, ids)
        if (ch) { nv++; ch.setCvE(av.cvA); nc++ }
      }
    }

    for(const {id, im, ida, vcv} of args.lmb) {
      const { av } = await this.gd.getAAVCV(ida, vcv)
      if (av) {
        const mb = await this.gd.getMBR(id, im)
        if (mb) { nv++; mb.setCvA(av.cvA); nc++ }
      }
    }

    this.setRes('ncnv', [nc, nv])
  }
}

/* OP_RafraichirCvsGr: 'Rafraichissement des CVs des membres d\'un grouper'
- token : jeton d'authentification du compte de **l'administrateur**
- idg : id du groupe
- lmb : liste des membres: { id, im, ida, vcv}
Retour: [nc, nv]
- `nc`: nombre de CV mises à jour
- `nv` : nombre de chats existants
Exception générique:
- 8002: groupe disparu
*/
operations.RafraichirCvsGr = class RafraichirCvsGr extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2(args) {
    /* Restriction MINI NE s'applique QUE si le compte n'est pas le comptable */
    if (this.setR.has(R.MINI) && !this.estComptable) 
      throw new AppExc(F_SRV, 802)
    if (!this.compte.mpg[args.idg]) throw new AppExc(F_SRV, 275)

    const groupe = await this.gd.getGR(args.idg)
    if (!groupe) throw new AppExc(F_SRV, 2)
    let nc = 0, nv = 0

    for(const {id, im, ida, vcv} of args.lmb) {
      const { av } = await this.gd.getAAVCV(ida, vcv)
      if (av) {
        const mb = await this.gd.getMBR(id, im)
        if (mb) { nv++; mb.setCvA(av.cvA); nc++ }
      }
    }
    
    this.setRes('ncnv', [nc, nv])
  }
}

/* OP_SetQuotas: 'Fixation des quotas d'un compte dans sa partition'
- token: éléments d'authentification du compte.
- idp : id de la partition
- idc: id du compte
- q: {qc, qn, qv}
Retour:
*/
operations.SetQuotas = class SetQuotas extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) {
    const compta = (args.idc === this.id) ? this.compta : await this.gd.getCA(args.idc, 'SetQuotas-1')
    compta.quotas(args.q)
  }
}

/* OP_NouvellePartition: 'Création d\'une nouvelle partition' *******
Dans Comptes : **Comptable seulement:**
- `tpK` : table des partitions cryptée par la clé K du Comptable `[ {cleP, code }]`. Son index est le numéro de la partition.
  - `cleP` : clé P de la partition.
  - `code` : code / commentaire court de convenance attribué par le Comptable

- token: éléments d'authentification du compte.
- n : numéro de partition
- itemK: {cleP, code} crypté par la clé K du Comptable.
- quotas: { qc, qn, qv }
Retour:
*/
operations.NouvellePartition = class NouvellePartition extends Operation {
  constructor (nom) { super(nom, 2, 2) }

  async phase2 (args) {
    await this.gd.nouvPA(args.n, args.quotas)
    this.compte.ajoutPartition(args.n, args.itemK)
    const espace = await this.gd.getES(false, 'NouvellePartition-2')
    espace.setPartition(args.n)
  }
}

/* OP_SupprPartition: 'Création d\'une nouvelle partition' *******
Dans Comptes : **Comptable seulement:**
- `tpK` : table des partitions cryptée par la clé K du Comptable `[ {cleP, code }]`. Son index est le numéro de la partition.
  - `cleP` : clé P de la partition.
  - `code` : code / commentaire court de convenance attribué par le Comptable

- token: éléments d'authentification du compte.
- n : numéro de partition
Retour:
*/
operations.SupprPartition = class SupprPartition extends Operation {
  constructor (nom) { super(nom, 2, 2) }

  async phase2 (args) {
    const p = await this.gd.getPA(args.n, 'SupprPartition-1')
    let vide = true
    // eslint-disable-next-line no-unused-vars
    for(const id in p.mcpt) vide = false
    if (!vide) throw new AppExc(F_SRV, 271)
    this.compte.supprPartition(args.n)
    const espace = await this.gd.getES(false, 'SupprPartition-2')
    espace.supprPartition(args.n)
    const s = await this.gd.getSY(this.ns)
    s.supprPartition(args.n)
  }
}

/* OP_SetQuotasPart: 'Mise à jour des quotas d\'une partition'
- token: éléments d'authentification du compte.
- idp : id de la partition
- quotas: {qc, qn, qv}
Retour:
*/
operations.SetQuotasPart = class SetQuotasPart extends Operation {
  constructor (nom) { super(nom, 2, 2) }

  async phase2 (args) {
    const partition = await this.gd.getPA(args.idp)
    partition.setQuotas(args.quotas)
  }
}

/* OP_SetCodePart: 'Mise à jour du code d\'une partition'
- token: éléments d'authentification du compte.
- idp : id de la partition
- etpk: {codeP, code} crypté par la clé K du Comptable
Retour:
*/
operations.SetCodePart = class SetCodePart extends Operation {
  constructor (nom) { super(nom, 2, 2) }

  async phase2 (args) {
    if (!this.compte.setCodePart(args.idp, args.etpk)) throw new AppExc(F_SRV, 229)
  }
}

/*  OP_MuterCompteA: 'Mutation du compte O en compte A' ************
- token: éléments d'authentification du compte.
Retour:
*/
operations.MuterCompteA = class MuterCompteA extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 () {
    if (!this.compte.idp) throw new AppExc(F_SRV, 289)
    const q = this.compta.qv
    this.compta.quotas({ qc: 0, qn: q.qn, qv: q.qv })
    this.compta.reinitSoldeA()

    const part = await this.gd.getPA(this.compte.idp, 'MuterCompteA-4')
    part.retraitCompte(this.id)

    // Maj du compte
    this.compte.chgPart(0)
  }
}

/*  OP_MuterCompteO: 'Mutation d\'un compte A en compte O' ************
- token: éléments d'authentification du compte.
- id : id du compte devenant O
- quotas: { qc, qn, qv }
- cleAP : clé A du compte cryptée par la clé P de la partition
- clePK : clé de la nouvelle partition cryptée par la clé publique du compte
- ids : ids du chat du compte demandeur (Comptable / Délégué)
- t : texte (crypté) de l'item à ajouter au chat
Retour:
*/
operations.MuterCompteO = class MuterCompteO extends Operation {
  constructor (nom) { super(nom, 2, 2) }

  async phase2 (args) {
    const ec = this.estComptable
    const ed = !ec && this.compte.del
    if (!ec && !ed) throw new AppExc(F_SRV, 287)
    const idp = this.compte.idp

    const cpt = await this.gd.getCO(args.id, 'MuterCompteO-2')
    if (cpt.idp) throw new AppExc(F_SRV, 288)
    const compta = await this.gd.getCA(args.id, 'MuterCompteO-3')
    compta.quotas(args.quotas)
    compta.reinitSoldeO()

    const part = await this.gd.getPA(idp, 'MuterCompteO-4')
    part.ajoutCompte(compta, args.cleAP, false)

    // Maj du compte
    cpt.chgPart(idp, args.clePK, null)

    const chI = await this.gd.getCAV(this.id, args.ids, 'MuterCompteO-5')
    const chE = await this.gd.getCAV(chI.idE, chI.idsE)
    if (!chE) { // pas de chatE: pas de mise à jour de chat I
      chI.chEdisp()
      return
    }
    // cas normal : maj sur chI et chE - avE et cptE existent
    const avI = await this.gd.getAV(this.id, 'MuterCompteO-6')
    const avE = await this.gd.getAV(chI.idE, 'MuterCompteO-7')
    if (args.t) {
      const itemI = args.t ? { a: 0, dh: this.dh, t: args.t } : null
      const itemE = args.t ? { a: 1, dh: this.dh, t: args.t } : null  
      chI.addChatItem(itemI)
      chE.addChatItem(itemE)
    }
    // Maj CVs
    chI.setCvE(avE.cvA || {id: avE.id, v: 0 })
    chE.setCvE(avI.cvA || {id: avI.id, v: 0 })

    if (chI.stI === 0) this.compta.ncPlus(1) // I était passif, redevient actif
    chI.actifI()
    chE.actifE()
  }
}

/*  OP_ChangerPartition: 'Transfert d\'un compte O dans une autre partition' ************
- token: éléments d'authentification du compte.
- id : id du compte qui change de partition
- idp : id de la nouvelle partition
- cleAP : clé A du compte cryptée par la clé P de la nouvelle partition
- clePK : clé de la nouvelle partition cryptée par la clé publique du compte
- notif: notification du compte cryptée par la clé P de la nouvelle partition
Retour:
*/
operations.ChangerPartition = class ChangerPartition extends Operation {
  constructor (nom) { super(nom, 2, 2) }

  async phase2 (args) {
    if (this.id === args.id) throw new AppExc(F_SRV, 234)
    const cpt = await this.gd.getCO(args.id, 'ChangerPartition-1')
    const compta = await this.gd.getCA(args.id)
    const partav = await this.gd.getPA(cpt.idp, 'ChangerPartition-2')
    const epav = partav.mcpt[args.id]
    if (!epav) throw new AppExc(F_SRV, 232)
    const partap = await this.gd.getPA(args.idp, 'ChangerPartition-3')
    const epap = partap.mcpt[args.id]
    if (epap) throw new AppExc(F_SRV, 233)

    partav.retraitCompte(args.id)
    partap.ajoutCompte(compta, args.cleAP, false, args.notif || null)

    // Maj du compte
    cpt.chgPart(partap.id, args.clePK, args.notif || null)
  }
}

/*  OP_DeleguePartition: 'Changement de statut délégué d\'un compte dans sa partition' ************
- token: éléments d'authentification du compte.
- id : id du compte qui change de statut
- del: true / false, statut délégué
Retour:
*/
operations.DeleguePartition = class DeleguePartition extends Operation {
  constructor (nom) { super(nom, 2, 2) }

  async phase2 (args) {
    if (this.id === args.id) throw new AppExc(F_SRV, 234)
    const cpt = await this.gd.getCO(args.id, 'DeleguePartition-1')
    const part = await this.gd.getPA(cpt.idp, 'DeleguePartition-2')
    cpt.setDel(args.del)
    if (!part.setDel(args.id, args.del)) throw new AppExc(F_SRV, 232)
  }
}

/* `SetNotifP` : notification d'une partition
- `token` : éléments d'authentification du compte.
- `idp` : id de la partition
- `notif` : notification cryptée par la clé de la partition.
*/
operations.SetNotifP = class SetNotifP extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) {
    const ec = this.estComptable
    const ed = !ec && this.compte.del
    if ((!ec && !ed) || (ed && this.compte.idp !== args.idp)) throw new AppExc(F_SRV, 235)
    
    const espace = await this.gd.getES(false, 'SetNotifP-1')
    const ntf = espace.tnotifP[args.idp]
    const aut = ntf ? (ntf.idDel ? ntf.idDel : ID.duComptable(this.ns)) : null
    if (aut && ed && ID.estComptable(aut)) throw new AppExc(F_SRV, 237)
    if (args.notif) args.notif.idDel = this.id
    espace.setNotifP(args.notif, args.idp)

    const partition = await this.gd.getPA(args.idp, 'SetNotifP-2')
    partition.setNrp(args.notif)
  }
}

/* `SetNotifC` : notification d'un compte "O"
- `token` : éléments d'authentification du compte.
- `idc` : id du compte
- `notif` : notification du compte cryptée par la clé de partition
*/
operations.SetNotifC = class SetNotifC extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) {
    const compte = await this.gd.getCO(args.idc, 'SetNotifC-1')

    const ec = this.estComptable
    const ed = !ec && this.compte.del
    if ((!ec && !ed) || (ed && this.compte.idp !== compte.idp)) throw new AppExc(F_SRV, 238)

    const ntf = compte.notif
    const aut = ntf ? (ntf.idDel ? ntf.idDel : ID.duComptable(this.ns)) : null
    if (aut && ed && ID.estComptable(aut)) throw new AppExc(F_SRV, 237)
    if (args.notif) args.notif.idDel = this.id

    compte.setNotif(args.notif || null)

    const partition = await this.gd.getPA(compte.idp, 'SetNotifC-3')
    partition.setNotifC(args.idc, args.notif || null)
  }
}

/* OP_PlusTicket: 'Génération d\'un ticket de crédit'
et ajout du ticket au Comptable
- token : jeton d'authentification du compte de **l'administrateur**
- ma: montant attendu
- refa: référence éventuelle du compte
- ids: ids du ticket généré
Retour: 
- rowCompta: du compte après insertion du ticket
*/
operations.PlusTicket = class PlusTicket extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2(args) {
    const rtk = await this.gd.getTKT(args.ids)
    if (rtk) throw new AppExc(F_SRV, 239)

    const tk = await this.gd.nouvTKT(this.id, args)
    this.compta.plusTk(tk)
  }

  phase3() {
    this.setRes('rowCompta', this.compta.toShortRow(this))
  }
}

/* `MoinsTicket` : retrait d'un ticket à un compte A
et retrait d'un ticket au Comptable
- token : jeton d'authentification du compte
- ids : ticket à enlever
Retour: 
- rowCompta
*/
operations.MoinsTicket = class MoinsTicket extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2(args) {
    const tk = await this.gd.getTKT(args.ids)
    if (!tk) throw new AppExc(F_SRV, 240)
    tk.setZombi()
    this.compta.moinsTk(tk)
  }

  phase3() {
    this.setRes('rowCompta', this.compta.toShortRow(this))
  }
}

/* OP_ReceptionTicket: 'Réception d\'un ticket par le Comptable'
- `token` : jeton d'authentification du compte
- `ids` : du ticket
- `mc` : montant reçu
- `refc` : référence du Comptable
Retour: rien
*/
operations.ReceptionTicket = class ReceptionTicket extends Operation {
  constructor (nom) { super(nom, 2, 2) }

  async phase2(args) {

    const tk = await this.gd.getTKT(args.ids)
    if (!tk) throw new AppExc(F_SRV, 240)
    if (tk.dr) throw new AppExc(F_SRV, 241)

    const compte = await this.gd.getCO(tk.idc)
    const compta = await this.gd.getCA(tk.idc)
    if (!compta || !compte) { // Compte disparu
      tk.setDisp()
    } else {
      tk.reception(this.auj, args.mc, args.refc)
      compta.enregTk(tk, args.mc, args.refc)
      await compte.reportDeCompta(compta, this.gd)
    }
  }
}

/* MajCv : Mise à jour de la carte de visite d\'un avatar ******************************************
- token : jeton d'authentification du compte
- cv : carte de visite (photo / texte cryptés)
Retour:
*/
operations.MajCv = class MajCv extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2(args) {
    if (this.setR.has(R.MINI)) throw new AppExc(F_SRV, 802)
    if (this.setR.has(R.LECT)) throw new AppExc(F_SRV, 801)

    if (!ID.estGroupe(args.cv.id)) {
      if (!this.compte.mav[args.cv.id]) throw new AppExc(F_SRV, 242)
      const avatar = await this.gd.getAV(args.cv.id, 'MajCv-1')
      avatar.setCv(args.cv)
    } else {
      const e = this.compte.mpg[args.cv.id]
      if (!e) throw new AppExc(F_SRV, 243)
      const groupe = await this.gd.getGR(args.cv.id, 'MajCv-3')
      const anims = groupe.anims
      let ok = false
      for(const ida of e.lav) 
        if (anims.has(groupe.mmb.get(ida))) ok = true
      if (!ok) throw new AppExc(F_SRV, 243)
      groupe.setCv(args.cv)
    }
  }
}

/* OP_GetCv : Obtention de la carte de visite d\'un avatar ******************************************
- token : jeton d'authentification du compte
- id : id du people
- ch: [id, ids] id d'un chat d'un des avatars du compte avec le people
Retour:
- cv: si trouvée
*/
operations.GetCv = class GetCv extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2(args) {
    if (this.setR.has(R.LECT)) throw new AppExc(F_SRV, 801)

    if (!ID.estGroupe(args.id)) {
      if (args.ch) {
        if (this.compte.mav[args.ch[0]]) {
          const chat = await this.getRowChat(args.ch[0], args.ch[1])
          if (!chat) throw new AppExc(F_SRV, 244)
        } else throw new AppExc(F_SRV, 244)
      } else {
        if (!this.compte.mav[args.id]) throw new AppExc(F_SRV, 242)
      }
      const avatar = await this.gd.getAV(args.id, 'MajCv-1')
      this.setRes('cv', avatar.cvA)
    } else {
      const e = this.compte.mpg[args.cv.id]
      if (!e) throw new AppExc(F_SRV, 243)
      const groupe = await this.gd.getGR(args.id, 'MajCv-3')
      let ok = false
      for(const ida of e.lav)
        if (groupe.mmb.get(ida)) ok = true
      if (!ok) throw new AppExc(F_SRV, 243)
      this.setRes('cv', groupe.cvG)
    }
  }
}

/*OP_NouvelAvatar: 'Création d\'un nouvel avatar du compte' **********************
- token: éléments d'authentification du compte.
- id: de l'avatar à créér
- cleAK : sa clé A cryptée par la clé K
- pub: sa clé RSA publique
- priv: sa clé RSA privée cryptée par la clé K
- cvA: sa CV cryptée par sa clé A
Retour:
*/
operations.NouvelAvatar = class NouvelAvatar extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2(args) {
    if (this.setR.has(R.MINI)) throw new AppExc(F_SRV, 802)
    if (this.setR.has(R.LECT)) throw new AppExc(F_SRV, 801)

    if (this.compte.mav[args.id]) return // création déjà faite pour le compte
    const a = await this.gd.getAV(args.id)
    if (a) throw new AppExc(F_SRV, 245)

    this.gd.nouvAV(this.compte, args, args.cvA)
  }
}

/* OP_McMemo Changement des mots clés et mémo attachés à un contact ou groupe ********************************
- token: éléments d'authentification du compte.
- id: de l'avatar ou du groupe
- htK : hashtags séparés par un espace et crypté par la clé K
- txK : texte du mémo gzippé et crypté par la clé K
*/
operations.McMemo = class McMemo extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) { 
    if (this.setR.has(R.MINI)) throw new AppExc(F_SRV, 802)
    if (this.setR.has(R.LECT)) throw new AppExc(F_SRV, 801)

    const compti = await this.gd.getCI(this.id, 'McMemo-2')
    compti.setMc(this.id, args.htK, args.txK)
  }
}

/* OP_ChangementPS: 'Changement de la phrase secrete de connexion du compte' ********************
- token: éléments d'authentification du compte.
- hps1: hash du PBKFD de la phrase secrète réduite du compte.
- hXC: hash du PBKFD de la phrase secrète complète.
- cleKXC: clé K cryptée par la phrase secrète
*/
operations.ChangementPS = class ChangementPS extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) { 
    /*
    - `hxr` : `ns` + `hXR`, hash du PBKFD d'un extrait de la phrase secrète.
    - `hXC`: hash du PBKFD de la phrase secrète complète (sans son `ns`).
    - `cleKXC` : clé K cryptée par XC (PBKFD de la phrase secrète complète).
    */
    this.compte.chgPS(args)
  }
}

/* Nouveau groupe *****************************************************
- token donne les éléments d'authentification du compte.
- idg : du groupe
- ida : de l'avatar fondateur
- cleAG : clé A de l'avatar cryptée par la clé G
- cleGK : clé du groupe cryptée par la clé K du compte
- cvG: carte de visite du groupe crypté par la clé G du groupe
- msu: true si mode simple
- quotas: { qn, qv } maximum de nombre de notes et de volume fichiers
Retour:
Exception:
- 8001: avatar disparu
*/
operations.NouveauGroupe = class NouveauGroupe extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) { 
    const rg = await this.gd.getGR(args.idg)
    if (rg) throw new AppExc(F_SRV, 246)

    const avatar = await this.gd.getAV(args.ida)
    if (!avatar) throw new AppExc(F_SRV, 1)

    this.gd.nouvGR(args)
    const dx = { dpc: this.auj, dac: this.auj, dln: this.auj, den: this.auj, dam: this.auj }
    await this.gd.nouvMBR(args.idg, 1, avatar.cvA, args.cleAG, dx)

    this.compta.ngPlus(1)
  }
}

/* Nouveau contact *****************************************************
- token donne les éléments d'authentification du compte.
- idg : du groupe
- ida : de l'avatar contact
- cleAG : clé A du contact cryptée par la clé G du groupe
- cleGA : clé G du groupe cryptée par la clé A du contact
Retour:
EXC: 
- 8002: groupe disparu
- 8001: avatar disparu
*/
operations.NouveauContact = class NouveauContact extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) { 
    const groupe = await this.gd.getGR(args.idg)
    if (!groupe) throw new AppExc(F_SRV, 2)
    const avatar = await this.gd.getAV(args.ida)
    if (!avatar) throw new AppExc(F_SRV, 1)

    // const groupe = compile(await this.getRowGroupe(args.idg, 'NouveauContact-1'))
    let ok = false
    for(const x in this.compte.mav) {
      const idav = parseInt(x)
      const im = groupe.mmb.get(idav)
      const f = groupe.flags[im]
      if (im && groupe.st[im] >= 4 && (f & FLAGS.AM) && (f & FLAGS.DM) ) { ok = true; break }
    }
    if (!ok) throw new AppExc(F_SRV, 247)
    if (groupe.mmb.get(args.ida)) throw new AppExc(F_SRV, 248)
    if (groupe.lnc.indexOf(args.ida) !== -1) throw new AppExc(F_SRV, 260)
    if (groupe.lng.indexOf(args.ida) !== -1) throw new AppExc(F_SRV, 261)
    
    const im = groupe.nvContact(args.ida)
    const dx = { dpc: this.auj}
    await this.gd.nouvMBR(args.idg, im, avatar.cvA, args.cleAG, dx)

    const cinvit = await this.gd.getIN(avatar.idc, 'InvitationGroupe-2b')
    const invx = { 
      idg: args.idg,
      ida: args.ida,
      cleGA: args.cleGA, 
      cvG: groupe.cvG, 
      flags: 0,  
      msgG: null 
    }
    cinvit.setContact(invx)
  }
}

/* OP_ModeSimple: 'Demande de retour au mode simple d\'invitation à un groupe' **********
- token donne les éléments d'authentification du compte.
- idg : id du groupe
- ida : id de l'avatar demandant le retour au mode simple.
- simple:
  - true 'Je vote pour passer au mode "SIMPLE"'
  - false: 'Annuler les votes et rester en mode UNANIME'
Retour:
EXC: 
- 8002: groupe disparu
*/
operations.ModeSimple = class ModeSimple extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) { 
    const gr = await this.gd.getGR(args.idg)
    if (!gr) throw new AppExc(F_SRV, 2)

    if (!this.compte.mav[args.ida]) throw new AppExc(F_SRV, 249)
    const im = gr.mmb.get(args.ida)
    if (!im || gr.st[im] !== 5) throw new AppExc(F_SRV, 250)
    
    gr.setMsu(args.simple, im)
  }
}

/* OP_AnnulerContact: 'Annulation du statut de contact d\'un groupe par un avatar' **********
- token donne les éléments d'authentification du compte.
- idg : id du groupe
- ida : id de l'avatar demandant l'annulation.
- ln : true Inscription en liste noire
Retour:
EXC: 
- 8002: groupe disparu
*/
operations.AnnulerContact = class AnnulerContact extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) { 
    const gr = await this.gd.getGR(args.idg)
    if (!gr) throw new AppExc(F_SRV, 2)

    if (!this.compte.mav[args.ida]) throw new AppExc(F_SRV, 249)
    const im = gr.mmb.get(args.ida)
    if (!im || gr.st[im] !== 1) throw new AppExc(F_SRV, 272)
    gr.anContact(im, args.ln)
    const mb = await this.gd.getMBR(args.idg, im, 'AnnulerContact-1')
    mb.setZombi()
    const invit = await this.gd.getIN(this.compte.id)
    invit.supprContact(args.idg, args.ida)
  }
}

/* OP_InvitationGroupe: 'Invitation à un groupe' **********
- token donne les éléments d'authentification du compte.
- idg: id du groupe
- idm: id du membre invité
- rmsv: 0: inviter, 2: modifier, 3: supprimer, 4: voter pour
- flags: flags d'invitation
- msgG: message de bienvenue crypté par la clé G du groupe
- idi: id de l'invitant pour le mode d'invitation simple 
  (sinon tous les avatars du comptes animateurs du groupe)
- suppr: 1-contact, 2:radié, 3-radié + LN
- cleGA: clé G du groupe cryptée par la clé A de l'invité
Retour:
EXC: 
- 8002: groupe disparu
- 8001: avatar disparu
*/
operations.InvitationGroupe = class InvitationGroupe extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) { 
    const gr = await this.gd.getGR(args.idg)
    if (!gr) throw new AppExc(F_SRV, 2)
    const avatar = await this.gd.getAV(args.idm)
    if (!avatar) throw new AppExc(F_SRV, 1)

    if (gr.lnc.indexOf(args.idm) !== -1) throw new AppExc(F_SRV, 260)
    if (gr.lng.indexOf(args.idm) !== -1) throw new AppExc(F_SRV, 261)

    const cinvit = await this.gd.getIN(avatar.idc, 'InvitationGroupe-2b')

    const im = gr.mmb.get(args.idm)
    if (!im) throw new AppExc(F_SRV, 251)
    const membre = await this.gd.getMBR(args.idg, im, 'InvitationGroupe-3')

    const s = gr.st[im]
    
    if (args.suppr) { // suppression de l'invitation
      if (s < 2 || s > 3) throw new AppExc(F_SRV, 252)
      gr.supprInvit(im, args.suppr)
      cinvit.retourContact(args.idg, args.idm)
      membre.supprRad(args.suppr)
      return
    } 
    
    // Création 0 / modification 2 / vote pour 4
    if (args.rmsv === 0 && s !== 1) throw new AppExc(F_SRV, 256) // création mais pas contact
    if ((args.rmsv === 2 || args.rmsv === 4) && (s < 2 || s > 3)) 
      throw new AppExc(F_SRV, 257) // modification ou vote mais pas déjà (pré) invité
    if (!gr.msu && args.rmsv === 4) throw new AppExc(F_SRV, 258) // vote mais pas en mode unanime
    if (!gr.msu && !args.idi) throw new AppExc(F_SRV, 255) // mode simple et absence d'avatar invitant

    // construction de l'item invit dans groupe
    let aInviter = false // inviter effectivement (sinon laisser en pré-invité)
    const invit = { fl: args.flags, li: [] }
    if (args.idi) {
      if (!this.compte.mav[args.idi]) 
        throw new AppExc(F_SRV, 249) // invitant non membre du groupe
      const imi = gr.mmb.get(args.idi)
      if (!imi || gr.st[imi] !== 5) 
        throw new AppExc(F_SRV, 254) // invitant non animateur
      invit.li.push(imi)
      aInviter = true
    } else {
      // Vote : TOUS les avatars du compte animateurs du groupe votent OUI ensemble
      const s1 = this.compte.imAnimsDeGr(gr)
      const invita = gr.invits[im]
      if (invita && invita.fl === args.flags) // flags identiques : cumuls des votes
        invita.li.forEach(i => { s1.add(i)})
      const s2 = gr.anims // Tous les animateurs du groupe
      s1.forEach(i => { if (s2.has(i)) invit.li.push(i)})
      aInviter = s2.size === invit.li.length
    }
    gr.setInvit(im, invit, aInviter)

    // Construction de l'invitation à transmettre à l'avatar invité
    /* - `invits`: liste des invitations en cours (dans le document invits)
      - `idg`: id du groupe,
      - `ida`: id de l('avatar invité
      - `cleGA`: clé du groupe crypté par la clé A de l'avatar.
      - `cvG` : carte de visite du groupe (photo et texte sont cryptés par la clé G du groupe).
      - `flags` : d'invitation.
      - `invpar` : `[{ cleAG, cvA }]`
        - `cleAG`: clé A de l'avatar invitant crypté par la clé G du groupe.
        - `cvA` : carte de visite de l'invitant (photo et texte sont cryptés par la clé G du groupe). 
      - `msgG` : message de bienvenue / invitation émis par l'invitant.
    */
    if (aInviter) {
      const invpar = []
      const invx = { 
        idg: args.idg,
        ida: args.idm,
        cleGA: args.cleGA, 
        cvG: gr.cvG, 
        flags: args.flags, 
        invpar, 
        msgG: args.msgG 
      }
      for (const im of invit.li) {
        const mb = await this.gd.getMBR(gr.id, im, 'InvitationGroupe-5')
        if (mb) invpar.push({ cleAG: mb.cleAG, cvA: mb.cvA })
      }
      cinvit.addInv(invx)
    }

    // écriture du chat
    if (aInviter) {
      const ch = await this.gd.getCGR(args.idg, 'InvitationGroupe-6')
      /*- `im` : im du membre auteur,
        - `dh` : date-heure d'écriture.
        - `dhx` : date-heure de suppression.
        - `t` : texte crypté par la clé G du groupe (vide s'il a été supprimé).
      */
      ch.addItem(invit.li[0], this.dh, args.msgG)
    }
    
    // maj du membre invité
    membre.setInvit(this.auj, aInviter, args.msgG)
  }
}

/* OP_AcceptInvitation: 'Acceptation d\'une invitation à un groupe' *************
- token donne les éléments d'authentification du compte.
- idg : id du groupe
- idm: id du membre invité
- iam: accepte accès aux membres
- ian: accepte l'accès aux notes
- cleGK: cle du groupe cryptée par la clé K du compte
- cas: 1:accepte 2:contact 3:radié 4:radié + LN
- msgG: message de remerciement crypté par la cle G du groupe
- txK: texte à attacher à compti/idg s'il n'y en a pas
Retour:
EXC: 
- 8002: groupe disparu
- 8001: avatar disparu
*/
operations.AcceptInvitation = class AcceptInvitation extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) { 
    const gr = await this.gd.getGR(args.idg)
    if (!gr) throw new AppExc(F_SRV, 2)
    const avatar = await this.gd.getAV(args.idm)
    if (!avatar) throw new AppExc(F_SRV, 1)

    const invit = await this.gd.getIN(avatar.idc, 'AcceptInvitation-2b')

    const im = gr.mmb.get(args.idm)
    if (!im) throw new AppExc(F_SRV, 251)
    if (gr.st[im] !== 3) throw new AppExc(F_SRV, 259)
    
    const membre = await this.gd.getMBR(args.idg, im, 'AcceptInvitation-3')

    if (args.cas === 1) { // acceptation
      const nf = gr.acceptInvit(im, args.iam, args.ian)

      // invit
      invit.supprInvit(args.idg, args.idm)

      // maj du membre invité: dac dln den dam
      membre.acceptInvit(this.auj, nf)

      // écriture du chat
      const ch = await this.gd.getCGR(args.idg, 'InvitationGroupe-4')
      ch.addItem(im, this.dh, args.msgG)

      // enreg compte et compta
      this.compte.ajoutGroupe(args.idg, args.idm, args.cleGK, gr.rds)
      this.compta.ngPlus(1)
      return
    }

    // refus - cas: 2:contact 3:radié 4:radié + LN
    gr.refusInvit(im, args.cas)

    // invit
    if (args.cas === 2) invit.retourContact(args.idg, args.idm)
    else invit.supprInvit(args.idg, args.idm)

    // maj du membre invité
    membre.supprRad(args.cas === 2 ? 1 : 0)

    // écriture du chat
    const ch = await this.gd.getCGR(args.idg, 'InvitationGroupe-4')
    ch.addItem(im, this.dh, args.msgG)

    if (args.txK) {
      const compti = await this.gd.getCI(this.id)
      if (compti && !compti.mc[args.idg]) compti.setMc(args.idg, null, args.txK)
    }
  }
}

/* OP_ItemChatgr: 'Ajout ou effacement d\'un item au chat du groupe' *************
- token donne les éléments d'authentification du compte.
- idg : id du groupe
- idaut: id du membre auteur du texte
- dh: date-heure de l'item effacé
- msgG: texte de l'item
Retour:
EXC: 
- 8002: groupe disparu
*/
operations.ItemChatgr = class ItemChatgr extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) { 
    const gr = await this.gd.getGR(args.idg)
    if (!gr) throw new AppExc(F_SRV, 2)
    
    if (args.idaut) {
      if (!this.compte.mav[args.idaut]) throw new AppExc(F_SRV, 249)
      const im = gr.mmb.get(args.idaut)
      if (!im || gr.st[im] < 4 || !gr.am(im)) throw new AppExc(F_SRV, 273)
      // écriture du chat
      const ch = await this.gd.getCGR(args.idg, 'ItemChatgr')
      ch.addItem(im, this.dh, args.msgG)
    } else {
      const s = this.compte.idMbGr(args.idg)
      if (!gr.estAnim(s)) throw new AppExc(F_SRV, 274)
      const ch = await this.gd.getCGR(args.idg, 'ItemChatgr')
      ch.supprItem(args.dh, this.dh)
    }
  }
}

/* OP_MajDroitsMembre: 'Mise à jour des droits d\'un membre sur un groupe' *******
- token donne les éléments d'authentification du compte.
- idg : id du groupe
- idm : id du membre
- nvflags : nouveau flags. Peuvent changer DM DN DE AM AN
- anim: true si animateur
Retour:
EXC: 
- 8002: groupe disparu
- 8001: avatar disparu
*/
operations.MajDroitsMembre = class MajDroitsMembre extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) {
    const gr = await this.gd.getGR(args.idg)
    if (!gr) throw new AppExc(F_SRV, 2)
    const avatar = await this.gd.getAV(args.idm)
    if (!avatar) throw new AppExc(F_SRV, 1)

    const im = gr.mmb.get(args.idm)
    if (!im) throw new AppExc(F_SRV, 251)
    const stm = gr.st[im] 
    if (stm < 4) throw new AppExc(F_SRV, 262)
    
    // Set des im des avatars du compte étant animateur */
    const anc = this.compte.imAnimsDeGr(gr)

    let fst = 0
    if (args.anim && stm === 4) {
      // passer le membre en animateur
      if (!anc.size) throw new AppExc(F_SRV, 263)
      fst = 5
    }
    if (!args.anim && stm === 5) {
      // supprimer le statut d'animateur du membre - Possible pour soi-même seulement
      if (!anc.has(im)) throw new AppExc(F_SRV, 264)
      fst = 4
    }

    const iam = args.nvflags & FLAGS.AM
    const ian = args.nvflags & FLAGS.AN
    const idm = args.nvflags & FLAGS.DM
    const idn = args.nvflags & FLAGS.DN
    const ide = idn ? args.nvflags & FLAGS.DE : false

    const chgFl = gr.setFlags (anc, fst, im, iam, ian, idm, idn, ide)

    if (chgFl) {
      const mb = await this.gd.getMBR(args.idg, im, 'MajDroitsMembre-3')
      mb.setDates(this.auj, iam, ian, idm, idn, ide)
    }

    // Peut-être un animateur invitant ne l'est plus: maj des invits
    if (fst === 4) await this.checkAnimInvitants(gr)
  }
}

/* OP_RadierMembre: 'Radiation d\'un membre d\'un groupe' **************
- token donne les éléments d'authentification du compte.
- idg : id du groupe
- idm : id du membre
- cleGA: cle G du groupe cryptée par la clé du membre 
- rad: 1-redevient contact, 2-radiation, 3-radiation + ln
Retour:
EXC: 
- 8002: groupe disparu
- 8001: avatar disparu
*/
operations.RadierMembre = class RadierMembre extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) { 
    const gr = await this.gd.getGR(args.idg)
    if (!gr) throw new AppExc(F_SRV, 2)
    const avatar = await this.gd.getAV(args.idm)
    if (!avatar) throw new AppExc(F_SRV, 1)
    const compte = avatar.idc === this.id ? this.compte : await this.gd.getCO(avatar.idc, 'RadierMembre-2')
    const moi = compte.estAvc(args.idm)

    const im = gr.mmb.get(args.idm)
    if (!im) throw new AppExc(F_SRV, 251)
    const stm = gr.st[im] // statut AVANT radiation
    const anc = this.compte.imAnimsDeGr(gr) // avatars du compte étant animateur

    if (!moi) {
      // radiation d'un autre : exige qu'un de ses avatars soit animateur
      if (!anc.size) throw new AppExc(F_SRV, 267)
      // mais pas un animateur : ne peut pas radier un animateur
      if (stm === 5) throw new AppExc(F_SRV, 269)
      // et à condition d'avoir accès aux membres
      const [am, ] = gr.amAn(anc)
      if (!am) throw new AppExc(F_SRV, 268)
    }

    const mb = await this.gd.getMBR(args.idg, im, 'RadierMembre-3')

    if (args.rad === 1) {
      gr.retourContact(im)
      mb.retourContact(this.auj)
    } else {
      gr.radiation(im, args.rad === 3, moi)
      this.delete({_nom: 'membres', id: args.id, ids: im})
    }
    const stmap = gr.st[im] // statut APRES radiation
    if (stm < 4) { // est actuellement dans invits
      if (stmap === 0) { // ne doit plus l'être
        const invits = await this.gd.getIN(compte.id)
        if (invits) invits.supprContact(args.idg, args.idm)
      }
    } else {
      if (stmap === 1) { // il doit désormais y être
        const invits = await this.gd.getIN(compte.id)
        const inv = {
          idg: args.idg, 
          ida: args.idm, 
          cleGA: args.cleGA, 
          cvG: gr.cvG
        }
        if (invits) invits.setContact(inv)
      }
    }

    if (gr.imh === im) gr.finHeb(this.auj) // c'était l'hébergeur

    compte.radier(args.idg, args.idm)

    // suppression éventuelle du groupe
    if (gr.nbActifs === 0) await this.supprGroupe(gr)
  }
}

/* OP_HebGroupe: 'Gestion de l\'hébergement et des quotas d\'un grouper'
- token : jeton d'authentification du compte de **l'administrateur**
- idg : id du groupe
- nvHeb: id de l'avatar nouvel hébergeur
- action
  AGac1: 'Je prends l\'hébergement à mon compte',
  AGac2: 'Je cesse d\'héberger ce groupe',
  AGac3: 'Je reprends l\'hébergement de ce groupe par un autre de mes avatars',
  AGac4: 'Je met à jour les nombres de notes et volumes de fichiers maximum attribués au groupe',
- qn : nombre maximum de notes
- qv : volume maximum des fichiers
Retour:
Exception générique:
- 8001: avatar disparu
- 8002: groupe disparu
*/
operations.HebGroupe = class HebGroupe extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) { 
    const gr = await this.gd.getGR(args.idg)
    if (!gr) throw new AppExc(F_SRV, 2)
    if (args.action === 1 || args.action === 3){
      const avatar = await this.gd.getAV(args.nvHeb)
      if (!avatar) throw new AppExc(F_SRV, 1)
    }

    if (args.action === 2) { // fin d'hébergement
      if (gr.idh !== this.id) throw new AppExc(F_SRV, 276)
      gr.finHeb(this.auj)
      this.compta.finHeb(gr.nn, gr.vf)
      return
    }

    if (args.action === 1) { // Je reprends l\'hébergement à mon compte
      // if (!gr.idh) throw new AppExc(F_SRV, 277)
      if (gr.idh === this.id) throw new AppExc(F_SRV, 278)
      const im = gr.mmb.get(args.nvHeb)
      if (!im || gr.accesNote2(im) !== 2) throw new AppExc(F_SRV, 279)
      if (gr.st[gr.imh] === 5 && gr.st[im] !== 5) throw new AppExc(F_SRV, 280)
      this.compta.debHeb(gr.nn, gr.vf)
      gr.majHeb(args.qn, args.qv, this.id, im)
      return
    }

    if (args.action === 3) { // Je reprends l\'hébergement de ce groupe par un autre de mes avatars
      if (gr.idh !== this.id) throw new AppExc(F_SRV, 283)
      const im = gr.mmb.get(args.nvHeb)
      if (!im || gr.accesNote2(im) !== 2) throw new AppExc(F_SRV, 284)
      gr.majHeb(args.qn, args.qv, this.id, im)
    }

    if (args.action === 4) { // Je met à jour les nombres de notes et volumes de fichiers maximum attribués au groupe
      if (gr.idh !== this.id) throw new AppExc(F_SRV, 285)
      gr.majHeb(args.qn, args.qv, gr.idh, gr.imh)
    }

  }
}

/* OP_SupprAvatar: 'Suppression d\'un avatar'
- token : jeton d'authentification du compte de **l'administrateur**
- id : id de l'avatar
Retour:
Exception générique:
- 8001: avatar disparu
*/
operations.SupprAvatar = class SupprAvatar extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) {
    if (!this.compte.mav[args.id]) throw new AppExc(F_SRV, 1)
    const avatar = await this.gd.getAV(args.id)
    if (!avatar) throw new AppExc(F_SRV, 1)
    if (args.id === this.id ) throw new AppExc(F_SRV, 286)
    await this.resilAvatar(avatar)
  }
}

/* OP_SupprCompte: 'Suppression d\'un compte'
- token : jeton d'authentification du compte de **l'administrateur**
Retour:
Exception générique:
- 8001: avatar disparu
*/
operations.SupprCompte = class SupprCompte extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 () { 
    const compte = await this.gd.getCO(this.id)
    if (!compte) throw new AppExc(F_SRV, 1)
    await this.resilCompte(compte)
  }
}

/* OperationNoh : super classe hébergeant des méthodes utilitaires de gestion des notes */
class OperationNo extends Operation {

  async checkNoteId () {
    const id = this.args.id
    if (ID.estGroupe(id)) {
      const e = this.compte.mpg[id] 
      if (!e) throw new AppExc(F_SRV, 290)
      this.mavc = new Map()
      this.groupe = await this.gd.getGR(id, 'OperationNo-1')
      this.anim = false
      for (const idm of e.lav) {
        const im = this.groupe.mmb.get(idm)
        if (!im || this.groupe.st[im] < 4) continue
        const anim = this.groupe.st[im] === 5
        if (anim) this.anim = true
        const f = this.groupe.flags[im]
        let am = false, an = false, de = false
        if ((f & FLAGS.AN) && (f & FLAGS.DN)) an = true 
        if ((f & FLAGS.AM) && (f & FLAGS.DM)) am = true 
        if (an && (f & FLAGS.DE)) de = true
        if (an) this.mavc.set(idm, { im, am, de, anim })
      }
      if (!this.mavc.size) throw new AppExc(F_SRV, 291)
      this.aut = this.args.ida ? this.mavc.get(this.args.ida) : null
    } else {
      if (!this.compte.mav[id]) throw new AppExc(F_SRV, 292)
    }
  }

  // Contrôle d'existence de la note parent et de l'absence de cycle
  async checkRatt (g) {
    let notep, id = this.args.ref[0], ids = this.args.ref[1] || 0
    if (!ids) { // rattachée à une racine
      if (id !== this.args.id) {
        if (g) throw new AppExc(F_SRV, 298)
        else if (!ID.estGroupe(id)) throw new AppExc(F_SRV, 299)
      }
    } else { // rattachée
      const cycle = [this.args.ids]
      // eslint-disable-next-line no-constant-condition
      while (true) {
        notep = await this.gd.getNOT(id, ids)
        if (!notep && cycle.length === 1) throw new AppExc(F_SRV, 294)
        if (!notep) break
        cycle.push(notep.ids)
        if (notep.ids === this.args.ids) throw new AppExc(F_SRV, 295, [cycle.join(' ')])
        if (g) {
          if (notep.id !== this.args.id) throw new AppExc(F_SRV, 297)
        } else {
          if (ID.estGroupe(notep.id)) break
          if (notep.id !== this.args.id) throw new AppExc(F_SRV, 296)  
        }
        if (!notep.ref) break
        id = notep.ref[0]
        ids = notep.ref[1]
        if (!ids) break
      }
    }
  }
}

/* OP_NouvelleNote: 'Création d\'une nouvelle note' ***************
- token: éléments d'authentification du compte
- id : de la note
- ida : pour une note de groupe, id de son avatar auteur
- exclu : auteur est exclusif
- ref : [id, ids] pour une note rattachée
- t : texte crypté
Retour: rien
*/
operations.NouvelleNote = class NouvelleNote extends OperationNo {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) { 
    await this.checkNoteId()
    args.ids = rnd6()
    let im = 0, aut = 0
    if (!this.groupe) {
      if (args.ref) await this.checkRatt()
      this.compta.nnPlus(1)
      this.compta.exN()
    } else {
      if (!this.aut || !this.aut.de) throw new AppExc(F_SRV, 293)
      if (args.exclu) im = this.aut.im
      aut = this.aut.im
      if (args.ref) await this.checkRatt(true)
      const compta = await this.gd.getCA(this.groupe.idh, 'NouvelleNote-1')
      compta.nnPlus(1)
      compta.exN()
      this.groupe.setNV(1, 0)
      this.groupe.exN()
    }
    const par = { im, dh: this.dh, t: args.t, aut, ref: args.ref}
    const n = await this.gd.nouvNOT(args.id, args.ids, par)
    this.setRes('key', n.id + '/' + n.ids)
  }
}

/* OP_RattNote: 'Gestion du rattachement d\'une note à une autre' ********
- token: éléments d'authentification du compte.
- id ids: identifiant de la note
- ref : [id, ids] : racine ou note de rattachemnt
Retour: rien
*/
operations.RattNote = class RattNote extends OperationNo {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) { 
    if (!args.ref) throw new AppExc(F_SRV, 300)
    const note = await this.gd.getNOT(args.id, args.ids, 'RattNote-1')
    const ng = ID.estGroupe(args.id)
    await this.checkNoteId()
    let ok = ng ? false : true
    if (ng) for(const [, e] of this.mavc ) { // idm, { im, am, de, anim }
      if (e.de && (!note.im || (note.im === e.im) || e.anim)) ok = true
    }
    if (!ok) throw new AppExc(F_SRV, 301)
    await this.checkRatt(ng)
    const r = !args.ref[1] && args.ref[0] === note.id ? null : args.ref
    note.setRef(r)
  }
}

/* OP_MajNote: 'Mise à jour du texte d\'une note' ******
- token: éléments d'authentification du compte.
- id ids: identifiant de la note (dont celle du groupe pour un note de groupe)
- t : nouveau texte encrypté
- aut : im de l'auteur de la note pour un groupe
Retour:
*/
operations.MajNote = class MajNote extends OperationNo {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) { 
    const note = await this.gd.getNOT(args.id, args.ids, 'MajNote-1')
    const ng = ID.estGroupe(args.id)
    await this.checkNoteId()
    let im = 0
    if (ng) {
      const e = this.mavc.get(args.aut) // idm, { im, am, de, anim }
      if (!e) throw new AppExc(F_SRV, 301)
      im = e.im    
    }
    note.setTexte(args.t, im, this.dh)
  }
}

/* OP_HTNote: 'Changement des hashtags attachés à une note par un compte' ******
- token: éléments d'authentification du compte.
- id ids: identifiant de la note
- htK : ht personels
- htG : hashtags du groupe
Retour: rien
*/
operations.HTNote = class HTNote extends OperationNo {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) { 
    const note = await this.gd.getNOT(args.id, args.ids, 'HTNote-1')
    const ng = ID.estGroupe(args.id)
    await this.checkNoteId()
    if (ng) {
      note.setHT(args.htK, this.id)
      if (this.anim) note.setHTG(args.htG)
    } else note.setHT(args.htK)
  }
}

/* OP_ExcluNote: 'Changement de l\'attribution de l\'exclusivité d\'écriture d\'une note'
- token: éléments d'authentification du compte.
- id ids: identifiant de la note
- ida: id de l'avatar prenant l'exclusivité
Retour: rien
//   PNOpeut: 'Pour attribuer l\'exclusité d\'écriture d\'une note, il faut, a) soit être animateur, b) soit l\'avoir soi-même, c) soit que personne ne l\'ait déjà.',
*/
operations.ExcluNote = class ExcluNote extends OperationNo {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) { 
    const note = await this.gd.getNOT(args.id, args.ids, 'HTNote-1')
    if (!ID.estGroupe(args.id)) throw new AppExc(F_SRV, 303)
    await this.checkNoteId()
    let aExclu = false
    for(const [, e] of this.mavc) 
      if (e.im === note.im) aExclu = true

    let im = 0
    if (!args.ida) {
      if (!aExclu && !this.anim) throw new AppExc(F_SRV, 306)
    } else {
      const peut = this.anim || aExclu || !note.im
      if (!peut) throw new AppExc(F_SRV, 304)
      im = this.groupe.mmb.get(args.ida)
      if (!im) throw new AppExc(F_SRV, 305)
      const f = this.groupe.flags[im]
      const ok = (f & FLAGS.AN) && (f & FLAGS.DN) && (f & FLAGS.DE)
      if (!ok) throw new AppExc(F_SRV, 305)
    }
    note.setExclu(im)
  }
}

/** OP_GetUrlNf : retourne l'URL de get d'un fichier d'une note
- token: éléments d'authentification du compte.
- id ids : id de la note.
- idf : id du fichier.
Retour:
- url : url de get
*/
operations.GetUrlNf = class GetUrl extends OperationNo {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) {
    await this.checkNoteId()
    const note = await this.gd.getNOT(args.id, args.ids, 'GetUrlNf-1')
    const f = note.mfa[args.idf] // { idf, nom, info, dh, type, gz, lg, sha }
    if (!f) throw new AppExc(F_SRV, 307)
    const url = await this.storage.getUrl(this.org, args.id, args.idf)
    this.setRes('url', url)
    this.op.vd += f.lg // décompte du volume descendant
  }
}

/* OP_PutUrlNf : retourne l'URL de put d'un fichier d'une note ******
- token: éléments d'authentification du compte.
- id ids : id de la note
- aut: pour une note de groupe, ida de l'auteur de l'enregistrement
Retour:
- idf : identifiant du fichier
- url : url à passer sur le PUT de son contenu
Remarque: l'excès de volume pour un groupe et un compte, ainsi que le volume 
descendant seront décomptés à la validation de l'upload
*/
operations.PutUrlNf = class PutUrl extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) {
    await this.checkNoteId()
    await this.gd.getNOT(args.id, args.ids, 'PutUrlNf-1')
    if (ID.estGroupe(args.id)) {
      const x = this.auts.get(args.aut) // idm, { im, am, de, anim }
      if (!x || !x.de) throw new AppExc(F_SRV, 309)
    }

    const idf = rnd6()
    const url = await this.storage.getUrl(this.org, args.id, idf)
    this.setRes('url', url)
    this.setRes('idf', idf)

    const dlv = AMJ.amjUtcPlusNbj(this.auj, 1)
    const tr = new Transferts().init({ id: args.id, ids: idf, dlv })
    this.insert(tr.toRow())
  }
}

/* validerUpload ****************************************
- token: éléments d'authentification du compte.
- id, ids : de la note
- fic : { idf, nom, info, type, lg, gz, sha}
- aut: id de l'auteur (pour une note de groupe)
- lidf : liste des idf fichiers de la note à supprimer
Retour: aucun
*/
operations.ValiderUpload = class ValiderUpload extends OperationNo {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) {
    await this.checkNoteId()
    await this.gd.getNOT(args.id, args.ids, 'ValiderUpload-1')
    const note = await this.gd.getNOT(args.id, args.ids, 'ValiderUpload-2')
    const f = note.mfa[args.fic.idf]
    if (f) throw new AppExc(F_SRV, 310)
    let dv = note.vf
    note.setFic(args.fic)
    if (args.lidf && args.lidf.length) 
      args.lidf.forEach(idf => { note.delFic(idf)})
    note.setVf()
    dv = note.vf - dv

    let compta

    if (ID.estGroupe(args.id)) {
      const x = this.auts.get(args.aut) // idm, { im, am, de, anim }
      if (!x || !x.de) throw new AppExc(F_SRV, 309)
      const groupe = await this.gd.getGR(args.id, 'ValiderUpload-3')
      if (groupe.idh) {
        groupe.setNV(0, dv)
        groupe.exV()
        compta = groupe.idh === this.id ? this.compta : 
          await this.gd.getCA(groupe.idh, 'ValiderUpload-4')
      } else {
        if (dv > 0) throw new AppExc(F_SRV, 312)
        groupe.setNV(0, dv)
      }
    } else {
      compta = this.compta
    }
    
    if (compta) {
      compta.vPlus(dv)
      compta.exV()
    }
    
    if (args.lidf && args.lidf.length) 
      for (const idf of args.lidf)
        await this.db.purgeTransferts(args.id, idf)
  }
}
