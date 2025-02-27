# Déploiement GAE

Éditer dans asocial-srv/gae:
- keys.json
- config.mjs

        # Depuis git
        mkdir ./asocial-gae1
        mkdir ./asocial-gae1/dist
        mkdir ./asocial-gae1/src
        cd ./asocial-srv/gae
        ./depl.sh
        cd ../../asocial-gae1
        yarn install
        node src/gensecret.mjs
        npm run build

        # Run
        cd dist
        node main.js

Sur maj de sources

        ./depl.sh
        cd ../../asocial-gae1
        
        # SI keys.jon a été changé
        node src/gensecret.mjs

        npm run build

# Déployer
- dans src/config.mjs mettre EMULATOR à false
- npm run build


