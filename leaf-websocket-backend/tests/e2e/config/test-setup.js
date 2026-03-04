/**
 * Test Setup
 * 
 * Configuração global para todos os testes E2E
 */

// Timeout global para testes
jest.setTimeout(30000);

// Variáveis de ambiente de teste
process.env.NODE_ENV = 'test';
process.env.WS_URL = process.env.WS_URL || 'http://localhost:3001';
process.env.GEOFENCE_RADIUS_KM = '9999'; // Permite requisições de teste em qualquer lugar do mundo

// Suprimir logs durante testes (opcional)
if (process.env.SUPPRESS_LOGS === 'true') {
  global.console = {
    ...console,
    log: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  };
}

// Helpers globais
global.sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Cleanup após todos os testes
afterAll(async () => {
  // Aguardar um pouco para garantir que tudo foi limpo
  await new Promise(resolve => setTimeout(resolve, 1000));
});



