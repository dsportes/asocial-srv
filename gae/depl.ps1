$depl = "D:/git/asocial-gae1"
Copy-Item -Path "../src/server.js" -Destination $depl/src/
Copy-Item -Path "../src/storageGC.mjs" -Destination $depl/src/
Copy-Item -Path "../src/dbFirestore.mjs" -Destination $depl/src/
Copy-Item -Path "../src/api.mjs" -Destination $depl/src/
Copy-Item -Path "../src/base64.mjs" -Destination $depl/src/
Copy-Item -Path "../src/cfgexpress.mjs" -Destination $depl/src/
Copy-Item -Path "../src/gendoc.mjs" -Destination $depl/src/
Copy-Item -Path "../src/gensecret.mjs" -Destination $depl/src/
Copy-Item -Path "../src/logger.mjs" -Destination $depl/src/
Copy-Item -Path "../src/modele.mjs" -Destination $depl/src/
Copy-Item -Path "../src/notif.mjs" -Destination $depl/src/
Copy-Item -Path "../src/operations3.mjs" -Destination $depl/src/
Copy-Item -Path "../src/operations4.mjs" -Destination $depl/src/
Copy-Item -Path "../src/pubsub.js" -Destination $depl/src/
Copy-Item -Path "../src/taches.mjs" -Destination $depl/src/
Copy-Item -Path "../src/tools.mjs" -Destination $depl/src/
Copy-Item -Path "../src/util.mjs" -Destination $depl/src/
Copy-Item -Path "./config.mjs" -Destination $depl/src/
Copy-Item -Path "./package.json" -Destination $depl/
Copy-Item -Path "./app.yaml" -Destination $depl/
Copy-Item -Path "./cron.yaml" -Destination $depl/
Copy-Item -Path "./keys.json" -Destination $depl/
Write-Output "Copies faites"