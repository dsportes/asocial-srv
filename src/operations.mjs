/* Opérations d'écrire et toutes du GC */

import { AppExc, F_SRV, ID, Compteurs, AMJ, UNITEV, edvol, d14 } from './api.mjs'
import { encode, decode } from '@msgpack/msgpack'
import { config } from './config.mjs'
import { operations } from './cfgexpress.mjs'

import { Operation, trace} from './modele.mjs'
import { compile, Versions, Transferts, Gcvols, Chatgrs } from './gendoc.mjs'
import { sleep, crypterRSA, crypterRaw /*, decrypterRaw */ } from './util.mjs'
import { FLAGS, edit, A_SRV, idTkToL6, IDBOBSGC, statistiques } from './api.mjs'

// Pour forcer l'importation des opérations
export function load () {
  if (config.mondebug) config.logger.debug('Operations: ' + operations.auj)
}

/* `EnregConso` : enregistrement de la consommation courante d'une session.
A également une fonction de "heartbeat" maintenant la session active dans le server.
POST:
- `token` : jeton d'authentification du compte
- `conso` : `{ nl, ne, vm, vd }`. Peut être null (aucune consommation)
  - `nl`: nombre absolu de lectures depuis la création du compte.
  - `ne`: nombre d'écritures.
  - `vm`: volume _montant_ vers le Storage (upload).
  - `vd`: volume _descendant_ du Storage (download).

Retour:
- fait : true si l'enregistrement de la consommation a été faite
*/
operations.EnregConso = class EnregConso extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2(args) {
    if ((this.notifG && this.notifG.nr) || !args.conso) return 

    this.compta.v++
    const c = new Compteurs(this.compta.compteurs, null, args.conso)
    this.compta.compteurs = c.serial
    this.update(this.compta.toRow())
    this.setRes('fait', true)
  }
}

/* `CreerEspace` : création d'un nouvel espace et du comptable associé
POST:
- `token` : jeton d'authentification du compte de **l'administrateur**
- `rowEspace` : row de l'espace créé
- `rowSynthese` : row `syntheses` créé
- `rowAvatar` : row de l'avatar du comptable de l'espace
- `rowTribu` : row de la tribu primitive de l'espace
- `rowCompta` : row du compte du Comptable
- `rowVersion`: row de la version de l'avatar (avec sa dlv)
- `hps1` : hps1 de la phrase secrète

Retour: rien

Exceptions: 
- F_SRV 12 : phrase secrète semblable déjà trouvée.
- F_SRV 3 : Espace déjà créé.
*/
operations.CreerEspace = class CreerEspace extends Operation {
  constructor (nom) { super(nom, 3) }

  async phase2(args) {
    if (await this.getComptaHps1(args.hps1))
      throw new AppExc(F_SRV, 12)
    const resp = await this.getRowEspace(args.rowEspace.id)
    if (resp) throw new AppExc(F_SRV, 3)
 
    this.insert(args.rowEspace)
    this.insert(args.rowSynthese)
    this.insert(args.rowCompta)
    this.insert(args.rowTribu)
    this.insert(args.rowAvatar)
    this.insert(args.rowVersion)
  }
}

/* `ReceptionTicket` : réception d'un ticket par le Comptable
POST:
- `token` : jeton d'authentification du Comptable
- `ids` : du ticket
- `mc` : montant reçu
- `refc` : référence du Comptable

Retour: rien
*/
operations.ReceptionTicket = class ReceptionTicket extends Operation {
  constructor (nom) { super(nom, 2, 2) }

  async phase2(args) {
    const version = compile(await this.getRowVersion(this.id, 'PlusTicket-2'))
    const ticket = compile(await this.getRowTicket(this.id, args.ids, 'ReceptionTicket-1'))
    version.v++
    this.update(version.toRow())
    ticket.v = version.v
    ticket.mc = args.mc
    ticket.refc = args.refc
    ticket.dr = AMJ.amjUtc()
    this.update(ticket.toRow())
  }
}

/* `MajCredits` : mise a jour du crédits d'un compte A
POST:
- `token` : jeton d'authentification du compte
- `credits` : credits crypté par la clé K du compte
- `v`: version de compta de la dernière incorporation des crédits
- `dlv`: nouvelle dlv calculée
- `lavLmb`: [lav, lmb]
  - lav: array des ids des avatars
  - lmb: array des [idg, im] des membres

Retour:
- KO: true - La version v est en régression, refaire l'incorporation des crédits.
*/
operations.MajCredits = class MajCredits extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2(args) {
    if (this.compta.v !== args.v) {
      this.setRes('KO', true)
      return
    }

    const dlvAvant = this.compta.dlv
    this.compta.v++
    this.compta.credits = args.credits
    // console.log('CREDITS MajCredits', compta.v, compta.credits.length)
    this.compta.dons = null
    this.compta.dlv = args.dlv
    this.update(this.compta.toRow())
    if (dlvAvant !== args.dlv) this.propagerDlv(args)
  }
}

/* `PlusTicket` : ajout d'un ticket à un compte A
et ajout d'un ticket au Comptable
POST:
- `token` : jeton d'authentification du compte
- `credits` : credits crypté par la clé K du compte
- `rowTicket` : nouveau row tickets pour le Comptable
- v: version de compta

Retour: 
- KO : true si régression de version de compta
*/
operations.PlusTicket = class PlusTicket extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2(args) {
    const compta = this.compta
    if (compta.v !== args.v) {
      this.setRes('KO', true)
      return
    }
    compta.v++
    compta.credits = args.credits
    // console.log('CREDITS PlusTicket', compta.v, compta.credits.length)
    this.update(compta.toRow())
    const idc = ID.duComptable(this.ns)
    const version = compile(await this.getRowVersion(idc, 'PlusTicket-2'))
    version.v++
    this.update(version.toRow())
    const ticket = compile(args.rowTicket)
    ticket.v = version.v
    this.insert(ticket.toRow())
  }
}

/* `MoinsTicket` : retrait d'un ticket à un compte A
et retrait d'un ticket au Comptable
POST:
- `token` : jeton d'authentification du compte
- `credits` : credits crypté par la clé K du compte
- `ids` : du ticket
- v: version de compta

Retour: 
- KO: true si régression de version de compta
*/
operations.MoinsTicket = class MoinsTicket extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2(args) {
    const idc = ID.duComptable(this.ns)
    const ticket = compile(await this.getRowTicket(idc, args.ids, 'MoinsTicket-1'))
    if (ticket.dr) throw new AppExc(F_SRV, 24)
    const version = compile(await this.getRowVersion(idc, 'MoinsTicket-2'))
    version.v++
    this.update(version.toRow())
    ticket.v = version.v
    ticket._zombi = true
    this.update(ticket.toRow())

    const compta = this.compta
    if (compta.v !== args.v) {
      this.setRes('KO', true)
      return
    }
    compta.v++
    compta.credits = args.credits
    // console.log('CREDITS MoinsTicket', compta.v, compta.credits.length)
    this.update(compta.toRow())
  }
}

/*`SetEspaceT` : déclaration du profil de volume de l'espace par l'administrateur
POST:
- `token` : jeton d'authentification du compte de **l'administrateur**
- `ns` : id de l'espace notifié.
- `t` : numéro de profil de 0 à N. Liste spécifiée dans config.mjs de l'application.

Retour: rien

Assertion sur l'existence du row `Espaces`.

C'est une opération "admin", elle échappe aux contrôles espace figé / clos.
Elle n'écrit QUE dans espaces.
*/
operations.SetEspaceT = class SetEspaceT extends Operation {
  constructor (nom) { super(nom, 3)}

  async phase2 (args) {
    let rowEspace = await this.getRowEspace(args.ns, 'SetEspaceT')
    const espace = compile(rowEspace)
    espace.v++
    espace.t = args.t || 0
    rowEspace = this.update(espace.toRow())
    this.setRes('rowEspace', rowEspace)
  }
}

/*`SetEspaceOptionA` : changement de l'option A, nbmi, dlvat par le Comptable
POST:
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
    let rowEspace = await this.getRowEspace(args.ns, 'SetEspaceOptionA')
    const espace = compile(rowEspace)
    espace.v++
    if (args.optionA) espace.opt = args.optionA
    if (args.dlvat) espace.dlvat = args.dlvat
    if (args.nbmi) espace.nbmi = args.nbmi
    rowEspace = this.update(espace.toRow())
    this.setRes('rowEspace', rowEspace)
  }
}

/*`GetVersionsDlvat` : liste des id des versions d'un ns ayant la dlvat fixée
POST:
// - `token` : jeton d'authentification du compte
- `ns` : id de l'espace
- dlvat: aamm,
Retour:
- lids: array des id
*/
operations.GetVersionsDlvat = class GetVersionsDlvat extends Operation {
  constructor (nom) { super(nom, 0)}

  async phase2 (args) {
    const lids = await this.getVersionsDlvat(args.ns, args.dlvat)
    this.setRes('lids', lids)
  }
}

/*`GetMembresDlvat` : liste des [id,ids] des membres d'un ns ayant la dlvat fixée
POST:
// - `token` : jeton d'authentification du compte
- `ns` : id de l'espace
- dlvat: aamm,
Retour:
- lidids: array des id
*/
operations.GetMembresDlvat = class GetMembresDlvat extends Operation {
  constructor (nom) { super(nom, 0)}

  async phase2 (args) {
    const lidids = await this.getMembresDlvat(args.ns, args.dlvat)
    this.setRes('lidids', lidids)
  }
}

/*`ChangeAvDlvat` : change la dlvat dans les versions des avatars listés
POST:
- `token` : jeton d'authentification du compte
- dlvat: aamm,
- lids: array des ids des avatars
Retour:
*/
operations.ChangeAvDlvat = class ChangeAvDlvat extends Operation {
  constructor (nom) { super(nom, 1, 2)}

  async phase2 (args) {
    for(const id of args.lids) {
      if (ID.estComptable(id)) continue
      const version = compile(await this.getRowVersion(id))
      if (version) {
        version.v++
        version.dlv = args.dlvat
        this.update(version.toRow())
        const compta = compile(await this.getRowCompta(id))
        if (compta) {
          compta.v++
          compta.dlv = args.dlvat
          this.update(compta.toRow())
        }
      }
    }
  }
}

/*`ChangeMbDlvat` : change la dlvat dans les membres listés
POST:
- `token` : jeton d'authentification du compte
- dlvat: aamm,
- lidids: array des [id, ids] des membres
Retour:
*/
operations.ChangeMbDlvat = class ChangeMbDlvat extends Operation {
  constructor (nom) { super(nom, 1, 2)}

  async phase2 (args) {
    for(const [id, ids] of args.lidids) {
      const membre = compile(await this.getRowMembre(id, ids))
      if (membre) {
        membre.v++
        membre.dlv = args.dlvat
        this.update(membre.toRow())
      }
    }
  }
}

/* `AjoutSponsoring` : déclaration d'un nouveau sponsoring par le comptable ou un sponsor
POST:
- `token` : éléments d'authentification du comptable / compte sponsor de sa tribu.
- `rowSponsoring` : row Sponsoring, SANS la version (qui est calculée par le serveur).
- `credits`: nouveau credits du compte si non null
- `v`: version de compta si credits
- dlv: nouvelle dlv (si credits)
- lavLmb

Retour:
- KO: true - si régression de version de compta

Exceptions:
- `F_SRV 7` : un sponsoring identifié par une même phrase (du moins son hash) existe déjà.

Assertion sur l'existence du row `Versions` du compte.
*/
operations.AjoutSponsoring = class AjoutSponsoring extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) {
    const rowSp = args.rowSponsoring
    const row = await this.getSponsoringIds(rowSp.ids)
    if (row) throw new AppExc(F_SRV, 7)

    const rowVersion = await this.getRowVersion(rowSp.id, 'AjoutSponsoring', true)
    const version = compile(rowVersion)
    const sp = compile(rowSp)

    version.v++
    sp.v = version.v

    this.insert(sp.toRow())
    this.update(version.toRow())
    if (args.credits) {
      if (this.compta.v !== args.v) {
        this.setRes('KO', true)
        return
      }
      const dlvAvant = this.compta.dlv
      this.compta.v++
      this.compta.credits = args.credits
      this.compta.dlv = args.dlv
      this.update(this.compta.toRow())
      if (dlvAvant !== args.dlv) this.propagerDlv(args)  
    }
  }
}

/* `RetraitAccesGroupe` : retirer l'accès à un groupe pour un avatar
POST:
- `token` : éléments d'authentification du compte.
- `id` : id de l'avatar.
- `ni` : numéro d'invitation du groupe pour cet avatar.
*/
operations.RetraitAccesGroupe = class RetraitAccesGroupe extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) {
    const avatar = compile(await this.getRowAvatar(args.id))
    if (!avatar) return
    const version = compile(await this.getRowVersion(args.id))
    if (!version || version._zombi) return
    version.v++
    avatar.v = version.v
    delete avatar.lgrk[args.ni]
    this.update(avatar.toRow())
    this.update(version.toRow())
  }
}

/* `RafraichirCvs` : rafraîchir les cartes de visite, quand nécessaire
Mises à jour des cartes de visite, quand c'est nécessaire, pour tous les chats et membres de la cible.

POST:
- `token` : éléments d'authentification du compte.
// ??? - `estFige` : si true ne rien mettre à jour
- `cibles` : array de : 

    {
      idE, // id de l'avatar
      vcv, // version de la carte de visite détenue
      lch: [[idI, idsI, idsE] ...], // liste des chats
      lmb: [[idg, im] ...] // liste des membres
    }

Retour:
- `nbrech` : nombre de mises à jour effectuées.

Assertions sur l'existence des `Avatars Versions`.
*/
operations.RafraichirCvs = class RafraichirCvs extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) {
    const maj = !this.estFige
    let nr = 0
    const avIs = {}
    const avEs = {}
    const vIs = {}
    const vEs = {}
    const vmb = {}
    for (const c of args.cibles) {
      let avE = avEs[c.idE]
      if (avE !== false) {
        avE = await this.getAvatarVCV(c.idE, c.vcv)
        if (avE) avEs[c.idE] = avE; else avEs[c.idE] = false
      }

      if (avE) {
        // maj des CV (quand nécessaire) dans tous les chats et membres de la cible
        for(const x of c.lch) {
          const [idI, idsI, idsE] = x
          const chI = await this.getChatVCV(idI, idsI, avE.vcv)
          if (chI) {
            // Maj de chI
            let vI = vIs[idI]
            if (!vI) {
              const v = compile(await this.getRowVersion(idI, 'RafraichirCvs-1', true))
              v.v++
              vI = v.v
              vIs[idI] = vI
              if (maj) this.update(v.toRow())
            }
            chI.v = vI
            chI.vcv = avE.vcv
            chI.cva = avE.cva
            if (maj) this.update(chI.toRow())
            nr++
          }

          // Maj éventuelle réciproque de chat E
          let avI = avEs[idI]
          if (!avI) {
            avI = compile(await this.getRowAvatar(idI, 'RafraichirCvs-2'))
            avIs[idI] = avI
          }
          const chE = await this.getChatVCV(c.idE, idsE, avI.vcv)
          if (chE) {
            // Maj de chE, la CV de I est plus récente
            let vE = vEs[c.idE]
            if (!vE) {
              const v = compile(await this.getRowVersion(c.idE, 'RafraichirCvs-3'), true)
              v.v++
              vE = v.v
              vEs[c.idE] = vE
              if (maj) this.update(v.toRow())
            }
            chE.v = vE
            chE.vcv = avI.vcv
            chE.cva = avI.cva
            if (maj) this.update(chE.toRow())
          }
        }
        for(const x of c.lmb) {
          const [idg, im] = x
          const mb = await this.getMembreVCV(idg, im, avE.vcv)
          if (mb) {
            // Maj de mb
            let vM = vmb[idg]
            if (!vM) {
              const v = compile(await this.getRowVersion(idg, 'RafraichirCvs-4', true))
              v.v++
              vM = v.v
              vmb[idg] = vM
              if (maj) this.update(v.toRow())
            }
            mb.v = vM
            mb.vcv = avE.vcv
            mb.cva = avE.cva
            if (maj) this.update(mb.toRow())
            nr++
          }
        }
      }
    }
    this.setRes('nbrech', nr)
  }
}

/* `McMemo` : changer les mots clés et le mémo attaché à un avatar / groupe par le compte
POST:
- `token` : éléments d'authentification du compte.
- `mmk` : mcMemo crypté par la clé k
- `idk` : id du contact / groupe crypté par la clé K

Assertion d'existence du row `Avatars` de l'avatar principal et de sa `Versions`.
*/
operations.McMemo = class McMemo extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) { 
    const rowAvatar = await this.getRowAvatar(this.id, 'McMemo-1')
    const rowVersion = await this.getRowVersion(this.id, 'McMemo-2', true)
    const avatar = compile(rowAvatar)
    const version = compile(rowVersion)

    version.v++
    avatar.v = version.v
    if (!avatar.mcmemos) avatar.mcmemos = {}
    if (args.mmk) avatar.mcmemos[args.idk] = args.mmk
    else delete avatar.mcmemos[args.idk]

    this.update(avatar.toRow())
    this.update(version.toRow())
  }
}

/* `MotsclesCompte` : changer les mots clés du compte
POST:
- `token` : éléments d'authentification du compte.
- `mck` : map des mots clés cryptée par la clé k.

Assertion d'existence du row `Avatars` de l'avatar principal et de sa `Versions`.
*/
operations.MotsclesCompte = class MotsclesCompte extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) { 
    const rowAvatar = await this.getRowAvatar(this.id, 'MotsclesCompte-1')
    const rowVersion = await this.getRowVersion(this.id, 'MotsclesCompte-2', true)
    const avatar = compile(rowAvatar)
    const version = compile(rowVersion)

    version.v++
    avatar.v = version.v

    avatar.mck = args.mck
    
    this.update(avatar.toRow())
    this.update(version.toRow())
  }
}

/* `ChangementPS` : changer la phrase secrète du compte
POST:
- `token` : éléments d'authentification du compte.
-args.hps1: hash du PBKFD de la phrase secrète réduite du compte.
- args.hpsc: hash du PBKFD de la phrase secrète complète.
- `kx` : clé K cryptée par la phrase secrète

Assertion sur l'existence du row `Comptas` du compte.
*/
operations.ChangementPS = class ChangementPS extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) { 
    const compta = compile(await this.getRowCompta(this.id, 'ChangementPS'))
    
    compta.v++
    compta.hps1 = args.hps1
    compta.hpsc = args.hpsc
    compta.kx = args.kx
    
    this.update(compta.toRow())
  }
}

/* `MajCv` : mise à jour de la carte de visite d'un avatar
POST:
- `token` : éléments d'authentification du compte.
- `id` : id de l'avatar dont la Cv est mise à jour
- `v` : version de versions de l'avatar incluse dans la Cv.
- `cva` : `{v, photo, info}` crypté par la clé de l'avatar.
  - SI C'EST Le COMPTE, pour dupliquer la CV,
    `idTr` : id de sa tribu (où dupliquer la CV)
    `hrnd` : clé d'entrée de la map `mbtr` dans tribu2.

Retour:
- `KO` : true si la carte de visite a changé sur le serveur depuis la version connue en session. Il faut reboucler sur la requête jusqu'à obtenir true.

Assertion sur l'existence du row `Avatars` de l'avatar et de son row `Versions`.
*/
operations.MajCv = class MajCv extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) { 
    const version = compile(await this.getRowVersion(args.id, 'MajCv-2', true))
    if (version.v + 1 !== args.v) {
      this.setRes('KO', true)
      return
    }
    const avatar = compile(await this.getRowAvatar(args.id, 'MajCv-1'))
    version.v++
    avatar.v = version.v
    avatar.vcv = version.v
    avatar.cva = args.cva

    this.update(avatar.toRow())
    this.update(version.toRow())
  }
}

/* `MajChat` : mise à jour d'un Chat, gère aussi un don / crédit
POST:
- `token` : éléments d'authentification du compte.
- `idI idsI` : id du chat, côté _interne_.
- `idE idsE` : id du chat, côté _externe_.
- `ccKI` : clé cc du chat cryptée par la clé K du compte de I. _Seulement_ si en session la clé cc était cryptée par la clé publique de I.
- `txt1` : texte à ajouter crypté par la clé cc du chat.
- `lgtxt1` : longueur du texte
- `dh` : date-heure du chat dont le texte est à annuler.
Si don:
- `credits`: nouveau credits de compta du compte incorporant le don
- dlv
- lavLmb
- `crDon`: don crypté par RSA du bénéficiaire idE à ajouter dans son compta.dons
- `v`: version de compta du compte

Retour:
- `KO`: true si régression de version de compta du compte- `disp` : true : E a disparu, chat zombi.
- `rowChat`: chat I
Assertions sur l'existence du row `Avatars` de l'avatar I, sa `Versions`, et le cas échéant la `Versions` de l'avatar E (quand il existe).
*/
operations.MajChat = class MajChat extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) {
    this.compta.v++
    this.updCompta = false

    await this.majchat(args)

    if (args.credits) {
      if (this.compta.v !== args.v + 1) {
        this.setRes('KO', true)
        return
      }
      
      const dlvAvant = this.compta.dlv
      this.compta.credits = args.credits
      this.compta.dlv = args.dlv
      this.updCompta = true
      
      if (dlvAvant !== args.dlv) this.propagerDlv(args)

      const comptaE = compile(await this.getRowCompta(args.idE, 'MajChat-9'))
      if (!comptaE.dons) comptaE.dons = [args.crDon]
      else comptaE.dons.push(args.crDon)
      comptaE.v++
      const r2 = comptaE.toRow()
      this.update(r2)
    }
    if (this.updCompta) {
      this.compta.v++
      this.update(this.compta.toRow())
    }
  }

  async majchat (args) {
    let rowChatI = await this.getRowChat(args.idI, args.idsI,'MajChat-1')
    const chatI = compile(rowChatI)
    const i1 = chatI.cc.length === 256 && args.ccKI

    const rowChatE = await this.getRowChat(args.idE, args.idsE)
    const versionI = compile(await this.getRowVersion(args.idI, 'MajChat-2', true))
    versionI.v++
    this.update(versionI.toRow())
    chatI.v = versionI.v
    if (i1) chatI.cc = args.ccKI

    if (!rowChatE) {
      // E disparu. Maj interdite:
      const st1 = Math.floor(chatI.st / 10)
      chatI.st = (st1 * 10) + 2 
      chatI.vcv = 0
      chatI.cva = null
      this.setRes('disp', true)
      rowChatI = this.update(chatI.toRow())
      this.setRes('rowChat', rowChatI)
      return
    }

    // cas normal : maj sur chatI et chatE
    const avatarE = compile(await this.getAvatarVCV(args.idE, chatI.vcv))
    const avatarI = compile(await this.getAvatarVCV(args.idI, rowChatE.vcv))
    const dh = Date.now()
    const itemI = args.txt1 ? { a: 0, dh, txt: args.txt1, l: args.lgtxt1 } : null
    const itemE = args.txt1 ? { a: 1, dh, txt: args.txt1, l: args.lgtxt1 } : null
    const chatE = compile (rowChatE)
    const versionE = compile(await this.getRowVersion(args.idE, 'MajChat-7', true))
    versionE.v++
    this.update(versionE.toRow())
    chatE.v = versionE.v

    const itemsI = chatI.items
    if (args.txt1) {
      chatI.items = this.addChatItem(itemsI, itemI)
    } else if (args.dh) {
      chatI.items = this.razChatItem(itemsI, args.dh)
    }
    if (avatarE) {
      chatI.vcv = avatarE.vcv
      chatI.cva = avatarE.cva
    }
    const st1 = Math.floor(chatI.st / 10)
    if (st1 === 0) { // était passif, redevient actif
      chatI.st = 10 + (chatI.st % 10)
      this.compta.qv.nc += 1
      const c = new Compteurs(this.compta.compteurs, this.compta.qv)
      this.compta.compteurs = c.serial
      this.updCompta = true
    }
    rowChatI = this.update(chatI.toRow())
    this.setRes('rowChat', rowChatI)
 
    const itemsE = chatE.items
    if (args.txt1) {
      chatE.items = this.addChatItem(itemsE, itemE)
    } else if (args.dh) {
      chatE.items = this.razChatItem(itemsE, args.dh)
    }
    const stE1 = Math.floor(chatE.st / 10)
    chatE.st = (stE1 * 10) + 1
    if (avatarI) {
      chatE.vcv = avatarI.vcv
      chatE.cva = avatarI.cva
    }
    this.update(chatE.toRow())
  }
}

/* OP_MuterCompte: 'Mutation dy type d\'un compte'
POST:
- `token` : éléments d'authentification du compte.
- 'id': id du compte à muter
- 'st': type actuel: 1: A, 2: 0
- `idI idsI` : id du chat, côté _interne_.
- `idE idsE` : id du chat, côté _externe_.
- `txt1` : texte à ajouter crypté par la clé cc du chat.
- `lgtxt1` : longueur du texte

Si st === 1:
- `quotas`: {qc, q2, q1}
- `trib`: { 
  idT: id courte du compte crypté par la clé de la tribu,
  idt: id de la tribu, 
  cletX: cle de la tribu cryptée par la clé K du comptable,
  cletK: cle de la tribu cryptée par la clé K du compte ou sa clé RSA.
}

Retour:
*/
operations.MuterCompte = class MuterCompte extends operations.MajChat {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) {
    await this.majchat(args) // fixe this.updCompta

    const comptaM = compile(await this.getRowCompta(args.id, 'MuterCompte-1'))
    comptaM.v++
    comptaM.dlv = args.dlv

    if (args.st === 1) {
      /* compte A devient O
      - inscription dans sa tribu
      - dans son comptaM, credits null, raz info tribu
      - dans compteurs: remise à zéro du total abonnement et consommation des mois antérieurs (`razma()`)      */
      const idtAp = args.trib.idt
      const apTribu = compile(await this.getRowTribu(idtAp, 'ChangerTribu-4'))

      const qv = comptaM.qv
      qv.qc = args.quotas.qc
      qv.q1 = args.quotas.q1
      qv.q2 = args.quotas.q2
      const c = new Compteurs(comptaM.compteurs, qv)
      c.razma()
      comptaM.compteurs = c.serial
      comptaM.cletK = args.trib.cletK
      comptaM.cletX = args.trib.cletX
      comptaM.it = apTribu.act.length
      comptaM.credits = null
      this.update(comptaM.toRow())

      apTribu.v++
      const e = {
        idT: args.trib.idT,
        nasp: null,
        stn: 0,
        notif: null,
        qc: qv.qc || 0,
        q1: qv.q1 || 0,
        q2: qv.q2 || 0,
        ca: 0,
        v1: qv.nc + qv.ng + qv.nn,
        v2: qv.v2 || 0
      }
      apTribu.v++
      apTribu.act.push(e)
      this.update(apTribu.toRow())
      await this.MajSynthese(apTribu)
      if (this.sync) this.sync.plus(idtAp)
  
    } else {
      /* compte O devient A
      - le retirer de sa tribu actuelle
      - raz de ses infos tribu dans comptaM
      - credits à "true": pour forcer à la prochaine connexion à l'initialiser
      au minimum prévu
      - dans compteurs: remise à zéro du total abonnement et consommation des mois antérieurs (`razma()`), raz des mois 
      */
      const idtAv = args.trib.idt
      const avTribu = compile(await this.getRowTribu(idtAv, 'ChangerTribu-2'))
  
      avTribu.v++
      avTribu.act[comptaM.it] = null
      this.update(avTribu.toRow())
      await this.MajSynthese(avTribu)
      if (this.sync) this.sync.moins(args.idtAv)

      comptaM.cletK = null
      comptaM.cletX = null
      comptaM.it = 0
      comptaM.credits = true
      const c = new Compteurs(comptaM.compteurs)
      c.razma()
      comptaM.compteurs = c.serial
      this.update(comptaM.toRow())
    }

    await this.propagerDlv(args)

    if (this.updCompta) this.update(this.compta.toRow())
  }
}

/* `NouvelAvatar` : création d'un nouvel avatar 
POST:
- `token` : éléments d'authentification du compte.
- `rowAvatar` : row du nouvel avatar.
- `rowVersion` : row de la version de l'avatar.
- `kx vx`: entrée dans `mavk` (la liste des avatars du compte) de compta pour le nouvel avatar.

Assertion sur l'existence du row `Comptas`.
*/
operations.NouvelAvatar = class NouvelAvatar extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) {
    const compte = compile(await this.getRowAvatar(this.id, 'NouvelAvatar-1'))
    const vc = compile(await this.getRowVersion(this.id, 'NouvelAvatar-2'))
    vc.v++
    compte.v = vc.v
    compte.mavk[args.kx] = args.vx
    this.update(vc.toRow())
    this.update(compte.toRow())

    const version = compile(args.rowVersion)
    version.dlv = this.compta.dlv
    this.insert(version.toRow())
    this.insert(args.rowAvatar)
  }
}

/* `SetNotifT` : notification de la tribu
POST:
- `token` : éléments d'authentification du compte.
- `id` : id de la tribu
- `notif` : notification cryptée par la clé de la tribu.
- `stn`: statut de notif 0:simple 1 2 9:aucune notif

Assertion sur l'existence du row `Tribus` de la tribu.
*/
operations.SetNotifT = class SetNotifT extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) {
    const tribu = compile(await this.getRowTribu(args.id, 'SetNotifT-1'))
    tribu.v++
    tribu.notif = args.notif
    tribu.stn = args.stn
    this.update(tribu.toRow())
    await this.MajSynthese(tribu)
  }
}

/* `SetNotifC` : notification d'un compte d'une tribu
POST:
- `token` : éléments d'authentification du compte.
- `id` : id de la tribu
- `idc` : id du compte
- `notif` : notification du compte cryptée par la clé de la tribu
- `stn` : 0:simple 1:lecture 2:accès minimal, 9:aucune

Assertion sur l'existence du row `Tribus` de la tribu et `Comptas` du compte.
*/
operations.SetNotifC = class SetNotifC extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) {
    const compta = compile(await this.getRowCompta(args.idc, 'SetNotifC-1'))
    const tribu = compile(await this.getRowTribu(args.id, 'SetNotifC-1'))
    tribu.v++
    const e = tribu.act[compta.it]
    if (!e || e.vide) return
    e.stn = args.stn
    e.notif = args.notif
    tribu.act[compta.it] = e
    this.update(tribu.toRow())
    await this.MajSynthese(tribu)
  }
}

/* `SetSponsor` : déclare la qualité de sponsor d'un compte dans une tribu
POST:
- `token` : éléments d'authentification du sponsor.
- `idc` : id du compte sponsorisé ou non
- `idt` : id de sa tribu.
- `nasp` : [nom, clé] du compte crypté par la cle de la tribu.

Assertion sur l'existence des rows `Comptas` du compte et `Tribus` de la tribu.
*/
operations.SetSponsor = class SetSponsor extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) {
    const compta = compile(await this.getRowCompta(args.idc, 'SetNotifC-1'))
    if (args.idt && compta.it) {
      const tribu = compile(await this.getRowTribu(args.idt, 'SetNotifC-1'))
      const e = tribu ? tribu.act[compta.it] : null
      if (e && !e.vide) {
        tribu.v++
        e.nasp = args.nasp
        tribu.act[compta.it] = e
        this.update(tribu.toRow())
        await this.MajSynthese(tribu)
      }
    }
    compta.v++
    compta.sp = args.estSp ? 1 : 0
    this.update(compta.toRow())
  }
}

/* `MajCletKCompta` : mise à jour de la tribu d'un compte 
POST: 
- `token` : éléments d'authentification du compte.
- `nctk` : `[nom, cle]` de la la tribu du compte crypté par la clé K du compte.

Assertion sur l'existence du row `Comptas` du compte.
*/
operations.MajCletKCompta = class MajCletKCompta extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) {
    this.compta.v++
    this.compta.cletK = args.cletK
    this.update(this.compta.toRow())
  }
}

/* `ChangerTribu` : changer un compte de tribu par le Comptable
POST:
- `token` : éléments d'authentification du comptable.
- `id` : id du compte qui change de tribu.
- `idtAv` : id de la tribu quittée
- `idtAp` : id de la tribu intégrée
- `idT` : id court du compte crypté par la clé de la nouvelle tribu.
- `nasp` : si sponsor `[nom, cle]` crypté par la cle de la nouvelle tribu.
- `stn` : statut de la notification 0, 1 2 recopiée de l'ancienne tribu.
- `notif``: notification de niveau compte cryptée par la clé de la nouvelle tribu, recopiée de l'ancienne tribu.

Relatif à `Comptas`:
- `cletX` : clé de la tribu cryptée par la clé K du comptable.
- `cletK` : clé de la tribu cryptée par la clé K du compte : 
  - si cette clé a une longueur de 256, elle est cryptée par la clé publique RSA du compte (en cas de changement de tribu forcé par le comptable).

Retour:
- `rowTribu` row de la nouvelle `Tribus`

Assertions sur l'existence du row `Comptas` compte et de ses `Tribus` _avant_ et _après_.
*/
operations.ChangerTribu = class ChangerTribu extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) {
    const compta = compile(await this.getRowCompta(args.id, 'ChangerTribu-1'))
    const itAv = compta.it
    const c = new Compteurs(compta.compteurs)

    const avTribu = compile(await this.getRowTribu(args.idtAv, 'ChangerTribu-2'))
    const apTribu = compile(await this.getRowTribu(args.idtAp, 'ChangerTribu-4'))

    avTribu.v++
    avTribu.act[itAv] = null
    this.update(avTribu.toRow())
    // pas d'update de la synthese (une autre suit)
    await this.MajSynthese(avTribu, true) 

    compta.v++
    compta.cletK = args.cletK
    compta.cletX = args.cletX
    compta.it = apTribu.act.length
    this.update(compta.toRow())

    apTribu.v++
    const e = {
      idT: args.idT,
      nasp: args.nasp,
      stn: args.stn,
      notif: args.notif,
      q1: c.q1 || 0,
      q2: c.q2 || 0,
      v1: c.v1 || 0,
      v2: c.v2 || 0
    }
    apTribu.v++
    apTribu.act.push(e)
    const rowTribu = this.update(apTribu.toRow())
    await this.MajSynthese(apTribu)
    this.setRes('rowTribu', rowTribu)
    if (this.sync) this.sync.setTribuCId(args.idtAp)
  }
}

/* Maj de la carte de visite d'un groupe ******************************************
args.token: éléments d'authentification du compte.
args.id : id du groupe dont la Cv est mise à jour
args.v: version du groupe incluse dans la Cv. Si elle a changé sur le serveur, retour OK false (boucle sur la requête)
args.cvg: {v, photo, info} crypté par la clé du groupe
*/
operations.MajCvGr = class MajCvGr extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) { 
    const rowGroupe = await this.getRowGroupe(args.id, 'MajCvGr-1')
    if (rowGroupe.v + 1 !== args.v) {
      this.setRes('KO', true)
      return
    }
    const groupe = compile(rowGroupe)
    const version = compile(await this.getRowVersion(args.id, 'MajCvGr-2', true))

    version.v++
    groupe.v = version.v
    groupe.vcv = version.v
    groupe.cvg = args.cvg

    this.update(groupe.toRow())
    this.update(version.toRow())
  }
}

/* Nouveau groupe *****************************************************
args.token donne les éléments d'authentification du compte.
args.rowGroupe : le groupe créé
args.rowMembre : le membre
args.id: id de l'avatar créateur
args.quotas : [q1, q2] attribué au groupe
args.npgk: clé dans mpg du compte (hash du cryptage par la clé K du compte de `idg / idav`)
args.empgk: élément de mpg dans le compte de l'avatar créateur
Retour:
*/
operations.NouveauGroupe = class NouveauGroupe extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) { 
    const groupe = compile(args.rowGroupe)
    const membre = compile(args.rowMembre)
    membre.dlv = this.compta.dlv
    const version = new Versions().init(
      { id: groupe.id, 
        v: 1,
        dlv: AMJ.max,
        vols: { v1:0, v2: 0, q1: args.quotas[0], q2: args.quotas[1]} 
      })
    const versionav = compile(await this.getRowVersion(this.id, 'NouveauGroupe-1', true))
    const avatar = compile(await this.getRowAvatar(this.id, 'NouveauGroupe-2'))

    versionav.v++
    avatar.v = versionav.v
    if (!avatar.mpgk) avatar.mpgk = {}
    avatar.mpgk[args.npgk] = args.empgk
    this.update(avatar.toRow())
    this.update(versionav.toRow())

    this.insert(version.toRow())

    membre.v = version.v
    groupe.v = version.v
    this.insert(groupe.toRow())
    this.insert(membre.toRow())
    const chatgr = new Chatgrs()
    chatgr.items = []
    chatgr.id = groupe.id
    chatgr.ids = 1
    chatgr.v = version.v
    this.insert(chatgr.toRow())
  }
}

/* Mots clés du groupe *****************************************************
args.token donne les éléments d'authentification du compte.
args.mcg : map des mots clés cryptée par la clé du groupe
args.idg : id du groupe
Retour:
*/
operations.MotsclesGroupe = class MotsclesGroupe extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) { 
    const groupe = compile(await this.getRowGroupe(args.idg, 'MotsclesGroupe-1'))
    const version = compile(await this.getRowVersion(args.idg, 'MotsclesGroupe-2', true))

    version.v++
    groupe.v = version.v
    groupe.mcg = args.mcg

    this.update(groupe.toRow())
    this.update(version.toRow())
  }
}

/* Hébergement d'un groupe *****************************************************
args.token donne les éléments d'authentification du compte.
args.action : 1 à 5
args.idg : id du groupe
args.idd : id du compte de départ en cas de transfert (5)
args.idhg : id du compte d'arrivée en cas de transfert CRYPTE par la clé du groupe
args.imh : im du nouvel hébergeur
args.q1, q2 :
args.dfh: date de fin d'hébergement
args.action :
  AGac1: 'Je prends l\'hébergement à mon compte',
  AGac2: 'Je cesse d\'héberger ce groupe',
  AGac3: 'Je reprends l\'hébergement de ce groupe par un autre de mes avatars',
  AGac4: 'Je met à jour les quotas maximum attribués au groupe',
  AGac5: 'Je reprends l\'hébergement à mon compte, je suis animateur et l\hébergeur actuel ne l\'est pas',

Prise hébergement (1)
- les volumes v1 et v2 sont lus sur la version du groupe
- les volumes (pas les quotas) sont augmentés sur compta a
- sur la version du groupe, q1 et q2 sont mis à jour
- sur le groupe, idhg / imh mis à jour
Fin d'hébergement (2):
- les volumes v1 et v2 sont lus sur la version du groupe
- les volumes (pas les quotas) sont diminués sur la compta du compte
- sur le groupe :
  - dfh : date du jour + N jours
  - idhg, imh : 0
Transfert dans le même compte (3):
- sur le groupe, imh est mis à jour
- sur la version du groupe, q1 et q2 sont mis à jour
Changement de quotas (4):
- les volumes et quotas sur compta a sont inchangés
- sur la version du groupe, q1 et q2 sont mis à jour
Transfert (5):
- les volumes v1 et v2 sont lus sur la version du groupe
- les volumes (pas les quotas) sont diminués sur compta d
- les volumes (pas les quotas) sont augmentés sur compta a
- sur la version du groupe, q1 et q2 sont mis à jour
- sur le groupe, idhg / imh mis à jour
Retour:
*/
operations.HebGroupe = class HebGroupe extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) { 
    const version = compile(await this.getRowVersion(args.idg, 'HebGroupe-1', true))
    version.v++
    version.vols.q1 = args.action === 2 ? 0 : args.q1
    version.vols.q2 = args.action === 2 ? 0 : args.q2
    const v1 = version.vols.v1
    const v2 = version.vols.v2
    this.update(version.toRow())

    const groupe = compile(await this.getRowGroupe(args.idg, 'HebGroupe-2'))
    groupe.v = version.v

    if (args.action === 2) {
      groupe.dfh = args.dfh
      groupe.idhg = null
      groupe.imh = 0
      this.update(groupe.toRow())
      if (v1 || v2)
        await this.diminutionVolumeCompta (this.id, v1, 0, 0, v2, 'HebGroupe-3')
      return
    }
    
    if (args.action === 1 || args.action === 5) {
      groupe.idhg = args.idhg
      groupe.imh = args.imh
    }
    if (args.action === 3) groupe.imh = args.imh
    groupe.dfh = 0
    this.update(groupe.toRow())

    if (v1 || v2) {
      if (args.action === 1 || args.action === 5) {
        await this.augmentationVolumeCompta(this.id, v1, 0, 0, v2, 'HebGroupe-4')
      }
      if (args.action === 5) { // transfert d'hébergement
        await this.diminutionVolumeCompta (args.idd, v1, 0, 0, v2, 'HebGroupe-5')
      } 
    }
  }
}

/* Acceptation invitation *******************************************
args.token donne les éléments d'authentification du compte.
args.idg : id du groupe
args.ids: indice du membre invité
args.id: id de l'avatar invité
args.nag: nag du membre (pour liste noire)
args.ni: numéro d'invitation (pour maj avatar)
args.npgk: cle de l'entrée dans mpgk du compte (pour maj mpgk)
args.epgk: entrée dans mpgk du compte
args.cas: 1: acceptation, 2: refus, 3: refus et oubli, 4: refus et liste noire
args.iam: true si accès membre
args.ian: true si accès note
args.chatit: item de chat
Retour:
- disparu: true si le groupe a disparu
*/
operations.AcceptInvitation = class AcceptInvitation extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) { 
    const vg = compile(await this.getRowVersion(args.idg))
    if (!vg || vg._zombi) { // groupe disparu depuis
      // Suppression de l'invitation dans l'avatar, maj du compte
      const avatar = compile(await this.getRowAvatar(args.id, 'AcceptInvitation-5'))
      const va = compile(await this.getRowVersion(args.id, 'AcceptInvitation-5'))
      va.v++
      avatar.v = va.v
      delete avatar.invits[args.ni]
      this.update(va.toRow())
      this.update(avatar.toRow())
      this.setRes('disparu', true)
      return
    }

    const groupe = compile(await this.getRowGroupe(args.idg, 'AcceptInvitation-1'))
    const rowMembre = await this.getRowMembre(args.idg, args.ids, 'AcceptInvitation-2')
    const membre = compile(rowMembre)
    vg.v++
    groupe.v = vg.v
    membre.v = vg.v
    let fl = groupe.flags[args.ids]
    if (!(fl & FLAGS.IN)) throw new AppExc(F_SRV, 33) // pas invité

    if (args.chatit) {
      const chatgr = compile(await this.getRowChatgr(args.idg, 'AcceptInvitation-9'))
      chatgr.v = vg.v
      args.chatit.dh = Date.now()
      chatgr.items = this.addChatgrItem(chatgr.items, args.chatit)
      this.update(chatgr.toRow())
    }

    // MAJ groupe et membre, et comptas (nombre de groupes)
    switch (args.cas) {
    case 1: { // acceptation
      fl |= FLAGS.AC | FLAGS.HA
      membre.fac = 0
      if (!membre.dac) membre.dac = this.auj
      fl &= ~FLAGS.IN
      if (args.iam && (fl & FLAGS.DM)) {
        fl |= FLAGS.AM | FLAGS.HM
        membre.fam = 0
        if (!membre.dam) membre.dam = this.auj
      }
      if (args.ian && (fl & FLAGS.DN)) {
        fl |= FLAGS.AN | FLAGS.HN
        membre.fln = 0
        if (!membre.dln) membre.dln = this.auj
      }
      if (fl & FLAGS.DE) {
        fl |= FLAGS.HE
        membre.fen = 0
        if (!membre.den) membre.den = this.auj
      }
      groupe.flags[args.ids] = fl
      membre.flagsiv = 0
      await this.augmentationVolumeCompta (this.id, 0, 0, 1, 0, 'AcceptInvitation-4')
      break
    }
    case 2: { // refus, reste en contact
      fl &= ~FLAGS.IN & ~FLAGS.PA & ~FLAGS.DN & ~FLAGS.DE & ~FLAGS.DM
      groupe.flags[args.ids] = fl
      membre.flagsiv = 0
      membre.inv = null
      break
    }
    case 3: { // refus et oubli      
      groupe.nag[args.ids] = !(fl & FLAGS.HA) ? 0 : 1
      groupe.flags[args.ids] = 0
      break
    }
    case 4: { // refus et oubli et liste noire
      groupe.nag[args.ids] = !(fl & FLAGS.HA) ? 0 : 1
      groupe.lnc.push(args.nag)
      groupe.flags[args.ids] = 0
      break
    }
    }
    this.update(vg.toRow())
    this.update(groupe.toRow())
    if (args.cas <= 2) // reste contact / actif
      this.update(membre.toRow())
    else // oubli
      this.delete(rowMembre)
    
    // Suppression de l'invitation dans l'avatar, maj du compte
    const avatar = compile(await this.getRowAvatar(args.id, 'AcceptInvitation-5'))
    const va = compile(await this.getRowVersion(args.id, 'AcceptInvitation-5'))
    va.v++
    avatar.v = va.v
    if (avatar.invits) delete avatar.invits[args.ni]
    if (args.cas === 1) {
      if (this.id === args.id) {
        if (!avatar.mpgk) avatar.mpgk = {}
        avatar.mpgk[args.npgk] = args.epgk
      } else {
        const compte = compile(await this.getRowAvatar(this.id, 'AcceptInvitation-5'))
        const vc = compile(await this.getRowVersion(this.id, 'AcceptInvitation-5'))
        vc.v++
        compte.v = vc.v
        if (!compte.mpgk) compte.mpgk = {}
        compte.mpgk[args.npgk] = args.epgk
        this.update(vc.toRow())
        this.update(compte.toRow())
      }
    }
    this.update(va.toRow())
    this.update(avatar.toRow())
  }
}

/* Invitation à un groupe *******************************************
args.token donne les éléments d'authentification du compte.
args.op : opération demandée: 
  1: invit std, 2: modif invit std, 3: suppr invit std, 
  4: vote pour, 5: vote contre, 6: suppr invit una 
args.idg : id du groupe
args.ids: indice du membre invité
args.idm: id de l'avatar du membre invité
args.im: indice de l'animateur invitant
args.flags: flags PA DM DN DE de l'invité
args.ni: numéro d'invitation pour l'avatar invité, clé dans la map invits
args.invit: élément dans la map invits {nomg, cleg, im, ivpar, dh}` cryptée par la clé publique RSA de l'avatar.
args.chatit: item de chat du groupe (mot de bienvenue)
Retour:
*/
operations.InvitationGroupe = class InvitationGroupe extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) { 
    let invitOK = false // Est-ce qu'une invitation a été déclenchée par l'opération ?
    const groupe = compile(await this.getRowGroupe(args.idg, 'InvitationGroupe-1'))
    const anims = groupe.anims // Set des im des animateurs
    if (!anims.has(args.im)) throw new AppExc(F_SRV, 27)

    const vg = compile(await this.getRowVersion(args.idg, 'InvitationGroupe-2', true))
    vg.v++
    this.update(vg.toRow())
    groupe.v = vg.v
    let f = groupe.flags[args.ids] // flags actuel de l'invité
    if (f & FLAGS.AC) throw new AppExc(F_SRV, 32) // est déjà actif

    const membre = compile(await this.getRowMembre(args.idg, args.ids, 'InvitationGroupe-1'))
    membre.v = vg.v
    switch (args.op) {
    case 1 : { // création d'une invitation standard
      if (f & FLAGS.IN) throw new AppExc(F_SRV, 28) // était déjà invité
      membre.inv = [args.im]
      membre.flagsiv = 0
      invitOK = true
      break
    }
    case 2 : { // modification d'une invitation en cours
      if (!(f & FLAGS.IN)) throw new AppExc(F_SRV, 29) // n'était pas invité
      membre.inv = [args.im]
      membre.flagsiv = 0
      invitOK = true
      break
    }
    case 3 : { // suppr invit std
      if (!(f & FLAGS.IN)) throw new AppExc(F_SRV, 30) // n'était pas invité
      membre.inv = null
      membre.flagsiv = 0
      invitOK = false
      break
    }
    case 4 : { // vote pour
      if (f & FLAGS.IN) throw new AppExc(F_SRV, 31) // était déjà invité
      const a = new Set([args.im])
      if (!membre.inv) membre.inv = []
      if (args.flags === membre.flagsiv) // pas de changement des droits, votes valides
        membre.inv.forEach(im => { if (anims.has(im)) a.add(im) })
      if (a.size === anims.size) invitOK = true
      membre.inv = Array.from(a)
      membre.flagsiv = args.flags
      break
    }
    case 5 : { // vote contre
      if (f & FLAGS.IN) throw new AppExc(F_SRV, 31) // était déjà invité
      const a = new Set()
      if (!membre.inv) membre.inv = []
      if (args.flags === membre.flagsiv) membre.inv.forEach(im => { // reconduits les votes SAUF im (contre)
        if (im !== args.im && anims.has(im)) a.add(im) 
      })
      if (a.size === anims.size) invitOK = true
      membre.inv = Array.from(a)
      membre.flagsiv = args.flags
      break
    }
    case 6 : { // suppr. vote unanime
      membre.inv = null
      membre.flagsiv = 0
      invitOK = false
      break
    }
    }
    if (invitOK) membre.ddi = this.auj
    this.update(membre.toRow())

    if (args.chatit) {
      const chatgr = compile(await this.getRowChatgr(args.idg, 'InvitationGroupe-9'))
      chatgr.v = vg.v
      chatgr.items = this.addChatgrItem(chatgr.items, args.chatit)
      this.update(chatgr.toRow())
    }

    const avatar = compile(await this.getRowAvatar(args.idm, 'InvitationGroupe-4'))
    if (!avatar.invits) avatar.invits = {}
    const okav = avatar.invits[args.ni]
    if ((invitOK && !okav) || (!invitOK && okav)) {
      const va = compile(await this.getRowVersion(args.idm, 'InvitationGroupe-5', true))
      va.v++
      this.update(va.toRow())
      avatar.v = va.v
      if (invitOK)
        avatar.invits[args.ni] = args.invit
      else
        delete avatar.invits[args.ni]
      this.update(avatar.toRow())
    }

    const delInvit = (f & FLAGS.IN) && !invitOK
    const nf = delInvit ? 0 : args.flags
    if (nf & FLAGS.PA) f |= FLAGS.PA; else f &= ~FLAGS.PA
    if (nf & FLAGS.DM) f |= FLAGS.DM; else f &= ~FLAGS.DM
    if (nf & FLAGS.DN) f |= FLAGS.DN; else f &= ~FLAGS.DN
    if (nf & FLAGS.DE) f |= FLAGS.DE; else f &= ~FLAGS.DE
    if (invitOK) f |= FLAGS.IN; else f &= ~FLAGS.IN
    groupe.flags[args.ids] = f
    this.update(groupe.toRow())

  }
}

/* Nouveau membre (contact) *******************************************
args.token donne les éléments d'authentification du compte.
args.id : id du contact
args.idg : id du groupe
args.im: soit l'indice de l'avatar dans ast/nag s'il avait déjà participé, soit ast.length
args.nag: hash du rnd du membre crypté par le rnd du groupe. Permet de vérifier l'absence de doublons.
args.rowMembre
- vérification que le slot est libre
- insertion du row membre, maj groupe
Retour:
- KO : si l'indice im est déjà attribué
*/
operations.NouveauMembre = class NouveauMembre extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) { 
    const groupe = compile(await this.getRowGroupe(args.idg, 'NouveauMembre-1'))
    const vg = compile(await this.getRowVersion(args.idg, 'NouveauMembre-2', true))
    vg.v++
    this.update(vg.toRow())
    groupe.v = vg.v

    if (args.im < groupe.anag.length) {
      const sl = groupe.anag[args.im]
      const ok = !sl || sl === 1 || sl === args.nag
      if (!ok) {
        this.setRes('KO', true)
        return // réattribution non acceptable (opérations concurrentes) 
      }
      groupe.anag[args.im] = args.nag // réattribution
      const f = groupe.flags[args.im]
      let nf = 0
      /*
        HA: 1 << 8, // **a été actif**
        HN: 1 << 9, // **a eu accès aux notes**
        HM: 1 << 10, // **a eu accès aux membres**
        HE: 1 << 11 // **a pu écrire des notes**
      */
      if (f & FLAGS.HA) nf |= FLAGS.HA
      if (f & FLAGS.HN) nf |= FLAGS.HN
      if (f & FLAGS.HM) nf |= FLAGS.HM
      if (f & FLAGS.HE) nf |= FLAGS.HE
      groupe.flags[args.im] = nf
    } else { // première apparition
      groupe.flags.push(0)
      groupe.anag.push(args.nag)
    }
    this.update(groupe.toRow())

    const membre = compile(args.rowMembre)
    membre.v = vg.v
    this.insert(membre.toRow())
  }
}

/* Maj des droits d'un membre *******************************************
args.token donne les éléments d'authentification du compte.
args.idg : id du groupe
args.ids : ids du membre
args.nvflags : nouveau flags. Peuvent changer PA DM DN DE AM AN
Retour:
*/
operations.MajDroitsMembre = class MajDroitsMembre extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) { 
    const groupe = compile(await this.getRowGroupe(args.idg, 'MajDroitsMembre-1'))
    const membre = compile(await this.getRowMembre(args.idg, args.ids, 'MajDroitsMembre-1'))
    const vg = compile(await this.getRowVersion(args.idg, 'MajDroitsMembre-2', true))
    vg.v++
    this.update(vg.toRow())
    groupe.v = vg.v
    membre.v = vg.v
    let majm = false

    let f = groupe.flags[args.ids]
    // console.log('f avant:' + edit(f))
    const amav = (f & FLAGS.DM) && (f & FLAGS.AM)
    const lnav = (f & FLAGS.DN) && (f & FLAGS.AN)
    const enav = (f & FLAGS.DE) && (f & FLAGS.AN)

    const nf = args.nvflags
    // console.log('nf:' + edit(nf))
    const amap = (nf & FLAGS.DM) && (nf & FLAGS.AM)
    const lnap = (nf & FLAGS.DN) && (nf & FLAGS.AN)
    const enap = (nf & FLAGS.DE) && (nf & FLAGS.AN)

    if ((nf & FLAGS.PA) !== (f & FLAGS.PA)) 
      f ^= FLAGS.PA
    if ((nf & FLAGS.DM) !== (f & FLAGS.DM)) 
      f ^= FLAGS.DM
    if ((nf & FLAGS.DN) !== (f & FLAGS.DN)) 
      f ^= FLAGS.DN
    if ((nf & FLAGS.DE) !== (f & FLAGS.DE)) 
      f ^= FLAGS.DE
    if ((nf & FLAGS.AM) !== (f & FLAGS.AM)) 
      f ^= FLAGS.AM
    if ((nf & FLAGS.AN) !== (f & FLAGS.AN)) 
      f ^= FLAGS.AN

    if (amav !== amap) {
      if (amap) {
        f |= FLAGS.HM
        membre.fam = 0
        if (!membre.dam) membre.dam = this.auj
      } else membre.fam = this.auj
      majm = true
    }

    if (lnav !== lnap) {
      if (lnap) { 
        f |= FLAGS.HN
        if (nf & FLAGS.DE) f |= FLAGS.HE
        membre.fln = 0
        if (!membre.dln) membre.dln = this.auj
      } else membre.fln = this.auj
      majm = true
    }

    if (enav !== enap) {
      if (enap) { 
        membre.fen = 0
        if (!membre.den) membre.den = this.auj
      } else membre.fen = this.auj
      majm = true
    }

    // console.log('f après:' + 
    edit(f)
    groupe.flags[args.ids] = f
    this.update(groupe.toRow())
    if (majm) this.update(membre.toRow())
  }
}

/* Oublier un membre *******************************************
args.token donne les éléments d'authentification du compte.
args.idg : id du groupe
args.ids : ids du membre
args.npgk : entrée dans la table mpg
args.cas : 
  - 1 : (moi) retour en simple contact
  - 2 : (moi) m'oublier
  - 3 : (moi) m'oublier définitivement
  - 4 : oublier le membre (qui est simple contact pas invité)
  - 5 : oublier définitivement le membre
Retour:
*/
operations.OublierMembre = class OublierMembre extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) { 
    const rowGroupe = await this.getRowGroupe(args.idg, 'OublierMembre-1')
    const groupe = compile(rowGroupe)
    const rowMembre = await this.getRowMembre(args.idg, args.ids, 'OublierMembre-2')
    const membre = compile(rowMembre)
    const vg = compile(await this.getRowVersion(args.idg, 'OublierMembre-3', true))
    vg.v++
    membre.v = vg.v
    groupe.v = vg.v

    let majm = 0
    let delgr = false
    let f = groupe.flags[args.ids]
    // console.log('f avant:' + edit(f))

    if (args.cas <= 3) {
      if (f & FLAGS.AC) {
        // Volume compta
        // Retrait de mpgk
        await this.diminutionVolumeCompta (this.id, 0, 0, 1, 0, 'OublierMembre-4')
        const avatar = compile(await this.getRowAvatar(this.id, 'OublierMembre-5'))
        const va = compile(await this.getRowVersion(this.id, 'OublierMembre-6'))
        va.v++
        avatar.v = va.v
        delete avatar.mpgk[args.npgk]
        this.update(va.toRow())
        this.update(avatar.toRow())
      }
      if (args.cas === 1)
        f &= ~FLAGS.AC & ~FLAGS.IN & ~FLAGS.AM & ~FLAGS.AN & ~FLAGS.PA & ~FLAGS.DM & ~FLAGS.DN & ~FLAGS.DE
      else f = 0
      // console.log('f après:' + edit(f))
      groupe.flags[args.ids] = f
      if (!groupe.aActifs) {
        // il n'y a plus d'actifs : suppression du groupe
        vg.dlv = this.auj
        majm = 2
        delgr = true
      }
    }

    if (!delgr) switch (args.cas) {
    case 1 : { // (moi) retour en simple contact
      if (!membre.fac) {
        membre.fac = this.auj
        majm = 1
      }
      break
    }
    case 4 : // oublier le membre (qui est simple contact pas invité)
    case 2 : { // (moi) m'oublier
      groupe.flags[args.ids] = 0
      groupe.anag[args.ids] = (f & FLAGS.HA) ? 1 : 0
      majm = 2
      break
    }
    case 3 : { // (moi) m'oublier définitivement
      const nag = groupe.anag[args.ids]
      if (!groupe.lnc) groupe.lnc = []
      groupe.lnc.push(nag)
      groupe.flags[args.ids] = 0
      groupe.anag[args.ids] = (f & FLAGS.HA) ? 1 : 0
      majm = 2
      break
    }
    case 5 : {// oublier définitivement le membre
      const nag = groupe.anag[args.ids]
      if (!groupe.lna) groupe.lna = []
      groupe.lna.push(nag)
      groupe.flags[args.ids] = 0
      groupe.anag[args.ids] = (f & FLAGS.HA) ? 1 : 0
      majm = 2
      break
    }
    }

    this.update(vg.toRow())
    if (delgr) this.delete(rowGroupe)
    else this.update(groupe.toRow())

    if (majm === 1) this.update(membre.toRow())
    if (majm === 2) this.delete(rowMembre)
  }
}

/* Mode simple / unanime d'un groupe *******************************************
args.token donne les éléments d'authentification du compte.
args.id : id du groupe
args.ids : ids du membre demandant le retour au mode simple.
  Si 0, mode unanime.
Retour:
*/
operations.ModeSimple = class ModeSimple extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) { 
    const gr = compile(await this.getRowGroupe(args.id, 'ModeSimple-1'))
    const vg = compile(await this.getRowVersion(args.id, 'ModeSimple-2', true))
    vg.v++
    gr.v = vg.v
    if (!args.ids) {
      // mode unanime
      gr.msu = []
    } else {
      // demande de retour au mode simple
      if (!gr.msu) gr.msu = []
      const s = new Set(gr.msu)
      s.add(args.ids)
      let ok = true
      gr.anims.forEach(im => { if (!s.has(im)) ok = false })
      if (ok) {
        // tous les animateurs ont voté pour
        gr.msu = null
      } else {
        gr.msu = Array.from(s)
      }
    }
    this.update(vg.toRow())
    this.update(gr.toRow())
  }
}

/* ItemChatgr : ajout / effacement d'un item de chat de groupe *************************************************
args.token: éléments d'authentification du compte.
args.chatit : item
args.idg: id du groupe
args.im args.dh : pour une suppression
Retour: rien

Remarque: la création de Chatgr quand il n'existe pas n'est pas utile.
Ce n'est qu'une commodité dans une phase de test qui n'a plus lieu d'être.
*/
operations.ItemChatgr = class ItemChatgr extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) { 
    let ins = false
    const vg = compile(await this.getRowVersion(args.idg))
    if (!vg || vg._zombi) return
    vg.v++
    this.update(vg.toRow())

    let chatgr = compile(await this.getRowChatgr(args.idg))
    if (!chatgr) {
      chatgr = new Chatgrs()
      chatgr.id = args.idg
      chatgr.ids = 1
      chatgr.items = []
      ins = true
    }
    chatgr.v = vg.v

    if (args.chatit) {
      args.chatit.dh = Date.now()
      chatgr.items = this.addChatgrItem(chatgr.items, args.chatit)
    } else {
      chatgr.items = this.razChatgrItem(chatgr.items, args.im, args.dh)
    }
    if (ins) this.insert(chatgr.toRow()); else this.update(chatgr.toRow())
  }
}

/* Nouvelle Note *************************************************
args.token: éléments d'authentification du compte.
args.rowNote : row de la note
args.idc: id du compte (note avatar) ou de l'hébergeur (note groupe)
Retour: rien
*/
operations.NouvelleNote = class NouvelleNote extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) { 
    const note = compile(args.rowNote)
    let v
    if (ID.estGroupe(note.id)) {
      v = await this.majVolumeGr (note.id, 1, 0, false, 'NouvelleNote-1')
    } else {
      v = compile(await this.getRowVersion(note.id, 'NouvelleNote-2', true))
    }
    v.v++
    this.update(v.toRow())
    note.v = v.v
    this.insert(note.toRow())
    await this.augmentationVolumeCompta(args.idc, 1, 0, 0, 0, 'NouvelleNote-2')
  }
}

/* Maj Note *************************************************
args.token: éléments d'authentification du compte.
args.id ids: identifiant de la note (dont celle du groupe pour un note de groupe)
args.txts : nouveau texte encrypté
args.aut : auteur de la note pour un groupe
Retour: rien
*/
operations.MajNote = class MajNote extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) { 
    const note = compile(await this.getRowNote(args.id, args.ids, 'MajNote-1'))
    const v = compile(await this.getRowVersion(note.id, 'MajNote-2', true))
    v.v++
    this.update(v.toRow())
    
    note.txts = args.txts
    if (args.aut) {
      const nl = [args.aut]
      if (note.auts) note.auts.forEach(t => { if (t !== args.aut) nl.push(t) })
      note.auts = nl
    }
    note.v = v.v
    this.update(note.toRow())
  }
}

/* Changer l'exclusivité d'écriture d'une note ***********************
args.token: éléments d'authentification du compte.
args.id ids: identifiant de la note
args.im : 0 / im
Retour: rien
*/
operations.ExcluNote = class ExcluNote extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) { 
    const note = compile(await this.getRowNote(args.id, args.ids, 'ExcluNote-1'))
    const v = compile(await this.getRowVersion(note.id, 'ExcluNote-2', true))
    v.v++
    this.update(v.toRow())
    note.im = args.im
    note.v = v.v
    this.update(note.toRow())
  }
}

/* Changer les mots clés d'une note ***********************
args.token: éléments d'authentification du compte.
args.id ids: identifiant de la note
args.hgc: si mc perso d'une note de groupe, id dans la map mc
args.mc: mots clés perso
args.mc0: mots clés du groupe
Retour: rien
*/
operations.McNote = class McNote extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) { 
    const note = compile(await this.getRowNote(args.id, args.ids, 'McNote-1'))
    const v = compile(await this.getRowVersion(note.id, 'McNote-2', true))
    v.v++
    this.update(v.toRow())
    if (ID.estGroupe(note.id)) {
      const mc = note.mc ? decode(note.mc) : {}
      if (args.mc0) mc['0'] = args.mc0
      if (args.mc) mc[args.hgc] = args.mc
      note.mc = encode(mc)
    } else note.mc = args.mc
    note.v = v.v
    this.update(note.toRow())
  }
}

/* Rattacher une note à une autre ou à une racine ***********************
args.token: éléments d'authentification du compte.
args.id ids: identifiant de la note
args.ref : [rid, rids, rnom] crypté par la clé de la note. Référence d'une autre note
Retour: rien
*/
operations.RattNote = class RattNote extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) { 
    const note = compile(await this.getRowNote(args.id, args.ids, 'RattNote-1'))
    const v = compile(await this.getRowVersion(note.id, 'RattNote-2', true))
    v.v++
    this.update(v.toRow())
    note.v = v.v
    note.ref = args.ref
    this.update(note.toRow())
  }
}

/* Supprimer la note ******
args.token: éléments d'authentification du compte.
args.id ids: identifiant de la note (dont celle du groupe pour un note de groupe)
args.idc : compta à qui imputer le volume
  - pour une note personelle, id du compte de l'avatar
  - pour une note de groupe : id du "compte" de l'hébergeur idhg du groupe
Retour:
*/
operations.SupprNote = class SupprNote extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) { 
    const note = compile(await this.getRowNote(args.id, args.ids))
    if (!note) return
    this.lidf = []
    for (const idf in note.mfas) this.lidf.push(parseInt(idf))
    const dv2 = note.v2
    let v
    if (ID.estGroupe(args.id)) {
      v = await this.majVolumeGr(args.id, -1, -dv2, false, 'SupprNote-1') // version du groupe (mise à jour)
    } else {
      v = compile(await this.getRowVersion(args.id, 'SupprNote-2', true)) // version de l'avatar
    }
    v.v++
    this.update(v.toRow())

    await this.diminutionVolumeCompta(args.idc, 1, 0, 0, dv2, 'SupprNote-3')
    note.v = v.v
    note._zombi = true
    this.update(note.toRow())
    if (this.lidf.length)
      this.idfp = await this.setFpurge(args.id, this.lidf)
  }

  async phase3 (args) {
    try {
      if (this.lidf.length) {
        const org = await this.org(ID.ns(args.id))
        const idi = args.id % d14  
        await this.storage.delFiles(org, idi, this.lidf)
        await this.unsetFpurge(this.idfp)
      }
    } catch (e) { 
      // trace
    }
  }
}

/*****************************************
GetUrl : retourne l'URL de get d'un fichier
Comme c'est un GET, les arguments sont en string (et pas en number)
args.token: éléments d'authentification du compte.
args.id : id de la note
args.idf : id du fichier
args.idc : id du compte demandeur
args.vt : volume du fichier (pour compta des volumes v2 transférés)
*/
operations.GetUrl = class GetUrl extends Operation {
  constructor (nom) { super(nom, 1, 2); this.lecture = true }

  async phase2 (args) {
    const org = await this.org(ID.ns(args.id))
    const idi = args.id % d14
    const url = await this.storage.getUrl(org, idi, args.idf)
    this.setRes('getUrl', url)
    this.compta.v++
    this.compta.compteurs = new Compteurs(this.compta.compteurs, null, { vd: args.vt }).serial
    this.update(this.compta.toRow())
  }
}

/* Put URL : retourne l'URL de put d'un fichier ****************************************
args.token: éléments d'authentification du compte.
args.id : id de la note
args.idh : id de l'hébergeur pour une note groupe
args.dv2 : variation de volume v2
args.idf : identifiant du fichier
Retour:
- url : url à passer sur le PUT de son contenu
*/
operations.PutUrl = class PutUrl extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) {
    if (args.dv2 > 0) {
      if (ID.estGroupe(args.id)) {
        // Pour provoquer une exception de dépassement éventuel
        await this.majVolumeGr (args.id, 0, args.dv2, false, 'PutUrl-2')
      }
      const h = compile(await this.getRowCompta(args.idh, 'PutUrl-1'))
      const c = decode(h.compteurs)
      const d = c.v2 + args.dv2
      const q = c.q2 * UNITEV
      if (d > q)
        throw new AppExc(F_SRV, 56, [edvol(d), edvol(q)])
    }

    const org = await this.org(ID.ns(args.id))
    const idi = args.id % d14
    const url = await this.storage.putUrl(org, idi, args.idf)
    this.setRes('putUrl', url)
    const dlv = AMJ.amjUtcPlusNbj(this.auj, 5)
    const tr = new Transferts().init({ id: args.id, ids: args.idf, dlv })
    this.insert(tr.toRow())
  }
}

/* validerUpload ****************************************
args.token: éléments d'authentification du compte.
args.id, ids : de la note
args.idh : id de l'hébergeur pour une note groupe
args.aut: im de l'auteur (pour une note de groupe)
args.idf : identifiant du fichier
args.emap : entrée (de clé idf) de la map des fichiers attachés [lg, data]
args.lidf : liste des fichiers à supprimer
La variation de volume v2 est calculée sous contrôle transactionnel
en relisant mafs (dont les lg).
Retour: aucun
*/
operations.ValiderUpload = class ValiderUpload extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) {
    const note = compile(await this.getRowNote(args.id, args.ids, 'ValiderUpload-1'))
    const vn = compile(await this.getRowVersion(args.id, 'ValiderUpload-2', true))
    vn.v++
    note.v = vn.v
    this.update(vn.toRow())

    const map = note.mfas ? decode(note.mfas) : {}
    map[args.idf] = args.emap
    if (args.lidf && args.lidf.length) 
      args.lidf.forEach(idf => { delete map[idf] })
    note.mfas = encode(map)
    let v = 0; for (const idf in map) v += map[idf][0]
    const dv2 = v - note.v2 // variation de v2
    if (args.aut) {
      const nl = [args.aut]
      if (note.auts) note.auts.forEach(t => { if (t !== args.aut) nl.push(t) })
      note.auts = nl
    }
    note.v2 = v
    this.update(note.toRow())

    if (ID.estGroupe(args.id)) {
      await this.majVolumeGr (args.id, 0, dv2, true, 'ValiderUpload-3')
    }
    const h = compile(await this.getRowCompta(args.idh, 'ValiderUpload-4'))
    if (isNaN(h.qv.v2)) h.qv.v2 = 0
    h.qv.v2 += dv2
    if (h.qv.v2 < 0) h.qv.v2 = 0
    const q = h.qv.q2 * UNITEV
    if (h.qv.v2 > q) throw new AppExc(F_SRV, 56, [edvol(h.qv.v2), edvol(q)])
    h.compteurs = new Compteurs(h.compteurs, h.qv).serial
    h.v++
    this.update(h.toRow())
    
    this.delete({ _nom: 'transferts', id: args.id, ids: args.ids })
  }

  async phase3 (args) {
    if (args.lidf && args.lidf.length) {
      const org = await this.org(ID.ns(args.id))
      const idi = args.id % d14
      await this.storage.delFiles(org, idi, args.lidf)
    }
  }
}

/* Supprimer un ficher ****************************************
args.token: éléments d'authentification du compte.
args.id, ids : de la note
args.idh : id de l'hébergeur pour une note groupe
args.idf : identifiant du fichier à supprimer
args.aut: im de l'auteur (pour une note de groupe)
Retour: aucun
*/
operations.SupprFichier = class SupprFichier extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) {
    const note = compile(await this.getRowNote(args.id, args.ids, 'SupprFichier-1'))
    const vn = compile(await this.getRowVersion(args.id, 'SupprFichier-2', true))
    vn.v++
    note.v = vn.v
    this.update(vn.toRow())

    const map = note.mfas ? decode(note.mfas) : {}
    delete map[args.idf]
    note.mfas = encode(map)
    let v = 0; for (const idf in map) v += map[idf][0]
    const dv2 = v - note.v2 // variation de v2
    if (args.aut) {
      const nl = [args.aut]
      if (note.auts) note.auts.forEach(t => { if (t !== args.aut) nl.push(t) })
      note.auts = nl
    }
    note.v2 = v
    this.update(note.toRow())

    if (ID.estGroupe(args.id)) {
      await this.majVolumeGr (args.id, 0, dv2, true, 'SupprFichier-3')
    }

    const h = compile(await this.getRowCompta(args.idh, 'ValiderUpload-4'))
    if (isNaN(h.qv.v2)) h.qv.v2 = 0
    h.qv.v2 += dv2
    if (h.qv.v2 < 0) h.qv.v2 = 0
    const q = h.qv.q2 * UNITEV
    if (h.qv.v2 > q) throw new AppExc(F_SRV, 56, [edvol(h.qv.v2), edvol(q)])
    h.compteurs = new Compteurs(h.compteurs, h.qv).serial
    h.v++
    this.update(h.toRow())

    this.idfp = await this.setFpurge(args.id, [args.idf])
  }

  async phase3 (args) {
    try {
      const org = await this.org(ID.ns(args.id))
      const idi = args.id % d14  
      await this.storage.delFiles(org, idi, [args.idf])
      await this.unsetFpurge(this.idfp)
    } catch (e) { 
      // trace
    }
  }
}

/* Supprimer un avatar ****************************************
args.token: éléments d'authentification du compte.
args.id : id de l'avatar
args.va : version de l'avatar
args.idc : id du compte - si égal à id, suppression du compte
args.idk : cet id crypté par la clé K du compte. Clé de la map mavk dans compta
args.chats : liste des id / ids des chats externes à traiter
args.spons : liste des ids des sponsorings à purger
args.dfh : date de fin d'hébergement des groupes
args.grps : liste des items groupes à traiter.
  - idg : id du groupe
  - vg : version du groupe
  - im : ids du membre (correspondant à l'avatar)
  - suppr : true si le groupe est à supprimer
Suppression de compte seulement
args.idt: id de la tribu du compte
args.it: indice du compte dans act de tribu, pour suppression de cette entrée
Suppression d'avatar seulement
args.dnn: nombre de notes avatar et notes des groupes hébergés)
args.dnc
args.dng
args.dv2
Retour: KO
- KO : si true, retry requis, les versions des groupes et/ou avatar ont chnagé
*/
operations.SupprAvatar = class SupprAvatar extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) { 
    const estCpt = args.id === args.idc
    const vgroupes = {}
    const vavatarp = compile(await this.getRowVersion(args.idc, 'SupprAvatar-7'))
    const avatarp = compile(await this.getRowAvatar(args.idc, 'SupprAvatar-7'))
    const va = compile(await this.getRowVersion(args.id, 'SupprAvatar-6'))
    if (vavatarp.v !== args.vap) { this.setRes('KO', true); return }
    if (!estCpt) {
      if (va.v !== args.va) { this.setRes('KO', true); return }
    }

    for (const it of args.grps) {
      const vg = await this.getRowVersion(it.idg, 'SupprAvatar-1')
      if (vg._zombi || (vg.v !== it.vg)) { 
        this.setRes('KO', true); return 
      }
      vgroupes[it.idg] = vg
    }

    // résiliation de l'avatar par sa 'versions' (s'il ne l'était pas déjà)
    // ICI versions dlv
    if (!va._zombi) {
      va.version++
      va.dlv = AMJ.amjUtcPlusNbj(this.auj, -1)
      va._zombi = true
      this.update(va.toRow())
    }
    
    if (estCpt) {
      this.delete(await this.getRowCompta(args.idc, 'SupprAvatar-2'))
      // suppression de l'entrée du compte dans tribu
      if (args.idt) {
        const tribu = compile(await this.getRowTribu(args.idt, 'SupprAvatar-3'))
        tribu.act[args.it] = null
        tribu.v++
        await this.MajSynthese(tribu)
        this.update(tribu.toRow())
      }
      if (!vavatarp._zombi) {
        vavatarp.v++
        vavatarp._zombi = true
        vavatarp.dlv = this.auj
        this.update(vavatarp.toRow())
        this.delete({ _nom: 'avatars', id: args.idc })
      }
    } else {
      await this.diminutionVolumeCompta(args.idc, args.dnn, args.dnc, args.dng, args.dv2, 'SupprAvatar-9')
      vavatarp.v++
      avatarp.v = vavatarp.v
      delete avatarp.mavk[args.idk]
      this.update(avatarp.toRow())
      this.update(vavatarp.toRow())
    }
  
    // MAJ des chats "externes"
    for (const it of args.chats) {
      const [idE, idsE] = it
      const chatE = compile(await this.getRowChat(idE, idsE))
      if (chatE) {
        const vchatE = compile(await this.getRowVersion(idE, 'SupprAvatar-4'), true)
        vchatE.v++
        chatE.v = vchatE.v
        const stI = Math.floor(chatE.st / 100)
        chatE.st = (stI * 10) + 2
        chatE.cva = null
        this.update(vchatE.toRow())
        this.update(chatE.toRow())
      }
    }

    for (const ids of args.spons) {
      this.delete({ _nom: 'sponsorings', id: args.id, ids: ids })
    }

    for (const it of args.grps) {
      const vgroupe = compile(vgroupes[it.idg])
      if (!vgroupe._zombi) {
        vgroupe.v++
        if (it.suppr) {
          // ICI versions dlv
          vgroupe.dlv = this.auj
          vgroupe._zombi = true
        } else {
          this.delete({ _nom: 'membres', id: it.idg, ids: it.im })
          const groupe = compile(await this.getRowGroupe(it.idg, 'SupprAvatar-5'))
          groupe.v = vgroupe.v
          groupe.flags[it.im] = 0
          groupe.anag[it.im] = 0
          if (groupe.imh === it.im) {
            // c'était l'hébergeur
            groupe.dfh = args.dfh
            groupe.idhg = null
            groupe.imh = 0
          }
          this.update(groupe.toRow())
        }
        this.update(vgroupe.toRow())
      }
    }
  }
}

/* Supprime un compte de sa tribu, de facto récupère le volume
args.token: éléments d'authentification du compte.
args.m: map :
  - clé: id de la tribu
  - valeur : liste des indice it des comptes à supprimer
args.lidc : liste des id des comptes (gcvols) à supprimer
*/
operations.SupprComptesTribu = class SupprComptesTribu extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2(args) {
    for (const idx in args.m) {
      const id = parseInt(idx)
      const lit = args.m[idx]
      const tribu = compile(await this.getRowTribu(id, 'SupprComptesTribu'))
      tribu.v++
      for (const it of lit) tribu.act[it] = null
      this.update(tribu.toRow())
      this.MajSynthese(tribu)
    }
    for (const id of args.lidc) {
      this.delete({ _nom: 'gcvols', id })
    }
  }
}

/* ForceDlv **********************************************
Force des dlv / dfh pour tester.
args.token donne les éléments d'authentification du compte.
args.lop : liste d'opérations [op, id, ids, date]
  - op:1 : dlv de versions id
  - op:2 : dfh de groupes id
  - op:3 : dlv de membrs id / ids
Retour:

operations.ForceDlv = class ForceDlv extends Operation {
  constructor (nom) { super(nom, 3) }

  async phase2(args) {
    for (const x of args.lop) {
      switch (x[0]) {
      case 1 : {
        const version = compile(await this.getRowVersion(x[1], 'ForceDlv-1'))
        if (!version._zombi) version.v++
        version.dlv = x[3]
        this.update(version.toRow())
        break
      }
      case 2 : {
        const groupe = compile(await this.getRowGroupe(x[1], 'ForceDlv-2'))
        groupe.v++
        groupe.dfh = x[3]
        this.update(groupe.toRow())
        break
      }
      case 3 : {
        const membre = compile(await this.getRowMembre(x[1], x[2], 'ForceDlv-2'))
        membre.v++
        membre.dlv = x[3]
        this.update(membre.toRow())
        break
      }
      }
    }
  }
}
*/

/*****************************************************************************
 * GC
 *****************************************************************************/
/* GC général enchaînant les étapes de GC spécécifiques
Appel depuis une requête (pas d'attente du résultat)
*/
operations.GC = class GC extends Operation {
  constructor (nom) { super(nom, 0)  }

  async phase2() {
    setTimeout(async () => {
      const op = operations.GCGen
      await new op().run()
    }, 50)
  }
}

/* Pour admin : retourne les checkpoints exisztants *************/
operations.GetSingletons = class GetSingletons extends Operation {
  constructor (nom) { super(nom, 0)  }

  async phase2() {
    const a = await this.getSingletons()
    this.setRes('singletons', a)
  }
}

/* GC général enchaînant les étapes de GC spécifiques
checkpoint _data_ :
- `id` : 1
- `v` : date-time de sa dernière mise à jour ou 0 s'il n'a jamais été écrit.

- `start` : date-heure de lancement du dernier GC.
- `duree` : durée de son exécution en ms.
- `nbTaches` : nombre de taches terminées avec succès sur 6.
- `log` : array des traces des exécutions des tâches:
  - `nom` : nom.
  - `retry` : numéro de retry.
  - `start` : date-heure de lancement.
  - `duree` : durée en ms.
  - `err` : si sortie en exception, son libellé.
  - `stats` : {} compteurs d'objets traités (selon la tâche).
*/
operations.GCGen = class GCGen extends Operation {
  constructor (nom) { super(nom, 0)  }

  async phase2 () {
    config.logger.info('GC started')

    // 10 Récupération des fins d'hébergement
    !await new operations.GCHeb().run()

    // 11 Récupération des membres disparus et des groupes devenant orphelins
    !await new operations.GCGro().run()

    // 12 Purge des avatars et groupes
    !await new operations.GCPag().run()

    // 13 Purge des fichiers (et des transferts) des transferts abandonnés
    !await new operations.GCTra().run()

    // 14 purges des fichiers détruits accumulés dans fpurges
    !await new operations.GCFpu().run()

    // 15 purges des versions ayant une dlv de plus d'un an
    // purges des sponsorings hor date
    !await new operations.GCDlv().run()

    // 20 statistiques "mensuelles" comptas (avec purges)
    !await new operations.GCstcc().run()

    // 21 statistiques "mensuelles" tickets (avec purges)
    !await new operations.GCstct().run()
  }
}

/* GCHeb : Traitement des fins d'hébergement ***********************************
L'opération récupère toutes les ids des document groupe où 
dfh est inférieure ou égale au jour courant.

Une transaction par groupe :
- dans le document version du groupe, dlv est positionnée à auj et zombi
*/
operations.GCHeb = class GCHeb extends Operation {
  constructor (nom) { super(nom, 0)  }

  async phase2 () {
    const dh = Date.now()
    for(let nr = 0; nr < 3; nr++)
      try {
        const stats = { nh: 0 }
        const hb = await this.getGroupesDfh(this.auj)
        for (const id of hb) {
          await new operations.GCHebtr()
            .run({id: id, dlv: AMJ.amjUtcPlusNbj(this.auj, -1)})
          stats.nh++
        }
        const data = { id: 10, v: dh, nr: nr, duree: Date.now() - dh,
          stats: stats
        }
        this.setSingleton(data)
        break
      } catch (e) {
        const info = e.toString() + '\n' + e.stack
        trace('GCHeb-ER1' , 0, info, true)
        const data = { id: 10, v: dh, nr: nr, duree: Date.now() - dh,
          stats: {}, exc: info
        }
        this.setSingleton(data)
        sleep(nr * 10000)
      }
  }
}

operations.GCHebtr = class GCHebtr extends Operation {
  constructor (nom) { super(nom, 0)  }

  async phase2 (args) {
    const idg = args.id
    const dlv = args.dlv
    const vg = compile(await this.getRowVersion(idg))
    if (vg && !vg._zombi) { // versions dlv
      vg.v++
      vg.dlv = dlv
      vg._zombi = true
      this.update(vg.toRow())
    }
  }
}

/* GCGro : Détection des groupes orphelins *****************************
L'opération récupère toutes les id / ids des `membres` dont
`dlv` est inférieure ou égale au jour courant.

Une transaction par `groupes` :
- mise à jour des statuts des membres perdus,
- suppression de ces `membres`,
- si le groupe est orphelin, suppression du groupe:
  - la `dlv` de sa `versions` est mise à aujourd'hui (il est zombi).
*/
operations.GCGro = class GCGro extends Operation {
  constructor (nom) { super(nom, 0) }

  async phase2 () {
    const dh = Date.now()
    for(let nr = 0; nr < 3; nr++)
      try {
        const stats = { nm: 0, ng: 0 }
        const lmb = await this.getMembresDlv(this.auj)
        const lgr = new Map()
        for (const [id, ids] of lmb) { // regroupement par groupe
          let a = lgr.get(id)
          if (!a) { a = []; lgr.set(id, a) }
          a.push(ids)
        }
        for (const [id, a] of lgr) { // Pour chaque groupe, a: liste des ids des membres perdus
          await new operations.GCGrotr().run({id, a, dlv: AMJ.amjUtcPlusNbj(this.auj, -1)})
          stats.ng++
          stats.nm += a.length
        }
        const data = { id: 11, v: dh, nr: nr, duree: Date.now() - dh,
          stats: stats
        }
        this.setSingleton(data)
        break
      } catch (e) {
        const info = e.toString() + '\n' + e.stack
        trace('GCGro-ER1' , 0, info, true)
        const data = { id: 11, v: dh, nr: nr, duree: Date.now() - dh,
          stats: {}, exc: info
        }
        this.setSingleton(data)
        sleep(nr * 10000)
      }
  }
}

operations.GCGrotr = class GCGrotr extends Operation {
  constructor (nom) { super(nom, 0)  }

  async phase2 (args) {
    const idg = args.id // id du groupe
    const dlv = args.dlv // dlv en cas de suppression du groupe
    const a = args.a // liste des membres disparus

    const vg = compile(await this.getRowVersion(idg))
    const groupe = compile(await this.getRowGroupe(idg))
    if (!vg || vg._zombi || !groupe) return
    vg.v++

    try {
      for (const im of a) {
        const fl = groupe.flags[im]
        groupe.nag[args.ids] = !(fl & FLAGS.HA) ? 0 : 1
        groupe.flags[im] = 0
        this.delete( { _nom: 'membres', id: idg, ids: im })
      }
    } catch (e) {
      // trace : données groupe inconstante
      // mais par prudence on détruit le grope
      const info = 'rowGroupe inconsistent'
      trace('GCGrotr-AL1' , idg, info)
    }

    if (groupe.aActifs) { // Il reste des membres actifs
      groupe.v = vg.v
      this.update(groupe.toRow())
    } else { // le groupe est à purger
      vg.dlv = dlv // versions dlv
      vg._zombi = true
    }
    this.update(vg.toRow())
  }
}

/* GCPag : Purge des sous-collections d'avatars et de groupes ***********
L'opération récupère toutes les `id` des `versions` dont la `dlv` 
est entre AMJ.min et auj (exclu).
Dans l'ordre pour chaque id:
- par compte, une transaction de récupération du volume 
(si `comptas` existe encore, sinon c'est que ça a déjà été fait),
- purge de leurs sous-collections,
- purge de leur avatar / groupe,
- purge de leurs fichiers,
- set HORS TRANSACTION de la `dlv` de la `versions` à aamm
*/
operations.GCPag = class GCPag extends Operation {
  constructor (nom) { super(nom, 0)  }

  async phase2 () {
    const dh = Date.now()
    for(let nr = 0; nr < 3; nr++)
      try {
        const st = { na: 0, ng: 0, nn: 0, nc: 0, ns: 0, nt: 0, nm: 0 }
        this.lids = await this.getVersionsSuppr(AMJ.min, this.auj)
        for (const id of this.lids) {
          if (ID.estComptable(id)) continue
          const estG = ID.estGroupe(id)
          if (estG) {
            st.ng++
            st.nn += await this.delScoll('notes', id)
            st.nm += await this.delScoll('membres', id)
            st.nt += await this.delScoll('transferts', id)
            st.nc += await this.delScoll('chatgrs', id)
          } else {
            st.na++
            // récupération éventuelle des volumes du compte (si l'avatar est un compte)
            await new operations.GCPagtr().run({ id })
            st.nn += await this.delScoll('notes', id)
            st.nc += await this.delScoll('chats', id)
            st.ns += await this.delScoll('sponsorings', id)
            st.nt += await this.delScoll('transferts', id)
          }

          // purge de avatar / groupe
          await this.delAvGr(id)

          // purge des fichiers
          const org = await this.org(id)
          const idi = id % d14
          await this.storage.delId(org, idi)

          // validation des purges : dlj symbolique aamm
          const [a1, m1, ] = AMJ.aaaammjj(this.auj)
          const dlv = (Math.floor(a1 / 100) * 100) + m1
          await this.setVdlv(id, dlv)

        }
        const data = { id: 12, v: dh, nr: nr, duree: Date.now() - dh,
          stats: st
        }
        this.setSingleton(data)
        break
      } catch (e) {
        const info = e.toString() + '\n' + e.stack
        trace('GCPag-ER1' , 0, info, true)
        const data = { id: 12, v: dh, nr: nr, duree: Date.now() - dh,
          stats: {}, exc: info
        }
        this.setSingleton(data)
        sleep(nr * 10000)      
      }
  }
}

/* Récupération des volumes d'un compte
Une transaction pour chaque compte : son document `comptas`,
- est lu pour récupérer `cletX it`;
- un document `gcvols` est inséré avec ces données : son id est celle du compte.
- les `gcvols` seront traités par la prochaine ouverture de session du comptable de l'espace ce qui supprimera l'entrée du compte dans tribu (et de facto libèrera des quotas).
- le document `comptas` est purgé afin de ne pas récupérer le volume plus d'une fois.
 */
operations.GCPagtr = class GCPagtr extends Operation {
  constructor (nom) { super(nom, 0) }

  async phase2 (args) {
    const id = args.id

    const rowCompta = await this.getRowCompta(id)
    if (rowCompta) {
      try {
        const compta = compile(rowCompta)
        if (compta.it) { // pour les comptes O seulement
          const gcvol = new Gcvols().init({
            id: id,
            cletX: compta.cletX,
            it: compta.it
          })
          this.insert(gcvol.toRow())
          this.delete(rowCompta)
        }
      } catch (e) {
        // volumes non récupérés pour données inconsistantes : ignorer
        // trace
        const info = e.toString()
        trace('GCPagtr-AL1' , args.id, info)
      }
    }
  }
}

/* GCFpu : purges des fichiers
L'opération récupère tous les items d'id de fichiers 
depuis `fpurges` et déclenche une purge sur le Storage.
Les documents `fpurges` sont purgés. { id, idag, lidf }
*/
operations.GCFpu = class GCFpu extends Operation {
  constructor (nom) { super(nom, 0) }

  async phase2 () {
    const dh = Date.now()
    for(let nr = 0; nr < 3; nr++)
      try {
        const lst = await this.listeFpurges()
        const stats = {n : 0 }
        for (const fpurge of lst) {
          if (fpurge.id && fpurge.idag && fpurge.lidf) {
            stats.n += fpurge.lidf.length
            const org = await this.org(ID.ns(fpurge.idag))
            const idi = ID.court(fpurge.idag)  
            await this.storage.delFiles(org, idi, fpurge.lidf)
            await this.unsetFpurge(fpurge.id)
          }
        }
        const data = { id: 13, v: dh, nr: nr, duree: Date.now() - dh,
          stats: stats
        }
        this.setSingleton(data)
        break
      } catch (e) {
        const info = e.toString() + '\n' + e.stack
        trace('GCFpu-ER1' , 0, info, true)
        const data = { id: 13, v: dh, nr: nr, duree: Date.now() - dh,
          stats: {}, exc: info
        }
        this.setSingleton(data)
        sleep(nr * 10000)
      }
  }
}

/* GCTra : traitement des transferts abandonnés
L'opération récupère toutes les documents transferts 
dont les dlv sont antérieures ou égales au jour J.
Le fichier id / idf cité dedans est purgé du Storage des fichiers.
Les documents transferts sont purgés.
*/
operations.GCTra = class GCTra extends Operation {
  constructor (nom) { super(nom, 0) }

  async phase2 () {
    const dh = Date.now()
    for(let nr = 0; nr < 3; nr++)
      try {
        const stats = { n : 0 }
        const lst = await this.listeTransfertsDlv(this.auj)

        for (const [id, idf] of lst) {
          if (id && idf) {
            stats.n++
            const ns = ID.ns(id)
            const org = await this.org(ns)
            const idi = ID.court(id)        
            await this.storage.delFiles(org, idi, [idf])
            await this.purgeTransferts(id, idf)
          }
        }
        const data = { id: 14, v: dh, nr: nr, duree: Date.now() - dh,
          stats: stats
        }
        this.setSingleton(data)
        break
      } catch (e) {
        const info = e.toString() + '\n' + e.stack
        trace('GCTra-ER1' , 0, info, true)
        const data = { id: 14, v: dh, nr: nr, duree: Date.now() - dh,
          stats: {}, exc: info
        }
        this.setSingleton(data)
        sleep(nr * 10000)
      }
  }
}

/* GCDlv : purge des sponsorings et versions obsolètes
L'opération récupère toutes les versions de `dlv` de la forme aamm 
aamm : correspond au mois de aujourd'hui - IDBOBSGC jours
Bref les très vielles versions définivement inutiles

L'opération récupère toutes les documents `sponsorings` 
dont les `dlv` sont antérieures ou égales à aujourd'hui. 
Ces documents sont purgés.
*/
operations.GCDlv = class GCDlv extends Operation {
  constructor (nom) { super(nom, 0)  }

  async phase2 () {
    let nom
    const dh = Date.now()
    for(let nr = 0; nr < 3; nr++)
      try {
        const stats = { nbs: 0, nbv: 0}
        nom = 'sponsorings'
        stats.nbs = await this.purgeDlv(nom, this.auj)

        nom = 'versions'
        const [a1, m1, ] = AMJ.aaaammjj(AMJ.amjUtcDeT(Date.now() - (IDBOBSGC * 86400000)))
        const dlv = (Math.floor(a1 / 100) * 100) + m1
        stats.nbv = await this.purgeDlv(nom, dlv)

        const data = { id: 15, v: dh, nr: nr, duree: Date.now() - dh,
          stats: stats
        }
        this.setSingleton(data)
        break
      } catch (e) {
        const info = e.toString() + '\n' + e.stack
        trace('GCDlv-ER1' , 0, info, true)
        const data = { id: 15, v: dh, nr: nr, duree: Date.now() - dh,
          stats: {}, exc: info
        }
        this.setSingleton(data)
        sleep(nr * 10000)
      }
  }
}

/* GCstcc : enregistrement des statistiques mensuelles comptables
Pour chaque espace, demande le calcul / enregistrement du fichier
de M-1 s'il n'a pas déjà été enregistré avec la clé publique du 
Comptable de chaque espace.
*/
operations.GCstcc = class GCstcc extends Operation {
  constructor (nom) { super(nom, 0) }

  prochMoisATraiter (esp, type) { // n==1 pour moisStat et n== 3 pour moisStatT
    /* Après la date de création, après le dernier mois calculé */
    const n = statistiques[type]
    const moisesp = Math.floor((esp.dcreation) / 100)
    const prc = AMJ.moisPlus(moisesp, n) // premier à calculer
    const dmc = esp[type] || 0 // dernier mois déjà calculé
    return prc > dmc ? prc : AMJ.moisPlus(dmc, 1)
  }

  async phase2 () {
    const moisauj = Math.floor(this.auj / 100) 
    const MS = 'moisStat'
    const SM = statistiques[MS]
    const MX = 3 // Pour stats on ne sait pas calculer avant M-3

    const dh = Date.now()
    for(let nr = 0; nr < 3; nr++)
      try {
        const stats = { nbstc: 0 }
        const rowEspaces = await this.coll('espaces')
        for (const row of rowEspaces) {
          const esp = compile(row)
          let proch = this.prochMoisATraiter(esp, MS)
          // dernier mois calculable: pour moisStat c'est M-1
          const derc = AMJ.moisMoins(moisauj, SM)
        
          for(let mr = SM; mr < MX; mr++) {
            if (proch > derc) break
            proch = AMJ.moisPlus(proch, 1)
            const arg = { org: esp.org, mr }
            await new operations.ComptaStat(true).run(arg)
            stats.nbstc++
          }
        }
        const data = { id: 20, v: dh, nr: nr, duree: Date.now() - dh,
          stats: stats
        }
        this.setSingleton(data)
        break  
      } catch (e) {
        const info = e.toString() + '\n' + e.stack
        trace('GCstcc-ER1' , 0, info, true)
        const data = { id: 20, v: dh, nr: nr, duree: Date.now() - dh,
          stats: {}, exc: info
        }
        this.setSingleton(data)
        sleep(nr * 10000)
      }
  }
}

/* GCstct : enregistrement des statistiques mensuelles des tickets
Pour chaque espace, demande le calcul / enregistrement du fichier
de M-1 s'il n'a pas déjà été enregistré avec la clé publique du 
Comptable de chaque espace.
*/
operations.GCstct = class GCstct extends Operation {
  constructor (nom) { super(nom, 1, 1) }

  prochMoisATraiter (esp, type) { // n==1 pour moisStat et n== 3 pour moisStatT
    /* Après la date de création, après le dernier mois calculé */
    const n = statistiques[type]
    const moisesp = Math.floor((esp.dcreation) / 100)
    const prc = AMJ.moisPlus(moisesp, n) // premier à calculer
    const dmc = esp[type] || 0 // dernier mois déjà calculé
    return prc > dmc ? prc : AMJ.moisPlus(dmc, 1)
  }

  async phase2 () {
    const moisauj = Math.floor(this.auj / 100) 
    const MS = 'moisStatT'
    const SM = statistiques[MS]
    const MX = 12 // Pour statT on ne sait pas calculer avant M-12

    const dh = Date.now()
    for(let nr = 0; nr < 3; nr++)
      try {
        const stats = { nbstt: 0 }
        const rowEspaces = await this.coll('espaces')
        for (const row of rowEspaces) {
          const esp = compile(row)
          let proch = this.prochMoisATraiter(esp, MS)
          // dernier mois calculable: pour moisStat c'est M-1
          const derc = AMJ.moisMoins(moisauj, SM)
        
          for(let mr = SM; mr < MX; mr++) {
            if (proch > derc) break
            proch = AMJ.moisPlus(proch, 1)
            const arg = { org: esp.org, mr }
            await new operations.TicketsStat(true).run(arg)
            stats.nbstt++
          }
        }
        const data = { id: 21, v: dh, nr: nr, duree: Date.now() - dh,
          stats: stats
        }
        this.setSingleton(data)
        break  
      } catch (e) {
        const info = e.toString() + '\n' + e.stack
        trace('GCstct-ER1' , 0, info, true)
        const data = { id: 21, v: dh, nr: nr, duree: Date.now() - dh,
          stats: {}, exc: info
        }
        this.setSingleton(data)
        sleep(nr * 10000)
      }
  }
}

/* OP_TestRSA: 'Test encryption RSA'
args.token
args.id
args.data
Retour:
- data: args.data crypré RSA par la clé publique de l'avatar
*/
operations.TestRSA = class TestRSA extends Operation {
  constructor (nom) { super(nom, 1)  }

  async phase2 (args) {
    const avatar = compile(await this.getRowAvatar(args.id, 'TestRSA-1'))
    const pub = avatar.pub
    const data = crypterRSA(pub, args.data)
    this.setRes('data', new Uint8Array(data))
  }
}

/* OP_CrypterRaw: 'Test d\'encryptage serveur d\'un buffer long',
Le serveur créé un binaire dont,
- les 256 premiers bytes crypte en RSA, la clé AES, IV et l'indicateur gz
- les suivants sont le texte du buffer long crypté par la clé AES générée.
args.token
args.id
args.data
args.gz
Retour:
- data: "fichier" binaire auto-décryptable en ayant la clé privée RSA
*/
operations.CrypterRaw = class CrypterRaw extends Operation {
  constructor (nom) { super(nom, 1)  }

  async phase2 (args) {
    const avatar = compile(await this.getRowAvatar(args.id, 'TestRSA-1'))
    const pub = avatar.pub
    const data = crypterRaw(this.db.appKey, pub, args.data, args.gz)
    /*
    const d2 = decrypterRaw(this.db.appKey, data)
    const t = d2.toString()
    console.log(t.substring(0, 30))
    */
    this.setRes('data', new Uint8Array(data))
  }
}

/* OP_ComptaStat : 'Enregistre en storage la statistique de comptabilité'
du mois M-1 ou M-2 ou M-3 pour l'organisation org.
args.org: code de l'organisation
args.mr: de 1 à 3, mois relatif à la date du jour.
Retour:
- URL d'accès au fichier dans le storage

Le dernier mois de disponibilté de la statistique comptable est enregistrée dans
l'espace s'il est supérieur à celui existant.
*/
operations.ComptaStat = class ComptaStat extends Operation {
  constructor (gc) { 
    super('ComptaStat', gc ? 3 : 1, 1)
    if (gc) this.gc = true
  }

  static cptM = ['IT', 'NJ', 'QC', 'Q1', 'Q2', 'NL', 'NE', 'VM', 'VD', 'NN', 'NC', 'NG', 'V2']

  get sep () { return ','}

  /* Cette méthode est invoquée par collNs en tant que 
  "processeur" de chaque row récupéré pour éviter son stockage en mémoire
  puis son traitement
  */
  processData (op, data) {
    const dcomp = decode(data)
    const c = new Compteurs(dcomp.compteurs)
    const vx = c.vd[op.mr]
    const nj = Math.ceil(vx[Compteurs.MS] / 86400000)
    if (!nj) return
    
    const it = dcomp.it || 0 // indice tribu
    const x1 = Compteurs.X1
    const x2 = Compteurs.X1 + Compteurs.X2
    const qc = Math.round(vx[Compteurs.QC])
    const q1 = Math.round(vx[Compteurs.Q1])
    const q2 = Math.round(vx[Compteurs.Q2])
    const nl = Math.round(vx[Compteurs.NL + x1])
    const ne = Math.round(vx[Compteurs.NE + x1])
    const vm = Math.round(vx[Compteurs.VM + x1])
    const vd = Math.round(vx[Compteurs.VD + x1])
    const nn = Math.round(vx[Compteurs.NN + x2])
    const nc = Math.round(vx[Compteurs.NC + x2])
    const ng = Math.round(vx[Compteurs.NG + x2])
    const v2 = Math.round(vx[Compteurs.V2 + x2])
    op.lignes.push([it, nj, qc, q1, q2, nl, ne, vm, vd, nn, nc, ng, v2].join(op.sep))
  }

  async creation () {
    this.lignes = []
    this.lignes.push(operations.ComptaStat.cptM.join(this.sep))
    await this.db.collNs(this, 'comptas', this.ns, this.processData)
    const calc = this.lignes.join('\n')
    this.lignes = null

    const avatar = compile(await this.getRowAvatar(this.idC, 'ComptaStat-1'))
    const fic = crypterRaw(this.db.appKey, avatar.pub, Buffer.from(calc), true)
    await this.storage.putFile(this.args.org, ID.court(this.idC), 'C_' + this.mois, fic)
  }

  async phase2 (args) {
    const espace = await this.getEspaceOrg(args.org)
    if (!espace) throw new AppExc(A_SRV, 18, [args.texte])
    this.ns = espace.id
    if (args.mr < 0 || args.mr > 2) args.mr = 1
    const m = AMJ.djMoisN(this.auj, - args.mr)
    this.mr = args.mr
    this.mois = Math.floor(m / 100)

    this.idC = ID.duComptable(this.ns)
    this.setRes('getUrl', await this.storage.getUrl(args.org, ID.court(this.idC), 'C_' + this.mois))

    if (espace.moisStat && espace.moisStat >= this.mois) {
      this.phase2 = null
      this.setRes('creation', false)
    } else {
      this.setRes('creation', true)
      await this.creation()
      if (args.mr === 0) this.phase2 = null
    }
    this.setRes('mois', this.mois)
    
    if (!this.estFige) {
      const espace = compile(await this.getRowEspace(this.ns, 'ComptaStat-2'))
      if (!espace.moisStat || espace.moisStat < this.mois) {
        espace.moisStat = this.mois
        espace.v++
        this.update(espace.toRow())
      }
    }
  }
}

/* OP_TicketsStat : 'Enregistre en storage la liste des tickets de M-3 désormais invariables'
args.token: éléments d'authentification du compte.
args.org: code de l'organisation
args.mr: mois relatif

Le dernier mois de disponibilté de la statistique est enregistrée dans
l'espace s'il est supérieur à celui existant.
Purge des tickets archivés
*/
operations.TicketsStat = class TicketsStat extends Operation {
  constructor (gc) { 
    super('TicketsStat', gc ? 3 : 1, 1)
    if (gc) this.gc = true
  }

  static cptM = ['IDS', 'TKT', 'DG', 'DR', 'MA', 'MC', 'REFA', 'REFC']

  get sep () { return ','}

  /* Cette méthode est invoquée par collNs en tant que 
  "processeur" de chaque row récupéré pour éviter son stockage en mémoire
  puis son traitement
  - `id`: id du Comptable.
  - `ids` : numéro du ticket
  - `v` : version du ticket.

  - `dg` : date de génération.
  - `dr`: date de réception. Si 0 le ticket est _en attente_.
  - `ma`: montant déclaré émis par le compte A.
  - `mc` : montant déclaré reçu par le Comptable.
  - `refa` : texte court (32c) facultatif du compte A à l'émission.
  - `refc` : texte court (32c) facultatif du Comptable à la réception.
  - `di`: date d'incorporation du crédit par le compte A dans son solde.
  */

  quotes (v) {
    if (!v) return '""'
    const x = v.replaceAll('"', '_')
    return '"' + x + '"'
  }

  processData (op, data) {  
    const d = decode(data)
    
    const ids = d.ids
    const tkt = op.quotes(idTkToL6(d.ids))
    const dg = d.dg
    const dr = d.dr
    const ma = d.ma
    const mc = d.mc
    const refa = op.quotes(d.refa)
    const refc = op.quotes(d.refc)
    op.lignes.push([ids, tkt, dg, dr, ma, mc, refa, refc].join(op.sep))
  }

  async creation () {
    this.lignes = []
    this.lignes.push(operations.TicketsStat.cptM.join(this.sep))
    await this.db.selTickets(this, this.idC, this.mois, this.processData)
    const calc = this.lignes.join('\n')
    this.lignes = null

    const avatar = compile(await this.getRowAvatar(this.idC, 'ComptaStatT-1'))
    const fic = crypterRaw(this.db.appKey, avatar.pub, Buffer.from(calc), true)
    await this.storage.putFile(this.args.org, ID.court(this.idC), 'T_' + this.mois, fic)
  }

  async phase2 (args) {
    const espace = await this.getEspaceOrg(args.org)
    if (!espace) throw new AppExc(A_SRV, 18, [args.texte])
    this.ns = espace.id
    const moisauj = Math.floor(this.auj / 100)
    this.mois = AMJ.moisMoins(moisauj, args.mr)

    this.idC = ID.duComptable(this.ns)
    this.setRes('getUrl', await this.storage.getUrl(args.org, ID.court(this.idC), 'T_' + this.mois))

    if (!espace.moisStatT || (espace.moisStatT < this.mois)) {
      await this.creation()
      this.setRes('creation', true)
    } else {
      this.setRes('creation', false)
      this.phase2 = null
    }
    this.setRes('mois', this.mois)

    if (!this.estFige) {
      const espace = compile(await this.getRowEspace(this.ns, 'ComptaStatT-2'))
      if (!espace.moisStatT || (espace.moisStatT < this.mois)) {
        espace.moisStatT = this.mois
        espace.v++
        this.update(espace.toRow())
        await this.db.delTickets (this, this.idC, this.mois)
      }
    }
  }
}

/*****************************************
GetUrlStat : retourne l'URL de get d'un fichier de stat mensuelle
Comme c'est un GET, les arguments sont en string (et pas en number)
args.token: éléments d'authentification du compte.
args.ns : 
args.mois :
args.cs : code statistique C ou T
*/
operations.GetUrlStat = class GetUrlStat extends Operation {
  constructor (nom) { super(nom, 1) }

  async phase2 (args) {
    const ns = parseInt(args.ns)
    const org = await this.org(ns)
    const idC = ID.court(ID.duComptable(ns))
    const url = await this.storage.getUrl(org, idC, args.cs + '_' + args.mois)
    this.setRes('getUrl', url)
    if (!this.id) this.setRes('appKey', this.db.appKey)
  }
}
