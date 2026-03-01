/**
 * INVESTIGAÇÃO: TC-002 e TC-005 - Zero Notificações
 * 
 * Este script investiga por que os testes TC-002 e TC-005
 * não conseguem notificar motoristas.
 */

const redisPool = require('./utils/redis-pool');
const rideQueueManager = require('./services/ride-queue-manager');
const DriverNotificationDispatcher = require('./services/driver-notification-dispatcher');
const GeoHashUtils = require('./utils/geohash-utils');

async function investigate() {
    const redis = redisPool.getConnection();
    
    if (!redis.isOpen) {
        await redis.connect();
    }
    
    console.log('🔍 INVESTIGAÇÃO: Por que zero notificações?\n');
    
    // 1. Verificar motoristas no Redis
    console.log('📋 1. VERIFICANDO MOTORISTAS NO REDIS...');
    const allDrivers = await redis.zrange('driver_locations', 0, -1, 'WITHSCORES');
    console.log(`   Total de motoristas em driver_locations: ${allDrivers.length / 2}`);
    
    if (allDrivers.length === 0) {
        console.log('   ❌ PROBLEMA: Nenhum motorista encontrado em driver_locations!');
    } else {
        console.log('   ✅ Motoristas encontrados:');
        for (let i = 0; i < Math.min(allDrivers.length, 10); i += 2) {
            const driverId = allDrivers[i];
            const score = allDrivers[i + 1];
            const [lng, lat] = score.split(',');
            console.log(`      - ${driverId}: lat=${lat}, lng=${lng}`);
        }
    }
    
    // 2. Verificar dados completos dos motoristas
    console.log('\n📋 2. VERIFICANDO DADOS COMPLETOS DOS MOTORISTAS...');
    const testDriverIds = [
        'test_driver_f9_1',
        'test_driver_f9_2',
        'test_driver_f9_3',
        'test_driver_f9_4',
        'test_driver_f9_5'
    ];
    
    for (const driverId of testDriverIds) {
        const driverData = await redis.hgetall(`driver:${driverId}`);
        const location = await redis.geopos('driver_locations', driverId);
        
        console.log(`\n   Motorista: ${driverId}`);
        console.log(`      Localização GEO:`, location);
        console.log(`      Dados completos:`, driverData);
        
        if (!driverData || Object.keys(driverData).length === 0) {
            console.log(`      ❌ PROBLEMA: Dados não encontrados para ${driverId}`);
        }
        
        if (!location || location.length === 0) {
            console.log(`      ❌ PROBLEMA: Localização não encontrada para ${driverId}`);
        }
    }
    
    // 3. Verificar locks ativos
    console.log('\n📋 3. VERIFICANDO LOCKS ATIVOS...');
    const lockKeys = await redis.keys('driver_lock:*');
    console.log(`   Total de locks ativos: ${lockKeys.length}`);
    
    if (lockKeys.length > 0) {
        console.log('   ⚠️ PROBLEMA: Locks ativos encontrados:');
        for (const lockKey of lockKeys.slice(0, 5)) {
            const lockData = await redis.get(lockKey);
            console.log(`      - ${lockKey}: ${lockData}`);
        }
    } else {
        console.log('   ✅ Nenhum lock ativo');
    }
    
    // 4. Simular busca de motoristas
    console.log('\n📋 4. SIMULANDO BUSCA DE MOTORISTAS...');
    const pickupLocation = {
        lat: -22.9068,
        lng: -43.1234
    };
    
    const dispatcher = new DriverNotificationDispatcher(null); // MockIO
    
    for (const radius of [0.5, 1.0, 3.0, 5.0]) {
        console.log(`\n   Buscando em ${radius}km:`);
        
        try {
            const drivers = await dispatcher.findAndScoreDrivers(
                pickupLocation,
                radius,
                10,
                'test_booking_investigate'
            );
            
            console.log(`      ✅ Encontrados: ${drivers.length} motoristas`);
            
            if (drivers.length > 0) {
                console.log(`      Top 3 motoristas:`);
                drivers.slice(0, 3).forEach((d, idx) => {
                    console.log(`         ${idx + 1}. ${d.driverId} - Distância: ${d.distance.toFixed(2)}km, Score: ${d.score.toFixed(2)}`);
                });
            } else {
                console.log(`      ❌ PROBLEMA: Nenhum motorista encontrado em ${radius}km`);
            }
        } catch (error) {
            console.log(`      ❌ ERRO: ${error.message}`);
        }
    }
    
    // 5. Verificar estado dos motoristas
    console.log('\n📋 5. VERIFICANDO ESTADO DOS MOTORISTAS...');
    for (const driverId of testDriverIds) {
        const driverData = await redis.hgetall(`driver:${driverId}`);
        
        if (driverData && Object.keys(driverData).length > 0) {
            const isOnline = driverData.isOnline === 'true' || driverData.isOnline === true;
            const status = driverData.status || 'UNKNOWN';
            
            console.log(`   ${driverId}:`);
            console.log(`      isOnline: ${isOnline}`);
            console.log(`      status: ${status}`);
            
            if (!isOnline) {
                console.log(`      ⚠️ PROBLEMA: Motorista está offline`);
            }
            
            if (status !== 'AVAILABLE') {
                console.log(`      ⚠️ PROBLEMA: Status não é AVAILABLE: ${status}`);
            }
        }
    }
    
    // 6. Verificar notificações anteriores
    console.log('\n📋 6. VERIFICANDO NOTIFICAÇÕES ANTERIORES...');
    const notificationKeys = await redis.keys('ride_notifications:*');
    console.log(`   Total de chaves de notificações: ${notificationKeys.length}`);
    
    if (notificationKeys.length > 0) {
        console.log('   Notificações encontradas:');
        for (const key of notificationKeys.slice(0, 5)) {
            const notified = await redis.smembers(key);
            console.log(`      ${key}: ${notified.length} motoristas notificados`);
            if (notified.length > 0) {
                console.log(`         Motoristas: ${notified.slice(0, 3).join(', ')}...`);
            }
        }
    }
    
    // 7. Verificar cache geoespacial
    console.log('\n📋 7. VERIFICANDO CACHE GEOESPACIAL...');
    const geospatialCache = require('./services/geospatial-cache');
    const cacheStats = await geospatialCache.getStats();
    console.log(`   Total de chaves no cache: ${cacheStats.totalKeys}`);
    console.log(`   Total de motoristas no cache: ${cacheStats.totalDrivers}`);
    
    if (cacheStats.totalKeys > 0) {
        console.log(`   ⚠️ POSSÍVEL PROBLEMA: Cache pode estar retornando dados antigos`);
    }
    
    // 8. Resumo e Diagnóstico
    console.log('\n📊 RESUMO DO DIAGNÓSTICO:\n');
    
    const issues = [];
    
    if (allDrivers.length === 0) {
        issues.push('❌ Nenhum motorista em driver_locations');
    }
    
    if (lockKeys.length > 0) {
        issues.push(`⚠️ ${lockKeys.length} locks ativos podem estar bloqueando motoristas`);
    }
    
    if (notificationKeys.length > 0) {
        issues.push(`⚠️ Notificações anteriores podem estar impedindo novas notificações`);
    }
    
    if (cacheStats.totalKeys > 0) {
        issues.push(`⚠️ Cache geoespacial pode conter dados antigos`);
    }
    
    if (issues.length === 0) {
        console.log('✅ Nenhum problema óbvio encontrado');
        console.log('   Possíveis causas:');
        console.log('   1. Motoristas estão fora do raio de busca');
        console.log('   2. Motoristas estão com status não disponível');
        console.log('   3. Problema de timing (motoristas ainda não processados)');
    } else {
        console.log('PROBLEMAS ENCONTRADOS:');
        issues.forEach(issue => console.log(`   ${issue}`));
    }
    
    await redis.quit();
}

investigate().catch(console.error);


