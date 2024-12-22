import { AppExc, A_SRV, F_SRV, ID, FLAGS, AMJ, MAXTAILLEGROUPE } from './api.mjs'
import { config } from './config.mjs'
import { operations } from './cfgexpress.mjs'
import { eqU8 } from './util.mjs'

import { Operation, trace } from './modele.mjs'
import { compile, Transferts } from './gendoc.mjs'
import { UNITEV, AL } from './api.mjs'

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
    id estA sync (ou null) setR 
    compte espace (lazy)
*/

/* SetEspaceOptionA : changement de l'option A, nbmi, par le Comptable */
operations.SetEspaceOptionA = class SetEspaceOptionA extends Operation {
  constructor (nom) { 
    super(nom, 2, 2)
    this.targs = { 
      optionA: { t: 'int', min: 0, max: 1, n: true}, // true si accepte le s compte A
      nbmi: { t: 'int', min: 3, max: 18, n: true } // nombre de mois d'inactivité avant suppression d'un compte
    }
  }

  async phase2 (args) {
    const espace = await this.setEspaceOrg(this.org)
    espace.setOptions(args.optionA, args.nbmi)
  }
}

/* SetEspaceDlvat : changement de dlvat par l'administrateur */
operations.SetEspaceDlvat = class SetEspaceDlvat extends Operation {
  constructor (nom) { 
    super(nom, 1, 0)
    this.targs = { 
      ns: { t: 'ns'}, // ns de l'espace concerné
      dlvat: { t: 'date' } // aaaammjj : date limite fixée par l'administrateur technique
    }
  }

  async phase2 (args) {
    const espace = await this.setEspaceNs(args.ns, true)
    espace.setDlvat(args.dlvat)
    // const dla = espace.dlvat ? espace.dlvat : AMJ.max
    // await Taches.nouvelle(this, Taches.ESP, this.ns, dla)
  }
}

/* Ajout d\'un sponsoring */
operations.AjoutSponsoring = class AjoutSponsoring extends Operation {
  constructor (nom) { 
    super(nom, 1, 2) 
    this.targs = { 
      id: { t: 'ida' }, // id du sponsor
      hYR: { t: 'ids' }, // hash du PBKFD de la phrase réduite de sponsoring,
      psK: { t: 'u8' }, // texte de la phrase de sponsoring cryptée par la clé K du sponsor.
      YCK: { t: 'u8' }, // PBKFD de la phrase de sponsoring cryptée par la clé K du sponsor.
      hYC: { t: 'ids' }, // hash du PBKFD de la phrase de sponsoring
      cleAYC: { t: 'u8' }, // clé A du sponsor crypté par le PBKFD de la phrase complète de sponsoring
      partitionId: { t: 'idp', n: true }, // id de la partition si compte "O" 
      cleAP: { t: 'u8', n: true }, // clé A du COMPTE sponsor crypté par la clé P de la partition.
      clePYC: { t: 'u8', n: true }, // clé P de sa partition (si c'est un compte "O") cryptée par le PBKFD de la phrase complète de sponsoring (donne l'id de la partition).
      nomYC: { t: 'u8' }, // nom du sponsorisé, crypté par le PBKFD de la phrase complète de sponsoring.
      cvA: { t: 'cv' }, // CV { id, v, ph, tx } du sponsor, (ph, tx) cryptés par sa cle A
      ardYC: { t: 'u8' }, // ardoise de bienvenue du sponsor / réponse du sponsorisé cryptée par le PBKFD de la phrase de sponsoring.
      htK: { t: 'u8' }, // hashtag attribué par le sponsor au sponsorisé (crypté cmlé K)
      txK: { t: 'u8' }, // texte attribué par le sponsor au sponsorisé (crypté cmlé K)
      quotas: { t: 'q' }, // quotas {qc, qn, qv} attribués par le sponsor
      don: { t: 'int', min: 1, max: 1000, n: true }, // montant du don pour un compte autonome sponsorisé par un compte autonome
      dconf: { t: 'bool' }, // true, si le sponsor demande la confidentialité (pas de chat à l'avcceptation)
      del: { t: 'bool', n: true }, // true si le compte est délégué de la partition
    }
  }

  async phase2 (args) {
    if (AL.has(this.flags, AL.LSNTF)) throw new AppExc(F_SRV, 801)
    if (AL.has(this.flags, AL.ARSN) || AL.has(this.flags, AL.ARNTF)) throw new AppExc(F_SRV, 802)

    if (!this.compte.mav[args.id]) throw new AppExc(A_SRV, 308)

    if (await this.db.getSponsoringIds(ID.long(args.hYR, this.ns))) 
      throw new AppExc(F_SRV, 207)

    const q = args.quotas
    if (args.partitionId) { // compte O
      const partition = await this.gd.getPA(args.partitionId, 'AjoutSponsoring')
      if (!this.estComptable) {
        const e = partition.mcpt[this.compte.id]
        if (!e || !eqU8(e.cleAP, args.cleAP)) 
          throw new AppExc(F_SRV, 209, [args.partitionId, this.compte.id])
        if (!e.del) 
          throw new AppExc(F_SRV, 210, [args.partitionId, this.compte.id])
      }
      const s = partition.getSynthese()
      if (q.qc > (s.q.qc - s.qt.qc)) throw new AppExc(F_SRV, 319, [s.q.qc - s.qt.qc, q.qc])
      if (q.qn > (s.q.qn - s.qt.qn)) throw new AppExc(F_SRV, 320, [s.q.qn - s.qt.qn, q.qn])
      if (q.qv > (s.q.qv - s.qt.qv)) throw new AppExc(F_SRV, 321, [s.q.qv - s.qt.qv, q.qv])
    } else {
      const s = await this.gd.getSY()
      if (q.qn > (s.qA.qn - s.qtA.qn)) throw new AppExc(F_SRV, 323, [s.qA.qn - s.qtA.qn, q.qn])
      if (q.qv > (s.qA.qv - s.qtA.qv)) throw new AppExc(F_SRV, 324, [s.qA.qv - s.qtA.qv, q.qv])
    }
    if (this.compta.solde - args.don < 2)
      throw new AppExc(F_SRV, 212, [this.compta.solde, args.don])

    await this.gd.nouvSPO(args, args.hYR, 'AjoutSponsoring')
  }
}

/* ProlongerSponsoring : prolongation d'un sponsoring existant */
operations.ProlongerSponsoring = class ProlongerSponsoring extends Operation {
  constructor (nom) { 
    super(nom, 1, 2)
    this.targs = {
      id: { t: 'ida'}, // identifiant de l'avatar du du sponsoring
      ids: { t: 'ids' }, // identifiant du sponsoring
      dlv: { t: 'date', n: true } // nouvelle date limite de validité `aaaammjj`ou 0 pour une  annulation.
    }
  }

  async phase2(args) {
    if (AL.has(this.flags, AL.LSNTF)) throw new AppExc(F_SRV, 801)
    if (AL.has(this.flags, AL.ARSN) || AL.has(this.flags, AL.ARNTF)) throw new AppExc(F_SRV, 802)

    const sp = await this.gd.getSPO(args.id, args.ids, 'ProlongerSponsoring')
    sp.prolonger(this.dh, args)
  }
}

/* GetCompta : retourne la compta d'un compte
Le demandeur doit être:
- le comptable,
- OU un délégué de sa partition si c'est un cpompte O
- OU avec un chat ayant un "mut" avec le demandé si c'est un compte A 
Retour:
- rowCompta s'il existe
*/
operations.GetCompta = class GetCompta extends Operation {
  constructor (nom) { 
    super(nom, 1)
    this.targs = {
      id: { t: 'ida' }, // id du compte dont la compta est demandée
      ids: { t: 'ids', n: true }
    }
  }

  async phase2 (args) {
    if (args.id !== this.id && !this.estComptable) {
      if (args.ids) {
        const chI = await this.gd.getCAV(this.id, this.args.ids)
        if (!chI || !chI.mutE) throw new AppExc(A_SRV, 342)
      } else {
        if (this.compte.idp) { // c'est un compte O
          if (!this.compte.del) throw new AppExc(F_SRV, 218)
          const partition = await this.gd.getPA(this.compte.idp, 'GetCompta-2')
          const e = partition.mcpt[args.id]
          if (!e) throw new AppExc(A_SRV, 342)
        } else throw new AppExc(A_SRV, 342)
      }
    }
    const compte = await this.gd.getCO(args.id, 'GetCompta-3')
    const compta = await this.gd.getCA(args.id, 'GetCompta-1')
    this.setRes('rowCompta', compta.toShortRow(this))
  }
}

/* GetComptaQv : retourne les compteurs qv de compteurs de la compta d'un compte
Retour: 
- comptaQV: rowCompta
*/
operations.GetComptaQv = class GetComptaQv extends Operation {
  constructor (nom) { 
    super(nom, 1)
    this.targs = {
      id: { t: 'ida' } // id du compte
    } 
  }

  async phase2 (args) {
    const id = args.id || this.id
    if (id !== this.id && !this.estComptable) {
      if (!this.compte.del) throw new AppExc(F_SRV, 218)
    }
    const compta = await this.gd.getCA(id, 'GetCompta-1')
    this.setRes('comptaQv', compta.qv)
  }
}

/* SetDhvuCompte : enregistrement de la date-heure de _vue_ des notifications dans une session */
operations.SetDhvuCompte = class SetDhvuCompte extends Operation {
  constructor (nom) { 
    super(nom, 1, 2) 
    this.targs = {
      dhvu: { t: 'u8' } // date-heure cryptée par la clé K.
    } 
  }

  async phase2 (args) {
    this.compte.setDhvu(args.dhvu)
  }
}

/* GetAvatarPC: Récupération d\'un avatar par sa phrase de contact
Retour:
- cleAZC : clé A cryptée par ZC (PBKFD de la phrase de contact complète)
- cvA: carte de visite cryptée par sa clé A
- collision: true si la phrase courte pointe sur un  autre avatar
*/
operations.GetAvatarPC = class GetAvatarPC extends Operation {
  constructor (nom) { 
    super(nom, 1)
    this.targs = {
      hZR: { t: 'ids' }, // hash de la phrase de contact réduite
      hZC: { t: 'ids' } // hash de la phrase de contact complète
    }
  }

  async phase2 (args) {
    const av = compile(await this.db.getAvatarHk(ID.long(args.hZR, this.ns)))
    if (!av) return
    const avatar = await this.gd.getAV(av.id, 'GetAvatarPC')
    if (avatar && avatar.hZC === args.hZC) {
      this.setRes('cleAZC', avatar.cleAZC)
      this.setRes('cvA', avatar.cvA)
    } else this.setRes('collision', true)
  }
}

/* OperationCh : super classe permettant d'utiliser les méthodes intro1/2() */
class OperationCh extends Operation {

  async intro1 () {
    if (AL.has(this.flags, AL.ARSN) || AL.has(this.flags, AL.ARNTF)) await this.checkR()
  }

  // Vérification des restrictions, initialisations de :
  async intro2 () {
    this.chI = await this.gd.getCAV(this.args.id, this.args.ids, 'Chat-intro')
    this.chE = await this.gd.getCAV(this.chI.idE, this.chI.idsE)
    if (!this.chE) return false
    if (AL.has(this.flags, AL.ARSN) || AL.has(this.flags, AL.ARNTF)) await this.checkR()
    return true
  }

  /* Restriction MINI : ne pas l'appliquer: 
  - Au Compatble ni en I ni en E.
  - Quand le chat est utilisé "en cas d'urgence", 
    c'est à dire si le compte souhaite s'adresser à un délégué de sa partition
  - A un délégué quand il s'adresse à un compte de sa partition.
  */
  async checkR () { // Le chat E existe
    if (this.compte._estA || this.estComptable || ID.estComptable(this.args.idE)) return
    const avE = await this.gd.getAV(this.args.idE)
    const cptE = await this.gd.getCO(avE.idc, 'Chat-intro') // cptE pas null (chE existe)
    if (this.compte.del && cptE.idp === this.compte.idp) return
    if (this.cptE.del && cptE.idp === this.compte.idp) return
    throw new AppExc(F_SRV, 802)
  }
}

/* NouveauChat: 'Création d\'un nouveau chat' *********************************
Retour:
- rowChat : row du chat I.
*/
operations.NouveauChat = class NouveauChat extends OperationCh {
  constructor (nom) { 
    super(nom, 1)
    this.targs = {
      idI: { t: 'ida' }, // id de l'vatar du chat "interne"
      idE: { t: 'ida' }, // id de l'vatar du chat "externe"
      urgence: { t: 'bool', n: true }, // chats ouvert d'urgence
      mode: { t: 'modech' }, 
      // - 0: par phrase de contact - hZC en est le hash
      // - 1: idE est Comptable
      // - 2: idE est délégué de la partition de idI
      // - idg: idE et idI sont co-membres du groupe idg (idI a accès aux membres)
    
      // 0: par phrase de contact (hZC en est le hash),  
      // 1: idE est délégué de la partition de idI, 
      // idg: idE et idI sont co-membres du groupe idg (idI a accès aux membres)

      hZC : { t: 'ids', n: true }, // hash du PBKFD de la phrase de contact compléte pour le mode 0
      ch: { t: 'nvch' }, // { cck, ccP, cleE1C, cleE2C, t1c }
      // ccK: clé C du chat cryptée par la clé K du compte de idI
      // ccP: clé C du chat cryptée par la clé publique de idE
      // cleE1C: clé A de l'avatar E (idI) cryptée par la clé du chat.
      // cleE2C: clé A de l'avatar E (idE) cryptée par la clé du chat.
      // txt: item crypté par la clé C
    }
  }

  async phase2 (args) {
    if (this.compte.mav[args.idE]) throw new AppExc(A_SRV, 226)

    const avI = await this.gd.getAV(args.idI, 'NouveauChat-1')
    const avE = await this.gd.getAV(args.idE, 'NouveauChat-2')

    if (args.mode === 0) {
      if (avE.hZC !== args.hZC) throw new AppExc(A_SRV, 221)
    } else if (args.mode === 1) {
      if (!ID.estComptable(args.idE)) throw new AppExc(A_SRV, 225)
    } else if (args.mode === 2) {
      const partition = await this.gd.getPA(this.compte.idp)
      if (!partition || !partition.estDel(args.idE)) throw new AppExc(A_SRV, 222)
    } else {
      const groupe = await this.gd.getGR(args.mode)
      if (!groupe) throw new AppExc(A_SRV, 223)
      const imI = groupe.mmb.get(args.idI)
      const imE = groupe.mmb.get(args.idE)
      if (!imI || !imE) throw new AppExc(A_SRV, 223)
      const fI = groupe.flags[imI]
      if (!(fI & FLAGS.AC) && (fI & FLAGS.AM) && (fI & FLAGS.DM)) throw new AppExc(A_SRV, 223)
      if (!(fI & FLAGS.AC)) throw new AppExc(A_SRV, 223)
    }

    await this.intro1()

    const idsI = ID.rnd() // this.idsChat(args.idI, args.idE)
    const idsE = ID.rnd() // this.idsChat(args.idE, args.idI)

    let chI = await this.gd.getCAV(args.idI, idsI)
    if (chI) { this.setRes('rowChat', chI.toShortRow(this)); return}

    chI = await this.gd.nouvCAV({ 
      id: args.idI,
      ids: idsI,
      st: 10,
      idE: args.idE,
      idsE: idsE,
      cvE: avE.cvA,
      cleCKP: args.ch.ccK,
      cleEC: args.ch.cleE2C,
      items: [{a: 0, dh: this.dh, t: args.ch.txt}]
    })
    this.setRes('rowChat', chI.toShortRow(this))
    this.compta.ncPlus(1)

    const chE = await this.gd.nouvCAV({
      id: args.idE,
      ids: idsE,
      st: 1,
      idE: args.idI,
      idsE: idsI,
      cvE: avI.cvA,
      cleCKP: args.ch.ccP,
      cleEC: args.ch.cleE1C,
      items: [{a: 1, dh: this.dh, t: args.ch.txt}]
    })
    // const comptaE = await this.gd.getCA(args.idE, 'NouveauChat-3')
    // comptaE.ncPlus(1)

    if (ID.estComptable(chE.id) && args.urgence) 
      await this.alerte('chat')
  }
}

/* MutChat: Ajout ou suppression d\'une demande de mutation sur un chat 
*/
operations.MutChat = class MutChat extends OperationCh {
  constructor (nom) { 
    super(nom, 1, 2) 
    this.targs = {
      id: { t: 'ida' }, // id de l'avatar du chat (principal)
      ids: { t: 'ids' },  // ids du chat
      mut: { t: 'int', min: 0, max: 2 } // type de demande - 1 muter en O, 2 muter en A
    }
  }

  async phase2 (args) {
    if (this.compte.idp) { // demandeur est compte O
      if (args.mut !== 0 && args.mut !== 2) throw new AppExc(A_SRV, 341, [args.mut, 'O'])
    } else {
      if (args.mut !== 0 && args.mut !== 1) throw new AppExc(A_SRV, 341, [args.mut, 'A'])
    }

    const chI = await this.gd.getCAV(this.args.id, this.args.ids)
    if (!chI) throw new AppExc('A_SRV', 337)
    const chE = await this.gd.getCAV(chI.idE, chI.idsE)
    if (!chE) throw new AppExc('A_SRV', 338)

    const compteE = await this.gd.getCO(chE.id)
    if (!compteE) throw new AppExc('A_SRV', 336)
    if (!compteE.idp || !compteE.del) throw new AppExc(A_SRV, 339)
    if (!ID.estComptable(args.id) && this.compte.idp && this.compte.idp !== compteE.idp)
      throw new AppExc('A_SRV', 340)

    chI.setMutI(args.mut)
    chE.setMutE(args.mut)
    if (args.mut) this.compte.plusLmut(chI.idsE)
    else this.compte.moinsLmut(chI.idsE)
  }
}

/* MajChat: Ajout ou suppression d\'un item à un chat ***********
Retour:
- disp: true si E a disparu (pas de maj faite)
*/
operations.MajChat = class MajChat extends OperationCh {
  constructor (nom) { 
    super(nom, 1, 2) 
    this.targs = {
      id: { t: 'ida' }, // id de l'avatar du chat
      ids: { t: 'ids' },  // ids du chat
      t: { t: 'u8' }, // texte gzippé crypté par la clé C du chat (null si suppression)
      dh: { t: 'dh', n: true }, // 0 ou date-heure de l'item du chat à supprimer
      urgence: { t: 'bool', n: true }, // chat d'urgence
      don: { t: 'int', min: 0, max: 1000 } // montant du don de I à E
    }
  }

  async phase2 (args) {
    if (!await this.intro2(args)) { 
      this.chI.chEdisp() // pas de chatE
      return
    }

    // cas normal : maj sur chI et chE - avE et cptE existent
    const avI = await this.gd.getAV(args.id, 'MajChat-2')
    const avE = await this.gd.getAV(this.chI.idE, 'MajChat-2')

    if (args.don) {
      const cptE = await this.gd.getCO(avE.idc) // cptE existe puisque chE existe ici
      const comptaE = await this.gd.getCA(cptE.id, 'MajChat-1')
      comptaE.don(this.dh, args.don, this.id)
      this.compta.don(this.dh, -args.don, cptE.id) // ici chE existe, donc cptE
    }

    if (args.t) {
      const itemI = args.t ? { a: 0, dh: this.dh, t: args.t } : null
      const itemE = args.t ? { a: 1, dh: this.dh, t: args.t } : null  
      this.chI.addChatItem(itemI)
      this.chE.addChatItem(itemE)
    } else if (args.dh) {
      this.chI.razChatItem(args.dh, this.dh)
      this.chE.razChatItem(args.dh, this.dh)
    }

    // Maj CVs
    this.chI.setCvE(avE.cvA || {id: avE.id, v: 0 })
    this.chE.setCvE(avI.cvA || {id: avI.id, v: 0 })
   
    if (this.chI.stI === 0) this.compta.ncPlus(1) // I était passif, redevient actif
    this.chI.actifI()
    this.chE.actifE()

    if (ID.estComptable(this.chE.id) && args.urgence) 
        await this.alerte('chat')
  }
}

/* Mise en état "passif" d\'un chat
Nombre de chat - 1, items vidé
Retour
- disp: true si E a disparu
*/
operations.PassifChat = class PassifChat extends OperationCh {
  constructor (nom) { 
    super(nom, 1, 2)
    this.targs = {
      id: { t: 'ida' }, // id de l'avatar du chat
      ids: { t: 'ids' }  // ids du chat
    }
  }

  async phase2 (args) { 
    if (!await this.intro2()) { // E disparu. I voulait être passif, devient détruit
      this.chI.setZombi()
      this.setRes('suppr', true)
      return
    }

    if (this.chI.estPassif) return // était passif, reste passif, rien n'a changé

    // chI était actif, devient passif - E pas disparu, MAJ de cv et st
    const avI = await this.gd.getAV(args.id, 'PassifChat-1')

    this.compta.ncPlus(-1)
    const avE = await this.gd.getAV(this.chI.idE, 'PassifChat-2')
    this.chI.passifI()
    this.chI.setCvE(avE.cvA)
    this.chE.setCvE(avI.cvA)
    this.chE.passifE()
  }
}

/* ChangementPC: Changement de la phrase de contact d\'un avatar ***********
Exceptions:
F_SRV, 26: Phrase de contact trop proche d\'une phrase existante.
*/
operations.ChangementPC = class ChangementPC extends Operation {
  constructor (nom) { 
    super(nom, 1, 2) 
    this.targs = {
      id: { t: 'ida' }, // id de l'avatar
      hZR: { t: 'ids', n: true }, // hash de la phrase de contact réduite (SUPPRESSION si null)
      cleAZC: { t: 'u8', n: true }, //  clé A cryptée par ZC (PBKFD de la phrase de contact complète).
      pcK: { t: 'u8', n: true }, //  phrase de contact complète cryptée par la clé K du compte.
      hZC: { t: 'ids', n: true } // hash du PBKFD de la phrase de contact complète.
    }
  }

  async phase2 (args) { 
    if (args.hZR && await this.db.getAvatarHk(ID.long(args.hZR, this.ns))) 
      throw new AppExc(F_SRV, 26) // trop proche existante

    if (!this.compte.mav[args.id]) throw new AppExc(A_SRV, 224)

    const avatar = await this.gd.getAV(args.id, 'ChangementPC-1')
    avatar.setPC(args)
  }
}

/* StatutChatE: Statut du contact d'un chat
Retour: { cpt, idp, del }
- cpt: true si avatar principal
- idp: id de la partition si compte "0", 
- del: true si delégué
*/
operations.StatutChatE = class StatutChatE extends Operation {
  constructor (nom) { 
    super(nom, 1)
    this.targs = {
      ids: { t: 'ids' } // ids = chat
    }
  }

  async phase2(args) {
    const r = { cpt: false, idp: '', del: false }
    const chI = await this.gd.getCAV(this.compte.id, args.ids)
    if (chI) {
      const avatar = await this.gd.getAV(chI.idE)
      if (avatar && avatar.idc === chI.idE) {
        r.cpt = true
        const c = await this.gd.getCO(chI.idE)
        r.idp = c.idp
        if (r.idp) r.del = c.del
      }
    }
    this.setRes('statut', r)
  }
}

/* RafraichirCvsAv: Rafraichissement des CVs des membres / chats de l\'avatar
Retour: [nc, nv]
- nc: nombre de CV mises à jour
- nv: nombre de chats / membres scannés
Exception générique:
- 8001: avatar disparu
*/
operations.RafraichirCvsAv = class RafraichirCvsAv extends Operation {
  constructor (nom) { 
    super(nom, 1, 2)
    this.targs = {
      id: { t: 'ida' }, // id de l'avatar
      lch: { t: 'array' }, // liste des chats: [{ ids, idE, vcv } ...]
      lmb: { t: 'array' } // liste des membres: [{ id, im, ida, vcv} ...]
    }
  }

  async phase2(args) {
    /* Restriction MINI NE s'applique QUE si le compte n'est pas le comptable 
    if ((AL.has(this.flags, AL.ARSN) || AL.has(this.flags, AL.ARNTF)) && !this.estComptable) throw new AppExc(F_SRV, 802)
    */
    if (!this.compte.mav[args.id])
      throw new AppExc(A_SRV, 227)

    const avatar = await this.gd.getAV(args.id) //
    if (!avatar) throw new AppExc(F_SRV, 1)
    let nc = 0, nv = 0

    for(const {ids, idE, vcv} of args.lch) {
      nv++
      const av = await this.gd.getAAVCV(idE, vcv)
      if (av) {
        const ch = await this.gd.getCAV(args.id, ids)
        if (ch) { nc++; nv++; ch.setCvE(av.cvA)  }
      }
    }

    for(const {id, im, ida, vcv} of args.lmb) {
      nv++
      const av = await this.gd.getAAVCV(ida, vcv)
      if (av) {
        const mb = await this.gd.getMBR(id, im)
        if (mb) { nc++; mb.setCvA(av.cvA) }
      }
    }

    this.setRes('ncnv', [nc, nv])
  }
}

/* RafraichirCvsGr: Rafraichissement des CVs des membres d\'un groupe
Retour: [nc, nv]
- nc: nombre de CV mises à jour
- nv : nombre de chats existants
Exception générique:
- 8002: groupe disparu
*/
operations.RafraichirCvsGr = class RafraichirCvsGr extends Operation {
  constructor (nom) { 
    super(nom, 1, 2) 
    this.targs = {
      idg: { t: 'idg' }, // id du groupe
      lmb: { t: 'array' } // liste des membres: [{ id, im, ida, vcv} ...]
    }
  }

  async phase2(args) {
    /* Restriction NE s'applique QUE si le compte n'est pas le comptable */
    if ((AL.has(this.flags, AL.ARSN) || AL.has(this.flags, AL.ARNTF)) && !this.estComptable) 
      throw new AppExc(F_SRV, 802)
    if (!this.compte.mpg[args.idg]) throw new AppExc(A_SRV, 275)

    const groupe = await this.gd.getGR(args.idg)
    if (!groupe) throw new AppExc(F_SRV, 2)
    let nc = 0, nv = 0

    for(const {id, im, ida, vcv} of args.lmb) {
      const { av } = await this.gd.getAAVCV(ida, vcv)
      if (av) {
        const mb = await this.gd.getMBR(id, im)
        if (mb) { nv++; mb.setCvA(av.cvA); nc++ }
      }
    }
    
    this.setRes('ncnv', [nc, nv])
  }
}

/* SetQuotas: 'Fixation des quotas d'un compte dans sa partition ou comme compte A */
operations.SetQuotas = class SetQuotas extends Operation {
  constructor (nom) { 
    super(nom, 1, 2) 
    this.targs = {
      idp: { t: 'idp' }, // id de la partition
      idc: { t: 'idc' }, // id du compte
      q: { t: 'q' } // quotas: {qc, qn, qv}
    }
  }

  async phase2 (args) {
    const compta = (args.idc === this.id) ? this.compta : await this.gd.getCA(args.idc, 'SetQuotas-1')
    if (!args.idp) { // compte A
      const synth = await this.gd.getSY()
      synth.updQuotasA(compta.qv, args.q) // peut lever une Exc si insuffisance de quotas
    } else { // compte O
      const part = await this.gd.getPA(args.idp, 'SetQuotas-2')
      part.checkUpdateQ(args.idc, args.q) // peut lever une Exc si insuffisance de quotas
    }
    compta.quotas(args.q) // répercutera in fine dans partition et synthese (si compte O)
  }
}

/* NouvellePartition: Création d\'une nouvelle partition */
operations.NouvellePartition = class NouvellePartition extends Operation {
  constructor (nom) { 
    super(nom, 2, 2)
    this.targs = {
      idp: { t: 'idp' }, // id de la partition
      itemK: { t: 'u8' }, //  {cleP, code} crypté par la clé K du Comptable.
      quotas: { t: 'q' } // quotas: {qc, qn, qv}
    }
  }

  /* Rappel - Dans Comptes : **Comptable seulement:**
  - `tpK` : map des partitions cryptée par la clé K du Comptable `[ {cleP, code }]`. Sa clé est l'id de la partition.
    - `cleP` : clé P de la partition.
    - `code` : code / commentaire court de convenance attribué par le Comptable
  */
  async phase2 (args) {
    await this.gd.nouvPA(args.idp, args.quotas)
    this.compte.ajoutPartition(args.idp, args.itemK)
  }
}

/* SupprPartition: Suppression d\'une partition */
operations.SupprPartition = class SupprPartition extends Operation {
  constructor (nom) { 
    super(nom, 2, 2)
    this.targs = {
      idp: { t: 'idp' } // id de la partition
    }
  }

  async phase2 (args) {
    const p = await this.gd.getPA(args.idp, 'SupprPartition-1')
    let vide = true
    // eslint-disable-next-line no-unused-vars
    for(const id in p.mcpt) vide = false
    if (!vide) throw new AppExc(A_SRV, 271)
      p.setZombi()
    this.compte.supprPartition(args.idp)
    const espace = await this.gd.getEspace()
    espace.supprPartition(args.idp)
    const s = await this.gd.getSY(this.ns)
    s.supprPartition(args.idp)
  }
}

/* SetQuotasPart: Mise à jour des quotas d\'une partition */
operations.SetQuotasPart = class SetQuotasPart extends Operation {
  constructor (nom) { 
    super(nom, 2, 2)
    this.targs = {
      idp: { t: 'idp' }, // id de la partition
      quotas: { t: 'q' } // quotas: {qc, qn, qv}
    }
  }

  async phase2 (args) {
    /*
      espace.quotas : quotas de l'espace fixés par l'AT
      synth.qa : quotas réservés aux comptes A
      qpt : synth.tsp['0'].q : somme des quotas des partitions
      q: synth.tsp[idp].q quotas actuellement attribués à la partition
    */
    const partition = await this.gd.getPA(args.idp)
    const synth = await this.gd.getSY()
    const e = synth.tsp[args.idp]
    const q = e ? e.q : {qc: 0, qn:0, qv: 0}
    const esp = await this.gd.getEspace()
    const qe = esp.quotas
    const qpt = synth.tsp['0'].q
    const rqn = qe.qn - qpt.qn + q.qn
    const maxn = rqn < q.qn ? q.qn : rqn
    const rqv = qe.qv - qpt.qv + q.qv
    const maxv = rqv < q.qv ? q.qv : rqv
    const rqc = qe.qc - qpt.qc + q.qc
    const maxc = rqc < q.qc ? q.qc : rqc
    const qap = args.quotas
    if (qap.qn > maxn) throw new AppExc(F_SRV, 331, [maxn, qap.qn])
    if (qap.qv > maxv) throw new AppExc(F_SRV, 332, [maxv, qap.qv])
    if (qap.qc > maxc) throw new AppExc(F_SRV, 333, [maxc, qap.qc])
    partition.setQuotas(qap)
  }
}

/* SetQuotasA: Mise à jour des quotas pour les comptes A */
operations.SetQuotasA = class SetQuotasA extends Operation {
  constructor (nom) { 
    super(nom, 2, 2) 
    this.targs = {
      quotas: { t: 'q' } // quotas: {qc, qn, qv}
    }
  }

  async phase2 (args) {
    /*
      espace.quotas : quotas de l'espace fixés par l'AT
      synth.qa : quotas réservés aux comptes A
      qpt : synth.tsp['0'].q : somme des quotas des partitions
      q: synth.tsp[idp].q quotas actuellement attribués à la partition
    */
    const synth = await this.gd.getSY()
    const q = synth.qA // quotas actuels
    const esp = await this.gd.getEspace()
    const qe = esp.quotas
    const qpt = synth.tsp['0'].q
    const rqn = qe.qn - qpt.qn + q.qn
    const maxn = rqn < q.qn ? q.qn : rqn
    const rqv = qe.qv - qpt.qv + q.qv
    const maxv = rqv < q.qv ? q.qv : rqv
    const qap = args.quotas
    if (qap.qn > maxn) throw new AppExc(F_SRV, 331)
    if (qap.qv > maxv) throw new AppExc(F_SRV, 332)
    synth.setQA(qap)
  }
}

/* SetCodePart: Mise à jour du code d\'une partition */
operations.SetCodePart = class SetCodePart extends Operation {
  constructor (nom) { 
    super(nom, 2, 2)
    this.targs = {
      idp: { t: 'idp' }, // id de la partition
      etpk: { t: 'u8' } // {codeP, code} crypté par la clé K du Comptable
    }
  }

  async phase2 (args) {
    if (!this.compte.setCodePart(args.idp, args.etpk)) throw new AppExc(A_SRV, 229)
  }
}

operations.MuterCompte = class MuterCompte extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async check () {
    const ec = this.estComptable
    const ed = !ec && this.compte.del
    if (!ec && !ed) throw new AppExc(A_SRV, 287)
  }

  async setChat (args) {
    const chI = await this.gd.getCAV(this.id, args.ids, 'MuterCompteO-5')
    chI.setMutE(0)
    const chE = await this.gd.getCAV(chI.idE, chI.idsE)
    if (!chE) { // pas de chatE: pas de mise à jour de chat I
      chI.chEdisp()
      return
    }
    chE.setMutI(0)
    // cas normal : maj sur chI et chE - avE et cptE existent
    const avI = await this.gd.getAV(this.id, 'MuterCompteO-6')
    const avE = await this.gd.getAV(chI.idE, 'MuterCompteO-7')
    if (args.t) {
      const itemI = args.t ? { a: 0, dh: this.dh, t: args.t } : null
      const itemE = args.t ? { a: 1, dh: this.dh, t: args.t } : null  
      chI.addChatItem(itemI)
      chE.addChatItem(itemE)
    }
    // Maj CVs
    chI.setCvE(avE.cvA || {id: avE.id, v: 0 })
    chE.setCvE(avI.cvA || {id: avI.id, v: 0 })

    if (chI.stI === 0) this.compta.ncPlus(1) // I était passif, redevient actif
    chI.actifI()
    chE.actifE()
  }
}

/*  MuterCompteAauto: Auto mutation du compte O en compte A
Mutation d'un compte `c` O de la partition `p` en compte A
- augmente `syntheses.qtA`.
- diminue `partition[p].mcpt[c].q` ce qui se répercute sur `syntheses.tsp[p].qt`.
- bloqué si l'augmentation de `syntheses.qtA` fait dépasser `syntheses.qA`.
*/
operations.MuterCompteAauto = class MuterCompteAauto extends operations.MuterCompte {
  constructor (nom) { 
    super(nom, 1, 2)
    this.targs = {
      quotas: { t: 'q' } // quotas: { qc, qn, qv }   
    }
  }

  async phase2 (args) {
    if (!this.compte.idp || !this.compte.del || this.estComptable) 
      throw new AppExc(A_SRV, 243)

    this.compta.setIdp('')
    this.compta.quotas(args.quotas)

    const synth = await this.gd.getSY()
    synth.ajoutCompteA(args.quotas) // peut lever Exwc de blocage

    const part = await this.gd.getPA(this.compte.idp, 'MuterCompteAauto-4')
    part.retraitCompte(this.compte.id)

    // Maj du compte
    this.compte.chgPart(null)
  }
}

/*  MuterCompteA: Mutation du compte O en compte A
Mutation d'un compte `c` O de la partition `p` en compte A
- augmente `syntheses.qtA`.
- diminue `partition[p].mcpt[c].q` ce qui se répercute sur `syntheses.tsp[p].qt`.
- bloqué si l'augmentation de `syntheses.qtA` fait dépasser `syntheses.qA`.
*/
operations.MuterCompteA = class MuterCompteA extends operations.MuterCompte {
  constructor (nom) { 
    super(nom, 1, 2)
    this.targs = {
      id: { t: 'ida' }, // id du compte devenant A
      ids: { t: 'ids' }, // ids du chat du compte demandeur (Comptable / Délégué)
      quotas: { t: 'q' }, // quotas: { qc, qn, qv }   
      t: { t: 'u8' } // texte (crypté) de l'item à ajouter au chat
    }
  }

  async phase2 (args) {
    const compte = await this.gd.getCO(args.id, 'MuterCompteA-2')
    if (!compte.idp) throw new AppExc(A_SRV, 289)

    await this.check()
  
    const compta = await this.gd.getCA(args.id, 'MuterCompteA-3')
    compta.setIdp('')
    const q = compta.qv
    compta.quotas({ qc: q.qc, qn: q.qn, qv: q.qv })

    const synth = await this.gd.getSY()
    synth.ajoutCompteA(compte.qv) // peut lever Exwc de blocage

    const part = await this.gd.getPA(compte.idp, 'MuterCompteA-4')
    part.retraitCompte(args.id)

    // Maj du compte
    compte.chgPart(null)
    compte.resetLmut()

    await this.setChat(args)
  }
}

/*  OP_MuterCompteO: 'Mutation d\'un compte A en compte O' ************
Mutation d'un compte `c` A en compte O de la partition `p`
- diminue `syntheses.qtA`
- augmente `partition[p].mcpt[c].q` (si c'est possible) ce qui se répercute sur `syntheses.tsp[p].qt`
- blocage si les quotas de la partition ne supportent pas les quotas du compte muté.
*/
operations.MuterCompteO = class MuterCompteO extends operations.MuterCompte {
  constructor (nom) { 
    super(nom, 1, 2)
    this.targs = {
      id: { t: 'ida' }, // id du compte devenant O
      quotas: { t: 'q' }, // quotas: { qc, qn, qv }   
      cleAP: { t: 'u8' }, // clé A du compte cryptée par la clé P de la partition
      clePK: { t: 'u8' }, // clé de la nouvelle partition cryptée par la clé publique du compte
      ids: { t: 'ids' }, // ids du chat du compte demandeur (Comptable / Délégué)
      t: { t: 'u8' } // texte (crypté) de l'item à ajouter au chat
    }
  }

  async phase2 (args) {
    await this.check()
  
    const idp = this.compte.idp // partition de l'exécutant de la mutation

    const compte = await this.gd.getCO(args.id, 'MuterCompteO-2')
    if (compte.idp) throw new AppExc(A_SRV, 288)
    compte.resetLmut()
    compte.chgPart(idp, args.clePK, null, true)

    const compta = await this.gd.getCA(args.id, 'MuterCompteO-3')
    compta.setIdp(idp)
    compta.quotas(args.quotas)

    const synth = await this.gd.getSY()
    synth.retraitCompteA(compte.qv)

    const part = await this.gd.getPA(idp, 'MuterCompteO-4')
    part.ajoutCompteO(compta, args.cleAP, false) // Peut lever Exc de quotas

    await this.setChat(args)
  }
}

/* FixerQuotasA: Attribution par le Comptable de quotas globaux pour les comptes A */
operations.FixerQuotasA = class FixerQuotasA extends Operation {
  constructor (nom) { 
    super(nom, 1, 2)
    thgis.targs = {
      quotas: { t: 'q' } // quotas: { qc, qn, qv }   
    }
  }

  async phase2 (args) {
    const synth = await this.gd.getSY()
    synth.setQA(args.quotas)
  }
}

/*  ChangerPartition: Transfert d\'un compte O dans une autre partition */
operations.ChangerPartition = class ChangerPartition extends Operation {
  constructor (nom) { 
    super(nom, 2, 2)
    this.targs = {
      id: { t: 'ida' }, // id du compte qui change de partition
      idp: { t: 'idp' }, // id de la nouvelle partition
      cleAP: { t: 'u8' }, // clé A du compte cryptée par la clé P de la nouvelle partition
      clePK: { t: 'u8' }, // clé de la nouvelle partition cryptée par la clé publique du compte
      notif: { t: 'ntf', n: true } // notificcation du compte en cours
    }
  }

  async phase2 (args) {
    if (this.id === args.id) throw new AppExc(F_SRV, 234)
    const cpt = await this.gd.getCO(args.id, 'ChangerPartition-1')
    const compta = await this.gd.getCA(args.id)
    const partav = await this.gd.getPA(cpt.idp, 'ChangerPartition-2')
    const epav = partav.mcpt[args.id]
    if (!epav) throw new AppExc(A_SRV, 232)
    const partap = await this.gd.getPA(args.idp, 'ChangerPartition-3')
    const epap = partap.mcpt[args.id]
    if (epap) throw new AppExc(A_SRV, 233)

    partav.retraitCompte(args.id)
    partap.ajoutCompteO(compta, args.cleAP, false, args.notif || null)

    // Maj du compte
    cpt.chgPart(partap.id, args.clePK, args.notif || null)
  }
}

/*  DeleguePartition: Changement de statut délégué d\'un compte dans sa partition */
operations.DeleguePartition = class DeleguePartition extends Operation {
  constructor (nom) { 
    super(nom, 2, 2)
    this.targs = {
      id: { t: 'ida' }, // id du compte qui change de statut
      del: { t: 'bool' } // true / false, statut délégué
    }
  }

  async phase2 (args) {
    if (this.id === args.id) throw new AppExc(A_SRV, 234)
    const cpt = await this.gd.getCO(args.id, 'DeleguePartition-1')
    const part = await this.gd.getPA(cpt.idp, 'DeleguePartition-2')
    cpt.setDel(args.del)
    if (!part.setDel(args.id, args.del)) throw new AppExc(F_SRV, 232)
  }
}

/* SetNotifP : notification d'une partition */
operations.SetNotifP = class SetNotifP extends Operation {
  constructor (nom) { 
    super(nom, 1, 2) 
    this.targs = {
      idp: { t: 'idp' }, // id de la partition
      notif: { t: 'ntf', n: true } // notification cryptée par la clé de la partition.
    }
  }

  async phase2 (args) {
    const ec = this.estComptable
    const ed = !ec && this.compte.del
    if ((!ec && !ed) || (ed && this.compte.idp !== args.idp)) throw new AppExc(A_SRV, 235)
    
    const espace = await this.gd.getEspace()
    const ntf = espace.tnotifP[args.idp]
    const aut = ntf ? (ntf.idDel ? ntf.idDel : ID.duComptable(this.ns)) : null
    if (aut && ed && ID.estComptable(aut)) throw new AppExc(A_SRV, 237)
    if (args.notif) {
      args.notif.idDel = this.id
      if (args.notif.nr !== 3) args.notif.dh3 = 0
      else if (!ntf || ntf.nr !== 3) args.notif.dh3 = this.dh
      args.notif.dh = this.dh
    }
    espace.setNotifP(args.notif || null, args.idp)

    const partition = await this.gd.getPA(args.idp, 'SetNotifP-2')
    partition.setNrp(args.notif || null)
  }
}

/* SetNotifC: notification d'un compte "O" */
operations.SetNotifC = class SetNotifC extends Operation {
  constructor (nom) { 
    super(nom, 1, 2)
    this.targs = {
      idc: { t: 'ida' }, // id du compte
      notif: { t: 'ntf', n: true } // notification du compte cryptée par la clé de partition
    }
  }

  async phase2 (args) {
    const compte = await this.gd.getCO(args.idc, 'SetNotifC-1')

    const ec = this.estComptable
    const ed = !ec && this.compte.del
    if ((!ec && !ed) || (ed && this.compte.idp !== compte.idp)) throw new AppExc(A_SRV, 238)

    const ntf = compte.notif
    const aut = ntf ? (ntf.idDel ? ntf.idDel : ID.duComptable(this.ns)) : null
    if (aut && ed && ID.estComptable(aut)) throw new AppExc(A_SRV, 237)

    if (args.notif) {
      args.notif.idDel = this.id
      if (args.notif.nr !== 3) args.notif.dh3 = 0
      else if (!ntf || ntf.nr !== 3) args.notif.dh3 = this.dh
      args.notif.dh = this.dh
    }

    compte.setNotif(args.notif || null)

    const partition = await this.gd.getPA(compte.idp, 'SetNotifC-3')
    partition.setNotifC(args.idc, args.notif || null)
  }
}

/* PlusTicket: Génération d'un ticket de crédit et ajout du ticket au Comptable
Retour: 
- rowCompta: du compte après insertion du ticket
*/
operations.PlusTicket = class PlusTicket extends Operation {
  constructor (nom) { 
    super(nom, 1, 2)
    this.targs = {
      ids: { t: 'ids' }, // ids du ticket généré
      ma : { t:'int', min: 0, max: 100000 }, // montant du ticket
      refa: { t: 'string', n: true } // référence éventuelle
    }
  }

  async phase2(args) {
    const rtk = await this.gd.getTKT(args.ids)
    if (rtk) throw new AppExc(A_SRV, 239)

    const tk = await this.gd.nouvTKT(this.id, args)
    this.compta.plusTk(tk)
  }

  phase3() {
    this.setRes('rowCompta', this.compta.toShortRow(this))
  }
}

/* MoinsTicket: retrait d'un ticket à un compte A et retrait d'un ticket au Comptable
Retour: 
- rowCompta : du compte
*/
operations.MoinsTicket = class MoinsTicket extends Operation {
  constructor (nom) { 
    super(nom, 1, 2)
    this.targs = {
      ids: { t: 'ids' } // ids du ticket à enlever
    }
  }

  async phase2(args) {
    const tk = await this.gd.getTKT(args.ids)
    if (!tk) throw new AppExc(A_SRV, 240)
    tk.setZombi()
    this.compta.moinsTk(tk)
  }

  phase3() {
    this.setRes('rowCompta', this.compta.toShortRow(this))
  }
}

/* ReceptionTicket: Réception d'un ticket par le Comptable */
operations.ReceptionTicket = class ReceptionTicket extends Operation {
  constructor (nom) { 
    super(nom, 2, 2)
    this.targs = {
      ids: { t: 'ids' }, // ids du ticket reçu
      mc : { t:'int', min: 0, max: 100000 }, // montant du ticket reçu
      refc: { t: 'string', n: true } // référence éventuelle du Comptable
    }
  }

  async phase2(args) {
    const tk = await this.gd.getTKT(args.ids)
    if (!tk) throw new AppExc(A_SRV, 240)
    if (tk.dr) throw new AppExc(A_SRV, 241)
    if (tk.immuable()) throw new AppExc(A_SRV, 334)

    const compte = await this.gd.getCO(tk.idc)
    const compta = await this.gd.getCA(tk.idc)
    if (!compta || !compte) { // Compte disparu
      tk.setDisp()
    } else {
      tk.reception(this.auj, args.mc, args.refc)
      compta.enregTk(tk, args.mc, args.refc)
    }
  }
}

/* MajCv : Mise à jour de la carte de visite d\'un avatar */
operations.MajCv = class MajCv extends Operation {
  constructor (nom) { 
    super(nom, 1, 2)
    this.targs = {
      cv: { t: 'cv' } // carte de visite (photo / texte cryptés)
    }
  }

  async phase2(args) {
    if (AL.has(this.flags, AL.ARSN) || AL.has(this.flags, AL.ARNTF)) throw new AppExc(F_SRV, 802)
    if (AL.has(this.flags, AL.LSNTF)) throw new AppExc(F_SRV, 801)

    if (!ID.estGroupe(args.cv.id)) {
      if (!this.compte.mav[args.cv.id]) throw new AppExc(A_SRV, 242)
      const avatar = await this.gd.getAV(args.cv.id, 'MajCv-1')
      avatar.setCv(args.cv)
    } else {
      const e = this.compte.mpg[args.cv.id]
      if (!e) throw new AppExc(A_SRV, 243)
      const groupe = await this.gd.getGR(args.cv.id, 'MajCv-3')
      const anims = groupe.anims
      let ok = false
      for(const ida of e.lav) 
        if (anims.has(groupe.mmb.get(ida))) ok = true
      if (!ok) throw new AppExc(A_SRV, 243)
      groupe.setCv(args.cv)
    }
  }
}

/* GetCv : Obtention de la carte de visite d\'un avatar
Retour:
- cv: si trouvée
*/
operations.GetCv = class GetCv extends Operation {
  constructor (nom) { 
    super(nom, 1, 2)
    this.targs = {
      id: { t: 'ida' }, // id du people ou du groupe
      ch: { t: 'idch', n: true } // [id, ids] id d'un chat d'un des avatars du compte avec le people
    }
  }

  async phase2(args) {
    if (AL.has(this.flags, AL.LSNTF)) throw new AppExc(F_SRV, 801)

    if (!ID.estGroupe(args.id)) {
      if (args.ch) {
        if (this.compte.mav[args.ch[0]]) {
          const chat = await this.getRowChat(args.ch[0], args.ch[1])
          if (!chat) throw new AppExc(A_SRV, 244)
        } else throw new AppExc(A_SRV, 244)
      } else {
        if (!this.compte.mav[args.id]) {
          if (!this.compte.idp) throw new AppExc(A_SRV, 335)
          // OK si délégué de la partition du compte
          const p = await this.gd.getPA(this.compte.idp, 'GetCv-1')
          const e = p.mcpt[args.id]
          if (!e || !e.del) throw new AppExc(A_SRV, 335)
        }
      }
      const avatar = await this.gd.getAV(args.id, 'GetCv-2')
      this.setRes('cv', avatar.cvA)
    } else {
      const e = this.compte.mpg[args.id]
      if (!e) throw new AppExc(A_SRV, 243)
      const groupe = await this.gd.getGR(args.id, 'GetCv-3')
      let ok = false
      for(const ida of e.lav)
        if (groupe.mmb.get(ida)) ok = true
      if (!ok) throw new AppExc(A_SRV, 243)
      this.setRes('cv', groupe.cvG)
    }
  }
}

/* NouvelAvatar: Création d'un nouvel avatar du compte */
operations.NouvelAvatar = class NouvelAvatar extends Operation {
  constructor (nom) { 
    super(nom, 1, 2)
    this.targs = {
      id: { t: 'ida' }, // id de l'avatar à créér
      cleAK: { t: 'u8' }, // sa clé A cryptée par la clé K
      pub: { t: 'u8' }, // sa clé RSA publique
      cleAK: { t: 'u8' }, // sa clé RSA privée cryptée par la clé K
      cvA: { t: 'cv' } // sa carte de visite, texte et photocryptée par sa clé A
    }
  }

  async phase2(args) {
    if (AL.has(this.flags, AL.ARSN) || AL.has(this.flags, AL.ARNTF)) throw new AppExc(F_SRV, 802)
    if (AL.has(this.flags, AL.LSNTF)) throw new AppExc(F_SRV, 801)

    if (this.compte.mav[args.id]) return // création déjà faite pour le compte
    const a = await this.gd.getAV(args.id)
    if (a) throw new AppExc(A_SRV, 245)

    this.gd.nouvAV(args, args.cvA)
  }
}

/* McMemo: Changement des mots clés et mémo attachés à un contact ou groupe */
operations.McMemo = class McMemo extends Operation {
  constructor (nom) { 
    super(nom, 1, 2) 
    this.targs = {
      id: { t: 'idag' }, // id de l'avatar ou du groupe
      htK: { t: 'u8', n: true }, // hashtags séparés par un espace et crypté par la clé K
      txK: { t: 'u8', n: true } // texte du mémo gzippé et crypté par la clé K
    }
  }

  async phase2 (args) { 
    if (AL.has(this.flags, AL.ARSN) || AL.has(this.flags, AL.ARNTF)) throw new AppExc(F_SRV, 802)
    if (AL.has(this.flags, AL.LSNTF)) throw new AppExc(F_SRV, 801)

    const compti = await this.gd.getCI(this.id, 'McMemo-2')
    compti.setMc(args.id, args.htK, args.txK)
  }
}

/* ChangementPS: Changement de la phrase secrete de connexion du compte */
operations.ChangementPS = class ChangementPS extends Operation {
  constructor (nom) { 
    super(nom, 1, 2)
    this.targs = {
      hps1: { t: 'ids' }, // hash9 du PBKFD de la phrase secrète réduite du compte.
      hXC: { t: 'ids' }, // hash du PBKFD de la phrase secrète complète
      cleKXC: { t: 'u8' } // clé K cryptée par la phrase secrète
    }
  }

  async phase2 (args) { 
    this.compte.chgPS(args)
  }
}

/* Nouveau groupe 
Exception:
- 8001: avatar disparu
*/
operations.NouveauGroupe = class NouveauGroupe extends Operation {
  constructor (nom) { 
    super(nom, 1, 2)
    this.targs = {
      idg: { t: 'idg' }, // id du groupe
      ida: { t: 'ida' }, // id de l'avatar fondateur
      cleAG: { t: 'u8' }, // clé A de l'avatar cryptée par la clé G
      cleGK: { t: 'u8' }, // clé du groupe cryptée par la clé K du compte
      cvG: { t: 'cv' }, // carte de visite du groupe crypté par la clé G du groupe
      msu: { t: 'bool' }, // true si mode simple
      quotas: { t: 'q2' } // {qn, qv} maximum de nombre de notes et de volume fichiers
    }
  }

  async phase2 (args) { 
    const rg = await this.gd.getGR(args.idg)
    if (rg) throw new AppExc(A_SRV, 246)

    const avatar = await this.gd.getAV(args.ida)
    if (!avatar) throw new AppExc(F_SRV, 1)

    this.gd.nouvGR(args)
    const dx = { dpc: this.auj, dac: this.auj, dln: this.auj, den: this.auj, dam: this.auj }
    await this.gd.nouvMBR(args.idg, 1, avatar.cvA, args.cleAG, dx)

    this.compta.ngPlus(1)
  }
}

/* Nouveau contact 
Exception: 
- 8002: groupe disparu
- 8001: avatar disparu
*/
operations.NouveauContact = class NouveauContact extends Operation {
  constructor (nom) { 
    super(nom, 1, 2)
    this.targs = {
      idg: { t: 'idg' }, // id du groupe
      ida: { t: 'ida' }, // id de l'avatar contact
      cleAG: { t: 'u8' }, // clé A du contact cryptée par la clé G du groupe
      cleGA: { t: 'u8' } // clé G du groupe cryptée par la clé A du contact
    }
  }

  async phase2 (args) { 
    const groupe = await this.gd.getGR(args.idg)
    if (!groupe) throw new AppExc(F_SRV, 2)
    const avatar = await this.gd.getAV(args.ida)
    if (!avatar) throw new AppExc(F_SRV, 1)

    // const groupe = compile(await this.getRowGroupe(args.idg, 'NouveauContact-1'))
    let ok = false
    for(const idav in this.compte.mav) {
      const im = groupe.mmb.get(idav)
      const f = groupe.flags[im]
      if (im && groupe.st[im] >= 4 && (f & FLAGS.AM) && (f & FLAGS.DM) ) { ok = true; break }
    }
    if (!ok) throw new AppExc(A_SRV, 247)
    if (groupe.mmb.get(args.ida)) throw new AppExc(A_SRV, 248)
    if (groupe.lnc.indexOf(args.ida) !== -1) throw new AppExc(A_SRV, 260)
    if (groupe.lng.indexOf(args.ida) !== -1) throw new AppExc(A_SRV, 261)
    
    const im = groupe.nvContact(args.ida)
    const dx = { dpc: this.auj}
    await this.gd.nouvMBR(args.idg, im, avatar.cvA, args.cleAG, dx)

    const cinvit = await this.gd.getIN(avatar.idc, 'InvitationGroupe-2b')
    const invx = { 
      idg: args.idg,
      ida: args.ida,
      cleGA: args.cleGA, 
      cvG: groupe.cvG, 
      flags: 0,  
      msgG: null 
    }
    cinvit.setContact(invx)
  }
}

/* ModeSimple: 'Demande de retour au mode simple d\'invitation à un groupe
Exception: 
- 8002: groupe disparu
*/
operations.ModeSimple = class ModeSimple extends Operation {
  constructor (nom) { 
    super(nom, 1, 2)
    this.targs = {
      idg: { t: 'idg' }, // id du groupe
      ida: { t: 'ida' }, // id de l'avatar demandant le retour au mode simple
      simple: { t: 'bool' } 
      // true 'Je vote pour passer au mode "SIMPLE"'
      // false: 'Annuler les votes et rester en mode UNANIME'
    }
  }

  async phase2 (args) { 
    const gr = await this.gd.getGR(args.idg)
    if (!gr) throw new AppExc(F_SRV, 2)

    if (!this.compte.mav[args.ida]) throw new AppExc(A_SRV, 249)
    const im = gr.mmb.get(args.ida)
    if (!im || gr.st[im] !== 5) throw new AppExc(A_SRV, 250)
    
    gr.setMsu(args.simple, im)
  }
}

/* AnnulerContact: Annulation du statut de contact d'un groupe par un avatar
Exception: 
- 8002: groupe disparu
*/
operations.AnnulerContact = class AnnulerContact extends Operation {
  constructor (nom) { 
    super(nom, 1, 2)
    this.targs = {
      idg: { t: 'idg' }, // id du groupe
      ida: { t: 'ida' }, // id de l'avatar demandant l'annulation.
      ln: { t: 'bool' }  // true Inscription en liste noire
    }
  }

  async phase2 (args) { 
    const gr = await this.gd.getGR(args.idg)
    if (!gr) throw new AppExc(F_SRV, 2)

    if (!this.compte.mav[args.ida]) throw new AppExc(A_SRV, 249)
    const im = gr.mmb.get(args.ida)
    if (!im || gr.st[im] !== 1) throw new AppExc(A_SRV, 272)
    gr.anContact(im, args.ln)
    const mb = await this.gd.getMBR(args.idg, im, 'AnnulerContact-1')
    mb.setZombi()
    const invit = await this.gd.getIN(this.compte.id)
    invit.supprContact(args.idg, args.ida)
  }
}

/* InvitationGroupe: Invitation à un groupe'
Exception: 
- 8002: groupe disparu
- 8001: avatar disparu
*/
operations.InvitationGroupe = class InvitationGroupe extends Operation {
  constructor (nom) { 
    super(nom, 1, 2)
    this.targs = {
      idg: { t: 'idg' }, // id du groupe
      idm: { t: 'ida' }, // id du membre invité
      rmsv: { t: 'int', min: 0, max: 4 }, // 0: inviter, 2: modifier, 3: supprimer, 4: voter pour
      flags: { t: 'int', min: 0, max: 255 }, // flags d'invitation
      msgG: { t: 'u8' }, // message de bienvenue crypté par la clé G du groupe
      idi: { t: 'ida', n: true }, // id de l'invitant pour le mode d'invitation simple
      // sinon tous les avatars du comptes animateurs du groupe
      suppr: { t: 'int', min: 0, max: 3 }, // 1-contact, 2:radié, 3-radié + LN
      cleGA: { t: 'u8' } // clé G du groupe cryptée par la clé A de l'invité
    }
  }

  async phase2 (args) { 
    const gr = await this.gd.getGR(args.idg)
    if (!gr) throw new AppExc(F_SRV, 2)
    const avatar = await this.gd.getAV(args.idm)
    if (!avatar) throw new AppExc(F_SRV, 1)

    if (gr.lnc.indexOf(args.idm) !== -1) throw new AppExc(A_SRV, 260)
    if (gr.lng.indexOf(args.idm) !== -1) throw new AppExc(A_SRV, 261)

    if (gr.taille >= MAXTAILLEGROUPE) throw new AppExc(A_SRV, 318)

    const cinvit = await this.gd.getIN(avatar.idc, 'InvitationGroupe-2b')

    const im = gr.mmb.get(args.idm)
    if (!im) throw new AppExc(A_SRV, 251)
    const membre = await this.gd.getMBR(args.idg, im, 'InvitationGroupe-3')

    const s = gr.st[im]
    
    if (args.suppr) { // suppression de l'invitation
      if (s < 2 || s > 3) throw new AppExc(A_SRV, 252)
      gr.supprInvit(im, args.suppr)
      cinvit.retourContact(args.idg, args.idm)
      membre.supprRad(args.suppr)
      return
    } 
    
    // Création 0 / modification 2 / vote pour 4
    if (args.rmsv === 0 && s !== 1) throw new AppExc(A_SRV, 256) // création mais pas contact
    if ((args.rmsv === 2 || args.rmsv === 4) && (s < 2 || s > 3)) 
      throw new AppExc(A_SRV, 257) // modification ou vote mais pas déjà (pré) invité
    if (!gr.msu && args.rmsv === 4) throw new AppExc(A_SRV, 258) // vote mais pas en mode unanime
    if (!gr.msu && !args.idi) throw new AppExc(A_SRV, 255) // mode simple et absence d'avatar invitant

    // construction de l'item invit dans groupe
    let aInviter = false // inviter effectivement (sinon laisser en pré-invité)
    const invit = { fl: args.flags, li: [] }
    if (args.idi) { // mode simple
      if (!this.compte.mav[args.idi]) 
        throw new AppExc(A_SRV, 249) // invitant non membre du groupe
      const imi = gr.mmb.get(args.idi)
      if (!imi || gr.st[imi] !== 5) 
        throw new AppExc(A_SRV, 254) // invitant non animateur
      invit.li.push(imi)
      aInviter = true
    } else {
      // Vote : TOUS les avatars du compte animateurs du groupe votent OUI ensemble
      const s1 = this.compte.imAnimsDeGr(gr)
      const invita = gr.invits[im]
      if (invita && invita.fl === args.flags && eqU8(membre.msgG, args.msgG))
        // flags ou texte identiques : reprise des votes actuels
        invita.li.forEach(i => { s1.add(i)})
      const s2 = gr.anims // Tous les animateurs du groupe
      s1.forEach(i => { if (s2.has(i)) invit.li.push(i)})
      aInviter = s2.size === invit.li.length
    }
    gr.setInvit(im, invit, aInviter)

    // Construction de l'invitation à transmettre à l'avatar invité
    /* - `invits`: liste des invitations en cours (dans le document invits)
      - `idg`: id du groupe,
      - `ida`: id de l('avatar invité
      - `cleGA`: clé du groupe crypté par la clé A de l'avatar.
      - `cvG` : carte de visite du groupe (photo et texte sont cryptés par la clé G du groupe).
      - `flags` : d'invitation.
      - `invpar` : `[{ cleAG, cvA }]`
        - `cleAG`: clé A de l'avatar invitant crypté par la clé G du groupe.
        - `cvA` : carte de visite de l'invitant (photo et texte sont cryptés par la clé G du groupe). 
      - `msgG` : message de bienvenue / invitation émis par l'invitant.
    */
    if (aInviter) {
      const invpar = []
      const invx = { 
        idg: args.idg,
        ida: args.idm,
        cleGA: args.cleGA, 
        cvG: gr.cvG, 
        flags: args.flags, 
        invpar, 
        msgG: args.msgG 
      }
      for (const im of invit.li) {
        const mb = await this.gd.getMBR(gr.id, im, 'InvitationGroupe-5')
        if (mb) invpar.push({ cleAG: mb.cleAG, cvA: mb.cvA })
      }
      cinvit.addInv(invx)
    }

    // écriture du chat
    if (aInviter) {
      const ch = await this.gd.getCGR(args.idg, 'InvitationGroupe-6')
      /*- `im` : im du membre auteur,
        - `dh` : date-heure d'écriture.
        - `dhx` : date-heure de suppression.
        - `t` : texte crypté par la clé G du groupe (vide s'il a été supprimé).
      */
      ch.addItem(invit.li[0], this.dh, args.msgG)
    }
    
    // maj du membre invité
    membre.setInvit(this.auj, aInviter, args.msgG)
  }
}

/* AcceptInvitation: Acceptation d'une invitation à un groupe
Eception: 
- 8002: groupe disparu
- 8001: avatar disparu
*/
operations.AcceptInvitation = class AcceptInvitation extends Operation {
  constructor (nom) { 
    super(nom, 1, 2)
    this.targs = {
      idg: { t: 'idg' }, // id du groupe
      idm: { t: 'ida' }, // id du membre invité
      iam: { t: 'bool' }, // accepte accès aux membres
      ian: { t: 'bool' }, // accepte l'accès aux notes
      cleGK: { t: 'u8' }, // cle du groupe cryptée par la clé K du compte
      cas: { t: 'int', min: 1, max: 4 }, // 1:accepte 2:contact 3:radié 4:radié + LN
      msgG: { t: 'u8' }, // message de bienvenue crypté par la clé G du groupe
      txK: { t: 'u8', n: true } // texte à attacher à compti/idg s'il n'y en a pas
    }
  }

  async phase2 (args) { 
    const gr = await this.gd.getGR(args.idg)
    if (!gr) throw new AppExc(F_SRV, 2)
    const avatar = await this.gd.getAV(args.idm)
    if (!avatar) throw new AppExc(F_SRV, 1)

    const invit = await this.gd.getIN(avatar.idc, 'AcceptInvitation-2b')

    const im = gr.mmb.get(args.idm)
    if (!im) throw new AppExc(A_SRV, 251)
    if (gr.st[im] !== 3) throw new AppExc(A_SRV, 259)
    
    const membre = await this.gd.getMBR(args.idg, im, 'AcceptInvitation-3')

    if (args.cas === 1) { // acceptation
      const nf = gr.acceptInvit(im, args.iam, args.ian)

      // invit
      invit.supprInvit(args.idg, args.idm)

      // maj du membre invité: dac dln den dam
      membre.acceptInvit(this.auj, nf)

      // écriture du chat
      const ch = await this.gd.getCGR(args.idg, 'InvitationGroupe-4')
      ch.addItem(im, this.dh, args.msgG)

      // enreg compte et compta
      this.compte.ajoutGroupe(args.idg, args.idm, args.cleGK, gr.rds)
      this.compta.ngPlus(1)
      return
    }

    // refus - cas: 2:contact 3:radié 4:radié + LN
    gr.refusInvit(im, args.cas)

    // invit
    if (args.cas === 2) invit.retourContact(args.idg, args.idm)
    else invit.supprInvit(args.idg, args.idm)

    // maj du membre invité
    membre.supprRad(args.cas === 2 ? 1 : 0)

    // écriture du chat
    const ch = await this.gd.getCGR(args.idg, 'InvitationGroupe-4')
    ch.addItem(im, this.dh, args.msgG)

    if (args.txK) {
      const compti = await this.gd.getCI(this.id)
      if (compti && !compti.mc[args.idg]) compti.setMc(args.idg, null, args.txK)
    }
  }
}

/* ItemChatgr: Ajout ou effacement d'un item au chat du groupe
Exception: 
- 8002: groupe disparu
*/
operations.ItemChatgr = class ItemChatgr extends Operation {
  constructor (nom) { 
    super(nom, 1, 2)
    this.targs = {
      idg: { t: 'idg' }, // id du groupe
      idaut: { t: 'ida' }, // id du membre auteur du texte
      dh: { t: 'dh', n: true }, // date-heure de l'item effacé
      msgG: { t: 'u8' } // texte de l'item
    }
  }

  async phase2 (args) { 
    const gr = await this.gd.getGR(args.idg)
    if (!gr) throw new AppExc(F_SRV, 2)
    
    if (args.idaut) {
      if (!this.compte.mav[args.idaut]) throw new AppExc(A_SRV, 249)
      const im = gr.mmb.get(args.idaut)
      if (!im || gr.st[im] < 4 || !gr.am(im)) throw new AppExc(A_SRV, 273)
      // écriture du chat
      const ch = await this.gd.getCGR(args.idg, 'ItemChatgr')
      ch.addItem(im, this.dh, args.msgG)
    } else {
      const s = this.compte.idMbGr(args.idg)
      if (!gr.estAnim(s)) throw new AppExc(A_SRV, 274)
      const ch = await this.gd.getCGR(args.idg, 'ItemChatgr')
      ch.supprItem(args.dh, this.dh)
    }
  }
}

/* MajDroitsMembre: Mise à jour des droits d'un membre sur un groupe
Exception: 
- 8002: groupe disparu
- 8001: avatar disparu
*/
operations.MajDroitsMembre = class MajDroitsMembre extends Operation {
  constructor (nom) { 
    super(nom, 1, 2)
    this.targs = {
      idg: { t: 'idg' }, // id du groupe
      idm: { t: 'ida' }, // id du membre
      nvflags: { t: 'int', min: 0, max: 255 }, // nouveau flags. Peuvent changer DM DN DE AM AN
      anim: { t: 'bool' } // true si animateur
    }
  }

  async phase2 (args) {
    const gr = await this.gd.getGR(args.idg)
    if (!gr) throw new AppExc(F_SRV, 2)
    const avatar = await this.gd.getAV(args.idm)
    if (!avatar) throw new AppExc(F_SRV, 1)

    const im = gr.mmb.get(args.idm)
    if (!im) throw new AppExc(A_SRV, 251)
    const stm = gr.st[im] 
    if (stm < 4) throw new AppExc(A_SRV, 262)
    
    // Set des im des avatars du compte étant animateur */
    const anc = this.compte.imAnimsDeGr(gr)

    let fst = stm // futur statut
    if (args.anim && stm === 4) {
      // passer le membre en animateur
      if (!anc.size) throw new AppExc(A_SRV, 263)
      fst = 5
    }
    if (!args.anim && stm === 5) {
      // supprimer le statut d'animateur du membre - Possible pour soi-même seulement
      if (!anc.has(im)) throw new AppExc(A_SRV, 264)
      fst = 4
    }

    const iam = args.nvflags & FLAGS.AM
    const ian = args.nvflags & FLAGS.AN
    const idm = args.nvflags & FLAGS.DM
    const idn = args.nvflags & FLAGS.DN
    const ide = idn ? args.nvflags & FLAGS.DE : false

    const chgFl = gr.setFlags (anc, fst, im, iam, ian, idm, idn, ide)

    if (chgFl) {
      const mb = await this.gd.getMBR(args.idg, im, 'MajDroitsMembre-3')
      mb.setDates(this.auj, iam, ian, idm, idn, ide)
    }

    // Peut-être un animateur invitant ne l'est plus: maj des invits
    if (fst === 4) await this.checkAnimInvitants(gr)
  }
}

/* RadierMembre: Radiation d'un membre d'un groupe
Exception: 
- 8002: groupe disparu
- 8001: avatar disparu
*/
operations.RadierMembre = class RadierMembre extends Operation {
  constructor (nom) { 
    super(nom, 1, 2)
    this.targs = {
      idg: { t: 'idg' }, // id du groupe
      idm: { t: 'ida' }, // id du membre
      rad: { t: 'int', min: 1, max: 3 }, // 1-redevient contact, 2-radiation, 3-radiation + ln
      cleGA: { t: 'u8' } // cle G du groupe cryptée par la clé du membre
    }
  }

  async phase2 (args) { 
    const gr = await this.gd.getGR(args.idg)
    if (!gr) throw new AppExc(F_SRV, 2)
    const avatar = await this.gd.getAV(args.idm)
    if (!avatar) throw new AppExc(F_SRV, 1)
    const compte = avatar.idc === this.id ? this.compte : await this.gd.getCO(avatar.idc, 'RadierMembre-2')
    const moi = compte.estAvc(args.idm)

    const im = gr.mmb.get(args.idm)
    if (!im) throw new AppExc(A_SRV, 251)
    const stm = gr.st[im] // statut AVANT radiation
    const anc = this.compte.imAnimsDeGr(gr) // avatars du compte étant animateur

    if (!moi) {
      // radiation d'un autre : exige qu'un de ses avatars soit animateur
      if (!anc.size) throw new AppExc(A_SRV, 267)
      // mais pas un animateur : ne peut pas radier un animateur
      if (stm === 5) throw new AppExc(A_SRV, 269)
      // et à condition d'avoir accès aux membres
      const [am, ] = gr.amAn(anc)
      if (!am) throw new AppExc(A_SRV, 268)
    }

    const mb = await this.gd.getMBR(args.idg, im, 'RadierMembre-3')

    if (args.rad === 1) {
      gr.retourContact(im)
      mb.retourContact(this.auj)
    } else {
      gr.radiation(im, args.rad === 3, moi)
      mb.setZombi()
    }
    const stmap = gr.st[im] // statut APRES radiation
    if (stm < 4) { // est actuellement dans invits
      if (stmap === 0) { // ne doit plus l'être
        const invits = await this.gd.getIN(compte.id)
        if (invits) invits.supprContact(args.idg, args.idm)
      }
    } else {
      if (stmap === 1) { // il doit désormais y être
        const invits = await this.gd.getIN(compte.id)
        const inv = {
          idg: args.idg, 
          ida: args.idm, 
          cleGA: args.cleGA, 
          cvG: gr.cvG
        }
        if (invits) invits.setContact(inv)
      }
    }

    if (gr.imh === im) gr.finHeb(this.auj) // c'était l'hébergeur

    compte.radier(args.idg, args.idm)

    // suppression éventuelle du groupe
    if (gr.nbActifs === 0) await this.supprGroupe(gr)
  }
}

/* HebGroupe: Gestion de l'hébergement et des quotas d'un grouper
Exception générique:
- 8001: avatar disparu
- 8002: groupe disparu
*/
operations.HebGroupe = class HebGroupe extends Operation {
  constructor (nom) { 
    super(nom, 1, 2)
    this.targs = {
      idg: { t: 'idg' }, // id du groupe
      nvHeb: { t: 'ida' }, // id de l'avatar nouvel hébergeur
      action: { t: 'int', min: 1, max: 4 }, 
      // 1: 'Je prends l\'hébergement à mon compte',
      // 2: 'Je cesse d\'héberger ce groupe',
      // 3: 'Je reprends l\'hébergement de ce groupe par un autre de mes avatars',
      // 4: 'Je met à jour les nombres de notes et volumes de fichiers maximum attribués au groupe',
      quotas: { t: 'q2' } // qn: nombre maximum de notes, qv : volume maximum des fichiers
    }
  }

  async phase2 (args) {
    args.qn = args.quotas.qn; args.qv = quotas.qv
    const gr = await this.gd.getGR(args.idg)
    if (!gr) throw new AppExc(F_SRV, 2)
    if (args.action === 1 || args.action === 3){
      const avatar = await this.gd.getAV(args.nvHeb)
      if (!avatar) throw new AppExc(F_SRV, 1)
    }

    if (args.action === 2) { // fin d'hébergement
      if (gr.idh !== this.id) throw new AppExc(A_SRV, 276)
      gr.finHeb(this.auj)
      this.compta.finHeb(gr.nn, gr.vf)
      return
    }

    if (args.action === 1) { // Je reprends l\'hébergement à mon compte
      // if (!gr.idh) throw new AppExc(A_SRV, 277)
      if (gr.idh === this.id) throw new AppExc(A_SRV, 278)
      const im = gr.mmb.get(args.nvHeb)
      if (!im || gr.accesNote2(im) !== 2) throw new AppExc(A_SRV, 279)
      if (gr.st[gr.imh] === 5 && gr.st[im] !== 5) throw new AppExc(A_SRV, 280)
      this.compta.debHeb(gr.nn, gr.vf)
      gr.majHeb(args.qn, args.qv, this.id, im)
      return
    }

    if (args.action === 3) { // Je reprends l\'hébergement de ce groupe par un autre de mes avatars
      if (gr.idh !== this.id) throw new AppExc(A_SRV, 283)
      const im = gr.mmb.get(args.nvHeb)
      if (!im || gr.accesNote2(im) !== 2) throw new AppExc(A_SRV, 284)
      gr.majHeb(args.qn, args.qv, this.id, im)
    }

    if (args.action === 4) { // Je met à jour les nombres de notes et volumes de fichiers maximum attribués au groupe
      if (gr.idh !== this.id) throw new AppExc(A_SRV, 285)
      gr.majHeb(args.qn, args.qv, gr.idh, gr.imh)
    }

  }
}

/* SupprAvatar: Suppression d\'un avatar
Exception:
- 8001: avatar disparu
*/
operations.SupprAvatar = class SupprAvatar extends Operation {
  constructor (nom) { 
    super(nom, 1, 2)
    this.targs = {
      id: { t: 'ida' } // id de l'avatar
    }
  }

  async phase2 (args) {
    if (!this.compte.mav[args.id]) throw new AppExc(F_SRV, 1)
    const avatar = await this.gd.getAV(args.id)
    if (!avatar) throw new AppExc(F_SRV, 1)
    if (args.id === this.id ) throw new AppExc(A_SRV, 286)
    await this.resilAvatar(avatar)
  }
}

/* SupprCompte: Suppression du compte
Exception:
- 8001: avatar disparu
*/
operations.SupprCompte = class SupprCompte extends Operation {
  constructor (nom) { super(nom, 1, 2) }

  async phase2 () { 
    const compte = await this.gd.getCO(this.id)
    if (!compte) throw new AppExc(F_SRV, 1)
    await this.resilCompte(compte)
  }
}

/* OperationNoh : super classe hébergeant des méthodes utilitaires de gestion des notes */
class OperationNo extends Operation {

  async checkNoteId () {
    const id = this.args.id
    if (ID.estGroupe(id)) {
      const e = this.compte.mpg[id] 
      if (!e) throw new AppExc(A_SRV, 290)
      this.mavc = new Map()
      this.groupe = await this.gd.getGR(id, 'OperationNo-1')
      this.anim = false
      for (const idm of e.lav) {
        const im = this.groupe.mmb.get(idm)
        if (!im || this.groupe.st[im] < 4) continue
        const anim = this.groupe.st[im] === 5
        if (anim) this.anim = true
        const f = this.groupe.flags[im]
        let am = false, an = false, de = false
        if ((f & FLAGS.AN) && (f & FLAGS.DN)) an = true 
        if ((f & FLAGS.AM) && (f & FLAGS.DM)) am = true 
        if (an && (f & FLAGS.DE)) de = true
        if (an) this.mavc.set(idm, { im, am, de, anim })
      }
      if (!this.mavc.size) throw new AppExc(A_SRV, 291)
      this.aut = this.args.ida ? this.mavc.get(this.args.ida) : null
    } else {
      if (!this.compte.mav[id]) throw new AppExc(A_SRV, 292)
    }
  }

  // Contrôle d'existence de la note parent et de l'absence de cycle
  async checkRatt (g) {
    let notep, id = this.args.pid, ids = this.args.pids || null
    if (!ids) { // rattachée à une racine
      if (id !== this.args.id) {
        if (g) throw new AppExc(A_SRV, 298)
        else if (!ID.estGroupe(id)) throw new AppExc(A_SRV, 299)
      }
    } else { // rattachée
      const cycle = [this.args.ids]
      // eslint-disable-next-line no-constant-condition
      while (true) {
        notep = await this.gd.getNOT(id, ids)
        if (!notep && cycle.length === 1) throw new AppExc(A_SRV, 294)
        if (!notep) break
        cycle.push(notep.ids)
        if (notep.ids === this.args.ids) throw new AppExc(A_SRV, 295, [cycle.join(' ')])
        if (g) {
          if (notep.id !== this.args.id) throw new AppExc(A_SRV, 297)
        } else {
          if (ID.estGroupe(notep.id)) break
          if (notep.id !== this.args.id) throw new AppExc(A_SRV, 296)  
        }
        if (!notep.pid || !notep.pids) break
        id = notep.pid
        ids = notep.pids
      }
    }
  }
}

/* NouvelleNote: Création d\'une nouvelle note */
operations.NouvelleNote = class NouvelleNote extends OperationNo {
  constructor (nom) { 
    super(nom, 1, 2)
    this.targs = {
      id: { t: 'idag' }, // id de la note (avatar ou groupe)
      ida: { t: 'ida', n: true }, // pour une note de groupe, id de son avatar auteur
      exclu: { t: 'bool', n: true }, // true si l'auteur est exclusif
      pid: { t: 'idag', n: true }, // id de la note parente pour une note rattachée
      pids: { t: 'ids', n: true}, // ids de la note parente pour une note rattachée
      t: { t: 'u8' } // texte crypté
    }
  }

  async phase2 (args) { 
    await this.checkNoteId()
    args.ids = ID.estGroupe(args.id) ? ID.noteGr() : ID.noteAv()
    let im = 0, aut = 0
    if (!this.groupe) {
      if (args.ref) await this.checkRatt()
      this.compta.nnPlus(1)
      this.compta.exN()
    } else {
      if (!this.aut || !this.aut.de) throw new AppExc(A_SRV, 293)
      if (args.exclu) im = this.aut.im
      aut = this.aut.im
      if (args.ref) await this.checkRatt(true)
      const compta = await this.gd.getCA(this.groupe.idh, 'NouvelleNote-1')
      compta.nnPlus(1)
      compta.exN()
      this.groupe.setNV(1, 0)
      this.groupe.exN()
    }
    const par = { im, dh: this.dh, t: args.t, aut, pid: args.pid, pids: args.pids}
    await this.gd.nouvNOT(args.id, args.ids, par)
  }
}

/* RattNote: Gestion du rattachement d\'une note à une autre */
operations.RattNote = class RattNote extends OperationNo {
  constructor (nom) { 
    super(nom, 1, 2) 
    this.targs = {
      id: { t: 'idag' }, // id de la note (avatar ou groupe)
      ids: { t: 'ids' }, // ids de la note
      pid: { t: 'idag', n: true }, // id de la note parente pour une note rattachée
      pids: { t: 'ids', n: true} // ids de la note parente pour une note rattachée
    }
  }

  async phase2 (args) { 
    if (!args.pid) throw new AppExc(A_SRV, 300)
    const note = await this.gd.getNOT(args.id, args.ids, 'RattNote-1')
    const ng = ID.estGroupe(args.id)
    await this.checkNoteId()
    let ok = ng ? false : true
    if (ng) for(const [, e] of this.mavc ) { // idm, { im, am, de, anim }
      if (e.de && (!note.im || (note.im === e.im) || e.anim)) ok = true
    }
    if (!ok) throw new AppExc(A_SRV, 301)
    await this.checkRatt(ng)
    note.setRef(args.pid, args.pids)
  }
}

/* MajNote: Mise à jour du texte d\'une note */
operations.MajNote = class MajNote extends OperationNo {
  constructor (nom) { 
    super(nom, 1, 2)
    this.targs = {
      id: { t: 'idag' }, // id de la note (avatar ou groupe)
      ids: { t: 'ids' }, // ids de la note
      aut: { t: 'int', min: 1, max: 1000, n: true }, // im de l'auteur de la note pour un groupe
      t: { t: 'u8' } // texte crypté
    }
  }

  async phase2 (args) { 
    const note = await this.gd.getNOT(args.id, args.ids, 'MajNote-1')
    const ng = ID.estGroupe(args.id)
    await this.checkNoteId()
    let im = 0
    if (ng) {
      const e = this.mavc.get(args.aut) // idm, { im, am, de, anim }
      if (!e || !e.de) throw new AppExc(A_SRV, 313)
      if (note.im && note.im !== e.im) throw new AppExc(A_SRV, 314)
      note.setAut(e.im)
      im = e.im    
    }
    note.setTexte(args.t, im, this.dh)
  }
}

/* SupprNote: Suppression d'une note */
operations.SupprNote = class SupprNote extends OperationNo {
  constructor (nom) { 
    super(nom, 1, 2) 
    this.targs = {
      id: { t: 'idag' }, // id de la note (avatar ou groupe)
      ids: { t: 'ids' } // ids de la note
    }
  }

  async phase2 (args) { 
    const note = await this.gd.getNOT(args.id, args.ids)
    if (!note) return
    const ng = ID.estGroupe(args.id)
    await this.checkNoteId()
    let ok = false
    if (ng) {
      if (!this.anim) {
        for(const [,e] of this.mavc) {
          if (e.de && (!note.im || note.im === e.im)) ok = true
        }
      } else ok = true
      if (!ok) throw new AppExc(A_SRV, 315)
    }
    const dv = -note.vf

    let compta

    if (ng) {
      this.groupe.setNV(0, dv)
      if (this.groupe.idh) {
        compta = this.groupe.idh === this.id ? this.compta : 
          await this.gd.getCA(this.groupe.idh, 'SupprNote-1')
      }
    } else {
      compta = this.compta
    }
    
    if (compta) {
      compta.vPlus(dv)
      compta.exV()
    }

    this.lidf = []
    for(const idf in note.mfa) this.lidf.push(idf)

    note.setZombi()

    if (this.lidf.length) 
      this.idfp = await this.setFpurge(args.id, this.lidf)
  }

  async phase3 (args) {
    if (this.lidf.length) try {
      await this.storage.delFiles(this.org, args.id, this.lidf)
      await this.unsetFpurge(this.idfp)
    } catch (e) { 
      trace('SupprNote-phase3', args.id, e.message)
    }
  }
}

/* HTNote: Changement des hashtags attachés à une note par un compte */
operations.HTNote = class HTNote extends OperationNo {
  constructor (nom) { 
    super(nom, 1, 2)
    this.targs = {
      id: { t: 'idag' }, // id de la note (avatar ou groupe)
      ids: { t: 'ids' }, // ids de la note
      htK: { t: 'u8', n: true }, // ht personels
      htG: { t: 'u8', n: true }, // hashtags du groupe
    }
  }

  async phase2 (args) { 
    const note = await this.gd.getNOT(args.id, args.ids, 'HTNote-1')
    const ng = ID.estGroupe(args.id)
    await this.checkNoteId()
    if (ng) {
      note.setHT(args.htK, this.id)
      if (this.anim) note.setHTG(args.htG)
    } else note.setHT(args.htK)
  }
}

/* ExcluNote: Changement de l'attribution de l'exclusivité d'écriture d'une note */
operations.ExcluNote = class ExcluNote extends OperationNo {
  constructor (nom) { 
    super(nom, 1, 2)
    this.targs = {
      id: { t: 'idag' }, // id de la note (avatar ou groupe)
      ids: { t: 'ids' }, // ids de la note
      ida: { t: 'ida', n: true } // id de l'avatar prenant l'exclusivité
    } 
  }

  async phase2 (args) {
    // Pour attribuer l\'exclusité d\'écriture d\'une note, il faut, 
    // a) soit être animateur, 
    // b) soit l\'avoir soi-même, c) soit que personne ne l\'ait déjà.'
    const note = await this.gd.getNOT(args.id, args.ids, 'HTNote-1')
    if (!ID.estGroupe(args.id)) throw new AppExc(A_SRV, 303)
    await this.checkNoteId()
    let aExclu = false
    for(const [, e] of this.mavc) 
      if (e.im === note.im) aExclu = true

    let im = 0
    if (!args.ida) {
      if (!aExclu && !this.anim) throw new AppExc(A_SRV, 306)
    } else {
      const peut = this.anim || aExclu || !note.im
      if (!peut) throw new AppExc(A_SRV, 304)
      im = this.groupe.mmb.get(args.ida)
      if (!im) throw new AppExc(A_SRV, 305)
      const f = this.groupe.flags[im]
      const ok = (f & FLAGS.AN) && (f & FLAGS.DN) && (f & FLAGS.DE)
      if (!ok) throw new AppExc(A_SRV, 305)
    }
    note.setExclu(im)
  }
}

/* GetUrlNf : retourne l'URL de get d'un fichier d'une note
Retour:
- url : url de get
*/
operations.GetUrlNf = class GetUrl extends OperationNo {
  constructor (nom) { 
    super(nom, 1, 2)
    this.targs = {
      id: { t: 'idag' }, // id de la note (avatar ou groupe)
      ids: { t: 'ids' }, // ids de la note
      idf: { t: 'idf' } // id du fichier
    } 
  }

  async phase2 (args) {
    await this.checkNoteId()
    const note = await this.gd.getNOT(args.id, args.ids, 'GetUrlNf-1')
    const avgr = ID.estGroupe(args.id) ? await this.gd.getGR(args.id) : await this.gd.getAV(args.id) 
    const f = note.mfa[args.idf] // { idf, nom, info, dh, type, gz, lg, sha }
    if (!f) throw new AppExc(A_SRV, 307)
    // Ralentissement éventuel
    await this.attente(lg / 1000000)
    const url = await this.storage.getUrl(this.org, avgr.alias, args.idf)
    this.setRes('url', url)
    this.vd += f.lg // décompte du volume descendant
  }
}

/* PutUrlNf : retourne l'URL de put d'un fichier d'une note
Retour:
- idf : identifiant du fichier
- url : url à passer sur le PUT de son contenu
*/
operations.PutUrlNf = class PutUrl extends OperationNo {
  constructor (nom) { 
    super(nom, 1, 2) 
    this.targs = {
      id: { t: 'idag' }, // id de la note (avatar ou groupe)
      ids: { t: 'ids' }, // ids de la note
      lg: {t: 'int', min: 0, max: 500000000}, // taille du fichier
      aut: { t: 'ida', n: true }, // pour une note de groupe, id de l'auteur de l'enregistrement
      lidf: { t: 'lidf', n: true } // liste des idf fichiers de la note à supprimer
    } 
  }

  async phase2 (args) {
    await this.checkNoteId()
    const note = await this.gd.getNOT(args.id, args.ids, 'PutUrlNf-1')
    const avgr = ID.estGroupe(args.id) ? await this.gd.getGR(args.id) : await this.gd.getAV(args.id) 
    if (ID.estGroupe(args.id)) {
      const e = this.mavc.get(args.aut) // idm, { im, am, de, anim }
      if (!e || !e.de) throw new AppExc(A_SRV, 313)
      if (note.im && note.im !== e.im) throw new AppExc(A_SRV, 314)
    }

    let nv = args.lg
    const s = new Set()
    if (args.lidf && args.lidf.length) args.lidf.forEach(idf => { s.add(idf) })
    for (const idf in note.mfa) {
      if (!s.has(idf)) nv += note.mfa[idf].lg
    }

    let compta
    if (ID.estGroupe(args.id)) {
      // Dépassement du quota donné par l'hébergeur ?
      if (this.groupe.idh) {
        if (this.groupe.vf - note.vf + nv > this.groupe.qv * UNITEV) 
          throw new AppExc(F_SRV, 66, [this.vf, this.qv * UNITEV])
        compta = this.groupe.idh === this.id ? this.compta : 
          await this.gd.getCA(this.groupe.idh, 'ValiderUpload-4')
      } else { // Pas d'hébergeur, le volume doit baisser
        if (nv > note.vf) throw new AppExc(A_SRV, 312)
      }
    } else {
      compta = this.compta
    }
    // dépassement du quota comptable du compte ou de l'hébergeur
    const x = compta.qv.v + nv - note.vf
    if (x > compta.qv.qv * UNITEV) 
      throw new AppExc(F_SRV, 56, [x, compta.qv.qn * UNITEV])

    const idf = ID.fic()
    await this.attente(lg / 1000000)
    const url = await this.storage.getUrl(this.org, avgr.alias, idf)
    this.setRes('url', url)
    this.setRes('idf', idf)

    const dlv = AMJ.amjUtcPlusNbj(this.auj, 1)
    const tr = new Transferts().init({ id: avgr.alias, idf, dlv })
    this.insert(tr.toRow(this))
  }
}

/* validerUpload */
operations.ValiderUpload = class ValiderUpload extends OperationNo {
  constructor (nom) { 
    super(nom, 1, 2)
    this.targs = {
      id: { t: 'idag' }, // id de la note (avatar ou groupe)
      ids: { t: 'ids' }, // ids de la note
      fic: { t: 'fic' }, // { idf, lg, ficN }
      aut: { t: 'ida', n: true }, // id de l'auteur (pour une note de groupe)
      lidf: { t: 'lidf', n: true } // liste des idf fichiers de la note à supprimer
    }
  }

  async phase2 (args) {
    await this.checkNoteId()
    await this.gd.getNOT(args.id, args.ids, 'ValiderUpload-1')
    const note = await this.gd.getNOT(args.id, args.ids, 'ValiderUpload-2')
    const f = note.mfa[args.fic.idf]
    if (f) throw new AppExc(A_SRV, 310)
    let dv = note.vf
    note.setFic(args.fic)
    if (args.lidf && args.lidf.length) 
      args.lidf.forEach(idf => { note.delFic(idf)})
    note.setVF()
    dv = note.vf - dv

    let compta

    if (ID.estGroupe(args.id)) {
      const e = this.mavc.get(args.aut) // idm, { im, am, de, anim }
      if (!e || !e.de) throw new AppExc(A_SRV, 313)
      if (note.im && note.im !== e.im) throw new AppExc(A_SRV, 314)
      note.setAut(e.im)
      if (this.groupe.idh) {
        this.groupe.setNV(0, dv)
        this.groupe.exV()
        compta = this.groupe.idh === this.id ? this.compta : 
          await this.gd.getCA(this.groupe.idh, 'ValiderUpload-4')
      } else {
        if (dv > 0) throw new AppExc(A_SRV, 312)
        this.groupe.setNV(0, dv)
      }
    } else {
      compta = this.compta
    }
    
    if (compta) {
      compta.vPlus(dv)
      compta.exV()
    }
    
    await this.purgeTransferts(args.id, args.fic.idf)

    if (args.lidf && args.lidf.length) 
      this.idfp = await this.setFpurge(args.id, args.lidf)
  }

  async phase3 (args) {
    if (this.idfp) try {
      await this.storage.delFiles(this.org, args.id, args.lidf)
      await this.unsetFpurge(this.idfp)
    } catch (e) { 
      trace('ValiderUpload-phase3', args.id, e.message)
    }
  }

}

/* SupprFichier : Suppression d'un fichier d'une note */
operations.SupprFichier = class SupprFichier extends OperationNo {
  constructor (nom) { 
    super(nom, 1, 2)
    this.targs = {
      id: { t: 'idag' }, // id de la note (avatar ou groupe)
      ids: { t: 'ids' }, // ids de la note
      idf: { t: 'idf' }, // id du fichier à supprimer
      aut: { t: 'ida', n: true } // id de l'auteur (pour une note de groupe)
    }
  }

  async phase2 (args) {
    await this.checkNoteId()
    await this.gd.getNOT(args.id, args.ids, 'SupprFichier-1')
    const note = await this.gd.getNOT(args.id, args.ids, 'SupprFichier-2')
    const f = note.mfa[args.idf]
    if (!f) return
    let dv = note.vf
    note.delFic(args.idf)
    note.setVF()
    dv = note.vf - dv // négatif

    let compta

    if (ID.estGroupe(args.id)) {
      const e = this.mavc.get(args.aut) // idm, { im, am, de, anim }
      if (!e || !e.de) throw new AppExc(A_SRV, 313)
      if (note.im && note.im !== e.im) throw new AppExc(A_SRV, 314)
      note.setAut(e.im)
      if (this.groupe.idh) {
        this.groupe.setNV(0, dv)
        this.groupe.exV()
        compta = this.groupe.idh === this.id ? this.compta : 
          await this.gd.getCA(this.groupe.idh, 'SupprFichier-4')
      } else {
        this.groupe.setNV(0, dv)
      }
    } else {
      compta = this.compta
    }
    
    if (compta) {
      compta.vPlus(dv)
      compta.exV()
    }
    this.idfp = await this.setFpurge(args.id, [args.idf])
  }

  async phase3 (args) {
    try {
      await this.storage.delFiles(this.org, args.id, [args.idf])
      await this.unsetFpurge(this.idfp)
    } catch (e) { 
      trace('SupprFichier-phase3', args.id, e.message)
    }
  }

}

