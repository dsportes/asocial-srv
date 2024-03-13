/* eslint-disable no-unused-vars */

import { AppExc, F_SRV, ID, Compteurs,  d14 } from './api.mjs'
import { config } from './config.mjs'
import { operations } from './cfgexpress.mjs'
import { sleep } from './util.mjs'

import { Operation, Cache, assertKO} from './modele.mjs'
import { compile, Espaces, Versions, Syntheses, Partitions, Comptes, 
  Avatars, Comptas, Sponsorings } from './gendoc.mjs'
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

/* Sync : opération générique de synchronisation d'une session cliente
- optionC: 
  - true : recherche de toutes les versions du périmètre cohérentes
  - false : marque supprimés de dataSync les avatars / groupes  qui n'existent plus dans compte,
    recherche les versions des avatars / membres présents dans compte et pas dans dataSync
- ida: id long du sous-arbre à synchroniser ou 0
- dataSync: sérialisation de l'état de synchro de la session
*/
operations.Sync = class Sync extends Operation {
  constructor (nom) { super(nom, 1, 1) }

  /* Analyse d'un groupe idg. x : élément de ds relatif au groupe 
  versions d'un groupe: { id, v, tv: [v, vg, vm, vn]}
  Retourne le groupe
  */
  async setGrx (idg, x) {
    const version = compile(await Cache.getRow(this, 'versions', x.rds))
    if (!version || version.suppr) { x.vb = [0,0,0,0]; return null }
    else { x.vb = [...version.tv]; x.vc = version.v }

    let gr = this.mgr.get(idg)
    if (gr === undefined) {
      gr = compile(await Cache.getRow(this, 'groupes', idg)) || null
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
      const rowVersion = await Cache.getRow(this, 'versions', ID.long(x.rds))
      if (!rowVersion || rowVersion.suppr) { x.vb = 0; return }
      else { x.vb = rowVersion.v; x.vc = rowVersion.v }
      const rav = await Cache.getRow(this, 'avatars', ida)
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
    this.ds = new DataSync(args.dataSync)
    this.ds.compte = {
      id: this.compte.id,
      rds: Rds.long(this.compte.rds, this.ns),
      vc: this.compte.v,
      vb: this.compte.v
    }
    this.ds.compta = {
      id: this.compta.id,
      rds: Rds.long(this.compta.rds, this.ns),
      vc: this.compta.v,
      vb: this.compta.v
    }
    this.ds.espace = {
      id: this.espace.id,
      rds: Rds.long(this.espace.rds, this.ns),
      vc: this.espace.v,
      vb: this.espace.v
    }
    if (this.estA) {
      this.ds.partition = { ...DataSync.vide }
    } else this.ds.partition = {
      id: this.partition.id,
      rds: Rds.long(this.partition.rds, this.ns),
      vc: this.partition.v,
      vb: this.partition.v
    }

    /* mise à nouveau des listes avatars / groupes du dataSync
    en fonction des avatars et groupes listés dans mav/mpg du compte */
    this.compte.majPerimetreDataSync(this.ds)  

    if (args.optionC) {
      // Recherche des versions des avatars
      for(const [ida, x] of this.ds.avatars) {
        const rowVersion = await Cache.getRow(this, 'versions', x.rds)
        if (!rowVersion || rowVersion.suppr) x.vb = 0
        else { x.vb = rowVersion.v; x.vc = rowVersion.v }
      }
      // Recherche des versions des groupes
      for(const [idg, x] of this.ds.groupes)
        await this.setGrx(idg, x)
      this.ds.dhc = this.dh
    } else { // Maj du dataSync en fonction de compte
      // Inscription dans DataSync des nouveaux avatars qui n'y étaient pas et sont dans compte
      for (const idx in this.compte.mav) {
        const id = ID.long(parseInt(idx), this.ns)
        if (!this.ds.avatars.get(id)) { // recherche du versions et ajout dans le DataSync
          const { rdx } = this.compte.mav[idx]
          const rds = Rds.long(rdx, this.ns)
          const rowVersion = await Cache.getRow(this, 'versions', rds)
          if (rowVersion && !rowVersion.suppr) {
            this.ds.avatars.set(id, {
              id: id,
              rds: rds,
              vs: 0,
              vb: rowVersion.v,
              vc: rowVersion.v
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
          const { rdx } = this.compte.mpg[idx]
          x = { ...DataSync.videg}
          x.id = idg
          x.rds = Rds.long(rdx, this.ns)
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
    if (this.sync) this.sync.setAboRds(this.ds.tousRds, this.dh)
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
operations.Sync2 = class Sync2 extends Operation {
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
        rds: Rds.long(this.partition.rds, this.ns), 
        vs: vs, 
        vc: this.partition.v, 
        vb: this.partition.v 
      }
      this.setRes('rowPartitiona', this.partition.toShortRow(this.compte.del))
    } else {
      ds.partition = { ...DataSync.vide }
    }
  }
}

/* GetEspaces : pour admin seulment, retourne tous les rows espaces
- `token` : éléments d'authentification du compte.
Retour:
- espaces : array de row espaces
*/
operations.GetEspaces = class Sync2 extends Operation {
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
    const rowSynthese = await this.getRowSynthese(ns, 'GetSynthese')
    this.setRes('rowSynthese', rowSynthese)
  }
}

/* `CreerEspace` : création d'un nouvel espace et du comptable associé
- token : jeton d'authentification du compte de **l'administrateur**
- ns : numéro de l'espace
- org : code de l'organisation
- hXR : hash du PBKFD de la phrase secrète réduite
- hXC : hash du PBKFD de la phrase secrète complète
- cleE : clé de l'espace
- cleEK : clé de l'espace cryptée par la clé K du Comptable
- clePK: clé P de la partition 1 cryptée par la clé K du Comptable
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
    if (args.ns < 10 || args.ns > 89) throw new AppExc(F_SRV, 202, [args.ns])
    if ((args.org.length < 4) || (args.org.length > 8) || (!args.org.match(CreerEspace.reg))) 
      throw new AppExc(F_SRV, 201, [args.org])

    if (await Cache.getRow(this, 'espaces', args.ns)) throw new AppExc(F_SRV, 203, [args.ns, args.org])
    if (await Cache.getEspaceOrg(this, args.org)) throw new AppExc(F_SRV, 204, [args.ns, args.org])

    /* Espace */
    const espace = Espaces.nouveau (this, args.ns, args.org, args.cleE)
    const rvespace = new Versions().init({id: Rds.long(espace.rds, args.ns), v: 1, suppr: 0}).toRow()

    /* Synthese */
    const synthese = Syntheses.nouveau(args.ns)

    /* Partition */
    const partition = Partitions.nouveau(args.ns, 1, args.clePK, args.cleAP)
    const rvpartition = new Versions().init({id: Rds.long(partition.rds, args.ns), v: 1, suppr: 0}).toRow()

    /* Compte Comptable */
    const apr = config.allocPrimitive
    const o = { 
      clePA: args.clePA,
      rdsp: partition.rds,
      idp: ID.court(partition.id),
      del: true,
      it: 1
    }
    const cs = { cleEK: args.cleEK, qc: apr[0], qn: apr[1], qv: apr[2], c: args.ck } 
    const rdsav = Rds.nouveau('avatars')
    // (id, hXR, hXC, cleKXR, rdsav, cleAK, o, cs)
    const compte = Comptes.nouveau(ID.duComptable(args.ns), 
      (args.ns * d14) + args.hXR, args.hXC, args.cleKXC, args.cleEK, rdsav, args.cleAK, o, cs)
    const rvcompte = new Versions().init({id: Rds.long(compte.rds, args.ns), v: 1, suppr: 0}).toRow()
    
    /* Compta */
    const aco = config.allocComptable
    const qv = { qc: aco[0], qn: aco[1], qv: aco[2], nn: 0, nc: 0, ng: 0, v: 0 }
    const compta = new Comptas().init({
      id: compte.id, v: 1, rds: Rds.nouveau('comptas'), qv,
      compteurs: new Compteurs(null, qv).serial
    })
    const rvcompta = new Versions().init({id: Rds.long(compta.rds, args.ns), v: 1, suppr: 0}).toRow()
    
    /* Avatar */
    const avatar = new Avatars().init({ id: compte.id, v: 1, rds: rdsav })
    const rvavatar = new Versions().init({id: Rds.long(rdsav, args.ns), v: 1, suppr: 0}).toRow()

    // this.insert(this.setRes(espace.toRow()))
    this.insert(espace.toRow())
    this.insert(rvespace)
    this.insert(synthese.toRow())
    this.insert(partition.toRow())
    this.insert(rvpartition)
    this.insert(compte.toRow())
    this.insert(rvcompte)
    this.insert(compta.toRow())
    this.insert(rvcompta)
    this.insert(avatar.toRow())
    this.insert(rvavatar)
  }
}

/* Recherche hash de phrase ******
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

/** Ajout d\'un sponsoring ****************************************************
- `token` : éléments d'authentification du comptable / compte sponsor de sa tribu.
- `psK` : texte de la phrase de sponsoring cryptée par la clé K du sponsor.
- `YCK` : PBKFD de la phrase de sponsoring cryptée par la clé K du sponsor.
- `cleAYC` : clé A du sponsor crypté par le PBKFD de la phrase complète de sponsoring.
- `partitionId`: id de la partition si compte 0    
- `cleAP` : clé A du COMPTE sponsor crypté par la clé P de la partition.
- `clePYC` : clé P de sa partition (si c'est un compte "O") cryptée par le PBKFD 
  de la phrase complète de sponsoring (donne l'id de la partition).
- `nomYC` : nom du sponsorisé, crypté par le PBKFD de la phrase complète de sponsoring.
- `cvA` : `{ v, photo, info }` du sponsor, textes cryptés par sa cle A.
- `ardYC` : ardoise de bienvenue du sponsor / réponse du sponsorisé cryptée par le PBKFD de la phrase de sponsoring.

- `quotas` : `[qc, q1, q2]` pour un compte O, quotas attribués par le sponsor.
  - pour un compte "A" `[0, 1, 1]`. Un tel compte n'a pas de `qc` et peut changer à loisir
   `[qn, qv]` qui sont des protections pour lui-même (et fixe le coût de l'abonnement).
- don: montant du don pour un compte autonome sponsorisé par un compte autonome
- dconf: true, si le sponsor demande la confidentialité (pas de chat à l'avcceptation)
- del: true si le compte est délégué de la partition
Retour:
*/
operations.AjoutSponsoring = class AjoutSponsoring extends Operation {
  constructor (nom) { super(nom, 1, 1) }

  async phase2 (args) {
    if (await this.db.getCompteHXR(this.args.hps1)) 
      throw new AppExc(F_SRV, 207)

    if (args.partitionId) { // compte O
      const it = this.compte.it
      const partition = compile(await Cache.getRow(this, 'partitions', args.partitionId))
      if (!partition) 
        throw new AppExc(F_SRV, 208, [args.partitionId])
      const e = partition.tcpt[it]
      // if (!e || e.cleAP !== args.cleAP) 
      //  throw new AppExc(F_SRV, 209, [args.partitionId, this.compte.id])
      if (!e.del) 
        throw new AppExc(F_SRV, 210, [args.partitionId, this.compte.id])

      const s = partition.getSynthese()
      const q = args.quotas
      // restants à attribuer suffisant pour satisfaire les quotas ?
      if (q.qc > (s.qc - s.ac) || q.qn > (s.qn - s.an) || q.qv > (s.sv - s.av))
        throw new AppExc(F_SRV, 211, [args.partitionId, this.compte.id])
    } else {
      if (this.estComptable) args.don = 2
      else {
        if (this.compta.solde <= args.don + 2)
          throw new AppExc(F_SRV, 212, [this.compta.solde, args.don])
      }
    }

    const sponsoring = new Sponsorings().nouveau(args)
    const avatar = compile(await Cache.getRow(this, 'avatars', sponsoring.id))
    const vsp = await this.getV('AjoutSponsoring-1', avatar)
    vsp.v++
    sponsoring.v = vsp.v
    sponsoring.csp = this.compte.id
    sponsoring.itsp = this.compte.it
    this.insert(sponsoring.toRow())
    this.update(vsp.toRow())
  }
}

/* Recherche sponsoring **************************************************
args.token: éléments d'authentification du compte.
args.org : organisation
args.hps1 : hash du PBKFD de la phrase de contact réduite
Retour:
- rowSponsoring s'il existe
*/
operations.ChercherSponsoring = class ChercherSponsoring extends Operation {
  constructor (nom) { super(nom, 0) }

  async phase2 (args) {
    const espace = await Cache.getEspaceOrg(this, args.org)
    if (!espace) { sleep(3000); return }
    const ids = (espace.id * d14) + args.hps1
    const row = await this.db.getSponsoringIds(this, ids)
    if (!row) { sleep(3000); return }
    this.setRes('rowSponsoring', row)
  }
}
