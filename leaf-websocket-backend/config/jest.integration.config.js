/**
 * Jest Configuration for Integration Tests
 *
 * Configuração otimizada para testes de integração do sistema LEAF
 */

module.exports = {
  // Root directory
  rootDir: '../',

  // Ambiente de teste
  testEnvironment: 'node',

  // Padrões de arquivos de teste de integração
  testMatch: [
    '<rootDir>/tests/integration/**/*.test.js',
    '<rootDir>/tests/integration/**/*.spec.js'
  ],

  // Setup files
  setupFilesAfterEnv: ['<rootDir>/tests/integration/config/test-setup.js'],

  // Timeout padrão (15 segundos para testes de integração)
  testTimeout: 15000,

  // Verbose output
  verbose: true,

  // Cobertura de código
  collectCoverage: true,
  coverageDirectory: 'coverage/integration',
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
    '/tests/e2e/',
    '/tests/unit/'
  ],

  // Mocks automáticos
  automock: false,

  // Transform (para ES6+)
  transform: {},

  // Globals
  globals: {
    'NODE_ENV': 'test'
  },

  // Máximo de workers (paralelização limitada para integração)
  maxWorkers: 2,

  // Bail on first failure
  bail: false,

  // Clear mocks entre testes
  clearMocks: true,

  // Reset mocks entre testes
  resetMocks: true,

  // Restore mocks entre testes
  restoreMocks: true,

  // Setup para testes de integração
  testEnvironmentOptions: {
    url: 'http://localhost:3001'
  },

  // Força testes sequenciais para evitar conflitos
  maxConcurrency: 1,

  // Detecta vazamentos de memória (desabilitado para desenvolvimento)
  detectOpenHandles: false,
  detectLeaks: false,

  // Força coleta de lixo entre testes
  forceExit: true
};
