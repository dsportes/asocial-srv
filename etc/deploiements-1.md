# Déploiements
Il existe plusieurs choix de déploiement à partir du même logiciel. C'est l'administrateur technique qui effectue ces choix:
- dans des fichiers de configuration,
- par des commandes de _build_,
- enfin par des commandes déploiement effectif sur site(s).

## Déploiement sur serveur classique _VM_ ou _Google App Engine (GAE)_
Selon le choix de l'administrateur technique, le déploiement du ou des instances de serveur peut s'effectuer:
- **sur un serveur classique**, par exemple une VM hébergée (voire plusieurs) chez un hébergeur, avec ou sans frontal de type `nginx` qui n'est indispensable que quand il y a plusieurs instances de serveurs et d'application UI à configurer et déployer sur une même VM.
- **Google App Engine (GAE)**. Dans ce cas la base de données est `firestore` et logiquement le provider de storage est `gc` (plutôt que `s3`).

Les coûts, la sécurité et la charge d'administration diffèrent fortement d'une option à l'autre.

La **synchronisation des données** entre le serveur et une session UI peut passer par deux moyens techniques:
- a) par un **Web Socket** établi entre session et serveur.
- b) par une **écoute de requêtes firestore** dans la session.

Remarques:
- Le déploiement **GAE** interdit l'usage de l'option a).
- Le choix du provider **sqlite** interdit le b).
- Bien que techniquement possible, le choix b) avec un provider **firebase** n'a pas d'intérêt et n'a pas été autorisé.
- Dans le code des opérations quelques rares points nécessitent de savoir si le choix WebSocket a été fait ou non, les deux variantes de code ayant été implémentées.

### Préparation du déploiement
Elle consiste en un ajustement de la configuration :
- dans le fichier `src/config.mjs`, en particulier en listant les _origines_ des applications UI acceptées,
- en inscrivant dans le répertoire `./keys` les quelques fichiers confidentiels (certificats, signatures, jetons d'accès ...).
- **pour un déploiement GAE** en configurant de plus le fichier `app.yaml`,
- **pour les autres déploiements** en effectuant un _build_ `webpack` générant deux fichiers distribuables.

## Préparation du déploiement de l'application UI
Cette application supporte un _build_ par webpack qui en délivre une application Web PWA de quelques (gros) fichiers distribuables sur un site hébergeur:
- 5 fichiers `.js`
- 2 fichiers `.css`
- une vingtaine de fontes `.woff .woff2`
- 1 ou 2 fichiers d'icône
- un fichier `manifest.json`
- un fichier `index.html`

**L'application est à configurer avant _build_** dans le fichier `src/app/config.mjs` :
- plusieurs instances peuvent avoir la même configuration de la partie _profilage métier_;
- quelques valeurs en majuscules donnent des options (`DEV DEBUG BUILD`) à changer, éventuellement, entre test et déploiement;
- `SRV` identifie le serveur à qui l'application doit s'adresser. 
  - **en test c'est un serveur local** qui délivre une build de test de l'application UI (lancé par `quasar dev`),
  - l'application serveur est servie par un autre process / serveur, une autre URL.
  - **en déploiement**. Par simplification, quand l'application est chargée depuis le serveur lui-même (et non un autre serveur frontal comme `nginx`) cette adresse peut être laissée vierge et est obtenue en runtime de `window.location`: dans ce cas la configuration d'une instance de l'application UI est nulle.
- `quasar.config.js` : deux variables sont à ajuster pour la génération du déploiement par webpack.

## Site Web documentaire
Ses fichiers sont dans `asocial-doc`.

Les _pages_ sont,
- soit écrites directement en HTML,
- soit écrites en MD et un script les traduits en HTML.

Un script de _déploiement_ permet de générer le folder à déployer avec les pages en HTML (plutôt qu'en MD) et les images utilisées.

_Langue_
- les pages sont nativement écrites en français.
- au fil du temps certaines pourraient être traduites en anglais, voire en d'autres langues.

## L'utilitaire `upload`
C'est un micro serveur Web qui reçoit en entrée des fichiers et en copie le contenu dans un folder local au choix de l'utilisateur. 

Un _build_ permet de récupérer deux exécutables, un pour Linux, l'autre Windows, autonomes: ils embarquent un runtime `node.js` qui dispense l'utilisateur d'une installation un peu technique de `node.js`.

### Rappel
Le fichier de démarrage `src/server.js` est un module ES6, malgré son extension `.js`:
- le déploiement GooGle App Engine (GAE) **exige** que ce soit un `.js` et que `package.json` ait une directive `"type": "module"`.
- pour les tests usuels, il faut `"type": "module"`.
- MAIS pour un déploiement **NON GAE**, un build `npx webpack` est requis et cette dernière directive **DOIT** être enlevée ou renommée `"typeX"`.

_Remarques pour le build du serveur pour déploiement NON GAE_
- `webpack.config.mjs` utilise le mode `import` plutôt que `require` (les lignes pour CommonJs sont commentées).
- une directive spécifique dans la configuration `webpack.config.mjs` a été testée pour que `better-sqlite3` fonctionne en ES6 après build par webpack. Mais ça n'a pas fonctionné et `better-slite3` reste chargé par un require() dans `src/loadreq.mjs` (qui ne sert qu'à ça).

# Environnements de développement et de déploiement

> Les fichiers de configuration de l'application serveur (dans `./keys` et `src/config.mjs`) sont décrits en détail en annexe du document `API-Serveur.md`.

## Projet Google
L'utilisation d'un projet Google ne se justifie que si on utilise au moins l'un des deux dispositifs `Firestore` `gc : Google Cloud Storage`. Une implémentation uniquement `sqlite` et `S3 / fs` par exemple n'en n'a pas besoin.

Depuis son compte Google, dans Google Console `https://console.cloud.google.com/`, on peut créer un nouveau projet : dans l'exemple c'est `asocial-test1`. Ce projet doit accéder aux environnements / APIs:
- **App Engine**. Même si finalement on n'utilise pas GAE, ceci fournit des ressources et en particulier un `session_account` qui sera utilisé par la suite, ce qui évite d'en créer un spécifique qui ne serait pas utilisable en cas de décision de déployer GAE.
- **Firestore**
- **Cloud Storage**

Le menu hamburger en haut à gauche permet de sélectionner tous les produits et surtout d'épingler ceux qu'on utilise:
- **APIs & Service**
- **Billing**: c'est là qu'on finit par donner les références de sa carte bancaire.
- **IAM & Admin** : voir ci-dessous.
- **App Engine**
- **Firestore** : voir ci-dessous.
- **Cloud Storage** : voir ci-dessous.
- **Logging** : pour explorer les logs App engine.
- Security (?)

**Firestore**
- _Data_ : permet de visualiser les données.
- _Indexes_ : il n'y a que des index SINGLE FIELD. Les _exemptions_ apparaissent, on peut les éditer une à une et en créer mais on ne peut pas (du moins pas vu comment) en exporter les définitions : ceci justifie l'utilisation de Firebase qui le permet.
- _Rules_ : idem pour la visualisation / édition mais pas l'import / export.

**Cloud Storage**
- _Buckets_ : on peut y créer des buckets et les visiter. Il n'a pas été possible d'utiliser avec Firebase un autre bucket que celui qu'il créé par défaut `asocial-test1.appspot.com`/

**IAM & Admin**
- _Service accounts_ : il y a en particulier le _service account_ créé par App Engine `asocial-test1@appspot.gserviceaccount.com` et qui est celui utilisé dans l'exemple. Quand on choisit un des service accounts, le détail apparaît. En particulier l'onglet `KEYS` (il y a une clé active) qui va permettre d'en créer une pour nos besoins.

## Projet Firebase
Il faut en créer un dès qu'on utilise au moins l'un des deux dispositifs `Firestore` `Cloud Storage`. 
- possibilité d'importer / exporter les index et rules de Firestore,
- possibilité d'utiliser l'API Firebase Web (module `src/app/fssync.mjs` de l'application UI),
- utilisation des _emulators_ qui permettent de tester en local.

La console a cette URL : https://console.firebase.google.com/

A la création d'un projet il faut le lier au projet Google correspondant: les deux partagent le même _projectId_ `asocial-test1`. (processus flou à préciser).

## CLIs
Il y en a un pour Google `gcloud` et un pour Firebase `firebase`. Les deux sont nécessaires sur un poste de développement. Voir sur le Web leurs installations et documentation de leurs fonctions.

### `firebase`
Install de firebase CLI :
https://firebase.google.com/docs/cli?hl=fr#update-cli

    npm install -g firebase-tools
    firebase --help

Quelques commandes `firebase` souvent employées:

    // Pour se ré-authentifier quand il y a un problème d'authentification
    firebase login --reauth

    // Delete ALL collections
    firebase firestore:delete --all-collections -r -f

    // Déploiement / import des index et rules présents dans: 
    // `firestore.indexes.json  firestores.rules`
    firebase deploy --only firestore

    // Export des index
    firebase firestore:indexes > firestore.indexes.EXP.json

    // Emulators :
    firebase emulators:start
    firebase emulators:start --import=./emulators/bk1
    firebase emulators:export ./emulators/bk2 -f

### Utilisation et authentification `gcloud`
Page Web d'instruction: https://cloud.google.com/sdk/docs/install?hl=fr

#### NON utilisation de _Application Default Credentials_ (ADC)
ADC permet de s'authentifier pour pouvoir utiliser les librairies. Cette option (il y en a d'autres) est systématiquement mise en avant par Google pour sa _simplicité_ mais finalement pose bien des problèmes.

Les commandes principales sont les suivantes:
- login _temporaire_ sur un poste:
  `gcloud auth application-default login`
- révocation sur ce poste:
  `gcloud auth application-default revoke`

Ceci dépose un fichier `application_default_credentials.json`
- Linux, macOS dans: `$HOME/.config/gcloud/`
- Windows dans: `%APPDATA%\gcloud\`

##### Problèmes
L'authentification donnée sur LE poste est _temporaire_ : absolument n'importe quand, d'un test à l'autre, un message un peu abscons vient signaler un problème d'authentification. Il faut se souvenir qu'il suffit de relancer la commande ci-dessus.

**La librairie d'accès à Cloud storage ne se satisfait pas de cette authentification**, a minima pour la fonction indispensable `bucket.getSignedUrl` : celle-ci requiert une authentification par _service account_ dès lors ADC n'est plus une option de _simplicité_ mais d'ajout de complexité puisqu'il faut de toutes les façons gérer un service account.

En production ? Google dit que App Engine fait ce qu'il faut pour que ça marche tout seul. Voire, mais pour le service account requis pour créer un storage, les tests n'ont pas été concluants.

Et quand on n'utilise pas App Engine ? Il faut utiliser une clé de service account et la passer en variable d'environnement.

#### Solution : créer un _service account_
En fait comme vu ci-avant il y en a un pré-existant `asocial-test1@appspot.gserviceaccount.com`

Dans le détail de ce service l'onglet `KEYS` permet de créer une clé: en créer une (en JSON). Il en résulte un fichier `service_account.json` qu'il faut sauvegarder en lieu sûr et pas dans git: il contient une clé d'authentification utilisable en production. Cette clé,
- ne peut PAS être récupérée depuis la console Google,
- mais elle peut y être révoquée en cas de vol,
- en cas de perte, en créer une autre, révoquer la précédente et ne pas perdre la nouvelle.

Pour être authentifié il faut que la variable d'environnement `GOOGLE_APPLICATION_CREDENTIALS` en donne le path.

**Remarques:**
- il n'a pas été possible de donner le contenu de cette clé en paramètres lors de la création de l'objet d'accès à Firestore: `new Firestore(arg)` est censé accepter dans `arg` cette clé mais ça n'a jamais fonctionné, même quand le fichier `application_default_credentials.json` a été supprimé de `$HOME/.config/gcloud/`.
- il FAUT donc que le path de fichier figure dans la variable d'environnement `GOOGLE_APPLICATION_CREDENTIALS` au moment de l'exécution: ceci est fait dans `src/server.js` en récupérant le `service_account.json` dans le répertoire `./keys` (qui est ignoré par git).
- pour le déploiement, ce fichier fait partie des 4 à déployer séparément sur le serveur (voir plus avant).
- _pour information seulement_: il _semble_ que le contenu soit accepté par la création d'un accès au storage Google Cloud : dans `src/storage.mjs` le code qui l'utilise est commenté mais peut être réactivé si l'usage d'une variable d'environnement pouvait être supprimé. Mais l'intérêt est quasi nul puisque la génération d'une variable d'environnement dans `server.js` représente une ligne de code.

### Authentification `firebase`
L'API WEB de Firebase n'est PAS utilisé sur le serveur, c'est l'API Firestore pour `Node.js` qui l'est.

L'application UI utilise l'API Web de Firebase (la seule disponible en Web et de formalisme différent de celle de Google Firestore) pour gérer la synchronisation des mises à jour. En particulier les fonctions (dans le fichier `src/fssync.mjs`):
`getFirestore, connectFirestoreEmulator, doc, getDoc, onSnapshot`

L'objet `app` qui conditionne l'accès à l'API est initialisé par `const app = initializeApp(firebaseConfig)`.
- le paramètre `firebaseConfig` ci-dessus est un objet d'authentification qui a été transmis par le serveur afin de ne pas figurer en clair dans le source et sur git. Ce paramètre dépend bien sur du site de déploiement.

##### Obtention de `firebase_config.json`
- Console Firebase
- >>> en haut `Project Overview` >>> roue dentée >>> `Projet Settings`
- dans la page naviguer jusqu'au projet et le code à inclure (option `Config`) apparaît : `const firebaseConfig = { ...`
- le copier, le mettre en syntaxe JSON et le sauver sous le nom `firebase_config.json`, en sécurité hors de git. Il sera à mettre pour exécution dans `./keys`

### Authentification S3
Le provider de storage `S3Provider` a besoin d'un objet de configuration du type ci-dessous (celle de test avec `minio` comme fournisseur local S3):

    {
      credentials: {
        accessKeyId: 'access-asocial',
        secretAccessKey: 'secret-asocial'
      },
      endpoint: 'http://localhost:9000',
      region: 'us-east-1',
      forcePathStyle: true,
      signatureVersion: 'v4'
    }

Un fichier JSON nommé `s3_config.json` est recherché dans `./keys` (à côté des autres fichiers contenant des clés privées) afin de ne pas exposer les autorisations d'accès S3 dans un fichier disponible sur git.

## Emulators de Firebase
Cet utilitaire permet de travailler, en test, localement plutôt que dans une base / storage distant payant.

Pour tester de nouvelles fonctionnalités on peut certes tester en environnement sqlite / File-system : mais pour tester que la couche technique de base (dans `src/firestore.mjs src/storage.mjs` du serveur) offre bien des services identiques quelqu'en soit l'option choisie Firebase / SQL ou le provider de storage file-sytem / S3 / Google Cloud, il faut effectivement utiliser Firestore et Cloud Storage.

L'émulateur est lancé par:

    firebase emulators:start
    firebase emulators:start --import=./emulators/bk1

Dans le premier cas tout est vide. Dans le second cas on part d'un état importé depuis le folder `./emulators/bk1`

Tout reste en mémoire mais on peut exporter l'état en mémoire par:

    firebase emulators:export ./emulators/bk2 -f

**La console de l'emulator** est accessible par http://localhost:4000

Voir la page Web: https://jsmobiledev.com/article/firebase-emulator-guide/

**Attention**: Google mentionne _son_ emulator dans la page https://cloud.google.com/firestore/docs/emulator?hl=fr
- ça ne prend en compte que Firestore et pas Cloud Storage,
- l'usage n'a pas été couronné de succès.

A ce jour prendre celui de Firebase.

### Contraintes
- Firebase n'a pas implémenté _toutes_ les fonctionnalités. Il y a du code qui contourne ce problème dans `src/storage.mjs` :
  - la création du storage ne prend pas en compte l'option `cors` (`constructor de la class GcProvider`),
  - `getSignedUrl` n'est pas utilisable avec l'émulator : contournement dans `getUrl` et `putUrl`.
- en run-time le code tient compte du mode `emulator` qui est donné par un booléen dans `src/config.mjs`.
- dans l'application UI l'initialisation dans `src/app/fssync.mjs` méthode `open()` tient compte de l'existence de la variable d'environnement mode `STORAGE_EMULATOR_HOST` signalant l'utilisation de l'émulateur:
  - l'application UI obtient en retour de connexion d'une session (`src/fssync.mjs`), l'objet requis `firebaseConfig` et 'URL de l'emulator (ou rien si ce mode n'est pas activé).
  - auparavant l'usage par `PageLogin` de l'URL `./fs` a retourné 'true' ou 'false' selon que le serveur est en mode Firestore (true) ou non.

Sur le serveur deux variables d'environnement sont requises :
- `FIRESTORE_EMULATOR_HOST="localhost:8080"`
- `STORAGE_EMULATOR_HOST="http://127.0.0.1:9199"`

Attention pour la seconde, 
- le Web donne un autre nom: bien utiliser celui ci-dessus,
- `http://` est indispensable, sinon un accès `https` est essayé et échoue.

Ces deux variables sont générées en interne dans `src/server.js` quand ces variables sont citées dans la section `env` de `config.mjs` (ce qui évite de les gérer en test et de les exclure en production).

## BUGS rencontrés et contournés: `cors` `403`
Pour information, les fonctions de download / upload d'un fichier d'une note ont d'abord échoué en Google Cloud Storage : l'URL générée étant rejetée pour cause `same origin`.

Ce type de problème n'apparaît que dans une invocation dans un browser pour une page chargée depuis un site Web. En conséquence ça n'apparaît pas,
- en copiant directement une URL dans la barre d'adresse,
- en utilisant `curl`.

Il n'y a que le serveur qui puisse résoudre le problème.

Google Cloud Storage accepte à l'initialisation du storage un objet d'options `cors` qui spécifie de quelles origines les URLs sont acceptées. Par chance `'*'` a été accepté (sinon il aurait fallu passer en configuration une liste d'origines autorisées).

En mode `emulator`, cette option n'étant pas implémentée, il a fallu contourner dans `src/storage.mjs getUrl / putUrl` par en chargement / déchargement par le serveur (ce qui n'est ps un problème en test, mais en serait un en production).

Pour générer une URL signée, sur PUT, il faut spécifier le `content-type` des documents envoyés sur PUT. `application/octet-stream` fait l'affaire MAIS encore faut-il émettre ce `content-type` du côté application UI dans l'appel du PUT (`src/app/net.mjs`), ce qui n'avait pas été fait (laissé vide) et a provoqué une erreur `403` pas très représentative de la situation.

### Logs
Ils sont gérés par Winston: 
- sauf pour App engine `combined.log error.log` : le path est fixé dans `src/config.mjs >>> pathlogs` mais les noms sont en dur dans` src/server.js`.
- pour App Engine, c'est redirigé vers les logs de App Engine.

`firestore.debug.log ui-debug.log` sont des logs produits par emulator en DEV.

### Autres Fichiers apparaissant à la racine en DEV
- `firebase.json` : utilisé par emulator et les opérations CLI de Firebase.
- `firestore.indexes.json firestore.indexes.EXP.json firestore.rules` : index et rules de Firestore, utilisé par CLI Firebase pour les déployer en production.
- `app.yaml` : pour le déploiement sur App Engine.

### Folders spécifiquement utilisés en DEV
- `keys`
- `storage` : storage des providers `fs` (file_system)
- `sqlite`
  - `*.db3` : des bases de test.
  - `delete.sql` : script pour RAZ d'une base
  - `schema.sql` : script de création d'une base db3
  - `schema.EXP.sql` : script exporté depuis une base existante par la commande `sqlite3 test1.db3 '.schema' > schema.EXP.sql` dans le folder `sqlite`.

**Autres Fichiers apparaissant à la racine en DEV**
- `firebase.json` : utilisé par emulator et les opérations CLI de Firebase.
- `firestore.indexes.json firestore.indexes.EXP.json firestore.rules` : index et rules de Firestore, utilisé par CLI Firebase pour les déployer en production.
- `app.yaml` : pour le déploiement sur App Engine.

# Configuration du serveur dans `config.mjs et ./keys`
Ce fichier est un script exécutable ce qui facilte la gestion de plusieurs versions usuelles à partir d'un ou deux switch globaux. Il a plusieurs sections:

    export const config = {
      // Paramètres fonctionnels
      tarifs: [
        { am: 202201, cu: [0.45, 0.10, 80, 200, 15, 15] },
        { am: 202305, cu: [0.45, 0.10, 80, 200, 15, 15] },
        { am: 202309, cu: [0.45, 0.10, 80, 200, 15, 15] }
      ],

Injection des valeurs des compteurs tarifaires:
- une entrée par mois de changement dans l'ordre chronologique;
- pas de retour dans le passé s'une version à la suivante;
- les 6 compteurs unitaires applicables (en _centimes_).

      // HTTP server: configuration des paths des URL
      prefixop: '/op',
      prefixapp: '/app',
      pathapp: './app',
      prefixwww: '/www',
      pathwww: './www',
      pathlogs: '../logs',
      pathkeys: './keys',

Donne les valeurs des préfixes des URLs (qui n'ont pas besoin de change) et des paths physiques variables entre test et production.

Interprétation des URLs:   
- `prefixop: '/op'` : il n'y a pas de raisons de le changer.
- `prefixapp: '/app'` : commenter la ligne si le serveur ne doit pas servir les URLs statiques de l'application UI.

`pathapp: './app'`
- si le serveur sert aussi les pages de l'application UI, folder ou cette application est distribuée.

`prefixwww: '/www'`
- si le serveur sert aussi les pages statiques Web, préfixe des URLs correspondantes.

`pathwww: './www'`
- si le serveur sert aussi les pages statiques Web, folder ou ces pages résident.

`pathlogs: './logs'`
- path ou ranger les logs, sauf en déploiement GAE.

`pathkeys: './keys'`
- Le répertoire contenat les fichiers _secrets_ à ne pas publier dans git.

    keys: {
      app: 'app_keys.json',
      favicon: 'favicon.ico',
      pub: 'fullchain.pem',
      priv: 'privkey.pem',
      firebase_config: 'firebase_config.json',
      s3_config: 's3_config.json',
      service_account: 'service_account.json'
    }

Enumération des fichiers _secrets_ déployés dans `./keys` et leurs noms symboliques pour le reste de la configuration et le code.
- `pub priv`: le certificat SSL sauf en déploiement GAE et _passenger_.
- `service_acount` : indispensable pour Firestore et provider de storage `gc`.
- `firebase_config` : indispensable pour Firestore.
- `s3_config` : indispensable si le provider de storage est `s3`.
- `favicon.ico` : requis.

    env: {
      GOOGLE_CLOUD_PROJECT: 'asocial-test1',
      GOOGLE_APPLICATION_CREDENTIALS: '@service_account',
      STORAGE_EMULATOR_HOST: 'http://127.0.0.1:9199', // 'http://' est REQUIS
      FIRESTORE_EMULATOR_HOST: 'localhost:8080'
    }

Énumérations des variables d'environnement requises, nécessaires ou non selon le déploiement et / ou le test. Typiquement les variables `...EMULATOR...` ne sont pertinentes qu'en test.

`GOOGLE_CLOUD_PROJECT` : requis en usage Firestore / Google Cloud Storage mais ne gêne pas d'en mettre un dans les autres cas.

    run: {
      site: 'A',
      // URL externe d'appel du serveur 
      rooturl: 'https://test.sportes.fr:8443',
      // Port d'écoute si NON gae
      port: 8443,
      // Origines autorisées
      origins: [ 'localhost:8343' ],
      // Provider Storage
      storage_provider: 'fs_a',
      // Provider DB
      db_provider: 'sqlite_a',
    }

Configuration du serveur. N'est pas utilisé en exécution d'utilitaires.
- `site` : voir plus avant.
- les deux _providers_ donnent les noms des entrées décrivant leurs configurations respectives. Le nom avant _ spécifie la classe de provider et le suffixe donne sa section de configuration.

`rooturl: 'https://test.sportes.fr:8443'`
- L'URL d'appel du serveur. Est utilisée pour faire des liens d'upload / download de fichiers du provider de storage `fs` (et des autres en test / simulation).

`port: 8443`  
- Numéro de port d'écoute du serveur. En GAE ce paramètre est inutilisé (c'est la variable `process.env.PORT` qui le donne), en mode 'passenger' également, mais ça ne nuit pas d'en mettre un.

`origins: ['https://192.168.5.64:8343', 'https://test.sportes.fr:8443']`  
- Liste des origines autorisées. Si l'application UI est distribuée par le même serveur (déploiement GAE et mono serveur), la liste peut être vide et est remplie avec la combinaison `rooturl` et `port` (ou nod.ENV.port).

      s3_a: { bucket: 'asocial' },
      fs_a: { rootpath: '../fsstorage'},
      gc_a: {
        bucket: 'asocial-test1.appspot.com', // Pour emulator
        // bucket: 'asocial' // Pour prod, quoi que ...
      },

      sqlite_a: { path: './sqlite/test.db3' },
      firestore_a: { }
    }

Paramètres spécifiques de chaque type de _provider_:
- storage S3 : nom du buscket
- storage file-system: parh du folder racine
- storage google_cloud_storage: nom du bucket
- DB sqlite: path du fichiers .db3
- DB firestore: rien.

`admin:  ['tyn9fE7zr...=']`
- Hash du PBKFD de la phrase secrète de l'administrateur technique.

`ttlsessionMin: 60`
- durée de vie en minutes d'une session sans activité (mode SQL seulement).

`apitk: 'VldNo2aLLvXRm0Q'  `
- Jeton d'autorisation d'accès à l'API. Doit figurer à l'identique dans la configuration (`src/app/config.js` de l'aplication UI).

## `.keys/app_keys.json`
Ce fichier donne les clés secrètes déclarées par l'administrateur du site.

Mais riien n'interdit qu'il existe plusieurs _sites_, chacun ayant _son_ administrateur. Le code du site est donné localement par une lettre A, B, ...

`"admin":  ["FCp8r..."]`
- c'est le SHA du PBKFD de la phrase secrète de connexion de l'administrateur du site, son organisation étant `admin`. La page d'outils de l'application UI permet de déclarer une phrase secrète et en affiche ce SHA afin d'être inscrit ici.
- il n'y a que l'administrateur lui-même qui peut connaître la phrase qu'il a donnée por récupérer ce SHA.

`"sites": { "A": "YC...C0=",`
- chaque site a besoin d'une clé de cryptage qui crypte certaines données, par exemple les compteurs de comptabilité, plutôt que de les laisser en clair (certains traitements _seveur_ ont à accéder aux compteurs de tout le monde). C'est la seule clé de cryptage connue du serveur.
- elle a été générée depuis une phrase secrète.
- **elle ne doit pas changer** pour un site donné au cours de sa vie.

Mais il est possible d'exporter la base d'un site A et de l'importer dans un site B. Chaque row exporté est _décrypté_ par la clé de A et _crypté_ par celle de B.

Pour un transfert entre deux sites dont les administrateurs veulent garder leurs clés secrètes, ils doivent convenir d'un pseudo site de transfert T,
- A export de A vers T,
- B exporte de T vers B,
- A et B n'ont qu'à se mettre d'accord sur la clé du site T temporaire disparaissant après l'opération.

> Remarque: ce problème ne se pose pas pour les _storages_, les fichiers étant cryptés exclusivement par clés des utilisateurs.

    {
      "admin":  ["FCp8r..."],
      "sites":  {
        "A": "YC...C0=",
        "B": "FG...HBC0="
      },
      "apitk": "VldN...Rm0Q"
    }

### Rappel : variables d'environnement
Elles sont générées par `src/sever.js` en fonction de `src/config.mjs` : elles n'ont pas à être gérées extérieurement.

    FIRESTORE_EMULATOR_HOST="localhost:8080"
    STORAGE_EMULATOR_HOST="http://127.0.0.1:9199"
    GOOGLE_CLOUD_PROJECT="asocial-test1"
    GOOGLE_APPLICATION_CREDENTIALS="./config.service_account.json"

# Déploiements
Il existe deux déploiements _simples_:
- **Google App Engine** (GAE): un répertoire de déploiement est préparé et la commande `gcloud app deploy` effectue le déploiement sur le projet correspondant.
- **Mono serveur node** (MSN): un répertoire de déploiement est préparé puis est transféré sur le site récepteur par ftp typiquement.

Il est aussi possible d'avoir des **déploiements multi serveurs** pour l'application UI et des serveurs `Node.js` multiples.

### APITK
Une application _pirate_ lancée depuis un browser qui a chargé une page d'application UI _pirate_, va échouer à invoquer des opérations, son `origin` n'étant pas dans la liste des origines autorisées par le serveur.

Mais supposons une application _pirate_ en node.js qui reprend correctement le protocole :
- elle peut positionner un `header` `origin` avec la valeur attendue par le serveur,
- elle peut se connecter et exécuter des opérations normales mais en lui transmettant de mauvais arguments (puisqu'elle est _pirate_).

C'est pour ça qu'une _clé d'API_ `APITK` a été définie, et cachée autant que faire se peut: cette clé est fournie à chaque appel d'opération.

Cette clé est définie au déploiement et n'est donc pas exposée aux pirates.

Elle figure toutefois en runtime de l'application UI, donc est lisible quelque part en debug d'une application officielle. Encore faut-il savoir la trouver, ce qui a été rendu un peu complexe.

`APITK` se trouve:
- côté UI: dans `quasar.config.mjs` où la valeur de développement est remplacée par la valeur de production au déploiement par webpack.
- côté serveur: dans `./keys/app_keys.json`

## Déploiements simples: processus commun
Il est possible de déployer sur plusieurs projets GAE, chacun ayant alors son répertoire de déploiement dénommé ci-après %DEPL%.

**L'application UI %APP% doit être buildée:**
- ajuster `quasar.config.js`:
  - `APITK`
  - `BUILD` incrémentée pour la voir apparaître à l'écran pour contrôle de la bonne évolution de version.
- lancer la commande `npm run build:pwa` (ou `quasar build -m pwa`): ceci créé le folder `/dist/pwa` avec l'application compactée.

**L'application upload (folder %UPLOAD%) doit avoir été buildée.**
Il en résulte deux fichiers `upload upload.exe` à copier dans le répertoire `%DEPL%/www`. Lire son `README.md` pour quelques détails.

### Créer / ajuster le folder %DEPL%
Sa structure est la suivante:
- `/keys` : reçoit les fichiers de configuration.
- `/www` :
  - le fichier `index.html` est une redirection vers `/www/home.html`, la _vraie_ page d'entrée. (source: `%SRV%/www/index.html`).
  - `upload upload.exe` sont des liens symboliques vers `%UPLOAD%/dist/upload` et `%UPLOAD%/dist/upload.exe` 
  - les autres fichiers proviennent de `%DOC%` et y ont été copiés par un script local de `%DOC%`.
- `/app` : lien symbolique vers la distribution de l'application UI (`%APP%/dist/pwa`).

### Déploiement _Google App Engine_ (GAE)
C'est App Engine qui build l'application.

**Remarques importantes**
- le fichier `src/server.js` **DOIT** avoir une extension `.js`. Les imports dans les autres modules doivent donc être `import { ctx, ... } from './server.js'`
- dans `package.json`:
  - `"type": "module",` est **impératif**.
  - `"scripts": { "start": "node src/server.js" }` et pas de `"build": ...`.

Au pire, enlever les `"devDepencies"` de package.json selon le message d'erreur à propos de webpack émis par GAE.

Le fichier `src/config.mjs` est à adapter pour le déploiement GAE. En pratique, un seul flag en tête `true/false` permet de le passer du mode développement au mode GAE. A minima:
- `rooturl: 'asocial-test1.ew.r.appspot.com',` sinon les opérations entrantes sont refoulées.
- `origins: [ 'localhost:8343' ],` ne gêne pas, `rooturl` est ajouté à la liste des origines acceptées.

Le script `depl.sh` : il a pour obectif de ne recopier **que** les fichiers requis pour la production en évitant les parasites de développement. Il effectue:
- la recopie des fichiers de configuration `service_account.json` et `firebase_config.json` (et `favicon.ico`) dans `%DEPL%/keys`
- la recopie de `www/index.html` dans `%DEPL%/index.html`
- la recopie du folder `src` dans `%DEPL%/src`
- la recopie des deux fichiers `package.json app.yaml` dans `%DEPL%`.

Ouvrir un terminal dans `%DEPL%` et frapper la commande `gcloud app deploy --verbosity debug` : ça dure environ 2 minutes (pas la première fois qui beaucoup plus longue, jusqu'à 15 minutes). `verbosity` est facultatif.

Dans un autre terminal `gcloud app logs tail` permet de voir les logs de l'application quand ils vont survenir.

Les logs complets s'obtienne depuis la console Google du projet (menu hamburger en haut à gauche `>>> Logs >>> Logs Explorer`).

### Déploiement _mono serveur node_ (MON)
Il faut créer / ajuster le répertoire `%DEPL%` comme décrit ci-avant.

**Il faut effectuer un build de `%SRV%` :**
- dans `package.json`:
  - `"type": "module",` ne doit **PAS être présent** (le renommer `"typeX"`).
- commande de build `npx webpack`
- deux fichiers ont été créés dans `dist`: `app.js app.js.LICENSES.txt`
- dans `%DEPL%` faire un lien symbolique vers ces deux fichiers.

**Sur le Site distant** on doit trouver, hors du folder qui va recevoir le déploiement, par exemple dans le folder au-dessus:
- `../sqlite.db3` : le fichier de la base données. Dans `%SRV%/src/config.mjs` l'entrée `sqlite_a.path` pointe vers `../sqlite.db3'`;
- `../logs` : le folder des logs. Dans `%SRV%/src/config.mjs` l'entrée `pathslogs: '../logs'` doit pointer vers ce folder.

En résumé à titre d'exemple **sur le site distant**:

    asocial
      sqlite.db3
      logs/
      run/
        keys/ ...
        www/ ...
        app/ ...
        app.js
        app.js.LICENSES.txt

Il faut transférer par ftp le contenu du répertoire local `%DEPL%` dans le répertoire distant `asocial/run`.

Le serveur se lance dans `asocial/run` par `node app.js`

### Déploiement multi serveurs
Les trois composantes,
- instances d'application UI,
- instances d'applications serveur node,
- espace statique www,

sont gérées / déployées séparément.

Un server `nginx` gère autant de serveurs virtuels qu'il y a d'application UI:
- chacune est buildée avec un paramétrage spécifique;
- a minima dans `src/app/config.mjs` la variable `SRV` donne l'URL de **SON** serveur.

Il en résulte autant de builds et donc de déploiements à effectuer pour les applications UI.

Il faut également builder chaque instance d'application serveur:
- son PORT d'écoute (`src/config.mjs / port`) est différent. 
- `rooturl` _peut_ être limité au _host name_ si elle n'est pas utilisée par le provider de storage configuré.
- `origins` doit être configuré pour n'accepter les requêtes QUE de l'instance d'application UI spécifiée.

Il y a autant de serveurs `node` à lancer qu'il y a d'instances de serveurs définies.

Le déploiement demande en conséquence un script spécifique pour enchaîner sans risque d'erreurs les altérations de `config.mjs`, les builds (UI et serveur) et les recopies dans les folders de déploiement. 

Il faut aussi scripter les envois ftp aux bonnes localisations sur le(s) site(s) de production.
