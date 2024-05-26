import { AppExc, F_SRV, ID, FLAGS, d14 } from './api.mjs'
import { config } from './config.mjs'
import { operations } from './cfgexpress.mjs'
import { eqU8 } from './util.mjs'

import { Operation, R } from './modele.mjs'
import { compile } from './gendoc.mjs'

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
- `ns` : id de l'espace notifié.
- `optionA` : 0 1 2.
- dlvat: aaaammjj,
- nbmi:
Retour: rien
*/
operations.SetEspaceOptionA = class SetEspaceOptionA extends Operation {
  constructor (nom) { super(nom, 2, 2)}

  async phase2 (args) {
    const espace = await this.getCheckEspace(args.ns, true)
    espace.setOptions(args)
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

    const ids = (ID.ns(args.id) * d14) + (args.hYR % d14)
    if (await this.db.getSponsoringIds(this, ids)) 
      throw new AppExc(F_SRV, 207)

    if (args.partitionId) { // compte O
      const partition = await this.gd.getPA(args.partitionId, 'AjoutSponsoring')
      if (!this.estComptable) {
        const e = partition.mcpt[ID.court(this.compte.id)]
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

    await this.gd.nouvSPO(args, ids, 'AjoutSponsoring')
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
      const idp = ID.long(this.compte.idp, this.ns)
      const partition = await this.gd.getPA(idp, 'GetCompta-2')
      const e = partition.mcpt[ID.court(id)]
      if (!e) throw new AppExc(F_SRV, 219)
    }
    const compta = await this.gd.getCA(id, 'GetCompta-1')
    this.setRes('rowCompta', compta.toShortRow())
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
    const av = compile(await this.db.getAvatarHpc(this, ID.long(args.hZR, this.ns)))
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
    this.idEL = ID.long(this.args.idE, this.ns)
    if (this.setR.has(R.MINI)) await this.checkR()
  }

  // Vérification des restrictions, initialisations de :
  async intro2 () {
    this.chI = await this.gd.getCAV(this.args.id, this.args.ids, 'Chat-intro')
    this.idEL = ID.long(this.chI.idE, this.ns)
    this.chE = await this.gd.getCAV(this.idEL, this.chI.idsE)
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
    if (this.compte._estA || this.estComptable || ID.estComptable(this.idEL)) return
    const avE = await this.gd.getAV(this.idEL)
    const cptE = await this.gd.getCO(ID.long(avE.idc, this.ns), 'Chat-intro') // cptE pas null (chE existe)
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
    if (this.compte.mav[ID.court(args.idE)]) throw new AppExc(F_SRV, 226)

    const avI = await this.gd.getAV(args.idI, 'NouveauChat-1')
    const avE = await this.gd.getAV(args.idE, 'NouveauChat-2')

    if (!args.mode) {
      if (avE.hZC !== args.hZC) throw new AppExc(F_SRV, 221)
    } else if (args.mode === 1) {
      if (!ID.estComptable(args.idE)) throw new AppExc(F_SRV, 225)
    } else if (args.mode === 2) {
      const partition = await this.gd.getPA(ID.long(this.compte.idp), this.ns)
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
    if (chI) { this.setRes('rowChat', chI.toShortRow()); return}

    chI = this.gd.nouvCAV({ 
      id: args.idI,
      ids: idsI,
      st: 10,
      idE: ID.court(args.idE),
      idsE: idsE,
      cvE: avE.cvA,
      cleCKP: args.ch.ccK,
      cleEC: args.ch.cleE2C,
      items: [{a: 1, dh: this.dh, t: args.ch.txt}]
    })
    this.setRes('rowChat', chI.toShortRow())
    this.compta.ncPlus(1)

    this.gd.nouvCAV({
      id: args.idE,
      ids: idsE,
      st: 1,
      idE: ID.court(args.idI),
      idsE: idsI,
      cvE: avI.cvA,
      cleCKP: args.ch.ccP,
      cleEC: args.ch.cleE1C,
      items: [{a: 0, dh: this.dh, t: args.ch.txt}]
    })
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
    if (!await this.intro2(args)) { // pas de chatE
      this.chI.chEdisp()
      return
    }

    // cas normal : maj sur chI et chE - avE et cptE existent
    const avI = await this.gd.getAV(this.args.id, 'MajChat-2')
    const avE = await this.gd.getAV(this.idEL, 'MajChat-2')

    if (args.don) {
      if (!this.compte._estA) throw new AppExc(F_SRV, 214)
      const cptE = await this.gd.getCO(ID.long(avE.idc, this.ns)) // cptE existe puisque chE existe ici
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
    this.chI.setCvE(avE.cvA || {id: ID.court(avE.id), v: 0 })
    this.chE.setCvE(avI.cvA || {id: avI.id, v: 0 })
   
    if (Math.floor(this.chI.st / 10) === 0) { // I était passif, redevient actif
      this.chI.actifI()
      this.compta.ncPlus(1)
      this.chE.actifE()
    }
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

  async phase2 () { 
    if (!await this.intro2()) { // E disparu. I voulait être passif, devient détruit
      this.chI.setZombi()
      this.setRes('suppr', true)
      return
    }

    if (this.chI.estPassif) return // était passif, reste passif, rien n'a changé

    // chI était actif, devient passif - E pas disparu, MAJ de cv et st
    const avI = await this.gd.getAV(this.args.id, 'PassifChat-1')

    this.compta.ncPlus(-1)
    const avE = await this.gd.getAV(this.idEL, 'PassifChat-2')
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
    if (args.hZR && await this.db.getAvatarHpc(this, ID.long(args.hZR, this.ns))) 
      throw new AppExc(F_SRV, 26) // trop proche existante

    if (!this.compte.mav[ID.court(args.id)]) throw new AppExc(F_SRV, 224)

    const avatar = this.gd.getAV(args.id, 'ChangementPC-1')
    avatar.setPC(args)
  }
}

/* OP_StatutAvatar: 'Vérification que le bénéficiaire envisagé d\'un don est bien un compte autonome'
indique si l'avatar donné en argument est 
un avatar principal ou non, d'un compte autonome ou non
- token : jeton d'authentification du compte de **l'administrateur**
- id : id de l'avatar
Retour: 
- `st`: [P, A]
  - P : true si avatar principal
  - A : true si compte A
*/
operations.StatutAvatar = class StatutAvatar extends Operation {
  constructor (nom) { super(nom, 1) }

  async phase2(args) {
    const avatar = await this.getAV(args.id) // 401 si non trouvé
    const idcl = this.long(avatar.idc, this.ns)
    const p = avatar.id !== idcl
    const c = await this.getCO()
    const a = c.idp ? false : true
    this.setRes('st', [p, a])
  }
}

/* OP_RafraichirCvsAv: 'Rafraichissement des CVs des chats de l\'avatar'
- token : jeton d'authentification du compte de **l'administrateur**
- id : id de l'avatar
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
    if (!this.compte.mav[ID.court(args.id)])
      throw new AppExc(F_SRV, 227)

    const avatar = await this.gd.getAV(args.id) //
    if (!avatar) throw new AppExc(F_SRV, 1)
    let nc = 0, nv = 0
    // liste des chats de l'avatar
    for (const ch of await this.gd.getAllCAV(args, 0)) {
      if (!ch._zombi) {
        const { av, disp } = this.gd.getAAVCV(ID.long(ch.idE, this.ns), ch.vcv)
        nv++
        if (disp) ch.chEdisp()
        else if (av) {
          ch.setCvE(av.cvA)
          nc++
        }
      }
    }
    this.setRes('ncnv', [nc, nv])
  }
}

/* OP_RafraichirCvChat: 'Rafraichissement de la carte de visite d\'un chat'
- token : jeton d'authentification du compte de **l'administrateur**
- id, ids : id du chat
Retour:
Exception générique:
- 8001: avatar disparu
- 8002: chat disparu
*/
operations.RafraichirCvChat = class RafraichirCvChat extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2(args) {
    /* Restriction MINI NE s'applique QUE si le compte n'est pas le comptable */
    if (this.setR.has(R.MINI) && !this.estComptable) 
      throw new AppExc(F_SRV, 802)
    if (!this.compte.mav[ID.court(args.id)])
      throw new AppExc(F_SRV, 227)

    const avatar = await this.gd.getAV(args.id) //
    if (!avatar) throw new AppExc(F_SRV, 1)
    const ch = await this.gd.getCAV(args.id, args.ids)
    if (!ch || ch._zombi) throw new AppExc(F_SRV, 2)
    const { av, disp } = this.gd.getAAVCV(ID.long(ch.idE, this.ns), ch.vcv)
    if (disp) ch.chEdisp()
    else if (av) ch.setCvE(av.cvA)
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
    this.gd.nouvPA(args.n, args.quotas)
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
    const p = await this.gd.getPA(ID.long(args.n, this.ns), 'SupprPartition-1')
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
    const np = ID.court(args.idp)
    if (!this.compte.setCodePart(np, args.etpk)) throw new AppExc(F_SRV, 229)
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
    const partav = await this.gd.getPA(ID.long(cpt.idp, this.ns), 'ChangerPartition-2')
    const idc = ID.court(args.id)
    const epav = partav.mcpt[idc]
    if (!epav) throw new AppExc(F_SRV, 232)
    const partap = await this.gd.getPA(args.idp, 'ChangerPartition-3')
    const epap = partap.mcpt[idc]
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
    const part = await this.gd.getPA(ID.long(cpt.idp, this.ns), 'DeleguePartition-2')
    
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
    if ((!ec && !ed) || (ed && this.compte.idp !== ID.court(args.idp))) throw new AppExc(F_SRV, 235)
    
    const espace = await this.gd.getES(false, 'SetNotifP-1')
    const ntf = espace.tnotifP[ID.court(args.idp)]
    const aut = ntf ? (ntf.idDel ? ID.long(ntf.idDel, this.ns) : ID.duComptable(this.ns)) : null
    if (aut && ed && ID.estComptable(aut)) throw new AppExc(F_SRV, 237)
    if (args.notif) args.notif.idDel = ID.court(this.id)
    espace.setNotifP(args.notif, ID.court(args.idp))

    const partition = await this.gg.getPA(args.idp, 'SetNotifP-2')
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
    const aut = ntf ? (ntf.idDel ? ID.long(ntf.idDel, this.ns) : ID.duComptable(this.ns)) : null
    if (aut && ed && ID.estComptable(aut)) throw new AppExc(F_SRV, 237)
    if (args.notif) args.notif.idDel = ID.court(this.id)

    compte.setNotif(args.notif || null)

    const partition = await this.gd.getPA(ID.long(compte.idp, this.ns), 'SetNotifC-3')
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

    const tk = this.gd.nouvTKT(args)
    this.compta.plusTk(tk)
  }

  phase3() {
    this.setRes('rowCompta', this.compta.toRow())
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
    const idc = ID.duComptable(this.ns)

    const tk = await this.gd.getTKT(idc, args.ids)
    if (!tk) throw new AppExc(F_SRV, 240)
    tk.setZombi()
    this.compta.moinsTk(tk)
  }

  phase3() {
    this.setRes('rowCompta', this.compta.toRow())
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

    const tk = await this.gd.getTKT(this.id, args.ids)
    if (!tk) throw new AppExc(F_SRV, 240)
    if (tk.dr) throw new AppExc(F_SRV, 241)

    const compte = await this.gd.getCO(ID.long(tk.idc, this.ns))
    const compta = await this.gd.getCA(ID.long(tk.idc, this.ns))
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
    const idag = ID.long(args.cv.id, this.ns)

    if (!ID.estGroupe(idag)) {
      if (!this.compte.mav[args.cv.id]) throw new AppExc(F_SRV, 242)
      const avatar = await this.gd.getAV(idag, 'MajCv-1')
      avatar.setCv(args.cv)
    } else {
      const e = this.compte.mpg[args.cv.id]
      if (!e) throw new AppExc(F_SRV, 243)
      const groupe = await this.gd.getGR((idag, 'MajCv-3'))
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
    const idag = ID.long(args.id, this.ns)

    if (!ID.estGroupe(idag)) {
      if (args.ch) {
        if (this.compte.mav[ID.court(args.ch[0])]) {
          const chat = await this.getRowChat(args.ch[0], args.ch[1])
          if (!chat) throw new AppExc(F_SRV, 244)
        } else throw new AppExc(F_SRV, 244)
      } else {
        if (!this.compte.mav[ID.court(args.id)]) throw new AppExc(F_SRV, 242)
      }
      const avatar = await this.gd.getAV(idag, 'MajCv-1')
      this.setRes('cv', avatar.cvA)
    } else {
      const e = this.compte.mpg[args.cv.id]
      if (!e) throw new AppExc(F_SRV, 243)
      const groupe = await this.gd.getGR(idag, 'MajCv-3')
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

    if (this.compte.mav[ID.court(args.id)]) return // création déjà faite pour le compte
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
    compti.setMc(args)
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
    const rg = await this.dg.getGR(args.idg)
    if (rg) throw new AppExc(F_SRV, 246)

    const avatar = await this.gd.getAV(args.ida)
    if (!avatar) throw new AppExc(F_SRV, 1)

    this.gd.nouvGR(args)
    const dx = { dpc: this.auj, dac: this.auj, dln: this.auj, den: this.auj, dam: this.auj }
    this.gd.nouvMBR(args.idg, 1, avatar.cvA, args.cleAG, dx)

    this.compta.ngPlus(1)
  }
}

/* Nouveau contact *****************************************************
- token donne les éléments d'authentification du compte.
- idg : du groupe
- ida : de l'avatar contact
- cleAG : clé A du contact cryptée par la clé G du groupe
Retour:
EXC: 
- 8002: groupe disparu
- 8001: avatar disparu
*/
operations.NouveauContact = class NouveauContact extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) { 
    const groupe = this.gd.getGR(args.idg)
    if (!groupe) throw new AppExc(F_SRV, 2)
    const avatar = await this.gd.getAV(args.ida)
    if (!avatar) throw new AppExc(F_SRV, 1)

    // const groupe = compile(await this.getRowGroupe(args.idg, 'NouveauContact-1'))
    let ok = false
    for(const x in this.compte.mav) {
      const idav = ID.long(parseInt(x), this.ns)
      const im = groupe.mmb.get(idav)
      const f = groupe.flags[im]
      if (im && groupe.st[im] >= 4 && (f & FLAGS.AM) && (f & FLAGS.DM) ) { ok = true; break }
    }
    if (!ok) throw new AppExc(F_SRV, 247)
    if (groupe.mmb.get(args.ida)) throw new AppExc(F_SRV, 248)
    const idac = ID.court(args.ida)
    if (groupe.lnc.indexOf(idac) !== -1) throw new AppExc(F_SRV, 260)
    if (groupe.lng.indexOf(idac) !== -1) throw new AppExc(F_SRV, 261)
    
    const im = groupe.nvContact(args.ida)
    const dx = { dpc: this.auj}
    this.gd.nouvMBR(args.idg, im, avatar.cvA, args.cleAG, dx)
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
    const gr = this.gd.getGR(args.idg)
    if (!gr) throw new AppExc(F_SRV, 2)

    if (!this.compte.mav[ID.court(args.ida)]) throw new AppExc(F_SRV, 249)
    const im = gr.mmb.get(args.ida)
    if (!im || gr.st[im] !== 5) throw new AppExc(F_SRV, 250)
    
    gr.setMsu(args.simple, im)
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
    const gr = this.gd.getGR(args.idg)
    if (!gr) throw new AppExc(F_SRV, 2)
    const avatar = await this.gd.getAV(args.ida)
    if (!avatar) throw new AppExc(F_SRV, 1)

    const idac = ID.court(args.idm)
    if (gr.lnc.indexOf(idac) !== -1) throw new AppExc(F_SRV, 260)
    if (gr.lng.indexOf(idac) !== -1) throw new AppExc(F_SRV, 261)

    const cinvit = await this.gd.getIN(ID.long(avatar.idc, this.ns), 'InvitationGroupe-2b')

    const im = gr.mmb.get(args.idm)
    if (!im) throw new AppExc(F_SRV, 251)
    const membre = await this.gd.getMBR(args.idg, im, 'InvitationGroupe-3')

    const s = gr.st[im]
    
    if (args.suppr) { // suppression de l'invitation
      if (s < 2 || s > 3) throw new AppExc(F_SRV, 252)
      gr.supprInvit(im, args.suppr)
      cinvit.supprInvit(args.idg, args.idm)
      membre.supprRad(args.suppr)
      return
    } 
    
    // Création 0 / modification 2 / vote pour 4
    if (args.rmsv === 0 && s !== 1) throw new AppExc(F_SRV, 256) // création mais pas contact
    if ((args.rmsv === 2 || args.rmsv === 4) && (s < 2 || s > 3)) 
      throw new AppExc(F_SRV, 257) // modification ou vote mais pas déjà (pré) invité
    if (gr.msu && args.rmsv === 4) throw new AppExc(F_SRV, 258) // vote mais pas en mode unanime
    if (!gr.msu && !args.idi) throw new AppExc(F_SRV, 255) // mode simple et absence d'avatar invitant

    // construction de l'item invit dans groupe
    let aInviter = false // inviter effectivement (sinon laisser en pré-invité)
    const invit = { fl: args.flags, li: [] }
    if (args.idi) {
      if (!this.compte.mav[ID.court(args.idi)]) 
        throw new AppExc(F_SRV, 249) // invitant non membre du groupe
      const imi = gr.mmb.get(ID.long(args.idi, this.ns))
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
        idg: ID.court(args.idg),
        ida: ID.court(args.idm),
        cleGA: args.cleGA, 
        cvG: gr.cvG, 
        flags: args.flags, 
        invpar, 
        msgG: args.msgG 
      }
      for (const im of invit.li) {
        const mb = compile(await this.getRowMembre(gr.id, im))
        if (mb) invpar.push({ cleAG: mb.cleAG, cvA: mb.cvA })
      }
      cinvit.addInv(invx)
    }

    // écriture du chat
    if (aInviter) {
      const ch = await this.gr.getCGR(args.idg, 'InvitationGroupe-4')
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
Retour:
EXC: 
- 8002: groupe disparu
- 8001: avatar disparu
*/
operations.AcceptInvitation = class AcceptInvitation extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) { 
    const gr = this.gd.getGR(args.idg)
    if (!gr) throw new AppExc(F_SRV, 2)
    const avatar = await this.gd.getAV(args.ida)
    if (!avatar) throw new AppExc(F_SRV, 1)

    const invit = await this.gd.getIN(ID.long(avatar.idc, this.ns), 'AcceptInvitation-2b')

    const im = gr.mmb.get(args.idm)
    if (!im) throw new AppExc(F_SRV, 251)
    if (gr.st[im] !== 3) throw new AppExc(F_SRV, 259)
    
    const membre = await this.gd.getMBR(args.idg, im, 'AcceptInvitation-3')

    if (args.cas === 1) { // acceptation
      const nf = gr.acceptInvit(im, args.iam, args.ian)

      // invit
      invit.supprInv(args.idg, args.idm)

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
    invit.supprInv(args.idg, args.idm)

    // maj du membre invité
    membre.supprRad(args.cas === 2 ? 1 : 0)

    // écriture du chat
    const ch = await this.gd.getCGR(args.idg, 'InvitationGroupe-4')
    ch.addItem(im, this.dh, args.msgG)
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
    const gr = this.gd.getGR(args.idg)
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
  }
}

/* OP_RadierMembre: 'Radiation d\'un membre d\'un groupe' **************
- token donne les éléments d'authentification du compte.
- idg : id du groupe
- idm : id du membre
- rad: 1-redevient contact, 2-radiation, 3-radiation + ln
Retour:
*/
operations.RadierMembre = class RadierMembre extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) { 
    const gr = this.gd.getGR(args.idg)
    if (!gr) throw new AppExc(F_SRV, 2)
    const avatar = await this.gd.getAV(args.idm)
    if (!avatar) throw new AppExc(F_SRV, 1)
    const compte = await this.gd.getCO(avatar.idc, 'RadierMembre-2')
    const moi = compte.estAvc(args.idm)

    const im = gr.mmb.get(args.idm)
    if (!im) throw new AppExc(F_SRV, 251)
    const stm = gr.st[im] 
    const anc = this.compte.imAnimsDeGr(gr)

    if (moi) { // auto-radiation
      if (stm < 4) throw new AppExc(F_SRV, 270)
    } else {
      // radiation d'un autre
      if (!anc.size) throw new AppExc(F_SRV, 267)
      // mais pas un animateur
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
      mb.setZombi()
    }

    // TODO gestion de la suppression éventuelle du compte
    /*
    if (gr.nbActifs) { // il reste desz actifs, le groupe n'est pas supprimé
      if (gr.imh === im) {
        gr.imh = 0
        gr.dfh = this.auj
        // répercussion dans compas de idc
      }
      this.update(gr.toRow())
      this.update(mb.toRow())
      return
    }
    // suppression des invitations en cours
    // suppression de tous les membres
    */

  }
}
