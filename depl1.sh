#! /bin/bash
d=$HOME/git/depl/d1
# cp -f config/service_account.json $d/config
# cp -f config/firebase_config.json $d/config
cp -f config/fullchain.pem $d/config
cp -f config/privkey.pem $d/config
cp -r -f www $d
