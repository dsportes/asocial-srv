/* Opérations de lecture */

import { ID } from './api.mjs'
import { encode } from '@msgpack/msgpack'
import { config } from './config.mjs'
import { operations } from './cfgexpress.mjs'

import { Operation } from './modele.mjs'
import { compile } from './gendoc.mjs'

// Pour forcer l'importation des opérations
export function load2 () {
  if (config.modebug) config.logger.debug('Operations2: ' + operations.auj)
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
  constructor (nom) { super(nom, 4) }

  /* Si ce n'est pas une session admin, id != 0
    auth() a accédé à this.compta par la clé hps1 du token, ce qui a enregistré son id 
    comme id du compte dans this.session.id
  */

  async phase2 () {
    this.db.setSyncData(this)

    if (!this.id) {
      this.setRes('admin', true)
      this.setRes('espaces', await this.getAllRowsEspace())
    } else {
      this.setRes('rowCompta', this.compta.toRow())
      const rowAvatar = await this.getRowAvatar(this.id, 'ConnexionCompte-2')
      this.setRes('rowAvatar', rowAvatar)
      const rowEspace = await this.getRowEspace(this.ns, 'ConnexionCompte-3')
      this.setRes('rowEspace', rowEspace)
    }
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
  constructor (nom) { super(nom, 1); this.phase2 = null }
}

/* `RafraichirTickets` : nouvelles versions des tickets cités
POST:
- `token` : jeton d'authentification du compte
- `mtk` : map des tickets. clé: ids, valeur: version détenue en session

Retour: 
- rowTickets: liste des rows des tickets ayant changé
*/
operations.RafraichirTickets = class RafraichirTickets extends Operation {
  constructor (nom) { super(nom, 1) }

  async phase2(args) {
    const idc = ID.duComptable(this.ns)
    for (const idss in args.mtk) {
      const ids = parseInt(idss)
      const v = args.mtk[idss]
      const rowTicket = await this.getRowTicketV(idc, ids, v)
      if (rowTicket) this.addRes('rowTickets', rowTicket)
    }
  }
}

/* Fiche invitation *******************************************
args.token donne les éléments d'authentification du compte.
args.idg : id du groupe
args.ids: indice du membre invité
args.ivpar : indice du membre invitant
args.dh: date-heure de l'item de chat d'invitation
Retour:
- rowMembre : avec un champ supplémentaire ext : { flags, cvg, invs: map, chatg }
  chatg: texte du chat crypté par la clé du groupe
  invs : clé: im, valeur: { cva, nag }
*/
operations.InvitationFiche = class InvitationFiche extends Operation {
  constructor (nom) { super(nom, 1) }

  async phase2 (args) { 
    const groupe = compile(await this.getRowGroupe(args.idg, 'InvitationFiche-1'))
    const membre = compile(await this.getRowMembre(args.idg, args.ids, 'InvitationFiche-2'))
    const ext = { flags: groupe.flags[args.ids], cvg: groupe.cvg, invs : {} }
    for (const im of membre.inv) {
      const m = compile(await this.getRowMembre(args.idg, im, 'InvitationFiche-3'))
      ext.invs[im] = { nag: m.nag, cva: m.cva }
    }
    ext.chatg = null
    if (args.ivpar) {
      const chatgr = compile(await this.getRowChatgr(args.idg, 'InvitationFiche-4'))
      if (chatgr) {
        for (let i = 0; i < chatgr.items.length; i++) {
          const it = chatgr.items[i]
          if (it.im === args.ivpar && it.dh === args.dh) { ext.chatg = it.t; break }
        }
      }
    }
    membre.ext = ext
    this.setRes('rowMembre', membre.toRow())
  }
}

/* Charger la CV dont la version est postérieure à celle détenue en session ******
args.token: éléments d'authentification du compte.
args.mcv : cle: id, valeur: version détenue en session (ou 0)
Retour:
rowCvs: liste des row Cv { _nom: 'cvs', id, _data_ }
  _data_ : cva {v, photo, info} cryptée par la clé de son avatar
*/
operations.ChargerCvs = class ChargerCvs extends Operation {
  constructor (nom) { super(nom, 1) }

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

/* Retourne la liste des gcvols de l'espace 
args.token: éléments d'authentification du compte.
*/
operations.ListeGcvols = class ListeGcvols extends Operation {
  constructor (nom) { super(nom, 1)  }

  async phase2() {
    const l = await this.getGcvols(this.ns)
    this.setRes('gcvols', l)
  }
}
