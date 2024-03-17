import { AppExc, F_SRV, ID, Compteurs,  d14 } from './api.mjs'
import { config } from './config.mjs'
import { operations } from './cfgexpress.mjs'
import { eqU8 } from './util.mjs'

import { Operation, Cache, assertKO} from './modele.mjs'
import { compile, Espaces, Versions, Syntheses, Partitions, Comptes, 
  Avatars, Comptas, Sponsorings } from './gendoc.mjs'
import { Rds } from './api.mjs'

// Pour forcer l'importation des opérations
export function load4 () {
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

/* `CreerEspace` : création d'un nouvel espace et du comptable associé
- token : jeton d'authentification du compte de **l'administrateur**
- ns : numéro de l'espace
- org : code de l'organisation
- hXR : hash du PBKFD de la phrase secrète réduite
- hXC : hash du PBKFD de la phrase secrète complète
- cleE : clé de l'espace
- cleEK : clé de l'espace cryptée par la clé K du Comptable
- clePK: clé P de la partition 1 cryptée par la clé K du Comptable
- cleAP: clé A du Comptable cryptée par la clé de la partition
- cleAK: clé A du Comptable cryptée par la clé K du Comptable
- cleKXC: clé K du Comptable cryptée par XC du Comptable (PBKFD de la phrase secrète complète).
- clePA: cle P de la partition cryptée par la clé A du Comptable
- ck: `{ cleP, code }` crypté par la clé K du comptable
Retour: rien

Création des rows:
- espace, synthese
- partition : primitive, avec le Comptable comme premier participant et délégué
- compte, compta, avatar: du Comptable

Exceptions: 
- F_SRV, 202 : ns non conforme.
- F_SRV, 201: code d'organisation invalide.
- F_SRV, 203 : Espace déjà créé.
- F_SRV, 204 : code d'organisation déjà attribué
*/
operations.CreerEspace = class CreerEspace extends Operation {
  constructor (nom) { super(nom, 3) }

  // eslint-disable-next-line no-useless-escape
  static reg = /^([a-z0-9\-]+)$/

  async phase2(args) {
    if (args.ns < 10 || args.ns > 89) throw new AppExc(F_SRV, 202, [args.ns])
    if ((args.org.length < 4) || (args.org.length > 8) || (!args.org.match(CreerEspace.reg))) 
      throw new AppExc(F_SRV, 201, [args.org])

    if (await Cache.getRow(this, 'espaces', args.ns)) throw new AppExc(F_SRV, 203, [args.ns, args.org])
    if (await Cache.getEspaceOrg(this, args.org)) throw new AppExc(F_SRV, 204, [args.ns, args.org])

    /* Espace */
    const espace = Espaces.nouveau (this, args.ns, args.org, args.cleE)
    const rvespace = new Versions().init({id: Rds.long(espace.rds, args.ns), v: 1, suppr: 0}).toRow()

    /* Synthese */
    const synthese = Syntheses.nouveau(args.ns)

    /* Partition */
    const partition = Partitions.nouveau(args.ns, 1, args.clePK, args.cleAP)
    const rvpartition = new Versions().init({id: Rds.long(partition.rds, args.ns), v: 1, suppr: 0}).toRow()

    /* Compte Comptable */
    const apr = config.allocPrimitive
    const o = { 
      clePA: args.clePA,
      rdsp: partition.rds,
      idp: ID.court(partition.id),
      del: true,
      it: 1
    }
    const cs = { cleEK: args.cleEK, qc: apr[0], qn: apr[1], qv: apr[2], c: args.ck } 
    const rdsav = Rds.nouveau('avatars')
    // (id, hXR, hXC, cleKXR, rdsav, cleAK, o, cs)
    const compte = Comptes.nouveau(ID.duComptable(args.ns), 
      (args.ns * d14) + args.hXR, args.hXC, args.cleKXC, args.cleEK, rdsav, args.cleAK, o, cs)
    const rvcompte = new Versions().init({id: Rds.long(compte.rds, args.ns), v: 1, suppr: 0}).toRow()
    
    /* Compta */
    const aco = config.allocComptable
    const qv = { qc: aco[0], qn: aco[1], qv: aco[2], nn: 0, nc: 0, ng: 0, v: 0 }
    const compta = new Comptas().init({
      id: compte.id, v: 1, rds: Rds.nouveau('comptas'), qv,
      compteurs: new Compteurs(null, qv).serial
    })
    const rvcompta = new Versions().init({id: Rds.long(compta.rds, args.ns), v: 1, suppr: 0}).toRow()
    
    /* Avatar */
    const avatar = new Avatars().init(
      { id: compte.id, v: 1, rds: rdsav, pub: args.pub, privK: args.privK })
    const rvavatar = new Versions().init({id: Rds.long(rdsav, args.ns), v: 1, suppr: 0}).toRow()

    // this.insert(this.setRes(espace.toRow()))
    this.insert(espace.toRow())
    this.insert(rvespace)
    this.insert(synthese.toRow())
    this.insert(partition.toRow())
    this.insert(rvpartition)
    this.insert(compte.toRow())
    this.insert(rvcompte)
    this.insert(compta.toRow())
    this.insert(rvcompta)
    this.insert(avatar.toRow())
    this.insert(rvavatar)
  }
}

/*`SetEspaceOptionA` : changement de l'option A, nbmi, dlvat par le Comptable
- `token` : jeton d'authentification du compte de **l'administrateur**
- `ns` : id de l'espace notifié.
- `optionA` : 0 1 2.
- dlvat: aaaammjj,
- nbmi:
Retour: rien
Assertion sur l'existence du row `Espaces`.
L'opération échappe au contrôle espace figé / clos.
Elle n'écrit QUE dans espaces.
*/
operations.SetEspaceOptionA = class SetEspaceOptionA extends Operation {
  constructor (nom) { super(nom, 2, 2)}

  async phase2 (args) {
    const espace = compile(await Cache.getRow(this, 'espaces', args.ns))
    if (!espace) throw assertKO('SetEspaceOptionA-1', 1, [args.ns])
    const vsp = await this.getV('SetEspaceOptionA-2', espace)
    vsp.v++
    espace.v = vsp.v
    if (args.optionA) espace.opt = args.optionA
    if (args.dlvat) espace.dlvat = args.dlvat
    if (args.nbmi) espace.nbmi = args.nbmi
    this.setRes('rowEspace', this.update(espace.toRow()))
    this.update(vsp.toRow())
  }
}

/** Ajout d\'un sponsoring ****************************************************
- `token` : éléments d'authentification du comptable / compte sponsor de sa tribu.
- `psK` : texte de la phrase de sponsoring cryptée par la clé K du sponsor.
- `YCK` : PBKFD de la phrase de sponsoring cryptée par la clé K du sponsor.
- `cleAYC` : clé A du sponsor crypté par le PBKFD de la phrase complète de sponsoring.
- `partitionId`: id de la partition si compte 0    
- `cleAP` : clé A du COMPTE sponsor crypté par la clé P de la partition.
- `clePYC` : clé P de sa partition (si c'est un compte "O") cryptée par le PBKFD 
  de la phrase complète de sponsoring (donne l'id de la partition).
- `nomYC` : nom du sponsorisé, crypté par le PBKFD de la phrase complète de sponsoring.
- `cvA` : `{ v, photo, info }` du sponsor, textes cryptés par sa cle A.
- `ardYC` : ardoise de bienvenue du sponsor / réponse du sponsorisé cryptée par le PBKFD de la phrase de sponsoring.

- `quotas` : `[qc, q1, q2]` pour un compte O, quotas attribués par le sponsor.
  - pour un compte "A" `[0, 1, 1]`. Un tel compte n'a pas de `qc` et peut changer à loisir
   `[qn, qv]` qui sont des protections pour lui-même (et fixe le coût de l'abonnement).
- don: montant du don pour un compte autonome sponsorisé par un compte autonome
- dconf: true, si le sponsor demande la confidentialité (pas de chat à l'avcceptation)
- del: true si le compte est délégué de la partition
Retour:
*/
operations.AjoutSponsoring = class AjoutSponsoring extends Operation {
  constructor (nom) { super(nom, 1, 1) }

  async phase2 (args) {
    if (await this.db.getCompteHXR(this.args.hps1)) 
      throw new AppExc(F_SRV, 207)

    if (args.partitionId) { // compte O
      const it = this.compte.it
      const partition = compile(await Cache.getRow(this, 'partitions', args.partitionId))
      if (!partition) 
        throw new AppExc(F_SRV, 208, [args.partitionId])
      const e = partition.tcpt[it]
      if (!e || !eqU8(e.cleAP, args.cleAP)) 
        throw new AppExc(F_SRV, 209, [args.partitionId, this.compte.id])
      if (!e.del) 
        throw new AppExc(F_SRV, 210, [args.partitionId, this.compte.id])

      const s = partition.getSynthese()
      const q = args.quotas
      // restants à attribuer suffisant pour satisfaire les quotas ?
      if (q.qc > (s.qc - s.ac) || q.qn > (s.qn - s.an) || q.qv > (s.sv - s.av))
        throw new AppExc(F_SRV, 211, [args.partitionId, this.compte.id])
    } else {
      if (this.estComptable) args.don = 2
      else {
        if (this.compta.solde <= args.don + 2)
          throw new AppExc(F_SRV, 212, [this.compta.solde, args.don])
      }
    }

    const sponsoring = new Sponsorings().nouveau(args)
    const avatar = compile(await Cache.getRow(this, 'avatars', sponsoring.id))
    const vsp = await this.getV('AjoutSponsoring-1', avatar)
    vsp.v++
    sponsoring.v = vsp.v
    sponsoring.dh = this.dh
    sponsoring.csp = this.compte.id
    sponsoring.itsp = this.compte.it
    this.insert(sponsoring.toRow())
    this.update(vsp.toRow())
  }
}

