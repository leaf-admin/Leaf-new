const axios = require('axios');
const io = require('socket.io-client');

const LOAD_BALANCER_URL = 'http://localhost:8080';
const NUM_REQUESTS = 10;
const NUM_WEBSOCKETS = 5;

console.log('⚖️ TESTE NGINX LOAD BALANCER');
console.log('============================');

async function testLoadBalancer() {
    console.log('🔍 Testando Health Check através do Load Balancer...');
    
    for (let i = 0; i < NUM_REQUESTS; i++) {
        try {
            const response = await axios.get(`${LOAD_BALANCER_URL}/health`, { timeout: 5000 });
            console.log(`✅ Request ${i + 1}: ${response.data.instanceId} (${response.data.port})`);
        } catch (error) {
            console.log(`❌ Request ${i + 1}: ${error.message}`);
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log('\n🔌 Testando WebSocket através do Load Balancer...');
    
    const sockets = [];
    for (let i = 0; i < NUM_WEBSOCKETS; i++) {
        const socket = io(`${LOAD_BALANCER_URL}`, {
            transports: ['websocket'],
            auth: { uid: `test-user-${i}`, token: `mock-token-${i}`, userType: 'passenger' }
        });
        sockets.push(socket);
        
        socket.on('connect', () => {
            console.log(`✅ WebSocket ${i + 1}: Conectado (${socket.id})`);
        });
        
        socket.on('connect_error', (err) => {
            console.log(`❌ WebSocket ${i + 1}: ${err.message}`);
        });
    }
    
    // Aguardar conexões
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Fechar conexões
    sockets.forEach(socket => socket.disconnect());
    
    console.log('\n📊 Teste do Load Balancer concluído!');
}

testLoadBalancer().catch(console.error);
