#!/usr/bin/env node

/**
 * Script para enviar notificação de teste para o app
 * Uso: node test-send-notification.js [userId]
 */

const FCMService = require('./services/fcm-service');
const Redis = require('ioredis');

async function sendTestNotification() {
    try {
        console.log('🔔 Enviando notificação de teste...\n');
        
        // Obter userId do argumento ou usar padrão
        const userId = process.argv[2] || 'test-user-dev';
        
        console.log(`📱 Enviando para usuário: ${userId}`);
        
        // Inicializar FCM Service
        const fcmService = new FCMService();
        await fcmService.initialize();
        
        // Verificar se o usuário tem token FCM
        const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
        
        console.log('🔍 Verificando tokens FCM no Redis...\n');
        
        // Verificar em múltiplas chaves possíveis
        let fcmToken = null;
        let tokenSource = null;
        
        // 1. Verificar em driver:userId -> fcmToken
        const driverToken = await redis.hget(`driver:${userId}`, 'fcmToken');
        if (driverToken) {
            fcmToken = driverToken;
            tokenSource = `driver:${userId}`;
            console.log(`✅ Token encontrado em driver:${userId}`);
        }
        
        // 2. Verificar em user:userId -> fcmToken
        if (!fcmToken) {
            const userToken = await redis.hget(`user:${userId}`, 'fcmToken');
            if (userToken) {
                fcmToken = userToken;
                tokenSource = `user:${userId}`;
                console.log(`✅ Token encontrado em user:${userId}`);
            }
        }
        
        // 3. Verificar no formato fcm_tokens:userId (via FCMService)
        if (!fcmToken) {
            const userTokensHash = await redis.hgetall(`fcm_tokens:${userId}`);
            if (Object.keys(userTokensHash).length > 0) {
                // Pegar o primeiro token ativo
                for (const [token, data] of Object.entries(userTokensHash)) {
                    try {
                        const tokenData = JSON.parse(data);
                        if (tokenData.isActive !== false) { // Se não for explicitamente false
                            fcmToken = tokenData.fcmToken || token; // Usar fcmToken do objeto ou a chave
                            tokenSource = `fcm_tokens:${userId}`;
                            console.log(`✅ Token encontrado em fcm_tokens:${userId}`);
                            break;
                        }
                    } catch (e) {
                        // Se não for JSON, usar o token diretamente (a chave é o token)
                        fcmToken = token;
                        tokenSource = `fcm_tokens:${userId}`;
                        console.log(`✅ Token encontrado em fcm_tokens:${userId} (formato raw)`);
                        break;
                    }
                }
            }
        }
        
        // 4. Listar TODAS as chaves fcm_tokens para debug
        if (!fcmToken) {
            console.log('\n🔍 Buscando em todas as chaves fcm_tokens...');
            const allFcmKeys = await redis.keys('fcm_tokens:*');
            console.log(`   Encontradas ${allFcmKeys.length} chaves fcm_tokens`);
            
            for (const key of allFcmKeys) {
                const keyUserId = key.replace('fcm_tokens:', '');
                console.log(`   Verificando: ${key} (userId: ${keyUserId})`);
                
                // Se o userId da chave contém parte do userId procurado, tentar usar
                if (keyUserId.includes(userId) || userId.includes(keyUserId)) {
                    const tokens = await redis.hgetall(key);
                    for (const [token, data] of Object.entries(tokens)) {
                        try {
                            const tokenData = JSON.parse(data);
                            if (tokenData.userId === userId || tokenData.userId?.includes(userId)) {
                                fcmToken = tokenData.fcmToken || token;
                                tokenSource = key;
                                console.log(`✅ Token encontrado em ${key} (match parcial)`);
                                break;
                            }
                        } catch (e) {
                            // Se não for JSON, usar o token diretamente
                            fcmToken = token;
                            tokenSource = key;
                            console.log(`✅ Token encontrado em ${key} (formato raw, match parcial)`);
                            break;
                        }
                    }
                    if (fcmToken) break;
                }
            }
        }
        
        // Listar todos os usuários com tokens (para debug)
        const driverKeys = await redis.keys('driver:*');
        const userKeys = await redis.keys('user:*');
        console.log(`\n📋 Usuários com tokens no Redis:`);
        console.log(`   - driver:*: ${driverKeys.length} chaves`);
        console.log(`   - user:*: ${userKeys.length} chaves`);
        
        if (!fcmToken) {
            console.log('\n⚠️ Nenhum token FCM encontrado para este usuário');
            console.log('\n💡 Dicas:');
            console.log('   1. Certifique-se de que o app está rodando');
            console.log('   2. Verifique se o WebSocket está conectado');
            console.log('   3. O token FCM deve ser registrado via WebSocket');
            console.log('   4. Aguarde alguns segundos após abrir o app para o token ser registrado');
            console.log('\n💡 Tentando enviar via FCMService mesmo assim...');
            
            // Tentar usar o FCMService que pode buscar o token de outras formas
            const notification = {
                title: '🔔 Notificação de Teste',
                body: 'Esta é uma notificação de teste do Leaf App!',
                data: {
                    type: 'test',
                    timestamp: new Date().toISOString(),
                    test: true
                },
                priority: 'high'
            };
            
            console.log('\n📤 Enviando notificação via FCMService...');
            const result = await fcmService.sendNotificationToUser(userId, notification);
            
            if (result.success) {
                console.log('\n✅ Notificação enviada com sucesso!');
                console.log('   Dispositivos:', result.summary?.success || 0);
            } else {
                console.log('\n❌ Erro ao enviar notificação:', result.error);
            }
            
            await redis.quit();
            process.exit(0);
        }
        
        console.log(`   Token: ${fcmToken.substring(0, 30)}...`);
        console.log(`   Fonte: ${tokenSource}`);
        
        // Criar notificação de teste
        const notification = {
            title: '🔔 Notificação de Teste',
            body: 'Esta é uma notificação de teste do Leaf App!',
            data: {
                type: 'test',
                timestamp: new Date().toISOString(),
                test: true
            },
            priority: 'high'
        };
        
        console.log('\n📤 Enviando notificação...');
        console.log('   Título:', notification.title);
        console.log('   Corpo:', notification.body);
        
        // Tentar enviar via FCMService primeiro (ele busca o token automaticamente)
        let result = await fcmService.sendNotificationToUser(userId, notification);
        
        // Se falhar, tentar enviar diretamente para o token encontrado
        if (!result.success && fcmToken) {
            console.log('\n⚠️ FCMService falhou, tentando enviar diretamente para o token...');
            result = await fcmService.sendToToken(fcmToken, notification);
        }
        
        if (result.success) {
            console.log('\n✅ Notificação enviada com sucesso!');
            if (result.messageId) {
                console.log('   Message ID:', result.messageId);
            }
            if (result.summary) {
                console.log('   Dispositivos:', result.summary.success, 'de', result.summary.total);
            } else if (result.results) {
                console.log('   Dispositivos:', result.results.length);
            }
        } else {
            console.log('\n❌ Erro ao enviar notificação:', result.error);
        }
        
        // Fechar conexões
        await redis.quit();
        process.exit(0);
        
    } catch (error) {
        console.error('\n❌ Erro:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

// Executar
sendTestNotification();

