// const path = require('path')
// module.exports = {
import path from 'path'
export default {
  entry: './src/server.js',
  target: 'node',
  mode: 'production', // 'development' ou 'production'
  output: {
    filename: 'app.js',
    path: path.resolve('dist'),
  },
  externals: {
    // 'better-sqlite3': 'commonjs better-sqlite3'
    /* Avec cette directive, app.js N'EST PLUS AUTONOME
    Il lui faut node_modules (au moins une partie).
    DONC IL FAUT obtenir better-sqlite3 par require()
    */
  }
}
