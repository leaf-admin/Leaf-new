/**
 * Script para manter motoristas online continuamente
 * Renova hashes Redis e TTL a cada 60 segundos
 * 
 * Uso: node scripts/keep-drivers-online.js
 * Para rodar em background: nohup node scripts/keep-drivers-online.js > keep-drivers.log 2>&1 &
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
 * Renovar status de um motorista no Redis
 */
async function renewDriverStatus(driverId, driver, location, carType) {
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
      lastName: driver.lastName || ''
    };
    
    // Atualizar hash
    await redis.hset(`driver:${driverId}`, driverStatus);
    
    // Garantir que está no Redis GEO
    await redis.geoadd('driver_locations', location.lng, location.lat, driverId);
    
    // Renovar TTL (90 segundos)
    await redis.expire(`driver:${driverId}`, 90);
    
    return true;
  } catch (error) {
    console.error(`   ❌ Erro ao renovar ${driverId}: ${error.message}`);
    return false;
  }
}

/**
 * Renovar todos os motoristas
 */
async function renewAllDrivers() {
  try {
    // Buscar todos os motoristas
    const driversSnapshot = await db.ref('users')
      .orderByChild('usertype')
      .equalTo('driver')
      .once('value');
    
    if (!driversSnapshot.exists()) {
      console.log('⚠️  Nenhum motorista encontrado');
      return { success: 0, failed: 0 };
    }
    
    const drivers = driversSnapshot.val();
    const driverIds = Object.keys(drivers);
    
    let success = 0;
    let failed = 0;
    const carTypes = ['Leaf Plus', 'Leaf Elite'];
    
    // Processar cada motorista
    for (let i = 0; i < driverIds.length; i++) {
      const driverId = driverIds[i];
      const driver = drivers[driverId];
      
      // Buscar localização
      const locationSnapshot = await db.ref(`locations/${driverId}`).once('value');
      if (!locationSnapshot.exists()) {
        failed++;
        continue;
      }
      
      const location = locationSnapshot.val();
      if (!location || !location.lat || !location.lng) {
        failed++;
        continue;
      }
      
      // Determinar carType
      const carType = driver.carType || carTypes[i % 2];
      
      // Renovar status
      const result = await renewDriverStatus(driverId, driver, location, carType);
      if (result) {
        success++;
      } else {
        failed++;
      }
    }
    
    return { success, failed, total: driverIds.length };
  } catch (error) {
    console.error('❌ Erro ao renovar motoristas:', error);
    return { success: 0, failed: 0, error: error.message };
  }
}

/**
 * Função principal - loop contínuo
 */
async function main() {
  console.log('\n🔄 Iniciando serviço de manutenção de motoristas online...\n');
  console.log('   Renovando status a cada 60 segundos\n');
  
  let iteration = 0;
  
  // Renovar imediatamente
  const firstResult = await renewAllDrivers();
  console.log(`[Iteração ${++iteration}] ✅ ${firstResult.success}/${firstResult.total} motoristas renovados`);
  if (firstResult.failed > 0) {
    console.log(`   ⚠️  ${firstResult.failed} falhas`);
  }
  
  // Renovar a cada 60 segundos
  setInterval(async () => {
    const result = await renewAllDrivers();
    const timestamp = new Date().toLocaleTimeString('pt-BR');
    console.log(`[${timestamp}] [Iteração ${++iteration}] ✅ ${result.success}/${result.total} motoristas renovados`);
    if (result.failed > 0) {
      console.log(`   ⚠️  ${result.failed} falhas`);
    }
  }, 60000); // 60 segundos
  
  // Manter processo vivo
  process.on('SIGINT', () => {
    console.log('\n\n🛑 Encerrando serviço...');
    process.exit(0);
  });
  
  console.log('\n✅ Serviço rodando. Pressione Ctrl+C para parar.\n');
}

// Executar
main();

