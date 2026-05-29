/**
 * Test Setup
 * 
 * Configuração global para todos os testes E2E
 */

// Timeout global para testes
jest.setTimeout(30000);

// Variáveis de ambiente de teste
process.env.NODE_ENV = 'test';
process.env.WS_URL = process.env.WS_URL || 'https://socket.leaf.app.br';
process.env.API_BASE_URL = process.env.API_BASE_URL || 'https://api.leaf.app.br';
process.env.E2E_REMOTE_SSH_HOST = process.env.E2E_REMOTE_SSH_HOST || 'api.leaf.app.br';
process.env.E2E_REMOTE_SSH_USER = process.env.E2E_REMOTE_SSH_USER || 'root';
process.env.GEOFENCE_RADIUS_KM = '9999'; // Permite requisições de teste em qualquer lugar do mundo
process.env.REDIS_DISABLE_RECONNECT = 'true';

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
