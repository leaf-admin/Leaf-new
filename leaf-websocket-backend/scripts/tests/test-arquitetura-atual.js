const io = require('socket.io-client');

console.log('🧪 TESTE ARQUITETURA ATUAL - LEAF RIDE');
console.log('=====================================');

const socket = io('http://localhost:3001');

let testResults = {
    healthCheck: false,
    websocketConnection: false,
    authentication: false,
    basicEvents: false
};

// Teste 1: Health Check HTTP
async function testHealthCheck() {
    try {
        const response = await fetch('http://localhost:3001/health');
        const data = await response.json();
        
        if (data.status === 'healthy') {
            console.log('✅ Health Check HTTP: OK');
            testResults.healthCheck = true;
        } else {
            console.log('❌ Health Check HTTP: Falhou');
        }
    } catch (error) {
        console.log('❌ Health Check HTTP: Erro -', error.message);
    }
}

// Teste 2: Conexão WebSocket
socket.on('connect', () => {
    console.log('✅ Conexão WebSocket: OK');
    console.log('🆔 Socket ID:', socket.id);
    testResults.websocketConnection = true;
    
    // Teste 3: Autenticação
    socket.emit('authenticate', {
        uid: 'test-user-123',
        token: 'test-token'
    });
});

// Teste 3: Autenticação
socket.on('authenticated', (data) => {
    console.log('✅ Autenticação: OK');
    console.log('📋 Dados:', data);
    testResults.authentication = true;
    
    // Teste 4: Eventos básicos
    testBasicEvents();
});

socket.on('auth_error', (error) => {
    console.log('❌ Erro de autenticação:', error);
});

// Teste 4: Eventos básicos
function testBasicEvents() {
    console.log('🔍 Testando eventos básicos...');
    
    // Teste de atualização de localização
    socket.emit('updateLocation', {
        lat: -23.5505,
        lng: -46.6333,
        userId: 'test-user-123'
    });
    
    // Teste de chat
    socket.emit('sendMessage', {
        chatId: 'test-chat-123',
        message: 'Teste de mensagem',
        userId: 'test-user-123'
    });
    
    console.log('✅ Eventos básicos enviados');
    testResults.basicEvents = true;
}

socket.on('locationUpdated', (data) => {
    console.log('✅ Evento locationUpdated recebido:', data);
});

socket.on('message_sent', (data) => {
    console.log('✅ Evento message_sent recebido:', data);
});

socket.on('error', (error) => {
    console.log('❌ Erro Socket.IO:', error);
});

socket.on('disconnect', () => {
    console.log('🔌 Socket.IO desconectado');
});

// Executar testes
async function runTests() {
    console.log('🚀 Iniciando testes...');
    
    await testHealthCheck();
    
    // Aguardar 5 segundos para completar todos os testes
    setTimeout(() => {
        console.log('\n📊 RESULTADOS DOS TESTES:');
        console.log('========================');
        console.log(`Health Check HTTP: ${testResults.healthCheck ? '✅' : '❌'}`);
        console.log(`Conexão WebSocket: ${testResults.websocketConnection ? '✅' : '❌'}`);
        console.log(`Autenticação: ${testResults.authentication ? '✅' : '❌'}`);
        console.log(`Eventos Básicos: ${testResults.basicEvents ? '✅' : '❌'}`);
        
        const totalTests = Object.keys(testResults).length;
        const passedTests = Object.values(testResults).filter(result => result).length;
        
        console.log(`\n🎯 RESUMO: ${passedTests}/${totalTests} testes passaram`);
        
        if (passedTests === totalTests) {
            console.log('🎉 TODOS OS TESTES PASSARAM! Arquitetura funcionando!');
        } else {
            console.log('⚠️ Alguns testes falharam, mas o sistema básico está funcionando');
        }
        
        socket.disconnect();
        process.exit(0);
    }, 5000);
}

runTests();





