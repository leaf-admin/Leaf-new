/**
 * Jest Configuration for E2E Tests
 * 
 * Configuração otimizada para testes End-to-End do sistema LEAF
 */

module.exports = {
  // Configurar raiz do projeto
  rootDir: '../',
  // Ambiente de teste
  testEnvironment: 'node',

  // Padrões de arquivos de teste
  testMatch: [
    '**/tests/e2e/**/*.test.js',
    '**/tests/e2e/**/*.spec.js'
  ],

  // Setup files
  setupFilesAfterEnv: ['<rootDir>/tests/e2e/config/test-setup.js'],

  // Timeout padrão (30 segundos para testes E2E)
  testTimeout: 30000,

  // Verbose output
  verbose: true,

  // Cobertura de código
  collectCoverage: true,
  coverageDirectory: 'coverage/e2e',
  coverageReporters: ['text', 'lcov', 'html', 'json'],
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/tests/',
    '/coverage/',
    '/config/'
  ],

  // Módulos a ignorar
  modulePathIgnorePatterns: [
    '/node_modules/',
    '/coverage/'
  ],

  // Transform (se necessário para ES6+)
  transform: {},

  // Globals
  globals: {
    'NODE_ENV': 'test'
  },

  // Máximo de workers (paralelização) - Desabilitar para evitar conflitos
  maxWorkers: 1,

  // Bail on first failure (opcional - desabilitado para ver todos os erros)
  bail: false,

  // Clear mocks entre testes
  clearMocks: true,

  // Reset mocks entre testes
  resetMocks: true,

  // Restore mocks entre testes
  restoreMocks: true
};

