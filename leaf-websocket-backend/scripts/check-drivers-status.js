/**
 * Script para verificar status dos motoristas de teste
 * Verifica Firebase, Redis e critérios de disponibilidade
 * 
 * Uso: node scripts/check-drivers-status.js
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
 * Verificar status de um motorista
 */
async function checkDriverStatus(driverId) {
  const status = {
    driverId: driverId.substring(0, 12) + '...',
    exists: false,
    firebase: {
      exists: false,
      usertype: null,
      approved: null,
      driverActiveStatus: null,
      carType: null,
      isOnline: null,
    },
    redis: {
      exists: false,
      isOnline: null,
      status: null,
      carType: null,
      inGeo: false,
    },
    available: false,
    issues: []
  };

  try {
    // 1. Verificar Firebase
    const userSnapshot = await db.ref(`users/${driverId}`).once('value');
    if (userSnapshot.exists()) {
      status.exists = true;
      const user = userSnapshot.val();
      status.firebase.exists = true;
      status.firebase.usertype = user.usertype || user.userType;
      status.firebase.approved = user.approved;
      status.firebase.driverActiveStatus = user.driverActiveStatus;
      status.firebase.carType = user.carType;
      status.firebase.isOnline = user.isOnline;
      
      // Verificar critérios
      if (status.firebase.usertype !== 'driver') {
        status.issues.push('❌ usertype não é "driver"');
      }
      if (status.firebase.approved !== true) {
        status.issues.push('❌ approved não é true');
      }
      if (status.firebase.driverActiveStatus !== true) {
        status.issues.push('❌ driverActiveStatus não é true');
      }
      if (!status.firebase.carType || !['Leaf Plus', 'Leaf Elite'].includes(status.firebase.carType)) {
        status.issues.push(`❌ carType inválido: "${status.firebase.carType}" (deve ser "Leaf Plus" ou "Leaf Elite")`);
      }
    } else {
      status.issues.push('❌ Motorista não existe no Firebase');
    }

    // 2. Verificar Redis
    try {
      const redis = redisPool.getConnection();
      
      if (redis.status !== 'ready' && redis.status !== 'connect') {
        await redis.connect();
      }
      
      // Verificar hash do driver
      const driverData = await redis.hgetall(`driver:${driverId}`);
      if (driverData && Object.keys(driverData).length > 0) {
        status.redis.exists = true;
        status.redis.isOnline = driverData.isOnline;
        status.redis.status = driverData.status;
        status.redis.carType = driverData.carType;
        
        // Verificar critérios
        if (driverData.isOnline !== 'true' && driverData.isOnline !== true) {
          status.issues.push(`❌ Redis isOnline não é true: "${driverData.isOnline}"`);
        }
        if (!['AVAILABLE', 'available', 'ONLINE'].includes(driverData.status)) {
          status.issues.push(`❌ Redis status inválido: "${driverData.status}"`);
        }
        if (!driverData.carType || !['Leaf Plus', 'Leaf Elite'].includes(driverData.carType)) {
          status.issues.push(`❌ Redis carType inválido: "${driverData.carType}"`);
        }
      } else {
        status.issues.push('❌ Motorista não existe no Redis (hash driver:${driverId})');
      }
      
      // Verificar se está no Redis GEO
      const geoScore = await redis.zscore('driver_locations', driverId);
      if (geoScore !== null) {
        status.redis.inGeo = true;
      } else {
        status.issues.push('❌ Motorista não está no Redis GEO (driver_locations)');
      }
      
    } catch (redisError) {
      status.issues.push(`❌ Erro ao verificar Redis: ${redisError.message}`);
    }

    // 3. Determinar se está disponível
    status.available = 
      status.firebase.exists &&
      status.firebase.usertype === 'driver' &&
      status.firebase.approved === true &&
      status.firebase.driverActiveStatus === true &&
      ['Leaf Plus', 'Leaf Elite'].includes(status.firebase.carType) &&
      status.redis.exists &&
      (status.redis.isOnline === 'true' || status.redis.isOnline === true) &&
      ['AVAILABLE', 'available', 'ONLINE'].includes(status.redis.status) &&
      ['Leaf Plus', 'Leaf Elite'].includes(status.redis.carType) &&
      status.redis.inGeo;

  } catch (error) {
    status.issues.push(`❌ Erro ao verificar: ${error.message}`);
  }

  return status;
}

/**
 * Função principal
 */
async function main() {
  try {
    console.log('\n🔍 Verificando status dos motoristas de teste...\n');
    
    // 1. Buscar todos os motoristas no Firebase
    const driversSnapshot = await db.ref('users')
      .orderByChild('usertype')
      .equalTo('driver')
      .once('value');
    
    if (!driversSnapshot.exists()) {
      console.log('⚠️  Nenhum motorista encontrado no Firebase');
      return;
    }
    
    const drivers = driversSnapshot.val();
    const driverIds = Object.keys(drivers);
    
    console.log(`📊 Total de motoristas encontrados: ${driverIds.length}\n`);
    
    // 2. Verificar Redis GEO
    try {
      const redis = redisPool.getConnection();
      if (redis.status !== 'ready' && redis.status !== 'connect') {
        await redis.connect();
      }
      
      const totalInGeo = await redis.zcard('driver_locations');
      console.log(`📍 Motoristas no Redis GEO: ${totalInGeo}\n`);
    } catch (redisError) {
      console.warn(`⚠️  Erro ao verificar Redis GEO: ${redisError.message}\n`);
    }
    
    // 3. Verificar cada motorista
    let availableCount = 0;
    let totalIssues = 0;
    
    for (let i = 0; i < driverIds.length; i++) {
      const driverId = driverIds[i];
      const driver = drivers[driverId];
      
      console.log(`\n[${i + 1}/${driverIds.length}] ${driver.firstName} ${driver.lastName} (${driverId.substring(0, 12)}...)`);
      
      const status = await checkDriverStatus(driverId);
      
      if (status.available) {
        availableCount++;
        console.log(`   ✅ DISPONÍVEL`);
      } else {
        console.log(`   ❌ NÃO DISPONÍVEL`);
        if (status.issues.length > 0) {
          status.issues.forEach(issue => console.log(`      ${issue}`));
          totalIssues += status.issues.length;
        }
      }
      
      // Mostrar detalhes
      console.log(`   📋 Firebase:`, {
        usertype: status.firebase.usertype,
        approved: status.firebase.approved,
        driverActiveStatus: status.firebase.driverActiveStatus,
        carType: status.firebase.carType
      });
      console.log(`   📋 Redis:`, {
        exists: status.redis.exists,
        isOnline: status.redis.isOnline,
        status: status.redis.status,
        carType: status.redis.carType,
        inGeo: status.redis.inGeo
      });
    }
    
    // 4. Resumo
    console.log('\n' + '='.repeat(60));
    console.log('📊 RESUMO:');
    console.log('='.repeat(60));
    console.log(`Total de motoristas: ${driverIds.length}`);
    console.log(`✅ Disponíveis: ${availableCount}`);
    console.log(`❌ Não disponíveis: ${driverIds.length - availableCount}`);
    console.log(`⚠️  Total de problemas encontrados: ${totalIssues}`);
    console.log('='.repeat(60) + '\n');
    
    if (availableCount === 0) {
      console.log('💡 RECOMENDAÇÕES:');
      console.log('   1. Execute: node scripts/update-drivers-cartype.js');
      console.log('   2. Execute: node scripts/create-test-drivers.js [lat] [lng]');
      console.log('   3. Verifique se o Redis está rodando e acessível\n');
    }
    
  } catch (error) {
    console.error('❌ Erro fatal:', error);
    process.exit(1);
  }
}

// Executar
main();

