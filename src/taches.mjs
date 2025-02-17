import { config } from './config.mjs'
import { operations } from './cfgexpress.mjs'
import { Operation, Esp, trace } from './modele.mjs'
import { compile } from './gendoc.mjs'
import { AMJ, ID, F_SRV, E_SRV, A_SRV, AppExc, IDBOBSGC, limitesjour, NBMOISENLIGNETKT } from './api.mjs'
import { sleep, decrypterSrv, sendAlMail } from './util.mjs'

// Pour forcer l'importation des opérations
export function loadTaches () {
  if (config.mondebug) config.logger.debug('Operations: ' + operations.auj)
}

export class Taches {
  static demon = false

  static DFH = 1 // détection d'une fin d'hébergement

  static DLV = 2 // détection d'une résiliation de compte

  static TRA = 3 // traitement des transferts perdus

  static VER = 4 // purge des versions supprimées depuis longtemps

  static STA = 5 // statistique "mensuelle" des comptas et des tickets

  static FPU = 7 // purge des fichiers à purger

  static GRM = 21 // purge des membres d'un groupe supprimé

  static AGN = 22 // purge des notes d'un groupe ou avatar supprimé

  static AVC = 24 // gestion et purges des chats de l'avatar

  static OPSGC = new Set([Taches.DFH, Taches.DLV, Taches.TRA, Taches.FPU, Taches.VER, Taches.STA])

  get estGC () { return Taches.OPSGC.has(this.op) }

  static OPNOMS = {
    1: 'DFH',
    2: 'DLV',
    3: 'TRA',
    4: 'VER',
    5: 'STA',
    7: 'FPU',
    21: 'GRM',
    22: 'AGN',
    24: 'AVC'
  }

  static dh (t) {
    // const x = new Date(t).toISOString()
    return t
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

  static async nouvelle (oper, top, id, ids) {
    const t = new Taches({
      op: top, 
      id: id || '',
      ids: ids || '', 
      ns: oper.ns, 
      dh: Taches.dh(oper.dh), 
      exc: ''})
    oper.db.setTache(t)
    oper.aTaches = true
  }

  static prochTache (dbp, storage) {
    if (Taches.demon) return
    setTimeout(async () => { 
      if (!Taches.demon)
        try {
          const op = new operations.ProchTache('ProchTache', true) 
          await op.run({}, dbp, storage)
        } catch (e) {
          config.logger.error('ProchTache: ' + e.toString())
        }
    }, 1)
  }

  constructor ({op, id, ids, ns, dh, exc}) {
    this.op = op; this.id = id; this.ids = ids; this.ns = ns; this.dh = dh; this.exc = exc
  }

}

/* OP_InitTachesGC: 'Initialisation des tâches du GC',
- token : jeton d'authentification de l'administrateur
Retour: [nx nc]
- nx : nombre de tâches existantes
- nc : nombre de tâches créées
Création des tâches GC n'existant pas dans taches
Invoqué à la création d'un espace pour initilaiser ces taches dans une base vide.
 S'il manquait des taches par rapport à la liste, les ajoute.
*/
operations.InitTachesGC = class InitTachesGC extends Operation {
  constructor (nom) { super(nom, 3); this.SYS = true }

  async phase1() {
    const rows = await this.db.nsTaches('')
    const s = new Set()
    Taches.OPSGC.forEach(t => { s.add(t)})
    rows.forEach(r => { s.delete(r.op) })
    for (const t of s) {
      const tache = new Taches({op: t, id: '', ids: '', ns: '', dh: 0, exc: ''})
      tache.dh = tache.op // Taches.dhRetry(tache) + tache.op
      await this.db.setTache(tache)
    }
    this.setRes('nxnc', [Taches.OPSGC.size - s.size, s.size])
  }

  get phase2() { return null }
}

/*****************************************
GetTaches : retourne la liste des tâches en cours
args.token: éléments d'authentification du compte.
args.ns : 
  - null: toutes
  - '' : GC
  - 'x' : du ns x
*/
operations.GetTaches = class GetTaches extends Operation {
  constructor (nom) { super(nom, 3); this.SYS = true }

  async phase1 (args) {
    let taches
    if (args.ns === '*') taches = await this.db.toutesTaches()
    else taches = await this.db.nsTaches(args.ns)
    this.setRes('taches', taches)
  }

  get phase2() { return null }
}

/*****************************************
DelTache : suppression d'une tâche
args.token: éléments d'authentification du compte.
args.op ns id ids : 
*/
operations.DelTache = class DelTache extends Operation {
  constructor (nom) { super(nom, 3); this.SYS = true }

  async phase1 (args) {
    await this.db.delTache(args.op, args.ns, args.id, args.ids)
  }

  get phase2() { return null }
}

/*****************************************
GoTache : lancement immédiat d'une tâche
args.token: éléments d'authentification du compte.
args.op ns id ids : 
*/
operations.GoTache = class GoTache extends Operation {
  constructor (nom) { super(nom, 3); this.SYS = true }

  async phase1 (args) {
    this.ns = args.ns
    await this.db.delTache(args.op, args.ns, args.id, args.ids)
    await Taches.nouvelle(this, args.op, args.id, args.ids)
  }

  get phase2() { return null }
}

/* Opération ProchTache: lancement de la prochaine tâche
- s'il n'y a PAS de prochaine tache à traiter, FIN
- sinon RELANCE (en asynchrone) une nouvelle opération ProchTache pour traiter la tache suivante
*/
operations.ProchTache = class ProchTache extends Operation {
  constructor (nom, interne) { 
    super(nom, 0)
    this.interne = interne
    this.SYS = true
  }

  get phase2() { return null }

  async phase1 (args) {
    if (Taches.demon) return
    if (!this.interne) {
      if (args.code !== config.gccode) throw new AppExc(E_SRV, 12)
      this.result = { type: 'text/plain', bytes: Buffer.from('OK - ' + new Date().toISOString())}
    }

    try {
      Taches.demon = true
      await Esp.load(this.db)
      const lnsac = Esp.actifs()
      const lnsinac = Esp.inactifs()
      const dh = Taches.dh(Date.now())

      const proch = await this.db.prochTache(dh)
      if (proch) {
        await this.doit(new Taches(proch))
        Taches.demon = false
        Taches.prochTache(this.dbp, this.storage)
      } else
        Taches.demon = false
    } catch (e) {
      trace ('demon', 'run', e.toString(), true)
      Taches.demon = false
    }
  }

  async doit (tache) {
    const cl = Taches.OPCLZ[tache.op]
    const args = { tache }

    /* La tâche est inscrite pour plus tard : en cas de non terminaison
    elle est déjà configurée pour être relancée. */
    tache.dh = Taches.dhRetry(tache)
    tache.exc = ''
    await this.db.setTache(tache)

    /* L'opération va être lancée N fois, jusqu'à ce qu'elle indique
    qu'elle a épuisé son travail.
    L'argument args indique
    - tache: l'objet tache (son op, id, ids ...)
    - fini: true quand l'opération a épuisé ce qu'elle avait à faire
    */
    for(let i = 0; i < 100; i++) {
      const nom = Taches.OPNOMS[tache.op]
      try {
        const op = new cl(nom)
        await op.run(args, this.dbp, this.storage)
        if (args.fini) { // L'opération a épuisé ce qu'elle avait à faire
          if (!tache.estGC) // La tache est supprimée
            await this.db.delTache(tache.op, tache.org, tache.id, tache.ids)
          else // La tache est déjà inscrite pour sa prochaine exécution: set dhf
            await this.db.recTache(tache.op, tache.org, tache.id, tache.ids, Date.now(), args.nb || 0)
          break
        }
      } catch (e) { // Opération sortie en exception
        // Enregistrement de l'exception : la tache est déjà inscrite pour relance 
        tache.exc = e.message + (e.stack ? '\n' + e.stack : '')
        await this.db.setTache(tache)
        if (tache.exc.code !== 8995) {
          const al = config.alertes
          if (al) {
            const al1 = al['admin']
            if (al1)
              await sendAlMail(config.run.site, op.org || 'admin', al1, 'tache-' + nom + '-' + e.code)
          }
        }
        break
      }
    }
  }

}

class OperationT extends Operation {
  constructor (nom) {
    super(nom, 3)
    this.SYS = true
  }

  async checkOrg (org) {
    if (!org) return
    this.org = org
    this.espace = await Cache.getRow(this, 'espaces', '', true)
    if (!this.espace || this.espace.clos || this.espace.fige)
      throw new AppExc(F_SRV, 995)
  }

  // set: ns, idcourt, espace, fige
  checkNs (id) {
    this.idcourt = ID.court(id)
    this.espace = Esp.getEspSync(this, ID.ns(id)) // set this.ns this.org
    this.fige = this.espace ? this.espace.fige : true
  }

  checkNs2 (tache) {
    const id = tache.id
    this.alias = tache.ids
    this.ns = tache.ns
    this.idlong = ID.long(id, ns)
    this.espace = Esp.getEspSync(this, ns) // set this.ns this.org
    this.org = this.espace ? this.espace.org : ''
    this.fige = this.espace ? this.espace.fige : true
  }

  get phase1 () { return null }

}

// détection des groupes en fin d'hébergement
operations.DFH = class DFH extends OperationT {
  constructor (nom) { super(nom) }

  async phase2(args) {
    // Récupération de la liste des id des groupes à supprimer
    // Test d'une exc: throw new AppExc(A_SRV, 10, ['plantage DFH'])
    if (!args.lst) {
      args.lst = await this.db.getGroupesDfh(this.auj)
      args.nb = args.lst.length
    }
    if (!args.lst.length) { args.fini = true; return }

    const idg = args.lst.pop()
    this.checkNs (idg)
    if (!this.fige) {
      const groupe = await this.gd.getGR(this.idcourt)
      await this.supprGroupe(groupe) // bouclera sur le suivant de hb jusqu'à épuisement de hb
    }
  }
}

// détection des comptes au dela de leur DLV
operations.DLV = class DLV extends OperationT {
  constructor (nom) { super(nom) }

  async phase2(args) {
    // Récupération de la liste des id des comptes à supprimer
    if (!args.lst) {
      args.lst = await this.db.getComptasDlv(this.auj)
      args.nb = args.lst.length
    }
    if (!args.lst.length) { args.fini = true; return }

    const id = args.lst.pop()
    this.checkNs (id)
    if (!this.fige) {
      const c = await this.gd.getCO(this.idcourt)
      if (c) await this.resilCompte(c) // bouclera sur le suivant de hb jusqu'à épuisement de hb
    }
  }
}

/* récupération des transferts inachevés
IGNORE le fait que l'espace soit figé ou non: c'est une purge brutale.
*/
operations.TRA = class TRA extends OperationT {
  constructor (nom) { super(nom) }

  async phase2(args) {
    // Récupération des couples [id, idf] des transferts à solder
    const lst = await this.db.listeTransfertsDlv(this.auj) 
    args.nb = lst.length
    for (const [id, idf] of lst) {
      if (id && idf) {
        this.checkNs(id)
        if (this.org)
          await this.storage.delFiles(this.org, this.idcourt, [idf])
        await this.db.purgeTransferts(id, idf)
      }
    }
    args.fini = true
  }
}

/* Purge de fichiers qui auraient dû l'être mais qu'une exception
a empêché:
- soit un seul fichier d'une note (remplacement / suppression),
- soit tous les fichiers (nominativement) d'une note supprimée
IGNORE le fait que l'espace soit figé ou non: c'est une purge brutale.
*/
operations.FPU = class FPU extends OperationT {
  constructor (nom) { super(nom) }

  async phase2(args) {
    /* Retourne une liste d'objets  { id, idag, lidf } PAS de rows */
    const lst = await this.db.listeFpurges(this)
    args.nb = 0
    for (const fpurge of lst) {
      if (fpurge.id && fpurge.alias && fpurge.lidf) {
        this.checkNs (fpurge.id)
        args.nb += fpurge.lidf.length
        if (this.org)
          await this.storage.delFiles(this.org, fpurge.alias, fpurge.lidf)
        await this.db.unsetFpurge(fpurge.id)
      }
    }
    args.fini = true
  }
}

/* Purges des sponsorings et versions ayant dépassé,
- leur dlv pour sponsorings,
- leur suppr pour versions.
IGNORE le fait que l'espace soit figé ou non: c'est une purge brutale.
*/
operations.VER = class VER extends OperationT {
  constructor (nom) { super(nom) }

  async phase2(args) {
    args.nb = 0
    const suppr1 = AMJ.amjUtcPlusNbj(this.auj, -limitesjour.sponsoring)
    args.nb += await this.db.purgeSPO(suppr1)
    const suppr2 = AMJ.amjUtcPlusNbj(this.auj, -IDBOBSGC)
    args.nb += await this.db.purgeVER(suppr2)
    args.fini = true
  }
}

/* statistique "mensuelle" des comptas (avec purges) et des tickets
- todo : liste des stats à calculer. { org, t: 'C' ou 'T', mr, mois }
*/
operations.STA = class STA extends OperationT {
  constructor (nom) { super(nom) }

  async phase2(args) {
    if (!args.todo) {
      const mc = Math.floor(AMJ.amjUtc() / 100) // Mois courant
      args.todo = []
      await Esp.load(this.db)
      for (const [ns, row] of Esp.map) {
        const esp = compile(row)
        if (esp.fige) continue
        /* 
        - `creation` : date de création.
        - `moisStat` : dernier mois de calcul de la statistique des comptas.
        - `moisStatT` : dernier mois de calcul de la statistique des tickets.
        */
        const mcre = Math.floor(esp.creation / 100) // Mois de création
        // mois relatif du dernier calcul C / T
        const mrC = AMJ.nbMois(mc, esp.moisStat || AMJ.moisMoins(mcre, 1))
        const mrT = AMJ.nbMois(mc, esp.moisStatT || AMJ.moisMoins(mcre, 1))

        if (mrC > 1) { // Il y a un ou plusieurs mois à calculer C
          for(let mr = 3; mr > 0; mr--) {
            const mois = AMJ.moisMoins(mc, mr)
            if (mois >= mcre)
              args.todo.push({ org: esp.org, ns, t: 'C', mr, mois })
          } 
        }

        // Nombre de mois de calcul T à effectuer
        const nbmct = mrT - NBMOISENLIGNETKT - 1
        if (nbmct > 0) { // Il y a au moins un calcul T à effectuer
          for (let n = nbmct; n > 0; n--) {
            const mois = AMJ.moisMoins(mc, n + NBMOISENLIGNETKT)
            args.todo.push({ org: esp.org, ns, t: 'T', mois })
          }
        }
      }
      args.nb = args.todo.length
    }

    if (!args.todo.length) { args.fini = true; return }

    const s = args.todo.pop()
    const cleES = decrypterSrv(this.db.appKey, espace.cleES)
    if (s.t === 'C') {
      espace.setMoisStat(s.mois)
      await this.creationC(s.org, cleES, s.mois)
    } else if (s.t === 'T') {
      await this.creationT(s.org, cleES, s.mois)
      espace.setMoisStatT(s.mois)
      await this.db.delTickets(ID.duComptable(s.ns), s.ns, s.mois)
    }

    args.fini = !args.todo.length
  }
}

/********************************************
* Taches NON GC : GRM AGN AVC
*/

/* purge des membres d'un groupe supprimé
IGNORE le fait que l'espace soit figé ou non: c'est une purge brutale.
*/
operations.GRM = class GRM extends OperationT {
  constructor (nom) { super(nom) }

  async phase2(args) {
    this.checkNs2(args.tache)
    args.nb = await this.db.delScoll('membres', this.idlong)
    args.fini = true
  }
}

/* purge des notes d'un groupe ou avatar supprimé et des fichiers attachés
IGNORE le fait que l'espace soit figé ou non: c'est une purge brutale.
*/
operations.AGN = class AGN extends OperationT {
  constructor (nom) { super(nom) }

  async phase2(args) {
    this.checkNs2(args.tache)
    args.nb = await this.db.delScoll('notes', this.idlong)
    if (this.org) 
      await this.storage.delId(this.org, this.alias)
    args.fini = true
  }
}

// gestion et purges des chats de l'avatar
operations.AVC = class AVC extends OperationT {
  constructor (nom) { super(nom) }

  async phase2(args) {
    this.checkNs2(args.tache)
    if (!this.fige) {
      for (const row of await this.db.scoll('chats', this.idlong, 0)) {
        const chI = compile(row)
        const chE = await this.gd.getCAV(chI.idE, chI.idsE)
        if (chE) chE.chEdisp()
      }
      args.nb = await this.db.delScoll('chats', this.idlong)
    }
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
  constructor (nom) { 
    super(nom, 0)
    this.SYS = true
  }

  async phase2 (args) {
    await this.getEspaceOrg(args.org, 0, true)

    const cleES = decrypterSrv(this.db.appKey, espace.cleES)
    if (args.mr < 0 || args.mr > 2) args.mr = 1
    const m = AMJ.djMoisN(this.auj, - args.mr)
    const mois = Math.floor(m / 100)
    this.setRes('mois', mois)

    const idC = ID.duComptable() // 100000...
    this.setRes('getUrl', await this.storage.getUrl(args.org, idC, 'C_' + mois))

    if (this.espace.moisStat && this.espace.moisStat >= mois) {
      this.setRes('creation', false)
    } else {
      this.setRes('creation', true)
      if (args.mr !== 0) this.espace.setMoisStat(mois)
      await this.creationC(args.org, cleES, mois, args.mr)
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
  constructor (nom) { 
    super(nom, 0)
    this.SYS = true
  }

  async phase2 (args) {
    await this.getEspaceOrg(args.org, 0, true)

    const cleES = decrypterSrv(this.db.appKey, espace.cleES)

    const ns = espace.ns
    const moisauj = Math.floor(this.auj / 100)
    const mois = AMJ.moisMoins(moisauj, args.mr)

    this.setRes('getUrl', await this.storage.getUrl(args.org, ID.duComptable(), 'T_' + mois))
    this.setRes('mois', mois)
    if (this.espace.moisStatT && this.espace.moisStatT >= mois) {
      this.setRes('creation', false)
    } else {
      this.setRes('creation', true)
      await this.creationT(args.org, ns, cleES, mois)
      if (!espace.fige && args.mr > 3) {
        this.espace.setMoisStatT(mois)
        await this.db.delTickets(ID.duComptable(ns), ns, mois)
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
  5: operations.STA,
  7: operations.FPU,
  21: operations.GRM,
  22: operations.AGN,
  24: operations.AVC
}
