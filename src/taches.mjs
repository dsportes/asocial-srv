import { decode } from '@msgpack/msgpack'
// import { AppExc, F_SRV, ID, d14 } from './api.mjs'
import { config } from './config.mjs'
import { operations } from './cfgexpress.mjs'

import { Operation, Esp } from './modele.mjs'
// import { compile } from './gendoc.mjs'
// import { } from './api.mjs'

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

  static GRM = 21 // purge des membres d'un groupe supprimé

  static AGN = 22 // purge des notes d'un groupe ou avatar supprimé

  static AGF = 23 // purge d'un fichier supprimé OU des fichiers attachés aux notes d'un groupe ou avatar supprimé

  static AVC = 24 // gestion et purges des chats de l'avatar

  static OPSGC = new Set([Taches.DFH, Taches.DLV, Taches.TRA, Taches.VER, Taches.STC, Taches.STT])

  /* Pour une tâche non GC, c'est dans config.retrytache minutes
  Pour une tâche GC c'est le lendemain à config.heuregc heure 
  le numéro de tâche figurant en ms afin de forcer l'ordre d'exécution
  */
  static dhRetry (tache) {
    if (!tache || !Taches.OPSGC.has(tache)) return Date.now() + config.retrytache
    const nj = Math.floor(Date.now() / 86400000) + 1
    const h = (((config.heuregc[0] * 60) + config.heuregc[1]) * 60000)
    return (nj * 86400000) + h + tache
  }

  /* Création des tâches GC n'existant pas dans taches
  Invoqué à la création d'un espace pour initilaiser ces taches dans une base vide.
  S'il manquait des taches par rapport à la liste, les ajoute.
  */
  static async initTachesGC () {
    const rows = await Taches.db.nsTaches(0)
    const s = new Set()
    Taches.OPSGC.forEach(t => { s.add(t)})
    rows.forEach(r => { s.remove(r.op) })
    for (const t of s) {
      const dh = Taches.dhRetry(t)
      await Taches.db.setTache(t, 0, 0, dh, null)
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

  constructor ({op, id, ids, ns, dh, _data_}) {
    this.op = op; this.id = id; this.ids = ids; this.ns = ns; this.dh = dh; 
    this._data_ = _data_ ? decode(_data_) : null
  }

  async doit () {
    // TODO
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
    const x = await Taches.initTachesGC()
    this.setRes('nxnc', x)
  }
}
