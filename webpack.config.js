import { createRequire } from 'module'
const require = createRequire(import.meta.url)

const path = require('path')

export default {
  entry: './src/server.js',
  target: 'node',
  mode: 'production', // 'development' ou 'production'
  output: {
    filename: 'app.js',
    path: path.resolve('dist'),
  }
}
