#!/usr/bin/env node

/**
 * Script para enviar notificação push de teste diretamente para um token FCM
 * Uso: node send-test-push-direct.js [fcmToken]
 * 
 * Se não fornecer o token, tentará buscar do Redis ou pedir para você colar
 */

const FCMService = require('./services/fcm-service');

async function sendTestPush() {
    try {
        console.log('🔔 Enviando notificação push de teste...\n');
        
        // Obter token do argumento ou pedir
        let fcmToken = process.argv[2];
        
        if (!fcmToken) {
            console.log('💡 Para obter o token FCM:');
            console.log('   1. Abra o app no dispositivo');
            console.log('   2. Verifique os logs do app');
            console.log('   3. Procure por "Token FCM obtido:" ou "fcmToken"');
            console.log('   4. Execute: node send-test-push-direct.js <token>\n');
            console.log('💡 Ou aguarde o token ser registrado e execute:');
            console.log('   node list-users-with-tokens.js\n');
            
            // Tentar buscar do Redis como fallback
            const Redis = require('ioredis');
            const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
            
            const driverKeys = await redis.keys('driver:*');
            for (const key of driverKeys.slice(0, 5)) {
                try {
                    const token = await redis.hget(key, 'fcmToken');
                    if (token) {
                        fcmToken = token;
                        console.log(`✅ Token encontrado no Redis: ${key}`);
                        break;
                    }
                } catch (e) {
                    // Ignorar
                }
            }
            
            await redis.quit();
        }
        
        if (!fcmToken) {
            console.log('❌ Token FCM não fornecido e não encontrado no Redis');
            console.log('\n💡 Soluções:');
            console.log('   1. Aguarde o app registrar o token FCM (pode levar alguns segundos)');
            console.log('   2. Execute: node list-users-with-tokens.js para ver tokens disponíveis');
            console.log('   3. Ou forneça o token manualmente: node send-test-push-direct.js <token>');
            process.exit(1);
        }
        
        console.log(`📱 Token: ${fcmToken.substring(0, 30)}...`);
        
        // Inicializar FCM Service
        const fcmService = new FCMService();
        await fcmService.initialize();
        
        // Criar notificação de teste
        const notification = {
            title: '🔔 Notificação de Teste',
            body: 'Esta é uma notificação push de teste do Leaf App!',
            data: {
                type: 'test',
                timestamp: new Date().toISOString(),
                test: true,
                message: 'Notificação enviada diretamente via FCM'
            },
            priority: 'high'
        };
        
        console.log('\n📤 Enviando notificação push...');
        console.log('   Título:', notification.title);
        console.log('   Corpo:', notification.body);
        
        // Enviar diretamente para o token
        const result = await fcmService.sendToToken(fcmToken, notification);
        
        if (result.success) {
            console.log('\n✅ Notificação push enviada com sucesso!');
            console.log('   Message ID:', result.messageId);
            console.log('\n💡 Verifique o dispositivo - a notificação deve aparecer em alguns segundos');
        } else {
            console.log('\n❌ Erro ao enviar notificação push:', result.error);
            console.log('\n💡 Possíveis causas:');
            console.log('   - Token FCM inválido ou expirado');
            console.log('   - App não está rodando');
            console.log('   - Problemas de conexão com Firebase');
        }
        
        process.exit(0);
        
    } catch (error) {
        console.error('\n❌ Erro:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

// Executar
sendTestPush();

