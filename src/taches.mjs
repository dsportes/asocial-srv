// import { AppExc, F_SRV, ID, d14 } from './api.mjs'
import { config } from './config.mjs'
import { operations } from './cfgexpress.mjs'
import { decode } from '@msgpack/msgpack'
import { Operation, Esp } from './modele.mjs'
import { compile } from './gendoc.mjs'
import { AMJ, ID, IDBOBSGC, Compteurs, idTkToL6 } from './api.mjs'
import { sleep, crypter, decrypterSrv } from './util.mjs'

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

  static dh (t) {
    const d = new Date(t)
    const x = ((d.getUTCFullYear() % 100) * 10000) + ((d.getUTCMonth() + 1) * 100) + d.getUTCDate()
    const h = (d.getUTCHours() * 10000) + (d.getUTCMinutes() * 100) + d.getUTCSeconds()
    const c = Math.floor(d.getUTCMilliseconds() / 10)
    return c + (h * 100) + (x * 100000000)
  }

  /* Pour une tâche non GC, c'est dans config.retrytache minutes
  Pour une tâche GC c'est le lendemain à config.heuregc heure 
  le numéro de tâche figurant en ms afin de forcer l'ordre d'exécution
  */
  static dhRetry (tache) {
    const now = Date.now()
    if (!tache || !Taches.OPSGC.has(tache.op)) return Taches.dh(now + config.retrytache)
    const nj = Math.floor(now / 86400000) + 1
    const h = (((config.heuregc[0] * 60) + config.heuregc[1]) * 60000)
    return Taches.dh((nj * 86400000) + h + tache.op)
  }

  /* Création des tâches GC n'existant pas dans taches
  Invoqué à la création d'un espace pour initilaiser ces taches dans une base vide.
  S'il manquait des taches par rapport à la liste, les ajoute.
  */
  static async initTachesGC (op) {
    const rows = await Taches.db.nsTaches(0)
    const s = new Set()
    Taches.OPSGC.forEach(t => { s.add(t)})
    rows.forEach(r => { s.delete(r.op) })
    for (const t of s) {
      const tache = new Taches({op: t, id: 0, ids: 0, ns: 0, dh: 0, exc: ''})
      tache.dh = tache.op // Taches.dhRetry(tache) + tache.op
      await Taches.db.setTache(op, tache)
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

  static async nouvelle (oper, top, id, ids) {
    const t = new Taches({
      op: top, 
      id: ID.long(id, oper.ns), 
      ids: ids ? ID.long(ids, oper.ns) : 0, 
      ns: oper.ns, 
      dh: Taches.dh(oper.dh), 
      exc: ''})
    oper.db.setTache(oper, t)
    oper.aTaches = true
  }

  constructor ({op, id, ids, ns, dh, exc}) {
    this.op = op; this.id = id; this.ids = ids; this.ns = ns; this.dh = dh; this.exc = exc
  }

  async doit () {
    const cl = Taches.OPCLZ[this.op]
    const args = { tache: this }

    /* La tâche est inscrite pour plus tard : en cas de non terminaison
    elle est déjà configurée pour être relancée. */
    this.dh = Taches.dhRetry(this)
    this.exc = ''
    await Taches.db.setTache(null, this)

    /* L'opération va être lancée N fois, jusqu'à ce qu'elle indique
    qu'elle a épuisé son travail.
    L'argument args indique
    - tache: l'objet tache (son op, id, ids ...)
    - fini: true quand l'opération a épuisé ce qu'elle avait à faire
    */
    while(!args.fini) {
      const op = new cl(Taches.OPNOMS[this.op])
      op.db = Taches.db
      op.storage = Taches.storage
      op.dh = Date.now()
      op.auj = AMJ.amjUtcDeT(op.dh)
      op.args = args
      op.nomop = Taches.OPNOMS[this.op]
      try {
        await op.run(args)
        if (args.fini) { // L'opération a épuisé ce qu'elle avait à faire
          if (!this.estGC) // La tache est supprimée
            await Taches.db.delTache(null, this.op, this.id, this.ids)
          // else : La tache est déjà inscrite pour sa prochaine exécution
          break
        }
      } catch (e) { // Opération sortie en exception
        // Enregistrement de l'exception : la tache est déjà inscrite pour relance 
        this.exc = e.toString()
        await Taches.db.setTache(null, this)
        break
      }
    }
  }

}

class Demon {
  static demon = null

  async run() {
    const lns = Esp.actifs()
    const dh = Taches.dh(Date.now())
    // eslint-disable-next-line no-constant-condition
    while (true) {
      let proch = await Taches.db.prochTache(null, dh, lns)
      if (!proch) {
        await sleep(500)
        proch = await Taches.db.prochTache(null, dh, lns)
        if (!proch) break
      }
      await new Taches(proch).doit()
    }
  }

}

/* OP_InitTachesGC: 'Initialisation des tâches du GC',
- token : jeton d'authentification de l'administrateur
Retour: [nx nc]
- nx : nombre de tâches existantes
- nc : nombre de tâches créées
*/
operations.InitTachesGC = class InitTachesGC extends Operation {
  constructor (nom) { super(nom, 3) }

  async phase2() {
    const x = await Taches.initTachesGC(this)
    this.setRes('nxnc', x)
  }
}

/* OP_StartDemon: 'Lancement immédiat du démon',
- token : jeton d'authentification de l'administrateur
Retour:
*/
operations.StartDemon = class StartDemon extends Operation {
  constructor (nom) { super(nom, 3) }

  async phase2() {
    Taches.startDemon()
  }
}

// détection d'une fin d'hébergement
operations.DFH = class DFH extends Operation {
  constructor (nom) { super(nom, 3); this.SYS = true }

  async phase2(args) {
    // Récupération de la liste des id des groupes à supprimer
    if (!args.lst) args.lst = await this.db.getGroupesDfh(this, this.auj)
    if (!args.lst.length) { args.fini = true; return }

    const idg = args.lst.pop()
    this.ns = ID.ns(idg)
    await this.supprGroupe(idg) // bouclera sur le suivant de hb jusqu'à épuisement de hb
  }
}

// détection d'une résiliation de compte
operations.DLV = class DLV extends Operation {
  constructor (nom) { super(nom, 3); this.SYS = true }

  async phase2(args) {
    // Récupération de la liste des id des comptes à supprimer
    if (!args.lst) args.lst = await this.db.getComptesDlv(this, this.auj)
    if (!args.lst.length) { args.fini = true; return }

    const id = args.lst.pop()
    this.ns = ID.ns(id)
    const c = await this.gd.getCO(ID.court(id))
    if (c) await this.resilCompte(c) // bouclera sur le suivant de hb jusqu'à épuisement de hb
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
    const suppr = AMJ.amjUtcPlusNbj(this.auj, IDBOBSGC)
    await this.db.purgeSPO(this, suppr)

    await this.db.purgeVER(this, suppr)

    args.fini = true
  }
}

/* statistique "mensuelle" des comptas (avec purges)
Pour chaque espace:
- obtention de moisStat: si c'est le mois courant, rien
- sinon calcul pour M-3, M-2, M-1 (selon moisTat) de CompMoisStat
*/
operations.STC = class STC extends Operation {
  constructor (nom) { super(nom, 3); this.SYS = true }

  async phase2(args) {
    args.fini = true
  }
}

// statistique "mensuelle" des tickets (avec purges)
operations.STT = class STT extends Operation {
  constructor (nom) { super(nom, 3); this.SYS = true }

  async phase2(args) {
    args.fini = true
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
    this.ns = ID.ns(idag)
    await this.db.delScoll(this, 'notes', args.tache.id)
    const esp = await this.gd.getES(true)
    if (esp) await this.storage.delId(esp.org, ID.court(idag))
    args.fini = true
  }
}

// gestion et purges des chats de l'avatar
operations.AVC = class AVC extends Operation {
  constructor (nom) { super(nom, 3); this.SYS = true }

  async phase2(args) {
    const ida = args.tache.id
    this.ns = ID.ns(ida)
    for (const row of await this.db.scoll(this, 'chats', ida, 0)) {
      const chI = compile(row)
      const chE = await this.gd.getCAV(chI.idE, chI.idsE)
      if (chE) chE.chEdisp()
    }
    await this.db.delScoll(this, 'chats', ida)
    args.fini = true
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
  constructor (nom) { super(nom, 0); this.SYS = true }

  get sep () { return ','}

  async creation () {
    this.lignes = []
    this.lignes.push(Compteurs.CSVHDR(this.sep))
    await this.db.collNs(
      this, 
      'comptas', 
      this.ns, 
      (op, data) => { Compteurs.CSV(op.lignes, this.mr, this.sep, data) }
      // (op, data) => { Compteurs.CSV(op.lignes, 0, this.sep, data) }
    )
    const calc = this.lignes.join('\n')
    this.lignes = null
    const buf = Buffer.from(calc)
    const buf2 = crypter(this.cleES, buf)
    // const buf3 = decrypter(this.cleES, buf2)
    // console.log('' + buf3)
    await this.storage.putFile(this.args.org, this.id, 'C_' + this.mois, buf2)
  }

  async phase2 (args) {
    const espace = await this.gd.getESOrg(args.org, true, true)
    this.cleES = decrypterSrv(this.db.appKey, espace.cleES)
    if (args.mr < 0 || args.mr > 2) args.mr = 1
    const m = AMJ.djMoisN(this.auj, - args.mr)
    this.mr = args.mr
    this.mois = Math.floor(m / 100)
    this.setRes('mois', this.mois)

    this.id = ID.duComptable() // 100000...
    this.setRes('getUrl', await this.storage.getUrl(args.org, this.id, 'C_' + this.mois))

    if (espace.moisStat && espace.moisStat >= this.mois) {
      this.setRes('creation', false)
    } else {
      this.setRes('creation', true)
      if (args.mr !== 0) espace.setMoisStat(this.mois)
      await this.creation()
    }
  }
}

/* OP_TicketsStat : 'Enregistre en storage la liste des tickets de M-3 désormais invariables'
args.token: éléments d'authentification du compte.
args.org: code de l'organisation
args.mr: mois relatif

Le dernier mois de disponibilté de la statistique est enregistré dans
l'espace s'il est supérieur à celui existant.
Purge des tickets archivés
*/
operations.TicketsStat = class TicketsStat extends Operation {
  constructor () { super('TicketsStat'); this.SYS = true }

  static cptM = ['IDS', 'TKT', 'DG', 'DR', 'MA', 'MC', 'REFA', 'REFC']

  get sep () { return ','}

  /* Ticket
  - `ids` : numéro du ticket - ns + aamm + 10 chiffres rnd
  - `dg` : date de génération.
  - `dr`: date de réception. Si 0 le ticket est _en attente_.
  - `ma`: montant déclaré émis par le compte A.
  - `mc` : montant déclaré reçu par le Comptable.
  - `refa` : texte court (32c) facultatif du compte A à l'émission.
  - `refc` : texte court (32c) facultatif du Comptable à la réception.
  */

  quotes (v) {
    if (!v) return '""'
    const x = v.replaceAll('"', '_')
    return '"' + x + '"'
  }

  async creation () {
    this.lignes = []
    this.lignes.push(operations.TicketsStat.cptM.join(this.sep))
    // async selTickets (op, id, aamm, fnprocess)
    await this.db.selTickets(
      this, 
      ID.duComptable(this.ns), 
      this.ns,
      this.mois,
      (op, data) => { 
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
    )
    const calc = this.lignes.join('\n')
    this.lignes = null

    const buf = Buffer.from(calc)
    const buf2 = crypter(this.cleES, buf)
    // const buf3 = decrypter(this.cleES, buf2)
    // console.log('' + buf3)
    await this.storage.putFile(this.args.org, ID.court(this.idC), 'T_' + this.mois, buf2)
  }

  async phase2 (args) {
    const espace = await this.gd.getESOrg(args.org, false, true)
    this.cleES = decrypterSrv(this.db.appKey, espace.cleES)

    this.ns = espace.id
    const moisauj = Math.floor(this.auj / 100)
    this.mois = AMJ.moisMoins(moisauj, args.mr)

    this.idC = ID.duComptable(this.ns)
    this.setRes('getUrl', await this.storage.getUrl(args.org, ID.court(this.idC), 'T_' + this.mois))
    this.setRes('mois', this.mois)
    if (espace.moisStatT && espace.moisStatT >= this.mois) {
      this.setRes('creation', false)
    } else {
      this.setRes('creation', true)
      await this.creation()
      if (!espace.fige && args.mr > 3) {
        espace.setMoisStatT(this.mois)
        await this.db.delTickets (this, this.idC, this.ns, this.mois)
      }
    }
  }
}

/*****************************************
GetUrlStat : retourne l'URL de get d'un fichier de stat mensuelle
Comme c'est un GET, les arguments sont en string (et pas en number)
args.token: éléments d'authentification du compte.
args.org : 
args.mois :
args.cs : code statistique C ou T
*/
operations.GetUrlStat = class GetUrlStat extends Operation {
  constructor (nom) { super(nom, 1) }

  async phase2 (args) {
    const id = ID.duComptable() // 100000...
    const url = await this.storage.getUrl(args.org, id, args.cs + '_' + args.mois)
    this.setRes('getUrl', url)
  }
}

/*************************************************/
Taches.OPCLZ = {
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
