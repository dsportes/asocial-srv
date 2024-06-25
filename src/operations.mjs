/* Opérations d'écrire et toutes du GC */

import { AppExc, F_SRV, ID, Compteurs, AMJ, UNITEV, edvol, d14 } from './api.mjs'
import { encode, decode } from '@msgpack/msgpack'
import { config } from './config.mjs'
import { operations } from './cfgexpress.mjs'

import { Operation } from './modele.mjs'
import { compile, Transferts } from './gendoc.mjs'

// Pour forcer l'importation des opérations
export function load () {
  if (config.mondebug) config.logger.debug('Operations: ' + operations.auj)
}

/* Nouvelle Note *************************************************
args.token: éléments d'authentification du compte.
args.rowNote : row de la note
args.idc: id du compte (note avatar) ou de l'hébergeur (note groupe)
Retour: rien
*/
operations.NouvelleNote = class NouvelleNote extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) { 
    const note = compile(args.rowNote)
    let v
    if (ID.estGroupe(note.id)) {
      v = await this.majVolumeGr (note.id, 1, 0, false, 'NouvelleNote-1')
    } else {
      v = compile(await this.getRowVersion(note.id, 'NouvelleNote-2', true))
    }
    v.v++
    this.update(v.toRow())
    note.v = v.v
    this.insert(note.toRow())
    await this.augmentationVolumeCompta(args.idc, 1, 0, 0, 0, 'NouvelleNote-2')
  }
}

/* Maj Note *************************************************
args.token: éléments d'authentification du compte.
args.id ids: identifiant de la note (dont celle du groupe pour un note de groupe)
args.txts : nouveau texte encrypté
args.aut : auteur de la note pour un groupe
Retour: rien
*/
operations.MajNote = class MajNote extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) { 
    const note = compile(await this.getRowNote(args.id, args.ids, 'MajNote-1'))
    const v = compile(await this.getRowVersion(note.id, 'MajNote-2', true))
    v.v++
    this.update(v.toRow())
    
    note.txts = args.txts
    if (args.aut) {
      const nl = [args.aut]
      if (note.auts) note.auts.forEach(t => { if (t !== args.aut) nl.push(t) })
      note.auts = nl
    }
    note.v = v.v
    this.update(note.toRow())
  }
}

/* Changer l'exclusivité d'écriture d'une note ***********************
args.token: éléments d'authentification du compte.
args.id ids: identifiant de la note
args.im : 0 / im
Retour: rien
*/
operations.ExcluNote = class ExcluNote extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) { 
    const note = compile(await this.getRowNote(args.id, args.ids, 'ExcluNote-1'))
    const v = compile(await this.getRowVersion(note.id, 'ExcluNote-2', true))
    v.v++
    this.update(v.toRow())
    note.im = args.im
    note.v = v.v
    this.update(note.toRow())
  }
}

/* Changer les mots clés d'une note ***********************
args.token: éléments d'authentification du compte.
args.id ids: identifiant de la note
args.hgc: si mc perso d'une note de groupe, id dans la map mc
args.mc: mots clés perso
args.mc0: mots clés du groupe
Retour: rien
*/
operations.McNote = class McNote extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) { 
    const note = compile(await this.getRowNote(args.id, args.ids, 'McNote-1'))
    const v = compile(await this.getRowVersion(note.id, 'McNote-2', true))
    v.v++
    this.update(v.toRow())
    if (ID.estGroupe(note.id)) {
      const mc = note.mc ? decode(note.mc) : {}
      if (args.mc0) mc['0'] = args.mc0
      if (args.mc) mc[args.hgc] = args.mc
      note.mc = encode(mc)
    } else note.mc = args.mc
    note.v = v.v
    this.update(note.toRow())
  }
}

/* Rattacher une note à une autre ou à une racine ***********************
args.token: éléments d'authentification du compte.
args.id ids: identifiant de la note
args.ref : [rid, rids, rnom] crypté par la clé de la note. Référence d'une autre note
Retour: rien
*/
operations.RattNote = class RattNote extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) { 
    const note = compile(await this.getRowNote(args.id, args.ids, 'RattNote-1'))
    const v = compile(await this.getRowVersion(note.id, 'RattNote-2', true))
    v.v++
    this.update(v.toRow())
    note.v = v.v
    note.ref = args.ref
    this.update(note.toRow())
  }
}

/* Supprimer la note ******
args.token: éléments d'authentification du compte.
args.id ids: identifiant de la note (dont celle du groupe pour un note de groupe)
args.idc : compta à qui imputer le volume
  - pour une note personelle, id du compte de l'avatar
  - pour une note de groupe : id du "compte" de l'hébergeur idhg du groupe
Retour:
*/
operations.SupprNote = class SupprNote extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) { 
    const note = compile(await this.getRowNote(args.id, args.ids))
    if (!note) return
    this.lidf = []
    for (const idf in note.mfas) this.lidf.push(parseInt(idf))
    const dv2 = note.v2
    let v
    if (ID.estGroupe(args.id)) {
      v = await this.majVolumeGr(args.id, -1, -dv2, false, 'SupprNote-1') // version du groupe (mise à jour)
    } else {
      v = compile(await this.getRowVersion(args.id, 'SupprNote-2', true)) // version de l'avatar
    }
    v.v++
    this.update(v.toRow())

    await this.diminutionVolumeCompta(args.idc, 1, 0, 0, dv2, 'SupprNote-3')
    note.v = v.v
    note._zombi = true
    this.update(note.toRow())
    if (this.lidf.length)
      this.idfp = await this.setFpurge(args.id, this.lidf)
  }

  async phase3 (args) {
    try {
      if (this.lidf.length) {
        const org = await this.org(ID.ns(args.id))
        const idi = args.id % d14  
        await this.storage.delFiles(org, idi, this.lidf)
        await this.unsetFpurge(this.idfp)
      }
    } catch (e) { 
      // trace
    }
  }
}

/*****************************************
GetUrl : retourne l'URL de get d'un fichier
Comme c'est un GET, les arguments sont en string (et pas en number)
args.token: éléments d'authentification du compte.
args.id : id de la note
args.idf : id du fichier
args.idc : id du compte demandeur
args.vt : volume du fichier (pour compta des volumes v2 transférés)
*/
operations.GetUrl = class GetUrl extends Operation {
  constructor (nom) { super(nom, 1, 2); this.lecture = true }

  async phase2 (args) {
    const org = await this.org(ID.ns(args.id))
    const idi = args.id % d14
    const url = await this.storage.getUrl(org, idi, args.idf)
    this.setRes('getUrl', url)
    this.compta.v++
    this.compta.compteurs = new Compteurs(this.compta.compteurs, null, { vd: args.vt }).serial
    this.update(this.compta.toRow())
  }
}

/* Put URL : retourne l'URL de put d'un fichier ****************************************
args.token: éléments d'authentification du compte.
args.id : id de la note
args.idh : id de l'hébergeur pour une note groupe
args.dv2 : variation de volume v2
args.idf : identifiant du fichier
Retour:
- url : url à passer sur le PUT de son contenu
*/
operations.PutUrl = class PutUrl extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) {
    if (args.dv2 > 0) {
      if (ID.estGroupe(args.id)) {
        // Pour provoquer une exception de dépassement éventuel
        await this.majVolumeGr (args.id, 0, args.dv2, false, 'PutUrl-2')
      }
      const h = compile(await this.getRowCompta(args.idh, 'PutUrl-1'))
      const c = decode(h.compteurs)
      const d = c.v2 + args.dv2
      const q = c.q2 * UNITEV
      if (d > q)
        throw new AppExc(F_SRV, 56, [edvol(d), edvol(q)])
    }

    const org = await this.org(ID.ns(args.id))
    const idi = args.id % d14
    const url = await this.storage.putUrl(org, idi, args.idf)
    this.setRes('putUrl', url)
    const dlv = AMJ.amjUtcPlusNbj(this.auj, 5)
    const tr = new Transferts().init({ id: args.id, ids: args.idf, dlv })
    this.insert(tr.toRow())
  }
}

/* validerUpload ****************************************
args.token: éléments d'authentification du compte.
args.id, ids : de la note
args.idh : id de l'hébergeur pour une note groupe
args.aut: im de l'auteur (pour une note de groupe)
args.idf : identifiant du fichier
args.emap : entrée (de clé idf) de la map des fichiers attachés [lg, data]
args.lidf : liste des fichiers à supprimer
La variation de volume v2 est calculée sous contrôle transactionnel
en relisant mafs (dont les lg).
Retour: aucun
*/
operations.ValiderUpload = class ValiderUpload extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) {
    const note = compile(await this.getRowNote(args.id, args.ids, 'ValiderUpload-1'))
    const vn = compile(await this.getRowVersion(args.id, 'ValiderUpload-2', true))
    vn.v++
    note.v = vn.v
    this.update(vn.toRow())

    const map = note.mfas ? decode(note.mfas) : {}
    map[args.idf] = args.emap
    if (args.lidf && args.lidf.length) 
      args.lidf.forEach(idf => { delete map[idf] })
    note.mfas = encode(map)
    let v = 0; for (const idf in map) v += map[idf][0]
    const dv2 = v - note.v2 // variation de v2
    if (args.aut) {
      const nl = [args.aut]
      if (note.auts) note.auts.forEach(t => { if (t !== args.aut) nl.push(t) })
      note.auts = nl
    }
    note.v2 = v
    this.update(note.toRow())

    if (ID.estGroupe(args.id)) {
      await this.majVolumeGr (args.id, 0, dv2, true, 'ValiderUpload-3')
    }
    const h = compile(await this.getRowCompta(args.idh, 'ValiderUpload-4'))
    if (isNaN(h.qv.v2)) h.qv.v2 = 0
    h.qv.v2 += dv2
    if (h.qv.v2 < 0) h.qv.v2 = 0
    const q = h.qv.q2 * UNITEV
    if (h.qv.v2 > q) throw new AppExc(F_SRV, 56, [edvol(h.qv.v2), edvol(q)])
    h.compteurs = new Compteurs(h.compteurs, h.qv).serial
    h.v++
    this.update(h.toRow())
    
    this.delete({ _nom: 'transferts', id: args.id, ids: args.ids })
  }

  async phase3 (args) {
    if (args.lidf && args.lidf.length) {
      const org = await this.org(ID.ns(args.id))
      const idi = args.id % d14
      await this.storage.delFiles(org, idi, args.lidf)
    }
  }
}

/* Supprimer un ficher ****************************************
args.token: éléments d'authentification du compte.
args.id, ids : de la note
args.idh : id de l'hébergeur pour une note groupe
args.idf : identifiant du fichier à supprimer
args.aut: im de l'auteur (pour une note de groupe)
Retour: aucun
*/
operations.SupprFichier = class SupprFichier extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) {
    const note = compile(await this.getRowNote(args.id, args.ids, 'SupprFichier-1'))
    const vn = compile(await this.getRowVersion(args.id, 'SupprFichier-2', true))
    vn.v++
    note.v = vn.v
    this.update(vn.toRow())

    const map = note.mfas ? decode(note.mfas) : {}
    delete map[args.idf]
    note.mfas = encode(map)
    let v = 0; for (const idf in map) v += map[idf][0]
    const dv2 = v - note.v2 // variation de v2
    if (args.aut) {
      const nl = [args.aut]
      if (note.auts) note.auts.forEach(t => { if (t !== args.aut) nl.push(t) })
      note.auts = nl
    }
    note.v2 = v
    this.update(note.toRow())

    if (ID.estGroupe(args.id)) {
      await this.majVolumeGr (args.id, 0, dv2, true, 'SupprFichier-3')
    }

    const h = compile(await this.getRowCompta(args.idh, 'ValiderUpload-4'))
    if (isNaN(h.qv.v2)) h.qv.v2 = 0
    h.qv.v2 += dv2
    if (h.qv.v2 < 0) h.qv.v2 = 0
    const q = h.qv.q2 * UNITEV
    if (h.qv.v2 > q) throw new AppExc(F_SRV, 56, [edvol(h.qv.v2), edvol(q)])
    h.compteurs = new Compteurs(h.compteurs, h.qv).serial
    h.v++
    this.update(h.toRow())

    this.idfp = await this.setFpurge(args.id, [args.idf])
  }

  async phase3 (args) {
    try {
      const org = await this.org(ID.ns(args.id))
      const idi = args.id % d14  
      await this.storage.delFiles(org, idi, [args.idf])
      await this.unsetFpurge(this.idfp)
    } catch (e) { 
      // trace
    }
  }
}
