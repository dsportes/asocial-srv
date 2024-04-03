import { AppExc, F_SRV, ID, FLAGS, d14 } from './api.mjs'
import { config } from './config.mjs'
import { operations } from './cfgexpress.mjs'
import { eqU8 } from './util.mjs'

import { Operation, assertKO } from './modele.mjs'
import { compile, Espaces, Syntheses, Partitions, Comptes, Comptis,
  Avatars, Comptas, Sponsorings, Chats } from './gendoc.mjs'

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

/* `CreerEspace` : création d'un nouvel espace et du comptable associé
- token : jeton d'authentification du compte de **l'administrateur**
- ns : numéro de l'espace
- org : code de l'organisation
- hXR : hash du PBKFD de la phrase secrète réduite
- hXC : hash du PBKFD de la phrase secrète complète
- pub: clé RSA publique du Comptable
- privK: clé RSA privée du Comptable cryptée par la clé K
- clePK: clé P de la partition 1 cryptée par la clé K du Comptable
- cleAP: clé A du Comptable cryptée par la clé de la partition
- cleAK: clé A du Comptable cryptée par la clé K du Comptable
- cleKXC: clé K du Comptable cryptée par XC du Comptable (PBKFD de la phrase secrète complète).
- clePA: cle P de la partition cryptée par la clé A du Comptable
- ck: `{ cleP, code }` crypté par la clé K du comptable
Retour: rien

Création des rows:
- espace, synthese
- partition : primitive, avec le Comptable comme premier participant et délégué
- compte, compta, avatar: du Comptable

Exceptions: 
- F_SRV, 202 : ns non conforme.
- F_SRV, 201: code d'organisation invalide.
- F_SRV, 203 : Espace déjà créé.
- F_SRV, 204 : code d'organisation déjà attribué
*/
operations.CreerEspace = class CreerEspace extends Operation {
  constructor (nom) { super(nom, 3) }

  // eslint-disable-next-line no-useless-escape
  static reg = /^([a-z0-9\-]+)$/

  async phase2(args) {
    this.ns = args.ns
    if (args.ns < 10 || args.ns > 89) throw new AppExc(F_SRV, 202, [args.ns])
    if ((args.org.length < 4) || (args.org.length > 8) || (!args.org.match(CreerEspace.reg))) 
      throw new AppExc(F_SRV, 201, [args.org])

    if (await this.getRowEspace(args.ns)) throw new AppExc(F_SRV, 203, [args.ns, args.org])
    if (await this.getEspaceOrg(args.org)) throw new AppExc(F_SRV, 204, [args.ns, args.org])

    const idComptable = ID.duComptable(args.ns)
    const aco = config.allocComptable
    const qv = { qc: aco[0], qn: aco[1], qv: aco[2], nn: 0, nc: 0, ng: 0, v: 0 }
    const qvc = { qc: aco[0], qn: aco[1], qv: aco[2] }
    const apr = config.allocPrimitive
    const qc = { qc: apr[0], qn: apr[1], qv: apr[2] } 
    const rdsav = ID.rds(ID.RDSAVATAR)

    /* Espace */
    this.espace = Espaces.nouveau(args.ns, args.org, this.auj)

    /* Partition et Synthese */
    if (!this.partitions) this.partitions = new Map()
    const partition = Partitions.nouveau(args.ns, 1, qc)
    this.partitions.set(partition.id, partition)
    this.synthese = Syntheses.nouveau(args.ns, this.dh)

    /* Compte Comptable */
    const o = { clePA: args.clePA, del: true, idp: 1 }
    // id, hXR, hXC, cleKXC, rdsav, cleAK, clePK, qvc, o, tpk
    this.compte = Comptes.nouveau(idComptable, 
      (args.ns * d14) + (args.hXR % d14), 
      args.hXC, args.cleKXC, rdsav, args.cleAK, args.clePK, qvc, o, args.ck)
    
    /* Compti */
    const compti = new Comptis().init({ id: idComptable, v: 1, mc: {} })
    this.insert(compti.toRow())

    /* Compta */
    this.compta = Comptas.nouveau(idComptable, qv).compile()
    partition.ajoutCompte(this.compta, args.cleAP, true)

    /* Avatar  (id, rdsav, pub, privK, cvA) */
    const cvA = { id: ID.court(idComptable) }
    const avatar = Avatars.nouveau(idComptable, rdsav, args.pub, args.privK, cvA)
    this.setNV(avatar)
    this.insert(avatar.toRow())
  }
}

/*`SetEspaceOptionA` : changement de l'option A, nbmi, dlvat par le Comptable
- `token` : jeton d'authentification du compte de **l'administrateur**
- `ns` : id de l'espace notifié.
- `optionA` : 0 1 2.
- dlvat: aaaammjj,
- nbmi:
Retour: rien
Assertion sur l'existence du row `Espaces`.
L'opération échappe au contrôle espace figé / clos.
Elle n'écrit QUE dans espaces.
*/
operations.SetEspaceOptionA = class SetEspaceOptionA extends Operation {
  constructor (nom) { super(nom, 2, 2)}

  async phase2 (args) {
    this.espace = compile(await this.getRowEspace(args.ns, 'SetEspaceOptionA-1'))
    if (args.optionA) this.espace.opt = args.optionA
    if (args.dlvat) this.espace.dlvat = args.dlvat
    if (args.nbmi) this.espace.nbmi = args.nbmi
    this.espace._maj = true
  }
}

/*`SetEspaceNprof` : déclaration du profil de volume de l'espace par l'administrateur
- `token` : jeton d'authentification du compte de **l'administrateur**
- `ns` : id de l'espace notifié.
- `nprof` : numéro de profil de 0 à N. Liste spécifiée dans config.mjs de l'application.

Retour: rien

Assertion sur l'existence du row `Espaces`.

C'est une opération "admin", elle échappe aux contrôles espace figé / clos.
Elle n'écrit QUE dans espaces.
*/
operations.SetEspaceNprof = class SetEspaceNprof extends Operation {
  constructor (nom) { super(nom, 3)}

  async phase2 (args) {
    this.espace = compile(await this.getRowEspace(args.ns, 'SetEspaceNprof'))
    this.espace._maj = true
    this.espace.nprof = args.nprof
  }
}

/** Ajout d\'un sponsoring ****************************************************
- `token` : éléments d'authentification du comptable / compte délégué de la partition.
- id : id du sponsor
- hYR : hash du PNKFD de la phrase de sponsoring réduite (SANS ns)
- `psK` : texte de la phrase de sponsoring cryptée par la clé K du sponsor.
- `YCK` : PBKFD de la phrase de sponsoring cryptée par la clé K du sponsor.
- `hYC` : hash du PBKFD de la phrase de sponsoring,
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
  constructor (nom) { super(nom, 1, 1) }

  async phase2 (args) {
    if (await this.db.getCompteHXR(this.args.hps1)) 
      throw new AppExc(F_SRV, 207)

    if (args.partitionId) { // compte O
      const partition = compile(await this.getRowPartition(args.partitionId))
      if (!partition) 
        throw new AppExc(F_SRV, 208, [args.partitionId])
      const e = partition.mcpt[ID.court(this.compte.id)]
      if (!e || !eqU8(e.cleAP, args.cleAP)) 
        throw new AppExc(F_SRV, 209, [args.partitionId, this.compte.id])
      if (!e.del) 
        throw new AppExc(F_SRV, 210, [args.partitionId, this.compte.id])

      const s = partition.getSynthese()
      const q = args.quotas
      // restants à attribuer suffisant pour satisfaire les quotas ?
      if (q.qc > (s.q.qc - s.qt.qc) || q.qn > (s.q.qn - s.qt.qn) || q.qv > (s.q.sv - s.qt.qv))
        throw new AppExc(F_SRV, 211, [args.partitionId, this.compte.id])
    } else {
      if (this.estComptable || !this.compte.estA) args.don = 2
      else {
        if (this.compta.solde <= args.don + 2)
          throw new AppExc(F_SRV, 212, [this.compta.solde, args.don])
      }
    }

    const sponsoring = new Sponsorings().nouveau(args)
    const vsp = await this.getVAvGr(sponsoring.id, 'AjoutSponsoring-1')
    vsp.v++
    this.setV(vsp)
    sponsoring.v = vsp.v
    sponsoring.dh = this.dh
    this.insert(sponsoring.toRow())
  }
}

/* `ProlongerSponsoring` : prolongation d'un sponsoring existant
Change la date limite de validité du sponsoring pour une date plus lointaine. Ne fais rien si le sponsoring n'est pas _actif_ (hors limite, déjà accepté ou refusé).
POST:
- `token` : éléments d'authentification du comptable / compte sponsor de sa tribu.
- `id ids` : identifiant du sponsoring.
- `dlv` : nouvelle date limite de validité `aaaammjj`ou 0 pour une  annulation.

Retour: rien

Assertion sur l'existence des rows `Sponsorings` et `Versions` du compte.
*/
operations.ProlongerSponsoring = class ProlongerSponsoring extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2(args) {
    const sp = compile(await this.getRowSponsoring(args.id, args.ids, 'ProlongerSponsoring'))
    if (sp.st === 0) {
      const vsp = await this.getVAvGr(args.id, 'ProlongerSponsoring-2')
      vsp.v++
      sp.v = vsp.v
      sp.dh = Date.now()
      if (args.dlv) {
        sp.dlv = args.dlv
      } else {
        sp.st = 3
      }
      this.update(sp.toRow())
      this.setV(vsp)
    }
  }
}

/* `RefusSponsoring` : refus d'un sponsoring
args.id ids : identifiant du sponsoring
args.ardYC : réponse du filleul
args.hYC: hash du PBKFD de la phrase de sponsoring
*/
operations.RefusSponsoring = class RefusSponsoring extends Operation {
  constructor (nom) { super(nom, 0) }

  async phase2(args) {
    this.ns = ID.ns(args.id)

    // Recherche du sponsorings
    const sp = compile(await this.db.get(this, 'sponsorings', args.id, args.ids))
    if (!sp) throw assertKO('SyncSp-1', 13, [args.id, args.ids])
    if (sp.st !== 0 || sp.dlv < this.auj) throw new AppExc(F_SRV, 9, [args.id, args.ids])
    if (sp.hYC !== args.hYC) throw new AppExc(F_SRV, 217)

    // Maj du sponsoring: st dconf2 dh ardYC
    const avsponsor = compile(await this.getRowAvatar(args.id, 'SyncSp-10'))
    const vsp = await this.getV(avsponsor, 'SyncSp-3')
    vsp.v++
    sp.v = vsp.v
    sp.dh = this.dh
    sp.st = 1
    sp.ardYC = args.ardYC
    this.update(sp.toRow())
    this.setV(vsp)
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
operations.MajChat = class MajChat extends Operation {
  constructor (nom) { super(nom, 1, 1) }

  addChatItem (items, item) {
    const nl = [item]
    let lg = item.t ? item.t.length : 0
    for (const it of items) {
      lg += it.t ? it.t.length : 0
      if (lg > 5000) return nl
      nl.push(it)
    }
    return nl
  }

  razChatItem (items, dh) { 
    // a : 0:écrit par I, 1: écrit par E
    const nl = []
    for (const it of items) {
      if (it.dh === dh) {
        nl.push({a: it.a, dh, dhx: this.dh})
      } else {
        nl.push(it)
      }
    }
    return nl
  }

  async phase2 (args) {
    const chI = compile(await this.getRowChat(args.id, args.ids, 'MajChat-1'))
    const avI = compile(await this.getRowAvatar(args.id, 'MajChat-2'))
    const vchI = await this.getV(avI, 'MajChat-3')
    vchI.v++
    this.setV(vchI)

    const idEL = ID.long(chI.idE, this.ns)
    const chE = compile(await this.getRowChat(idEL, chI.idsE))

    if (!chE) {
      // E disparu. Maj interdite:
      const st1 = Math.floor(chI.st / 10)
      chI.st = (st1 * 10) + 2 
      chI.vcv = 0
      chI.cvE = null
      this.setRes('disp', true)
      chI.v = vchI.v
      this.update(chI.toRow())
      return
    }

    let comptaE = null
    if (args.don) {
      comptaE = compile(await this.getRowCompta(idEL))
      if (!comptaE) throw new AppExc(F_SRV, 213)
      if (!comptaE._estA) throw new AppExc(F_SRV, 214)
      if (!this.compta._estA) throw new AppExc(F_SRV, 214)
      this.compta.donDB(args.don)
      comptaE.donCR(args.don)
      comptaE.v++
      this.setNV(comptaE)
      this.update(comptaE.toRow())
    }

    // cas normal : maj sur chI et chE
    const avE = compile(await this.getRowAvatar(idEL, 'MajChat-4'))
    const vchE = await this.getV(avE, 'MajChat-5')
    vchE.v++
    this.setV(vchE)

    if (args.t) {
      const itemI = args.t ? { a: 0, dh: this.dh, t: args.t } : null
      const itemE = args.t ? { a: 1, dh: this.dh, t: args.t } : null  
      chI.items = this.addChatItem(chI.items, itemI)
      chE.items = this.addChatItem(chE.items, itemE)
    } else if (args.dh) {
      chI.items = this.razChatItem(chI.items, args.dh)
      chE.items = this.razChatItem(chE.items, args.dh)
    }

    chI.cvE = avE.cvA || {id: ID.court(avE.id)}
    chI.vcv = chI.cvE.v || 0
    chE.cvE = avI.cvA || {id: avI.id}
    chE.vcv = chE.cvE.v || 0
   
    if (Math.floor(chI.st / 10) === 0) { // I était passif, redevient actif
      chI.st = 10 + (chI.st % 10)
      this.compta.ncPlus(1)
      chE.st = (Math.floor(chE.st / 10) * 10) + 1 
    }

    chI.v = vchI.v
    chE.v = vchE.v
    this.update(chI.toRow())
    this.update(chE.toRow())
  }
}

/* `SetNotifE` : déclaration d'une notification à un espace par l'administrateur
- `token` : jeton d'authentification du compte de **l'administrateur**
- `ns` : id de l'espace notifié
- `ntf` : sérialisation de l'objet notif, cryptée par la clé du comptable de l'espace. Cette clé étant publique, le cryptage est symbolique et vise seulement à éviter une lecture simple en base.

C'est une opération "admin", elle échappe aux contrôles espace figé / clos.
Elle n'écrit QUE dans espaces.
*/
operations.SetNotifE = class SetNotifE extends Operation {
  constructor (nom) { super(nom, 3) }

  async phase2 (args) {
    this.espace = compile(await this.getRowEspace(args.ns, 'SetNotifG'))
    this.espace._maj = true
    if (args.ntf) args.ntf.dh = Date.now()
    this.espace.notifE = args.ntf || null
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
      const partition = compile(await this.getRowPartition(idp, 'GetCompta-2'))
      const e = partition.mcpt(ID.court(id))
      if (!e) throw new AppExc(F_SRV, 219)
    }
    const rowCompta = await this.getRowCompta(id, 'GetCompta-1')
    this.setRes('rowCompta', rowCompta)
  }
}

/* `SetDhvuCompta` : enregistrement de la date-heure de _vue_ des notifications dans une session
POST: 
- `token` : éléments d'authentification du compte.
- `dhvu` : date-heure cryptée par la clé K.

Assertion sur l'existence du row `Comptas` du compte.
*/
operations.SetDhvuCompta = class SetDhvuCompta extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) {
    this.compte._maj = true
    this.compte.dhvuK = args.dhvu
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
    const avatar = compile(await this.getAvatarHpc(args.hZR))
    if (avatar && avatar.hZC === args.hZC) {
      this.setRes('cleAZC', avatar.cleAZC)
      this.setRes('cvA', avatar.cvA)
    }
    if (avatar) this.setRes('collision', true)
  }
}

/* OP_NouveauChat: 'Création d\'un nouveau chat' *********************************
- token: éléments d'authentification du compte.
- idI
- idE
- mode 
  - 0: par phrase de contact - hZC en est le hash
  - 1: idE est délégué de la partition de idI
  - idp: idE et idI sont co-membres du groupe idg (idI a accès aux membres)
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
operations.NouveauChat = class NouveauChat extends Operation {
  constructor (nom) { super(nom, 1) }

  async phase2 (args) {
    const avI = compile(await this.getRowAvatar(args.idI, 'NouveauChat-1'))
    const avE = compile(await this.getRowAvatar(args.idE, 'NouveauChat-2'))

    if (!args.mode) {
      if (avE.hZC !== args.hZC) throw new AppExc(F_SRV, 221)
    } else if (args.mode === 1) {
      if (!ID.estComptable(args.idE)) throw new AppExc(F_SRV, 225)
    } else if (args.mode === 2) {
      const partition = compile(await this.getRowPartition(ID.long(this.compte.idp), this.ns))
      if (!partition || !partition.estDel(args.idE)) throw new AppExc(F_SRV, 222)
    } else {
      const groupe = compile(await this.getRowGroupe(args.mode))
      if (!groupe) throw new AppExc(F_SRV, 223)
      const imI = groupe.mmb.get(args.idI)
      const imE = groupe.mmb.get(args.idE)
      if (!imI || !imE) throw new AppExc(F_SRV, 223)
      const fI = groupe.flags[imI]
      if (!(fI & FLAGS.AC) && (fI & FLAGS.AM) && (fI & FLAGS.DM)) throw new AppExc(F_SRV, 223)
      if (!(fI & FLAGS.AC)) throw new AppExc(F_SRV, 223)
    }

    const idsI = this.idsChat(args.idI, args.idE)
    const idsE = this.idsChat(args.idE, args.idI)

    const rchI = await this.getRowChat(args.idI, idsI)
    if (rchI) { this.setRes('rowChat', rchI); return}

    const vchI = await this.getV(avI, 'NouveauChat-3') // du sponsor
    vchI.v++
    this.setV(vchI)
    const chI = new Chats().init({ 
      id: args.idI,
      ids: ID.long(idsI, this.ns),
      v: vchI.v,
      st: 10,
      idE: ID.court(args.idE),
      idsE: idsE,
      cvE: avE.cvA,
      cleCKP: args.ch.ccK,
      cleEC: args.ch.cleE1C,
      items: [{a: 1, dh: this.dh, t: args.ch.txt}]
    })
    this.setRes('rowChat', this.insert(chI.toRow()))
    this.compta.ncPlus(1)

    const vchE = await this.getV(avE, 'NouveauChat-4')
    vchE.v++
    this.setV(vchE)
    const chE = new Chats().init({
      id: args.idI,
      ids: ID.long(idsE, this.ns),
      v: vchE.v,
      st: 1,
      idE: ID.court(args.idI),
      idsE: idsI,
      cvE: avI.cvA,
      cleCKP: args.ch.ccP,
      cleEC: args.ch.cleE2C,
      items: [{a: 0, dh: this.dh, t: args.ch.t1c}, {a: 1, dh: this.dh, t: args.ch.t2c}]
    })
    this.insert(chE.toRow())
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
    if (args.hZR && await this.getAvatarHpc(args.hZR)) throw new AppExc(F_SRV, 26)

    if (!this.compte.mav[ID.court(args.id)]) throw new AppExc(F_SRV, 224)

    const avatar = compile(await this.getRowAvatar(args.id, 'ChangementPC-1'))
    const vav = await this.getV(avatar, 'ChangementPC-2') 
    vav.v++
    this.setV(vav)
    avatar.v = vav.v

    if (args.pcK) {
      avatar.hZR = ID.long(args.hZR, this.ns)
      avatar.hZC = args.hZC
      avatar.cleAZC = args.cleAZC
      avatar.pcK = args.pcK
    } else {
      delete avatar.hZC
      delete avatar.hZR
      delete avatar.pcK
      delete avatar.cleAZC
    }
    this.update(avatar.toRow())
  }
}
