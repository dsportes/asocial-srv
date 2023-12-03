// import { encode, decode } from '@msgpack/msgpack'
import { AppExc, F_SRV, A_SRV, ID, Compteurs, AMJ, UNITEV2, edvol, d14 } from './api.mjs'
import { encode, decode } from '@msgpack/msgpack'
import { ctx } from './server.js'
import { AuthSession, Operation, compile, Versions,
  Transferts, Gcvols, trace } from './modele.mjs'
import { sleep } from './util.mjs'
import { limitesjour, FLAGS, edit } from './api.mjs'

export function atStart() {
  if (ctx.debug) console.log('atStart operations')
}

export const operations = {}

/** Echo du texte envoyé ***************************************
args.to : délai en secondes avant retour de la réponse
args.texte : texte à renvoyer en écho OU en détail de l'erreur fonctionnelle testée
Retour:
- echo : texte d'entrée retourné
*/
operations.EchoTexte = class EchoTexte extends Operation {
  constructor (nom) { super(nom); this.authMode = 3 }

  async phase1(args) {
    if (args.to) {
      await sleep(args.to * 1000)
    }
    this.setRes('echo', args.texte)
  }
}

/** Erreur fonctionnelle simulée du texte envoyé ***************************************
args.to : délai en secondes avant retour de la réponse
args.texte : détail de l'erreur fonctionnelle testée
Exception
*/
operations.ErreurFonc = class ErreurFonc extends Operation {
  constructor (nom) { super(nom); this.authMode = 3 }

  async phase1(args) {
    if (args.to) {
      await sleep(args.to * 1000)
    }
    throw new AppExc(F_SRV, 1, [args.texte])
  }
}

/** Test d'accès à la base ***************************************
Lecture de l'avatar du comptable
Retour: aucun
*/
operations.PingDB = class PingDB extends Operation {
  constructor (nom) { super(nom); this.authMode = 3 }

  async phase1() {
    await this.getRowEspace(1)
  }
}

/* get cle publique RSA d'un avatar ******
args.id : id de l'avatar
- pub : nul si l'avatar a disparu
*/
operations.GetPub = class GetPub extends Operation {
  constructor () { super('GetPub'); this.authMode = 3  }

  async phase1 (args) {
    const avatar = compile(await this.getRowAvatar(args.id))
    this.setRes('pub', avatar ? avatar.pub : null)
  }
}

/* Recherche sponsoring ******
args.ids : hash de la phrase de contact
Retour:
- rowSponsoring s'il existe
*/
operations.ChercherSponsoring = class ChercherSponsoring extends Operation {
  constructor () { super('ChercherSponsoring'); this.authMode = 3  }

  async phase1 (args) {
    const row = await this.getSponsoringIds(args.ids)
    if (row) this.setRes('rowSponsoring', row)
  }
}

/* Recherche hash de phrase ******
args.ids : hash de la phrase de contact / de connexion
args.t :
  - 1 : phrase de connexion(hps1 de compta)
  - 2 : phrase de sponsoring (ids)
  - 3 : phrase de contact (hpc d'avatar)
Retour:
- existe : true si le hash de la phrase existe
*/
operations.ExistePhrase = class ExistePhrase extends Operation {
  constructor () { super('ExistePhrase'); this.authMode = 3  }

  async phase1 (args) {
    if (args.t === 1) {
      if (await this.getComptaHps1(args.ids)) {
        this.setRes('existe', true)
        return
      }
    } if (args.t === 2) {
      if (await this.getSponsoringIds(args.ids)) {
        this.setRes('existe', true)
        return
      }
    } if (args.t === 3) {
      if (await this.getAvatarHpc(args.ids)) {
        this.setRes('existe', true)
        return
      }
    }
  }
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
  constructor () { super('EnregConso'); this.lecture = true }

  async phase1(args) {
    /* this.lecture = true permet de récupérer this.session.notifG
    et si "figé" de ne pas enregistrer la consommation.
    Mais ça a permis de garder la session vivante
    et de ne pas sortir en exception
    */
    if (this.notifG && this.notifG.nr) {
      // espace figé
      this.phase2 = null
    } else if (!args.conso) this.phase2 = null
  }

  async phase2(args) {
    const compta = compile(await this.getRowCompta(this.session.id))
    if (!compta) return
    compta.v++
    const c = new Compteurs(compta.compteurs, null, args.conso)
    compta.compteurs = c.serial
    this.update(compta.toRow())
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
  constructor () { super('CreerEspace') }

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
- `token` : jeton d'authentification du compte de **l'administrateur**
- `ids` : du ticket
- `mc` : montant reçu
- `refc` : référence du Comptable

Retour: rien
*/
operations.ReceptionTicket = class ReceptionTicket extends Operation {
  constructor () { super('ReceptionTicket') }

  async phase2(args) {
    const idc = ID.duComptable(this.session.ns)
    const version = compile(await this.getRowVersion(idc, 'PlusTicket-2'))
    const ticket = compile(await this.getRowTicket(idc, args.ids, 'ReceptionTicket-1'))
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
- `token` : jeton d'authentification du compte de **l'administrateur**
- `credits` : credits crypté par la clé K du compte

Retour: rien
*/
operations.MajCredits = class MajCredits extends Operation {
  constructor () { super('MajCredits') }

  async phase2(args) {
    const compta = compile(await this.getRowCompta(this.session.id, 'MajCredits-1'))
    compta.v++
    compta.credits = args.credits
    this.update(compta.toRow())
  }
}

/* `PlusTicket` : ajout d'un ticket à un compte A
et ajout d'un ticket au Comptable
POST:
- `token` : jeton d'authentification du compte de **l'administrateur**
- `credits` : credits crypté par la clé K du compte
- `rowTicket` : nouveau row tickets pour le Comptable

Retour: rien
*/
operations.PlusTicket = class PlusTicket extends Operation {
  constructor () { super('PlusTicket') }

  async phase2(args) {
    const compta = compile(await this.getRowCompta(this.session.id, 'PlusTicket-1'))
    compta.v++
    compta.credits = args.credits
    this.update(compta.toRow())
    const idc = ID.duComptable(this.session.ns)
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
- `token` : jeton d'authentification du compte de **l'administrateur**
- `credits` : credits crypté par la clé K du compte
- `ids` : du ticket

Retour: rien
*/
operations.MoinsTicket = class MoinsTicket extends Operation {
  constructor () { super('MoinsTicket') }

  async phase2(args) {
    const idc = ID.duComptable(this.session.ns)
    const ticket = compile(await this.getRowTicket(idc, args.ids, 'MoinsTicket-1'))
    if (ticket.dr) throw new AppExc(F_SRV, 24)
    const version = compile(await this.getRowVersion(idc, 'MoinsTicket-2'))
    version.v++
    this.update(version.toRow())
    ticket.v = version.v
    ticket._zombi = true
    this.update(ticket.toRow())

    const compta = compile(await this.getRowCompta(this.session.id, 'MoinsTicket-3'))
    compta.v++
    compta.credits = args.credits
    this.update(compta.toRow())
  }
}

/* `RafraichirTickets` : nouvelles versions des tickets cités
POST:
- `token` : jeton d'authentification du compte de **l'administrateur**
- `mtk` : map des tickets. clé: ids, valeur: version détenue en session

Retour: 
- rowTickets: liste des rows des tickets ayant changé
*/
operations.RafraichirTickets = class RafraichirTickets extends Operation {
  constructor () { super('RafraichirTickets') }

  async phase2(args) {
    const idc = ID.duComptable(this.session.ns)
    for (const idss in args.mtk) {
      const ids = parseInt(idss)
      const v = args.mtk[idss]
      const rowTicket = await this.getRowTicketV(idc, ids, v)
      if (rowTicket) this.addRes('rowTickets', rowTicket)
    }
  }
}

/* `SetNotifG` : déclaration d'une notification à un espace par l'administrateur
POST:
- `token` : jeton d'authentification du compte de **l'administrateur**
- `ns` : id de l'espace notifié
- `notif` : sérialisation de l'objet notif, cryptée par la clé du comptable de l'espace. Cette clé étant publique, le cryptage est symbolique et vise seulement à éviter une lecture simple en base.

Retour: 
- `rowEspace` : le row espaces mis à jour.

Assertion sur l'existence du row `Espaces`.

C'est une opération "admin", elle échappe aux contrôles espace figé / clos.
Elle n'écrit QUE dans espaces.
*/
operations.SetNotifG = class SetNotifG extends Operation {
  constructor () { super('SetNotifG'); this.authMode = 1 }

  async phase2 (args) {
    const espace = compile(await this.getRowEspace(args.ns, 'SetNotifG'))
    espace.v++
    espace.notif = args.notif || null
    const rowEspace = this.update(espace.toRow())
    this.setRes('rowEspace', rowEspace)
  }
}

/* `GetEspace` : get de l'espace du compte de la session
POST:
- `token` : éléments d'authentification du compte.
- `ns` : id de l'espace.

Retour:
- `rowEspace`

Assertion sur l'existence du row Espace.
*/
operations.GetEspace = class GetEspace extends Operation {
  constructor () { super('GetEspace'); this.authMode = 1; this.lecture = true }

  async phase2 (args) {
    const rowEspace = await this.getRowEspace(args.ns, 'GetEspace')
    this.setRes('rowEspace', rowEspace)
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
  constructor () { super('SetEspaceT')}

  async phase2 (args) {
    let rowEspace = await this.getRowEspace(args.ns, 'SetEspaceT')
    const espace = compile(rowEspace)
    espace.v++
    espace.t = args.t || 0
    rowEspace = this.update(espace.toRow())
    this.setRes('rowEspace', rowEspace)
  }
}

/*`SetEspaceOptionA` : changement de l'option A par le Comptable
POST:
- `token` : jeton d'authentification du compte de **l'administrateur**
- `ns` : id de l'espace notifié.
- `optionA` : 0 1 2.

Retour: rien

Assertion sur l'existence du row `Espaces`.

L'opération échappe au contrôle espace figé / clos.
Elle n'écrit QUE dans espaces.
*/
operations.SetEspaceOptionA = class SetEspaceOptionA extends Operation {
  constructor () { super('SetEspaceOptionA')}

  async phase2 (args) {
    let rowEspace = await this.getRowEspace(args.ns, 'SetEspaceOptionA')
    const espace = compile(rowEspace)
    espace.v++
    espace.opt = args.optionA || 0
    rowEspace = this.update(espace.toRow())
    this.setRes('rowEspace', rowEspace)
  }
}

/* `GetSynthese` : retourne la synthèse de l'espace
POST:
- `token` : éléments d'authentification du compte.
- `ns` : id de l'espace.

Retour:
- `rowSynthese`

Assertion sur l'existence du row `Syntheses`.
*/
operations.GetSynthese = class GetSynthese extends Operation {
  constructor () { super('GetSynthese'); this.lecture = true }

  async phase2 (args) {
    const rowSynthese = await this.getRowSynthese(args.ns, 'GetSynthese')
    this.setRes('rowSynthese', rowSynthese)
  }
}

/* `AjoutSponsoring` : déclaration d'un nouveau sponsoring par le comptable ou un sponsor
POST:
- `token` : éléments d'authentification du comptable / compte sponsor de sa tribu.
- `rowSponsoring` : row Sponsoring, SANS la version (qui est calculée par le serveur).

Retour: rien

Exceptions:
- `F_SRV 7` : un sponsoring identifié par une même phrase (du moins son hash) existe déjà.

Assertion sur l'existence du row `Versions` du compte.
*/
operations.AjoutSponsoring = class AjoutSponsoring extends Operation {
  constructor () { super('AjoutSponsoring') }

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
  constructor (nom) { super(nom) }

  async phase2(args) {
    const sp = compile(await this.getRowSponsoring(args.id, args.ids, 'ProlongerSponsoring'))
    if (sp.st === 0) {
      const version = compile(await this.getRowVersion(args.id, 'ProlongerSponsoring-2'), true)
      version.v++
      sp.v = version.v
      sp.dh = Date.now()
      if (args.dlv) {
        sp.dlv = args.dlv
      } else {
        sp.st = 3
      }
      this.update(sp.toRow())
      this.update(version.toRow())
    }
  }
}

/* `RefusSponsoring` : refus de son sponsoring par le _sponsorisé_
Change le statut du _sponsoring_ à _refusé_. Ne fais rien si le sponsoring n'est pas _actif_ (hors limite, déjà accepté ou refusé).
POST:
- `ids` : identifiant du sponsoring, hash de la phrase de contact.
- `ardx` : justification / remerciement du _sponsorisé à stocker dans le sponsoring.

Retour: rien.

Exceptions:
- `F_SRV 8` : le sponsoring n'existe pas.

Assertion sur l'existence du row Versions du compte sponsor.
*/
operations.RefusSponsoring = class RefusSponsoring extends Operation {
  constructor (nom) { super(nom); this.authMode = 2 }

  async phase1() {
    // pseudo session pour permettre un sync
    this.session = AuthSession.set(this.authData.sessionId, 0)
  }

  async phase2(args) {
    const rowSponsoring = await this.getSponsoringIds(args.ids)
    if (!rowSponsoring) throw new AppExc(F_SRV, 8)

    const rowVersion = await this.getRowVersion(rowSponsoring.id, 'RefusSponsoring', true)
    const sp = compile(rowSponsoring)
    const version = compile(rowVersion)

    if (sp.st === 0) {
      version.v++
      sp.v = version.v
      sp.ardx = args.ardx
      sp.dh = Date.now()
      sp.st = 1
      this.update(sp.toRow())
      this.update(version.toRow())
    }
  }
}

/* `AcceptationSponsoring` : création du compte du _sponsorisé_
POST:
- `token` : éléments d'authentification du compte à créer
- `rowCompta` : row du compte à créer.
- `rowAvatar` : row de son avatar principal.
- `rowVersion` : row de avatar en création.
- `idt` : id de sa tribu. 0 SI compte A
- `ids` : ids du sponsoring, hash de sa phrase de reconnaissance qui permet de retrouver le sponsoring.
- `ardx` : texte de l'ardoise du sponsoring à mettre à jour (avec statut 2 accepté), copie du texte du chat échangé.
- `act`: élément de la map act de sa tribu. null SI compte A
- pour les chats:
    - `idI idsI` : id du chat, côté _interne_.
    - `idE idsE` : id du chat, côté _externe_.
    - `ccKI` : clé cc du chat cryptée par la clé K du compte de I.
    - `ccPE` : clé cc cryptée par la clé **publique** de l'avatar E.
    - `naccI` : [nomI, cleI] crypté par la clé cc
    - `naccE` : [nomE, cleE] crypté par la clé cc
    - `txt1` : texte 1 du chat crypté par la clé cc.
    - `lgtxt1` : longueur du texte 1 du chat.
    - `txt2` : texte 2 du chat crypté par la clé cc.
    - `lgtxt2` : longueur du texte 2 du chat.

Retour: rows permettant d'initialiser la session avec le nouveau compte qui se trouvera ainsi connecté.
- `rowTribu`
- `rowChat` : le chat _interne_, celui concernant le compte.
- `credentials` : données d'authentification permettant à la session d'accéder au serveur de données Firestore.
- `rowEspace` : row de l'espace, informations générales / statistiques de l'espace et présence de la notification générale éventuelle.

Exceptions:
- `F_SRV, 8` : il n'y a pas de sponsoring ayant ids comme hash de phrase de connexion.
- `F_SRV, 9` : le sponsoring a déjà été accepté ou refusé ou est hors limite.

Assertions:
- existence du row `Tribus`,
- existence du row `Versions` du compte sponsor.
- existence du row `Avatars` du sponsorisé.
- existence du row `Espaces`.
*/
operations.AcceptationSponsoring = class AcceptationSponsoring extends Operation {
  constructor (nom) { super(nom); this.authMode = 2 }

  async phase1(args) {
    this.session = AuthSession.set(this.authData.sessionId, args.rowCompta.id)
  }

  async phase2(args) {
    const avatarE = compile(await this.getRowAvatar(args.idE))
    if (!avatarE) throw new AppExc(F_SRV, 25)

    // Obtention du sponsoring et incrementation de la version du sponsor    
    const sp = compile(await this.getSponsoringIds(args.ids))
    if (!sp) throw new AppExc(F_SRV, 8)
    if (sp.st !== 0) throw new AppExc(F_SRV, 9)
    const versionsp = compile(await this.getRowVersion(sp.id, 'AcceptationSponsoring-3'), true)
    versionsp.v++
    sp.v = versionsp.v
    sp.ardx = args.ardx
    sp.dh = Date.now()
    sp.st = 2
    this.update(sp.toRow())
    this.update(versionsp.toRow())
    
    let it = 0
    if (args.idt) { // C'est un compte O
      const tribu = compile(await this.getRowTribu(args.idt, 'AcceptationSponsoring-1'))
      tribu.act.push(args.act)
      it = tribu.act.length - 1
      tribu.v++
      const rowTribu = this.update(tribu.toRow())
      this.setRes('rowTribu', rowTribu)
      this.MajSynthese(tribu)
    }

    const compta = compile(args.rowCompta)
    compta.it = it
    const rowCompta = this.insert(compta.toRow())
    this.setRes('rowCompta', rowCompta)

    this.insert(args.rowAvatar)
    this.insert(args.rowVersion)

    const rowChatI = await this.nvChat(args, avatarE, compile(args.rowAvatar))
    this.setRes('rowChat', rowChatI)

    if (!ctx.sql) {
      this.setRes('credentials', ctx.config.fscredentials)
      this.setRes('emulator', ctx.config.emulator)
    }

    const ns = ID.ns(this.session.id)
    const rowEspace = await this.getRowEspace(ns, 'AcceptationSponsoring-4')
    this.setRes('rowEspace', rowEspace)
  }
}

/* `ConnexionCompte` : connexion authentifiée à un compte
Enregistrement d'une session et retour des données permettant à la session cliente de s'initialiser.

L'administrateur utilise cette opération pour se connecter mais le retour est différent.

POST:
- `token` : éléments d'authentification du compte.

Retour, sauf _administrateur_:
- `rowAvatar` : row de l'avatar principal du compte
- `rowCompta` : row compta du compte.
- `rowEspace` : row de l'espace (informations générales / statistques de l'espace et présence de la notification générale éventuelle.
- `credentials`: données d'authentification pour utilisation de l'API Firestore dans l'application cliente (absente en mode SQL)

Retour, pour _administrateur_:
- `admin` : `true` (permet en session de reconnaître une connexion d'administration).
- `espaces` : array des rows de tous les espaces.

Assertions sur l'existence des rows `Comptas, Avatars, Espaces`.
*/
operations.ConnexionCompte = class ConnexionCompte extends Operation {
  constructor () { super('ConnexionCompte'); this.authMode = 1 }

  /* Si ce n'est pas une session admin, id != 0
    auth() a accédé à this.compta par la clé hps1 du token, ce qui a enregistré son id 
    comme id du compte dans this.session.id
  */

  async phase2 () {
    const id = this.session.id
    const ns = ID.ns(id)
    if (!ctx.sql) {
      this.setRes('credentials', ctx.config.fscredentials)
      this.setRes('emulator', ctx.config.emulator)
    }

    if (!id) {
      this.setRes('admin', true)
      const te = await this.getAllRowsEspace()
      this.setRes('espaces', te)
      return
    }
    const rowCompta = await this.getRowCompta(id, ConnexionCompte-1)
    this.setRes('rowCompta', rowCompta)
    const rowAvatar = await this.getRowAvatar(id, 'ConnexionCompte-2')
    this.setRes('rowAvatar', rowAvatar)
    const rowEspace = await this.getRowEspace(ns, 'ConnexionCompte-3')
    this.setRes('rowEspace', rowEspace)
  }
}

/* Synchroniser une session

POST:
- args.token donne les éléments d'authentification du compte.
- args.avv: version de l'avatar principal du compte
- args.avmap: map du / des avatars à récupérer:
  - clé:id, 
  - valeur: version actuelle
- args.grmap:  map du / des groupes à récupérer:
  - clé: idg
  - valeur: { mbs, v, mb, no } 
    - mb : true si la session A les membres
    - no : true si la session A les notes

Retour:
- KO : true - l'avatar principal a changé de version
- rowAvatar : si KO dernière version du row avatar principal
- rowAvatars rowGroupes rowVersions rowNotes rowSponsorings rowChats rowTickets rowMembres
*/
operations.Synchroniser = class Synchroniser extends Operation {
  constructor () { super('Synchroniser')}

  async phase2 (args) {
    const rowAvatar = await this.getRowAvatar(this.session.id, 'Synchroniser-1')
    if (rowAvatar.v !== args.avv) {
      this.setRes('rowAvatar', rowAvatar)
      this.setRes('KO', true)
      return
    }

    for (const x in args.avmap) {
      const id = parseInt(x)
      const v = args.avmap[x]
      const rowVersion = await this.getRowVersion(id)
      if (!rowVersion) continue // en fait cet avatar a disparu et n'est plus listé dans avatar
      if (rowVersion.v === v) continue // cet avatar était à jour en session
      this.addRes('rowVersions', rowVersion)
      const rowAvatar = await this.getRowAvatar(id, 'Synchroniser-2')
      if (rowAvatar.v > v) this.addRes('rowAvatars', rowAvatar)

      for (const row of await this.getAllRowsNote(id, v))
        this.addRes('rowNotes', row)
      for (const row of await this.getAllRowsChat(id, v))
        this.addRes('rowChats', row)
      for (const row of await this.getAllRowsTicket(id, v))
        this.addRes('rowTickets', row)
      for (const row of await this.getAllRowsSponsoring(id, v))
        this.addRes('rowSponsorings', row)
    }

    for (const x in args.grmap) {
      const id = parseInt(x)
      const mbs = args.grmap[x].mbs
      const v = args.grmap[x].v
      const mb = args.grmap[x].mb
      const no = args.grmap[x].no
      const rowVersion = await this.getRowVersion(id)
      if (!rowVersion) continue // en fait ce groupe a disparu et n'est plus listé dans avatar
      if (rowVersion.v === v) continue // ce groupe était à jour en session
      this.addRes('rowVersions', rowVersion)
      const rowGroupe = await this.getRowGroupe(id, 'Synchroniser-3')
      if (rowGroupe.v > v) this.addRes('rowGroupes', rowGroupe)

      const groupe = compile(rowGroupe)
      let ano = false
      let amb = false
      for (const im of mbs) {
        const f = groupe.flags[im]
        if ((f & FLAGS.AM) && (f & FLAGS.DM)) amb = true
        if ((f & FLAGS.AN) && (f & FLAGS.DN)) ano = true      
      }

      if (ano) { // chargement intégral si n'avait pas les notes, incrémental sinon
        const vx = no ? v : 0
        for (const row of await this.getAllRowsNote(id, vx)) 
          this.addRes('rowNotes', row)
      }
      if (amb) {
        const vx = mb ? v : 0
        for (const row of await this.getAllRowsMembre(id, vx))
          this.addRes('rowMembres', row)
      }
    }
  }
}

/* Mise à jour des volumes v1 v2 d'une compta dans sa tribu
args.token donne les éléments d'authentification du compte.
args.idt: id de la tribu
args.it: indice du compte dans act de sa tribu
args.v1 args.v2: volumes v1 v2
Retour:
*/
operations.MajTribuVols = class MajTribuVols extends Operation {
  constructor () { super('MajTribuVols')}

  async phase2 (args) {
    const tribu = compile(await this.getRowTribu(args.idt, 'MajTribuVols'))
    tribu.v++
    tribu.act[args.it].v1 = args.v1
    tribu.act[args.it].v2 = args.v2
    this.update(tribu.toRow())
    await this.MajSynthese(tribu)
  }
}

/* `GestionAb` : gestion des abonnements
Toutes les opérations permettent de modifier la liste des abonnements,
- `abPlus` : liste des avatars et groupes à ajouter,
- `abMoins` : liste des abonnements à retirer.

Cette opération permet de mettre à jour la liste des abonnements de la session alors qu'elle n'a aucune autre action à effectuer.

POST:
- `token` : éléments d'authentification du compte.
- `abPlus abMoins`.

Retour: rien.
*/
operations.GestionAb = class GestionAb extends Operation {
  constructor () { super('GestionAb'); this.lecture = true }
}

/* `GetAvatars` : retourne les documents avatar dont la version est postérieure à celle détenue en session
POST:
- `token` : éléments d'authentification du compte.
- `vcompta` : version de compta qui ne doit pas avoir changé depuis le début de la phase de connexion. Si la version actuelle de compta est postérieure, le retour de `OK` est false.
- `mapv` : map des avatars à charger.
  - _clé_ : id de l'avatar, 
  - _valeur_ : version détenue en session. Ne retourner l'avatar que si sa version est plus récente que celle-ci.

Retour:
- `KO` : true si la version de compta a changé
- `rowAvatars`: array des rows des avatars dont la version est postérieure à celle indiquée en arguments.
*/
operations.GetAvatars = class GetAvatars extends Operation {
  constructor () { super('GetAvatars'); this.lecture = true }

  async phase2 (args) {
    const id = this.session.id
    const rowCompta = await this.getRowCompta(id)
    if (rowCompta.v !== args.vcompta) {
      this.setRes('KO', true)
    } else {
      for (const id in args.mapv) {
        const r = await this.getRowAvatar(parseInt(id))
        if (r && r.v > args.mapv[id]) this.addRes('rowAvatars', r)
      }
    }
  }
}

/*`GetAvatar` : retourne le row le plus récent de l'avatar 
POST:
- `token` : éléments d'authentification du compte.
- `id` : id de l'avatar

Retour:
- `rowAvatar`: row de l'avatar.

Assertion sur l'existence de l'avatar.
*/
operations.GetAvatar = class GetAvatar extends Operation {
  constructor () { super('GetAvatar') }

  async phase2 (args) {
    const rowAvatar = await this.getRowAvatar(args.id, 'GetAvatar')
    this.setRes('rowAvatar', rowAvatar)
  }
}

/* `GetTribu` : retourne le row le plus récent de la tribu
Et optionnellement déclare cette tribu comme _courante_, c'est à dire abonne la session à cette tribu (après détection d'un changement de tribu).

POST:
- `token`: éléments d'authentification du compte.
- `id` : id de la tribu.
- `setC`: si true, déclarer la tribu courante.

Retour:
- `rowtribu` : row de la tribu.

Assertion sur l'existence du rows `Tribus`.
*/
operations.GetTribu = class GetTribu extends Operation {
  constructor () { super('GetTribu'); this.lecture = true }

  async phase2 (args) {
    const rowTribu = await this.getRowTribu(args.id, 'GetTribu-1')
    this.setRes('rowTribu', rowTribu)
    if (ctx.sql && args.setC) this.session.sync.setTribuCId(args.id)
  }
}

/* `AboTribuc` : abonnement / désabonnement de la tribu courante 
POST:
- `token`: éléments d'authentification du compte.
- `id` : id de la tribu. Si 0 désabonnement.
*/
operations.AboTribuC = class AboTribuC extends Operation {
  constructor () { super('AboTribuC') }

  async phase2 (args) {
    if (ctx.sql) this.session.sync.setTribuCId(args.id)
  }
}

/* `GetGroupe` : retourne le row le plus récent du groupe 
POST:
- `token`: éléments d'authentification du compte.
- `id` : id du groupe.

Retour:
- `rowGroupe`: row du groupe.

Assertion sur l'existence du row `Groupes`.
*/
operations.GetGroupe = class GetGroupe extends Operation {
  constructor () { super('GetGroupe') }

  async phase2 (args) {
    const rowGroupe = await this.getRowGroupe(args.id, 'GetGroupe')
    this.setRes('rowGroupe', rowGroupe)
  }
}

/* *** OBOSOLETE *** `GetGroupes` : retourne les documents groupes ayant une version plus récente que celle détenue en session
POST:
- `token`: éléments d'authentification du compte.
- `mapv` : map des versions des groupes détenues en session :
  - _clé_ : id du groupe  
  - _valeur_ : version détenue en session

Retour:
- `rowGroupes` : array des rows des `Groupes` ayant une version postérieure à celle connue en session.
*/
operations.GetGroupes = class GetGroupes extends Operation {
  constructor () { super('GetGroupes'); this.lecture = true }

  async phase2 (args) {
    for (const id in args.mapv) {
      const r = await this.getRowGroupe(parseInt(id))
      if (r && r.v > args.mapv[id]) this.addRes('rowGroupes', r)
    }
  }
}

/* `ChargerNotes` : retourne les notes de l'avatar / groupe id et de version postérieure à v
POST:
- `token` : éléments d'authentification du compte.
- `id` : de l'avatar ou du groupe
- `v` : version connue en session

Retour:
- `rowNotes` : array des rows `Notes` de version postérieure à `v`.
*/
operations.ChargerNotes = class ChargerNotes extends Operation {
  constructor () { super('ChargerNotes'); this.lecture = true }

  async phase2 (args) { 
    this.setRes('rowNotes', await this.getAllRowsNote(args.id, args.v))
  }
}

/* `ChargerChats` : retourne les chats de l'avatar id et de version postérieure à v
POST:
- `token` : éléments d'authentification du compte.
- `id` : de l'avatar
- `v` : version connue en session

Retour:
- `rowChats` : array des rows `Chats` de version postérieure à `v`.
*/
operations.ChargerChats = class ChargerChats extends Operation {
  constructor () { super('ChargerChats'); this.lecture = true }

  async phase2 (args) { 
    this.setRes('rowChats', await this.getAllRowsChat(args.id, args.v))
  }
}

/* `ChargerTickets` : retourne les tickets de l'avatar id et de version postérieure à v
POST:
- `token` : éléments d'authentification du compte.
- `id` : de l'avatar
- `v` : version connue en session

Retour:
- `rowChats` : array des rows `Chats` de version postérieure à `v`.
*/
operations.ChargerTickets = class ChargerTickets extends Operation {
  constructor () { super('ChargerTickets'); this.lecture = true }

  async phase2 (args) { 
    this.setRes('rowTickets', await this.getAllRowsTicket(args.id, args.v))
  }
}

/* `ChargerSponsorings` : retourne les sponsoring de l'avatar id et de version postérieure à v
POST:
- `token` : éléments d'authentification du compte.
- `id` : de l'avatar
- `v` : version connue en session

Retour:
- `rowSponsorings` : array des rows `Sponsorings` de version postérieure à `v`.
*/
operations.ChargerSponsorings = class ChargerSponsorings extends Operation {
  constructor () { super('ChargerSponsorings'); this.lecture = true }

  async phase2 (args) { 
    this.setRes('rowSponsorings', await this.getAllRowsSponsoring(args.id, args.v))
  }
}

/* `ChargerMembres` : retourne les membres du groupe id et de version postérieure à v
POST:
- `token` : éléments d'authentification du compte.
- `id` : du groupe
- `v` : version connue en session

Retour:
- `rowMembres` : array des rows `Membres` de version postérieure à `v`.
*/
operations.ChargerMembres = class ChargerMembres extends Operation {
  constructor () { super('ChargerMembres'); this.lecture = true}

  async phase2 (args) { 
    this.setRes('rowMembres', await this.getAllRowsMembre(args.id, args.v))
  }
}

/* `ChargerGMS` : retourne le groupe id, ses membres et ses notes, de version postérieure à v
POST:
- `token` : éléments d'authentification du compte.
- `id` : du groupe
- `v` : version connue en session

Retour: 
- quand le groupe est _zombi, les row `Groupes, Membres, Notes` NE SONT PAS significatifs.
- `rowGroupe` : seulement si version postérieure à `v`. 
- `rowMembres` : array des rows `Membres` de version postérieure à `v`.
- `rowSecrets` : array des rows `Notes` de version postérieure à `v`.
- `vgroupe` : row version du groupe, possiblement _zombi.

**Remarque** : 
- Le GC PEUT avoir faire disparaître un groupe (son row `versions` est _zombi) AVANT que les listes des groupes (`lgr`) dans les rows avatars membres n'aient été mises à jour.
- Quand le groupe est _zombi, les row groupe, membres, notes NE SONT PAS retournés.
*/
operations.ChargerGMS = class ChargerGMS extends Operation {
  constructor () { super('ChargerGMS'); this.lecture = TransformStreamDefaultController }

  async phase2 (args) {
    const vgroupe = await this.getRowVersion(args.id, 'ChargerGMS')
    const vg = compile(vgroupe)
    this.setRes('vgroupe', vgroupe)
    if (!vg._zombi) {
      const rg = await this.getRowGroupe(args.id)
      if (rg.v > args.v) this.setRes('rowGroupe', rg)
      this.setRes('rowMembres', await this.getAllRowsMembre(args.id, args.v))
      this.setRes('rowNotes', await this.getAllRowsNote(args.id, args.v))
    }
  }
}

/* `ChargerTribus` : retourne les tribus de l'espace
Pour le comptable seulement

POST:
- `token` : éléments d'authentification du compte.
- `mvtr` : map des versions des tribus détenues en session
  _clé_ : id de la tribu,
  _valeur_ : version détenue en session.

Retour :
- `rowTribus`: array des rows des tribus de version postérieure à v.
- `delids` : array des ids des tribus disparues.
*/
operations.ChargerTribus = class ChargerTribus extends Operation {
  constructor () { super('ChargerTribus') }

  async phase2 (args) {
    const l = await this.getAllRowsTribu ()
    const ids = new Set()
    Object.keys(args.mvtr).forEach(i => ids.add(parseInt(i)))
    const res = []
    l.forEach(r => {
      ids.delete(r.id)
      const v = args.mvtr[r.id]
      if (!v || r.v > v) res.push(r)
    })
    this.setRes('rowTribus', res)
    this.setRes('delids', Array.from(ids))
  }
}

/* `ChargerASCS` : retourne l'avatar, ses notes, chats, tickets et sponsorings, de version postérieure à v
POST:
- `token` : éléments d'authentification du compte.
- `id` : de l'avatar.
- `v` : version connue en session.

Retour:
- `rowNotes` : arrays des rows `Notes Chats Sponsorings` de version postérieure à v
- `rowChats` :
- `rowSponsorings` : 
- `rowTickets` :
- `rowAvatar` : seulement si de version postérieure à v.
- `vavatar` : row `Versions` de l'avatar. Il PEUT être _zombi. Dans ce cas les autres rows n'ont pas de signification.

Assertion sur l'existence du row `Versions` de l'avatar.
*/
operations.ChargerASCS = class ChargerASCS extends Operation {
  constructor () { super('ChargerASCS'); this.lecture = true }

  async phase2 (args) {
    const vavatar = await this.getRowVersion(args.id, 'ChargerASCS')
    const va = compile(vavatar)
    this.setRes('vavatar', vavatar)
    if (!va._zombi) {
      const ra = await this.getRowAvatar(args.id)
      if (ra.v > args.v) this.setRes('rowAvatar', ra)
      this.setRes('rowNotes', await this.getAllRowsNote(args.id, args.v))
      this.setRes('rowSponsorings', await this.getAllRowsSponsoring(args.id, args.v))
      this.setRes('rowChats', await this.getAllRowsChat(args.id, args.v))
      if (ID.estComptable(this.session.id))
        this.setRes('rowTickets', await this.getAllRowsTicket(args.id, args.v))
    }
  }
}

/*`avGrSignatures` : obtention des groupes et avatars manquants et signatures
Signature par les `dlv` passées en arguments des row `versions` des avatars et membres (groupes en fait).

Retourne les `versions` des avatars et groupes de la session.

POST:
- `token` : éléments d'authentification du compte.
- `vcompta` : version de compta qui ne doit pas avoir changé
- `vavatar`: version de l'avatar principal du compte qui ne doit pas avoir changé
- `mbsMap` : map des membres des groupes des avatars :
  - _clé_ : id du groupe  
  - _valeur_ : `{ idg, v, npgks: [npgk], mbs: [ids], dlv }`
- `avsMap` : map des avatars du compte 
  - `clé` : id de l'avatar
  - `valeur` : `{v (version connue en session), dlv}`
- `abPlus` : array des ids des groupes auxquels s'abonner
- `estFige` : si true, ne pas effectuer les signatures

Retour:
- `KO` : true si le compta ou l'avatar principal a changé de version.
- `versions` : map pour chaque avatar / groupe :
  - _clé_ : id du groupe ou de l'avatar.
  - _valeur_ :
    - `{ v }`: pour un avatar.
    - `{ v, vols: {v1, v2, q1, q2} }` : pour un groupe.
  - `rowAvatars` : rows avatars ayant une nouvelle version sauf principal.
  - `rowGroupes`: rows groupes ayant une nouvelle version
  - `rowAvatar` : avatar principal. Si OK seule mpgk a pu avoir des items en moins (groupes disparus)
  - `rowCompta` : compta

Assertions sur les rows `Avatars (sauf le principal), Groupes (non disparus), Versions`.
*/
operations.avGrSignatures = class avGrSignatures extends Operation {
  constructor () { super('avGrSignatures'); this.lecture = false }
  /*
  this.lecture = true permet de tester this.session.estFige et de ne pas procéder aux signatures
  */

  async phase2 (args) {
    const signer = !this.session.estFige && !args.estFige
    const versions = {}
    let grDisparus = false

    /* si compta ou avatar n'existe plus, le compte n'existe plus
    si compta ou avatar ont changé de versions, recommencer la procédure de connexion */
    const rowCompta = await this.getRowCompta(this.session.id)
    if (!rowCompta) throw new AppExc(F_SRV, 101)
    const rowAvatar = await this.getRowAvatar(this.session.id)
    if (!rowAvatar) throw new AppExc(F_SRV, 101)

    if (rowAvatar.v !== args.vavatar || rowCompta.v !== args.vcompta) { 
      this.setRes('rowCompta', rowCompta)
      this.setRes('rowAvatar', rowAvatar)
      this.setRes('KO', true)
      return
    }

    const avatar = compile(rowAvatar)

    /* Traitement des avatars SAUF le principal
    Un avatar n'a pas pu disparaître:
    - si le compte a disparu, exception ci-dessus
    - si l'avatar s'est auto-résilié, l'avatar principal l'a su avant
    */
    for (const idx in args.avsMap) {
      const id = parseInt(idx)
      if (this.session.id === id) continue
      const e = args.avsMap[id]

      const row = await this.getRowAvatar(id, 'avGrSignatures-1')
      if (row.v > e.v) this.addRes('rowAvatars', row)

      const va = compile(await this.getRowVersion(id, 'avGrSignatures-2', true))
      versions[id] = { v: va.v }
      if (signer && (va.dlv < e.dlv)) { // signature de l'avatar
        va.dlv = e.dlv
        this.update(va.toRow())
      }
    }

    /* Un groupe peut DISPARAITRE par l'effet du GC (sa "versions" est _zombi), 
    sans que cette disparition n'ait encore été répercutée dans mpgk des
    avatars principaux de ses membres.
    Le compte NE PEUT PAS être hébergeur d'un compte détecté disparu,
    sinon le compte aurait lui-même disparu et on ne serait pas ici
    (ses compteurs ne sont pas impactés).
    On va mettre à jour l'avatar principal en enlevant les groupes disparus
    et le retourner en résultat.
    */
    for (const idx in args.mbsMap) {
      const id = parseInt(idx)
      const e = args.mbsMap[id]

      const vg = compile(await this.getRowVersion(id, 'avGrSignatures-3'))
      if (vg._zombi) {
        if (avatar.mpgk) 
          e.npgks.forEach(npgk => {avatar.mpgk[npgk]})
        grDisparus = true
      } else {
        versions[id] = vg
        const row = await this.getRowGroupe(id, 'avGrSignatures-4')
        if (row.v > e.v) this.addRes('rowGroupes', row)  
        for (const ids of e.mbs) {
          const r = await this.getRowMembre(e.idg, ids)
          if (r) { 
            /* normalement r existe : le membre ids du groupe correspond
            à un avatar qui l'a cité dans sa liste de groupe */
            if (signer && (r.dlv < e.dlv)) { 
              // signatures des membres: la version ne change pas (la synchro de la dlv est sans intérêt)
              const membre = compile(r)
              membre.dlv = e.dlv
              this.update(membre.toRow())
            }
          }
        }
      }
    }

    const va = compile(await this.getRowVersion(this.session.id, 'avGrSignatures-2', true))
    if (grDisparus) va.v++
    versions[this.session.id] = { v: va.v }
    const e = args.avsMap[this.session.id]
    if (signer && (va.dlv < e.dlv)) { // signature de l'avatar
      va.dlv = e.dlv
      this.update(va.toRow())
    }
    if (grDisparus) {
      avatar.v = va.v
      this.setRes('rowAvatar', this.update(avatar.toRow()))
    }

    this.setRes('versions', versions)
  }
}

/* `RetraitAccesGroupe` : retirer l'accès à un groupe pour un avatar
POST:
- `token` : éléments d'authentification du compte.
- `id` : id de l'avatar.
- `ni` : numéro d'invitation du groupe pour cet avatar.
*/
operations.RetraitAccesGroupe = class RetraitAccesGroupe extends Operation {
  constructor () { super('RetraitAccesGroupe') }

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

/* `DisparitionMembre` : enregistrement du statut disparu d'un membre dans son groupe
Après détection de la disparition d'un membre.

POST:
- `token` : éléments d'authentification du compte.
- `id` : id du groupe
- `ids` : ids du membre
*/
operations.DisparitionMembre = class DisparitionMembre extends Operation {
  constructor () { super('DisparitionMembre') }

  async phase2 (args) {
    const groupe = compile(await this.getRowGroupe(args.id))
    if (!groupe) return
    if (!groupe.ast[args.ids]) return // déjà enregistré dans le groupe
    const version = compile(await this.getRowVersion(args.id))
    if (!version || version._zombi) return
    version.v++
    groupe.v = version.v
    groupe.ast[args.ids] = 0
    this.update(groupe.toRow())
    this.update(version.toRow())
  }
}

/* `RafraichirCvs` : rafraîchir les cartes de visite, quand nécessaire
Mises à jour des cartes de visite, quand c'est nécessaire, pour tous les chats et membres de la cible.

POST:
- `token` : éléments d'authentification du compte.
- `estFige` : si true ne rien mettre à jour
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
  constructor () { super('RafraichirCvs'); this.lecture = true }

  /* this.lecture = true pour pouvoir tester this.session.estFige
  et ne pas mettre à jour les CV si l'espace est figer
  */

  async phase2 (args) {
    const maj = !args.estFige && !this.session.estFige
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

/* `MemoCompte` : changer le mémo du compte
POST:
- `token` : éléments d'authentification du compte.
- `memok` : texte du mémo crypté par la clé k

Assertion d'existence du row `Avatars` de l'avatar principal et de sa `Versions`.
*/
operations.MemoCompte = class MemoCompte extends Operation {
  constructor () { super('MemoCompte') }

  async phase2 (args) { 
    const rowAvatar = await this.getRowAvatar(this.session.id, 'MemoCompte-1')
    const rowVersion = await this.getRowVersion(this.session.id, 'MemoCompte-2', true)
    const avatar = compile(rowAvatar)
    const version = compile(rowVersion)

    version.v++
    avatar.v = version.v

    avatar.memok = args.memok

    this.update(avatar.toRow())
    this.update(version.toRow())
  }
}

/* `McMemo` : changer le mémo du compte
POST:
- `token` : éléments d'authentification du compte.
- `mmk` : mcMemo crypté par la clé k
- `idk` : id du contact / groupe crypté par la clé K

Assertion d'existence du row `Avatars` de l'avatar principal et de sa `Versions`.
*/
operations.McMemo = class McMemo extends Operation {
  constructor () { super('McMemo') }

  async phase2 (args) { 
    const rowAvatar = await this.getRowAvatar(this.session.id, 'MemoCompte-1')
    const rowVersion = await this.getRowVersion(this.session.id, 'MemoCompte-2', true)
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
  constructor () { super('MotsclesCompte') }

  async phase2 (args) { 
    const rowAvatar = await this.getRowAvatar(this.session.id, 'MotsclesCompte-1')
    const rowVersion = await this.getRowVersion(this.session.id, 'MotsclesCompte-2', true)
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
- `hps1` : dans compta, `hps1` : hash du PBKFD de l'extrait de la phrase secrète du compte.
- `shay` : SHA du SHA de X (PBKFD de la phrase secrète).
- `kx` : clé K cryptée par la phrase secrète

Assertion sur l'existence du row `Comptas` du compte.
*/
operations.ChangementPS = class ChangementPS extends Operation {
  constructor () { super('ChangementPS') }

  async phase2 (args) { 
    const compta = compile(await this.getRowCompta(this.session.id, 'ChangementPS'))
    
    compta.v++
    compta.hps1 = args.hps1
    compta.shay = args.shay
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
  constructor () { super('MajCv') }

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

/* `GetAvatarPC` : information sur l'avatar ayant une phrase de contact donnée
POST:
- `token` : éléments d'authentification du compte.
- `hpc` : hash de la phrase de contact

Retour: si trouvé,
- `cvnapc` : `{cv, napc}` si l'avatar ayant cette phrase a été trouvée.
  - `cv` : `{v, photo, info}` crypté par la clé de l'avatar.
  - `napc` : `[nom, clé]` de l'avatar crypté par le PBKFD de la phrase.
*/
operations.GetAvatarPC = class GetAvatarPC extends Operation {
  constructor () { super('GetAvatarPC') }

  async phase2 (args) {
    const avatar = compile(await this.getAvatarHpc(args.hpc))
    if (avatar) {
      this.setRes('cvnapc', { cv: avatar.cva, napc: avatar.napc } )
    }
  }
}

/* `ChangementPC` : changement de la phrase de contact d'un avatar
POST:
- `token` : éléments d'authentification du compte.
- `id` : de l'avatar.
- `hpc` : hash de la phrase de contact (SUPPRESSION si null).
- `napc` : `[nom, clé]` de l'avatar crypté par le PBKFD de la phrase.
- `pck` : phrase de contact cryptée par la clé K du compte.

Assertion sur l'existence du row `Avatars` de l'avatar et de sa `Versions`.
*/
operations.ChangementPC = class ChangementPC extends Operation {
  constructor () { super('ChangementPC') }

  async phase2 (args) { 
    if (args.hpc && await this.getAvatarHpc(args.hpc)) throw new AppExc(F_SRV, 26)

    const rowAvatar = await this.getRowAvatar(args.id, 'ChangementPC-1')
    const rowVersion = await this.getRowVersion(args.id, 'ChangementPC-2', true)
    const avatar = compile(rowAvatar)
    const version = compile(rowVersion)

    version.v++
    avatar.v = version.v

    if (args.pck) {
      avatar.hpc = args.hpc
      avatar.napc = args.napc
      avatar.pck = args.pck
    } else {
      delete avatar.hpc
      delete avatar.napc
      delete avatar.pck
    }
    this.update(avatar.toRow())
    this.update(version.toRow())
  }
}

/* `NouveauChat` : création d'un nouveau Chat
POST:
- `token` : éléments d'authentification du compte.
- `idI idsI` : id du chat, côté _interne_.
- `idE idsE` : id du chat, côté _externe_.
- `ccKI` : clé cc du chat cryptée par la clé K du compte de I.
- `ccPE` : clé cc cryptée par la clé **publique** de l'avatar E.
- `naccI` : [nomI, cleI] crypté par la clé cc
- `naccE` : [nomE, cleE] crypté par la clé cc
- `txt1` : texte 1 du chat crypté par la clé cc.
- `lgtxt1` : longueur du texte 1 du chat.
- `txt2` : texte 1 du chat crypté par la clé cc.
- `lgtxt2` : longueur du texte 1 du chat.

Retour:
- `st` : 
  0 : E a disparu. rowChat absent
  1 : chat créé avec l'item txt1. rowChat a le chat I créé avec le texte txt1.
  2 : le chat était déjà créé: rowChat est le chat I SANS le texte txt1.
- `rowChat` : row du chat I.

Assertions sur l'existence du row `Avatars` de l'avatar I, sa `Versions`, et le cas échéant la `Versions` de l'avatar E (quand il existe).
*/
operations.NouveauChat = class NouveauChat extends Operation {
  constructor () { super('NouveauChat') }

  async phase2 (args) {
    const rowChatI = await this.nvChat(args)
    if (!rowChatI) this.setRes('st', 0)
  }
}

/* `MajChat` : mise à jour d'un Chat
POST:
- `token` : éléments d'authentification du compte.
- `idI idsI` : id du chat, côté _interne_.
- `idE idsE` : id du chat, côté _externe_.
- `ccKI` : clé cc du chat cryptée par la clé K du compte de I. _Seulement_ si en session la clé cc était cryptée par la clé publique de I.
- `txt1` : texte à ajouter crypté par la clé cc du chat.
- `lgtxt1` : longueur du texte
- `dh` : date-heure du chat dont le texte est à annuler.
Retour:
- `st` :
  0 : E a disparu, chat zombi.
  1 : chat mis à jour.
- `rowChat` : row du chat I.

Assertions sur l'existence du row `Avatars` de l'avatar I, sa `Versions`, et le cas échéant la `Versions` de l'avatar E (quand il existe).
*/
operations.MajChat = class MajChat extends Operation {
  constructor () { super('MajChat') }

  async phase2 (args) {
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
      this.setRes('st', 0)
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
    if (st1 === 0) {
      // était passif, redevient actif
      chatI.st = 10 + (chatI.st % 10)
      await this.majNbChat(1)
    }
    rowChatI = this.update(chatI.toRow())
    this.setRes('rowChat', rowChatI)
 
    const itemsE = chatE.items
    if (args.txt1) {
      chatE.items = this.addChatItem(itemsE, itemE)
    } else if (args.dh) {
      chatE.items = this.razChatItem(itemsE, args.dh)
    }
    if (avatarI) {
      chatE.vcv = avatarI.vcv
      chatE.cva = avatarI.cva
    }
    this.update(chatE.toRow())
  }
}

/* `PassifChat` : rend le chat passif, nombre de chat - 1, items vidé
POST:
- `token` : éléments d'authentification du compte.
- `id ids` : id du chat

Assertions sur le row `Chats` et la `Versions` de l'avatar id.
*/
operations.PassifChat = class PassifChat extends Operation {
  constructor () { super('PassifChat') }

  async phase2 (args) { 
    const version = compile(await this.getRowVersion(args.id, 'PassifChat-1', true))
    const chat = compile(await this.getRowChat(args.id, args.ids, 'PassifChat-2'))
    version.v++
    chat.v = version.v
    const st1 = Math.floor(chat.st / 10)
    if (st1 === 1) {
      // était actif, devient passif
      chat.st = chat.st % 10
      chat.items = []
      await this.majNbChat(-1)
      this.update(chat.toRow())
      this.update(version.toRow())  
    }
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
  constructor () { super('NouvelAvatar') }

  async phase2 (args) {
    const compte = compile(await this.getRowAvatar(this.session.id, 'NouvelAvatar-1'))
    const vc = compile(await this.getRowVersion(this.session.id, 'NouvelAvatar-2'))
    vc.v++
    compte.v = vc.v
    compte.mavk[args.kx] = args.vx
    this.update(vc.toRow())
    this.update(compte.toRow())

    this.insert(args.rowVersion)
    this.insert(args.rowAvatar)
  }
}

/* `MajMavkAvatar` : mise à jour de la liste des avatars d'un compte
POST:
- `token` : éléments d'authentification du compte.
- `lp` : liste _plus_, array des entrées `[kx, vx]` à ajouter dans la liste (`mavk`) du compte.
- `lm` : liste _moins_ des entrées `[kx]` à enlever.

Assertion sur l'existence du row Comptas.
*/
operations.MajMavkAvatar = class MajMavkAvatar extends Operation {
  constructor () { super('MajMavkAvatar') }

  async phase2 (args) {
    const rowCompta = await this.getRowCompta(this.session.id, 'MajMavkAvatar')
    const compta = compile(rowCompta)
    compta.v++
    if (args.lp && args.lp.length) for(const [kx, vx] of args.lp) {
      compta.mavk[kx] = vx
    }
    if (args.lm && args.lm.length) for(const kx of args.lm) {
      delete compta.mavk[kx]
    }
    this.update(compta.toRow())
  }
}

/* `NouvelleTribu` : création d'une nouvelle tribu par le comptable
POST: 
- `token` : éléments d'authentification du comptable.
- `rowTribu` : row de la nouvelle tribu.
- `atrItem` : item à insérer dans le row Comptas du comptable en dernière position.

Assertion sur l'existence du row `Comptas` du comptable.
*/
operations.NouvelleTribu = class NouvelleTribu extends Operation {
  constructor () { super('NouvelleTribu') }

  async phase2 (args) {
    const compta = compile(await this.getRowCompta(this.session.id, 'NouvelleTribu'))
    if (compta.atr.length !== ID.court(args.rowTribu.id)) {
      this.setRes('KO', true)
      return
    }
    compta.v++
    compta.atr.push(args.atrItem)
    this.update(compta.toRow())

    const tribu = compile(args.rowTribu)
    this.insert(tribu.toRow())
    await this.MajSynthese(tribu)
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
  constructor () { super('SetNotifT') }

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
- `stn` : 0:simple 1:lecture 2:mi,imal, 9:aucune

Assertion sur l'existence du row `Tribus` de la tribu et `Comptas` du compte.
*/
operations.SetNotifC = class SetNotifC extends Operation {
  constructor () { super('SetNotifC') }

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

/* `SetAtrItemComptable` : Set des quotas OU de l'info d'une tribu
TODO : Vérifier pourquoi idc ? L'id du Comptable est déduite du ns courant ? Peut-être juste pour éviter à avaoir à calculer l'ID du comptable d'un ns sur le serveur (la méthode étant sur le client).

POST:
- `token` : éléments d'authentification du compte.
- `id` : id de la tribu
- `idc` : id du comptable
- `atrItem` : élément de `atr` `{clet, info, q}` cryptés par sa clé K.
- `quotas` : `[qc, q1, q2]` si changement des quotas, sinon null

Assertion sur l'existence des rows `Comptas` du comptable et `Tribus` de la tribu.
*/
operations.SetAtrItemComptable = class SetAtrItemComptable extends Operation {
  constructor () { super('SetAtrItemComptable') }

  async phase2 (args) {
    if (args.quotas) {
      const tribu = compile(await this.getRowTribu(args.id, 'SetAtrItemComptable-1'))
      tribu.v++
      tribu.qc = args.quotas[0]
      tribu.q1 = args.quotas[1]
      tribu.q2 = args.quotas[2]
      this.update(tribu.toRow())
      await this.MajSynthese(tribu)
    }
    const compta = compile(await this.getRowCompta(args.idc, 'SetAtrItemComptable-2'))
    compta.v++
    compta.atr[ID.court(args.id)] = args.atrItem
    this.update(compta.toRow())
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
  constructor () { super('SetSponsor') }

  async phase2 (args) {
    const compta = compile(await this.getRowCompta(args.idc, 'SetNotifC-1'))
    const tribu = compile(await this.getRowTribu(args.idt, 'SetNotifC-1'))
    tribu.v++
    const e = tribu.act[compta.it]
    if (!e || e.vide) return
    e.nasp = args.nasp
    tribu.act[compta.it] = e
    this.update(tribu.toRow())
    await this.MajSynthese(tribu)
    compta.v++
    compta.sp = args.nasp ? 1 : 0
    this.update(compta.toRow())
  }
}

/* `SetQuotas` : déclaration des quotas d'un compte par un sponsor de sa tribu
POST:
- `token` : éléments d'authentification du sponsor.
- `idc` : id du compte sponsorisé.
- `idt` : id de sa tribu.
- `[qc, q1, q2]` : ses nouveaux quotas de volume V1 et V2.

Assertion sur l'existence des rows `Comptas` du compte et `Tribus` de la tribu.
*/
operations.SetQuotas = class SetQuotas extends Operation {
  constructor () { super('SetQuotas') }

  async phase2 (args) {
    const compta = compile(await this.getRowCompta(args.idc, 'SetNotifC-1'))
    const tribu = compile(await this.getRowTribu(args.idt, 'SetNotifC-1'))
    tribu.v++
    const x = tribu.act[compta.it]
    if (!x || x.vide) return
    x.qc = args.q[0]
    x.q1 = args.q[1]
    x.q2 = args.q[2]
    this.update(tribu.toRow())
    await this.MajSynthese(tribu)
    compta.v++
    compta.qv.qc = args.q[0]
    compta.qv.q1 = args.q[1]
    compta.qv.q2 = args.q[2]
    compta.compteurs = new Compteurs(compta.compteurs, compta.qv).serial
    this.update(compta.toRow())
  }
}

/* `SetDhvuCompta` : enregistrement de la date-heure de _vue_ des notifications dans une session
POST: 
- `token` : éléments d'authentification du compte.
- `dhvu` : date-heure cryptée par la clé K.

Assertion sur l'existence du row `Comptas` du compte.
*/
operations.SetDhvuCompta = class SetDhvuCompta extends Operation {
  constructor () { super('SetDhvuCompta') }

  async phase2 (args) {
    const compta = compile(await this.getRowCompta(this.session.id, 'SetDhvuCompta'))
    compta.v++
    compta.dhvu = args.dhvu
    this.update(compta.toRow())
  }
}

/* `MajNctkCompta` : mise à jour de la tribu d'un compte 
POST: 
- `token` : éléments d'authentification du compte.
- `nctk` : `[nom, cle]` de la la tribu du compte crypté par la clé K du compte.

Assertion sur l'existence du row `Comptas` du compte.
*/
operations.MajCletKCompta = class MajCletKCompta extends Operation {
  constructor () { super('MajCletKCompta') }

  async phase2 (args) {
    const compta = compile(await this.getRowCompta(this.session.id, 'MajCletKCompta'))
    compta.v++
    compta.cletK = args.cletK
    this.update(compta.toRow())
  }
}

/* `GetCompteursCompta` : retourne les "compteurs" d'un compte
POST:
- `token` : éléments d'authentification du compte demandeur.
- `id` : id du compte dont les compteurs sont à retourner.

Retour:
- `compteurs` : objet `compteurs` enregistré dans `Comptas`.

Assertion sur l'existence du row `Comptas` du compte.
*/
operations.GetCompteursCompta = class GetCompteursCompta extends Operation {
  constructor () { super('GetCompteursCompta'); this.lecture = true }

  async phase1 (args) {
    const compta = compile(await this.getRowCompta(args.id, 'GetCompteursCompta'))
    this.setRes('compteurs', compta.compteurs)
    this.setRes('cletX', compta.cletX)
    this.setRes('it', compta.it)
    this.setRes('sp', compta.sp)
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
  constructor () { super('ChangerTribu') }

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
      q1: c.q1,
      q2: c.q2,
      v1: c.v1,
      v2: c.v2
    }
    apTribu.v++
    apTribu.act.push(e)
    const rowTribu = this.update(apTribu.toRow())
    await this.MajSynthese(apTribu)
    this.setRes('rowTribu', rowTribu)
    if (ctx.sql) this.session.sync.setTribuCId(args.idtAp)
  }
}

/* Maj de la carte de visite d'un groupe ******************************************
args.token: éléments d'authentification du compte.
args.id : id du groupe dont la Cv est mise à jour
args.v: version du groupe incluse dans la Cv. Si elle a changé sur le serveur, retour OK false (boucle sur la requête)
args.cvg: {v, photo, info} crypté par la clé du groupe
*/
operations.MajCvGr = class MajCvGr extends Operation {
  constructor () { super('MajCvGr') }

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
  constructor () { super('NouveauGroupe') }

  async phase2 (args) { 
    const groupe = compile(args.rowGroupe)
    const membre = compile(args.rowMembre)
    const version = new Versions().init(
      { id: groupe.id, v: 1, vols: { v1:0, v2: 0, q1: args.quotas[0], q2: args.quotas[1]} } )
    const versionav = compile(await this.getRowVersion(this.session.id, 'NouveauGroupe-1', true))
    const avatar = compile(await this.getRowAvatar(this.session.id, 'NouveauGroupe-2'))

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
  }
}

/* Mots clés du groupe *****************************************************
args.token donne les éléments d'authentification du compte.
args.mcg : map des mots clés cryptée par la clé du groupe
args.idg : id du groupe
Retour:
*/
operations.MotsclesGroupe = class MotsclesGroupe extends Operation {
  constructor () { super('MotsclesGroupe') }

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

/* Maj de l'ardoise d'un membre *****************************************************
args.token donne les éléments d'authentification du compte.
args.ardg : texte de l'ardoise crypté par la clé du groupe
args.idg : id du groupe
args.ids : im du membre
Retour:
*/
operations.ArdoiseMembre = class ArdoiseMembre extends Operation {
  constructor () { super('ArdoiseMembre') }

  async phase2 (args) { 
    const membre = compile(await this.getRowMembre(args.idg, args.ids, 'ArdoiseMembre-1'))
    const version = compile(await this.getRowVersion(args.idg, 'ArdoiseMembre-2', true))

    version.v++
    membre.v = version.v
    membre.ardg = args.ardg

    this.update(membre.toRow())
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
  constructor () { super('HebGroupe') }

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
        await this.diminutionVolumeCompta (this.session.id, v1, 0, 0, v2, 'HebGroupe-3')
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
        await this.augmentationVolumeCompta(this.session.id, v1, 0, 0, v2, 'HebGroupe-4')
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
args.ardg: ardoise du membre cryptée par la clé du groupe
Retour:
- disparu: true si le groupe a disparu
*/
operations.AcceptInvitation = class AcceptInvitation extends Operation {
  constructor () { super('AcceptInvitation') }

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
    const auj = ctx.auj
    const groupe = compile(await this.getRowGroupe(args.idg, 'AcceptInvitation-1'))
    const rowMembre = await this.getRowMembre(args.idg, args.ids, 'AcceptInvitation-2')
    const membre = compile(rowMembre)
    vg.v++
    groupe.v = vg.v
    membre.v = vg.v
    membre.ardg = args.ardg
    let fl = groupe.flags[args.ids]
    if (!(fl & FLAGS.IN)) throw new AppExc(F_SRV, 33) // pas invité

    // MAJ groupe et membre, et comptas (nombre de groupes)
    switch (args.cas) {
    case 1: { // acceptation
      fl |= FLAGS.AC | FLAGS.HA
      membre.fac = 0
      if (!membre.dac) membre.dac = auj
      fl &= ~FLAGS.IN
      if (args.iam && (fl & FLAGS.DM)) {
        fl |= FLAGS.AM | FLAGS.HM
        membre.fam = 0
        if (!membre.dam) membre.dam = auj
      }
      if (args.ian && (fl & FLAGS.DN)) {
        fl |= FLAGS.AN | FLAGS.HN
        membre.fln = 0
        if (!membre.dln) membre.dln = auj
      }
      if (fl & FLAGS.DE) {
        fl |= FLAGS.HE
        membre.fen = 0
        if (!membre.den) membre.den = auj
      }
      groupe.flags[args.ids] = fl
      membre.flagsiv = 0
      await this.augmentationVolumeCompta (this.session.id, 0, 0, 1, 0, 'AcceptInvitation-4')
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
      fl = 0
      groupe.nag[args.ids] = !(fl & FLAGS.HA) ? 0 : 1
      break
    }
    case 4: { // refus et oubli et liste noire
      fl = 0
      groupe.nag[args.ids] = !(fl & FLAGS.HA) ? 0 : 1
      groupe.lnc.push(args.nag)
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
      if (this.session.id === args.id) {
        if (!avatar.mpgk) avatar.mpgk = {}
        avatar.mpgk[args.npgk] = args.epgk
      } else {
        const compte = compile(await this.getRowAvatar(this.session.id, 'AcceptInvitation-5'))
        const vc = compile(await this.getRowVersion(this.session.id, 'AcceptInvitation-5'))
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

/* Fiche invitation *******************************************
args.token donne les éléments d'authentification du compte.
args.idg : id du groupe
args.ids: indice du membre invité
Retour:
- rowMembre : avec un champ supplémentaire ext : { flags, cvg, invs: map }
  invs : clé: im, valeur: { cva, nag }

*/
operations.InvitationFiche = class InvitationFiche extends Operation {
  constructor () { super('InvitationFiche') }

  async phase1 (args) { 
    const groupe = compile(await this.getRowGroupe(args.idg, 'InvitationFiche-1'))
    const membre = compile(await this.getRowMembre(args.idg, args.ids, 'InvitationFiche-1'))
    const ext = { flags: groupe.flags[args.ids], cvg: groupe.cvg, invs : {} }
    for (const im of membre.inv) {
      const m = compile(await this.getRowMembre(args.idg, im, 'InvitationFiche-1'))
      ext.invs[im] = { nag: m.nag, cva: m.cva }
    }
    membre.ext = ext
    this.setRes('rowMembre', membre.toRow())
  }
}

/* Nouveau membre (contact) *******************************************
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
args.invit: élément dans la map invits {nomg, cleg, im}` cryptée par la clé publique RSA de l'avatar.
args.ardg: ardoise du membre
Retour:
*/
operations.InvitationGroupe = class InvitationGroupe extends Operation {
  constructor () { super('InvitationGroupe') }

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
    if (f & FLAGS.AC) throw new AppExc(F_SRV, 32) // est actif

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
    case 3 : {
      if (!(f & FLAGS.IN)) throw new AppExc(F_SRV, 30) // n'était pas invité
      membre.inv = null
      membre.flagsiv = 0
      invitOK = false
      break
    }
    case 4 : {
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
    case 5 : {
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
    case 6 : {
      membre.inv = null
      membre.flagsiv = 0
      invitOK = false
      break
    }
    }
    if (invitOK) membre.ddi = ctx.auj
    membre.ardg = args.ardg
    this.update(membre.toRow())

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
  constructor () { super('NouveauMembre') }

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
  constructor () { super('MajDroitsMembre') }

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
        if (!membre.dam) membre.dam = ctx.auj
      } else membre.fam = ctx.auj
      majm = true
    }

    if (lnav !== lnap) {
      if (lnap) { 
        f |= FLAGS.HN
        if (nf & FLAGS.DE) f |= FLAGS.HE
        membre.fln = 0
        if (!membre.dln) membre.dln = ctx.auj
      } else membre.fln = ctx.auj
      majm = true
    }

    if (enav !== enap) {
      if (enap) { 
        membre.fen = 0
        if (!membre.den) membre.den = ctx.auj
      } else membre.fen = ctx.auj
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
  constructor () { super('OublierMembre') }

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
        await this.diminutionVolumeCompta (this.session.id, 0, 0, 1, 0, 'OublierMembre-4')
        const avatar = compile(await this.getRowAvatar(this.session.id, 'OublierMembre-5'))
        const va = compile(await this.getRowVersion(this.session.id, 'OublierMembre-6'))
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
        vg.dlv = ctx.auj
        majm = 2
        delgr = true
      }
    }

    if (!delgr) switch (args.cas) {
    case 1 : { // (moi) retour en simple contact
      if (!membre.fac) {
        membre.fac = ctx.auj
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
  constructor () { super('ModeSimple') }

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

/* Changement de statut d'un membre d'un groupe
args.token donne les éléments d'authentification du compte.
args.id: id du groupe 
args.ids: ids du membre cible
args.ida: id de l'avatar du membre cible
args.idc: id du COMPTE de ida, en cas de fin d'hébergement par résiliation / oubli
args.ima: ids (imdice membre) du demandeur de l'opération
args.idh: id du compte hébergeur
args.kegr: clé du membre dans lgrk. Hash du rnd inverse de l'avatar crypté par le rnd du groupe.
args.egr: élément du groupe dans lgrk de l'avatar invité 
  (invitations seulement). Crypté par la clé RSA publique de l'avatar
args.laa: 0:lecteur, 1:auteur, 2:animateur
args.ardg: ardoise du groupe cryptée par la clé du groupe. null si inchangé.
args.dlv: pour les acceptations d'invitation
args.fn: fonction à appliquer
  0 - maj de l'ardoise seulement, rien d'autre ne change
  1 - invitation
  2 - modification d'invitation
  3 - acceptation d'invitation
  4 - refus d'invitation
  5 - modification du rôle laa (actif)
  6 - résiliation
  7 - oubli
Retour: code d'anomalie
1 - situation inchangée, c'était déjà l'état actuel
2 - changement de laa impossible, membre non actif
3 - refus d'invitation impossible, le membre n'est pas invité
4 - acceptation d'invitation impossible, le membre n'est pas invité
5 - modification d'invitation impossible, le membre n'est pas invité
7 - le membre est actif, invitation impossible
8 - le membre a disparu, opération impossible
*/
operations.StatutMembre = class StatutMembre extends Operation {
  constructor () { super('StatutMembre') }

  /* Met à jour (si nécessaire) lgrk de l'avatar:
  - si del, supprime l'élément
  - sinon insère egr (clé ni) - ne met pas à jour s'il existe déjà en clé K
  */
  async updAv (del) {
    const av = compile(await this.getRowAvatar(this.args.ida, 'StatutMembre-1'))
    const va = compile(await this.getRowVersion(this.args.ida, 'StatutMembre-2', true))
    va.v++
    av.v = va.v
    let done = false
    if (!av.lgrk) av.lgrk = {}
    if (del) {
      if (av.lgrk[this.args.kegr]) {
        delete av.lgrk[this.args.kegr]
        done = true
      }
    } else {
      const x = av.lgrk[this.args.kegr]
      if (!x || (x.length === 256 && this.args.egr !== 256)) {
        av.lgrk[this.args.kegr] = this.args.egr
        done = true
      }
    }
    if (done) {
      this.update(va.toRow())
      this.update(av.toRow())
    }
  }

  /* Groupe sans membre actif - résiliation du dernier actif */
  async delGroupe () { // ICI versions dlv
    await this.updAv(true)
    // ICI versions dlv
    this.delete(this.mb.toRow())
    this.vg._zombi = true 
    this.vg.dlv = this.auj
    this.dgr = true
  }

  async invitSimple () {
    this.gr.ast[this.args.ids] = 60 + this.args.laa
    this.ugr = true
    this.mb.ddi = this.auj
    this.mb.inv = null
    this.umb = true
    await this.updAv()
  }

  async invitation () {
    if (this.cas === 6) { // déjà invité
      this.setRes('code', 1)
      return
    }  
    if (this.cas === 3) { // actif
      this.setRes('code', 1)
      return
    }  

    if (!this.gr.msu) {
      //mode simple
      await this.invitSimple()
      return
    }
    // mode unanime
    const an = new Set() // set des im des animateurs
    this.gr.ast.forEach((s, im) => {
      if (s === 32) an.add(im)
    })
    if (an.size === 1) {
      await this.invitSimple()
      return
    }

    if (this.st >= 70 && this.st <= 72) {
      if (this.st % 10 !== this.args.laa) {
        // Changt de laa, suppression des validations antérieures
        this.mb.inv = []
      } 
    }
    const s2 = new Set(this.mb.inv || [])
    s2.add(this.args.ima)
    this.mb.inv = Array.from(s2)
    // Manque-t-il des animateurs dans la liste de validation ?
    let mq = false
    an.forEach(im => { if (!s2.has(im)) mq = true })
    if (mq) {
      this.gr.ast[this.args.ids] = 70 + this.args.laa
      this.ugr = true
      this.umb = true
    } else {
      await this.invitSimple()
    }
  }

  async modifInvitation () {
    if (this.args.laa !== 9) {
      if (this.cas !== 6) {
        this.setRes('code', 4)
        return
      }  
      if (this.st % 10 !== this.args.laa) {
        this.gr.ast[this.args.ids] = 60 + this.args.laa
        this.ugr = true
      }
    } else { // laa = 9 . ANNULATION d'invitation
      if (this.cas !== 6) return
      this.gr.ast[this.args.ids] = this.mb.dfa ? 40 : 10
      this.ugr = true
      await this.updAv(true)
    }
  }

  async acceptation () {
    if (this.cas !== 6) {
      this.setRes('code', 4)
      return
    }
    this.mb.dlv = this.args.dlv
    if (!this.mb.dda) this.mb.dda = this.auj
    this.gr.ast[this.args.ids] = 30 + (this.st % 10)
    this.ugr = true
  }

  async refus () {
    if (this.cas !== 6) {
      this.setRes('code', 3)
      return
    }
    this.gr.ast[this.args.ids] = this.mb.dfa ? 40 : 10
    this.ugr = true
    await this.updAv(true)
  }

  async modifActif () {
    if (this.cas !== 3) {
      this.setRes('code', 2)
      return
    }
    if (this.st % 10 === this.args.laa) {
      this.setRes('code', 1)
      return
    }
    this.gr.ast[this.args.ids] = 30 + this.args.laa
    this.ugr = true
  }

  statsGr () {
    const r = { 
      setInv: new Set(), // set des invités
      na: 0, // nombre d'animateurs
      nm: 0 // nombre de membres actif
    }
    this.gr.ast.forEach((s, ids) => {
      if (s >= 60 && s <= 62) r.setInv.add(ids)
      if (s >= 30 && s <= 32) r.nm++
      if (s === 32) r.na++
    })
    return r
  }

  async resOubli (stats) {
    // Traitement des invités résilié / contact et de l'hébergeur
    if (this.st === 32 && stats.na === 1 && stats.setInv.size) { 
      /* résiliation du dernier animateur avec des invités
      les invités redeviennent contact ou résilié,
      ils ne peuvent plus accepter l'invitation (bof DISCUTABLE)
      */
      for (const ids of stats.setInv) {
        const mbi = compile(await this.getRowMembre(this.args.id, ids, 'StatutMembre-3'))
        this.gr.ast[ids] = mbi.dfa ? 50 : 10
      }
    }

    if (this.mb.ids === this.gr.imh) {
      /* résiliation de l'hébergeur : rendu du volume à son compte */
      const dv1 = this.vg.vols.v1
      const dv2 = this.vg.vols.v2
      await this.diminutionVolumeCompta (this.args.idh, dv1, 0, 0, dv2, 'StatutMembre-4')
    }
  }

  async resiliation () {
    switch (this.cas) {
    case 5:
    case 4:
    case 1:
    case 0: { // résiliation ne changeant rien
      break
    }
    case 3: { // fin d'activité
      const stats = this.statsGr()

      await this.resOubli(stats)

      if (stats.nm > 1) {
        this.mb.dfa = this.auj
        this.gr.ast[this.args.ids] = 50
        this.ugr = true
        this.umb = true
        await this.updAv(true)
      } else {
        await this.delGroupe()
      }
      break
    }
    case 6: { // traité comme annulation d'invitation
      this.gr.ast[this.args.ids] = this.mb.dfa ? 50 : 10
      this.ugr = true
      this.mb.inv = null
      this.umb = true
      await this.updAv(true)
      break
    }
    case 7: { // retour à l'état avant pré-invitation
      this.gr.ast[this.args.ids] = this.dfa ? 50 : (this.mb.ddi ? 40 : 10)
      this.ugr = true
      this.mb.inv = null
      this.umb = true
      break
    }
    }
  }

  async oubli () {
    this.gr.ast[this.args.ids] = 0
    const stats = this.statsGr()
    await this.resOubli(stats)
    if (stats.nm === 0) {
      // oubli du dernier membre actif, suppression du groupe
      await this.delGroupe()
    } else {
      this.ugr = true
      this.delete(this.mb.toRow())
      await this.updAv(true)  
    }
  }

  async phase2 (args) {
    this.auj = Date.now()
    this.umb = false
    this.ugr = false
    this.dgr = false
    this.gr = compile(await this.getRowGroupe(args.id))
    if (!this.gr) {
      if (args.fn === 7) {
        this.setRes('code', 1)
        return
      } else throw new AppExc(A_SRV, 9, [args.id])
    }
    this.st = this.gr.ast[args.ids]
    this.cas = Math.floor(this.st / 10)
    if (this.cas === 0 && args.fn !== 7) {
      this.setRes('code', 8)
      return
    }

    this.mb = compile(await this.getRowMembre(args.id, args.ids))
    if (!this.mb) {
      if (args.fn === 7 && this.st === 0) {
        this.setRes('code', 1)
        return
      } else throw new AppExc(A_SRV, 10, [args.id, args.ids])
    }
    this.vg = compile(await this.getRowVersion(args.id, 'StatutMembre-5', true))
    this.vg.v++
    this.gr.v = this.vg.v
    this.mb.v = this.vg.v

    switch (args.fn) {
    case 1: { await this.invitation(); break }
    case 2: { await this.modifInvitation(); break }
    case 3: { await this.acceptation(); break }
    case 4: { await this.refus(); break }
    case 5: { await this.modifActif(); break }
    case 6: { await this.resiliation(); break }
    case 7: { await this.oubli(); break }
    }

    if (args.ardg) {
      this.gr.ardg = args.ardg
      this.ugr = true
    }

    if (this.umb || this.ugr || this.dgr) this.update(this.vg.toRow())
    if (this.umb) this.update(this.mb.toRow())
    if (this.ugr) this.update(this.gr.toRow())
  }
}

/* Nouvelle Note *************************************************
args.token: éléments d'authentification du compte.
args.rowNote : row de la note
args.idc: id du compte (note avatar) ou de l'hébergeur (note groupe)
Retour: rien
*/
operations.NouvelleNote = class NouvelleNote extends Operation {
  constructor () { super('NouvelleNote') }

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
  constructor () { super('MajNote') }

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

/* Note temporaire / permanente *************************************************
args.token: éléments d'authentification du compte.
args.id ids: identifiant de la note
args.p : 0 / 1
Retour: rien
*/
operations.ProtNote = class ProtNote extends Operation {
  constructor () { super('ProtNote') }

  async phase2 (args) { 
    const note = compile(await this.getRowNote(args.id, args.ids, 'ProtNote-1'))
    const v = compile(await this.getRowVersion(note.id, 'ProtNote-2', true))
    v.v++
    this.update(v.toRow())
    note.p = args.p
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
  constructor () { super('ExcluNote') }

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
  constructor () { super('McNote') }

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
  constructor () { super('RattNote') }

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
  constructor () { super('SupprNote') }

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
        await ctx.storage.delFiles(org, idi, this.lidf)
        await this.unsetFpurge(this.idfp)
      }
    } catch (e) { 
      // trace
    }
  }
}

/* Charger les CVs dont les versions sont postérieures à celles détenues en session ******
args.token: éléments d'authentification du compte.
args.mcv : cle: id, valeur: version détenue en session (ou 0)
Retour:
rowCvs: liste des row Cv { _nom: 'cvs', id, _data_ }
  _data_ : cva {v, photo, info} cryptée par la clé de son avatar
*/
operations.ChargerCvs = class ChargerCvs extends Operation {
  constructor () { super('ChargerCvs'); this.lecture = true }

  async phase2 (args) { 
    for (const idx in args.mcv) {
      const id = parseInt(idx)
      const vcv = args.mcv[idx]
      const avatar = await this.getAvatarVCV(id, vcv)
      if (avatar) {
        const _data_ = new Uint8Array(Buffer.from(encode({ cva: avatar.cva })))
        this.addRes('rowCvs', { _nom: 'cvs', id, _data_ })
      }
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
  constructor () { super('GetUrl'); this.lecture = true }

  async phase1 (args) {
    const org = await this.org(ID.ns(args.id))
    const idi = args.id % d14
    const url = await ctx.storage.getUrl(org, idi, args.idf)
    this.setRes('getUrl', url)
  }
}

/* Put URL ****************************************
args.token: éléments d'authentification du compte.
args.id : id de la note
args.idh : id de l'hébergeur pour une note groupe
args.dv2 : variation de volume v2
args.idf : identifiant du fichier
Retour:
- url : url à passer sur le PUT de son contenu
*/
operations.PutUrl = class PutUrl extends Operation {
  constructor () { super('PutUrl') }

  async phase2 (args) {
    if (args.dv2 > 0) {
      if (ID.estGroupe(args.id)) {
        // Pour provoquer une exception de dépassement éventuel
        await this.majVolumeGr (args.id, 0, args.dv2, false, 'PutUrl-2')
      }
      const h = compile(await this.getRowCompta(args.idh, 'PutUrl-1'))
      const c = decode(h.compteurs)
      const d = c.v2 + args.dv2
      const q = c.q2 * UNITEV2
      if (d > q)
        throw new AppExc(F_SRV, 56, [edvol(d), edvol(q)])
    }

    const org = await this.org(ID.ns(args.id))
    const idi = args.id % d14
    const url = await ctx.storage.putUrl(org, idi, args.idf)
    this.setRes('putUrl', url)
    const dlv = AMJ.amjUtcPlusNbj(ctx.auj, 5)
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
  constructor () { super('ValiderUpload') }

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
    h.qv.v2 += dv2
    const q = h.qv.q2 * UNITEV2
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
      await ctx.storage.delFiles(org, idi, args.lidf)
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
  constructor () { super('SupprFichier') }

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
    h.qv.v2 += dv2
    const q = h.qv.q2 * UNITEV2
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
      await ctx.storage.delFiles(org, idi, [args.idf])
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
  constructor () { super('SupprAvatar') }

  async phase2 (args) { 
    const estCpt = args.id === args.idc
    const vgroupes = {}

    for (const it of args.grps) {
      const vg = await this.getRowVersion(it.idg, 'SupprAvatar-1')
      if (vg._zombi || (vg.v !== it.vg)) { 
        this.setRes('KO', false); return 
      }
      vgroupes[it.idg] = vg
    }

    // résiliation de l'avatar par sa 'versions' (s'il ne l'était pas déjà)
    // ICI versions dlv
    const va = compile(await this.getRowVersion(args.id, 'SupprAvatar-6'))
    if (!va._zombi) {
      va.version++
      va.dlv = ctx.auj
      va._zombi = true
      this.update(va.toRow())
    }
    
    if (estCpt) {
      this.delete(await this.getRowCompta(args.idc, 'SupprAvatar-2'))
      // suppression de l'entrée du compte dans tribu
      const tribu = compile(await this.getRowTribu(args.idt, 'SupprAvatar-3'))
      delete tribu.act[args.it]
      tribu.v++
      await this.MajSynthese(tribu)
      this.update(tribu.row())
    } else {
      await this.diminutionVolumeCompta(args.idc, args.dnn, args.dnc, args.dng, args.dv2, 'SupprAvatar-9')
    }
  
    // MAJ des chats "externes"
    for (const it of args.chats) {
      const [idE, idsE] = it
      const chatE = compile(await this.getRowChat(idE, idsE))
      if (chatE) {
        const vchatE = compile(await this.getRowVersion(idE, 'SupprAvatar-4'), true)
        vchatE.v++
        chatE.v = vchatE.v
        chatE.st = 1
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
          vgroupe.dlv = ctx.auj
          vgroupe._zombi = true
        } else {
          this.delete({ _nom: 'membres', id: it.idg, ids: it.im })
          const groupe = compile(await this.getRowGroupe(it.idg, 'SupprAvatar-5'))
          groupe.v = vgroupe.v
          groupe.ast[it.im] = 0
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

/* Retourne la liste des gcvols de l'espace 
args.token: éléments d'authentification du compte.
*/
operations.ListeGcvols = class ListeGcvols extends Operation {
  constructor () { super('ListeGcvols')  }

  async phase1() {
    const ns = ID.ns(this.session.id)
    const l = await this.getGcvols(ns)
    this.setRes('gcvols', l)
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
  constructor () { super('SupprComptesTribu') }

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
*/
operations.ForceDlv = class ForceDlv extends Operation {
  constructor () { super('ForceDlv'); this.authMode = 3  }

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

/*****************************************************************************
 * GC
 *****************************************************************************/
/* GC général enchaînant les étapes de GC spécécifiques
Appel depuis une requête (pas d'attente du résultat)
*/
operations.GC = class GC extends Operation {
  constructor () { super('GC'); this.authMode = 3  }

  async phase1() {
    setTimeout(async () => {
      const op = operations.GCGen
      await new op().run()
    }, 50)
  }
}

/* GC général enchaînant les étapes de GC spécifiques
*/
operations.GCGen = class GCGen extends Operation {
  constructor () { super('GCGen'); this.authMode = 3  }

  static nr = 1 // 2 en prod

  static att = [0, 60000, 300000] // attentes avec un retry

  async step (nom) {
    let n = 0
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const start = Date.now()
      const op = operations[nom]
      let ret
      try {
        ret = await new op().run()
      } catch (e) {
        // trace
        const info = e.toString()
        const msg = trace('GCGen-ER1-' + nom, 0, info, true)
        ret = { err: msg }
      }
      const ckpt = await this.getCheckpoint()
      const log = { 
        nom: nom,
        start: start,
        duree: Date.now() - start,
        stats: ret.stats
      }
      if (n) log.retry = n
      if (ret.err) {
        log.err = ret.err
      } else {
        ckpt.nbTaches++
      }
      ckpt.log.push(log)
      await this.setCheckpoint(ckpt)

      if (ret.err) {
        trace('GCGen-ER2-' + nom, 0, ret.err, true)
        n++
        if (n === GCGen.nr) return false
        await sleep(GCGen.att[n])
      } else {
        return true
      }
    }
  }

  async phase1 () {
    {
      const ckpt = await this.getCheckpoint()
      const start = Date.now()
      ckpt.dhStart = start
      ckpt.log = []
      ckpt.nbTaches = 0
      await this.setCheckpoint(ckpt)
    }

    // Récupération des fin d'hébergement
    if (!await this.step('GCHeb')) return

    // Récupération des membres disparus et des groupes devenant orphelins
    if (!await this.step('GCGro')) return

    // Purge des avatars et groupes
    if (!await this.step('GCPag')) return

    // Purge des fichiers (et des transferts) des transferts abandonnés
    if (!await this.step('GCTra')) return

    // purges des fichiers détruits accumulés dans fpurges
    if (!await this.step('GCFpu')) return

    // purges des versions ayant une dlv de plus d'un an
    // purges des sponsorings hor date
    if (!await this.step('GCDlv')) return

    {
      const ckpt = await this.getCheckpoint()
      ckpt.duree = Date.now() - ckpt.dhStart
      await this.setCheckpoint(ckpt)
      // trace de chkpt en JSON
      const info = JSON.stringify(ckpt)
      trace('GCGen-OK', 0, info)
    }

  }
}

/* Pour admin : retourne le dernier checkpoint écrit *************/
operations.GetCheckpoint = class GetCheckpoint extends Operation {
  constructor () { super('GetCheckpoint'); this.authMode = 3  }

  async phase1() {
    const ckpt = await this.getCheckpoint()
    this.setRes('checkpoint', ckpt)
  }
}

/* GCHeb : Traitement des fins d'hébergement ***********************************
L'opération récupère toutes les ids des document groupe où 
dfh est inférieure ou égale au jour courant.

Une transaction par groupe :
- dans le document version du groupe, dlv est positionnée à auj et zombi
*/
operations.GCHeb = class GCHeb extends Operation {
  constructor () { super('GCHeb'); this.authMode = 3  }

  async phase1 () {
    const stats = { nh: 0 }
    try {
      const auj = AMJ.amjUtc()

      const hb = await this.getGroupesDfh(auj)
      for (const id of hb) {
        try {
          await new operations.GCHebtr().run({id: id, dlv: auj})
          stats.nh++
        } catch (e) {
          // trace
          const info = e.toString()
          const msg = trace('GCHeb-ER2' , id, info, true)
          this.setRes('err', { err: msg })
          break
        }
      }
      this.setRes('stats', stats)
    } catch (e) {
      // trace
      this.setRes('stats', stats)
      const info = e.toString()
      const msg = trace('GCHeb-ER1' , 0, info, true)
      this.setRes('err', { err: msg })
    }
  }
}

operations.GCHebtr = class GCHebtr extends Operation {
  constructor () { super('GCHebtr'); this.authMode = 3  }

  async phase2 (args) {
    const idg = args.id
    const dlv = args.dlv
    const vg = compile(await this.getRowVersion(idg))
    if (vg && !vg._zombi) { // ICI versions dlv
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
  constructor () { super('GCGro'); this.authMode = 3  }

  async phase1 () {
    const stats = { nm: 0, ng: 0 }
    try {
      const auj = AMJ.amjUtc()

      const lmb = await this.getMembresDlv(auj)
      const lgr = new Map()
      for (const [id, ids] of lmb) {
        let a = lgr.get(id)
        if (!a) { a = []; lgr.set(id, a) }
        a.push(ids)
      }
      for (const [id, a] of lgr) {
        try {
          await new operations.GCGrotr().run({id, a, dlv: auj})
          stats.ng++
          stats.nm += a.length
        } catch (e) {
          // trace
          const info = e.toString()
          const msg = trace('GCGro-ER2' , id, info, true)
          this.setRes('err', { err: msg })
          break
        }
      }
      this.setRes('stats', stats)
    } catch (e) {
      // trace
      this.setRes('stats', stats)
      const info = e.toString()
      const msg = trace('GCHeb-ER1' , 0, info, true)
      this.setRes('err', { err: msg })
    }
  }
}

operations.GCGrotr = class GCGrotr extends Operation {
  constructor () { super('GCGrotr'); this.authMode = 3  }

  async phase2 (args) {
    const idg = args.id // id du groupe
    const dlv = args.dlv // dlv en cas de suppression du groupe
    const a = args.a // liste des membres disparus

    const vg = compile(await this.getRowVersion(idg))
    const groupe = compile(await this.getRowGroupe(idg))
    if (!vg || vg._zombi || !groupe) return
    vg.v++

    let nba = 0
    try {
      for (const im of a) {
        groupe.ast[im] = 0
        this.delete( { _nom: 'membres', id: idg, ids: im })
      }
      groupe.ast.forEach(s => { if (s >= 30 && s <= 32) nba++ })
    } catch (e) {
      // trace : données groupe inconstante
      // mais par prudence on détruit le grope
      const info = 'rowGroupe inconsistent (ast(?)'
      trace('GCResmb-AL1' , idg, info)
      nba = 0
    }

    if (nba) { // Il reste des membres actifs
      groupe.v = vg.v
      this.update(groupe.toRow())
    } else { // le groupe est à purger
      vg.dlv = dlv // ICI versions dlv
      vg._zombi = true
    }
    this.update(vg.toRow())
  }
}

/* GCPag : Purge des sous-collections d'avatars et de groupes ***********
L'opération récupère toutes les `id` des `versions` dont la `dlv` 
est postérieure auj - 365 et antérieure ou égale à auj.
Dans l'ordre pour chaque id:
- par compte, une transaction de récupération du volume 
(si `comptas` existe encore, sinon c'est que ça a déjà été fait),
- purge de leurs sous-collections,
- purge de leur avatar / groupe,
- purge de leurs fichiers,
- set HORS TRANSACTION de la `dlv` de la `versions` à auj-800
*/
operations.GCPag = class GCPag extends Operation {
  constructor () { super('GCPag'); this.authMode = 3  }

  async phase1 () {
    const st = { na: 0, ng: 0, nn: 0, nc: 0, ns: 0, nt: 0, nm: 0 }
    let idref = 0
    try {
      const auj = AMJ.amjUtc()
      const min = AMJ.amjUtcPlusNbj(auj, -limitesjour.dlv)

      this.lids = await this.getVersionsDlv(min, auj)

      for (const id of this.lids) {
        idref = id
        const estG = ID.estGroupe(id)
        if (estG) {
          st.ng++
          st.nn += await this.delScoll('notes', id)
          st.nm += await this.delScoll('membres', id)
          st.nt += await this.delScoll('transferts', id)
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
        await ctx.storage.delId(org, idi)
        this.setRes('stats', st)

        // validation des purges
        const dlv = AMJ.amjUtcPlusNbj(auj, -(2 * limitesjour.dlv))
        await this.setVdlv(id, dlv)

      }
      this.setRes('stats', st)
    } catch (e) {
      this.setRes('stats', st)
      // trace
      const info = e.toStriong()
      const msg = trace('GCPag-ER1' , idref, info)
      this.setRes('err', msg)
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
  constructor () { super('GCPagtr'); this.authMode = 3  }

  async phase2 (args) {
    const id = args.id

    const rowCompta = await this.getRowCompta(id)
    if (rowCompta) {
      try {
        const compta = compile(rowCompta)
        const gcvol = new Gcvols().init({
          id: id,
          cletX: compta.cletX,
          it: compta.it
        })
        this.insert(gcvol.toRow())
        this.delete(rowCompta)
      } catch (e) {
        // volumes non récupérés pour données inconsistantes : ignorer
        // trace
        const info = e.toStriong()
        trace('GCResco-AL1' , args.id, info)
      }
    }
  }
}

/* GCFpu : purges des fichiers
L'opération récupère tous les items d'id de fichiers 
depuis `fpurges` et déclenche une purge sur le Storage.
Les documents `fpurges` sont purgés.
*/
operations.GCFpu = class GCFpu extends Operation {
  constructor () { super('GCFpu'); this.authMode = 3  }

  async phase1 () {
    try {
      const lst = await this.listeFpurges()
      let n = 0
      for (const fpurge of lst) {
        if (fpurge.id && fpurge.idag && fpurge.lidf) {
          const idref = fpurge.id + '/' + fpurge.idag
          n += fpurge.lidf.length
          try {
            const org = await this.org(ID.ns(fpurge.idag))
            const idi = fpurge.idag % d14   
            await ctx.storage.delFiles(org, idi, fpurge.lidf)
            await this.unsetFpurge(fpurge.id)
          } catch (e) {
            // trace
            const info = e.toString()
            const msg = trace('GCFpu-ER2' , idref, info, true)
            this.setRes('err', msg)
            return
          }
        }
      }
      this.setRes('stats', { nbf: n })
    } catch (e) {
      // trace
      const info = e.toString()
      const msg = trace('GCFpu-ER1' , 0, info, true)
      this.setRes('err', { err: msg })
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
  constructor () { super('GCTra'); this.authMode = 3  }

  async phase1 () {
    try {
      const lst = await this.listeTransfertsDlv(ctx.auj)

      for (const [id, idf] of lst) {
        if (id && idf) {
          const idref = id + '/' + idf
          try {
            const ns = ID.ns(id)
            const org = await this.org(ns)
            const idi = id % d14        
            await ctx.storage.delFiles(org, idi, [idf])
            await this.purgeTransferts(id, idf)
          } catch (e) {
            // trace
            const info = e.toString()
            const msg = trace('GCTra-ER2' , idref, info, true)
            this.setRes('err', { err: msg })
            return
          }
        }
      }
      this.setRes('stats', { nbt: lst.length })
    } catch (e) {
      // trace
      const info = e.toString()
      const msg = trace('GCTra-ER1' , 0, info, true)
      this.setRes('err', { err: msg })
    }
  }
}

/* GCDlv : purge des sponsorings et versions obsolètes
L'opération récupère toutes les versions de `dlv` antérieures 
à jour j - 800. Ces documents sont purgés.

L'opération récupère toutes les documents `sponsorings` 
dont les `dlv` sont antérieures ou égales à aujourd'hui. 
Ces documents sont purgés.
*/
operations.GCDlv = class GCDlv extends Operation {
  constructor () { super('GCGCDlvTra'); this.authMode = 3  }

  async phase1 () {
    let nom = 'sponsorings'
    try {
      const nbs = await this.purgeDlv(nom, ctx.auj)

      nom = 'versions'
      const dlv = AMJ.amjUtcPlusNbj(ctx.auj, - (2 * limitesjour.dlv))
      const nbv = await this.purgeDlv(nom, dlv)

      this.setRes('stats', { nbs, nbv })
    } catch (e) {
      // trace
      const info = e.toString()
      const msg = trace('GCGDlv-ER1-' + nom , 0, info, true)
      this.setRes('err', { err: msg })
    }
  }
}
