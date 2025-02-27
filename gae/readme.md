# Déploiement GAE

Éditer dans asocial-srv/gae:
- keys.json
        - supprimer l'entrée s3_config
- config.mjs
        - première ligne: EMULATOR = false
        - vérifier dans le run http/port db_provider storage_provider

### REMARQUE IMPORTANTE
Le fichier gae/package.json **DOIT** avoir `"type: "module"`

# Depuis git

        mkdir ./asocial-gae1
        mkdir ./asocial-gae1/dist
        mkdir ./asocial-gae1/src

        cd ./asocial-srv/gae
        ./depl.sh

        cd ../../asocial-gae1
        npm install     
        # OUI npm, pas yarn, deploy utilise package-lock.json
        node src/gensecret.mjs 
        # OUI pour intégrer une éventuelle mise à jour de keys.json

On peut tester avec: 

        node src/server.js

Sur maj de sources

        ./depl.sh
        cd ../../asocial-gae1
        
        # SI keys.jon a été changé
        node src/gensecret.mjs

# Déployer depuis asocial-gae1

        gcloud app deploy --verbosity debug

Dans un autre terminal `gcloud app logs tail` permet de voir les logs de l'application quand ils vont survenir.

Les logs complets s'obtienne depuis la console Google du projet (menu hamburger en haut à gauche `>>> Logs >>> Logs Explorer`).
