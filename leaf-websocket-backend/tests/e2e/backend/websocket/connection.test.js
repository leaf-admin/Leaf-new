/**
 * Teste E2E: Integração WebSocket
 * 
 * Testa conexão, autenticação e reconexão do WebSocket
 */

const WebSocketTestClient = require('../__helpers__/websocket-test-client');
const testData = require('../__fixtures__/test-data');

describe('Integração WebSocket', () => {
  const WS_URL = process.env.WS_URL || 'http://localhost:3001';
  
  test('deve conectar ao servidor WebSocket', async () => {
    const client = new WebSocketTestClient(WS_URL);
    
    await client.connect();
    
    expect(client.connected).toBe(true);
    expect(client.getSocketId()).toBeDefined();
    
    client.disconnect();
  }, 10000);
  
  test('deve autenticar passageiro', async () => {
    const client = new WebSocketTestClient(WS_URL);
    
    await client.connect();
    const authResponse = await client.authenticate(
      testData.users.customer.uid,
      testData.users.customer.userType
    );
    
    expect(client.authenticated).toBe(true);
    expect(authResponse).toBeDefined();
    
    client.disconnect();
  }, 10000);
  
  test('deve autenticar motorista', async () => {
    const client = new WebSocketTestClient(WS_URL);
    
    await client.connect();
    const authResponse = await client.authenticate(
      testData.users.driver.uid,
      testData.users.driver.userType
    );
    
    expect(client.authenticated).toBe(true);
    expect(authResponse).toBeDefined();
    
    client.disconnect();
  }, 10000);
  
  test('deve receber eventos em tempo real', async () => {
    const client = new WebSocketTestClient(WS_URL);
    
    await client.connect();
    await client.authenticate(
      testData.users.customer.uid,
      testData.users.customer.userType
    );
    
    // Criar booking
    const bookingData = testData.booking.createBookingData();
    const bookingResponse = await client.createBooking(bookingData);
    
    expect(bookingResponse.success).toBe(true);
    expect(client.hasReceivedEvent('bookingCreated')).toBe(true);
    
    client.disconnect();
  }, 15000);
  
  test('deve reconectar automaticamente após desconexão', async () => {
    const client = new WebSocketTestClient(WS_URL, {
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 3
    });
    
    await client.connect();
    await client.authenticate(
      testData.users.customer.uid,
      testData.users.customer.userType
    );
    
    const socketId1 = client.getSocketId();
    
    // Desconectar
    client.disconnect();
    
    // Reconectar
    await client.connect();
    const socketId2 = client.getSocketId();
    
    // Socket ID deve ser diferente após reconexão
    expect(socketId1).not.toBe(socketId2);
    
    client.disconnect();
  }, 20000);
});



