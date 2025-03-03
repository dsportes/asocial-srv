#! /bin/bash
depl=$HOME/git/asocial-gae1
cp -f ../src/server.js $depl/src
cp -f ../src/storageGC.mjs $depl/src
cp -f ../src/dbFirestore.mjs $depl/src
cp -f ../src/api.mjs $depl/src
cp -f ../src/base64.mjs $depl/src
cp -f ../src/cfgexpress.mjs $depl/src
cp -f ../src/gendoc.mjs $depl/src
cp -f ../src/gensecret.mjs $depl/src
cp -f ../src/logger.mjs $depl/src
cp -f ../src/modele.mjs $depl/src
cp -f ../src/notif.mjs $depl/src
cp -f ../src/operations3.mjs $depl/src
cp -f ../src/operations4.mjs $depl/src
cp -f ../src/pubsub.js $depl/src
cp -f ../src/taches.mjs $depl/src
cp -f ../src/tools.mjs $depl/src
cp -f ../src/util.mjs $depl/src
cp -f ./config.mjs $depl/src
cp -f ./package.json $depl
cp -f ./app.yaml $depl
cp -f ./cron.yaml $depl
cp -f ./keys.json $depl
echo Copies faites
