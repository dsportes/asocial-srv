/* Opérations d'écrire et toutes du GC */

import { AppExc, F_SRV, ID, Compteurs, AMJ, UNITEV, edvol, d14 } from './api.mjs'
import { encode, decode } from '@msgpack/msgpack'
import { config } from './config.mjs'
import { operations } from './cfgexpress.mjs'

import { Operation, trace} from './modele.mjs'
import { compile, Transferts } from './gendoc.mjs'
import { sleep, crypterRSA, crypterRaw /*, decrypterRaw */ } from './util.mjs'
import { A_SRV, idTkToL6, statistiques } from './api.mjs'

// Pour forcer l'importation des opérations
export function load () {
  if (config.mondebug) config.logger.debug('Operations: ' + operations.auj)
}

/*`GetVersionsDlvat` : liste des id des versions d'un ns ayant la dlvat fixée
POST:
// - `token` : jeton d'authentification du compte
- `ns` : id de l'espace
- dlvat: aamm,
Retour:
- lids: array des id
*/
operations.GetVersionsDlvat = class GetVersionsDlvat extends Operation {
  constructor (nom) { super(nom, 0)}

  async phase2 (args) {
    const lids = await this.getVersionsDlvat(args.ns, args.dlvat)
    this.setRes('lids', lids)
  }
}

/*`GetMembresDlvat` : liste des [id,ids] des membres d'un ns ayant la dlvat fixée
POST:
// - `token` : jeton d'authentification du compte
- `ns` : id de l'espace
- dlvat: aamm,
Retour:
- lidids: array des id
*/
operations.GetMembresDlvat = class GetMembresDlvat extends Operation {
  constructor (nom) { super(nom, 0)}

  async phase2 (args) {
    const lidids = await this.getMembresDlvat(args.ns, args.dlvat)
    this.setRes('lidids', lidids)
  }
}

/*`ChangeAvDlvat` : change la dlvat dans les versions des avatars listés
POST:
- `token` : jeton d'authentification du compte
- dlvat: aamm,
- lids: array des ids des avatars
Retour:
*/
operations.ChangeAvDlvat = class ChangeAvDlvat extends Operation {
  constructor (nom) { super(nom, 1, 2)}

  async phase2 (args) {
    for(const id of args.lids) {
      if (ID.estComptable(id)) continue
      const version = compile(await this.getRowVersion(id))
      if (version) {
        version.v++
        version.dlv = args.dlvat
        this.update(version.toRow())
        const compta = compile(await this.getRowCompta(id))
        if (compta) {
          compta.v++
          compta.dlv = args.dlvat
          this.update(compta.toRow())
        }
      }
    }
  }
}

/* OP_MuterCompte: 'Mutation dy type d\'un compte'
POST:
- `token` : éléments d'authentification du compte.
- 'id': id du compte à muter
- 'st': type actuel: 1: A, 2: 0
- `idI idsI` : id du chat, côté _interne_.
- `idE idsE` : id du chat, côté _externe_.
- `txt1` : texte à ajouter crypté par la clé cc du chat.
- `lgtxt1` : longueur du texte

Si st === 1:
- `quotas`: {qc, q2, q1}
- `trib`: { 
  idT: id courte du compte crypté par la clé de la tribu,
  idt: id de la tribu, 
  cletX: cle de la tribu cryptée par la clé K du comptable,
  cletK: cle de la tribu cryptée par la clé K du compte ou sa clé RSA.
}

Retour:
*/
operations.MuterCompte = class MuterCompte extends operations.MajChat {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 (args) {
    await this.majchat(args) // fixe this.updCompta

    const comptaM = compile(await this.getRowCompta(args.id, 'MuterCompte-1'))
    comptaM.v++
    comptaM.dlv = args.dlv

    if (args.st === 1) {
      /* compte A devient O
      - inscription dans sa tribu
      - dans son comptaM, credits null, raz info tribu
      - dans compteurs: remise à zéro du total abonnement et consommation des mois antérieurs (`razma()`)      */
      const idtAp = args.trib.idt
      const apTribu = compile(await this.getRowTribu(idtAp, 'ChangerTribu-4'))

      const qv = comptaM.qv
      qv.qc = args.quotas.qc
      qv.q1 = args.quotas.q1
      qv.q2 = args.quotas.q2
      const c = new Compteurs(comptaM.compteurs, qv)
      c.razma()
      comptaM.compteurs = c.serial
      comptaM.cletK = args.trib.cletK
      comptaM.cletX = args.trib.cletX
      comptaM.it = apTribu.act.length
      comptaM.credits = null
      this.update(comptaM.toRow())

      apTribu.v++
      const e = {
        idT: args.trib.idT,
        nasp: null,
        stn: 0,
        notif: null,
        qc: qv.qc || 0,
        q1: qv.q1 || 0,
        q2: qv.q2 || 0,
        ca: 0,
        v1: qv.nc + qv.ng + qv.nn,
        v2: qv.v2 || 0
      }
      apTribu.v++
      apTribu.act.push(e)
      this.update(apTribu.toRow())
      await this.MajSynthese(apTribu)
      if (this.sync) this.sync.plus(idtAp)
  
    } else {
      /* compte O devient A
      - le retirer de sa tribu actuelle
      - raz de ses infos tribu dans comptaM
      - credits à "true": pour forcer à la prochaine connexion à l'initialiser
      au minimum prévu
      - dans compteurs: remise à zéro du total abonnement et consommation des mois antérieurs (`razma()`), raz des mois 
      */
      const idtAv = args.trib.idt
      const avTribu = compile(await this.getRowTribu(idtAv, 'ChangerTribu-2'))
  
      avTribu.v++
      avTribu.act[comptaM.it] = null
      this.update(avTribu.toRow())
      await this.MajSynthese(avTribu)
      if (this.sync) this.sync.moins(args.idtAv)

      comptaM.cletK = null
      comptaM.cletX = null
      comptaM.it = 0
      comptaM.credits = true
      const c = new Compteurs(comptaM.compteurs)
      c.razma()
      comptaM.compteurs = c.serial
      this.update(comptaM.toRow())
    }

    await this.propagerDlv(args)

    if (this.updCompta) this.update(this.compta.toRow())
  }
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

/* GCstcc : enregistrement des statistiques mensuelles comptables
Pour chaque espace, demande le calcul / enregistrement du fichier
de M-1 s'il n'a pas déjà été enregistré avec la clé publique du 
Comptable de chaque espace.
*/
operations.GCstcc = class GCstcc extends Operation {
  constructor (nom) { super(nom, 0) }

  prochMoisATraiter (esp, type) { // n==1 pour moisStat et n== 3 pour moisStatT
    /* Après la date de création, après le dernier mois calculé */
    const n = statistiques[type]
    const moisesp = Math.floor((esp.dcreation) / 100)
    const prc = AMJ.moisPlus(moisesp, n) // premier à calculer
    const dmc = esp[type] || 0 // dernier mois déjà calculé
    return prc > dmc ? prc : AMJ.moisPlus(dmc, 1)
  }

  async phase2 () {
    const moisauj = Math.floor(this.auj / 100) 
    const MS = 'moisStat'
    const SM = statistiques[MS]
    const MX = 3 // Pour stats on ne sait pas calculer avant M-3

    const dh = Date.now()
    for(let nr = 0; nr < 3; nr++)
      try {
        const stats = { nbstc: 0 }
        const rowEspaces = await this.coll('espaces')
        for (const row of rowEspaces) {
          const esp = compile(row)
          let proch = this.prochMoisATraiter(esp, MS)
          // dernier mois calculable: pour moisStat c'est M-1
          const derc = AMJ.moisMoins(moisauj, SM)
        
          for(let mr = SM; mr < MX; mr++) {
            if (proch > derc) break
            proch = AMJ.moisPlus(proch, 1)
            const arg = { org: esp.org, mr }
            await new operations.ComptaStat(true).run(arg)
            stats.nbstc++
          }
        }
        const data = { id: 20, v: dh, nr: nr, duree: Date.now() - dh,
          stats: stats
        }
        this.setSingleton(data)
        break  
      } catch (e) {
        const info = e.toString() + '\n' + e.stack
        trace('GCstcc-ER1' , 0, info, true)
        const data = { id: 20, v: dh, nr: nr, duree: Date.now() - dh,
          stats: {}, exc: info
        }
        this.setSingleton(data)
        sleep(nr * 10000)
      }
  }
}

/* GCstct : enregistrement des statistiques mensuelles des tickets
Pour chaque espace, demande le calcul / enregistrement du fichier
de M-1 s'il n'a pas déjà été enregistré avec la clé publique du 
Comptable de chaque espace.
*/
operations.GCstct = class GCstct extends Operation {
  constructor (nom) { super(nom, 1, 1) }

  prochMoisATraiter (esp, type) { // n==1 pour moisStat et n== 3 pour moisStatT
    /* Après la date de création, après le dernier mois calculé */
    const n = statistiques[type]
    const moisesp = Math.floor((esp.dcreation) / 100)
    const prc = AMJ.moisPlus(moisesp, n) // premier à calculer
    const dmc = esp[type] || 0 // dernier mois déjà calculé
    return prc > dmc ? prc : AMJ.moisPlus(dmc, 1)
  }

  async phase2 () {
    const moisauj = Math.floor(this.auj / 100) 
    const MS = 'moisStatT'
    const SM = statistiques[MS]
    const MX = 12 // Pour statT on ne sait pas calculer avant M-12

    const dh = Date.now()
    for(let nr = 0; nr < 3; nr++)
      try {
        const stats = { nbstt: 0 }
        const rowEspaces = await this.coll('espaces')
        for (const row of rowEspaces) {
          const esp = compile(row)
          let proch = this.prochMoisATraiter(esp, MS)
          // dernier mois calculable: pour moisStat c'est M-1
          const derc = AMJ.moisMoins(moisauj, SM)
        
          for(let mr = SM; mr < MX; mr++) {
            if (proch > derc) break
            proch = AMJ.moisPlus(proch, 1)
            const arg = { org: esp.org, mr }
            await new operations.TicketsStat(true).run(arg)
            stats.nbstt++
          }
        }
        const data = { id: 21, v: dh, nr: nr, duree: Date.now() - dh,
          stats: stats
        }
        this.setSingleton(data)
        break  
      } catch (e) {
        const info = e.toString() + '\n' + e.stack
        trace('GCstct-ER1' , 0, info, true)
        const data = { id: 21, v: dh, nr: nr, duree: Date.now() - dh,
          stats: {}, exc: info
        }
        this.setSingleton(data)
        sleep(nr * 10000)
      }
  }
}

/* OP_TestRSA: 'Test encryption RSA'
args.token
args.id
args.data
Retour:
- data: args.data crypré RSA par la clé publique de l'avatar
*/
operations.TestRSA = class TestRSA extends Operation {
  constructor (nom) { super(nom, 1)  }

  async phase2 (args) {
    const avatar = compile(await this.getRowAvatar(args.id, 'TestRSA-1'))
    const pub = avatar.pub
    const data = crypterRSA(pub, args.data)
    this.setRes('data', new Uint8Array(data))
  }
}

/* OP_CrypterRaw: 'Test d\'encryptage serveur d\'un buffer long',
Le serveur créé un binaire dont,
- les 256 premiers bytes crypte en RSA, la clé AES, IV et l'indicateur gz
- les suivants sont le texte du buffer long crypté par la clé AES générée.
args.token
args.id
args.data
args.gz
Retour:
- data: "fichier" binaire auto-décryptable en ayant la clé privée RSA
*/
operations.CrypterRaw = class CrypterRaw extends Operation {
  constructor (nom) { super(nom, 1)  }

  async phase2 (args) {
    const avatar = compile(await this.getRowAvatar(args.id, 'TestRSA-1'))
    const pub = avatar.pub
    const data = crypterRaw(this.db.appKey, pub, args.data, args.gz)
    /*
    const d2 = decrypterRaw(this.db.appKey, data)
    const t = d2.toString()
    console.log(t.substring(0, 30))
    */
    this.setRes('data', new Uint8Array(data))
  }
}

/* OP_ComptaStat : 'Enregistre en storage la statistique de comptabilité'
du mois M-1 ou M-2 ou M-3 pour l'organisation org.
args.org: code de l'organisation
args.mr: de 1 à 3, mois relatif à la date du jour.
Retour:
- URL d'accès au fichier dans le storage

Le dernier mois de disponibilté de la statistique comptable est enregistrée dans
l'espace s'il est supérieur à celui existant.
*/
operations.ComptaStat = class ComptaStat extends Operation {
  constructor (gc) { 
    super('ComptaStat', gc ? 3 : 1, 1)
    if (gc) this.gc = true
  }

  static cptM = ['IT', 'NJ', 'QC', 'Q1', 'Q2', 'NL', 'NE', 'VM', 'VD', 'NN', 'NC', 'NG', 'V2']

  get sep () { return ','}

  /* Cette méthode est invoquée par collNs en tant que 
  "processeur" de chaque row récupéré pour éviter son stockage en mémoire
  puis son traitement
  */
  processData (op, data) {
    const dcomp = decode(data)
    const c = new Compteurs(dcomp.compteurs)
    const vx = c.vd[op.mr]
    const nj = Math.ceil(vx[Compteurs.MS] / 86400000)
    if (!nj) return
    
    const it = dcomp.it || 0 // indice tribu
    const x1 = Compteurs.X1
    const x2 = Compteurs.X1 + Compteurs.X2
    const qc = Math.round(vx[Compteurs.QC])
    const q1 = Math.round(vx[Compteurs.Q1])
    const q2 = Math.round(vx[Compteurs.Q2])
    const nl = Math.round(vx[Compteurs.NL + x1])
    const ne = Math.round(vx[Compteurs.NE + x1])
    const vm = Math.round(vx[Compteurs.VM + x1])
    const vd = Math.round(vx[Compteurs.VD + x1])
    const nn = Math.round(vx[Compteurs.NN + x2])
    const nc = Math.round(vx[Compteurs.NC + x2])
    const ng = Math.round(vx[Compteurs.NG + x2])
    const v2 = Math.round(vx[Compteurs.V2 + x2])
    op.lignes.push([it, nj, qc, q1, q2, nl, ne, vm, vd, nn, nc, ng, v2].join(op.sep))
  }

  async creation () {
    this.lignes = []
    this.lignes.push(operations.ComptaStat.cptM.join(this.sep))
    await this.db.collNs(this, 'comptas', this.ns, this.processData)
    const calc = this.lignes.join('\n')
    this.lignes = null

    const avatar = compile(await this.getRowAvatar(this.idC, 'ComptaStat-1'))
    const fic = crypterRaw(this.db.appKey, avatar.pub, Buffer.from(calc), true)
    await this.storage.putFile(this.args.org, ID.court(this.idC), 'C_' + this.mois, fic)
  }

  async phase2 (args) {
    const espace = await this.getEspaceOrg(args.org)
    if (!espace) throw new AppExc(A_SRV, 18, [args.texte])
    this.ns = espace.id
    if (args.mr < 0 || args.mr > 2) args.mr = 1
    const m = AMJ.djMoisN(this.auj, - args.mr)
    this.mr = args.mr
    this.mois = Math.floor(m / 100)

    this.idC = ID.duComptable(this.ns)
    this.setRes('getUrl', await this.storage.getUrl(args.org, ID.court(this.idC), 'C_' + this.mois))

    if (espace.moisStat && espace.moisStat >= this.mois) {
      this.phase2 = null
      this.setRes('creation', false)
    } else {
      this.setRes('creation', true)
      await this.creation()
      if (args.mr === 0) this.phase2 = null
    }
    this.setRes('mois', this.mois)
    
    if (!this.estFige) {
      const espace = compile(await this.getRowEspace(this.ns, 'ComptaStat-2'))
      if (!espace.moisStat || espace.moisStat < this.mois) {
        espace.moisStat = this.mois
        espace.v++
        this.update(espace.toRow())
      }
    }
  }
}

/* OP_TicketsStat : 'Enregistre en storage la liste des tickets de M-3 désormais invariables'
args.token: éléments d'authentification du compte.
args.org: code de l'organisation
args.mr: mois relatif

Le dernier mois de disponibilté de la statistique est enregistrée dans
l'espace s'il est supérieur à celui existant.
Purge des tickets archivés
*/
operations.TicketsStat = class TicketsStat extends Operation {
  constructor (gc) { 
    super('TicketsStat', gc ? 3 : 1, 1)
    if (gc) this.gc = true
  }

  static cptM = ['IDS', 'TKT', 'DG', 'DR', 'MA', 'MC', 'REFA', 'REFC']

  get sep () { return ','}

  /* Cette méthode est invoquée par collNs en tant que 
  "processeur" de chaque row récupéré pour éviter son stockage en mémoire
  puis son traitement
  - `id`: id du Comptable.
  - `ids` : numéro du ticket
  - `v` : version du ticket.

  - `dg` : date de génération.
  - `dr`: date de réception. Si 0 le ticket est _en attente_.
  - `ma`: montant déclaré émis par le compte A.
  - `mc` : montant déclaré reçu par le Comptable.
  - `refa` : texte court (32c) facultatif du compte A à l'émission.
  - `refc` : texte court (32c) facultatif du Comptable à la réception.
  - `di`: date d'incorporation du crédit par le compte A dans son solde.
  */

  quotes (v) {
    if (!v) return '""'
    const x = v.replaceAll('"', '_')
    return '"' + x + '"'
  }

  processData (op, data) {  
    const d = decode(data)
    
    const ids = d.ids
    const tkt = op.quotes(idTkToL6(d.ids))
    const dg = d.dg
    const dr = d.dr
    const ma = d.ma
    const mc = d.mc
    const refa = op.quotes(d.refa)
    const refc = op.quotes(d.refc)
    op.lignes.push([ids, tkt, dg, dr, ma, mc, refa, refc].join(op.sep))
  }

  async creation () {
    this.lignes = []
    this.lignes.push(operations.TicketsStat.cptM.join(this.sep))
    await this.db.selTickets(this, this.idC, this.mois, this.processData)
    const calc = this.lignes.join('\n')
    this.lignes = null

    const avatar = compile(await this.getRowAvatar(this.idC, 'ComptaStatT-1'))
    const fic = crypterRaw(this.db.appKey, avatar.pub, Buffer.from(calc), true)
    await this.storage.putFile(this.args.org, ID.court(this.idC), 'T_' + this.mois, fic)
  }

  async phase2 (args) {
    const espace = await this.getEspaceOrg(args.org)
    if (!espace) throw new AppExc(A_SRV, 18, [args.texte])
    this.ns = espace.id
    const moisauj = Math.floor(this.auj / 100)
    this.mois = AMJ.moisMoins(moisauj, args.mr)

    this.idC = ID.duComptable(this.ns)
    this.setRes('getUrl', await this.storage.getUrl(args.org, ID.court(this.idC), 'T_' + this.mois))

    if (!espace.moisStatT || (espace.moisStatT < this.mois)) {
      await this.creation()
      this.setRes('creation', true)
    } else {
      this.setRes('creation', false)
      this.phase2 = null
    }
    this.setRes('mois', this.mois)

    if (!this.estFige) {
      const espace = compile(await this.getRowEspace(this.ns, 'ComptaStatT-2'))
      if (!espace.moisStatT || (espace.moisStatT < this.mois)) {
        espace.moisStatT = this.mois
        espace.v++
        this.update(espace.toRow())
        await this.db.delTickets (this, this.idC, this.mois)
      }
    }
  }
}

/*****************************************
GetUrlStat : retourne l'URL de get d'un fichier de stat mensuelle
Comme c'est un GET, les arguments sont en string (et pas en number)
args.token: éléments d'authentification du compte.
args.ns : 
args.mois :
args.cs : code statistique C ou T
*/
operations.GetUrlStat = class GetUrlStat extends Operation {
  constructor (nom) { super(nom, 1) }

  async phase2 (args) {
    const ns = parseInt(args.ns)
    const org = await this.org(ns)
    const idC = ID.court(ID.duComptable(ns))
    const url = await this.storage.getUrl(org, idC, args.cs + '_' + args.mois)
    this.setRes('getUrl', url)
    if (!this.id) this.setRes('appKey', this.db.appKey)
  }
}
