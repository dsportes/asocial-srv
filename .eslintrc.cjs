/* eslint-disable quotes */
module.exports = {
  "env": {
    "browser": true,
    "node": true,
    "commonjs": true,
    "es2021": true
  },
  "extends": [
    'eslint:recommended'
  ],
  "parserOptions": {
    parser: 'babel-eslint',
    ecmaVersion: 2022, // Allows for the parsing of modern ECMAScript features
    sourceType: 'module' // Allows for the use of imports
  },
  rules: {
    // allow async-await
    'generator-star-spacing': 'off',
    // allow paren-less arrow functions
    'arrow-parens': 'off',
    'one-var': 'off',
    'no-void': 'off',
    'multiline-ternary': 'off',

    'import/first': 'off',
    'import/extensions': 'off',
    'import/no-unresolved': 'off',
    'import/no-extraneous-dependencies': 'off',
    'prefer-promise-reject-errors': 'off',

    'indent': ['error', 2],
    'no-multiple-empty-lines': ['error', { 'max': 1 }],
    'lines-between-class-members': ['error', 'always'],
    'arrow-spacing': ['error', { "before": true, "after": true }],
    'prefer-const': ['error', { 'destructuring': 'any',  'ignoreReadBeforeAssign': false }],
    'quotes': ['error', 'single'],
    'eqeqeq': 'error'

  }
};
