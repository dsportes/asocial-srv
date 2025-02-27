## Bug / vérifications...
    
## TODO
Pas testé: GC : DLV comptas, DLV : sponsorings, DLV : versions

Pages d'aide:
- Rubriques "Comment faire pour ..."

## Réflexions
**La connexion d'un compte au delà de sa DLV n'est pas _bloquée_**
- le GC _peut_ supprimer les comptes sur DLV, et c'est ça qui va empêcher la connexion.
- pour un espace _figé en archive_, le GC n'opère plus: les comptes restent donc accessibles après leur DLV.

## Doc
application.md est en cours

Déploiements:
- GAE
- CF OP
- CF PUBSUB

# Problèmes de build des binaires
Concerne a minima better-sqlite3 qui a besoin d'être buildé.

yarn le fait.

MAIS il faut avoir installé build-tools:

    npm install build-tools -g

# Développement Firestore

Il y a une dualité entre Firebase et GCP (Google Cloud Platform):
- `firestore, storage, functions` sont _effectivement_ hébergés sur GCP.
- la console Firebase propose une vue et des fonctions plus simples d'accès mais moins complètes.
- il faut donc parfois retourner à la console GCP pour certaines opérations.

Consoles:

    https://console.cloud.google.com/
    https://console.firebase.google.com/
    https://console.firebase.google.com/project/asocial-test1

## CLI Firebase
https://firebase.google.com/docs/cli

Installation ou mise à jour de l'installation

    npm install -g firebase-tools

### Authentification

    firebase login

**MAIS ça ne suffit pas toujours,** il faut régulièrement se ré-authentifier:

    firebase login --reauth


### Delete ALL collections
Aide: firebase firestore:delete -

    firebase firestore:delete --all-collections -r -f

### Déploiement des index et rules
Les fichiers sont:
- `firestore.indexes.json`
- `firestore.rules`

    Déploiement (import)
    firebase deploy --only firestore:indexes

    Export des index dans firestore.indexes.json
    firebase firestore:indexes > firestore.indexes.EXP.json

### Emulator
Dans `src/config.mjs` remplir la section `env:`

    env: {
       // On utilise env pour EMULATOR
      STORAGE_EMULATOR_HOST: 'http://127.0.0.1:9199', // 'http://' est REQUIS
      FIRESTORE_EMULATOR_HOST: 'localhost:8080'
    },

Remarques:
- Pour storage: 
  - le nom de variable a changé au cours du temps. C'est bien STORAGE_...
  - il faut `http://` devant le host sinon il tente https
- Pour Firestore il choisit le port 8080. Conflit éventuel avec app par exemple.
- En cas de message `cannot determine the project_id ...`
  `export GOOGLE_CLOUD_PROJECT="asocial-test1"`

**Commandes usuelles:**

    Depuis ./emulators

    Lancement avec mémoire vide:
    L'argument --project peut être omis s'il existe .firebaserc
    firebase emulators:start --project asocial-test1

    Lancement avec chargée depuis un import:
    firebase emulators:start --import=./bk/t1

    Le terminal reste ouvert. Arrêt par CTRL-C (la mémoire est perdue)

En cours d'exécution, on peut faire un export depuis un autre terminal:

    firebase emulators:export ./bk/t1 -f

**Consoles Web sur les données:**

    http://127.0.0.1:4000/firestore
    http://127.0.0.1:4000/storage

# Import / export

node src/tools.mjs export-db --in demo,sqlite_a,A --out demo,firestore_a,A

node src/tools.mjs export-st --in demo,fs_a,A --out demo,gc_a,A

node src/tools.mjs purge-db --in demo,sqlite_a,A

# Déploiement GAE

Éditer:
- gae/keys.json
- gae/config.mjs

        # Depuis git
        mkdir ./asocial-gae1
        mkdir ./asocial-gae1/dist
        cd ./asocial-srv/gae
        ./depl.sh
        cd ../../asocial-gae1
        yarn install
        node src/gensecret.mjs
        npm run build

        # Run
        cd dist
        node main.js

# Scénarios de test

## Init-0
- Base vide
- Login admin (#1)
  - init. des tâches GC
  - création espace 1 demo
  - allocation de quotas
- Login création Comptable demo
  - page espace
    - autorisation comptes A
    - création de deux partitions P1 P2
    - sponsor d'un compte O délégué de P1 (T)
    - sponsor d'un compte A avec don (D)

Export -> sqlite-b

## Scénario-1 : changement de partition, dons
- Base 0
- C sponsorise M sur P1
- M doit voir T sur chats d'urgence - créé un chat avec T
- C bouge T sur P2, change statut sponsor, remet sur P1
- M : annonce de crédits, reçu par C
- M : demande à T de le muter en compte A
- M : demande à T par chat de devenir compte 0 sur P1

## Scenario-2 : CV, contacts, restrictions compte O
- Base 1
- D : phrase de contact
- M : liste contacts - ajoute D par sa phrase
- CV de T, HT / commentaire de T pour M
- M : liste contacts, rafraîchir CV

Restrictions sur compte O
- M demande à muter O, T exécute
- T : (dé) bloque M en lecture / en accès restreint : vérification des accès
- C : (dé) bloque M en lecture / en accès restreint : vérification des accès

Restriction pour solde négatif:
- api.mjs (serveur) : ligne 966: AL;ARSN sur soldecourant < 1
- connexion D : vérification blocage AR
- rétablir api.mjs - reconnexion, blocage AR disparu

## Scenario-3 : transferts / sponsorings
- Base 2
- D crée une note et un fichier : vérification affichable (test transferts et purge)
- Debug : point d'arrêt validerUpload
- D crée une révision. Serveur tué sur point d'arrêt. Vérifier qau'il existe un transfert en attente
- Enlève le point d'arrêt.
- Changement dlv du transfert en attente
- relance serveur, login admin: relance tâche TRA. Vérification de la suppression du transfert
- Changement de dlv d'un des sponsorings
- relance tâche VER: vérification de la suppression du sponsoring 

Scenario : alertes RAL NRED VRED, max n/v de groupe

Reste à vérifier avec Firestore:
- comptas dlv
- groupes dfh
- versions dlv
