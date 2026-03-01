/**
 * Script para atualizar o carType dos motoristas existentes
 * Atualiza para "Leaf Plus" ou "Leaf Elite" ao invés de nomes de veículos
 * 
 * Uso: node scripts/update-drivers-cartype.js
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
 * Atualizar carType de um motorista e criar hash completo no Redis
 */
async function updateDriverCarType(driverId, driver, carType, index) {
  try {
    // 1. Atualizar no Firebase Realtime Database
    await db.ref(`users/${driverId}/carType`).set(carType);
    
    // ✅ Garantir que approved e driverActiveStatus estão corretos
    await db.ref(`users/${driverId}/approved`).set(true);
    await db.ref(`users/${driverId}/driverActiveStatus`).set(true);
    
    console.log(`   ✅ Firebase atualizado: ${driverId.substring(0, 12)}... -> ${carType}`);
    
    // 2. Buscar localização do motorista
    const locationSnapshot = await db.ref(`locations/${driverId}`).once('value');
    let lat = 0;
    let lng = 0;
    
    if (locationSnapshot.exists()) {
      const location = locationSnapshot.val();
      lat = location.lat || 0;
      lng = location.lng || 0;
    }
    
    // 3. Criar/Atualizar hash completo no Redis
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
        lat: lat.toString(),
        lng: lng.toString(),
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
      
      await redis.hset(`driver:${driverId}`, driverStatus);
      
      // Garantir que está no Redis GEO
      if (lat !== 0 && lng !== 0) {
        await redis.geoadd('driver_locations', lng, lat, driverId);
      }
      
      // TTL de 90 segundos
      await redis.expire(`driver:${driverId}`, 90);
      
      console.log(`   ✅ Redis hash criado/atualizado: ${driverId.substring(0, 12)}... -> ${carType}`);
    } catch (redisError) {
      console.warn(`   ⚠️  Erro ao atualizar Redis: ${redisError.message}`);
    }
    
    return true;
  } catch (error) {
    console.error(`   ❌ Erro ao atualizar ${driverId}:`, error.message);
    return false;
  }
}

/**
 * Função principal
 */
async function main() {
  try {
    console.log('\n🔄 Atualizando carType dos motoristas...\n');
    
    // Buscar todos os motoristas
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
    
    let updated = 0;
    let failed = 0;
    
    // Atualizar cada motorista
    for (let i = 0; i < driverIds.length; i++) {
      const driverId = driverIds[i];
      const driver = drivers[driverId];
      
      // Alternar entre Leaf Plus e Leaf Elite
      const carTypes = ['Leaf Plus', 'Leaf Elite'];
      const newCarType = carTypes[i % 2];
      
      console.log(`[${i + 1}/${driverIds.length}] Atualizando ${driverId.substring(0, 12)}...`);
      console.log(`   Nome: ${driver.firstName} ${driver.lastName}`);
      console.log(`   CarType atual: ${driver.carType || 'N/A'}`);
      console.log(`   Novo CarType: ${newCarType}`);
      
      const success = await updateDriverCarType(driverId, driver, newCarType, i);
      
      if (success) {
        updated++;
      } else {
        failed++;
      }
      
      // Pequeno delay para evitar rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log('\n📊 Resumo:\n');
    console.log(`✅ Atualizados: ${updated}/${driverIds.length}`);
    console.log(`❌ Falhas: ${failed}/${driverIds.length}\n`);
    console.log('✅ Processo concluído!\n');
    
  } catch (error) {
    console.error('❌ Erro fatal:', error);
    process.exit(1);
  }
}

// Executar
main();

