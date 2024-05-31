// import { AppExc, F_SRV, ID, d14 } from './api.mjs'
import { config } from './config.mjs'
import { operations } from './cfgexpress.mjs'

import { Operation, Esp } from './modele.mjs'
// import { compile } from './gendoc.mjs'
import { AMJ, ID } from './api.mjs'

// Pour forcer l'importation des opérations
export function loadTaches (db, storage) {
  Taches.db = db
  Taches.storage = storage
  if (config.mondebug) config.logger.debug('Operations: ' + operations.auj)
}

export class Taches {
  static DFH = 1 // détection d'une fin d'hébergement

  static DLV = 2 // détection d'une résiliation de compte

  static TRA = 3 // traitement des transferts perdus

  static VER = 4 // purge des versions supprimées depuis longtemps

  static STC = 5 // statistique "mensuelle" des comptas (avec purges)

  static STT = 6 // statistique "mensuelle" des tickets (avec purges)

  static FPU = 7 // purge des fichiers à purger

  static GRM = 21 // purge des membres d'un groupe supprimé

  static AGN = 22 // purge des notes d'un groupe ou avatar supprimé

  static AVC = 24 // gestion et purges des chats de l'avatar

  static OPSGC = new Set([Taches.DFH, Taches.DLV, Taches.TRA, Taches.FPU, Taches.VER, Taches.STC, Taches.STT])

  get estGC () { return Taches.OPSGC.has(this.op) }

  static OPCLZ = {
    1: operations.DFH,
    2: operations.DLV,
    3: operations.TRA,
    4: operations.VER,
    5: operations.STC,
    6: operations.STT,
    7: operations.FPU,
    21: operations.GRM,
    22: operations.AGN,
    24: operations.AVC
  }

  static OPNOMS = {
    1: 'DFH',
    2: 'DLV',
    3: 'TRA',
    4: 'VER',
    5: 'STC',
    6: 'STT',
    7: 'FPU',
    21: 'GRM',
    22: 'AGN',
    24: 'AVC'
  }

  /* Pour une tâche non GC, c'est dans config.retrytache minutes
  Pour une tâche GC c'est le lendemain à config.heuregc heure 
  le numéro de tâche figurant en ms afin de forcer l'ordre d'exécution
  */
  static dhRetry (tache) {
    if (!tache || !Taches.OPSGC.has(tache.op)) return Date.now() + config.retrytache
    const nj = Math.floor(Date.now() / 86400000) + 1
    const h = (((config.heuregc[0] * 60) + config.heuregc[1]) * 60000)
    return (nj * 86400000) + h + tache
  }

  /* Création des tâches GC n'existant pas dans taches
  Invoqué à la création d'un espace pour initilaiser ces taches dans une base vide.
  S'il manquait des taches par rapport à la liste, les ajoute.
  */
  static async initTachesGC (op) {
    const rows = await Taches.db.nsTaches(0)
    const s = new Set()
    Taches.OPSGC.forEach(t => { s.add(t)})
    rows.forEach(r => { s.remove(r.op) })
    for (const t of s) {
      const dh = Taches.dhRetry(t)
      await Taches.db.setTache(op, t, 0, 0, dh, '')
    }
    return [Taches.OPSGC.size - s.size, s.size]
  }

  static startDemon () {
    if (Demon.demon) return
    Demon.demon = new Demon()
    setTimeout(async () => {
      await Demon.demon.run()
      Demon.demon = null
    }, 1)
  }

  constructor ({op, id, ids, ns, dh, exc}) {
    this.op = op; this.id = id; this.ids = ids; this.ns = ns; this.dh = dh; this.exc = exc
  }

  async doit () {
    const cl = Taches.OPCLZ[this.op]
    const args = { tache: this, ctx: {} }

    /* La tâche est inscrite pour plus tard : en cas de non terminaison
    elle est déjà configurée pour être relancée. */
    this.dh = Taches.dhRetry(this)
    this.exc = ''
    await Taches.db.setTache(this)

    /* L'opération va être lancée N fois, jusqu'à ce qu'elle indique
    qu'elle a épuisé son travail.
    L'argument args indique
    - tache: l'objet tache (son op, id, ids ...)
    - ctx: un objet de contexte qui est passé d'une itération à la suivante.
    - fini: true quand l'opération a épuisé ce qu'elle avait à faire
    */
    while(!args.fini) {
      const op = new cl(Taches.OPNOMS)
      op.db = Taches.db
      op.storage = Taches.storage
      op.dh = Date.now()
      op.auj = AMJ.amjUtcDeT(op.dh)
      op.args = args
      try {
        await op.run(args)
        if (args.fini) { // L'opération a épuisé ce qu'elle avait à faire
          if (!this.estGC) // La tache est supprimée
            await Taches.db.delTache(this.op, this.id, this.ids)
          // else : La tache est déjà inscrite pour sa prochaine exécution
          break
        }
      } catch (e) { // Opération sortie en exception
        // Enregistrement de l'exception : la tache est déjà inscrite pour relance 
        this.exc = e.toString()
        await Taches.db.setTache(this)
        break
      }
    }
  }

}

class Demon {
  static demon = null

  async run() {
    const lns = Esp.actifs()
    const dh = Date.now()
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const proch = await Taches.db.prochTache(dh, lns)
      if (!proch) break
      await new Taches(proch).doit()
    }
  }

}

operations.InitTachesGC = class InitTachesGC extends Operation {
  constructor (nom) { super(nom, 3) }

  async phase2() {
    const x = await Taches.initTachesGC(this)
    this.setRes('nxnc', x)
  }
}

operations.DFH = class DFH extends Operation {
  constructor (nom) { super(nom, 3); this.SYS = true }

  async phase2(args) {
    // Récupération de la liste des id des groupes à supprimer
    if (args.ctx.lst) args.ctx.lst = await this.db.getGroupesDfh(this, this.auj)
    if (!args.ctx.lst.length) { args.ctx.fini = true; return }

    const idg = args.ctx.lst.pop()
    this.ns = ID.ns(idg)
    await this.supprGroupe(idg) // bouclera sur le suivant de hb jusqu'à épuisement de hb
  }
}

operations.DLV = class DLV extends Operation {
  constructor (nom) { super(nom, 3); this.SYS = true }

  async phase2(args) {
    // Récupération de la liste des id des comptes à supprimer
    if (args.ctx.lst) args.ctx.lst = await this.db.getComptesDlv(this, this.auj)
    if (!args.ctx.lst.length) { args.ctx.fini = true; return }

    const id = args.ctx.lst.pop()
    this.ns = ID.ns(id)
    await this.supprGroupe(id) // bouclera sur le suivant de hb jusqu'à épuisement de hb
  }
}

operations.TRA = class TRA extends Operation {
  constructor (nom) { super(nom, 3); this.SYS = true }

  async phase2(args) {
    // Récupération des couples (id, ids] des transferts à solder
    const lst = await this.db.listeTransfertsDlv(this, this.auj)  
    for (const [id, idf] of lst) {
      if (id && idf) {
        const ns = ID.ns(id)
        const esp = await this.gd.getES(ns)
        if (esp) {
          const idi = ID.court(id)        
          await this.storage.delFiles(esp.org, idi, [idf])
          await this.db.purgeTransferts(this, id, idf)
        }
      }
    }
    args.fini = true
  }
}

/* Purge de fichiers qui auraient dû l'être mais qu'une exception
a empêché:
- soit un seul fichier d'une note (remplacement / suppression),
- soit tous les fichiers (nominativement) d'une note supprimée
*/
operations.FPU = class FPU extends Operation {
  constructor (nom) { super(nom, 3); this.SYS = true }

  async phase2(args) {
    /* Retourne une liste d'objets  { id, idag, lidf } PAS de rows */
    const lst = await this.db.listeFpurges(this)  
    for (const fpurge of lst) {
      if (fpurge.id && fpurge.idag && fpurge.lidf) {
        const ns = ID.ns(fpurge.id)
        const esp = await this.gd.getES(ns)
        if (esp) {
          const idi = ID.court(fpurge.idag)  
          await this.storage.delFiles(esp.org, idi, fpurge.lidf)
          await this.db.unsetFpurge(this, fpurge.id)
        }
      }
    }
    args.fini = true
  }
}
/* Purges des sponsorings et versions ayant dépassé,
- leur dlv pour sponsorings,
- leur suppr pour versions.
*/
operations.VER = class VER extends Operation {
  constructor (nom) { super(nom, 3); this.SYS = true }

  async phase2(args) {
    await this.db.purgeSPO(this, this.auj)

    await this.db.purgeVER(this, this.auj)

    args.fini = true
  }
}

operations.STC = class STC extends Operation {
  constructor (nom) { super(nom, 3); this.SYS = true }

  async phase2() {
  }
}

operations.STT = class STT extends Operation {
  constructor (nom) { super(nom, 3); this.SYS = true }

  async phase2() {
  }
}

// purge des membres d'un groupe supprimé
operations.GRM = class GRM extends Operation {
  constructor (nom) { super(nom, 3); this.SYS = true }

  async phase2(args) {
    await this.db.delScoll(this, 'membres', args.tache.id)
    args.fini = true
  }
}

// purge des notes d'un groupe ou avatar supprimé et des fichiers attachés
operations.AGN = class AGN extends Operation {
  constructor (nom) { super(nom, 3); this.SYS = true }

  async phase2(args) {
    const idag = args.tache.id
    const ns = ID.ns(idag)
    await this.db.delScoll(this, 'notes', args.tache.id)
    const esp = await this.gd.getES(ns)
    if (esp) await this.storage.delId(esp.org, ID.court(idag))
    args.fini = true
  }
}

// gestion et purges des chats de l'avatar
operations.AVC = class AVC extends Operation {
  constructor (nom) { super(nom, 3); this.SYS = true }

  async phase2(args) {
    /*
    const ida = args.tache.id
    for (const row of await this.db.scoll(this, 'chats', ida, 0)) {
      const ch = compile(row)

    }
    await this.db.delScoll(this, 'chats', ida)
    */
    args.fini = true
  }
}
