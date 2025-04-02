## Bug / vérifications...
    
## TODO

## Doc
application.md est en cours

# Application Web - Build et test de la build

    yarn quasar build -m pwa

    # OU
    npm run build:pwa

    # https://github.com/http-party/http-server
    # Installation: npm install -g http-server

    npx http-server dist/pwa -p 8080 --cors -S --cert ../asocial-srv/keys/fullchain.pem --key ../asocial-srv/keys/privkey.pem

    # Plus simplement
    npx http-server dist/pwa -p 8080 --cors

Le résultat est dans `dist/pwa` (environ 40 fichiers pour 5Mo):
- y mettre le fichier `services.json` avec le contenu ci-dessus et `README.md`.

L'application _buildée et configurée_ peut être distribuée depuis `dist/pwa` sur le CDN de son choix, par exemple ci-après dans `github pages`.


# Développement Firestore
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

## Déployer depuis `asocial-gae1`

    gcloud app deploy --verbosity debug --no-cache

no-cache : sinon plantage du build step 2 en cherchant à comparer avec une version antérieure.

Quelques minutes ..., puis si nécessaire (si `cron.yaml` a changé par rapport à l'opérationnel):

    gcloud app deploy cron.yaml

C'est rapide.

Dans un autre terminal `gcloud app logs tail` permet de voir les logs de l'application quand ils vont survenir.

Les logs complets s'obtienne depuis la console Google du projet (menu hamburger en haut à gauche `>>> Logs >>> Logs Explorer`).

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
