/**
 * Script para testar a busca de motoristas
 * Simula a busca que o app faz
 * 
 * Uso: node scripts/test-driver-search.js [latitude] [longitude] [radius]
 */

const redisPool = require('../utils/redis-pool');

async function testDriverSearch(lat, lng, radius = 5) {
  try {
    console.log(`\n🔍 Testando busca de motoristas...\n`);
    console.log(`📍 Coordenadas: ${lat}, ${lng}`);
    console.log(`📏 Raio: ${radius}km\n`);
    
    const redis = redisPool.getConnection();
    
    if (redis.status !== 'ready' && redis.status !== 'connect') {
      await redis.connect();
    }
    
    // 1. Verificar total no Redis GEO
    const totalInGeo = await redis.zcard('driver_locations');
    console.log(`📊 Total de motoristas no Redis GEO: ${totalInGeo}\n`);
    
    if (totalInGeo === 0) {
      console.log('⚠️  Nenhum motorista no Redis GEO!');
      return;
    }
    
    // 2. Listar todos os motoristas no GEO (primeiros 5)
    const allDrivers = await redis.zrange('driver_locations', 0, 4, 'WITHSCORES');
    console.log(`📍 Primeiros 5 motoristas no GEO:`);
    allDrivers.forEach((driverId, index) => {
      if (index % 2 === 0) {
        const score = allDrivers[index + 1];
        console.log(`   ${driverId.substring(0, 12)}... (score: ${score})`);
      }
    });
    console.log('');
    
    // 3. Buscar motoristas próximos
    const nearbyDrivers = await redis.georadius(
      'driver_locations',
      lng,
      lat,
      radius,
      'km',
      'WITHCOORD',
      'WITHDIST',
      'COUNT',
      50
    );
    
    console.log(`🔍 Motoristas encontrados no raio de ${radius}km: ${nearbyDrivers?.length || 0}\n`);
    
    if (nearbyDrivers && nearbyDrivers.length > 0) {
      console.log(`📋 Detalhes dos motoristas encontrados:\n`);
      for (let i = 0; i < Math.min(5, nearbyDrivers.length); i++) {
        const driver = nearbyDrivers[i];
        const driverId = driver[0];
        const distance = parseFloat(driver[1]);
        const coordinates = {
          lng: parseFloat(driver[2][0]),
          lat: parseFloat(driver[2][1])
        };
        
        // Buscar dados do motorista
        const driverData = await redis.hgetall(`driver:${driverId}`);
        
        console.log(`[${i + 1}] ${driverId.substring(0, 12)}...`);
        console.log(`   📍 Localização: ${coordinates.lat.toFixed(6)}, ${coordinates.lng.toFixed(6)}`);
        console.log(`   📏 Distância: ${distance.toFixed(2)} km`);
        console.log(`   🚗 Redis Hash:`, {
          exists: Object.keys(driverData).length > 0,
          isOnline: driverData.isOnline,
          status: driverData.status,
          carType: driverData.carType
        });
        console.log('');
      }
    } else {
      console.log(`⚠️  Nenhum motorista encontrado no raio de ${radius}km`);
      console.log(`\n💡 Possíveis causas:`);
      console.log(`   1. Motoristas estão muito distantes (raio atual: ${radius}km)`);
      console.log(`   2. Coordenadas dos motoristas estão incorretas`);
      console.log(`   3. Coordenadas da busca estão incorretas\n`);
    }
    
    // 4. Verificar distância dos motoristas mais próximos
    console.log(`📏 Distâncias dos 10 motoristas mais próximos (independente do raio):\n`);
    const closestDrivers = await redis.georadius(
      'driver_locations',
      lng,
      lat,
      100, // Raio grande para pegar todos
      'km',
      'WITHDIST',
      'COUNT',
      10
    );
    
    if (closestDrivers && closestDrivers.length > 0) {
      closestDrivers.forEach((driver, index) => {
        const driverId = driver[0];
        const distance = parseFloat(driver[1]);
        console.log(`   ${index + 1}. ${driverId.substring(0, 12)}... - ${distance.toFixed(2)} km`);
      });
    }
    
  } catch (error) {
    console.error('❌ Erro:', error);
  }
}

// Executar
const lat = parseFloat(process.argv[2]) || -22.9208626;
const lng = parseFloat(process.argv[3]) || -43.4059964;
const radius = parseFloat(process.argv[4]) || 10;

testDriverSearch(lat, lng, radius);

