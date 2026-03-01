#!/usr/bin/env node

/**
 * Script de diagnóstico para verificar status do motorista
 * Uso: node debug-driver-status.js <driverId>
 */

const redisPool = require('./utils/redis-pool');

async function debugDriverStatus(driverId) {
    try {
        const redis = redisPool.getConnection();
        
        console.log(`\n🔍 Diagnosticando motorista: ${driverId}\n`);
        
        // 1. Verificar se está no Redis GEO
        const location = await redis.geopos('driver_locations', driverId);
        if (location && location.length > 0 && location[0]) {
            const [lng, lat] = location[0];
            console.log(`✅ Localização no Redis: (${lat}, ${lng})`);
        } else {
            console.log(`❌ Motorista NÃO está em driver_locations`);
        }
        
        // 2. Verificar se está offline
        const offlineLocation = await redis.geopos('driver_offline_locations', driverId);
        if (offlineLocation && offlineLocation.length > 0 && offlineLocation[0]) {
            const [lng, lat] = offlineLocation[0];
            console.log(`⚠️ Motorista está em driver_offline_locations: (${lat}, ${lng})`);
        }
        
        // 3. Verificar dados do motorista
        const driverData = await redis.hgetall(`driver:${driverId}`);
        if (driverData && Object.keys(driverData).length > 0) {
            console.log(`✅ Dados do motorista encontrados:`);
            console.log(`   - Status: ${driverData.status || 'N/A'}`);
            console.log(`   - Online: ${driverData.isOnline || 'N/A'}`);
            console.log(`   - Em viagem: ${driverData.isInTrip || 'N/A'}`);
        } else {
            console.log(`⚠️ Dados do motorista não encontrados no Redis`);
        }
        
        // 4. Listar todos os motoristas online
        const allDrivers = await redis.zrange('driver_locations', 0, -1);
        console.log(`\n📊 Total de motoristas online: ${allDrivers.length}`);
        if (allDrivers.length > 0) {
            console.log(`   Primeiros 5: ${allDrivers.slice(0, 5).join(', ')}`);
        }
        
        // 5. Verificar corridas pendentes
        const pendingBookings = await redis.keys('booking:*');
        console.log(`\n📋 Total de corridas no Redis: ${pendingBookings.length}`);
        
        console.log(`\n✅ Diagnóstico completo!\n`);
        
        process.exit(0);
    } catch (error) {
        console.error(`❌ Erro:`, error);
        process.exit(1);
    }
}

const driverId = process.argv[2];
if (!driverId) {
    console.log('Uso: node debug-driver-status.js <driverId>');
    process.exit(1);
}

debugDriverStatus(driverId);


