/* eslint-disable no-unused-vars */

import { AppExc, F_SRV, ID, Compteurs, AMJ, UNITEV2, edvol, d14 } from './api.mjs'
import { encode, decode } from '@msgpack/msgpack'
import { config } from './config.mjs'
import { operations } from './cfgexpress.mjs'

import { Operation, assertKO, trace} from './modele.mjs'
import { compile, Versions, Transferts, Gcvols, Chatgrs } from './gendoc.mjs'
import { sleep, crypterRaw /*, decrypterRaw */ } from './util.mjs'
import { DataSync, FLAGS, edit, A_SRV, idTkToL6, IDBOBSGC, statistiques } from './api.mjs'

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
- optionC: true - recherche de toutes les versions du périmètre cohérentes
- ida: id long du sous-arbre à synchroniser ou 0
- dataSync: sérialisation de l'état de synchro de la session
*/
operations.Sync = class Sync extends Operation {
  constructor (nom) { super(nom, 1, 1) }

  /* Analyse d'un groupe idg. x : élément de ds relatif au groupe */
  async setGrx (idg, x) {
    const rowVersion = await Cache.getRow(this, 'versions', x.rds)
    if (!rowVersion || rowVersion.suppr) { x.vb = -1; return null }
    else { x.vb = rowVersion.v; x.vc = rowVersion.v }

    let gr = this.mgr.get(idg)
    if (gr === undefined) {
      gr = compile(await Cache.getRow(this, 'groupes', idg)) || null
      this.mgr.set(idg, gr)
    }
    if (gr === null) { x.vb = -1; x.m = -1; x.n = -1; return null }
    // set de x.m x.n : un des avatars du compte a-t-il accès aux membres / notes
    const sim = this.compte.imGr(idg)
    if (sim.size) {
      const [mx, nx] = gr.amAn(sim)
      if (x.m === 1 && !mx) x.m = -1
      if (x.m === 0 && mx) x.m = 1
      if (x.n === 1 && !nx) x.n = -1
      if (x.n === 0 && nx) x.n = 1
    } else {
      x.m = -1
      x.n = -1
    }
    return gr
  }

  async getAvGrRows (ida) { // ida : ID long d'un sous-arbre avatar ou d'un groupe
    const g = ID.estGroupe(ida)
    /* Obtention des rows du sous-arbre */
    const m = g ? this.ds.groupes : this.ds.avatars
    const x = m.get(ida)
    if (!x) return
    if (g) {
      const gr = await this.setGrx(ida, x)
      if (x.vb <= 0) return
      this.setRes('rowGroupes', gr.toShortRow(x.m))
      if (x.n) for (const row of await this.db.scoll(this, 'notes', ida, x.vs)) {
        const note = compile(row)
        this.addRes('rowNotes', note.toShortRow(this.id))
      }
      if (x.m) {
        for (const row of await this.db.scoll(this, 'membres', ida, x.vs))
          this.addRes('rowMembres', row)
        for (const row of await this.db.scoll(this, 'chatgrs', ida, x.vs))
          this.addRes('rowChatgrs', row)
      }
    } else {
      const rowVersion = await Cache.getRow(this, 'versions', ID.long(x.rds))
      if (!rowVersion || rowVersion.suppr) x.vb = -1
      else { x.vb = rowVersion.v; x.vc = rowVersion.v }
      if (x.vb <= 0) return
      const rav = await Cache.getRow(this, 'avatars', ida)
      if (!rav) { x.vb = -1; return }
      this.setRes('rowAvatars', rav)

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
    this.mgr = new Map()

    /* Mise à jour du DataSync en fonction des CCEP et des avatars / groupes actuels du compte */
    this.ds = new DataSync(null, args.dataSync)
    {
      const x = this.ds.compte; x.id = this.compte.id
      x.rds = this.compte.rds; x.vc = this.compte.v; this.vb = this.compte.v
    }
    {
      const x = this.ds.compta; x.id = this.compta.id
      x.rds = this.compta.rds; x.vc = this.compta.v; this.vb = this.compta.v
    }
    {
      const x = this.ds.espace; x.id = this.espace.id
      x.rds = this.espace.rds; x.vc = this.espace.v; this.vb = this.espace.v
    }
    const x = this.ds.partition;
    if (this.estA) {
      if (x.id) x.vb = -1
    } else {
      x.id = this.partition.id
      x.rds = this.partition.rds; x.vc = this.partition.v; this.vb = this.partition.v
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
