const { io } = require('socket.io-client');
const Redis = require('ioredis');

// Configurações de teste
const TEST_CONFIG = {
    websocketUrl: 'http://localhost:3001',
    redisUrl: 'redis://localhost:6379',
    testUserId: 'test_user_123',
    testDriverId: 'test_driver_456'
};

// Cliente Redis para testes
let redisClient;
let socketClient;

// Função para limpar dados de teste
async function cleanupTestData() {
    try {
        // Limpar tokens FCM de teste
        await redisClient.del(`fcm_tokens:${TEST_CONFIG.testUserId}`);
        await redisClient.del(`fcm_tokens:${TEST_CONFIG.testDriverId}`);
        
        // Remover da lista de tokens ativos
        await redisClient.srem('active_fcm_tokens', 'test_fcm_token_123');
        await redisClient.srem('active_fcm_tokens', 'test_fcm_token_456');
        
        console.log('🧹 Dados de teste FCM limpos');
    } catch (error) {
        console.error('❌ Erro ao limpar dados de teste:', error);
    }
}

// Função para criar dados de teste
async function createTestData() {
    try {
        // Criar token FCM de teste para passageiro
        const passengerTokenData = {
            userId: TEST_CONFIG.testUserId,
            userType: 'passenger',
            fcmToken: 'test_fcm_token_123',
            deviceInfo: { platform: 'ios', version: '1.0.0' },
            lastUpdated: new Date().toISOString(),
            isActive: true
        };

        await redisClient.hset(
            `fcm_tokens:${TEST_CONFIG.testUserId}`,
            'test_fcm_token_123',
            JSON.stringify(passengerTokenData)
        );

        // Criar token FCM de teste para motorista
        const driverTokenData = {
            userId: TEST_CONFIG.testDriverId,
            userType: 'driver',
            fcmToken: 'test_fcm_token_456',
            deviceInfo: { platform: 'android', version: '1.0.0' },
            lastUpdated: new Date().toISOString(),
            isActive: true
        };

        await redisClient.hset(
            `fcm_tokens:${TEST_CONFIG.testUserId}`,
            'test_fcm_token_456',
            JSON.stringify(driverTokenData)
        );

        // Adicionar à lista de tokens ativos
        await redisClient.sadd('active_fcm_tokens', 'test_fcm_token_123');
        await redisClient.sadd('active_fcm_tokens', 'test_fcm_token_456');

        console.log('✅ Dados de teste FCM criados');
    } catch (error) {
        console.error('❌ Erro ao criar dados de teste:', error);
    }
}

// Teste 1: Verificar se o serviço FCM está funcionando
async function testFCMServiceStatus() {
    console.log('\n🧪 Teste 1: Status do Serviço FCM');
    
    try {
        // Conectar ao WebSocket
        socketClient = io(TEST_CONFIG.websocketUrl);
        
        await new Promise((resolve, reject) => {
            socketClient.on('connect', () => {
                console.log('✅ Conectado ao WebSocket');
                resolve();
            });
            
            socketClient.on('connect_error', (error) => {
                reject(error);
            });
            
            setTimeout(() => reject(new Error('Timeout de conexão')), 5000);
        });

        // Emitir evento para verificar status FCM
        socketClient.emit('getFCMStatus');
        
        const status = await new Promise((resolve, reject) => {
            socketClient.on('fcmStatus', (data) => {
                resolve(data);
            });
            
            setTimeout(() => reject(new Error('Timeout de resposta FCM')), 5000);
        });

        console.log('📊 Status FCM:', status);
        
        if (status && status.isServiceAvailable !== undefined) {
            console.log('✅ Serviço FCM respondendo corretamente');
            return true;
        } else {
            console.log('⚠️ Serviço FCM com resposta inesperada');
            return false;
        }

    } catch (error) {
        console.error('❌ Erro no teste de status FCM:', error);
        return false;
    }
}

// Teste 2: Testar envio de notificação de viagem
async function testTripNotification() {
    console.log('\n🧪 Teste 2: Notificação de Viagem');
    
    try {
        const tripData = {
            id: 'test_trip_789',
            passengerId: TEST_CONFIG.testUserId,
            driverId: TEST_CONFIG.testDriverId,
            pickup: 'Rua Teste, 123',
            destination: 'Rua Destino, 456',
            status: 'driver_found'
        };

        // Emitir evento para enviar notificação de viagem
        socketClient.emit('sendTripNotification', {
            userId: TEST_CONFIG.testUserId,
            tripData,
            notificationType: 'driver_found'
        });

        const result = await new Promise((resolve, reject) => {
            socketClient.on('tripNotificationSent', (data) => {
                resolve(data);
            });
            
            setTimeout(() => reject(new Error('Timeout de notificação de viagem')), 5000);
        });

        console.log('📤 Resultado da notificação de viagem:', result);
        
        if (result && result.success) {
            console.log('✅ Notificação de viagem enviada com sucesso');
            return true;
        } else {
            console.log('❌ Falha ao enviar notificação de viagem:', result?.error);
            return false;
        }

    } catch (error) {
        console.error('❌ Erro no teste de notificação de viagem:', error);
        return false;
    }
}

// Teste 3: Testar envio de notificação de avaliação
async function testRatingNotification() {
    console.log('\n🧪 Teste 3: Notificação de Avaliação');
    
    try {
        const ratingData = {
            id: 'test_rating_101',
            tripId: 'test_trip_789',
            rating: 5,
            comment: 'Excelente serviço!',
            userType: 'passenger'
        };

        // Emitir evento para enviar notificação de avaliação
        socketClient.emit('sendRatingNotification', {
            userId: TEST_CONFIG.testDriverId,
            ratingData
        });

        const result = await new Promise((resolve, reject) => {
            socketClient.on('ratingNotificationSent', (data) => {
                resolve(data);
            });
            
            setTimeout(() => reject(new Error('Timeout de notificação de avaliação')), 5000);
        });

        console.log('📤 Resultado da notificação de avaliação:', result);
        
        if (result && result.success) {
            console.log('✅ Notificação de avaliação enviada com sucesso');
            return true;
        } else {
            console.log('❌ Falha ao enviar notificação de avaliação:', result?.error);
            return false;
        }

    } catch (error) {
        console.error('❌ Erro no teste de notificação de avaliação:', error);
        return false;
    }
}

// Teste 4: Testar gerenciamento de tokens FCM
async function testFCMTokenManagement() {
    console.log('\n🧪 Teste 4: Gerenciamento de Tokens FCM');
    
    try {
        // Verificar se os tokens de teste existem
        const passengerTokens = await redisClient.hgetall(`fcm_tokens:${TEST_CONFIG.testUserId}`);
        const driverTokens = await redisClient.hgetall(`fcm_tokens:${TEST_CONFIG.testDriverId}`);
        
        console.log('📱 Tokens do passageiro:', Object.keys(passengerTokens));
        console.log('📱 Tokens do motorista:', Object.keys(driverTokens));
        
        // Verificar lista de tokens ativos
        const activeTokens = await redisClient.smembers('active_fcm_tokens');
        console.log('📱 Tokens ativos:', activeTokens);
        
        if (Object.keys(passengerTokens).length > 0 && Object.keys(driverTokens).length > 0) {
            console.log('✅ Tokens FCM gerenciados corretamente');
            return true;
        } else {
            console.log('❌ Falha no gerenciamento de tokens FCM');
            return false;
        }

    } catch (error) {
        console.error('❌ Erro no teste de gerenciamento de tokens:', error);
        return false;
    }
}

// Teste 5: Testar rate limiting
async function testRateLimiting() {
    console.log('\n🧪 Teste 5: Rate Limiting');
    
    try {
        const notification = {
            title: 'Teste Rate Limit',
            body: 'Testando limite de notificações',
            data: { type: 'test' }
        };

        let successCount = 0;
        let rateLimitedCount = 0;
        
        // Tentar enviar múltiplas notificações rapidamente
        for (let i = 0; i < 15; i++) {
            try {
                socketClient.emit('sendNotification', {
                    userId: TEST_CONFIG.testUserId,
                    notification
                });
                
                const result = await new Promise((resolve, reject) => {
                    socketClient.on('notificationSent', (data) => {
                        resolve(data);
                    });
                    
                    socketClient.on('rateLimitExceeded', (data) => {
                        resolve({ success: false, error: 'Rate limit exceeded' });
                    });
                    
                    setTimeout(() => reject(new Error('Timeout')), 2000);
                });
                
                if (result.success) {
                    successCount++;
                } else if (result.error === 'Rate limit exceeded') {
                    rateLimitedCount++;
                }
                
                // Pequena pausa entre envios
                await new Promise(resolve => setTimeout(resolve, 100));
                
            } catch (error) {
                console.log(`Tentativa ${i + 1} falhou:`, error.message);
            }
        }
        
        console.log(`📊 Resultado do rate limiting: ${successCount} sucessos, ${rateLimitedCount} rate limited`);
        
        if (rateLimitedCount > 0) {
            console.log('✅ Rate limiting funcionando corretamente');
            return true;
        } else {
            console.log('⚠️ Rate limiting não ativado');
            return false;
        }

    } catch (error) {
        console.error('❌ Erro no teste de rate limiting:', error);
        return false;
    }
}

// Função principal de teste
async function runFCMTests() {
    console.log('🚀 Iniciando testes do sistema FCM...\n');
    
    try {
        // Conectar ao Redis
        redisClient = new Redis(TEST_CONFIG.redisUrl);
        console.log('✅ Conectado ao Redis');
        
        // Limpar dados anteriores
        await cleanupTestData();
        
        // Criar dados de teste
        await createTestData();
        
        // Executar testes
        const results = [];
        
        results.push(await testFCMServiceStatus());
        results.push(await testTripNotification());
        results.push(await testRatingNotification());
        results.push(await testFCMTokenManagement());
        results.push(await testRateLimiting());
        
        // Resumo dos resultados
        const passedTests = results.filter(r => r === true).length;
        const totalTests = results.length;
        
        console.log('\n📊 RESUMO DOS TESTES FCM:');
        console.log(`✅ Testes aprovados: ${passedTests}/${totalTests}`);
        console.log(`❌ Testes falharam: ${totalTests - passedTests}/${totalTests}`);
        
        if (passedTests === totalTests) {
            console.log('🎉 Todos os testes FCM passaram!');
        } else {
            console.log('⚠️ Alguns testes FCM falharam');
        }
        
        return passedTests === totalTests;
        
    } catch (error) {
        console.error('❌ Erro geral nos testes FCM:', error);
        return false;
    } finally {
        // Cleanup
        if (redisClient) {
            await redisClient.disconnect();
        }
        
        if (socketClient) {
            socketClient.disconnect();
        }
        
        console.log('🧹 Conexões fechadas');
    }
}

// Executar testes se chamado diretamente
if (require.main === module) {
    runFCMTests()
        .then(success => {
            process.exit(success ? 0 : 1);
        })
        .catch(error => {
            console.error('❌ Erro fatal nos testes:', error);
            process.exit(1);
        });
}

module.exports = {
    runFCMTests,
    cleanupTestData,
    createTestData
};
