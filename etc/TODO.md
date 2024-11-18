## Bug / vérifications...
- les pages help

## Doc
- App: store hb à documenter
- Présentation générale: alertes / comptas
- App est en cours

Déploiements:
- GAE
- CF OP
- CF PUBSUB

## Remarques diverses

{
  // Use IntelliSense to learn about possible attributes.
  // Hover to view descriptions of existing attributes.
  // For more information, visit: https://go.microsoft.com/fwlink/?linkid=830387
  "version": "0.2.0",
  "configurations": [
    {
      "type": "chrome",
      "request": "launch",
      "name": "Quasar App: chrome",
      "url": "https://localhost:8343",
      "webRoot": "${workspaceFolder}/src",
      "sourceMapPathOverrides": {
        "webpack://asocial/./src/*": "${webRoot}/*"
      }
    },
    {
      "type": "firefox",
      "request": "launch",
      "name": "Quasar App: firefox",
      "url": "https://localhost:8343",
      "webRoot": "${workspaceFolder}/src",
      "pathMappings": [
        {
          "url": "webpack://asocial/src",
          "path": "${workspaceFolder}/src"
        }
      ]
    }
  ]
}



# GCP Functions
## Test local / debug
Auto-Attach: With Flag

Lancer en debug: npm run debug

    "debug" : "node --inspect node_modules/.bin/functions-framework --port=8443 --target=asocialGCF"

Lancer SANS debug: npm run start

    "start": "functions-framework --port=8443 --target=asocialGCF --signature-type=http"

.vscode/launch.json - Pas certain que ça serve, à revérifier

    {
      "version": "0.2.0",
      "configurations": [
        {
          "type": "node",
          "request": "attach",
          "name": "debug",
          "address": "localhost",
          "port": 9229
        }
      ]
    }


**Différence importante** pour le POST des opérations dans `cfgexpress.mjs` - `app.use('/op:operation ...)`
- Mode SRV: req.rawBody n'existe pas. On le construit depuis req.on
- Mode GCF: req.rawBody existe mais pas req.on

____________________________________________
Compta à redocumenter


#### `nbjCumref` : nombre de jours de la période actuelle de référence utilisée pour calculer les cumuls abo / conso

#### `solde` : solde actuel du compte en c
Tous les comptes, O et A, ont un solde.

Quand le solde est **négatif** le compte est en **ACCÈS RESTREINT**.

Les comptes sont créés:
- pour un compte O avec un crédit de 1c.
- pour un compte A,
  - soit avec un crédit de 1c quand il est sponsorisé par un _délégué_,
  - soit avec un crédit supérieur correspondant au don quand il est sponsorisé pr un compte A.

#### `ddsn` : date de début de solde négatif - passée (réelle) ou future (estimée)
- pour une date passée, date à laquelle le solde **est devenu effectivement** négatif,
- sinon c'est une date future estimée:
  - pour un compte actuellement A: date à laquelle le solde **deviendra négatif** en supposant qu'il n'ait pas de consommation (donc sur le seul coût d'abonnement).
  - pour un compte actuellement O: 0 (jamais).

#### Calculée `cjm` : consommation journalière moyenne
Relevée sur le mois en cours et le précédent et rapportée à une journée de 24h.

Juste après création, le mois précédent est vierge de consommation et le mois en cours peut être réduit à 1 ou quelques jours: en conséquence, si le compte a beaucoup utilisé de calculs en _initialisation_ de son compte, son cjm va être très fort, son taux d'utilisation du quota de calcul pc aussi énorme ce qui va provoquer un ralentissement.

Pour éviter ça on va arbitrairement considérer que la période de début à au moins 10 jours.

#### Calculée `njec` : nombre de jours estimés avant épuisement du crédit
Pour un compte ayant un solde positif, nombre de jours au bout duquel le crédit devrait être épuisé en supposant,
- que ses quotas restent inchangés,
- que sa consommation future reste égale à la consommation journalière moyenne estimée.

#### Calculée `cjAbo` : coût journalier de l'abonnement actuel
Les tarifs d'abonnement sont dits _mensuel_ mais en réalité ils correspondent à des coûts pour 30 jours.

#### Calculée `resume` : propriétés de compteurs impactant les restrictions / dlv
- `pcc pcn pcv max` : pourcentage d'utilisation des quotas (`max` pourcentage maximal des trois autres). Impact de ralentissement.
- `pcc` : la consommation `cjm` rapportée au quota `qc` _journalisé_.
- `ddsn ddsnEst solde estA` : Impact ACCÈS RESTREINT.

**Restrictions:**
- RAL1 : ralentissement 1.  r.pcc entre 80 et 100
- RAL2 : ralentissement 2. r.pcc >= 100
- NRED : nombre de documents en réduction. r.pcn >= 100
- VRED : volume fichiers en réduction. r.pcv >= 100
- RESTR: accès restreint. r.solde < 0

Restrictions d'autres sources que les compteurs de comptabilité
- LECT: (compte O) notification de partition ou de compte de nr = 2
- RESTRN: (compte O) notification de partition ou de compte de nr = 3
- FIGE: espace figé.

### `dlv` _date limite de vie_ d'un compte (et `dlvat`)
`dlv` d'un compte : cette date, fixée au dernier jour d'un mois, indique que le compte s'auto-détruira le lendemain.

`dlvat` de l'espace : cette fixée pae l'Administrateur Technique interdit toute connexion au delà cette date, mais les comptes n’encourent pas de risque de destruction.

La `dlv` d'un compte est calculée à la fin de chaque opération qu'il a déclenchée: si une opération soumise par un compte A affecte un compte B, la dlv du compte B est inchangée, celle de A peut l'être.

> En d'autres termes au retour de chaque opération un compte voit s'afficher le nombre de jours pendant lequel la vie du compte **est assurée** (sauf cas particulier de destruction totale de l'espace par l'Administrateur Technique_).

En état _normal_, c'est à dire en l'absence d'alertes **ACCÈS RESTREINT**, la `dlv` est fixée au dernier jour du mois de l'opération + 12.
- 12 est la valeur par défaut du paramètre `nbmi` fixé par le Comptable pour son organisation.

### Alertes _ACCÈS RESTREINT_ (AR)
Un compte peut être sous le coup de trois alertes _ACCÈS RESTREINT_:
- pour les comptes O, les alertes (P) et (C).
- pour tous les comptes, l'alerte (S) d'un solde négatif.

#### Pour les comptes "O" spécifiquement**
Le Comptable ou un délégué peut déclarer une alerte de niveau AR, ou monter une alerte existante au niveau AR.
- ciblant tous les comptes d'une partition (P),
- ciblant un seul compte (C).
- la date-heure `dhar` de l'alerte indique quand elle est _montée_ au niveau AR.

A la fin d'une opération, une synthèse `synthAR` de ces alertes est mise à jour dans le compte. Par exemple pour l'alerte (P) les propriétés:
- `dharP` : la date-heure identifiant de facto son _passage_ en niveau AR.
- `dhopP` : la date-heure de l'opération la plus ancienne ayant constaté la gravité AR de cette alerte. La cas échéant c'est la dh de l'opération elle-même si cette alerte n'avait pas encore été vue ou pas encore vue à ce niveau AR.

#### Pour tous les comptes
Tous les comptes ont un solde: pour les comptes "O" celui-ci est par défaut de 1c (attribué à la création) mais peut-être différent en fonction:
- des crédits enregistrés,
- des dons effectués,
- du fait qu'ils sont repassés "O" après une période en "A".

Un compte "A" a un solde _courant_ qui change virtuellement à chaque opération.

**Remarques**: même en l'absence d'opération d'un compte A,
- les opérations des autres comptes peuvent impacter le solde de A: réception d'un paiement par le Comptable, don d'un autre compte.
- le _temps qui passe_ affecte le solde _courant_ du compte A par imputation _virtuelle_ de ses coûts d'abonnement.

En conséquence un compte A peut,
- s'être déconnecté en _solde courant_ positif,
- se reconnecter plus tard et se découvrir en solde négatif courant, avec une _date de passage estimée en négatif_ bien antérieure.

`dpsn` : **date de passage (estimée) en solde négatif**
- Les compteurs de comptabilité sont stocké avec une date de calcul `dh`: à cette date ils avaient cette valeur.
- Mais depuis `dh`, _maintenant_, ils sont réajustés juste pour tenir compte du temps passé depuis `dh`.
  - si le solde courant était négatif à dh (dpsn existait), il est encore plus négatif _maintenant_. dpsn est inchangée.
  - si le solde courant était positif ou nul à dh (dpsn n'existait pas),
    - soit après réajustement du fait du temps qui passe le solde courant est toujours positif ou nul, dpsn reste non inexistante.
    - soit après ce réajustement le solde courant est négatif et on calcule quand il est passé de positif à négatif ce qui fixe dpsn qui devient significatif.

Quand le compte A se connecte, en fait à chaque opération qu'il effectue, il va inscrire dans son document compte dans synthAR:
- `dharS` : la valeur de dpsn (ou 0 si non existante),
- `dhopS` : la date-heure de l'opération SI la valeur de `dharS` a changé et est non nulle. Si la valeur de `dharS` était déjà connue antérieurement, rien ne change.

> **Ainsi à la fin de chaque opération**, le compte détient la date-heure de constat par lui-même de l'alerte AR la plus ancienne (minimum de `dhopP dhopC dhopS`).

### Valeur de dlv d'un compte A à la fin de chaque opération qu'il a soumise
`nbmi` : fixé par le Comptable pour toute l'organisation, est le nombre de mois de conservation d'un compte sans connexion (12 par défaut). 

Le compte détient à cet instant `dharM` la date-heure de sa détection de son alerte AR la plus ancienne.

Si `dharM` est absente (pas d'alerte AR connue): `dlv` est fixée au dernier jour du mois de l'opération + 12 (`nbmi`) mois.

Si `dharM` existe: `dlv` est fixée au dernier jour du mois de (`dharM` + (`nbmi` * 15 jours)).

> A chaque opération un compte voit s'afficher le nombre de jours avant sa fin de vie. En cas d'alertes ACCÈS RESTREINT ce nombre de jours est inférieur à 365 et il doit s'enquérir du pourquoi de ces alertes et y remédier.

