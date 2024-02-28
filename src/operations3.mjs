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
- optionsC: true - recherche de toutes les versions du périmètre cohérentes
- ida: id du sous-arbre à synchroniser ou 0
- dataSync: sérialisation de l'état de synchro de la session
*/
operations.Sync = class Sync extends Operation {
  constructor (nom) { super(nom, 1, 1) }

  async phase2(args) {
    /* Mise à jour du DataSync en fonction des CCEP et des avatars / groupes actuels du compte */
    this.ds = new DataSync(null, args.dataSync)
    {
      const x = this.ds.compte; x.id = ID.court(this.compte.id)
      x.rds = this.compte.rds; x.vc = this.compte.v; this.vb = this.compte.v
    }
    {
      const x = this.ds.compta; x.id = ID.court(this.compta.id)
      x.rds = this.compta.rds; x.vc = this.compta.v; this.vb = this.compta.v
    }
    {
      const x = this.ds.espace; x.id = ID.court(this.espace.id)
      x.rds = this.espace.rds; x.vc = this.espace.v; this.vb = this.espace.v
    }
    const x = this.ds.partition;
    if (this.estA) {
      if (x.id) x.vb = -1
    } else {
      x.id = ID.court(this.partition.id)
      x.rds = this.partition.rds; x.vc = this.partition.v; this.vb = this.partition.v
    }
    this.compte.majPerimetreDataSync(this.ds)

    if (args.optionC) {
      // Recherche des versions des avatars
      for(const [idac, x] of this.ds.avatars) {
        if (x.vb === -1) continue
        const rowVersion = await Cache.getRow(this, 'versions', ID.long(x.rds))
        if (!rowVersion) throw assertKO('Sync-avatar', 14, [x.rds])
        if (rowVersion.suppr) x.vb = -1
        else { x.vb = rowVersion.v; x.vc = rowVersion.v }
      }
      // Recherche des versions des groupes
      for(const [idgc, x] of this.ds.groupes) {
        if (x.vb === -1) continue
        const rowVersion = await Cache.getRow(this, 'versions', ID.long(x.rds))
        if (!rowVersion) throw assertKO('Sync-groupe', 14, [x.rds])
        if (rowVersion.suppr) x.vb = -1
        else { x.vb = rowVersion.v; x.vc = rowVersion.v }
      }
      this.ds.dhc = this.dh
    }

    if (args.ida) {
      const g = ID.estGroupe(args.ida)
      /* Obtention des rows du sous-arbre */
      const m = g ? this.ds.groupes : this.ds.avatars
      const x = m.get(ID.court(args.ida))
      if (x) {
        const rowVersion = await Cache.getRow(this, 'versions', ID.long(x.rds))
        if (!rowVersion) throw assertKO('Sync-avgr', 14, [x.rds])
        x.vb = rowVersion.v
        for (const row of await this.db.scoll(this, 'notes', args.ida, x.vs))
          this.addRes('rowNotes', row)
        if (!g) for (const row of await this.db.scoll(this, 'chats', args.ida, x.vs))
          this.addRes('rowChats', row)
        if (!g) for (const row of await this.db.scoll(this, 'sponsorings', args.ida, x.vs))
          this.addRes('rowSponsorings', row)
        if (!g && ID.estComptable(this.id)) 
          for (const row of await this.db.scoll(this, 'tickets', args.ida, x.vs))
            this.addRes('rowTickets', row)
        if (g) for (const row of await this.db.scoll(this, 'membres', args.ida, x.vs))
          this.addRes('rowMembres', row)
        if (!g) for (const row of await this.db.scoll(this, 'chatgrs', args.ida, x.vs))
          this.addRes('rowChatgrs', row)
      }
    }

    // Sérialisation et retour de dataSync, rows compte, compta, espace, partition
    this.setRes('dataSync', this.ds.serial)
    if (this.ds.compte.vs < this.ds.compte.vb) 
      this.setRes('compta', this.compte.toRow())
    if (this.ds.espace.vs < this.ds.espace.vb) 
      this.setRes('compta', this.compta.toRow())
    if (this.ds.partition.id && (this.ds.partition.vs < this.ds.partition.vb))
      this.setRes('partition', this.partition.toRow())
    // compta est TOUJOURS transmis par l'opération (après maj éventuelle des consos)

    // Mise à jour des abonnements aux versions
    if (this.sync) this.sync.setAboRds(this.ds.tousRds, this.dh)
  }
}
