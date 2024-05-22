import { AppExc, F_SRV, A_SRV, ID, d14, V99 } from './api.mjs'
import { config } from './config.mjs'
import { operations } from './cfgexpress.mjs'
import { sleep, crypterSrv } from './util.mjs'

import { Operation, Cache, Esp } from './modele.mjs'
import { compile } from './gendoc.mjs'
import { DataSync } from './api.mjs'

// Pour forcer l'importation des opérations
export function load3 () {
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
    id estA sync (ou null) notifs 
    compte compta espace partition (si c'est un compte O)
*/

/*******************************************************************************
* Opérations SANS connexion NI contrôle de l'espace
*******************************************************************************/

/** Echo du texte envoyé ***************************************
args.to : délai en secondes avant retour de la réponse
args.texte : texte à renvoyer en écho OU en détail de l'erreur fonctionnelle testée
Retour:
- echo : texte d'entrée retourné
*/
operations.EchoTexte = class EchoTexte extends Operation {
  constructor (nom) { super(nom, 0); this.SYS = true }

  async phase2(args) {
    if (args.to) await sleep(args.to * 1000)
    this.setRes('echo', args.texte)
  }
}

/** Erreur fonctionnelle simulée du texte envoyé ***************************************
args.to : délai en secondes avant retour de la réponse
args.texte : détail de l'erreur fonctionnelle testée
Exception
*/
operations.ErreurFonc = class ErreurFonc extends Operation {
  constructor (nom) { super(nom, 0); this.SYS = true }

  async phase2(args) {
    if (args.to) await sleep(args.to * 1000)
    throw new AppExc(F_SRV, 10, [args.texte])
  }
}

/** Test d'accès à la base ***************************************
GET
Retourne les date-heures de derniers ping (le précédent et celui posé)
*/
operations.PingDB = class PingDB extends Operation {
  constructor (nom) { super(nom, 0); this.SYS = true }

  async phase2() {
    this.result.type = 'text/plain'
    this.result.bytes = await this.db.ping()
  }
}

/* GetEspaces : pour admin seulement, retourne tous les rows espaces
- `token` : éléments d'authentification du compte.
Retour:
- espaces : array de row espaces
*/
operations.GetEspaces = class GetEspaces extends Operation {
  constructor (nom) { super(nom, 3, 0) }

  async phase2() {
    await Esp.load(this)
    const espaces = []
    for(const [,e] of Esp.map) espaces.push(e.toRow())
    this.setRes('espaces', espaces)
  }
}

/*******************************************************************************
* Opérations SANS connexion AVEC contrôle de l'espace
* Lectures non synchronisées
*******************************************************************************/

/* GetPub: retourne la clé RSA publique d'un avatar
- id : id de l'avatar
*/
operations.GetPub = class GetPub extends Operation {
  constructor (nom) { super(nom, 0) }

  async phase2 (args) {
    await this.getCheckEspace(ID.ns(args.id))
    
    const avatar = await this.gd.getAV(args.id, 'getPub')
    this.setRes('pub', avatar.pub)
  }
}

/* Get Sponsoring **************************************************
args.token: éléments d'authentification du compte.
args.org : organisation
args.hps1 : hash du PBKFD de la phrase de contact réduite SANS ns
Retour:
- rowSponsoring s'il existe
*/
operations.GetSponsoring = class GetSponsoring extends Operation {
  constructor (nom) { super(nom, 0) }

  async phase2 (args) {
    const espace = await Esp.getEsp(this, args.org, true)
    if (!espace) { sleep(3000); throw new AppExc(F_SRV, 102, [args.org]) }
    if (espace.clos) throw new AppExc(A_SRV, 999, espace.clos)

    this.ns = espace.id

    const ids = (espace.id * d14) + (args.hps1 % d14)
    const row = await this.db.getSponsoringIds(this, ids)
    if (!row) { sleep(3000); throw new AppExc(F_SRV, 11) }
    this.setRes('rowSponsoring', row)
  }
}

/* Recherche hash de phrase de connexion ***************************************
Pour Acceptation Sponsoring
args.hps1 : ns + hps1 de la phrase de contact / de connexion
Retour:
- existe : true si le hash de la phrase existe
*/
operations.ExistePhrase1 = class ExistePhrase1 extends Operation {
  constructor (nom) { super(nom, 0) }

  async phase2 (args) {
    await this.getCheckEspace(ID.ns(args.hps1))

    if (await this.db.getCompteHXR(this, args.hps1)) this.setRes('existe', true)
  }
}

/* SyncSp - synchronisation sur ouverture d'une session à l'acceptation d'un sponsoring
- `token` : éléments d'authentification du compte à créer
- idsp idssp : identifiant du sponsoring
- id : id du compte sponsorisé à créer
- hXR: hash du PBKD de sa phrase secrète réduite
- hXC: hash du PBKD de sa phrase secrète complète
- `hYC`: hash du PNKFD de la phrase de sponsoring
- cleKXC: clé K du nouveau compte cryptée par le PBKFD de sa phrase secrète complète
- cleAK: clé A de son avatar principal cryptée par la clé K du compte
- ardYC: ardoise du sponsoring
- dconf: du sponsorisé
- pub: clé RSA publique de l'avatar
- privK: clé privée RSA de l(avatar cryptée par la clé K du compte
- cvA: CV de l'avatar cryptée par sa clé A

- clePK: clé P de sa partition cryptée par la clé K du nouveau compte
- cleAP: clé A de son avatar principâl cryptée par la clé P de sa partition
- clePA: cle P de la partition cryptée par la clé A du nouveau compte

- ch: { cck, ccP, t1c, t2c }
  - ccK: clé C du chat cryptée par la clé K du compte
  - ccP: clé C du chat cryptée par la clé publique de l'avatar sponsor
  - cleE1C: clé A de l'avatar E (sponsor) cryptée par la clé du chat.
  - cleE2C: clé A de l'avatar E (sponsorisé) cryptée par la clé du chat.
  - t1c: mot du sponsor crypté par la clé C
  - t2c: mot du sponsorisé crypté par la clé C

Retour: 
- rowEspace
- rowCompte
- rowCompti
- rowAvater 
- rowChat si la confidentialité n'a pas été requise
*/
operations.SyncSp = class SyncSp extends Operation {
  constructor (nom) { super(nom, 0) }

  async phase2 (args) {
    const espace = await this.getCheckEspace(ID.ns(args.idsp), false)
    this.setRes('rowEspace', espace.toShortRow())

    const avsponsor = await this.gd.getAV(args.idsp)
    if (!avsponsor) throw new AppExc(F_SRV, 401)

    // Recherche du sponsorings
    const sp = compile(await this.db.get(this, 'sponsorings', args.idsp, args.idssp))
    if (!sp) throw new AppExc(F_SRV, 11)
    if (sp.st !== 0 || sp.dlv < this.auj) throw new AppExc(F_SRV, 12, [args.idsp, args.idsp])
    if (sp.hYC !== args.hYC) throw new AppExc(F_SRV, 217)
    const dhsp = sp.dh || 0
    sp.acceptSp(this.dh, args) // Maj du sponsoring: st dconf2 dh ardYC

    // Maj compta du sponsor si don
    if (sp.don) { 
      const csp = await this.gd.getCA(args.idsp)
      if (!csp) throw new AppExc(F_SRV, 402)
      if (csp.estA) csp.don(this.dh, -2, args.id)
    }

    // créé compte compta compti invit
    const {compte, compta, compti, invit} = this.gd.nouvCO(args, sp, sp.quotas, sp.don)
    // pas de setRes pour le row compte qui VA ETRE MIS A JOUR après la phase 2 - Sera fait en phase 3
    this.compte = compte
    this.compta = compta
    this.setRes('rowCompti', compti.toShortRow())
    this.setRes('rowInvit', invit.toShortRow())

    const avatar = this.gd.nouvAV(compte, args, args.cvA)
    this.setRes('rowAvatar', avatar.toShortRow())

    // création du dataSync
    const ds = DataSync.deserial()
    ds.compte.vb = 1
    ds.compte.rds = compte.rds
    const a = { id: avatar.id, rds: avatar.rds, vs: 0, vb: 1 }
    ds.avatars.set(a.id, a)

    // Sérialisation et retour de dataSync
    this.setRes('dataSync', ds.serial())

    // Compte O : partition: ajout d'un compte (si quotas suffisants)
    const pid = sp.partitionId ? ID.long(sp.partitionId, this.ns) : 0
    if (pid) {
      const partition = await this.gr.getPA(pid) // assert si n'existe pas
      const s = partition.getSynthese()
      // restants à attribuer suffisant pour satisfaire les quotas ?
      const q = { qc: sp.quotas.qc, qn: sp.quotas.qn, qv: sp.quotas.qv }
      if (q.qc > (s.q.qc - s.qt.qc) || q.qn > (s.q.qn - s.qt.qn) || q.qv > (s.q.qv - s.qt.qv))
        throw new AppExc(F_SRV, 211, [pid, args.id])
      partition.ajoutCompte(compta, args.cleAP, sp.del)
    }
    
    /* Création chat */
    if (!sp.dconf && !args.dconf) {
      /*- ccK: clé C du chat cryptée par la clé K du compte
        - ccP: clé C du chat cryptée par la clé publique de l'avatar sponsor
        - cleE1C: clé A de l'avatar E (sponsor) cryptée par la clé du chat.
        - cleE2C: clé A de l'avatar E (sponsorisé) cryptée par la clé du chat.
      */
      const idsI = this.idsChat(args.id, sp.id)
      const idsE = this.idsChat(sp.id, args.id)
      const chI = this.gd.nouvCAV({ // du sponsorisé
        id: args.id,
        ids: idsI,
        st: 10,
        idE: ID.court(sp.id),
        idsE: idsE,
        cvE: avsponsor.cvA,
        cleCKP: args.ch.ccK,
        cleEC: args.ch.cleE1C,
        items: [{a: 1, dh: dhsp, t: args.ch.t1c}, {a: 0, dh: this.dh, t: args.ch.t2c}]
      })
      this.setRes('rowChat', chI.toRow())
      this.compta.ncPlus(1)

      this.gd.nouvCAV({
        id: sp.id,
        ids: idsE,
        st: 1,
        idE: ID.court(chI.id),
        idsE: idsI,
        cvE: avatar.cvA,
        cleCKP: args.ch.ccP,
        cleEC: args.ch.cleE2C,
        items: [{a: 0, dh: dhsp, t: args.ch.t1c}, {a: 1, dh: this.dh, t: args.ch.t2c}]
      })
    }

    // Mise à jour des abonnements aux versions
    if (this.sync) this.sync.setAboRds(ds.setLongsRds(this.ns), this.dh)
  }

  async phase3 () {
    /* Le row compte A ETE MIS A JOUR après la phase 2 */
    this.setRes('rowCompte', this.compte.toRow())
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
    await this.getCheckEspace(ID.ns(args.id), true)

    const avsponsor = await this.gd.getAV(args.ids)
    if (!avsponsor) throw new AppExc(F_SRV, 401)
  
    // Recherche du sponsorings
    const sp = compile(await this.db.get(this, 'sponsorings', args.id, args.ids))
    if (!sp) throw new AppExc(F_SRV, 11)
    if (sp.st !== 0 || sp.dlv < this.auj) throw new AppExc(F_SRV, 12, [args.id, args.ids])
    if (sp.hYC !== args.hYC) throw new AppExc(F_SRV, 217)
    sp.refusSp(this.dh, args) // Maj du sponsoring: st dconf2 dh ardYC
  }
}

/*******************************************************************************
* Opérations AVEC connexion (donc avec contrôle de l'espace)
* Lectures SANS restriction, pouvant être utilisées pour les actions d'URGENCE
*******************************************************************************/

/* Recherche hash de phrase ******
args.hps1 : ns + hps1 de la phrase de contact / de connexion
args.t :
  - 2 : phrase de sponsoring (ids)
  - 3 : phrase de contact (hpc d'avatar)
Retour:
- existe : true si le hash de la phrase existe
*/
operations.ExistePhrase = class ExistePhrase extends Operation {
  constructor (nom) { super(nom, 1, 1)  }

  async phase2 (args) {
    if (args.t === 2) {
      if (await this.db.getSponsoringIds(this, args.hps1)) {
        this.setRes('existe', true)
        return
      }
    } if (args.t === 3) {
      if (await this.db.getAvatarHpc(this, args.hps1)) {
        this.setRes('existe', true)
        return
      }
    }
  }
}

/* `GetSynthese` : retourne la synthèse de l'espace ns ou corant.
- `token` : éléments d'authentification du compte.
- `ns` : id de l'espace (pour admin seulement, sinon c'est celui de l'espace courant)
Retour:
- `rowSynthese`
*/
operations.GetSynthese = class GetSynthese extends Operation {
  constructor (nom) { super(nom, 1, 1) }

  async phase2 (args) {
    const ns = this.estAdmin ? args.ns : this.ns
    const rowSynthese = compile(await this.getRowSynthese(ns, 'getSynthese'))
    this.setRes('rowSynthese', rowSynthese.toRow())
  }
}

/* GetPartition : retourne une partition *********************************
- token : éléments d'authentification du compte.
- id : id de la partition
*/
operations.GetPartition = class GetPartition extends Operation {
  constructor (nom) { super(nom, 1, 1) }

  async phase2 (args) {
    if (this.compte._estA) throw new AppExc(F_SRV, 220)
    let id = args.id
    if (!this.estComptable) id = ID.long(this.compte.idp, this.ns)
    const partition = compile(await this.getRowPartition(id, 'GetPartition'))
    this.setRes('rowPartition', partition.toShortRow(this.compte.del))
  }
}

/* Get Espace **************************************************
args.token: éléments d'authentification du compte.
args.ns : ns pour l'administrateur
**Propriétés accessibles :**
- administrateur technique : toutes de tous les espaces.
- Comptable : toutes de _son_ espace.
- autres : sauf moisStat moisStatT dlvat nbmi
Retour:
- rowEspace s'il existe
*/
operations.GetEspace = class GetEspace extends Operation {
  constructor (nom) { super(nom, 1, 1) }

  async phase2 (args) {
    const espace = await this.getCheckEspace(args.ns)
    this.setRes('rowEspace', this.estAdmin || this.estComptable ? espace.toRow() : espace.toShortRow())
  }
}

/*******************************************************************************
* Opérations AVEC connexion (donc avec contrôle de l'espace)
* Opération (unique) de Synchronisation
*******************************************************************************/

/* Sync : opération générique de synchronisation d'une session cliente
LE PERIMETRE est mis à jour: DataSync aligné OU créé avec les avatars / groupes tirés du compte
- dataSync: sérialisation de l'état de synchro de la session
  - null : C'EST UNE PREMIERE CONNEXION - Création du DataSync
  recherche des versions "base" de TOUS les sous-arbres du périmètre, inscription en DataSync
- lrds: liste des rds des sous-arbres à recharger (dataSync n'est pas null)
*/
operations.Sync = class Sync extends Operation {
  constructor (nom) { super(nom, 1, 1) }

  // Obtient un groupe et le garde en cache locale de l'opération
  async getGr (idg) {
    let g = this.mgr.get(idg)
    if (g === undefined) {
      g = compile(await this.getRowGroupe(idg)) || null
      this.mgr.set(idg, g)
    }
    return g
  }

  async getGrRows (ida, x) { 
    // ida : ID long d'un sous-arbre avatar ou d'un groupe. x : son item dans ds
    let gr = this.mgr.get(ida) // on a pu aller chercher le plus récent si cnx
    if (!gr) gr = compile(await this.db.getV(this, 'groupes', ida, x.vs))
    if (gr) this.addRes('rowGroupes', gr.toShortRow(this.compte, x.m))

    if (x.m) {
      /* SI la session avait des membres chargés, chargement incrémental depuis vs
      SINON chargement initial de puis 0 */
      for (const row of await this.db.scoll(this, 'membres', ida, x.ms ? x.vs : 0))
        this.addRes('rowMembres', compile(row).toShortRow())
      for (const row of await this.db.scoll(this, 'chatgrs', ida, x.ms ? x.vs : 0))
        this.addRes('rowChatgrs', compile(row).toShortRow())
    }

    /* SI la session avait des notes chargées, chargement incrémental depuis vs
    SINON chargement initial de puis 0 */
    if (x.n) for (const row of await this.db.scoll(this, 'notes', ida, x.ns ? x.vs : 0))
      this.addRes('rowNotes', compile(row).toShortRow(this.id))
  }
  
  async getAvRows (ida, x) { // ida : ID long d'un sous-arbre avatar ou d'un groupe
    const rav = await this.db.getV(this, 'avatars', ida, x.vs)
    if (rav) this.addRes('rowAvatars', rav)

    for (const row of await this.db.scoll(this, 'notes', ida, x.vs))
      this.addRes('rowNotes', compile(row).toShortRow())
    for (const row of await this.db.scoll(this, 'chats', ida, x.vs))
      this.addRes('rowChats', compile(row).toShortRow())
    for (const row of await this.db.scoll(this, 'sponsorings', ida, x.vs))
      this.addRes('rowSponsorings', compile(row).toShortRow())
    if (ID.estComptable(this.id)) 
      for (const row of await this.db.scoll(this, 'tickets', ida, x.vs))
        this.addRes('rowTickets', compile(row).toShortRow())
  }

  async setAv (ida, rds) {
    const x = this.ds.avatars.get(ida)
    if (x) {
      const version = rds ? await this.getV({ rds }) : null
      if (!version || version.suppr) this.ds.avatars.delete(ida) // NORMALEMENT l'avatar aurait déjà du être supprimé de compte/mav AVANT
      else x.vb = version.v
    }
  }

  async setGr (idg, rds) {
    const x = this.ds.groupes.get(idg)
    const g = await this.getGr(idg)
    if (x) {
      const version = rds ? await this.getV({rds}) : null
      if (!g || g.v === V99 || !version || version.suppr) 
        this.ds.groupes.delete(idg) // NORMALEMENT le groupe aurait déjà du être enlevé de compte/mpg AVANT
      else {
        x.vb = version.v
        // reset de x.m x.n : un des avatars du compte a-t-il accès aux membres / notes
        const sid = this.compte.idMbGr(idg)
        if (sid.size) { 
          const [mx, nx] = g.amAn(sid)
          x.m = mx; x.n = nx 
        }
        else { x.m = false; x.n = false }
      }
    }
  }

  async getV (doc, src) {
    const id = ID.long(doc.rds, this.ns)
    return compile(await this.getRowVersion(id, src))
  }

  async phase2(args) {
    this.mgr = new Map() // Cache locale des groupes acquis dans l'opération
    this.cnx = !args.dataSync
    const srds = args.lrds ? new Set(args.lrds) : new Set()

    /* Mise à jour du DataSync en fonction du compte et des avatars / groupes actuels du compte */
    this.ds = DataSync.deserial(this.cnx ? null : args.dataSync)

    const vcpt = await this.getV(this.compte)
    // Compte/Version forcément trouvés, auth() vient de le checker
    this.ds.compte.rds = this.compte.rds
    this.ds.compte.vb = vcpt.v

    if (this.cnx || (this.ds.compte.vs < this.ds.compte.vb))
      this.setRes('rowCompte', this.compte.toShortRow())
    let rowCompti = Cache.aVersion('comptis', this.compte.id, vcpt.v) // déjà en cache ?
    if (!rowCompti) rowCompti = await this.getRowCompti(this.compte.id)
    if (this.cnx || (rowCompti.v > this.ds.compte.vs)) 
      this.setRes('rowCompti', compile(rowCompti).toShortRow())
    let rowInvit = Cache.aVersion('invits', this.compte.id, vcpt.v) // déjà en cache ?
    if (!rowInvit) rowInvit = await this.getRowInvit(this.compte.id)
    if (this.cnx || (rowInvit.v > this.ds.compte.vs)) 
      this.setRes('rowInvit', compile(rowInvit).toShortRow())
  
    /* Mise à niveau des listes avatars / groupes du dataSync
    en fonction des avatars et groupes listés dans mav/mpg du compte 
    Ajoute les manquants dans ds, supprime ceux de ds absents de mav / mpg
    Pour CHAQUE GROUPE les indicateurs m et n NE SONT PAS bien positionnés.
    */
    this.compte.majPerimetreDataSync(this.ds, srds)  

    if (this.cnx) {
      // Recherche des versions vb de TOUS les avatars requis
      for(const [ida, dsav] of this.ds.avatars)
        await this.setAv(ida, dsav.rds)

      // Recherche des versions vb de TOUS les groupes requis
      for(const [idg, dsgr] of this.ds.groupes) 
        await this.setGr(idg, dsgr.rds)
        
    } else {
      /* Recherche des versions uniquement pour les avatars / groupes signalés 
      comme ayant (a priori) changé de version 
      OU ceux apparus / disparus détectés par la maj du périmètre vi-avant*/
      if (srds.size) for(const rds of srds) {
        const id = this.ds.idDeRds(rds)
        if (id) {
          if (ID.estAvatar(id)) await this.setAv(id, rds)
          if (ID.estGroupe(id)) await this.setGr(id, rds)
        }
      }
    }

    if (this.cnx) {
      // credentials / emulator en cas de première connexion
      this.db.setSyncData(this)
    } else {
      const n = this.nl
      for(const [ida, x] of this.ds.avatars) {
        x.chg = false
        /* Si la version en base est supérieure à celle en session, chargement */
        if (!x.vb || (x.vs < x.vb)) {
          await this.getAvRows(ida, x)
          x.chg = true
          if (this.nl - n > 20) break
        }
      }
      if (this.nl - n <= 20) for(const [idg, x] of this.ds.groupes) {
        x.chg = false
        /* Si la version en base est supérieure à celle en session, 
        OU s'il faut désormais des membres alors qu'il n'y en a pas en session
        OU s'il faut désormais des notes alors qu'il n'y en a pas en session
        chargement */
        if (!x.vb || (x.vs < x.vb) || (x.m && !x.ms) || (x.n && !x.ns)) {
          await this.getGrRows(idg, x)
          x.chg = true
          if (this.nl - n > 20) break
        }
      }
    }

    // Sérialisation et retour de dataSync
    this.setRes('dataSync', this.ds.serial())

    // Mise à jour des abonnements aux versions
    if (this.sync) this.sync.setAboRds(this.ds.setLongsRds(this.ns), this.dh)
  }
}

/*******************************************************************************
* Opérations AVEC connexion ADMINISTRATEUR EXCLUSIVEMENT
*******************************************************************************/

/* `CreerEspace` : création d'un nouvel espace et du comptable associé
- token : jeton d'authentification du compte de **l'administrateur**
- ns : numéro de l'espace
- org : code de l'organisation
- hXR : hash du PBKFD de la phrase secrète réduite
- hXC : hash du PBKFD de la phrase secrète complète
- pub: clé RSA publique du Comptable
- privK: clé RSA privée du Comptable cryptée par la clé K
- clePK: clé P de la partition 1 cryptée par la clé K du Comptable
- cleEK: clé E cryptée par la clé K
- cleE: clé en clair
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

    if (await this.gd.getES()) 
      throw new AppExc(F_SRV, 203, [args.ns, args.org])
    if (await Esp.getOrg(this, args.org)) 
      throw new AppExc(F_SRV, 204, [args.ns, args.org])

    args.id = ID.duComptable(args.ns)

    /* Espace */
    const cleES = crypterSrv(this.db.appKey, args.cleE)
    // this.espace = Espaces.nouveau(args.ns, args.org, this.auj, cleES)
    this.gd.nouvES(args.ns, args.org, cleES)

    const apr = config.allocPrimitive
    const qc = { qc: apr[0], qn: apr[1], qv: apr[2] } 
    const partition = await this.gd.nouvPA(1, qc)

    /* Compte Comptable */
    const aco = config.allocComptable
    const quotas = { qc: aco[0], qn: aco[1], qv: aco[2] }
    const {compte, compta } = this.gd.nouvCO(args, null, quotas, 0)

    partition.ajoutCompte(compta, compta._c2m, args.cleAP, true)

    const cvA = { id: args.id }
    this.gd.nouvAV(compte, args, cvA)
  }
}

/*`SetEspaceNprof` : déclaration du profil de volume de l'espace par l'administrateur
- `token` : jeton d'authentification du compte de **l'administrateur**
- `ns` : id de l'espace notifié.
- `nprof` : numéro de profil de 0 à N. Liste spécifiée dans config.mjs de l'application.

Retour: rien
*/
operations.SetEspaceNprof = class SetEspaceNprof extends Operation {
  constructor (nom) { super(nom, 3)}

  async phase2 (args) {
    const espace = await this.getCheckEspace(args.ns)
    espace.setNprof(args.nprof)
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
    const espace = await this.getCheckEspace(args.ns)
    if (args.ntf) args.ntf.dh = this.dh
    espace.setNotifE(args.ntf || null)
  }
}

/* `GetNotifC` : obtention de la notification d'un compte
- `token` : jeton d'authentification du compte de **l'administrateur**
- `id` : id du compte dont on cherche la notification
Réservée au comptable et aux délégués de la partition du compte
Retour:
- notif
*/
operations.GetNotifC = class GetNotifC extends Operation {
  constructor (nom) { super(nom, 1, 1) }

  async phase2 (args) {
    const c = await this.gd.getCO(args.id, 'GetNotifC-1')
    if (!c.idp) throw new AppExc(F_SRV, 230)
    if (c.notif) this.setRes('notif', c.notif)
    if (this.estComptable) return
    const part = await this.gd.getPA(c.idp, 'GetNotifC-2')
    if (!part.estDel(this.id)) throw new AppExc(F_SRV, 231)
  }
}
