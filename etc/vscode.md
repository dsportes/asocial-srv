# VsCode

## Configuration de debug

    {
      // Use IntelliSense to learn about possible attributes.
      // Hover to view descriptions of existing attributes.
      // For more information, visit: https://go.microsoft.com/fwlink/?linkid=830387
      "version": "0.2.0",
      "configurations": [
        {
          "type": "chrome",
          "request": "launch",
          "name": "Quasar App: chrome",
          "url": "https://localhost:8343",
          "webRoot": "${workspaceFolder}/src",
          "sourceMapPathOverrides": {
            "webpack://asocial/./src/*": "${webRoot}/*"
          }
        },
        {
          "type": "firefox",
          "request": "launch",
          "name": "Quasar App: firefox",
          "url": "https://localhost:8343",
          "webRoot": "${workspaceFolder}/src",
          "pathMappings": [
            {
              "url": "webpack://asocial/src",
              "path": "${workspaceFolder}/src"
            }
          ]
        }
      ]
    }

## Test local / debug des GCP Functions
Auto-Attach: With Flag

Lancer en debug: `npm run debug`

    "debug" : "node --inspect node_modules/.bin/functions-framework --port=8443 --target=asocialGCF"

Lancer SANS debug: `npm run start`

    "start": "functions-framework --port=8443 --target=asocialGCF --signature-type=http"

.vscode/launch.json - Pas certain que ça serve, à revérifier

    {
      "version": "0.2.0",
      "configurations": [
        {
          "type": "node",
          "request": "attach",
          "name": "debug",
          "address": "localhost",
          "port": 9229
        }
      ]
    }

**Différence importante** pour le POST des opérations
Dans `cfgexpress.mjs` - `app.use('/op:operation ...)`
- Mode SRV: `req.rawBody` n'existe pas. On le construit depuis `req.on`
- Mode GCF: `req.rawBody` existe mais pas `req.on`
