import { AppExc, F_SRV, A_SRV, ID, Compteurs,  d14 } from './api.mjs'
import { config } from './config.mjs'
import { operations } from './cfgexpress.mjs'
import { sleep, rnd6 } from './util.mjs'

import { Operation, assertKO} from './modele.mjs'
import { compile, Comptes, Comptis, Avatars, Comptas, Chats } from './gendoc.mjs'
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
    /* Mise à jour du DataSync en fonction du compte et des avatars / groupes actuels du compte */
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
LE PERIMETRE est mis à jour: DataSync aligné avec les avatars / groupes tirés du compte
- optionC: 
  - true : recherche des versions "base" de TOUS les sous-arbres du périmètre et les inscrits en DataSync
  - false : seule la version de "ida" est recherchée (si ida il y a)
- ida: id long du sous-arbre à synchroniser ou 0
- dataSync: sérialisation de l'état de synchro de la session
*/
operations.Sync = class Sync extends OperationS {
  constructor (nom) { super(nom, 1, 1) }

  /* Obtient le versions d'un groupe idg. x : élément de ds relatif au groupe 
  versions d'un groupe: { id, v, tv: [v, vg, vm, vn]}
  tv : le _data_ de version pour un groupe
  */
  async setGrx (idg, x) {
    const version = await this.getV({rds: x.rds})
    if (!version || version.suppr) {
      // NORMALEMENT c'est impossible, le groupe a du être enlevé de compte/mpg AVANT
      x.vb = [0,0,0,0]; x.m = false; x.n = false
      return
    }
    
    x.vb = [...version.tv]

    const gr = compile(await this.getRowGroupe(idg)) || null
    this.mgr.set(idg, gr)

    if (gr === null) {
      // NORMALEMENT c'est impossible, le groupe a du être enlevé de compte/mpg AVANT
      x.vb = [0,0,0,0]; x.m = false; x.n = false
      return
    }

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
  }

  async getGrRows (ida, x) { 
    // ida : ID long d'un sous-arbre avatar ou d'un groupe. x : son item dans ds
    let gr = this.mgr.get(ida) // on a pu aller chercher le plus récent si optionC
    if (!gr) gr = await this.db.getV(this, 'groupes', ida, x.vs[1])
    if (gr) this.setRes('rowGroupe', gr.toShortRow(x.m))

    if (x.m) {
      for (const row of await this.db.scoll(this, 'membres', ida, x.vs[2]))
        this.addRes('rowMembres', row)
      for (const row of await this.db.scoll(this, 'chatgrs', ida, x.vs[2]))
        this.setRes('rowChatgr', row)
    }

    if (x.n) for (const row of await this.db.scoll(this, 'notes', ida, x.vs[3])) {
      const note = compile(row)
      this.addRes('rowNotes', note.toShortRow(this.id))
    }
  }
  
  async getAvRows (ida, x) { // ida : ID long d'un sous-arbre avatar ou d'un groupe
    const rav = this.db.getV(this, 'avatars', ida, x.vs)
    if (rav) this.setRes('rowAvatar', rav)

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

  async phase2(args) {
    const g = args.ida ? ID.estGroupe(args.ida) :false
    this.mgr = new Map() // Cache très locale et courte des groupes acquis dans l'opération

    /* Mise à jour du DataSync en fonction du compte et des avatars / groupes actuels du compte */
    this.ds = args.dataSync
    const vcpt = await this.getV(this.compte)
    this.ds.compte.vb = vcpt.v

    if (args.optionC || (this.ds.compte.vs < this.ds.compte.vb)) 
      this.setRes('rowCompte', this.compte.toRow())
    let rowCompti = Cache.aVersion('comptis', this.compte.id, vcpt.v) // déjà en cache ?
    if (!rowCompti) rowCompti = await this.getRowCompti(this, this.compte.id)
    if (args.optionC || (rowCompti.v > this.ds.compte.vs)) 
      this.setRes('rowCompti', rowCompti)

    /* Mise à niveau des listes avatars / groupes du dataSync
    en fonction des avatars et groupes listés dans mav/mpg du compte 
    Ajoute les manquants dans ds, supprime ceux de ds absents de mav / mpg
    Pour CHAQUE GROUPE les indicateurs m et n sont bien positionnés.
    */
    this.compte.majPerimetreDataSync(this.ds)  

    if (args.optionC) {
      // Recherche des versions vb de TOUS les avatars requis
      for(const [, x] of this.ds.avatars) {
        const version = await this.getV({rds: x.rds})
        if (!version || version.suppr) {
          // NORMALEMENT l'avatar aurait déjà du être supprimé de compte/mav
          x.vb = 0
        }
        else x.vb = version.v
      }
      // Recherche des versions vb[] de TOUS les groupes requis
      for(const [idg, x] of this.ds.groupes)
        await this.setGrx(idg, x)
    } else {
      if (args.ida) {
        const x = (g ? this.ds.groupes : this.ds.avatars).get(args.ida) // item dans ds
        if (x) {
          // ce n'est pas obligatoire: le sous-arbre demandé peut justement avoir été détecté disparu du compte
          // maj du vb dans son item ds
          const version = await this.getV({rds: x.rds})
          if (!version || version.suppr) {
            // NORMALEMENT l'avatar aurait déjà du être supprimé de compte/mav
            x.vb = g ? [0,0,0,0] : 0
          } else {
            x.vb = g ? version.tv : version.v 
          }
        }
      }
    }

    if (args.ida) {
      const x = (g ? this.ds.groupes : this.ds.avatars).get(args.ida) // item dans ds
      if (x) {
        // ce n'est pas obligatoire: le sous-arbre demandé peut justement avoir été détecté disparu du compte
        if (g) await this.getGrRows(args.ida, x); else await this.getAvRows(args.ida, x)
      }
    }

    // Sérialisation et retour de dataSync
    this.setRes('dataSync', this.ds.serial)

    /*
    if (args.optionC || (this.ds.espace.vs < this.ds.espace.vb)) 
      this.setRes('rowEspace', this.espace.toRow())
    if (this.ds.partition.id && (args.optionC || (this.ds.partition.vs < this.ds.partition.vb)))
      this.setRes('rowPartition', this.partition.toShortRow(this.compte.del))
    // compta est TOUJOURS transmis par l'opération (après maj éventuelle des consos)
    */

    // credentials / emulator en cas de première connexion
    if (args.optionC) this.db.setSyncData(this)
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
*/

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

    /* Création compte / compti */
    const rdsav = Rds.nouveau(Rds.AVATAR)
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
    this.setRes('rowSponsoring', rowEspace)
  }
}
