const path = require('path')
// const WebpackObfuscator = require('webpack-obfuscator');

module.exports = {
  entry: './src/server.mjs',
  target: 'node',
  mode: 'production', // 'development' ou 'production'
  output: {
    filename: 'app.js',
    path: path.resolve(__dirname, 'dist'),
  }
  /*
  ,
  // webpack plugins array
  plugins: [
    new WebpackObfuscator ({
      rotateStringArray: true
    } //, ['excluded_bundle_name.js']
    )
  ]
  */
}
