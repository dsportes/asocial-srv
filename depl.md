# Scénario de déploiement
Préparer le folder de déploiement: asocial-gae1 (par exemple)

Y créer les folders src et node_modules.

  cd ./asocial-srv/gae
  ./depl.sh

  cd ../../asocial-gae1
  npm install
  # OUI npm, pas yarn, deploy utilise package-lock.json

  node src/gensecret.mjs
  # pour intégrer une éventuelle mise à jour de keys.json

npm install à deux fonctions:

    permettre d’effectuer un test final après déploiement,
    générer un package-lock.json qui accélère le déploiement ET fixe les versions exactes des modules.

# Tester localement

On peut tester le serveur avec: node src/server.js

MAIS ça s’exécuterait sur la base de production, c’est inopportun. Il faut donc:

    changer dans config.mjs la première ligne EMULATOR = true
    lancer l’emulator dans une autre fenêtre et l’initialiser avec des données de test d’intégration.

Après tests, changer à nouveau dans config.mjs la première ligne EMULATOR = false.

# Déployer depuis asocial-gae1

gcloud app deploy --verbosity debug --no-cache

no-cache : sinon plantage du build step 2 en cherchant à comparer avec une version antérieure.

Quelques minutes …, puis si nécessaire (si cron.yaml a changé par rapport à l’opérationnel):

gcloud app deploy cron.yaml

C’est rapide.

Dans un autre terminal gcloud app logs tail permet de voir les logs de l’application quand ils vont survenir.

Les logs complets s’obtienne depuis la console Google du projet (menu hamburger en haut à gauche >>> Logs >>> Logs Explorer).
