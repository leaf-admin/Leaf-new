const io = require('socket.io-client');
const fetch = require('node-fetch');

console.log('📊 TESTE DE PERFORMANCE - ARQUITETURA ATUAL');
console.log('===========================================');

// Métricas coletadas
const performanceMetrics = {
    startTime: Date.now(),
    httpRequests: [],
    websocketConnections: [],
    authenticationTests: [],
    locationUpdates: [],
    chatMessages: [],
    errors: []
};

// Teste 1: Performance HTTP
async function testHTTPPerformance() {
    console.log('🌐 Testando performance HTTP...');
    
    const endpoints = [
        { name: 'health', url: '/health' },
        { name: 'metrics', url: '/metrics' }
    ];
    
    for (const endpoint of endpoints) {
        for (let i = 0; i < 5; i++) {
            try {
                const start = Date.now();
                const response = await fetch(`http://localhost:3001${endpoint.url}`);
                const end = Date.now();
                
                const responseTime = end - start;
                const status = response.status;
                
                performanceMetrics.httpRequests.push({
                    endpoint: endpoint.name,
                    responseTime,
                    status,
                    timestamp: Date.now()
                });
                
                console.log(`✅ ${endpoint.name}: ${responseTime}ms (${status})`);
                
            } catch (error) {
                performanceMetrics.errors.push({
                    type: 'http',
                    endpoint: endpoint.name,
                    error: error.message,
                    timestamp: Date.now()
                });
                console.log(`❌ ${endpoint.name}: ${error.message}`);
            }
        }
    }
}

// Teste 2: Performance WebSocket - Conexões
async function testWebSocketConnections() {
    console.log('🔗 Testando performance de conexões WebSocket...');
    
    const connectionPromises = [];
    
    for (let i = 0; i < 5; i++) {
        const userId = `perf-user-${i}`;
        const socket = io('http://localhost:3001');
        
        const connectionPromise = new Promise((resolve) => {
            const start = Date.now();
            
            socket.on('connect', () => {
                const connectionTime = Date.now() - start;
                
                performanceMetrics.websocketConnections.push({
                    userId,
                    connectionTime,
                    socketId: socket.id,
                    timestamp: Date.now()
                });
                
                console.log(`✅ ${userId}: ${connectionTime}ms`);
                resolve({ socket, userId, connectionTime });
            });
            
            socket.on('error', (error) => {
                performanceMetrics.errors.push({
                    type: 'websocket_connection',
                    userId,
                    error: error.message,
                    timestamp: Date.now()
                });
                console.log(`❌ ${userId}: ${error.message}`);
                resolve({ socket, userId, connectionTime: -1, error });
            });
        });
        
        connectionPromises.push(connectionPromise);
    }
    
    const results = await Promise.all(connectionPromises);
    return results.filter(r => !r.error);
}

// Teste 3: Performance de Autenticação
async function testAuthenticationPerformance(connections) {
    console.log('🔐 Testando performance de autenticação...');
    
    const authPromises = connections.map(({ socket, userId }) => {
        return new Promise((resolve) => {
            const start = Date.now();
            
            socket.emit('authenticate', {
                uid: userId,
                token: 'test-token'
            });
            
            socket.once('authenticated', (data) => {
                const authTime = Date.now() - start;
                
                performanceMetrics.authenticationTests.push({
                    userId,
                    authTime,
                    success: true,
                    timestamp: Date.now()
                });
                
                console.log(`✅ Auth ${userId}: ${authTime}ms`);
                resolve({ userId, authTime, success: true });
            });
            
            socket.once('auth_error', (error) => {
                const authTime = Date.now() - start;
                
                performanceMetrics.authenticationTests.push({
                    userId,
                    authTime,
                    success: false,
                    error: error.message,
                    timestamp: Date.now()
                });
                
                performanceMetrics.errors.push({
                    type: 'authentication',
                    userId,
                    error: error.message,
                    timestamp: Date.now()
                });
                
                console.log(`❌ Auth ${userId}: ${authTime}ms - ${error.message}`);
                resolve({ userId, authTime, success: false });
            });
        });
    });
    
    await Promise.all(authPromises);
}

// Teste 4: Performance de Atualizações de Localização
async function testLocationUpdatePerformance(connections) {
    console.log('📍 Testando performance de atualizações de localização...');
    
    const locationPromises = connections.map(({ socket, userId }) => {
        return new Promise((resolve) => {
            const start = Date.now();
            
            socket.emit('updateLocation', {
                lat: -23.5505 + (Math.random() - 0.5) * 0.01,
                lng: -46.6333 + (Math.random() - 0.5) * 0.01,
                userId: userId
            });
            
            socket.once('locationUpdated', (data) => {
                const locationTime = Date.now() - start;
                
                performanceMetrics.locationUpdates.push({
                    userId,
                    locationTime,
                    success: true,
                    timestamp: Date.now()
                });
                
                console.log(`✅ Location ${userId}: ${locationTime}ms`);
                resolve({ userId, locationTime, success: true });
            });
            
            socket.once('error', (error) => {
                const locationTime = Date.now() - start;
                
                performanceMetrics.locationUpdates.push({
                    userId,
                    locationTime,
                    success: false,
                    error: error.message,
                    timestamp: Date.now()
                });
                
                performanceMetrics.errors.push({
                    type: 'location_update',
                    userId,
                    error: error.message,
                    timestamp: Date.now()
                });
                
                console.log(`❌ Location ${userId}: ${locationTime}ms - ${error.message}`);
                resolve({ userId, locationTime, success: false });
            });
        });
    });
    
    await Promise.all(locationPromises);
}

// Teste 5: Performance de Mensagens de Chat
async function testChatPerformance(connections) {
    console.log('💬 Testando performance de mensagens de chat...');
    
    const chatPromises = connections.map(({ socket, userId }) => {
        return new Promise((resolve) => {
            const start = Date.now();
            
            socket.emit('sendMessage', {
                chatId: `perf-chat-${userId}`,
                message: `Mensagem de performance do usuário ${userId}`,
                userId: userId
            });
            
            socket.once('message_sent', (data) => {
                const chatTime = Date.now() - start;
                
                performanceMetrics.chatMessages.push({
                    userId,
                    chatTime,
                    success: true,
                    timestamp: Date.now()
                });
                
                console.log(`✅ Chat ${userId}: ${chatTime}ms`);
                resolve({ userId, chatTime, success: true });
            });
            
            socket.once('error', (error) => {
                const chatTime = Date.now() - start;
                
                performanceMetrics.chatMessages.push({
                    userId,
                    chatTime,
                    success: false,
                    error: error.message,
                    timestamp: Date.now()
                });
                
                performanceMetrics.errors.push({
                    type: 'chat_message',
                    userId,
                    error: error.message,
                    timestamp: Date.now()
                });
                
                console.log(`❌ Chat ${userId}: ${chatTime}ms - ${error.message}`);
                resolve({ userId, chatTime, success: false });
            });
        });
    });
    
    await Promise.all(chatPromises);
}

// Função para calcular estatísticas de performance
function calculatePerformanceStats() {
    const endTime = Date.now();
    const totalTime = endTime - performanceMetrics.startTime;
    
    // Estatísticas HTTP
    const httpTimes = performanceMetrics.httpRequests.map(r => r.responseTime);
    const httpStats = {
        total: httpTimes.length,
        avg: httpTimes.length > 0 ? (httpTimes.reduce((a, b) => a + b, 0) / httpTimes.length).toFixed(2) : 0,
        min: httpTimes.length > 0 ? Math.min(...httpTimes) : 0,
        max: httpTimes.length > 0 ? Math.max(...httpTimes) : 0
    };
    
    // Estatísticas WebSocket
    const wsTimes = performanceMetrics.websocketConnections.map(c => c.connectionTime);
    const wsStats = {
        total: wsTimes.length,
        avg: wsTimes.length > 0 ? (wsTimes.reduce((a, b) => a + b, 0) / wsTimes.length).toFixed(2) : 0,
        min: wsTimes.length > 0 ? Math.min(...wsTimes) : 0,
        max: wsTimes.length > 0 ? Math.max(...wsTimes) : 0
    };
    
    // Estatísticas de Autenticação
    const authTimes = performanceMetrics.authenticationTests.filter(a => a.success).map(a => a.authTime);
    const authStats = {
        total: performanceMetrics.authenticationTests.length,
        successful: authTimes.length,
        avg: authTimes.length > 0 ? (authTimes.reduce((a, b) => a + b, 0) / authTimes.length).toFixed(2) : 0,
        min: authTimes.length > 0 ? Math.min(...authTimes) : 0,
        max: authTimes.length > 0 ? Math.max(...authTimes) : 0
    };
    
    // Estatísticas de Localização
    const locationTimes = performanceMetrics.locationUpdates.filter(l => l.success).map(l => l.locationTime);
    const locationStats = {
        total: performanceMetrics.locationUpdates.length,
        successful: locationTimes.length,
        avg: locationTimes.length > 0 ? (locationTimes.reduce((a, b) => a + b, 0) / locationTimes.length).toFixed(2) : 0,
        min: locationTimes.length > 0 ? Math.min(...locationTimes) : 0,
        max: locationTimes.length > 0 ? Math.max(...locationTimes) : 0
    };
    
    // Estatísticas de Chat
    const chatTimes = performanceMetrics.chatMessages.filter(c => c.success).map(c => c.chatTime);
    const chatStats = {
        total: performanceMetrics.chatMessages.length,
        successful: chatTimes.length,
        avg: chatTimes.length > 0 ? (chatTimes.reduce((a, b) => a + b, 0) / chatTimes.length).toFixed(2) : 0,
        min: chatTimes.length > 0 ? Math.min(...chatTimes) : 0,
        max: chatTimes.length > 0 ? Math.max(...chatTimes) : 0
    };
    
    // Estatísticas de Erros
    const errorStats = {
        total: performanceMetrics.errors.length,
        byType: performanceMetrics.errors.reduce((acc, error) => {
            acc[error.type] = (acc[error.type] || 0) + 1;
            return acc;
        }, {})
    };
    
    return {
        totalTime: (totalTime / 1000).toFixed(2),
        http: httpStats,
        websocket: wsStats,
        authentication: authStats,
        location: locationStats,
        chat: chatStats,
        errors: errorStats
    };
}

// Função principal
async function runPerformanceTest() {
    console.log('🚀 Iniciando teste de performance...');
    
    try {
        // Teste 1: Performance HTTP
        await testHTTPPerformance();
        
        // Teste 2: Conexões WebSocket
        const connections = await testWebSocketConnections();
        
        if (connections.length === 0) {
            console.log('❌ Nenhuma conexão WebSocket bem-sucedida.');
            return;
        }
        
        // Teste 3: Performance de Autenticação
        await testAuthenticationPerformance(connections);
        
        // Teste 4: Performance de Localização
        await testLocationUpdatePerformance(connections);
        
        // Teste 5: Performance de Chat
        await testChatPerformance(connections);
        
        // Desconectar todas as conexões
        connections.forEach(({ socket }) => {
            socket.disconnect();
        });
        
        // Calcular e exibir estatísticas
        const stats = calculatePerformanceStats();
        
        console.log('\n📊 RESULTADOS DE PERFORMANCE:');
        console.log('=============================');
        console.log(`⏱️ Tempo total: ${stats.totalTime}s`);
        console.log(`🌐 HTTP Requests: ${stats.http.total}`);
        console.log(`   - Tempo médio: ${stats.http.avg}ms`);
        console.log(`   - Tempo mínimo: ${stats.http.min}ms`);
        console.log(`   - Tempo máximo: ${stats.http.max}ms`);
        console.log(`🔗 WebSocket Connections: ${stats.websocket.total}`);
        console.log(`   - Tempo médio: ${stats.websocket.avg}ms`);
        console.log(`   - Tempo mínimo: ${stats.websocket.min}ms`);
        console.log(`   - Tempo máximo: ${stats.websocket.max}ms`);
        console.log(`🔐 Autenticação: ${stats.authentication.successful}/${stats.authentication.total}`);
        console.log(`   - Tempo médio: ${stats.authentication.avg}ms`);
        console.log(`   - Tempo mínimo: ${stats.authentication.min}ms`);
        console.log(`   - Tempo máximo: ${stats.authentication.max}ms`);
        console.log(`📍 Localização: ${stats.location.successful}/${stats.location.total}`);
        console.log(`   - Tempo médio: ${stats.location.avg}ms`);
        console.log(`   - Tempo mínimo: ${stats.location.min}ms`);
        console.log(`   - Tempo máximo: ${stats.location.max}ms`);
        console.log(`💬 Chat: ${stats.chat.successful}/${stats.chat.total}`);
        console.log(`   - Tempo médio: ${stats.chat.avg}ms`);
        console.log(`   - Tempo mínimo: ${stats.chat.min}ms`);
        console.log(`   - Tempo máximo: ${stats.chat.max}ms`);
        console.log(`❌ Erros: ${stats.errors.total}`);
        
        if (stats.errors.total > 0) {
            console.log('   - Por tipo:', JSON.stringify(stats.errors.byType, null, 2));
        }
        
        console.log('\n🎯 AVALIAÇÃO DE PERFORMANCE:');
        console.log('============================');
        
        // Avaliação HTTP
        if (stats.http.avg < 50) {
            console.log('✅ HTTP: EXCELENTE (< 50ms)');
        } else if (stats.http.avg < 200) {
            console.log('✅ HTTP: BOM (< 200ms)');
        } else {
            console.log('⚠️ HTTP: LENTO (> 200ms)');
        }
        
        // Avaliação WebSocket
        if (stats.websocket.avg < 100) {
            console.log('✅ WebSocket: EXCELENTE (< 100ms)');
        } else if (stats.websocket.avg < 500) {
            console.log('✅ WebSocket: BOM (< 500ms)');
        } else {
            console.log('⚠️ WebSocket: LENTO (> 500ms)');
        }
        
        // Avaliação Autenticação
        if (stats.authentication.avg < 100) {
            console.log('✅ Autenticação: EXCELENTE (< 100ms)');
        } else if (stats.authentication.avg < 500) {
            console.log('✅ Autenticação: BOM (< 500ms)');
        } else {
            console.log('⚠️ Autenticação: LENTO (> 500ms)');
        }
        
        // Avaliação Localização
        if (stats.location.avg < 50) {
            console.log('✅ Localização: EXCELENTE (< 50ms)');
        } else if (stats.location.avg < 200) {
            console.log('✅ Localização: BOM (< 200ms)');
        } else {
            console.log('⚠️ Localização: LENTO (> 200ms)');
        }
        
        // Avaliação Chat
        if (stats.chat.avg < 50) {
            console.log('✅ Chat: EXCELENTE (< 50ms)');
        } else if (stats.chat.avg < 200) {
            console.log('✅ Chat: BOM (< 200ms)');
        } else {
            console.log('⚠️ Chat: LENTO (> 200ms)');
        }
        
        // Avaliação Geral
        const successRate = (
            (stats.authentication.successful + stats.location.successful + stats.chat.successful) /
            (stats.authentication.total + stats.location.total + stats.chat.total)
        ) * 100;
        
        if (successRate > 90) {
            console.log('✅ Estabilidade: EXCELENTE (> 90%)');
        } else if (successRate > 70) {
            console.log('✅ Estabilidade: BOA (> 70%)');
        } else {
            console.log('⚠️ Estabilidade: PROBLEMAS (< 70%)');
        }
        
        console.log(`📈 Taxa de sucesso geral: ${successRate.toFixed(1)}%`);
        
    } catch (error) {
        console.log('❌ Erro durante o teste de performance:', error);
    }
}

// Executar teste
runPerformanceTest();





