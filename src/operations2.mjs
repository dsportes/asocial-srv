/* Opérations de lecture */

import { ID } from './api.mjs'
import { encode } from '@msgpack/msgpack'
import { config } from './config.mjs'
import { operations } from './cfgexpress.mjs'

import { Operation } from './modele.mjs'
import { compile } from './gendoc.mjs'
import { FLAGS } from './api.mjs'

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

/* `EstAutonome` : indique si l'avatar donné en argument est 
l'avatar principal d'un compte autonome
POST:
- `token` : jeton d'authentification du compte 
- `id` : id de l'avatar

Retour: 
- `st`: 
  - 0 : pas avatar principal 
  - 1 : avatar principal d'un compte A
  - 2 : avatar principal d'un compte O
*/
operations.EstAutonome = class EstAutonome extends Operation {
  constructor (nom) { super(nom, 1) }

  async phase2(args) {
    const compta = compile(await this.getRowCompta(args.id))
    if (!compta || !compta.mvk) { this.setRes('st', 0) }
    this.setRes('st', compta.it ? 2 : 1)
  }
}

/* `GetEspace` : get d'un espace par son ns
POST:
- `ns` : id de l'espace.

Retour:
- `rowEspace`

Assertion sur l'existence du row Espace.
*/
operations.GetEspace = class GetEspace extends Operation {
  constructor (nom) { super(nom, 0) }

  async phase2 (args) {
    const rowEspace = await this.getRowEspace(args.ns, 'GetEspace')
    this.setRes('rowEspace', rowEspace)
  }
}

/* `GetSynthese` : retourne la synthèse de l'espace ns
POST:
- `token` : éléments d'authentification du compte.
- `ns` : id de l'espace.

Retour:
- `rowSynthese`

Assertion sur l'existence du row `Syntheses`.
*/
operations.GetSynthese = class GetSynthese extends Operation {
  constructor (nom) { super(nom, 1) }

  async phase2 (args) {
    const rowSynthese = await this.getRowSynthese(args.ns, 'GetSynthese')
    this.setRes('rowSynthese', rowSynthese)
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
  constructor (nom) { super(nom, 1)}

  async phase2 (args) {
    const rowAvatar = await this.getRowAvatar(this.id, 'Synchroniser-1')
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
        for (const row of await this.getAllRowsChatgr(id, vx))
          this.addRes('rowChatgrs', row)
      }
    }
  }
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
  constructor (nom) { super(nom, 1) }

  async phase2 (args) {
    if (this.compta.v !== args.vcompta) {
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
- `token`: éléments d'authentification du compte.
- `id` : id de l'avatar
Retour:
- `rowAvatar`: row de l'avatar.

Assertion sur l'existence de l'avatar.
*/
operations.GetAvatar = class GetAvatar extends Operation {
  constructor (nom) { super(nom, 1) }

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
  constructor (nom) { super(nom, 1) }

  async phase2 (args) {
    const rowTribu = await this.getRowTribu(args.id, 'GetTribu-1')
    this.setRes('rowTribu', rowTribu)
    if (this.sync && args.setC) this.sync.setTribuCId(args.id)
  }
}

/* `AboTribuc` : abonnement / désabonnement de la tribu courante 
POST:
- `token`: éléments d'authentification du compte.
- `id` : id de la tribu. Si 0 désabonnement.
*/
operations.AboTribuC = class AboTribuC extends Operation {
  constructor (nom) { super(nom, 1) }

  async phase2 (args) {
    if (this.sync) this.sync.setTribuCId(args.id)
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
  constructor (nom) { super(nom, 1) }

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
  constructor (nom) { super(nom, 1) }

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
  constructor (nom) { super(nom, 1) }

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
  constructor (nom) { super(nom, 1) }

  async phase2 (args) { 
    this.setRes('rowSponsorings', await this.getAllRowsSponsoring(args.id, args.v))
  }
}

/* `chargerMembresChatgrs` : retourne les membres du groupe id et de version postérieure à v
POST:
- `token` : éléments d'authentification du compte.
- `id` : du groupe
- `v` : version connue en session

Retour:
- `rowMembres` : array des rows `Membres` de version postérieure à `v`.
*/
operations.ChargerMembresChatgrs = class ChargerMembresChatgrs extends Operation {
  constructor (nom) { super(nom, 1)}

  async phase2 (args) { 
    this.setRes('rowMembres', await this.getAllRowsMembre(args.id, args.v))
    const rch = await this.getAllRowsChatgr(args.id, args.v)
    if (rch.length === 1) this.setRes('rowChatgr', rch[0])
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
  constructor (nom) { super(nom, 1) }

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
  constructor (nom) { super(nom, 1) }

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
  constructor (nom) { super(nom, 1) }

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
      if (ID.estComptable(this.id))
        this.setRes('rowTickets', await this.getAllRowsTicket(args.id, args.v))
    }
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
  constructor (nom) { super(nom, 1); }

  async phase2 (args) {
    const compta = compile(await this.getRowCompta(args.id, 'GetCompteursCompta'))
    this.setRes('compteurs', compta.compteurs)
    this.setRes('cletX', compta.cletX)
    this.setRes('it', compta.it)
    this.setRes('sp', compta.sp)
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
