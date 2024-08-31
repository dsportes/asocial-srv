import path from 'path'
export default {
  entry: './src/tools.mjs', // server.js pubsub.js tools.mjs
  target: 'node',
  mode: 'production', // 'development' ou 'production'
  output: {
    filename: 'tools.js', // op.js pubsub.js srv.js tools.js
    path: path.resolve('dist/tools') // dist/srv dist/op dist/pubsub dist/tools
  }
}

/*
  Avec cette directive (sous output), on pourrait faire un 
  import de better-sqlite3 plutôt qu'un require
  MAIS alors app.js N'EST PLUS AUTONOME
  Il lui faut node_modules (au moins une partie).
  DONC IL FAUT obtenir better-sqlite3 par require()

  externals: { 'better-sqlite3': 'commonjs better-sqlite3' }

*/

