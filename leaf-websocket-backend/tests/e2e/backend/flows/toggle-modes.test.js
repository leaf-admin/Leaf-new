/**
 * Teste E2E: Toggle entre Modos
 * 
 * Testa alternância entre modos passageiro e motorista
 */

const WebSocketTestClient = require('../__helpers__/websocket-test-client');
const testData = require('../__fixtures__/test-data');

describe('Toggle entre Modos', () => {
  let client;
  
  const WS_URL = process.env.WS_URL || 'http://localhost:3001';
  
  beforeEach(async () => {
    client = new WebSocketTestClient(WS_URL);
    await client.connect();
  });
  
  afterEach(() => {
    if (client) client.disconnect();
  });
  
  test('deve alternar de passageiro para motorista', async () => {
    // Autenticar como passageiro
    await client.authenticate(
      testData.users.customer.uid,
      testData.users.customer.userType
    );
    
    expect(client.authenticated).toBe(true);
    expect(client.userType).toBe('customer');
    
    // Desconectar e reconectar como motorista
    client.disconnect();
    await client.connect();
    
    await client.authenticate(
      testData.users.driver.uid,
      testData.users.driver.userType
    );
    
    expect(client.authenticated).toBe(true);
    expect(client.userType).toBe('driver');
  }, 20000);
  
  test('deve alternar de motorista para passageiro', async () => {
    // Autenticar como motorista
    await client.authenticate(
      testData.users.driver.uid,
      testData.users.driver.userType
    );
    
    expect(client.authenticated).toBe(true);
    expect(client.userType).toBe('driver');
    
    // Desconectar e reconectar como passageiro
    client.disconnect();
    await client.connect();
    
    await client.authenticate(
      testData.users.customer.uid,
      testData.users.customer.userType
    );
    
    expect(client.authenticated).toBe(true);
    expect(client.userType).toBe('customer');
  }, 20000);
  
  test('deve limpar estado ao alternar modos', async () => {
    // Autenticar como passageiro e criar booking
    await client.authenticate(
      testData.users.customer.uid,
      testData.users.customer.userType
    );
    
    const bookingData = testData.booking.createBookingData();
    const bookingResponse = await client.createBooking(bookingData);
    
    expect(bookingResponse.success).toBe(true);
    expect(client.hasReceivedEvent('bookingCreated')).toBe(true);
    
    // Limpar eventos
    client.clearEvents();
    
    // Alternar para motorista
    client.disconnect();
    await client.connect();
    
    await client.authenticate(
      testData.users.driver.uid,
      testData.users.driver.userType
    );
    
    // Verificar que eventos anteriores foram limpos
    expect(client.hasReceivedEvent('bookingCreated')).toBe(false);
  }, 20000);
});



