import { AppExc, F_SRV, A_SRV, ID, Compteurs,  d14 } from './api.mjs'
import { config } from './config.mjs'
import { operations } from './cfgexpress.mjs'
import { sleep, rnd6, decrypterSrv, crypterSrv } from './util.mjs'
import { encode, decode } from '@msgpack/msgpack'

import { Operation, assertKO, Cache } from './modele.mjs'
import { compile, Comptes, Comptis, Avatars, Comptas, Chats } from './gendoc.mjs'
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

/* Opérations de test / ping ****************************************************/

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

/* Opérations de lectures non synchronisées *****************************/

/* Retourne la clé RSA publique d'un avatar
- id : id de l'avatar
*/
operations.GetPub = class GetPub extends Operation {
  constructor (nom) { super(nom, 0) }

  async phase2 (args) {
    const avatar = compile(await this.getRowAvatar(args.id, 'getPub'))
    this.setRes('pub', avatar.pub)
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
    const rowSynthese = await this.getRowSynthese(ns, 'getSynthese')
    this.setRes('rowSynthese', rowSynthese)
  }
}

/* `GetPartitionC` : retourne la partition demandée (Comptable seulement).
- `token` : éléments d'authentification du comptable.
- `id` : id de la partition (rendre courante)
Retour:
- `rowPartition`
*/
operations.GetPartitionC = class GetPartitionC extends Operation {
  constructor (nom) { super(nom, 2, 1) }

  async phase2 (args) {
    const partition = compile(await this.getRowPartition(args.id, 'getPartitionC'))
    this.setRes('rowPartition', partition.toRow())
  }
}

/* Recherche hash de phrase ***************************************
args.hps1 : ns + hps1 de la phrase de contact / de connexion
args.t :
  - 1 : phrase de connexion(hps1 de compta)
Retour:
- existe : true si le hash de la phrase existe
*/
operations.ExistePhrase1 = class ExistePhrase1 extends Operation {
  constructor (nom) { super(nom, 0) }

  async phase2 (args) {
    if (await this.db.getCompteHXR(this, args.hps1)) this.setRes('existe', true)
  }
}

/* Recherche hash de phrase ******
args.hps1 : ns + hps1 de la phrase de contact / de connexion
args.t :
  - 2 : phrase de sponsoring (ids)
  - 3 : phrase de contact (hpc d'avatar)
Retour:
- existe : true si le hash de la phrase existe
*/
operations.ExistePhrase = class ExistePhrase extends Operation {
  constructor (nom) { super(nom, 1)  }

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
    const ids = (espace.id * d14) + (args.hps1 % d14) // par précaution
    const row = await this.db.getSponsoringIds(this, ids)
    if (!row) { sleep(3000); return }
    this.setRes('rowSponsoring', row)
  }
}

/* Opérations de Synchronisation et de lectures non synchronisées ********/

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
    let g = this.mgr(idg)
    if (g === undefined) {
      g = compile(await this.getRowGroupe(idg)) || null
      this.mgr.set(idg, g)
    }
    return g
  }

  async getGrRows (ida, x) { 
    // ida : ID long d'un sous-arbre avatar ou d'un groupe. x : son item dans ds
    let gr = this.mgr.get(ida) // on a pu aller chercher le plus récent si cnx
    if (!gr) gr = await this.db.getV(this, 'groupes', ida, x.vs[1])
    if (gr) this.addRes('rowGroupes', gr.toShortRow(x.m))

    if (x.m) {
      for (const row of await this.db.scoll(this, 'membres', ida, x.vs[2]))
        this.addRes('rowMembres', row)
      for (const row of await this.db.scoll(this, 'chatgrs', ida, x.vs[2]))
        this.addRes('rowChatgrs', row)
    }

    if (x.n) for (const row of await this.db.scoll(this, 'notes', ida, x.vs[3])) {
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
      this.addRes('rowSponsorings', compile(row).toShortRow())
    if (ID.estComptable(this.id)) 
      for (const row of await this.db.scoll(this, 'tickets', ida, x.vs))
        this.addRes('rowTickets', row)
  }

  decrypt (k, x) { return decode(decrypterSrv(k, Buffer.from(x))) }

  crypt (k, x) { return crypterSrv(k, Buffer.from(encode(x))) }

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
        x.vb = [...version.tv]
        // reset de x.m x.n : un des avatars du compte a-t-il accès aux membres / notes
        const sim = this.compte.imGr(idg)
        if (sim.size) { const [mx, nx] = g.amAn(sim); x.m = mx; x.n = nx }
        else { x.m = false; x.n = false }
      }
    }
  }

  async phase2(args) {
    this.mgr = new Map() // Cache locale des groupes acquis dans l'opération
    this.cnx = !args.dataSync

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
    this.compte.majPerimetreDataSync(this.ds)  

    if (this.cnx) {
      // Recherche des versions vb de TOUS les avatars requis
      for(const [ida,] of this.ds.avatars)
        await this.setAv(ida, this.ds.idRds[ida])

      // Recherche des versions vb[] de TOUS les groupes requis
      for(const [idg,] of this.ds.groupes) 
        await this.setGr(idg, this.ds.idRds[idg])
        
    } else {
      /* Recherche des versions uniquement pour les avatars / groupes signalés 
      comme ayant (a priori) changé de version */
      if (args.lrds) for(const rds of args.lrds) {
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
        if (x.vs < x.vb) {
          await this.getAvRows(ida, x)
          if (this.nl - n > 20) break
        }
      }
      if (this.nl - n <= 20) for(const [idg, x] of this.ds.groupes) {
        if (x.vs[0] < x.vb[0]) {
          await this.getGrRows(idg, x)
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

/* SyncSp - synchronisation sur ouverture d'une session à l'acceptation d'un sponsoring
- `token` : éléments d'authentification du compte à créer
- idsp idssp : identifiant du sponsoring
- id : id du compte sponsorisé à créer
- hXR: hash du PBKD de sa phrase secrète réduite
- hXC: hash du PBKD de sa phrase secrète complète
- cleKXC: clé K du nouveau compte cryptée par le PBKFD de sa phrase secrète complète
- cleAK: clé A de son avatar principal cryptée par la clé K du compte
- ardYC: ardoise du sponsoring
- dconf: du sponsorisé
- pub: clé RSA publique de l'avatar
- privK: clé privée RSA de l(avatar cryptée par la clé K du compte
- cvA: CV de l'avatar cryptée par sa clé A

- clePA: clé P de sa partition cryptée par la clé A de son avatar principal
- cleAP: clé A de son avatar principâl cryptée par la clé P de sa partition

- ch: { cck, ccP, t1c, t2c }
  - ccK: clé C du chat cryptée par la clé K du compte
  - ccP: clé C du chat cryptée par la clé publique de l'avatar sponsor
  - cleE1C: clé A de l'avatar E (sponsor) cryptée par la clé du chat.
  - cleE2C: clé A de l'avatar E (sponsorisé) cryptée par la clé du chat.
  - t1c: mot du sponsor crypté par la clé C
  - t2c: mot du sponsorisé crypté par la clé C

Retour: 
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

    /* Maj sponsorings: st dconf2 dh ardYC */
    const sp = compile(await this.db.get(this, 'sponsorings', args.idsp, args.idssp))
    if (!sp) throw assertKO('SyncSp-1', 13, [args.idsp, args.idssp])
    if (sp.st !== 0 || sp.dlv < this.auj) throw new AppExc(F_SRV, 9, [args.idsp, args.idsp])

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
    this.update(vsp.toRow())

    if (sp.don) { // Maj compta du sponsor
      const csp = compile(await this.getRowCompta(args.idsp, 'SyncSp-8'))
      if (csp.solde <= sp.don + 2)
        throw new AppExc(F_SRV, 212, [csp.solde, sp.don])
      csp.v++
      csp.solde-= sp.don
      this.update(csp.toRow())
      this.setNV(csp)  
    }

    // Refus si espace figé ou clos
    const espace = compile(await this.getRowEspace(this.ns, 'SyncSp-3'))
    if (espace.notifG) {
      // Espace bloqué
      const n = espace.notifG
      if (n.nr === 2) // application close
        throw new AppExc(A_SRV, 999, [n.texte])
      if (n.nr === 1) 
        throw new AppExc(F_SRV, 101, [n.texte])
      this.notifs.G = n
    }

    /* Compte O : partition: ajout d'un item dans tcpt, maj ldel
    Recalcul syntheses : tp du numéro de partition
    */
    let o = null
    const qs = sp.quotas
    let partition = null
    if (sp.partitionId) {
      const pid = ID.long(sp.partitionId, this.ns)
      partition =  compile(await this.getRowPartition(pid), 'SyncSp-4')
      partition.v++
      const s = partition.getSynthese()
      const q = { qc: qs.qc, qn: qs.qn, qv: qs.qv, c: 0, n: 0, v: 0}
      // restants à attribuer suffisant pour satisfaire les quotas ?
      if (q.qc > (s.qc - s.ac) || q.qn > (s.qn - s.an) || q.qv > (s.sv - s.av))
        throw new AppExc(F_SRV, 211, [partition.id, args.id])
      const it = partition.ajoutCompte(null, q, args.cleAP, sp.del)
      partition.setNotifs(this.notifs, it)
      const synth = partition.getSynthese()

      const synthese = compile(await this.getRowSynthese(this.ns, 'SyncSp-5'))
      synthese.v = this.dh
      synthese.tp[ID.court(partition.id)] = synth
      this.update(synthese.toRow())
      this.setNV(partition)
      this.update(partition.toRow())

      o = { // Info du compte à propos de sa partition
        clePA: args.clePA,
        rdsp: partition.rds,
        idp: ID.court(partition.id),
        del: sp.del,
        it: it
      }
    }

    /* Création compte / compti */
    const rdsav = ID.rds(ID.RDSAVATAR)
    // (id, hXR, hXC, cleKXR, rdsav, cleAK, o, cs)
    const compte = Comptes.nouveau(args.id, 
      (this.ns * d14) + (args.hXR % d14), args.hXC, args.cleKXC, null, rdsav, args.cleAK, o)
    const compti = Comptis.nouveau(args.id, compte.rds) 
    this.insert(compte.toRow())
    this.insert(compti.toRow())
    this.setNV(compte)    
    
    /* Création compta */
    const nc = !sp.dconf && !args.dconf ? 1 : 0
    const qv = { qc: qs.qc, qn: qs.qn, qv: qs.qv, nn: 0, nc: nc, ng: 0, v: 0 }
    const compta = new Comptas().init({
      id: compte.id, v: 1, qv,
      compteurs: new Compteurs(null, qv).serial
    })
    compta.total = sp.don || 0
    compta.compile() // pour calculer les notifs
    if (compta._Q) this.notifs.Q = compta._Q
    if (compta._X) this.notifs.X = compta._X
    this.insert(compta.toRow())
    this.setNV(compta)
    
    /* Création Avatar */
    const avatar = new Avatars().init(
      { id: compte.id, v: 1, rds: rdsav, pub: args.pub, privK: args.privK, cvA: args.cvA })
    this.insert(avatar.toRow())
    this.setNV(avatar)

    /* Création chat */
    let chI = null
    if (!sp.dconf && !args.dconf) {
      /*- ccK: clé C du chat cryptée par la clé K du compte
        - ccP: clé C du chat cryptée par la clé publique de l'avatar sponsor
        - cleE1C: clé A de l'avatar E (sponsor) cryptée par la clé du chat.
        - cleE2C: clé A de l'avatar E (sponsorisé) cryptée par la clé du chat.
      */
      chI = new Chats().init({ // du sponsorisé
        id: args.id,
        ids: rnd6(),
        v: 1,
        st: 10,
        idE: ID.court(sp.id),
        idsE: rnd6(),
        cvE: avsponsor.cvA,
        cleCKP: args.ch.ccK,
        cleEC: args.ch.cleE1C,
        items: [{a: 1, dh: dhsp, t: args.ch.t1c}, {a: 0, dh: this.dh, t: args.ch.t2c}]
      })
      this.insert(chI.toRow())

      const vchE = await this.getV(avsponsor, 'SyncSp-11') // du sponsor
      vchE.v++
      this.setV(vchE)
      const chE = new Chats().init({
        id: sp.id,
        ids: chI.idsE,
        v: vchE.v,
        st: 1,
        idE: ID.court(chI.id),
        idsE: chI.ids,
        cvE: avatar.cvA,
        cleCKP: args.ch.ccP,
        cleEC: args.ch.cleE2C,
        items: [{a: 0, dh: dhsp, t: args.ch.t1c}, {a: 1, dh: this.dh, t: args.ch.t2c}]
      })
      this.insert(chE.toRow())

      this.setRes('rowCompte', compte.toRow())
      this.setRes('rowCompti', compta.toRow())
      if (chI) this.setRes('rowChat', chI.toRow())

      this.compte = compte
      this.estA = compte.estA
      this.compta = compta
      this.espace = espace
      if (partition) this.partition = partition
    }
  }
}

/* Get Espace **************************************************
args.token: éléments d'authentification du compte.
args.ns : ns pour l'administrateur
**Propriétés accessibles :**
- administrateur technique : toutes de tous les espaces.
- Comptable : toutes de _son_ espace.
- Délégués : sur leur espace seulement,
  - `id v org creation notifE opt`
  - la notification de _leur_ partition est recopiée de tnotifP[p] en notifP.
- Autres comptes: pas d'accès.
Retour:
- rowEspace s'il existe
*/
operations.GetEspace = class GetEspace extends Operation {
  constructor (nom) { super(nom, 1, 1) }

  async phase2 (args) {
    const espace = compile(await this.getRowEspace(this.estAdmin ? args.ns : this.ns, 'GetEspace'))
    let rowEspace
    if (this.estAdmin || this.estComptable) rowEspace = espace.toRow()
    else rowEspace = espace.toShortRow(this.compte.idp)
    this.setRes('rowEspace', rowEspace)
  }
}
