import path from 'path'
export default {
  entry: './src/server.js', // server.js pubsub.js tools.mjs
  target: 'node',
  mode: 'production', // 'development' ou 'production'
  output: {
    filename: 'main.js', // op.js pubsub.js srv.js tools.js
    path: path.resolve('dist') // dist/srv dist/op dist/pubsub dist/tools
  }
}
