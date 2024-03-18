import { AppExc, F_SRV, A_SRV, ID, Compteurs,  d14 } from './api.mjs'
import { config } from './config.mjs'
import { operations } from './cfgexpress.mjs'
import { sleep, rnd6 } from './util.mjs'

import { Operation, assertKO} from './modele.mjs'
import { compile, Comptes, Avatars, Comptas, Chats } from './gendoc.mjs'
import { DataSync, Rds } from './api.mjs'

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
    if (this.sync)
      this.sync.setAboPartC(Rds.toId(partition.rds, this.ns), this.dh)
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

class OperationS extends Operation {
  constructor (nom, authMode, excFige) { super(nom, authMode, excFige) }

  async majDS (ds, avatar) {
    /* Mise à jour du DataSync en fonction des CCEP et des avatars / groupes actuels du compte */
    this.ds = new DataSync(ds)
    this.ds.compte = {
      id: this.compte.id,
      rds: this.compte.rds,
      vs: this.ds.compte.vs,
      vc: this.compte.v,
      vb: this.compte.v
    }
    this.ds.compta = {
      id: this.compta.id,
      rds: this.compta.rds,
      vs: this.ds.compta.vs,
      vc: this.compta.v,
      vb: this.compta.v
    }
    this.ds.espace = {
      id: this.espace.id,
      rds: this.espace.rds,
      vs: this.ds.espace.vs,
      vc: this.espace.v,
      vb: this.espace.v
    }
    if (this.estA) {
      this.ds.partition = { ...DataSync.vide }
    } else this.ds.partition = {
      id: this.partition.id,
      rds: this.partition.rds,
      vs: this.ds.partition.vs,
      vc: this.partition.v,
      vb: this.partition.v
    }

    if (avatar) { // Sur acceptation de sponsoring
      this.ds.avatars.set(avatar.id, {
        id: avatar.id,
        rds: avatar.rds,
        vs: 0,
        vb: avatar.v,
        vc: avatar.v
      })
    }
  } 

}

/* Sync : opération générique de synchronisation d'une session cliente
- optionC: 
  - true : recherche de toutes les versions du périmètre cohérentes
  - false : marque supprimés de dataSync les avatars / groupes  qui n'existent plus dans compte,
    recherche les versions des avatars / membres présents dans compte et pas dans dataSync
- ida: id long du sous-arbre à synchroniser ou 0
- dataSync: sérialisation de l'état de synchro de la session
*/
operations.Sync = class Sync extends OperationS {
  constructor (nom) { super(nom, 1, 1) }

  /* Analyse d'un groupe idg. x : élément de ds relatif au groupe 
  versions d'un groupe: { id, v, tv: [v, vg, vm, vn]}
  Retourne le groupe
  */
  async setGrx (idg, x) {
    const version = await this.getV({rds: x.rds})
    if (!version || version.suppr) { x.vb = [0,0,0,0]; return null }
    else { x.vb = [...version.tv]; x.vc = version.v }

    let gr = this.mgr.get(idg)
    if (gr === undefined) {
      gr = compile(await this.getRowGroupe(idg)) || null
      this.mgr.set(idg, gr)
    }

    if (gr === null) { x.vb = [0,0,0,0]; x.m = false; x.n = false; return null }
    // set de x.m x.n : un des avatars du compte a-t-il accès aux membres / notes
    const sim = this.compte.imGr(idg)
    if (sim.size) {
      const [mx, nx] = gr.amAn(sim)
      x.m = mx
      x.n = nx
    } else {
      x.m = false
      x.n = false
    }
    return gr
  }

  async getAvGrRows (ida) { // ida : ID long d'un sous-arbre avatar ou d'un groupe
    const g = ID.estGroupe(ida)
    /* Obtention des rows du sous-arbre */
    const m = g ? this.ds.groupes : this.ds.avatars
    const x = m.get(ida)
    
    if (g) {
      if (!x || !x.vb[0]) return
      const gr = await this.setGrx(ida, x)
      this.setRes('rowGroupe', gr.toShortRow(x.m))
      if (x.n) for (const row of await this.db.scoll(this, 'notes', ida, x.vs[3])) {
        const note = compile(row)
        this.addRes('rowNotes', note.toShortRow(this.id))
      }
      if (x.m) {
        for (const row of await this.db.scoll(this, 'membres', ida, x.vs[2]))
          this.addRes('rowMembres', row)
        for (const row of await this.db.scoll(this, 'chatgrs', ida, x.vs[2]))
          this.setRes('rowChatgr', row)
      }
    } else {
      if (!x || !x.vb) return
      const version = await this.getV({rds: x.rds})
      if (!version || version.suppr) { x.vb = 0; return }
      else { x.vb = version.v; x.vc = version.v }
      const rav = await this.getRowAvatar(ida)
      if (!rav) { x.vb = 0; return }
      this.setRes('rowAvatar', rav)

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
  }

  async phase2(args) {
    this.mgr = new Map() // Cache très locale et courte des groupes acquis dans l'opération

    /* Mise à jour du DataSync en fonction des CCEP et des avatars / groupes actuels du compte */
    this.majDS(args.dataSync)

    /* mise à nouveau des listes avatars / groupes du dataSync
    en fonction des avatars et groupes listés dans mav/mpg du compte */
    this.compte.majPerimetreDataSync(this.ds)  

    if (args.optionC) {

      this.db.setSyncData(this)
      // Recherche des versions des avatars
      for(const [, x] of this.ds.avatars) {
        const version = await this.getV({rds: x.rds})
        if (!version || version.suppr) x.vb = 0
        else { x.vb = version.v; x.vc = version.v }
      }
      // Recherche des versions des groupes
      for(const [idg, x] of this.ds.groupes)
        await this.setGrx(idg, x)
      this.ds.dhc = this.dh

      // Report de la consommation du compte cnv dans son Partition et maj syntheses
      if (!this.compte.estA) {
        const s = this.partition.reportCNV(this.compte, this.compta)
        const synthese = compile(await this.getRowSynthese(this.ns))
        if (synthese) {
          synthese.tp[ID.court(this.compte.partitionId)] = s
          synthese.v = this.dh
          this.update(synthese.toRow())
        }
      }

    } else { // Maj du dataSync en fonction de compte

      // Inscription dans DataSync des nouveaux avatars qui n'y étaient pas et sont dans compte
      for (const idx in this.compte.mav) {
        const id = ID.long(parseInt(idx), this.ns)
        if (!this.ds.avatars.get(id)) { // recherche du versions et ajout dans le DataSync
          const rds = this.compte.mav[idx].rds
          const version = await this.getV({ rds }) // objet ayant une propriété rds
          if (version && !version.suppr) {
            this.ds.avatars.set(id, {
              id: id,
              rds: rds,
              vs: 0,
              vb: version.v,
              vc: version.v
            })
          }
        }

      }
      // Suppression des avatars de DataSync qui n'existent plus
      for (const id of this.ds.avIdSet)
        if (!this.compte.mav[ID.court(id)]) this.ds.avatars.delete(id)

      // Inscription dans DataSync des nouveaux groupes qui n'y étaient pas et sont dans compte
      for (const idx in this.compte.mpg) {
        const idg = ID.long(parseInt(idx), this.ns)
        let x = this.ds.groupes.get(idg)
        if (!x) {
          const { rds } = this.compte.mpg[idx]
          x = { ...DataSync.videg}
          x.id = idg
          x.rds = rds
        }
        /* Analyse d'un groupe idg. x : élément de ds relatif au groupe (m et n fixés) */
        const gr = await this.setGrx(idg, x)
        if (gr) // le groupe existe vraiment !
          this.ds.groupes.set(idg, x)
      }
      // Suppression des groupes de DataSync qui n'existent plus
      for (const id of this.ds.grIdSet)
        if (!this.compte.mpg[ID.court(id)]) this.ds.groupes.delete(id)
    }

    if (args.ida) await this.getAvGrRows(args.ida)

    // Sérialisation et retour de dataSync, rows compte, compta, espace, partition
    this.setRes('dataSync', this.ds.serial)
    if (args.optionC || (this.ds.compte.vs < this.ds.compte.vb)) 
      this.setRes('rowCompte', this.compte.toRow())
    if (args.optionC || (this.ds.espace.vs < this.ds.espace.vb)) 
      this.setRes('rowEspace', this.espace.toRow())
    if (this.ds.partition.id && (args.optionC || (this.ds.partition.vs < this.ds.partition.vb)))
      this.setRes('rowPartition', this.partition.toShortRow(this.compte.del))
    // compta est TOUJOURS transmis par l'opération (après maj éventuelle des consos)

    // Mise à jour des abonnements aux versions
    if (this.sync) this.sync.setAboRds(this.ds.tousRds(this.ns), this.dh)
  }
}

/* Sync2 : opération de synchronisation d'une session cliente
remontant les seuls rows comptes, comptas, espaces et partitions
quand leurs versions actuelles sont postérieures à celles detenues
en session.
- dataSync: sérialisation de l'état de synchro de la session
Retour:
- dataSync : sérialisation du DataSync mis à jour
- rowcompte rowCompta rowEspace rowPartition
*/
operations.Sync2 = class Sync2 extends OperationS {
  constructor (nom) { super(nom, 1, 1) }

  async phase2(args) {
    const ds = new DataSync(args.dataSync)
    if (this.compte.v > ds.compte.vs) {
      ds.compte.vb = this.compte.v
      this.setRes('rowCompte', this.compte.toRow())
    }
    if (this.compta.v > ds.compta.vs) {
      ds.compta.vb = this.compta.v
      this.setRes('rowCompta', this.compta.toRow())
    }
    if (this.espace.v > ds.espace.vs) {
      ds.espace.vb = this.espace.v
      this.setRes('rowEspace', this.espace.toRow())
    }
    if (this.partition) {
      const vs = ds.partition && (ds.partition.id === this.partition.id) ? ds.partition.vs : 0
      ds.partition = { 
        id: this.partition.id, 
        rds: this.partition.rds, 
        vs: vs, 
        vc: this.partition.v, 
        vb: this.partition.v 
      }
      this.setRes('rowPartition', this.partition.toShortRow(this.compte.del))
    } else {
      ds.partition = { ...DataSync.vide }
    }
    this.setRes('dataSync', ds.serial)
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
- rowEspace
- rowPartition si compte O
- rowCompte 
- rowAvater 
- rowChat si la confidentialité n'a pas été requise
- notifs
- conso

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
operations.SyncSp = class SyncSp extends OperationS {
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

    /* Création compte */
    const rdsav = Rds.nouveau(Rds.AVATAR)
    // (id, hXR, hXC, cleKXR, rdsav, cleAK, o, cs)
    const compte = Comptes.nouveau(args.id, 
      (this.ns * d14) + (args.hXR % d14), args.hXC, args.cleKXC, null, rdsav, args.cleAK, o)
    this.insert(compte.toRow())
    this.setNV(compte)

    /* Création compta */
    const nc = !sp.dconf && !args.dconf ? 1 : 0
    const qv = { qc: qs.qc, qn: qs.qn, qv: qs.qv, nn: 0, nc: nc, ng: 0, v: 0 }
    const compta = new Comptas().init({
      id: compte.id, v: 1, rds: Rds.nouveau(Rds.COMPTA), qv,
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
      this.setRes('rowCompta', compta.toRow())
      this.setRes('rowEspace', espace.toRow())
      if (partition) this.setRes('rowPartition', partition.toShortRow(sp.del))
      this.setRes('rowAvatar', avatar.toRow())
      if (chI) this.setRes('rowChat', chI.toRow())

      this.compte = compte
      this.estA = compte.estA
      this.compta = compta
      this.espace = espace
      if (partition) this.partition = partition
      this.majDS(DataSync.nouveau().serial, avatar)
      this.setRes('dataSync', this.ds.serial)
    }
  }
}
