const path = require('path')
module.exports = {
// import path from 'path'
// export default {
  entry: './src/server.mjs',
  target: 'node',
  mode: 'production', // 'development' ou 'production'
  output: {
    filename: 'app.js',
    path: path.resolve('dist'),
  }
}
