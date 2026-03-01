#!/usr/bin/env node

/**
 * Script para monitorar Redis e enviar notificação quando encontrar token
 * Uso: node monitor-and-send-notification.js [userId]
 */

const FCMService = require('./services/fcm-service');
const Redis = require('ioredis');

async function monitorAndSend(userId = 'test-user-dev') {
    try {
        console.log(`🔍 Monitorando Redis para token FCM do usuário: ${userId}`);
        console.log('💡 Aguardando token ser registrado...\n');
        
        const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
        const fcmService = new FCMService();
        await fcmService.initialize();
        
        let attempts = 0;
        const maxAttempts = 60; // 60 tentativas = 30 segundos
        
        const checkAndSend = async () => {
            attempts++;
            
            // Verificar em múltiplas chaves
            let fcmToken = null;
            
            // 1. user:userId
            try {
                fcmToken = await redis.hget(`user:${userId}`, 'fcmToken');
            } catch (e) {}
            
            // 2. driver:userId
            if (!fcmToken) {
                try {
                    fcmToken = await redis.hget(`driver:${userId}`, 'fcmToken');
                } catch (e) {}
            }
            
            // 3. fcm_tokens:userId
            if (!fcmToken) {
                try {
                    const tokens = await redis.hgetall(`fcm_tokens:${userId}`);
                    for (const [token, data] of Object.entries(tokens)) {
                        try {
                            const tokenData = JSON.parse(data);
                            fcmToken = tokenData.fcmToken || token;
                            break;
                        } catch (e) {
                            fcmToken = token;
                            break;
                        }
                    }
                } catch (e) {}
            }
            
            if (fcmToken) {
                console.log(`\n✅ Token encontrado! ${fcmToken.substring(0, 30)}...`);
                console.log('📤 Enviando notificação...\n');
                
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
                
                const result = await fcmService.sendToToken(fcmToken, notification);
                
                if (result.success) {
                    console.log('✅ Notificação enviada com sucesso!');
                    console.log('   Message ID:', result.messageId);
                    console.log('\n💡 Verifique o dispositivo - a notificação deve aparecer em alguns segundos');
                } else {
                    console.log('❌ Erro ao enviar:', result.error);
                }
                
                await redis.quit();
                process.exit(0);
            } else {
                if (attempts % 10 === 0) {
                    process.stdout.write(`\r⏳ Tentativa ${attempts}/${maxAttempts}... (${Math.floor(attempts * 0.5)}s)`);
                } else {
                    process.stdout.write('.');
                }
                
                if (attempts >= maxAttempts) {
                    console.log('\n\n⏱️ Timeout: Token não encontrado após 30 segundos');
                    console.log('\n💡 Verifique:');
                    console.log('   1. Se o app está rodando');
                    console.log('   2. Se o WebSocket está conectado');
                    console.log('   3. Se o token foi registrado (verifique logs do app)');
                    await redis.quit();
                    process.exit(1);
                } else {
                    setTimeout(checkAndSend, 500); // Verificar a cada 0.5 segundos
                }
            }
        };
        
        // Iniciar verificação
        checkAndSend();
        
    } catch (error) {
        console.error('\n❌ Erro:', error.message);
        process.exit(1);
    }
}

// Executar
const userId = process.argv[2] || 'test-user-dev';
monitorAndSend(userId);

