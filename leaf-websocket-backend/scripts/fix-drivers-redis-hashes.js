/**
 * Script para recriar os hashes Redis de todos os motoristas
 * Garante que todos os motoristas tenham hash completo no Redis
 * 
 * Uso: node scripts/fix-drivers-redis-hashes.js
 */

const admin = require('firebase-admin');
const path = require('path');
const redisPool = require('../utils/redis-pool');

// Configurar Firebase Admin
const serviceAccountPath = path.join(__dirname, '..', 'leaf-reactnative-firebase-adminsdk-fbsvc-456a95e2fc.json');

let firebaseApp;
try {
  firebaseApp = admin.initializeApp({
    credential: admin.credential.cert(serviceAccountPath),
    databaseURL: 'https://leaf-reactnative-default-rtdb.firebaseio.com'
  });
  console.log('✅ Firebase Admin inicializado');
} catch (error) {
  if (error.code === 'app/already-exists') {
    firebaseApp = admin.app();
    console.log('✅ Firebase Admin já inicializado');
  } else {
    console.error('❌ Erro ao inicializar Firebase Admin:', error);
    process.exit(1);
  }
}

const db = admin.database();

/**
 * Recriar hash Redis de um motorista
 */
async function recreateDriverHash(driverId, driver, location, carType) {
  try {
    const redis = redisPool.getConnection();
    
    if (redis.status !== 'ready' && redis.status !== 'connect') {
      await redis.connect();
    }
    
    const now = Date.now();
    const driverStatus = {
      id: driverId,
      isOnline: 'true',
      status: 'AVAILABLE',
      lat: location.lat.toString(),
      lng: location.lng.toString(),
      heading: '0',
      speed: '0',
      lastUpdate: now.toString(),
      timestamp: now.toString(),
      lastSeen: new Date().toISOString(),
      rating: (driver.rating || 5.0).toString(),
      carType: carType,
      firstName: driver.firstName || '',
      lastName: driver.lastName || '',
    };
    
    // Criar hash
    await redis.hset(`driver:${driverId}`, driverStatus);
    
    // Garantir que está no Redis GEO
    await redis.geoadd('driver_locations', location.lng, location.lat, driverId);
    
    // TTL de 90 segundos (será renovado quando motorista atualizar localização)
    await redis.expire(`driver:${driverId}`, 90);
    
    return true;
  } catch (error) {
    console.error(`   ❌ Erro ao recriar hash: ${error.message}`);
    return false;
  }
}

/**
 * Função principal
 */
async function main() {
  try {
    console.log('\n🔧 Recriando hashes Redis dos motoristas...\n');
    
    // 1. Buscar todos os motoristas
    const driversSnapshot = await db.ref('users')
      .orderByChild('usertype')
      .equalTo('driver')
      .once('value');
    
    if (!driversSnapshot.exists()) {
      console.log('⚠️  Nenhum motorista encontrado');
      return;
    }
    
    const drivers = driversSnapshot.val();
    const driverIds = Object.keys(drivers);
    
    console.log(`📊 Encontrados ${driverIds.length} motoristas\n`);
    
    let fixed = 0;
    let failed = 0;
    
    // 2. Verificar Redis GEO
    const redis = redisPool.getConnection();
    if (redis.status !== 'ready' && redis.status !== 'connect') {
      await redis.connect();
    }
    
    const totalInGeo = await redis.zcard('driver_locations');
    console.log(`📍 Motoristas no Redis GEO: ${totalInGeo}\n`);
    
    // 3. Processar cada motorista
    for (let i = 0; i < driverIds.length; i++) {
      const driverId = driverIds[i];
      const driver = drivers[driverId];
      
      console.log(`[${i + 1}/${driverIds.length}] Processando ${driverId.substring(0, 12)}...`);
      console.log(`   Nome: ${driver.firstName} ${driver.lastName}`);
      
      // Buscar localização
      const locationSnapshot = await db.ref(`locations/${driverId}`).once('value');
      if (!locationSnapshot.exists()) {
        console.log(`   ⚠️  Sem localização no Firebase`);
        failed++;
        continue;
      }
      
      const location = locationSnapshot.val();
      if (!location.lat || !location.lng) {
        console.log(`   ⚠️  Localização inválida`);
        failed++;
        continue;
      }
      
      // Determinar carType
      let carType = driver.carType;
      if (!carType || !['Leaf Plus', 'Leaf Elite'].includes(carType)) {
        // Alternar entre os dois tipos
        const carTypes = ['Leaf Plus', 'Leaf Elite'];
        carType = carTypes[i % 2];
        // Atualizar no Firebase também
        await db.ref(`users/${driverId}/carType`).set(carType);
        console.log(`   🔄 carType definido: ${carType}`);
      }
      
      // Recriar hash
      const success = await recreateDriverHash(driverId, driver, location, carType);
      
      if (success) {
        fixed++;
        console.log(`   ✅ Hash Redis recriado`);
      } else {
        failed++;
      }
      
      // Pequeno delay
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    // 4. Verificar resultado final
    console.log('\n' + '='.repeat(60));
    console.log('📊 RESUMO:');
    console.log('='.repeat(60));
    console.log(`✅ Hashes recriados: ${fixed}/${driverIds.length}`);
    console.log(`❌ Falhas: ${failed}/${driverIds.length}`);
    
    // Verificar quantos hashes existem agora
    let hashCount = 0;
    for (const driverId of driverIds) {
      const exists = await redis.exists(`driver:${driverId}`);
      if (exists) hashCount++;
    }
    console.log(`📊 Hashes existentes no Redis: ${hashCount}/${driverIds.length}`);
    console.log('='.repeat(60) + '\n');
    
  } catch (error) {
    console.error('❌ Erro fatal:', error);
    process.exit(1);
  }
}

// Executar
main();

