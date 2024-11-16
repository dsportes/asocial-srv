import { AppExc, A_SRV, F_SRV, ID } from './api.mjs'
import { config } from './config.mjs'
import { operations } from './cfgexpress.mjs'
import { sleep, crypter, crypterSrv, decrypterSrv } from './util.mjs'

import { Operation, Cache, Esp } from './modele.mjs'
import { compile } from './gendoc.mjs'
import { DataSync, Cles, Tarif, AMJ } from './api.mjs'
// import { Taches } from './taches.mjs'

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

/** EchoTexte: Echo du texte envoyé ***************************************
Retour:
- echo : texte d'entrée retourné
*/
operations.EchoTexte = class EchoTexte extends Operation {
  constructor (nom) { 
    super(nom, 0)
    this.SYS = true 
    this.targs = {
      texte: { t: 'string' }
    }
  }

  async phase2(args) {
    await sleep(config.D1)
    this.setRes('echo', args.texte)
  }
}

/** ErreurFonc: Erreur fonctionnelle simulée du texte envoyé
Exception: F_SRV, 10
*/
operations.ErreurFonc = class ErreurFonc extends Operation {
  constructor (nom) { 
    super(nom, 0)
    this.SYS = true
    this.targs = {
      texte: { t: 'string' }
    }
  }

  async phase2(args) {
    await sleep(config.D1)
    throw new AppExc(A_SRV, 10, [args.texte])
  }
}

/** PingDB: Test d'accès à la base - GET
Insère un item de ping dans la table singletons/1
Retour:
- un string avec les date-heures de ping (le précédent et celui posé)
*/
operations.PingDB = class PingDB extends Operation {
  constructor (nom) { 
    super(nom, 0)
    this.SYS = true 
  }

  async phase2() {
    await sleep(config.D1)
    this.result.type = 'text/plain'
    this.result.bytes = await this.db.ping()
  }
}

/* GetEspaces : pour admin seulement, retourne tous les rows espaces
Retour:
- espaces : array de row espaces
*/
operations.GetEspaces = class GetEspaces extends Operation {
  constructor (nom) { 
    super(nom, 3, 0) 
  }

  async phase2() {
    await Esp.load(this.db)
    const espaces = []
    for(const [ns, row] of Esp.map) {
      const esp = compile(row)
      espaces.push(esp.toShortRow(this, ns))
    }
    this.setRes('espaces', espaces)
  }
}

/*******************************************************************************
* Opérations SANS connexion AVEC contrôle de l'espace
* Lectures non synchronisées
*******************************************************************************/

/* GetPub: retourne la clé RSA publique d'un avatar
Retour:
- pub: clé RSA
*/
operations.GetPub = class GetPub extends Operation {
  constructor (nom) { 
    super(nom, 1, 1)
    this.targs = {
      id: { t: 'ida' } // id de l'avatar
    }
  }

  async phase2 (args) {
    const avatar = await this.gd.getAV(args.id, 'getPub')
    this.setRes('pub', avatar.pub)
  }
}

/* GetPubOrg: retourne la clé RSA publique d'un avatar NON authentifié
Retour:
- pub: clé RSA
*/
operations.GetPubOrg = class GetPubOrg extends Operation {
  constructor (nom) { 
    super(nom, 0)
    this.targs = {
      org: { t: 'org'}, // code de l'organisation
      id: { t: 'ida' }  // id de l'avatar
    } 
  }

  async phase2 (args) {
    await this.checkEspaceOrg(args.org)
    
    const avatar = await this.gd.getAV(args.id, 'getPub')
    if (!avatar.pub) await sleep(config.D1)
    this.setRes('pub', avatar ? avatar.pub : null)
  }
}

/* GetSponsoring : obtention d'un sponsoring par le hash de sa phrase
Retour:
- rowSponsoring s'il existe
*/
operations.GetSponsoring = class GetSponsoring extends Operation {
  constructor (nom) { 
    super(nom, 0)
    this.targs = {
      org: { t: 'org'},
      hps1: { t: 'ids' }, // hash9 du PBKFD de la phrase de contact réduite
      hTC: { t: 'ids' } // hash de la phrase de sponsoring complète
    }
  } 

  async phase2 (args) {
    const espace = await this.setEspaceOrg(args.org)

    if (espace.hTC) { // Compte du Comptable pas encore créé
      await sleep(config.D1)
      this.setRes('cleET', espace.hTC === args.hTC ? espace.cleET : false)
    } else {
      const sp = compile(await this.db.getSponsoringIds(ID.long(args.hps1, this.ns)))
      if (!sp) { await sleep(config.D1); throw new AppExc(F_SRV, 11) }
      this.setRes('rowSponsoring', sp.toShortRow(this))
      this.setRes('ns', this.ns)  
    }
  }
}

/* ExistePhrase1: Recherche hash de phrase de connexion 
Retour:
- existe : true si le hash de la phrase existe
*/
operations.ExistePhrase1 = class ExistePhrase1 extends Operation {
  constructor (nom) { 
    super(nom, 0) 
    this.targs = {
      org: { t: 'org'},
      hps1: { t: 'ids' } // hash9 du PBKFD de la phrase de contact réduite
    }
  }

  async phase2 (args) {
    await this.checkEspaceOrg(args.org)

    if (await this.db.getCompteHk(ID.long(args.hps1, this.ns))) this.setRes('existe', true)
    else await sleep(D1)
  }
}

/* ExistePhrase: Recherche hash de phrase 
Retour:
- existe : true si le hash de la phrase existe
*/
operations.ExistePhrase = class ExistePhrase extends Operation {
  constructor (nom) { 
    super(nom, 1, 1)  
    this.targs = {
      t: { t: 'int', min: 2, max: 3 },
      // 2 : phrase de sponsoring (ids)
      // 3 : phrase de contact (hpc d'avatar)
      hps1: { t: 'ids' } // hash9 du PBKFD de la phrase de contact réduite
    }
  }

  async phase2 (args) {
    if (args.t === 2) {
      if (await this.db.getSponsoringIds(ID.long(args.hps1, this.ns))) {
        this.setRes('existe', true)
        return
      }
    } if (args.t === 3) {
      if (await this.db.getAvatarHk(ID.long(args.hps1, this.ns))) {
        this.setRes('existe', true)
        return
      }
    }
  }
}

/* AcceptationSponsoring - synchronisation sur ouverture d'une session à l'acceptation d'un sponsoring
*/
operations.AcceptationSponsoring = class AcceptationSponsoring extends Operation {
  constructor (nom) { 
    super(nom, 0)
    this.targs = {
      org: { t: 'org' }, // organisation
      // subJSON: { t: 'string' }, // subscription de la session
      idsp: { t: 'ida' }, // identifiant du sponsor
      idssp: { t: 'ids' }, // identifiant du sponsoring
      id: { t: 'ida' }, // id du compte sponsorisé à créer
      hXR: { t: 'ids' }, // hash du PBKD de sa phrase secrète réduite
      hXC: { t: 'ids' }, // hash du PBKD de sa phrase secrète complète
      hYC:  { t: 'ids' }, // hash du PNKFD de la phrase de sponsoring
      cleKXC: { t: 'u8' }, // clé K du nouveau compte cryptée par le PBKFD de sa phrase secrète complète
      cleAK: { t: 'u8' }, // clé A de son avatar principal cryptée par la clé K du compte
      ardYC: { t: 'u8' }, // ardoise du sponsoring
      dconf: { t: 'bool' }, // dconf du sponsorisé
      pub: { t: 'u8' }, // clé RSA publique de l'avatar
      privK: { t: 'u8' }, // clé privée RSA de l(avatar cryptée par la clé K du compte
      cvA: { t: 'cv' }, // CV de l'avatar cryptée par sa clé A
      clePK: { t: 'u8', n: true }, // clé P de sa partition cryptée par la clé K du nouveau compte
      cleAP: { t: 'u8', n: true }, // clé A de son avatar principâl cryptée par la clé P de sa partition
      clePA: { t: 'u8', n: true }, // cle P de la partition cryptée par la clé A du nouveau compte
      ch: { t: 'chsp', n: true }, // { ccK, ccP, cleE1C, cleE2C, t1c, t2c }
        // ccK: clé C du chat cryptée par la clé K du compte
        // ccP: clé C du chat cryptée par la clé publique de l'avatar sponsor
        // cleE1C: clé A de l'avatar E (sponsor) cryptée par la clé du chat.
        // cleE2C: clé A de l'avatar E (sponsorisé) cryptée par la clé du chat.
        // t1c: mot du sponsor crypté par la clé C
        // t2c: mot du sponsorisé crypté par la clé C
      htK: { t: 'u8' }, // hashtag relatif au sponsor
      txK: { t: 'u8' } // texte relatif au sponsor
    }
  }

  async phase2 (args) {
    // this.subJSON = args.subJSON || null

    await this.setEspaceOrg(args.org) // set this.ns et this.org

    const avsponsor = await this.gd.getAV(args.idsp)
    if (!avsponsor) {
      await sleep(config.D1)
      throw new AppExc(F_SRV, 401)
    }

    // Recherche du sponsorings
    const sp = await this.gd.getSPO(args.idsp, args.idssp)
    if (!sp) throw new AppExc(F_SRV, 11)
    if (sp.st !== 0 || sp.dlv < this.auj) throw new AppExc(F_SRV, 12, [args.idsp, args.idsp])
    if (sp.hYC !== args.hYC) throw new AppExc(F_SRV, 217)
    const dhsp = sp.dh || 0
    sp.acceptSp(this.dh, args) // Maj du sponsoring: st dconf2 dh ardYC

    // Maj compta du sponsor si don
    if (sp.don) { 
      const csp = await this.gd.getCA(args.idsp)
      if (!csp) throw new AppExc(F_SRV, 402)
      csp.don(this.dh, -sp.don, args.id)
    }

    // créé compte compta compti invit
    const {compte, compta, compti, invit} = this.gd.nouvCO(args, sp, sp.quotas, sp.don)
    // pas de setRes pour le row compte qui VA ETRE MIS A JOUR après la phase 2 - Sera fait en phase 3
    compta.setA(sp.partitionId ? false : true)
    this.compte = compte
    this.compta = compta
    compti.setMc(sp.id, args.htK, args.txK)
    // await compte.reportDeCompta(compta, this.gd)

    const avatar = this.gd.nouvAV(args, args.cvA)

    // Compte O : partition: ajout d'un compte (si quotas suffisants)
    const pid = sp.partitionId || ''
    if (pid) {
      const partition = await this.gd.getPA(pid) // assert si n'existe pas
      partition.checkUpdateQ(pid, sp.quotas) // peut lever une Exc si insuffisance de quotas
      partition.ajoutCompteO(compta, args.cleAP, sp.del)
    } else {
      const synth = await this.gd.getSY()
      synth.updQuotasA({ qn: 0, qv: 0, qc: 0 }, sp.quotas) // peut lever une Exc si insuffisance de quotas
    }
    
    /* Création chat */
    if (!sp.dconf && !args.dconf) {
      /*- ccK: clé C du chat cryptée par la clé K du compte
        - ccP: clé C du chat cryptée par la clé publique de l'avatar sponsor
        - cleE1C: clé A de l'avatar E (sponsor) cryptée par la clé du chat.
        - cleE2C: clé A de l'avatar E (sponsorisé) cryptée par la clé du chat.
      */
      const idsI = ID.rnd() // this.idsChat(args.id, sp.id)
      const idsE = ID.rnd() // this.idsChat(sp.id, args.id)
      const chI = await this.gd.nouvCAV({ // du sponsorisé
        id: args.id,
        ids: idsI,
        st: 11,
        idE: sp.id,
        idsE: idsE,
        cvE: avsponsor.cvA,
        cleCKP: args.ch.ccK,
        cleEC: args.ch.cleE1C,
        items: [{a: 1, dh: dhsp, t: args.ch.t1c}, {a: 0, dh: this.dh, t: args.ch.t2c}]
      })
      // this.setRes('rowChat', chI.toShortRow(this))
      this.compta.ncPlus(1)

      await this.gd.nouvCAV({
        id: sp.id,
        ids: idsE,
        st: 11,
        idE: chI.id,
        idsE: idsI,
        cvE: avatar.cvA,
        cleCKP: args.ch.ccP,
        cleEC: args.ch.cleE2C,
        items: [{a: 0, dh: dhsp, t: args.ch.t1c}, {a: 1, dh: this.dh, t: args.ch.t2c}]
      })
      const comptaE = await this.gd.getCA(sp.id, 'AcceptationSponsoring')
      comptaE.ncPlus(1)
    }

    const comptiSp = await this.gd.getCI(args.idsp, 'McMemo-2')
    comptiSp.setMc(args.id, sp.htK, sp.txK)
  }
}

/* RefusSponsoring: Rejet d'une proposition de sponsoring 
*/
operations.RefusSponsoring = class RefusSponsoring extends Operation {
  constructor (nom) { 
    super(nom, 0)
    this.targs = {
      org: { t: 'org'},
      id: { t: 'ida' }, // identifiant du sponsor
      ids: { t: 'ids' }, // identifiant du sponsoring
      ardYC: { t:'u8' }, // réponse du filleul
      hYC: { t: 'ids' } // hash9 du PBKFD de la phrase de contact réduite
    }
  }

  async phase2(args) {
    await this.setEspaceOrg(args.org)

    const avsponsor = await this.gd.getAV(args.id)
    if (!avsponsor) {
      await sleep(config.D1)
      throw new AppExc(F_SRV, 401)
    }
  
    // Recherche du sponsorings
    const sp = await this.gd.getSPO(args.id, args.ids)
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

/* GetSynthese : retourne la synthèse de l'espace ns ou courant
Retour:
- rowSynthese
*/
operations.GetSynthese = class GetSynthese extends Operation {
  constructor (nom) { 
    super(nom, 1, 1)
    this.targs = {
      ns: { t: 'ns', n: true } // id de l'espace (pour admin seulement, sinon c'est celui de l'espace courant)
    }
  }

  async phase2 (args) {
    if (this.estAdmin) this.ns = args.ns
    const synthese = await this.gd.getSY() 
    this.setRes('rowSynthese', synthese.toShortRow(this))
  }
}

/* GetPartition : retourne une partition 
Retour:
- rowPartition
*/
operations.GetPartition = class GetPartition extends Operation {
  constructor (nom) { 
    super(nom, 1, 1)
    this.targs = {
      id: { t: 'idp', n: true } // id de la partition
    }
  }

  async phase2 (args) {
    if (this.compte._estA) throw new AppExc(F_SRV, 220)
    const id = !this.estComptable ? this.compte.idp : args.id
    const partition = compile(await this.getRowPartition(id, 'GetPartition'))
    this.setRes('rowPartition', partition.toShortRow(this, this.compte))
  }
}

/* GetEspace : retourne certaines propriétés de l'espace
Retour:
- rowEspace s'il existe
*/
operations.GetEspace = class GetEspace extends Operation {
  constructor (nom) { 
    super(nom, 1, 1) 
    this.targs = {
      ns: { t: 'ns', n: true } // id de l'espace (pour admin seulement, sinon c'est celui de l'espace courant)
    }
  }

  async phase2 (args) {
    /* **Propriétés accessibles :**
    - administrateur technique : toutes de tous les espaces.
    - Comptable : toutes de _son_ espace.
    - autres : sauf moisStat moisStatT nbmi
    */
    const ns = !this.isAdmin ? this.ns : args.ns
    const espace = await Esp.getEsp (this, ns, false)
    espace.excFerme()
    this.setRes('rowEspace', espace.toShortRow(this, ns))
  }
}

/*******************************************************************************
* Opérations AVEC connexion (donc avec contrôle de l'espace)
* Opération (unique) de Synchronisation
*******************************************************************************/

/* Sync : opération générique de synchronisation d'une session cliente
LE PERIMETRE est mis à jour: DataSync aligné OU créé avec les avatars / groupes tirés du compte
*/
operations.Sync = class Sync extends Operation {
  constructor (nom) { 
    super(nom, 1, 1) 
    this.targs = {
      subJSON: { t: 'string', n: true }, // subscription de la session
      dataSync: { t: 'u8', n: true }, // sérialisation de l'état de synchro de la session
      // null : C'EST UNE PREMIERE CONNEXION - Création du DataSync
      // recherche des versions "base" de TOUS les sous-arbres du périmètre, inscription en DataSync
      lids: { t: 'lids', n: true }, // liste des ids des sous-arbres à recharger (dataSync n'est pas null)
      full: { t: 'bool', n: true } // si true, revérifie tout le périmètre
    }
  }

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
    if (!gr) gr = compile(await this.db.getV('groupes', ID.long(ida, this.ns), x.vs))
    if (gr) this.addRes('rowGroupes', gr.toShortRow(this, this.compte, x.m))

    if (x.m) {
      /* SI la session avait des membres chargés, chargement incrémental depuis vs
      SINON chargement initial de puis 0 */
      for (const row of await this.db.scoll('membres', ID.long(ida, this.ns), x.ms ? x.vs : 0))
        this.addRes('rowMembres', compile(row).toShortRow(this))
      for (const row of await this.db.scoll('chatgrs', ID.long(ida, this.ns), x.ms ? x.vs : 0))
        this.addRes('rowChatgrs', compile(row).toShortRow(this))
    }

    /* SI la session avait des notes chargées, chargement incrémental depuis vs
    SINON chargement initial de puis 0 */
    if (x.n) for (const row of await this.db.scoll('notes', ID.long(ida, this.ns), x.ns ? x.vs : 0))
      this.addRes('rowNotes', compile(row).toShortRow(this, this.id))
  }
  
  async getAvRows (ida, x) { // ida : ID long d'un sous-arbre avatar ou d'un groupe
    const row = await this.db.getV('avatars', ID.long(ida, this.ns), x.vs)
    if (row) this.addRes('rowAvatars', compile(row).toShortRow(this))

    for (const row of await this.db.scoll('notes', ID.long(ida, this.ns), x.vs)) {
      const x = compile(row)
      this.addRes('rowNotes', x.toShortRow(this))
    }
    for (const row of await this.db.scoll('chats', ID.long(ida, this.ns), x.vs))
      this.addRes('rowChats', compile(row).toShortRow(this))
    for (const row of await this.db.scoll('sponsorings', ID.long(ida, this.ns), x.vs))
      this.addRes('rowSponsorings', compile(row).toShortRow(this))
    if (ID.estComptable(this.id)) 
      for (const row of await this.db.scoll('tickets', ID.long(ida, this.ns), x.vs))
        this.addRes('rowTickets', compile(row).toShortRow(this))
  }

  async setAv (ida) {
    const x = this.ds.avatars.get(ida)
    if (x) {
      const rowVersion = await this.getRowVersion(ida)
      if (!rowVersion || rowVersion.dlv) this.ds.avatars.delete(ida) // NORMALEMENT l'avatar aurait déjà du être supprimé de compte/mav AVANT
      else x.vb = rowVersion.v
    }
  }

  async setGr (idg) {
    const x = this.ds.groupes.get(idg)
    if (!x) return
    const g = await this.getGr(idg)
    const rowVersion = await this.getRowVersion(idg)

    if (!g || !rowVersion || rowVersion.dlv) 
      this.ds.groupes.delete(idg) // NORMALEMENT le groupe aurait déjà du être enlevé de compte/mpg AVANT
    else {
      x.vb = rowVersion.v
      // reset de x.m x.n : un des avatars du compte a-t-il accès aux membres / notes
      const sid = this.compte.idMbGr(idg)
      if (sid.size) { 
        const [mx, nx] = g.amAn(sid)
        x.m = mx; x.n = nx 
      }
      else { x.m = false; x.n = false }
    }
  }

  async phase2(args) {
    if (!args.datasync) {
      const espace = await Esp.getEspOrg (this, this.org)
      if (espace.dlvat && espace.dlvat < this.auj) {
        new AppExc(F_SRV, 14, [AMJ.editDeAmj(espace.dlvat)])
      }
    }

    if (!args.dataSync) this.setRes('tarifs', Tarif.tarifs)
    this.subJSON = args.subJSON || null

    this.mgr = new Map() // Cache locale des groupes acquis dans l'opération

    /* Mise à jour du DataSync en fonction du compte et des avatars / groupes actuels du compte */
    this.ds = DataSync.deserial(args.dataSync || null)

    this.ds.compte.vb = this.compte.v

    if (!args.dataSync || (this.ds.compte.vs < this.compte.v))
      this.setRes('rowCompte', this.compte.toShortRow(this))

    if (!args.dataSync || (this.ds.compte.vs < this.compte.vci)) {
      let rowCompti = Cache.aVersion(this, 'comptis', this.compte.id, this.compte.vci) // déjà en cache ?
      if (!rowCompti) rowCompti = await this.getRowCompti(this.compte.id)
      this.setRes('rowCompti', compile(rowCompti).toShortRow(this))
    }

    if (!args.dataSync || (this.ds.compte.vs < this.compte.vin)) {
      let rowInvit = Cache.aVersion(this, 'invits', this.compte.id, this.compte.vin) // déjà en cache ?
      if (!rowInvit) rowInvit = await this.getRowInvit(this.compte.id)
      this.setRes('rowInvit', compile(rowInvit).toShortRow(this))
    }

    /* Mise à niveau des listes avatars / groupes du dataSync
    en fonction des avatars et groupes listés dans mav/mpg du compte 
    Ajoute les manquants dans ds, supprime ceux de ds absents de mav / mpg
    Pour CHAQUE GROUPE les indicateurs m et n NE SONT PAS bien positionnés.
    */
    this.compte.majPerimetreDataSync(this.ds)  

    if (!args.dataSync || args.full) {
      // Recherche des versions vb de TOUS les avatars requis
      for(const [ida,] of this.ds.avatars) await this.setAv(ida)
      // Recherche des versions vb de TOUS les groupes requis
      for(const [idg,] of this.ds.groupes) await this.setGr(idg)
    } else {
      // Recherche des versions uniquement pour les avatars / groupes signalés 
      // comme ayant (a priori) changé de version 
      if (args.lids && args.lids.length) for(const id of args.lids) {
        if (ID.estAvatar(id)) await this.setAv(id)
        if (ID.estGroupe(id)) await this.setGr(id)
      }
    }

    if (args.dataSync) { // Charge les avatars et groupes dont le vs < vb
      const n = this.nl
      for(const [ida, x] of this.ds.avatars) {
        x.chg = false
        // Si la version en base est supérieure à celle en session, chargement
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
    this.setRes('dataSync', this.ds.serial(this.ns))
  }
}

/*******************************************************************************
* Opérations AVEC connexion ADMINISTRATEUR EXCLUSIVEMENT
*******************************************************************************/

/* SetEspaceQuotas: Déclaration des quotas globaux de l'espace par l'administrateur technique
*/
operations.SetEspaceQuotas = class SetEspaceQuotas extends Operation {
  constructor (nom) { 
    super(nom, 3)
    this.targs = {
      ns: { t: 'ns' }, // id de l'espace modifié
      quotas: { t: 'q' } // quotas globaux
    }
  }

  async phase2 (args) {
    const espace = await this.setEspaceNs(args.ns, true)
    espace.setQuotas(args.quotas)
  }
}

/* SetNotifE : déclaration d'une notification à un espace par l'administrateur
*/
operations.SetNotifE = class SetNotifE extends Operation {
  constructor (nom) { 
    super(nom, 3) 
    this.targs = {
      ns: { t: 'ns' }, // id de l'espace notifié
      ntf: { t: 'ntf', n: true } // sérialisation de l'objet notif, cryptée par la clé du comptable de l'espace. Cette clé étant publique, le cryptage est symbolique et vise seulement à éviter une lecture simple en base
    }
  }

  async phase2 (args) {
    // C'est une opération "admin", elle échappe aux contrôles espace figé / clos.
    // Elle n'écrit QUE dans espaces.
    const espace = await this.setEspaceNs(args.ns, false)

    if (args.ntf) args.ntf.dh = this.dh
    espace.setNotifE(args.ntf || null)
  }
}

/* GetNotifC : obtention de la notification d'un compte
Réservée au comptable et aux délégués de la partition du compte
Retour:
- notif
*/
operations.GetNotifC = class GetNotifC extends Operation {
  constructor (nom) { 
    super(nom, 1, 1)
    this.targs = {
      id: { t: 'ida' } // id du compte dont on cherche la notification
    }
  }

  async phase2 (args) {
    const c = await this.gd.getCO(args.id, 'GetNotifC-1')
    if (!c.idp) throw new AppExc(F_SRV, 230)
    if (c.notif) this.setRes('notif', c.notif)
    if (this.estComptable) return
    const part = await this.gd.getPA(c.idp, 'GetNotifC-2')
    if (!part.estDel(this.id)) throw new AppExc(F_SRV, 231)
  }
}

/* CreationEspace : création d'un nouvel espace
Traitement ssi: 
- soit espace n'existe pas, 
- soit espace existe et a un `hTC` : re-création avec une nouvelle phrase de sponsoring.

Création des rows espace, synthese
- génération de la `cleE` de l'espace: -> `cleET` (par TC) et `cleES` (par clé système).
- stocke dans l'espace: `hTC cleES cleET`. Il est _à demi_ créé, son Comptable n'a pas encore crée son compte.
*/
operations.CreationEspace = class CreationEspace extends Operation {
  constructor (nom) { 
    super(nom, 3)
    this.targs = {
      ns: { t: 'ns' }, // ID de l'espace [0-9][a-z][A-Z]
      org: { t: 'org' }, // code de l'organisation
      TC: { t: 'u8' }, // PBKFD de la phrase de sponsoring du Comptable par l'AT
      hTC: { t: 'ids' } // hash de TC
    }
  }

  async phase2(args) {
    let espace
    try { espace = await this.setEspaceNs(args.ns, false) } catch (e) { /* */ }
    if (espace && !espace.cleET) 
      throw new AppExc(F_SRV, 203, [args.ns, args.org])

    const e2 = await Esp.getEspOrg(this, args.org)
    if (e2 && e2.id !== args.ns)
      throw new AppExc(F_SRV, 204, [args.ns, args.org])

    let cleE
    if (!espace) {
      cleE = Cles.espace(args.ns)
      const cleES = crypterSrv(this.db.appKey, cleE)
      espace = this.gd.nouvES(args.ns, args.org, cleES)
    } else {
      cleE = decrypterSrv(this.db.appKey, espace.cleES)
    }
    const cleET = crypter(args.TC, cleE)
    espace.reset(cleET, args.hTC)
  }
}

/* MajSponsEspace : Changement de la phrase de contact du Comptable */
operations.MajSponsEspace = class MajSponsEspace extends Operation {
  constructor (nom) { 
    super(nom, 3) 
    this.targs = {
      ns: { t: 'ns' }, // ID de l'espace [0-9][a-z][A-Z]
      org: { t: 'org' }, // code de l'organisation
      TC: { t: 'u8' }, // PBKFD de la phrase de sponsoring du Comptable par l'AT
      hTC: { t: 'ids' } // hash de TC
    }
  }

  async phase2(args) {
    const espace = await this.setEspaceNs(args.ns, false)

    if (!espace.cleET) throw new AppExc(F_SRV, 316)
    const cleE = decrypterSrv(this.db.appKey, espace.cleES)
    const cleET = crypter(args.TC, cleE)
    espace.reset(cleET, args.hTC)
  }
}

/* CreationComptable : création du comptable d'un nouvel espace
Création des rows:
- partition : primitive, avec le Comptable comme premier participant et délégué
- compte / compti / compta, avatar du Comptable
*/
operations.CreationComptable = class CreationComptable extends Operation {
  constructor (nom) { 
    super(nom, 0) 
    this.targs = {
      org: { t: 'org' }, // code de l'organisation
      idp: { t: 'idp' }, // ID de la partition primitive
      hTC: { t: 'ids' }, // hash du PBKFD de la phrase de sponsoring du Comptable
      hXR: { t: 'ids' }, // hash du PBKFD de la phrase secrète réduite
      hXC: { t: 'ids' }, // hash du PBKFD de la phrase secrète complète
      pub: { t: 'u8' }, // clé RSA publique du Comptable
      privK: { t: 'u8' }, //  clé RSA privée du Comptable cryptée par la clé K
      clePK: { t: 'u8' }, // clé P de la partition 1 cryptée par la clé K du Comptable
      cleEK: { t: 'u8' }, // clé E cryptée par la clé K
      cleAP: { t: 'u8' }, // clé A du Comptable cryptée par la clé de la partition
      cleAK: { t: 'u8' }, // clé A du Comptable cryptée par la clé K du Comptable
      cleKXC: { t: 'u8' }, //  clé K du Comptable cryptée par XC du Comptable (PBKFD de la phrase secrète complète).
      clePA: { t: 'u8' }, //  cle P de la partition cryptée par la clé A du Comptable
      ck: { t: 'u8' } //  {cleP, code} cryptés par la clé K du Comptable. 
        // cleP : clé P de la partition.
        // code : code / commentaire court de convenance attribué par le Comptable
    }
  }

  async phase2(args) {
    const cfg = config.creationComptable
    const espace = await this.setEspaceOrg(args.org, false)

    if (!espace.hTC) {
      await sleep(config.D1)
      throw new AppExc(F_SRV, 105)
    }
    if (espace.hTC !== args.hTC) {
      await sleep(config.D1)
      throw new AppExc(F_SRV, 106)
    }
    
    args.id = ID.duComptable()

    const qc = { qc: cfg.pqc, qn: cfg.pqn, qv: cfg.pqv } 
    const partition = await this.gd.nouvPA(args.idp, qc)

    // Compte Comptable
    const quotas = { qc: cfg.qc, qn: cfg.qn, qv: cfg.qv }
    const {compte, compta} = this.gd.nouvCO(args, null, quotas, cfg.cr)
    this.compte = compte

    partition.ajoutCompteO(compta, args.cleAP, true)

    const cvA = { id: args.id }
    this.gd.nouvAV(args, cvA)

    espace.comptableOK()
  }
}
