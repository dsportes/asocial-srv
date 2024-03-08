/* eslint-disable no-unused-vars */

import { AppExc, F_SRV, ID, Compteurs, AMJ, UNITEV2, edvol, d14 } from './api.mjs'
import { encode, decode } from '@msgpack/msgpack'
import { config } from './config.mjs'
import { operations } from './cfgexpress.mjs'

import { Operation, assertKO, trace} from './modele.mjs'
import { compile, Versions, Transferts, Gcvols, Chatgrs } from './gendoc.mjs'
import { sleep, crypterRaw /*, decrypterRaw */ } from './util.mjs'
import { DataSync, Rds, FLAGS, edit, A_SRV, idTkToL6, IDBOBSGC, statistiques } from './api.mjs'

// Pour forcer l'importation des opérations
export function load () {
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
        this.addRes('rowSponsorings', row)
      if (ID.estComptable(this.id)) 
        for (const row of await this.db.scoll(this, 'tickets', ida, x.vs))
          this.addRes('rowTickets', row)
    }
  }

  async phase2(args) {
    this.mgr = new Map() // Cache très locale et courte des groupes acquis dans l'opération

    /* Mise à jour du DataSync en fonction des CCEP et des avatars / groupes actuels du compte */
    this.ds = new DataSync(null, args.dataSync)
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
        if (!rowVersion || rowVersion.suppr) x.vb = -1
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
        if (!this.compte.mav[id]) this.ds.avatars.delete(id)

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
        if (!this.compte.mpg[id]) this.ds.groupes.delete(id)
    }

    if (args.ida) await this.getAvGrRows(args.ida)

    // Sérialisation et retour de dataSync, rows compte, compta, espace, partition
    this.setRes('dataSync', this.ds.serial)
    if (this.ds.compte.vs < this.ds.compte.vb) 
      this.setRes('rowCompte', this.compte.toRow())
    if (this.ds.espace.vs < this.ds.espace.vb) 
      this.setRes('rowEspace', this.espace.toRow())
    if (this.ds.partition.id && (this.ds.partition.vs < this.ds.partition.vb))
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

/* `GetSynthese` : retourne la synthèse de l'espace ns
- `token` : éléments d'authentification du compte.
- `ns` : id de l'espace.
Retour:
- `rowSynthese`
Assertion sur l'existence du row `Syntheses`.
Exception:
- pas admin, pas Comptable et pas le ns courant du compte
*/
operations.GetSynthese = class GetSynthese extends Operation {
  constructor (nom) { super(nom, 1, 1) }

  async phase2 (args) {
    const ok = this.estAdmin || ID.estComptable(this.id) || this.ns === args.ns
    // TODO if (!ok) throw ...
    const rowSynthese = await this.getRowSynthese(args.ns, 'GetSynthese')
    this.setRes('rowSynthese', rowSynthese)
  }
}
