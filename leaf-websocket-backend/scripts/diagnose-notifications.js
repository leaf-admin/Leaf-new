/**
 * 🔍 Script de Diagnóstico de Notificações
 * 
 * Verifica:
 * - Tokens FCM registrados
 * - userIds disponíveis
 * - Status do serviço FCM
 */

const Redis = require('ioredis');
const FCMService = require('../services/fcm-service');

async function diagnoseNotifications() {
    const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
    const fcmService = new FCMService();
    
    try {
        console.log('🔍 DIAGNÓSTICO DE NOTIFICAÇÕES\n');
        
        // 1. Verificar tokens FCM registrados
        console.log('📋 1. Tokens FCM registrados:');
        const fcmKeys = await redis.keys('fcm_tokens:*');
        console.log(`   Total de usuários com tokens: ${fcmKeys.length}\n`);
        
        for (const key of fcmKeys) {
            const userId = key.replace('fcm_tokens:', '');
            const tokens = await redis.hgetall(key);
            console.log(`   👤 ${userId}:`);
            console.log(`      Tokens ativos: ${Object.keys(tokens).length}`);
            
            for (const [token, data] of Object.entries(tokens)) {
                try {
                    const tokenData = JSON.parse(data);
                    console.log(`      - Token: ${token.substring(0, 20)}...`);
                    console.log(`        userType: ${tokenData.userType || 'N/A'}`);
                    console.log(`        isActive: ${tokenData.isActive || false}`);
                    console.log(`        platform: ${tokenData.deviceInfo?.platform || 'N/A'}`);
                    console.log(`        lastUpdated: ${tokenData.lastUpdated || 'N/A'}`);
                } catch (e) {
                    console.log(`      - Token: ${token.substring(0, 20)}... (erro ao parsear)`);
                }
            }
            console.log('');
        }
        
        // 2. Verificar drivers online
        console.log('🚗 2. Motoristas online:');
        const driverKeys = await redis.keys('driver:*');
        console.log(`   Total de motoristas: ${driverKeys.length}\n`);
        
        for (const key of driverKeys) {
            const driverId = key.replace('driver:', '');
            const driverData = await redis.hgetall(key);
            console.log(`   👤 ${driverId}:`);
            console.log(`      Status: ${driverData.status || 'N/A'}`);
            console.log(`      FCM Token: ${driverData.fcmToken ? driverData.fcmToken.substring(0, 20) + '...' : 'NÃO REGISTRADO'}`);
            console.log(`      Socket ID: ${driverData.socketId || 'N/A'}`);
            console.log('');
        }
        
        // 3. Verificar status do FCM Service
        console.log('📱 3. Status do FCM Service:');
        await fcmService.initialize();
        const stats = await fcmService.getServiceStats();
        console.log(`   Serviço disponível: ${stats.isServiceAvailable ? '✅' : '❌'}`);
        console.log(`   Tokens ativos: ${stats.activeTokens || 0}`);
        console.log(`   Total de usuários: ${stats.totalUsers || 0}`);
        console.log('');
        
        // 4. Testar busca de tokens para um userId específico
        console.log('🧪 4. Teste de busca de tokens:');
        const testUserIds = ['test', 'user_001', 'test-user-dev'];
        for (const testUserId of testUserIds) {
            const tokens = await fcmService.getUserFCMTokens(testUserId);
            console.log(`   ${testUserId}: ${tokens.length} token(s) encontrado(s)`);
            if (tokens.length > 0) {
                tokens.forEach((token, idx) => {
                    console.log(`      ${idx + 1}. ${token.fcmToken.substring(0, 20)}... (${token.userType || 'N/A'})`);
                });
            }
        }
        console.log('');
        
        // 5. Recomendações
        console.log('💡 5. Recomendações:');
        if (fcmKeys.length === 0) {
            console.log('   ⚠️ Nenhum token FCM registrado!');
            console.log('   → Verifique se o app está registrando tokens via WebSocket');
        } else {
            console.log('   ✅ Tokens FCM encontrados');
            console.log('   → Use os userIds listados acima para enviar notificações');
        }
        
        if (driverKeys.length === 0) {
            console.log('   ⚠️ Nenhum motorista online!');
            console.log('   → Verifique se os motoristas estão conectados ao WebSocket');
        }
        
    } catch (error) {
        console.error('❌ Erro no diagnóstico:', error);
    } finally {
        await redis.quit();
    }
}

// Executar diagnóstico
diagnoseNotifications().catch(console.error);


