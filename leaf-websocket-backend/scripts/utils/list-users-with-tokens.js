#!/usr/bin/env node

/**
 * Script para listar todos os usuários com tokens FCM
 * Uso: node list-users-with-tokens.js
 */

const Redis = require('ioredis');

async function listUsersWithTokens() {
    try {
        const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
        
        console.log('🔍 Buscando usuários com tokens FCM...\n');
        
        // Buscar em driver:*
        const driverKeys = await redis.keys('driver:*');
        console.log(`📋 Motoristas (driver:*): ${driverKeys.length} chaves\n`);
        
        const driversWithTokens = [];
        for (const key of driverKeys) {
            try {
                const fcmToken = await redis.hget(key, 'fcmToken');
                if (fcmToken) {
                    const userId = key.replace('driver:', '');
                    let driverData = {};
                    try {
                        driverData = await redis.hgetall(key);
                    } catch (e) {
                        // Se não for hash, ignorar
                    }
                    driversWithTokens.push({
                        userId,
                        fcmToken: fcmToken.substring(0, 30) + '...',
                        platform: driverData.fcmPlatform || 'unknown',
                        updated: driverData.fcmTokenUpdated || 'N/A'
                    });
                }
            } catch (e) {
                // Ignorar chaves que não são hashes
            }
        }
        
        if (driversWithTokens.length > 0) {
            console.log('✅ Motoristas com tokens FCM:');
            driversWithTokens.forEach((driver, index) => {
                console.log(`\n   ${index + 1}. ${driver.userId}`);
                console.log(`      Token: ${driver.fcmToken}`);
                console.log(`      Plataforma: ${driver.platform}`);
                console.log(`      Atualizado: ${driver.updated}`);
            });
        }
        
        // Buscar em user:*
        const userKeys = await redis.keys('user:*');
        console.log(`\n\n📋 Passageiros (user:*): ${userKeys.length} chaves\n`);
        
        const usersWithTokens = [];
        for (const key of userKeys) {
            try {
                const fcmToken = await redis.hget(key, 'fcmToken');
                if (fcmToken) {
                    const userId = key.replace('user:', '');
                    let userData = {};
                    try {
                        userData = await redis.hgetall(key);
                    } catch (e) {
                        // Se não for hash, ignorar
                    }
                    usersWithTokens.push({
                        userId,
                        fcmToken: fcmToken.substring(0, 30) + '...',
                        platform: userData.fcmPlatform || 'unknown',
                        updated: userData.fcmTokenUpdated || 'N/A'
                    });
                }
            } catch (e) {
                // Ignorar chaves que não são hashes
            }
        }
        
        if (usersWithTokens.length > 0) {
            console.log('✅ Passageiros com tokens FCM:');
            usersWithTokens.forEach((user, index) => {
                console.log(`\n   ${index + 1}. ${user.userId}`);
                console.log(`      Token: ${user.fcmToken}`);
                console.log(`      Plataforma: ${user.platform}`);
                console.log(`      Atualizado: ${user.updated}`);
            });
        }
        
        // Resumo
        console.log('\n\n📊 RESUMO:');
        console.log(`   Motoristas com tokens: ${driversWithTokens.length}`);
        console.log(`   Passageiros com tokens: ${usersWithTokens.length}`);
        console.log(`   Total: ${driversWithTokens.length + usersWithTokens.length}`);
        
        if (driversWithTokens.length > 0 || usersWithTokens.length > 0) {
            console.log('\n💡 Para enviar notificação, use:');
            console.log('   node test-send-notification.js <userId>');
            console.log('\n   Exemplos:');
            if (driversWithTokens.length > 0) {
                console.log(`   node test-send-notification.js ${driversWithTokens[0].userId}`);
            }
            if (usersWithTokens.length > 0) {
                console.log(`   node test-send-notification.js ${usersWithTokens[0].userId}`);
            }
        } else {
            console.log('\n⚠️ Nenhum token FCM encontrado no Redis');
            console.log('💡 Certifique-se de que:');
            console.log('   1. O app está rodando');
            console.log('   2. O WebSocket está conectado');
            console.log('   3. O token FCM foi registrado via WebSocket');
        }
        
        await redis.quit();
        process.exit(0);
        
    } catch (error) {
        console.error('\n❌ Erro:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

// Executar
listUsersWithTokens();

