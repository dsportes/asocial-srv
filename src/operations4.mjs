import { AppExc, F_SRV, ID, FLAGS } from './api.mjs'
import { config } from './config.mjs'
import { operations } from './cfgexpress.mjs'
import { eqU8 } from './util.mjs'

import { Operation, R } from './modele.mjs'
import { compile, Sponsorings, Chats } from './gendoc.mjs'

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
    if (this.setR.has(R.LECT)) throw new AppExc(F_SRV, 801)
    if (this.setR.has(R.MINI)) throw new AppExc(F_SRV, 802)

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
    const chI = new Chats().init({ 
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
    })
    this.setRes('rowChat', this.insert(chI.toRow()))
    this.compta.ncPlus(1)

    const vchE = await this.getV(avE, 'NouveauChat-4')
    vchE.v++
    this.setV(vchE)
    const chE = new Chats().init({
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
    })
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
      comptaE.donCR(args.don)
      const compteE = compile(await this.getRowCompte(this.idEL, 'MajChat-8'))
      const vcptE = this.getV(compteE, 'MajChat-6')
      vcptE.v++
      comptaE.v = vcptE.v
      this.setNV(comptaE)
      this.update(comptaE.toRow())

      this.compta.donDB(args.don)
      this.compta._maj = true
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
