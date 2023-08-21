#! /bin/bash
d=$HOME/git/depl/d2
cp -f config/service_account.json $d/config
cp -f config/firebase_config.json $d/config
cp -r -f www $d
cp -r -f src $d
cp -f app.yaml $d/
cp -f package.json $d/
