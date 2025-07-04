module.exports = {
  root: true,
  env: {
    es6: true,
    node: true,
  },
  extends: [
    'eslint:recommended',
  ],
  rules: {
    'quotes': ['error', 'single', { 'avoidEscape': true }],
    'max-len': ['error', { 'code': 200 }],
    'no-unused-vars': 'warn',
    'no-console': 'off'
  },
  parserOptions: {
    ecmaVersion: 2018,
  },
}; 