const io = require('socket.io-client');
const fetch = require('node-fetch');

console.log('📊 TESTE DE MÉTRICAS - ARQUITETURA ATUAL');
console.log('========================================');

// Configurações de teste
const TEST_CONFIG = {
    concurrentUsers: 10,
    testDuration: 30000, // 30 segundos
    messageInterval: 1000, // 1 segundo entre mensagens
    locationUpdateInterval: 2000 // 2 segundos entre updates de localização
};

// Métricas coletadas
const metrics = {
    startTime: Date.now(),
    connections: [],
    messages: [],
    locationUpdates: [],
    errors: [],
    responseTimes: [],
    memoryUsage: [],
    cpuUsage: []
};

// Função para medir tempo de resposta
function measureResponseTime(operation, fn) {
    const start = Date.now();
    return fn().then(result => {
        const responseTime = Date.now() - start;
        metrics.responseTimes.push({
            operation,
            responseTime,
            timestamp: Date.now()
        });
        return result;
    });
}

// Teste 1: Métricas do servidor
async function testServerMetrics() {
    console.log('🔍 Testando métricas do servidor...');
    
    try {
        // Health check
        const healthStart = Date.now();
        const healthResponse = await fetch('http://localhost:3001/health');
        const healthData = await healthResponse.json();
        const healthTime = Date.now() - healthStart;
        
        console.log(`✅ Health Check: ${healthTime}ms`);
        metrics.responseTimes.push({
            operation: 'health_check',
            responseTime: healthTime,
            timestamp: Date.now()
        });
        
        // Stats endpoint (se existir)
        try {
            const statsStart = Date.now();
            const statsResponse = await fetch('http://localhost:3001/stats');
            const statsData = await statsResponse.json();
            const statsTime = Date.now() - statsStart;
            
            console.log(`✅ Stats Endpoint: ${statsTime}ms`);
            console.log('📊 Dados do servidor:', JSON.stringify(statsData, null, 2));
            
            metrics.responseTimes.push({
                operation: 'stats',
                responseTime: statsTime,
                timestamp: Date.now()
            });
        } catch (error) {
            console.log('⚠️ Stats endpoint não disponível:', error.message);
        }
        
        // Metrics endpoint (se existir)
        try {
            const metricsStart = Date.now();
            const metricsResponse = await fetch('http://localhost:3001/metrics');
            const metricsData = await metricsResponse.json();
            const metricsTime = Date.now() - metricsStart;
            
            console.log(`✅ Metrics Endpoint: ${metricsTime}ms`);
            console.log('📈 Métricas do sistema:', JSON.stringify(metricsData, null, 2));
            
            metrics.responseTimes.push({
                operation: 'metrics',
                responseTime: metricsTime,
                timestamp: Date.now()
            });
        } catch (error) {
            console.log('⚠️ Metrics endpoint não disponível:', error.message);
        }
        
    } catch (error) {
        console.log('❌ Erro ao testar métricas do servidor:', error.message);
        metrics.errors.push({
            type: 'server_metrics',
            error: error.message,
            timestamp: Date.now()
        });
    }
}

// Teste 2: Conexões WebSocket simultâneas
async function testConcurrentConnections() {
    console.log(`🔗 Testando ${TEST_CONFIG.concurrentUsers} conexões simultâneas...`);
    
    const connectionPromises = [];
    
    for (let i = 0; i < TEST_CONFIG.concurrentUsers; i++) {
        const userId = `test-user-${i}`;
        const socket = io('http://localhost:3001');
        
        const connectionPromise = new Promise((resolve) => {
            const connectionStart = Date.now();
            
            socket.on('connect', () => {
                const connectionTime = Date.now() - connectionStart;
                
                metrics.connections.push({
                    userId,
                    connectionTime,
                    socketId: socket.id,
                    timestamp: Date.now()
                });
                
                console.log(`✅ Usuário ${userId} conectado em ${connectionTime}ms`);
                
                // Autenticar
                socket.emit('authenticate', {
                    uid: userId,
                    token: 'test-token'
                });
                
                socket.on('authenticated', () => {
                    resolve({ socket, userId, connectionTime });
                });
                
                socket.on('auth_error', (error) => {
                    console.log(`❌ Erro de auth para ${userId}:`, error);
                    metrics.errors.push({
                        type: 'authentication',
                        userId,
                        error: error.message,
                        timestamp: Date.now()
                    });
                    resolve({ socket, userId, connectionTime, error });
                });
            });
            
            socket.on('error', (error) => {
                console.log(`❌ Erro de conexão para ${userId}:`, error);
                metrics.errors.push({
                    type: 'connection',
                    userId,
                    error: error.message,
                    timestamp: Date.now()
                });
                resolve({ socket, userId, connectionTime: -1, error });
            });
        });
        
        connectionPromises.push(connectionPromise);
    }
    
    const results = await Promise.all(connectionPromises);
    const successfulConnections = results.filter(r => !r.error);
    
    console.log(`📊 Conexões bem-sucedidas: ${successfulConnections.length}/${TEST_CONFIG.concurrentUsers}`);
    
    return successfulConnections;
}

// Teste 3: Throughput de mensagens
async function testMessageThroughput(connections) {
    console.log('💬 Testando throughput de mensagens...');
    
    const messagePromises = [];
    let messageCount = 0;
    
    connections.forEach(({ socket, userId }) => {
        const messageInterval = setInterval(() => {
            const messageStart = Date.now();
            messageCount++;
            
            socket.emit('sendMessage', {
                chatId: `test-chat-${userId}`,
                message: `Mensagem de teste ${messageCount} do usuário ${userId}`,
                userId: userId
            });
            
            socket.once('message_sent', (data) => {
                const messageTime = Date.now() - messageStart;
                
                metrics.messages.push({
                    userId,
                    messageId: messageCount,
                    responseTime: messageTime,
                    timestamp: Date.now()
                });
            });
            
            socket.once('error', (error) => {
                metrics.errors.push({
                    type: 'message',
                    userId,
                    error: error.message,
                    timestamp: Date.now()
                });
            });
            
        }, TEST_CONFIG.messageInterval);
        
        // Parar após 10 segundos
        setTimeout(() => {
            clearInterval(messageInterval);
        }, 10000);
    });
    
    // Aguardar 10 segundos
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    console.log(`📊 Total de mensagens enviadas: ${messageCount}`);
    console.log(`📊 Mensagens por segundo: ${(messageCount / 10).toFixed(2)}`);
}

// Teste 4: Throughput de atualizações de localização
async function testLocationUpdateThroughput(connections) {
    console.log('📍 Testando throughput de atualizações de localização...');
    
    let locationUpdateCount = 0;
    
    connections.forEach(({ socket, userId }) => {
        const locationInterval = setInterval(() => {
            const locationStart = Date.now();
            locationUpdateCount++;
            
            // Coordenadas aleatórias em São Paulo
            const lat = -23.5505 + (Math.random() - 0.5) * 0.1;
            const lng = -46.6333 + (Math.random() - 0.5) * 0.1;
            
            socket.emit('updateLocation', {
                lat: lat,
                lng: lng,
                userId: userId
            });
            
            socket.once('locationUpdated', (data) => {
                const locationTime = Date.now() - locationStart;
                
                metrics.locationUpdates.push({
                    userId,
                    updateId: locationUpdateCount,
                    responseTime: locationTime,
                    lat,
                    lng,
                    timestamp: Date.now()
                });
            });
            
            socket.once('error', (error) => {
                metrics.errors.push({
                    type: 'location_update',
                    userId,
                    error: error.message,
                    timestamp: Date.now()
                });
            });
            
        }, TEST_CONFIG.locationUpdateInterval);
        
        // Parar após 10 segundos
        setTimeout(() => {
            clearInterval(locationInterval);
        }, 10000);
    });
    
    // Aguardar 10 segundos
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    console.log(`📊 Total de atualizações de localização: ${locationUpdateCount}`);
    console.log(`📊 Updates por segundo: ${(locationUpdateCount / 10).toFixed(2)}`);
}

// Função para calcular estatísticas
function calculateStatistics() {
    const endTime = Date.now();
    const totalTime = endTime - metrics.startTime;
    
    // Estatísticas de tempo de resposta
    const responseTimes = metrics.responseTimes.map(r => r.responseTime);
    const avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
    const minResponseTime = Math.min(...responseTimes);
    const maxResponseTime = Math.max(...responseTimes);
    
    // Estatísticas de conexão
    const connectionTimes = metrics.connections.map(c => c.connectionTime);
    const avgConnectionTime = connectionTimes.reduce((a, b) => a + b, 0) / connectionTimes.length;
    
    // Estatísticas de mensagens
    const messageResponseTimes = metrics.messages.map(m => m.responseTime);
    const avgMessageTime = messageResponseTimes.reduce((a, b) => a + b, 0) / messageResponseTimes.length;
    
    // Estatísticas de localização
    const locationResponseTimes = metrics.locationUpdates.map(l => l.responseTime);
    const avgLocationTime = locationResponseTimes.reduce((a, b) => a + b, 0) / locationResponseTimes.length;
    
    return {
        totalTime,
        connections: {
            total: metrics.connections.length,
            avgConnectionTime: avgConnectionTime.toFixed(2),
            minConnectionTime: Math.min(...connectionTimes),
            maxConnectionTime: Math.max(...connectionTimes)
        },
        messages: {
            total: metrics.messages.length,
            avgResponseTime: avgMessageTime.toFixed(2),
            messagesPerSecond: (metrics.messages.length / (totalTime / 1000)).toFixed(2)
        },
        locationUpdates: {
            total: metrics.locationUpdates.length,
            avgResponseTime: avgLocationTime.toFixed(2),
            updatesPerSecond: (metrics.locationUpdates.length / (totalTime / 1000)).toFixed(2)
        },
        responseTimes: {
            avg: avgResponseTime.toFixed(2),
            min: minResponseTime,
            max: maxResponseTime
        },
        errors: {
            total: metrics.errors.length,
            byType: metrics.errors.reduce((acc, error) => {
                acc[error.type] = (acc[error.type] || 0) + 1;
                return acc;
            }, {})
        }
    };
}

// Função principal
async function runMetricsTest() {
    console.log('🚀 Iniciando teste de métricas...');
    console.log(`⏱️ Duração: ${TEST_CONFIG.testDuration / 1000} segundos`);
    console.log(`👥 Usuários simultâneos: ${TEST_CONFIG.concurrentUsers}`);
    
    try {
        // Teste 1: Métricas do servidor
        await testServerMetrics();
        
        // Teste 2: Conexões simultâneas
        const connections = await testConcurrentConnections();
        
        if (connections.length === 0) {
            console.log('❌ Nenhuma conexão bem-sucedida. Abortando testes.');
            return;
        }
        
        // Teste 3: Throughput de mensagens
        await testMessageThroughput(connections);
        
        // Teste 4: Throughput de localização
        await testLocationUpdateThroughput(connections);
        
        // Desconectar todas as conexões
        connections.forEach(({ socket }) => {
            socket.disconnect();
        });
        
        // Calcular e exibir estatísticas
        const stats = calculateStatistics();
        
        console.log('\n📊 RESULTADOS DAS MÉTRICAS:');
        console.log('==========================');
        console.log(`⏱️ Tempo total: ${(stats.totalTime / 1000).toFixed(2)}s`);
        console.log(`🔗 Conexões: ${stats.connections.total}`);
        console.log(`   - Tempo médio de conexão: ${stats.connections.avgConnectionTime}ms`);
        console.log(`   - Tempo mínimo: ${stats.connections.minConnectionTime}ms`);
        console.log(`   - Tempo máximo: ${stats.connections.maxConnectionTime}ms`);
        console.log(`💬 Mensagens: ${stats.messages.total}`);
        console.log(`   - Tempo médio de resposta: ${stats.messages.avgResponseTime}ms`);
        console.log(`   - Mensagens por segundo: ${stats.messages.messagesPerSecond}`);
        console.log(`📍 Atualizações de localização: ${stats.locationUpdates.total}`);
        console.log(`   - Tempo médio de resposta: ${stats.locationUpdates.avgResponseTime}ms`);
        console.log(`   - Updates por segundo: ${stats.locationUpdates.updatesPerSecond}`);
        console.log(`⚡ Tempo médio de resposta geral: ${stats.responseTimes.avg}ms`);
        console.log(`❌ Erros: ${stats.errors.total}`);
        
        if (stats.errors.total > 0) {
            console.log('   - Por tipo:', JSON.stringify(stats.errors.byType, null, 2));
        }
        
        console.log('\n🎯 AVALIAÇÃO DE PERFORMANCE:');
        console.log('============================');
        
        if (stats.connections.avgConnectionTime < 100) {
            console.log('✅ Conexões: EXCELENTE (< 100ms)');
        } else if (stats.connections.avgConnectionTime < 500) {
            console.log('✅ Conexões: BOM (< 500ms)');
        } else {
            console.log('⚠️ Conexões: LENTO (> 500ms)');
        }
        
        if (stats.messages.avgResponseTime < 50) {
            console.log('✅ Mensagens: EXCELENTE (< 50ms)');
        } else if (stats.messages.avgResponseTime < 200) {
            console.log('✅ Mensagens: BOM (< 200ms)');
        } else {
            console.log('⚠️ Mensagens: LENTO (> 200ms)');
        }
        
        if (stats.locationUpdates.avgResponseTime < 50) {
            console.log('✅ Localização: EXCELENTE (< 50ms)');
        } else if (stats.locationUpdates.avgResponseTime < 200) {
            console.log('✅ Localização: BOM (< 200ms)');
        } else {
            console.log('⚠️ Localização: LENTO (> 200ms)');
        }
        
        if (stats.errors.total === 0) {
            console.log('✅ Estabilidade: PERFEITA (0 erros)');
        } else if (stats.errors.total < stats.connections.total * 0.1) {
            console.log('✅ Estabilidade: BOA (< 10% de erros)');
        } else {
            console.log('⚠️ Estabilidade: PROBLEMAS (> 10% de erros)');
        }
        
    } catch (error) {
        console.log('❌ Erro durante o teste:', error);
    }
}

// Executar teste
runMetricsTest();





