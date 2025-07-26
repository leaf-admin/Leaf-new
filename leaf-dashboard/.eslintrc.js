module.exports = {
  extends: [
    'react-app',
    'react-app/jest'
  ],
  rules: {
    '@typescript-eslint/no-unused-vars': 'warn',
    'no-console': 'warn'
  },
  settings: {
    react: {
      version: 'detect'
    }
  },
  ignorePatterns: [
    '*.css',
    '*.scss',
    '*.less',
    'build/',
    'dist/',
    'node_modules/'
  ]
}; 