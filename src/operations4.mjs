import { AppExc, F_SRV, ID, FLAGS, d14 } from './api.mjs'
import { config } from './config.mjs'
import { operations } from './cfgexpress.mjs'
import { eqU8 } from './util.mjs'

import { Operation, R } from './modele.mjs'
import { compile, Sponsorings, Chats, Partitions, Tickets, Avatars,
  Groupes, Membres, Chatgrs } from './gendoc.mjs'

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
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) {
    if (this.setR.has(R.LECT)) throw new AppExc(F_SRV, 801)
    if (this.setR.has(R.MINI)) throw new AppExc(F_SRV, 802)

    if (await this.db.getCompteHXR(this.args.hps1)) 
      throw new AppExc(F_SRV, 207)

    if (args.partitionId) { // compte O
      const partition = compile(await this.getRowPartition(args.partitionId))
      if (!partition) 
        throw new AppExc(F_SRV, 208, [args.partitionId])
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
      if (this.estComptable || !this.compte.estA) args.don = 2
      else {
        if (this.compta.solde <= args.don + 2)
          throw new AppExc(F_SRV, 212, [this.compta.solde, args.don])
      }
    }

    const av = compile(await this.getRowAvatar(sponsoring.id, 'AjoutSponsoring-1'))
    const sponsoring = Sponsorings.nouveau(args, av.rds)
    const vsp = await this.getV(av)
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
    if (this.setR.has(R.LECT)) throw new AppExc(F_SRV, 801)
    if (this.setR.has(R.MINI)) throw new AppExc(F_SRV, 802)

    const sp = compile(await this.getRowSponsoring(args.id, args.ids, 'ProlongerSponsoring'))
    if (sp.st === 0) {
      const vsp = await this.getV(sp)
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
      const e = partition.mcpt[ID.court(id)]
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
    if (!avatar) this.setRes('collision', true)
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
    if (this.compte.mav[ID.court(args.idE)]) throw new AppExc(F_SRV, 226)

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

    /* Restriction MINI NE s'applique QUE,
    a) si l'interlocuteur n'est pas le comptable,
    b) ET:
      - compte 0 délégué: 
        - si l'interlocuteur n'est pas COMPTE O de la même partition
      - compte 0 NON délégué: 
        - l'interlocuteur n'est pas COMPTE délégué de la même partition
    */
    if (this.setR.has(R.MINI)) {
      const idE = args.idE
      if (!ID.estComptable(idE)) {
        if (this.compte._estA) throw new AppExc(F_SRV, 802)
        else {
          const cptE = compile(await this.getRowCompte(idE))
          if (!this.compte.del) {
            if (!cptE || !cptE.del || cptE.idp !== this.compte.idp) 
              throw new AppExc(F_SRV, 802)
          } else {
            if (!cptE || cptE.idp !== this.compte.idp) 
              throw new AppExc(F_SRV, 802)
          }
        }
      }
    }

    const idsI = this.idsChat(args.idI, args.idE)
    const idsE = this.idsChat(args.idE, args.idI)

    const rchI = await this.getRowChat(args.idI, idsI)
    if (rchI) { this.setRes('rowChat', rchI); return}

    const vchI = await this.getV(avI, 'NouveauChat-3') // du sponsor
    vchI.v++
    this.setV(vchI)
    const chI = Chats.nouveau({ 
      id: args.idI,
      ids: idsI,
      v: vchI.v,
      st: 10,
      idE: ID.court(args.idE),
      idsE: idsE,
      cvE: avE.cvA,
      cleCKP: args.ch.ccK,
      cleEC: args.ch.cleE2C,
      items: [{a: 1, dh: this.dh, t: args.ch.txt}]
    }, avI.rds)
    this.setRes('rowChat', this.insert(chI.toRow()))
    this.compta.ncPlus(1)

    const vchE = await this.getV(avE, 'NouveauChat-4')
    vchE.v++
    this.setV(vchE)
    const chE = Chats.nouveau({
      id: args.idE,
      ids: idsE,
      v: vchE.v,
      st: 1,
      idE: ID.court(args.idI),
      idsE: idsI,
      cvE: avI.cvA,
      cleCKP: args.ch.ccP,
      cleEC: args.ch.cleE1C,
      items: [{a: 0, dh: this.dh, t: args.ch.txt}]
    }, avE.rds)
    this.insert(chE.toRow())
  }
}

class OperationCh extends Operation {

  /* Vérification des restrictions, initialisation de :
  chI, vchI, chE
  */
  async intro () {
    this.chI = compile(await this.getRowChat(this.args.id, this.args.ids, 'MajChat-9'))
    this.chI.ids = ID.court(this.chI.ids) // Contournemnet bug
    /* Restriction MINI NE s'applique QUE,
    a) si l'interlocuteur n'est pas le comptable,
    b) ET:
      - compte 0 délégué: 
        - si l'interlocuteur n'est pas COMPTE O de la même partition
      - compte 0 NON délégué: 
        - l'interlocuteur n'est pas COMPTE délégué de la même partition
    */
    if (this.setR.has(R.MINI)) {
      const idE = ID.long(this.chI.idE, this.ns)
      if (!ID.estComptable(idE)) {
        if (this.compte._estA) throw new AppExc(F_SRV, 802)
        else {
          const cptE = compile(await this.getRowCompte(idE))
          if (!this.compte.del) {
            if (!cptE || !cptE.del || cptE.idp !== this.compte.idp) 
              throw new AppExc(F_SRV, 802)
          } else {
            if (!cptE || cptE.idp !== this.compte.idp) 
              throw new AppExc(F_SRV, 802)
          }
        }
      }
    }
    this.avI = compile(await this.getRowAvatar(this.args.id, 'MajChat-2'))
    this.vchI = await this.getV(this.avI, 'MajChat-3')
    this.vchI.v++

    this.idEL = ID.long(this.chI.idE, this.ns)
    this.chE = compile(await this.getRowChat(this.idEL, this.chI.idsE))
    if (this.chE) this.chE.ids = ID.court(this.chE.ids) // Contournemnet bug
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
    await this.intro(args)

    if (!this.chE) {
      // E disparu. Maj interdite: statut disparu
      const st1 = Math.floor(this.chI.st / 10)
      this.chI.st = (st1 * 10) + 2 
      this.chI.vcv = 0
      this.chI.cvE = null
      this.chI.v = this.vchI.v
      this.setRes('disp', true)
      this.update(this.chI.toRow())
      this.setV(this.vchI)
      return
    }

    // cas normal : maj sur chI et chE

    if (args.don) {
      const comptaE = compile(await this.getRowCompta(this.idEL, 'MajChat-7'))
      if (!comptaE) throw new AppExc(F_SRV, 213)
      if (!comptaE._estA) throw new AppExc(F_SRV, 214)
      if (!this.compta._estA) throw new AppExc(F_SRV, 214)
      const compteE = compile(await this.getRowCompte(this.idEL, 'MajChat-8'))
      comptaE.don(compteE, this.dh, args.don, this.id)
      this.calculDlv(compteE, comptaE)
      const vcptE = await this.getV(compteE, 'MajChat-6')
      vcptE.v++
      compteE.v = vcptE.v
      this.update(compteE.toRow())
      this.setV(vcptE)
      comptaE.v++
      this.update(comptaE.toRow())

      this.compta.don(this.compte, this.dh, -args.don, compteE.id)
      this.calculDlv(this.compte, this.compta)
    }

    const avE = compile(await this.getRowAvatar(this.idEL, 'MajChat-4'))
    const vchE = await this.getV(avE, 'MajChat-5')
    vchE.v++
    this.setV(vchE)

    if (args.t) {
      const itemI = args.t ? { a: 0, dh: this.dh, t: args.t } : null
      const itemE = args.t ? { a: 1, dh: this.dh, t: args.t } : null  
      this.chI.items = this.addChatItem(this.chI.items, itemI)
      this.chE.items = this.addChatItem(this.chE.items, itemE)
    } else if (args.dh) {
      this.chI.items = this.razChatItem(this.chI.items, args.dh)
      this.chE.items = this.razChatItem(this.chE.items, args.dh)
    }

    // Maj CVs
    this.chI.cvE = avE.cvA || {id: ID.court(avE.id)}
    this.chI.vcv = this.chI.cvE.v || 0
    this.chE.cvE = this.avI.cvA || {id: this.avI.id}
    this.chE.vcv = this.chE.cvE.v || 0
   
    if (Math.floor(this.chI.st / 10) === 0) { // I était passif, redevient actif
      this.chI.st = 10 + (this.chI.st % 10)
      this.compta.ncPlus(1)
      this.chE.st = (Math.floor(this.chE.st / 10) * 10) + 1 
    }

    this.chI.v = this.vchI.v
    this.chE.v = vchE.v
    this.setV(this.vchI)
    this.update(this.chI.toRow())
    this.update(this.chE.toRow())
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
    await this.intro()

    if (!this.chE) {
      // E disparu. Il voulait être passif, devient détruit
      this.chI._zombi = true
      this.setRes('suppr', true)
      this.update(this.chI.toRow())
      this.setV(this.vchI)
      return
    }

    const stI = Math.floor(this.chI.st / 10)
    const stE = this.chI.st % 10

    if (stI === 0) {
      // était passif, reste passif, rien n'a changé
      return
    }

    // était actif, devient passif
    this.chI.st = stE
    this.chI.items = []
    this.compta.ncPlus(-1)
    if (this.chE) {
      // l'autre n'était pas disparu, MAJ de cv et st
      const avE = compile(await this.getRowAvatar(this.idEL, 'PassifChat-4'))
      const vchE = await this.getV(avE, 'PassifChat-3')
      vchE.v++
      this.chE.v = vchE.v

      const avI = compile(await this.getRowAvatar(this.id, 'PassifChat-4'))
      this.chE.cvE = avI.cvA
      this.chE.vcv = this.chE.cvE.v || 0
      this.chE.st = Math.floor(this.chE.st / 10) * 10

      this.update(this.chE.toRow())
      this.setV(vchE)

      // Maj CV de I
      this.chI.cvE = avE.cvA
      this.chI.vcv = this.chI.cvE.v || 0
    }
    this.chI.v = this.vchI.v
    this.update(this.chI.toRow())
    this.setV(this.vchI)
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
      avatar.hpc = ID.long(args.hZR, this.ns)
      avatar.hZC = args.hZC
      avatar.cleAZC = args.cleAZC
      avatar.pcK = args.pcK
    } else {
      avatar.hpc = 0
      delete avatar.hZR
      delete avatar.pcK
      delete avatar.cleAZC
    }
    this.update(avatar.toRow())
  }
}

/* OP_EstAutonome: 'Vérification que le bénéficiaire envisagé d\'un don est bien un compte autonome'
indique si l'avatar donné en argument est 
l'avatar principal d'un compte autonome
- token : jeton d'authentification du compte de **l'administrateur**
- id : id de l'avatar
Retour: 
- `st`: 
  - 0 : pas avatar principal 
  - 1 : avatar principal d'un compte A
  - 2 : avatar principal d'un compte O
*/
operations.EstAutonome = class EstAutonome extends Operation {
  constructor (nom) { super(nom, 1) }

  async phase2(args) {
    const compte = compile(await this.getRowCompte(args.id))
    if (!compte) { this.setRes('st', 0) }
    this.setRes('st', compte.idp ? 2 : 1)
  }
}

/* OP_RafraichirCvsAv: 'Rafraichissement des CVs des chats de l\'avatar'
- token : jeton d'authentification du compte de **l'administrateur**
- id : id de l'avatar
Retour:
- `n`: nombre de CV mises à jour
*/
operations.RafraichirCvsAv = class RafraichirCvsAv extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2(args) {
    /* Restriction MINI NE s'applique QUE si le compte n'est pas le comptable */
    if (this.setR.has(R.MINI) && !this.estComptable) 
      throw new AppExc(F_SRV, 802)
    if (!this.compte.mav[ID.court(args.id)])
      throw new AppExc(F_SRV, 227)

    const avatar = compile(await this.getRowAvatar(args.id, 'RafCVsAv-1'))
    const vav = await this.getV(avatar)
    vav.v++
    let nc = 0
    let nv = 0
    // liste des chats
    for (const row of await this.db.scoll(this, 'chats', args.id, 0)) {
      const chI = compile(row)
      nv++
      if (chI.vcv < avatar.vcv) {
        chI.cvE = avatar.cvA
        chI.vcv = avatar.cvA.vcv
        chI.v = vav.v
        this.update(chI.toRow())
        nc++
      }
    }
    if (nc) this.setV(vav)
    this.setRes('ncnv', [nc, nv])
  }
}

/* `SetQuotas` : déclaration des quotas d'un compte par un sponsor de sa tribu
- token: éléments d'authentification du compte.
- idp : id de la partition
- idc: id du compte
- q: {qc, qn, qv}
*/
operations.SetQuotas = class SetQuotas extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) {
    let compta = this.compta
    let compte = this.compte
    if (args.idc !== this.id) {
      compta = compile(await this.getRowCompta(args.idc, 'SetQuotas-1'))
      compte = compile(await this.getRowCompte(args.idc, 'SetQuotas-2'))
    }

    compta.quotas(args.q)
    // report dans compte
    compte._maj = true
    const qvc = compte.qv // { qc, qn, qv, pcc, pcn, pcv, nbj }
    const qv = compta.qv // {qc, qn, qv, nn, nc, ng, v}
    qvc.qc = qv.qc; qvc.qn = qv.qn; qvc.qv = qv.qv;
    if (!compte._estA) qvc.pcc = compta._pc.pcc; else qvc.nbj = compta._nbj
    qvc.pcn = compta._pc.pcn; qvc.pcv = compta._pc.pcv

    if (!compte._estA) {
      if (!this.partitions) this.partitions = new Map()
      const partition = compile(await this.getRowPartition(args.idp))
      this.partitions.set(partition.id, partition)
      const e = partition.mcpt[ID.court(args.idc)]
      if (e) { e.q = qv; e.q.c2m = compta._c2m }
      partition._maj = true
    }

    if (args.idc !== this.id) {
      // Le compte mis à jour n'est pas le compte de la session
      compta.v = compta.v++
      this.update(compta.toRow())
      const vcpt = await this.getV(compte, 'SetQuotas-3')
      vcpt.v++
      compte.v = vcpt.v
      this.setV(vcpt)
      this.update(compte.toRow())
    }
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
    const np = this.compte.tpk.length
    if (np !== args.n) throw new AppExc(F_SRV, 228)
    this.compte.tpk.push(args.itemK)
    this.compte._maj = true
    if (!this.partitions) this.partitions = new Map()
    const partition = Partitions.nouveau(this.ns, np, args.quotas)
    this.partitions.set(partition.id, partition)
    this.espace = compile (await this.getRowEspace(this.ns, 'NouvellePartition-1'))
    this.espace.setPartition(np)
  }
}

/* OP_SetQuotasPart: 'Mise à jour des quotas d\'une tpartition'
- token: éléments d'authentification du compte.
- idp : id de la partition
- quotas: {qc, qn, qv}
Retour:
*/
operations.SetQuotasPart = class SetQuotasPart extends Operation {
  constructor (nom) { super(nom, 2, 2) }

  async phase2 (args) {
    this.partitions = new Map()
    const partition = compile(await this.getRowPartition(args.idp, 'SetQuotasPart-1'))
    this.partitions.set(args.idp, partition)
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
    const e = this.compte.tpk[np]
    if (!e) throw new AppExc(F_SRV, 229)
    this.compte.tpk[np] = args.etpk
    this.compte._maj = true
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
    const cpt = compile(await this.getRowCompte(args.id, 'ChangerPartition-1'))
    const partav = compile(await this.getRowPartition(ID.long(cpt.idp, this.ns), 'ChangerPartition-2'))
    const idc = ID.court(args.id)
    const idpc = ID.court(args.idp)
    const epav = partav.mcpt[idc]
    if (!epav) throw new AppExc(F_SRV, 232)
    const partap = compile(await this.getRowPartition(args.idp, 'ChangerPartition-3'))
    const epap = partap.mcpt[idc]
    if (epap) throw new AppExc(F_SRV, 233)

    // Retrait de l'ancienne partition, ajout à la nouvelle
    this.partitions = new Map()
    this.partitions.set(partav.id, partav)
    this.partitions.set(partap.id, partap)
    let qx = epav.q
    if (!qx) { // Contournement de bug
      const cpta = compile(await this.getRowCompta(args.id))
      qx = cpta.qv
    }
    partap.mcpt[idc] = { // { nr, cleAP, del, q }
      nr: args.notif ? args.notif.nr : 0,
      cleAP: args.cleAP,
      del: epav.del,
      q: qx
    }
    partap._maj = true
    delete partav.mcpt[idc]
    partav._maj = true

    // Maj du compte
    cpt._maj = true
    cpt.idp = idpc
    cpt.clePK = args.clePK
    cpt.notif = args.notif || null
    cpt.del = epav.del

    const vcpt = await this.getV(cpt, 'ChangerPartition-4')
    vcpt.v++
    cpt.v = vcpt.v
    this.setV(vcpt)
    this.update(cpt.toRow())
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
    const cpt = compile(await this.getRowCompte(args.id, 'DeleguePartition-1'))
    const part = compile(await this.getRowPartition(ID.long(cpt.idp, this.ns), 'DeleguePartition-2'))
    const idc = ID.court(args.id)
    const epart = part.mcpt[idc]
    if (!epart) throw new AppExc(F_SRV, 232)

    // Retrait de l'ancienne partition, ajout à la nouvelle
    this.partitions = new Map()
    this.partitions.set(part.id, part)
    epart.del = args.del
    part._maj = true

    // Maj du compte
    cpt._maj = true
    cpt.del = args.del
    const vcpt = await this.getV(cpt, 'DeleguePartition-4')
    vcpt.v++
    cpt.v = vcpt.v
    this.setV(vcpt)
    this.update(cpt.toRow())
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
    
    this.espace = compile(await this.getRowEspace(this.ns, 'SetNotifP-1'))
    const ntf = this.espace.tnotifP[ID.court(args.idp)]
    const aut = ntf ? (ntf.idDel ? ID.long(ntf.idDel, this.ns) : ID.duComptable(this.ns)) : null
    if (aut && ed && ID.estComptable(aut)) throw new AppExc(F_SRV, 237)
    if (args.notif) args.notif.idDel = ID.court(this.id)
    this.espace.setNotifP(args.notif, ID.court(args.idp))

    this.partitions= new Map()
    const partition = compile(await this.getRowPartition(args.idp, 'SetNotifP-2'))
    this.partitions.set(args.idp, partition)
    partition._maj = true
    partition.nrp = args.notif ? args.notif.nr : 0
  }
}

/* `SetNotifC` : notification d'un compte d'une tribu
- `token` : éléments d'authentification du compte.
- `idc` : id du compte
- `notif` : notification du compte cryptée par la clé de partition
*/
operations.SetNotifC = class SetNotifC extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) {
    const compte = compile(await this.getRowCompte(args.idc, 'SetNotifC-1'))

    const ec = this.estComptable
    const ed = !ec && this.compte.del
    if ((!ec && !ed) || (ed && this.compte.idp !== compte.idp)) throw new AppExc(F_SRV, 238)

    const ntf = compte.notif
    const aut = ntf ? (ntf.idDel ? ID.long(ntf.idDel, this.ns) : ID.duComptable(this.ns)) : null
    if (aut && ed && ID.estComptable(aut)) throw new AppExc(F_SRV, 237)
    if (args.notif) args.notif.idDel = ID.court(this.id)

    const vcpt = await this.getV(compte, 'SetNotifC-2')
    vcpt.v++
    compte.v = vcpt.v
    compte.notif = args.notif || null
    this.setV(vcpt)
    this.update(compte.toRow())

    this.partitions = new Map()
    const partition = compile(await this.getRowPartition(ID.long(compte.idp, this.ns), 'SetNotifC-3'))
    this.partitions.set(args.idp, partition)
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
    const idc = ID.duComptable(this.ns)

    const rtk = await this.getRowTicket(idc, args.ids)
    if (rtk) throw new AppExc(F_SRV, 239)

    const comptable = compile(await this.getRowAvatar(idc, 'PlusTicket-1'))

    const tk = Tickets.nouveau(this.id, comptable.rds, args.ids, args.ma, args.refa || '')
    this.compta.plusTk(tk)

    const version = await this.getV(comptable, 'PlusTicket-2')
    version.v++
    tk.id = idc
    tk.v = version.v
    this.insert(tk.toRow())
    this.setV(version)
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

    const tk = compile(await this.getRowTicket(idc, args.ids))
    if (!tk) throw new AppExc(F_SRV, 240)

    this.compta.moinsTk(tk)

    const comptable = compile(await this.getRowAvatar(idc, 'PlusTicket-1'))
    const version = await this.getV(comptable, 'PlusTicket-2')
    version.v++
    tk._zombi = true
    tk.v = version.v
    this.update(tk.toRow())
    this.setV(version)
  }

  phase3() {
    this.setRes('rowCompta', this.compta.toRow())
  }
}

/* OP_ReceptionTicket: 'Réception d\'un ticket par le Comptable'
- `token` : jeton d'authentification du compte de **l'administrateur**
- `ids` : du ticket
- `mc` : montant reçu
- `refc` : référence du Comptable
Retour: rien
*/
operations.ReceptionTicket = class ReceptionTicket extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2(args) {

    const tk = compile(await this.getRowTicket(this.id, args.ids))
    if (!tk) throw new AppExc(F_SRV, 240)
    if (tk.dr) throw new AppExc(F_SRV, 241)

    const comptable = compile(await this.getRowAvatar(this.id, 'ReceptionTicket-1'))
    const version = await this.getV(comptable, 'ReceptionTicket-2')
    version.v++
    tk.dr = this.auj
    tk.v = version.v

    const compte = compile(await this.getRowCompte(ID.long(tk.idc, this.ns)))
    const compta = compile(await this.getRowCompta(ID.long(tk.idc, this.ns)))
    if (!compta || !compte) { // Compte disparu
      tk.disp = true
    } else {
      compta.enregTk(compte, tk, args.mc, args.refc)
      this.calculDlv(compte, compta)
      compta.v++
      this.update(compta.toRow())
      const vcpt = await this.getV(compte, 'ReceptionTicket-3')
      vcpt.v++
      compte.v = vcpt.v
      this.setV(vcpt)
      this.update(compte.toRow())
    }

    this.update(tk.toRow())
    this.setV(version)
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
      const avatar = compile(await this.getRowAvatar(idag, 'MajCv-1'))
      if (!this.compte.mav[args.cv.id]) throw new AppExc(F_SRV, 242)
      const vav = await this.getV(avatar, 'MajCv-2')
      vav.v++
      args.cv.v = vav.v
      avatar.v = vav.v
      avatar.vcv = vav.v
      avatar.cvA = args.cv
      this.update(avatar.toRow())
      this.setV(vav)
    } else {
      const e = this.compte.mpg[args.cv.id]
      if (!e) throw new AppExc(F_SRV, 243)
      const groupe = compile(await this.getRowGroupe((idag, 'MajCv-3')))
      let ok = false
      for(const ida of e.lav) {
        const im = groupe.mmb.get(ida)
        if (im) {
          const f = groupe.flags[im]
          if ((f & FLAGS.AC) && (f & FLAGS.PA)) ok = true
        }
      }
      if (!ok) throw new AppExc(F_SRV, 243)
      const vgr = await this.getV(groupe, 'MajCv-4')
      vgr.v++
      args.cv.v = vgr.v
      groupe.v = vgr.v
      groupe.vcv = vgr.v
      groupe.cvA = args.cv
      this.update(groupe.toRow())
      this.setV(vgr)
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
      const avatar = compile(await this.getRowAvatar(idag, 'MajCv-1'))
      this.setRes('cv', avatar.cvA)
    } else {
      const e = this.compte.mpg[args.cv.id]
      if (!e) throw new AppExc(F_SRV, 243)
      const groupe = compile(await this.getRowGroupe((idag, 'MajCv-3')))
      let ok = false
      for(const ida of e.lav) {
        if (groupe.mmb.get(ida)) ok = true
      }
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
    let avatar = compile(await this.getRowAvatar(args.id))
    if (avatar) throw new AppExc(F_SRV, 245)

    const rdsav = ID.rds(ID.RDSAVATAR)
    avatar = Avatars.nouveau(args.id, this.id, rdsav, args.pub, args.privK, args.cvA) 
    this.setNV(avatar)
    this.insert(avatar.toRow())
    this.compte.ajoutAvatar(avatar, args.cleAK)
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

    const vcpt = await this.getV(this.compte, 'McMemo-1')
    vcpt.v++
    const compti = compile(await this.getRowCompti(this.id, 'McMemo-2'))
    compti.mc[ID.court(args.id)] = { ht: args.htK, tx: args.txK }
    compti.v = vcpt.v
    this.update(compti.toRow())
    this.setV(vcpt)
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
    this.compte.hxr = (this.ns * d14) + args.hps1
    this.compte.hXC = args.hXC
    this.compte.cleKXC = args.cleKXC
    this.compte._maj = true
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
*/
operations.NouveauGroupe = class NouveauGroupe extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) { 
    const rg = await this.getRowGroupe(args.idg)
    if (rg) throw new AppExc(F_SRV, 246)

    const rds = ID.rds(ID.RDSGROUPE)
    const groupe = Groupes.nouveau (args.idg, args.ida, this.id, rds, 
      args.quotas, args.msu, args.cvG)
    this.insert(groupe.toRow())
    this.setNV(groupe)
    
    const chatgr = Chatgrs.nouveau(args.idg, rds)
    this.insert(chatgr.toRow())

    const avatar = compile(await this.getRowAvatar(args.ida, 'NouveauGroupe-1'))
    const membre = Membres.nouveau(args.idg, groupe.rds, 1, avatar.cvA, args.cleAG)
    membre.dpc = this.auj
    membre.dac = this.auj
    membre.dln = this.auj
    membre.den = this.auj
    membre.dam = this.auj
    membre.v = 1
    this.insert(membre.toRow())

    this.compte.ajoutGroupe(args.idg, args.ida, args.cleGK, rds)

    this.compta.ngPlus(1)
  }
}

/* Nouveau contact *****************************************************
- token donne les éléments d'authentification du compte.
- idg : du groupe
- ida : de l'avatar contact
- cleAG : clé A du contact cryptée par la clé G du groupe
Retour:
*/
operations.NouveauContact = class NouveauContact extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) { 
    const groupe = compile(await this.getRowGroupe(args.idg, 'NouveauContact-1'))
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
    
    const vg = await this.getV(groupe)
    vg.v++
    groupe.v = vg.v
    const im = groupe.nvContact(args.ida)
    this.update(groupe.toRow())
    this.setV(vg)
  
    const avatar = compile(await this.getRowAvatar(args.ida, 'NouveauContact-2'))
    const membre = Membres.nouveau(args.idg, groupe.rds, im, avatar.cvA, args.cleAG)
    membre.dpc = this.auj
    membre.v = vg.v
    this.insert(membre.toRow())
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
*/
operations.ModeSimple = class ModeSimple extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) { 
    const gr = compile(await this.getRowGroupe(args.idg, 'ModeSimple-1'))
    const vg = await this.getV(gr)
    vg.v++
    gr.v = vg.v

    if (!this.compte.mav[ID.court(args.ida)]) throw new AppExc(F_SRV, 249)
    const im = gr.mmb.get(args.ida)
    if (!im || gr.st[im] !== 5) throw new AppExc(F_SRV, 250)

    /* - `msu` : mode _simple_ ou _unanime_.
        - `null` : mode simple.
        - `[ids]` : mode unanime : liste des indices des animateurs ayant voté pour le retour au mode simple. La liste peut être vide mais existe.
    */
    if (!args.simple) gr.msu = []
    else {
      // demande de retour au mode simple
      if (!gr.msu) gr.msu = []
      const s = new Set(gr.msu)
      s.add(im)
      let ok = true
      gr.anims.forEach(imx => { if (!s.has(imx)) ok = false })
      if (ok) {
        // tous les animateurs ont voté pour
        gr.msu = null
      } else {
        gr.msu = Array.from(s)
      }
    }
    this.setV(vg)
    this.update(gr.toRow())
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
*/
operations.InvitationGroupe = class InvitationGroupe extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) { 
    const gr = compile(await this.getRowGroupe(args.idg, 'InvitationGroupe-1'))
    const vg = await this.getV(gr)
    const idgc = ID.court(args.idg)
    vg.v++
    gr.v = vg.v

    const idac = ID.court(args.idm)
    if (gr.lnc.indexOf(idac) !== -1) throw new AppExc(F_SRV, 260)
    if (gr.lng.indexOf(idac) !== -1) throw new AppExc(F_SRV, 261)

    const avatar = compile(await this.getRowAvatar(args.idm, 'InvitationGroupe-2'))
    const idc = ID.long(avatar.idc, this.ns)
    const cptinv = compile(await this.getRowCompte(idc, 'InvitationGroupe-2c'))
    const cinvit = compile(await this.getRowInvit(idc, 'InvitationGroupe-2b'))
    const vcpt = await this.getV(cptinv)
    vcpt.v++
    cinvit.v = vcpt.v

    const im = gr.mmb.get(args.idm)
    if (!im) throw new AppExc(F_SRV, 251)
    const membre = compile(await this.getRowMembre(args.idg, im, 'InvitationGroupe-3'))
    membre.v = vg.v

    const s = gr.st[im]
    
    if (args.suppr) { // suppression de l'invitation

      if (s < 2 || s > 3) throw new AppExc(F_SRV, 252)
      delete gr.invits[im]
      gr.st[im] = args.suppr > 1 ? 0 : 1
      if (args.suppr > 1) gr.tid[im] = 0
      gr.flags[im] = 0
      if (args.suppr === 3 && gr.lmg.indexOf(idgc) === -1) gr.lmg.push(idgc)
      this.update(gr.toRow())
      this.setV(vg)

      cinvit.supprInv(args.idg, args.idm)
      this.update(cinvit.toRow())
      this.setV(vcpt)

      if (args.suppr === 1) membre.msgG = null
      else membre._zombi = true
      this.update(membre.toRow()) // version est vg set ci-dessus
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
    gr.invits[im] = invit
    gr.st[im] = aInviter ? 3 : 2
    this.update(gr.toRow())
    this.setV(vg)

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
      this.update(cinvit.toRow())
      this.setV(vcpt)
    }

    // écriture du chat
    if (aInviter) {
      const ch = compile(await this.getRowChatgr(args.idg, 'InvitationGroupe-4'))
      /*- `im` : im du membre auteur,
        - `dh` : date-heure d'écriture.
        - `dhx` : date-heure de suppression.
        - `t` : texte crypté par la clé G du groupe (vide s'il a été supprimé).
      */
      ch.v = vg.v
      ch.addItem(invit.li[0], this.dh, args.msgG)
      this.update(ch.toRow())
    }
    
    // maj du membre invité
    if (aInviter) membre.ddi = this.auj
    membre.msgG = args.msgG
    this.update(membre.toRow())
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
*/
operations.AcceptInvitation = class AcceptInvitation extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) { 
    const gr = compile(await this.getRowGroupe(args.idg, 'AcceptInvitation-1'))
    const vg = await this.getV(gr)
    const idgc = ID.court(args.idg)
    vg.v++
    gr.v = vg.v

    const avatar = compile(await this.getRowAvatar(args.idm, 'AcceptInvitation-2'))
    const va = await this.getV(avatar)
    va.v++
    avatar.v = va.v

    const im = gr.mmb.get(args.idm)
    if (!im) throw new AppExc(F_SRV, 251)
    if (gr.st[im] !== 3) throw new AppExc(F_SRV, 259)
    const membre = compile(await this.getRowMembre(args.idg, im, 'AcceptInvitation-3'))
    membre.v = vg.v

    if (args.cas === 1) { // acceptation
      const fl = gr.invits[im].fl // flags d'invit
      const f = gr.flags[im] // flags actuels
      let nf = 0
      if ((f & FLAGS.HM) || ((fl & FLAGS.DM) && args.iam)) nf |= FLAGS.HM
      if ((f & FLAGS.HN) || (((fl & FLAGS.DN) || (fl & FLAGS.DE)) && args.ian)) nf |= FLAGS.HN
      if ((f & FLAGS.HE) || ((fl & FLAGS.DE) && args.iam)) nf |= FLAGS.HE
      if (fl & FLAGS.DM) nf |= FLAGS.DM
      if (fl & FLAGS.DN) nf |= FLAGS.DN
      if (fl & FLAGS.DE) nf |= FLAGS.DE
      if (args.iam) nf |= FLAGS.AM
      if (args.ian) nf |= FLAGS.AN
      gr.flags[im] = nf
      gr.st[im] = (fl & FLAGS.AN) ? 5 : 4
      delete gr.invits[im]
      this.update(gr.toRow())
      this.setV(vg)
      const ln = (nf & FLAGS.DN) && (nf & FLAGS.AN)
      const en = ln && (nf & FLAGS.DE)
      const am = (nf && FLAGS.DM) && (nf & FLAGS.AM)
      
      // avatar
      delete avatar.invits[idgc]
      this.update(avatar.toRow())
      this.setV(va)

      // maj du membre invité: dac dln den dam
      if (!membre.dac) membre.dac = this.auj
      if (!membre.dln && ln) membre.dln = this.auj
      if (!membre.den && en) membre.den = this.auj
      if (!membre.dam && am) membre.dam = this.auj
      membre.msgG = null
      membre.v = vg.v
      this.update(membre.toRow())

      // écriture du chat
      const ch = compile(await this.getRowChatgr(args.idg, 'InvitationGroupe-4'))
      ch.v = vg.v
      ch.addItem(im, this.dh, args.msgG)
      this.update(ch.toRow())

      // enreg compte et compta
      this.compte.ajoutGroupe(args.idg, args.idm, args.cleGK, gr.rds)
      this.compta.ngPlus(1)
      return
    }

    // refus - cas: 2:contact 3:radié 4:radié + LN
    gr.st[im] = args.cas === 2 ? 1 : 0
    delete gr.invits[im]
    if (args.cas > 2) {
      gr.tid[im] = 0
      gr.flags[im] = 0
      const idmc = ID.court(args.idm)
      if (args.cas === 4 && gr.lnc.indexOf(idmc) === -1) gr.lnc.push(idmc)
    }
    this.update(gr.toRow())
    this.setV(vg)

    // avatar
    delete avatar.invits[idgc]
    this.update(avatar.toRow())
    this.setV(va)

    // maj du membre invité: dac dln den dam
    if (args.cas === 2) membre.msgG = null
    else membre._zombi = true
    membre.v = vg.v
    this.update(membre.toRow())

    // écriture du chat
    const ch = compile(await this.getRowChatgr(args.idg, 'InvitationGroupe-4'))
    ch.v = vg.v
    ch.addItem(im, this.dh, args.msgG)
    this.update(ch.toRow())
  }
}

/* OP_MajDroitsMembre: 'Mise à jour des droits d\'un membre sur un groupe' *******
- token donne les éléments d'authentification du compte.
- idg : id du groupe
- idm : id du membre
- nvflags : nouveau flags. Peuvent changer DM DN DE AM AN
- anim: true si animateur
Retour:
*/
operations.MajDroitsMembre = class MajDroitsMembre extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) { 
    const gr = compile(await this.getRowGroupe(args.idg, 'MajDroitsMembre-1'))
    const vg = await this.getV(gr)
    vg.v++
    gr.v = vg.v
    // Set des im des avatars du compte étant animateur */
    const anc = this.compte.imAnimsDeGr(gr)

    await this.getRowAvatar(args.idm, 'MajDroitsMembre-2')

    const im = gr.mmb.get(args.idm)
    if (!im) throw new AppExc(F_SRV, 251)    
    const stm = gr.st[im] 
    if (stm < 4) throw new AppExc(F_SRV, 262)

    if (args.anim && stm === 4) {
      // passer le membre en animateur
      if (!anc.size) throw new AppExc(F_SRV, 263)
      gr.st[im] = 5
    }
    if (!args.anim && stm === 5) {
      // supprimer le statut d'animateur du membre - Possible pour soi-même seulement
      if (!anc.has(im)) throw new AppExc(F_SRV, 264)
      gr.st[im] = 4
    }

    /* Ajouter un ou des flags: n |= FLAGS.HA | FLAGS.AC | FLAGS.IN
       Enlever un ou des flags: n &= ~FLAGS.AC & ~FLAGS.IN */
    const fl = gr.flags[im]
    let nvfl = fl
    const iam = args.nvflags & FLAGS.AM
    const ian = args.nvflags & FLAGS.AN
    const iamav = fl & FLAGS.AM
    const ianav = fl & FLAGS.AN
    if (iam !== iamav || ian !== ianav) {
      if (!this.compte.estAvc(args.idm)) throw new AppExc(F_SRV, 265)
      if (iam) nvfl |= FLAGS.AM; else nvfl &= ~FLAGS.AM
      if (ian) nvfl |= FLAGS.AN; else nvfl &= ~FLAGS.AN
    }
    const idm = args.nvflags & FLAGS.DM
    const idn = args.nvflags & FLAGS.DN
    const ide = idn ? args.nvflags & FLAGS.DE : false
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
    gr.flags[im] = nvfl
    this.update(gr.toRow())
    this.setV(vg)

    if (chgFl) {
      const mb = compile(await this.getRowMembre(args.idg, im, 'AcceptInvitation-3'))
      mb.v = vg.v
      if (!mb.dam && idm && iam) mb.dam = this.auj
      if (mb.dam && (!idm || !iam)) mb.fam = this.auj
      if (!mb.dan && idn && ian) mb.dan = this.auj
      if (mb.dam && (!idn || !ian)) mb.fam = this.auj
      if (!mb.den && ide && ian) mb.den = this.auj
      if (mb.den && (!ide || !ian)) mb.fen = this.auj
      this.update(mb.toRow())  
    }
  }
}
