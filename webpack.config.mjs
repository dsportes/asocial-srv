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
  }
}

/*
module: {
  rules: [
    {
      test: /\.js$/,
      loader: require.resolve('@open-wc/webpack-import-meta-loader'),
    },
    {
      test: /\.(js|jsx|mjs)$/i,
      loader: 'babel-loader',
    }
  ]
}
*/
