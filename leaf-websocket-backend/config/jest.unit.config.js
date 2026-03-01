/**
 * Jest Configuration for Unit Tests
 *
 * Configuração otimizada para testes unitários do sistema LEAF
 */

module.exports = {
  // Root directory
  rootDir: '../',

  // Ambiente de teste
  testEnvironment: 'node',

  // Padrões de arquivos de teste unitários
  testMatch: [
    '<rootDir>/tests/unit/**/*.test.js',
    '<rootDir>/tests/unit/**/*.spec.js'
  ],

  // Setup files
  setupFilesAfterEnv: ['<rootDir>/tests/unit/config/test-setup.js'],

  // Timeout padrão (5 segundos para testes unitários)
  testTimeout: 5000,

  // Verbose output
  verbose: true,

  // Cobertura de código
  collectCoverage: true,
  coverageDirectory: 'coverage/unit',
  coverageReporters: ['text', 'lcov', 'html', 'json'],
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/tests/',
    '/coverage/',
    '/config/',
    '/scripts/'
  ],

  // Módulos a ignorar
  modulePathIgnorePatterns: [
    '/node_modules/',
    '/coverage/',
    '/tests/e2e/'
  ],

  // Transform ignore patterns - permitir apenas alguns módulos específicos
  transformIgnorePatterns: [
    'node_modules/(?!(uuid|winston|express|socket.io|ioredis)/)'
  ],

  // Mocks automáticos
  automock: false,

  // Transform (para ES6+)
  transform: {},

  // Globals
  globals: {
    'NODE_ENV': 'test'
  },

  // Máximo de workers (paralelização)
  maxWorkers: '50%',

  // Bail on first failure
  bail: false,

  // Clear mocks entre testes
  clearMocks: true,

  // Reset mocks entre testes
  resetMocks: true,

  // Restore mocks entre testes
  restoreMocks: true,

  // Módulos externos para mock
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^uuid$': '<rootDir>/tests/unit/__mocks__/uuid.js'
  },

  // Setup para testes
  testEnvironmentOptions: {
    url: 'http://localhost:3001'
  }
};
