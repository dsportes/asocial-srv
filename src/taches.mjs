import { config } from './config.mjs'
import { operations } from './cfgexpress.mjs'
import { Operation, trace } from './modele.mjs'
import { AMJ, ID, E_SRV, AppExc, IDBOBSGC, limitesjour, NBMOISENLIGNETKT } from './api.mjs'
import { decrypterSrv, sendAlMail } from './util.mjs'

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
      org: oper.org, 
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

  constructor ({op, id, ids, org, dh, exc}) {
    this.op = op; this.id = id; this.ids = ids; this.org = org; this.dh = dh; this.exc = exc
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
    const rows = await this.db.orgTaches('')
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
args.org : 
  - '*' : toutes taches
  - '' : GC
  - 'org' : 
*/
operations.GetTaches = class GetTaches extends Operation {
  constructor (nom) { super(nom, 3); this.SYS = true }

  async phase1 (args) {
    let taches
    if (args.org === '*') taches = await this.db.toutesTaches()
    else taches = await this.db.orgTaches(args.org)
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
    await this.db.delTache(args.op, args.org, args.id, args.ids)
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
    this.setOrg(args.org)
    await this.db.delTache(args.op, args.org, args.id)
    await Taches.nouvelle(this, args.op, args.id)
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

    const [org, idg] = args.lst.pop()
    await getEspaceOrg(org, 0, false, true)
    // Les espaces clos finiront par être purgés de la base (et n'apparaîtront plus en DFH)
    // Les espaces figés sont ignorés. Ils réapparaîtront jusqu'à ce qu'ils ne soient plus figés
    if (this.espace && !this.espace.clos && !this.espace.fige) {
      const groupe = await this.gd.getGR(idg)
      await this.supprGroupe(groupe)
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

    const [org, idc] = args.lst.pop()
    await getEspaceOrg(org, 0, false, true)
    if (this.espace && !this.espace.clos && !this.espace.fige) {
      const c = await this.gd.getCO(idc)
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
    // Récupération des documents { org, id, avgrid, idf } des transferts à solder
    const lst = await this.db.listeTransfertsDlv(this.auj) 
    args.nb = lst.length
    for (const d of lst) {
      await getEspaceOrg(d.org, 0, false, true)
      if (this.espace && !this.espace.clos && !this.espace.fige) {
        await this.storage.delFiles(d.org, d.avgrid, [d.idf])
        await this.db.purgeTransferts(d.id)
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
    /* Retourne une liste d'objets  { org, id, avgrid, lidf } */
    const lst = await this.db.listeFpurges(this)
    args.nb = 0
    for (const d of lst) {
      await getEspaceOrg(d.org, 0, false, true)
      if (this.espace && !this.espace.clos && !this.espace.fige) {
        await this.storage.delFiles(d.org, d.avgrid, d.lidf)
        await this.db.purgeFpurge(d.id)
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
- todo : liste des espaces ayant des stats à calculer.
*/
operations.STA = class STA extends OperationT {
  constructor (nom) { super(nom) }

  async phase2(args) {
    if (!args.todo) {
      args.todo = []

      const rows = await this.db.getRowEspacesCalc(this.auj)
      for(const row of rows) {
        const esp = GenDoc.compile(row)
        if (esp.fige || esp.clos) continue
        /* 
        - `creation` : date de création.
        - `moisStat` : dernier mois de calcul de la statistique des comptas.
        - `moisStatT` : dernier mois de calcul de la statistique des tickets.
        */
        const mcre = Math.floor(esp.creation / 100) // Mois de création
        const mauj = Math.floor(this.auj / 100) // Mois courant

        let mois = esp.moisStat || mcre // dernier mois de statC calculé
        while (mois < mauj) {
          args.todo.push({ org: esp.org, t: 'C', mois })
          mois = AMJ.moisPlus(mois, 1)
        }

        mois = esp.moisStatT || mcre // dernier mois de statT calculé
        while (mois < mauj) {
          const mr = AL.nbMois(mauj, mois)
          // calcul possible seulement dans les 3 derniers mois
          if (mr <= NBMOISENLIGNETKT)
            args.todo.push({ org: esp.org, t: 'C', mois })
          mois = AMJ.moisPlus(mois, 1)
        }
        args.nb = args.todo.length
      }
    }

    if (!args.todo.length) { 
      args.fini = true
      return 
    }

    const s = args.todo.pop()
    await getEspaceOrg(s.org, 0, false, true)
    const cleES = decrypterSrv(this.db.appKey, this.espace.cleES)
    if (s.t === 'C') {
      const buf = await this.creationC(s.org, cleES, s.mois)
      await this.storage.putFile(s.org, ID.duComptable(), 'C_' + s.mois, buf)
      this.espace.setMoisStat(s.mois)
    } else {
      const buf = await this.creationT(s.org, cleES, s.mois)
      await this.storage.putFile(s.org, ID.duComptable(), 'T_' + s.mois, buf)
      this.espace.setMoisStatT(s.mois)
      await this.db.delTickets(ID.duComptable(), s.mois)
    }

    args.fini = !args.todo.length
  }

}

/********************************************
* Taches NON GC : GRM AGN AVC
*/

/* purge des membres d'un groupe supprimé */
operations.GRM = class GRM extends OperationT {
  constructor (nom) { super(nom) }

  async phase2(args) {
    await getEspaceOrg(args.tache.org, 0, false, true)
    if (this.espace && !this.espace.clos && !this.espace.fige)
      args.nb = await this.db.delScoll('membres', args.tache.id)
    args.fini = true
  }
}

/* purge des notes d'un groupe ou avatar supprimé et des fichiers attachés
IGNORE le fait que l'espace soit figé ou non: c'est une purge brutale.
*/
operations.AGN = class AGN extends OperationT {
  constructor (nom) { super(nom) }

  async phase2(args) {
    await getEspaceOrg(tache.org, 0, false, true)
    if (this.espace && !this.espace.clos && !this.espace.fige)
      args.nb = await this.db.delScoll('notes', args.tache.id)
    await this.storage.delId(this.org, args.tache.id)
    args.fini = true
  }
}

// gestion et purges des chats de l'avatar
operations.AVC = class AVC extends OperationT {
  constructor (nom) { super(nom) }

  async phase2(args) {
    await getEspaceOrg(tache.org, 0, false, true)
    if (this.espace && !this.espace.clos && !this.espace.fige) {
      for (const row of await this.db.scoll('chats', args.tache.id, 0)) {
        const chI = GenDoc.compile(row)
        const chE = await this.gd.getCAV(chI.idE, chI.idsE)
        if (chE) chE.chEdisp()
      }
      args.nb = await this.db.delScoll('chats', args.tache.id)
    }
    args.fini = true
  }
}

/* OP_ComptaStat : 'Retourne la statistique de comptabilité de org d\'un mois relatif de 0 à -11'
Si déjà calculée, retourne juste son URL
Sinon la calcule et,
- la stocke si elle est d'un mois figé (pas M), que l'espace n'est pas figé
  et si c'est la suivante de la dernière calculée.
Retour:
- URL d'accès au fichier dans le storage
*/ 
class ComptaStat extends Operation {
  constructor (nom, m) { super(nom, m, 0) }

  numMois (m) {
    if (m === 0) return 0
    return (Math.floor(m / 100) * 12) + (m % 100)
  }

  async phase2 (args) {
    await this.getEspaceOrg(this.org, true)

    const cleES = decrypterSrv(this.db.appKey, this.espace.cleES)
    const mcre = Math.floor(this.espace.creation / 100)
    if (args.mois < mcre) throw new AppExc(A_SRV, 353)
    const mc = Math.floor(mc / 100)
    if (args.mois > mc) throw new AppExc(A_SRV, 354)

    const idC = ID.duComptable() // 100000...
    this.setRes('getUrl', await this.storage.getUrl(this.org, idC, 'C_' + args.mois))

    if (this.espace.moisStat && this.espace.moisStat >= args.mois) {
      // Demande d'une stat déjà calculée par le traitement mensuel
      this.setRes('creation', false)
      return
    }

    this.setRes('creation', true)
    const buf = await this.creationC(this.org, cleES, args.mois)
    await this.storage.putFile(org, idC, 'C_' + args.mois, buf)

    const moisSuivant = this.numMois(args.mois) === (this.numMois(this.espace.moisStat) + 1)
    // Enregistre par avance une stat mensuelle qui n'a pas encore été calculée par le GC
    if (!this.espace.fige && moisSuivant)
      this.espace.setMoisStat(args.mois)
  }

}

operations.ComptaStatC = class ComptaStatC extends ComptaStat {
  constructor (nom) { 
    super(nom, 2)
    this.targs = {
      mois: { t: 'mois' } //  mois relatif à la date du jour.
    }
  }

  phase1 (args) {
    super.phase1(args)
  }
}

operations.ComptaStatA = class ComptaStatA extends ComptaStat {
  constructor (nom) { 
    super(nom, 3)
    this.targs = {
      org: { t: 'org' }, // code de l'organisation
      mois: { t: 'mois' } //  mois relatif à la date du jour.
    }
  }

  phase1 (args) {
    super.phase1(args)
    this.setOrg(args.org)
  }
}

/* OP_TicketsStat : 'Enregistre en storage la liste des tickets de M-3 désormais invariables'
args.token: éléments d'authentification du compte.

Le dernier mois de disponibilté de la statistique est enregistré dans
l'espace s'il est supérieur à celui existant.
Purge des tickets archivés
*/
operations.TicketsStat = class TicketsStat extends Operation {
  constructor (nom) { 
    super(nom, 2)
    this.targs = {
      mr: { t: 'int', min: 0, max: 3 } //  mois relatif à la date du jour.
    }
  }

  async phase2 (args) {
    await this.getEspaceOrg(this.org, true)

    const cleES = decrypterSrv(this.db.appKey, this.espace.cleES)

    const moisauj = Math.floor(this.auj / 100)
    const mois = AMJ.moisMoins(moisauj, args.mr)

    this.setRes('getUrl', await this.storage.getUrl(this.org, ID.duComptable(), 'T_' + mois))
    this.setRes('mois', mois)
    if (this.espace.moisStatT && this.espace.moisStatT >= mois) {
      this.setRes('creation', false)
    } else {
      this.setRes('creation', true)
      const buf = await this.creationT(this.org, cleES, mois)
      if (!espace.fige && args.mr > 3) {
        this.espace.setMoisStatT(mois)
        await this.db.delTickets(ID.duComptable(), mois)
      }
      await this.storage.putFile(this.org, ID.duComptable(), 'T_' + mois, buf)
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

operations.GetUrlStat = class GetUrlStat extends Operation {
  constructor (nom) { super(nom, 1) }

  async phase2 (args) {
    const id = ID.duComptable() // 100000...
    const url = await this.storage.getUrl(args.org, id, args.cs + '_' + args.mois)
    this.setRes('getUrl', url)
  }
}
*/

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
