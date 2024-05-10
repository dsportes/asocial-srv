import { AppExc, F_SRV, A_SRV, ID, d14 } from './api.mjs'
import { config } from './config.mjs'
import { operations } from './cfgexpress.mjs'
import { sleep, crypterSrv } from './util.mjs'

import { Operation, assertKO, Cache, R } from './modele.mjs'
import { compile, Espaces, Partitions, Syntheses, Comptes, Comptis, Avatars, Comptas, Chats } from './gendoc.mjs'
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
  constructor (nom) { super(nom, 0) }

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
  constructor (nom) { super(nom, 0) }

  async phase2(args) {
    if (args.to) await sleep(args.to * 1000)
    throw new AppExc(F_SRV, 1, [args.texte])
  }
}

/** Test d'accès à la base ***************************************
GET
Retourne les date-heures de derniers ping (le précédent et celui posé)
*/
operations.PingDB = class PingDB extends Operation {
  constructor (nom) { super(nom, 0) }

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
    this.setRes('espaces', await this.db.coll(this, 'espaces'))
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
    await this.getEspaceLazy(ID.ns(args.id))
    if (this.setR.has(R.CLOS)) throw new AppExc(A_SRV, 999, [this.notifE.texte, this.notifE.dh])
    
    const avatar = compile(await this.getRowAvatar(args.id, 'getPub'))
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
    const espace = await this.getEspaceOrg(args.org)
    if (!espace) { sleep(3000); return }

    this.ns = espace.id
    const n = espace.notifE
    if (n && n.nr === 3) // application close
      throw new AppExc(A_SRV, 999, [n.texte, n.dh])

    const ids = (espace.id * d14) + (args.hps1 % d14) // par précaution
    const row = await this.db.getSponsoringIds(this, ids)
    if (!row) { sleep(3000); return }
    this.setRes('rowSponsoring', row)
  }
}

/* Recherche hash de phrase ***************************************
Pour Acceptation Sponsoring
args.hps1 : ns + hps1 de la phrase de contact / de connexion
args.t :
  - 1 : phrase de connexion(hps1 de compta)
Retour:
- existe : true si le hash de la phrase existe
*/
operations.ExistePhrase1 = class ExistePhrase1 extends Operation {
  constructor (nom) { super(nom, 0) }

  async phase2 (args) {
    await this.getEspaceLazy(ID.ns(args.hps1))
    if (this.setR.has(R.CLOS)) throw new AppExc(A_SRV, 999, [this.notifE.texte, this.notifE.dh])

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

Exceptions:
- `A_SRV, 13` : sponsorings non trouvé
- `F_SRV, 9` : le sponsoring a déjà été accepté ou refusé ou est hors limite.
- F_SRV, 212: solde du sonsor ne couvre pas son don
- A_SRV, 999: application close
- F_SRV, 101: application figée
- F_SRV, 211: quotas restants de la partition insuffisants pour couvrir les quotas proposés au compte
- A_SRV, 16: syntheses non trouvée
- A_SRV, 1: espace non trouvé
- A_SRV, 2: partition non trouvée
- A_SRV, 8: avatar sponsor non trouvé
*/
operations.SyncSp = class SyncSp extends Operation {
  constructor (nom) { super(nom, 0) }

  async phase2 (args) {
    this.ns = ID.ns(args.idsp)
    await this.getEspaceLazy(this.ns)
    if (this.setR.has(R.CLOS)) throw new AppExc(A_SRV, 999, [this.notifE.texte, this.notifE.dh])

    // Recherche du sponsorings
    const sp = compile(await this.db.get(this, 'sponsorings', args.idsp, args.idssp))
    if (!sp) throw assertKO('SyncSp-1', 13, [args.idsp, args.idssp])
    if (sp.st !== 0 || sp.dlv < this.auj) throw new AppExc(F_SRV, 9, [args.idsp, args.idsp])
    if (sp.hYC !== args.hYC) throw new AppExc(F_SRV, 217)

    // Maj du sponsoring: st dconf2 dh ardYC
    const avsponsor = compile(await this.getRowAvatar(args.idsp, 'SyncSp-10'))
    const vsp = await this.getV(avsponsor, 'SyncSp-3')
    vsp.v++
    sp.v = vsp.v
    const dhsp = sp.dh || 0
    sp.dh = this.dh
    sp.st = 2
    sp.ardYC = args.ardYC
    sp.dconf2 = args.dconf
    this.update(sp.toRow())
    this.setV(vsp)

    // Maj compta du sponsor (si don)
    if (sp.don) { 
      const csp = compile(await this.getRowCompta(args.idsp, 'SyncSp-8'))
      if (csp.estA) {
        if (csp.solde <= sp.don + 2)
          throw new AppExc(F_SRV, 212, [csp.solde, sp.don])
        csp.v++
        csp.solde-= sp.don
        this.update(csp.toRow()) 
      }
    }

    // Refus si espace figé ou clos
    this.espace = compile(await this.getRowEspace(this.ns, 'SyncSp-3'))
    if (this.espace.notifE) {
      // Espace bloqué
      const n = this.espace.notifE
      if (n.nr === 3) // application close
        throw new AppExc(A_SRV, 999, [n.texte])
      if (n.nr === 2) 
        throw new AppExc(F_SRV, 101, [n.texte])
    }

    // Création du nouveau compte
    const pid = sp.partitionId ? ID.long(sp.partitionId, this.ns) : 0
    const rdsav = ID.rds(ID.RDSAVATAR)
    const qv = { qc: sp.quotas.qc, qn: sp.quotas.qn, qv: sp.quotas.qv, nn: 0, nc: 0, ng: 0, v: 0 }
    const q = { qc: qv.qc, qn: qv.qn, qv: qv.qv, c: 0, n: 0, v: 0 } // partition

    const o = sp.partitionId ? { clePA: args.clePA, del: sp.del, idp: sp.partitionId } : null
    // id, hXR, hXC, cleKXC, rdsav, cleAK, clePK, qvc, o, tpk
    this.compte = Comptes.nouveau(args.id, 
      (this.ns * d14) + (args.hXR % d14), 
      args.hXC, args.cleKXC, args.privK, rdsav, args.cleAK, args.clePK, null, sp.quotas, o)
    /* Le row compte VA ETRE MIS A JOUR après la phase 2 - Voir phase 3
      this.setRes('rowCompte', this.compte.toShortRow())
    */

    /* Compti */
    const compti = new Comptis().init({ id: args.id, v: 1, mc: {} })
    this.setRes('rowCompti', this.insert(compti.toRow()))

    /* Compta */
    this.compta = Comptas.nouveau(args.id, qv)
    this.compta.solde = sp.don || 0
    this.compta.compile() // pour calculer c2m ...

    /* Avatar  (id, rdsav, pub, privK, cvA) */
    const avatar = Avatars.nouveau(args.id, rdsav, args.pub, args.privK, args.cvA)
    this.setNV(avatar)
    this.insert(avatar.toRow()) 
    this.setRes('rowAvatar', avatar.toShortRow())

    // création du dataSync
    const ds = DataSync.deserial()
    ds.rdsId = {}
    ds.compte.vb = 1
    ds.rdsC = ID.long(this.compte.rds, this.ns)
    const a = { id: avatar.id, vs: 0, vb: avatar.v }
    ds.avatars.set(a.id, a)
    ds.rdsId[ID.long(avatar.rds, this.ns)] = avatar.id
    ds.tousRds.length = 0
    for(const rdsx in ds.rdsId) ds.tousRds.push(parseInt(rdsx))
    ds.tousRds.push(ds.rdsC) // rds du compte
    ds.tousRds.push(this.ns) // espace
    // Sérialisation et retour de dataSync
    this.setRes('dataSync', ds.serial(this.dh, this.crypt, this.db.appKey))

    // Compte O : partition: ajout d'un compte (si quotas suffisants)
    if (pid) {
      if (!this.partitions) this.partitions = new Map()
      const partition =  compile(await this.getRowPartition(pid), 'SyncSp-4')
      this.partitions.set(pid, partition)
      const s = partition.getSynthese()
      // restants à attribuer suffisant pour satisfaire les quotas ?
      if (q.qc > (s.q.qc - s.qt.qc) || q.qn > (s.q.qn - s.qt.qn) || q.qv > (s.q.qv - s.qt.qv))
        throw new AppExc(F_SRV, 211, [pid, args.id])
      // (compta, cleAP, del)
      partition.ajoutCompte(this.compta, args.cleAP, sp.del)
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
      const chI = new Chats().init({ // du sponsorisé
        id: args.id,
        ids: idsI,
        v: 1,
        st: 10,
        idE: ID.court(sp.id),
        idsE: idsE,
        cvE: avsponsor.cvA,
        cleCKP: args.ch.ccK,
        cleEC: args.ch.cleE1C,
        items: [{a: 1, dh: dhsp, t: args.ch.t1c}, {a: 0, dh: this.dh, t: args.ch.t2c}]
      })
      this.setRes('rowChat', this.insert(chI.toRow()))
      this.compta.ncPlus(1)

      const vchE = await this.getV(avsponsor, 'SyncSp-11') // du sponsor
      vchE.v++
      this.setV(vchE)
      const chE = new Chats().init({
        id: sp.id,
        ids: idsE,
        v: vchE.v,
        st: 1,
        idE: ID.court(chI.id),
        idsE: idsI,
        cvE: avatar.cvA,
        cleCKP: args.ch.ccP,
        cleEC: args.ch.cleE2C,
        items: [{a: 0, dh: dhsp, t: args.ch.t1c}, {a: 1, dh: this.dh, t: args.ch.t2c}]
      })
      this.insert(chE.toRow())
    }
    const espace = compile(await this.getRowEspace(this.ns, 'SyncSp-es')) 
    this.setRes('rowEspace', espace.toShortRow())
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
    this.ns = ID.ns(args.id)
    await this.getEspaceLazy(this.ns)
    if (this.setR.has(R.CLOS)) throw new AppExc(A_SRV, 999, [this.notifE.texte, this.notifE.dh])

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
    await this.getEspaceLazy(ID.ns(args.hps1))
    if (this.setR.has(R.CLOS)) throw new AppExc(A_SRV, 999, [this.notifE.texte, this.notifE.dh])

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

/* GetPartition : retourne une partition
- token : éléments d'authentification du compte.
- id : id de la partition
*/
operations.GetPartition = class GetPartition extends Operation {
  constructor (nom) { super(nom, 1, 1) }

  async phase2 (args) {
    if (this.compte.estA) throw new AppExc(F_SRV, 220)
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
    const espace = compile(await this.getRowEspace(this.estAdmin ? args.ns : this.ns, 'GetEspace'))
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
        this.addRes('rowMembres', row)
      for (const row of await this.db.scoll(this, 'chatgrs', ida, x.ms ? x.vs : 0))
        this.addRes('rowChatgrs', row)
    }

    /* SI la session avait des notes chargées, chargement incrémental depuis vs
    SINON chargement initial de puis 0 */
    if (x.n) for (const row of await this.db.scoll(this, 'notes', ida, x.ns ? x.vs : 0)) {
      const note = compile(row)
      this.addRes('rowNotes', note.toShortRow(this.id))
    }
  }
  
  async getAvRows (ida, x) { // ida : ID long d'un sous-arbre avatar ou d'un groupe
    const rav = await this.db.getV(this, 'avatars', ida, x.vs)
    if (rav) this.addRes('rowAvatars', rav)

    for (const row of await this.db.scoll(this, 'notes', ida, x.vs))
      this.addRes('rowNotes', row)
    for (const row of await this.db.scoll(this, 'chats', ida, x.vs))
      this.addRes('rowChats', row)
    for (const row of await this.db.scoll(this, 'sponsorings', ida, x.vs))
      this.addRes('rowSponsorings', row)
    if (ID.estComptable(this.id)) 
      for (const row of await this.db.scoll(this, 'tickets', ida, x.vs)) {
        const tk = compile(row)
        this.addRes('rowTickets', tk.toShortRow())
      }
  }

  async setAv (ida, rds) {
    const x = this.ds.avatars.get(ida)
    if (x) {
      const version = rds ? await this.getV({ rds }) : null
      if (!version || version.suppr) {
        // NORMALEMENT l'avatar aurait déjà du être supprimé de compte/mav AVANT
        delete this.idRds[ida]; delete this.rdsId[rds]
        this.ds.avatars.delete(ida)
      }
      else x.vb = version.v
    }
  }

  async setGr (idg, rds) {
    const x = this.ds.groupes.get(idg)
    const g = await this.getGr(idg)
    if (x) {
      const version = rds ? await this.getV({rds}) : null
      if (!g || !version || version.suppr) {
        // NORMALEMENT le groupe aurait déjà du être enlevé de compte/mpg AVANT
        delete this.idRds[idg]; delete this.rdsId[rds]
        this.ds.groupes.delete(idg)
      } else {
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

  async phase2(args) {
    this.mgr = new Map() // Cache locale des groupes acquis dans l'opération
    this.cnx = !args.dataSync
    const srds = args.lrds ? new Set(args.lrds) : new Set()

    /* Mise à jour du DataSync en fonction du compte et des avatars / groupes actuels du compte */
    this.ds = DataSync.deserial(this.cnx ? null : args.dataSync, this.decrypt, this.db.appKey)

    const vcpt = await this.getV(this.compte)
    this.ds.compte.vb = vcpt.v
    this.ds.rdsC = ID.long(this.compte.rds, this.ns)

    if (this.cnx || (this.ds.compte.vs < this.ds.compte.vb))
      this.setRes('rowCompte', this.compte.toShortRow())
    let rowCompti = Cache.aVersion('comptis', this.compte.id, vcpt.v) // déjà en cache ?
    if (!rowCompti) rowCompti = await this.getRowCompti(this.compte.id)
    if (this.cnx || (rowCompti.v > this.ds.compte.vs)) 
      this.setRes('rowCompti', rowCompti)

    /* Mise à niveau des listes avatars / groupes du dataSync
    en fonction des avatars et groupes listés dans mav/mpg du compte 
    Ajoute les manquants dans ds, supprime ceux de ds absents de mav / mpg
    Pour CHAQUE GROUPE les indicateurs m et n NE SONT PAS bien positionnés.
    */
    this.compte.majPerimetreDataSync(this.ds, srds)  

    if (this.cnx) {
      // Recherche des versions vb de TOUS les avatars requis
      for(const [ida,] of this.ds.avatars)
        await this.setAv(ida, this.ds.idRds[ida])

      // Recherche des versions vb de TOUS les groupes requis
      for(const [idg,] of this.ds.groupes) 
        await this.setGr(idg, this.ds.idRds[idg])
        
    } else {
      /* Recherche des versions uniquement pour les avatars / groupes signalés 
      comme ayant (a priori) changé de version 
      OU ceux apparus / disparus détectés par la maj du périmètre vi-avant*/
      if (srds.size) for(const rds of srds) {
        const id = this.ds.rdsId[rds]
        if (id) {
          if (ID.estAvatar(id)) await this.setAv(id, rds)
          if (ID.estGroupe(id)) await this.setGr(id, rds)
        } else delete this.ds.rdsId[rds]
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

    this.ds.tousRds.length = 0
    for(const rdsx in this.ds.rdsId) this.ds.tousRds.push(parseInt(rdsx))
    this.ds.tousRds.push(this.ds.rdsC) // rds du compte
    this.ds.tousRds.push(this.ns) // espace
    // Sérialisation et retour de dataSync
    this.setRes('dataSync', this.ds.serial(this.dh, this.crypt, this.db.appKey))

    // Mise à jour des abonnements aux versions
    if (this.sync) this.sync.setAboRds(this.ds.tousRds, this.dh)
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
    const cleES = crypterSrv(this.db.appKey, args.cleE)
    this.espace = Espaces.nouveau(args.ns, args.org, this.auj, cleES)

    /* Partition et Synthese */
    if (!this.partitions) this.partitions = new Map()
    const partition = Partitions.nouveau(args.ns, 1, qc)
    this.partitions.set(partition.id, partition)
    this.synthese = Syntheses.nouveau(args.ns)

    /* Compte Comptable */
    const o = { clePA: args.clePA, del: true, idp: 1 }
    // id, hXR, hXC, cleKXC, rdsav, cleAK, clePK, qvc, o, tpk
    this.compte = Comptes.nouveau(idComptable, 
      (args.ns * d14) + (args.hXR % d14), 
      args.hXC, args.cleKXC, args.privK, rdsav, args.cleAK, args.clePK, args.cleEK, qvc, o, args.ck)
    
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
    const cc = compile(await this.getRowCompte(args.id, 'GetNotifC-1'))
    if (!cc.idp) throw new AppExc(F_SRV, 230)
    if (cc.notif) this.setRes('notif', cc.notif)
    if (this.estComptable) return
    const part = compile(await this.getRowPartition(ID.long(cc.idp, this.ns), 'GetNotifC-2'))
    if (!part.estDel(this.id)) throw new AppExc(F_SRV, 231)
  }
}
