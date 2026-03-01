/**
 * Script COMPLETO para garantir que TODOS os critérios sejam atendidos
 * Corrige Firebase, Redis, localização, status, carType, etc.
 * 
 * Uso: node scripts/fix-all-drivers-criteria.js
 */

const admin = require('firebase-admin');
const path = require('path');
const redisPool = require('../utils/redis-pool');
const driverLockManager = require('../services/driver-lock-manager');

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
const firestore = admin.firestore();

/**
 * Garantir que TODOS os critérios sejam atendidos para um motorista
 */
async function fixDriverCriteria(driverId, driver, index) {
  const fixes = {
    firebase: [],
    redis: [],
    locks: []
  };
  
  try {
    // ✅ 1. GARANTIR CAMPOS NO FIREBASE (users/${driverId})
    const carTypes = ['Leaf Plus', 'Leaf Elite'];
    const assignedCarType = carTypes[index % 2];
    
    const firebaseUpdates = {
      usertype: 'driver',
      userType: 'driver',
      approved: true,
      driverActiveStatus: true,
      carType: assignedCarType,
      isOnline: true,
      status: 'AVAILABLE'
    };
    
    // Atualizar campos que estão faltando ou incorretos
    for (const [key, value] of Object.entries(firebaseUpdates)) {
      const currentValue = driver[key];
      if (currentValue !== value) {
        await db.ref(`users/${driverId}/${key}`).set(value);
        fixes.firebase.push(`${key}: ${currentValue} → ${value}`);
      }
    }
    
    if (fixes.firebase.length > 0) {
      console.log(`   ✅ Firebase corrigido: ${fixes.firebase.join(', ')}`);
    }
    
    // ✅ 2. GARANTIR LOCALIZAÇÃO NO FIREBASE (locations/${driverId})
    const locationSnapshot = await db.ref(`locations/${driverId}`).once('value');
    let location = null;
    
    if (!locationSnapshot.exists()) {
      console.log(`   ⚠️  Sem localização, usando coordenadas padrão`);
      // Usar coordenadas do Rio de Janeiro como padrão
      location = {
        lat: -22.9208626,
        lng: -43.4059964,
        timestamp: admin.database.ServerValue.TIMESTAMP,
        platform: 'mobile',
        isOnline: true,
        last_updated: admin.database.ServerValue.TIMESTAMP
      };
      await db.ref(`locations/${driverId}`).set(location);
      fixes.firebase.push('localização criada');
    } else {
      location = locationSnapshot.val();
      // Garantir que isOnline está true
      if (location.isOnline !== true) {
        await db.ref(`locations/${driverId}/isOnline`).set(true);
        fixes.firebase.push('locations.isOnline: true');
      }
    }
    
    if (!location || !location.lat || !location.lng) {
      console.log(`   ❌ Localização inválida, pulando...`);
      return { success: false, fixes };
    }
    
    // ✅ 3. GARANTIR STATUS NO FIRESTORE (driver_status/${driverId})
    const driverStatusData = {
      uid: driverId,
      status: 'available',
      isOnline: true,
      lat: location.lat,
      lng: location.lng,
      lastUpdate: admin.firestore.FieldValue.serverTimestamp(),
      last_updated: admin.firestore.FieldValue.serverTimestamp(),
      synced_at: admin.firestore.FieldValue.serverTimestamp(),
      source: 'fix-script',
      rating: parseFloat(driver.rating || 5.0),
      carType: assignedCarType
    };
    
    await firestore.collection('driver_status').doc(driverId).set(driverStatusData, { merge: true });
    
    // ✅ 4. GARANTIR STATUS NO FIRESTORE (user_locations/${driverId})
    const userLocationData = {
      uid: driverId,
      lat: location.lat,
      lng: location.lng,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      platform: 'mobile',
      isOnline: true,
      last_updated: admin.firestore.FieldValue.serverTimestamp(),
      synced_at: admin.firestore.FieldValue.serverTimestamp(),
      source: 'fix-script'
    };
    
    await firestore.collection('user_locations').doc(driverId).set(userLocationData, { merge: true });
    
    // ✅ 5. GARANTIR HASH NO REDIS (driver:${driverId})
    const redis = redisPool.getConnection();
    if (redis.status !== 'ready' && redis.status !== 'connect') {
      await redis.connect();
    }
    
    const now = Date.now();
    const driverStatus = {
      id: driverId,
      isOnline: 'true',  // ✅ String 'true' (aceito pelo backend)
      status: 'AVAILABLE',  // ✅ 'AVAILABLE' (aceito pelo backend)
      lat: location.lat.toString(),
      lng: location.lng.toString(),
      heading: '0',
      speed: '0',
      lastUpdate: now.toString(),
      timestamp: now.toString(),
      lastSeen: new Date().toISOString(),
      rating: (driver.rating || 5.0).toString(),
      carType: assignedCarType,  // ✅ 'Leaf Plus' ou 'Leaf Elite'
      firstName: driver.firstName || '',
      lastName: driver.lastName || ''
    };
    
    // Verificar se hash existe
    const existingHash = await redis.hgetall(`driver:${driverId}`);
    if (!existingHash || Object.keys(existingHash).length === 0) {
      fixes.redis.push('hash criado');
    } else {
      // Verificar campos críticos
      if (existingHash.isOnline !== 'true') fixes.redis.push('isOnline corrigido');
      if (!['AVAILABLE', 'available', 'ONLINE'].includes(existingHash.status)) fixes.redis.push('status corrigido');
      if (!['Leaf Plus', 'Leaf Elite'].includes(existingHash.carType)) fixes.redis.push('carType corrigido');
    }
    
    await redis.hset(`driver:${driverId}`, driverStatus);
    
    // ✅ 6. GARANTIR QUE ESTÁ NO REDIS GEO (driver_locations)
    await redis.geoadd('driver_locations', location.lng, location.lat, driverId);
    
    // ✅ 7. GARANTIR TTL (90 segundos)
    await redis.expire(`driver:${driverId}`, 90);
    
    if (fixes.redis.length > 0) {
      console.log(`   ✅ Redis corrigido: ${fixes.redis.join(', ')}`);
    }
    
    // ✅ 8. GARANTIR QUE NÃO ESTÁ COM LOCK
    try {
      const lockStatus = await driverLockManager.isDriverLocked(driverId);
      if (lockStatus.isLocked) {
        console.log(`   🔓 Removendo lock do motorista...`);
        await driverLockManager.releaseLock(driverId);
        fixes.locks.push('lock removido');
      }
    } catch (lockError) {
      // Se driverLockManager não estiver disponível, continuar
      console.log(`   ⚠️  Não foi possível verificar lock: ${lockError.message}`);
    }
    
    return { success: true, fixes };
    
  } catch (error) {
    console.error(`   ❌ Erro: ${error.message}`);
    return { success: false, fixes, error: error.message };
  }
}

/**
 * Função principal
 */
async function main() {
  try {
    console.log('\n🔧 Garantindo que TODOS os critérios sejam atendidos...\n');
    
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
    const allFixes = [];
    
    // 2. Processar cada motorista
    for (let i = 0; i < driverIds.length; i++) {
      const driverId = driverIds[i];
      const driver = drivers[driverId];
      
      console.log(`[${i + 1}/${driverIds.length}] ${driver.firstName} ${driver.lastName} (${driverId.substring(0, 12)}...)`);
      
      const result = await fixDriverCriteria(driverId, driver, i);
      
      if (result.success) {
        fixed++;
        if (result.fixes.firebase.length > 0 || result.fixes.redis.length > 0 || result.fixes.locks.length > 0) {
          allFixes.push({
            driverId: driverId.substring(0, 12),
            fixes: result.fixes
          });
        }
        console.log(`   ✅ Todos os critérios atendidos\n`);
      } else {
        failed++;
        console.log(`   ❌ Falha: ${result.error || 'Erro desconhecido'}\n`);
      }
      
      // Pequeno delay
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // 3. Verificação final
    console.log('\n' + '='.repeat(60));
    console.log('📊 RESUMO FINAL:');
    console.log('='.repeat(60));
    console.log(`✅ Motoristas corrigidos: ${fixed}/${driverIds.length}`);
    console.log(`❌ Falhas: ${failed}/${driverIds.length}`);
    
    // Verificar Redis
    const redis = redisPool.getConnection();
    if (redis.status !== 'ready' && redis.status !== 'connect') {
      await redis.connect();
    }
    
    let hashCount = 0;
    let geoCount = 0;
    let availableCount = 0;
    
    for (const driverId of driverIds) {
      const hashExists = await redis.exists(`driver:${driverId}`);
      if (hashExists) hashCount++;
      
      const inGeo = await redis.zscore('driver_locations', driverId);
      if (inGeo !== null) geoCount++;
      
      if (hashExists) {
        const hash = await redis.hgetall(`driver:${driverId}`);
        const isOnline = hash.isOnline === 'true' || hash.isOnline === true;
        const isAvailable = ['AVAILABLE', 'available', 'ONLINE'].includes(hash.status);
        if (isOnline && isAvailable) availableCount++;
      }
    }
    
    console.log(`\n📊 Verificação Final:`);
    console.log(`   ✅ Hashes no Redis: ${hashCount}/${driverIds.length}`);
    console.log(`   ✅ Motoristas no GEO: ${geoCount}/${driverIds.length}`);
    console.log(`   ✅ Motoristas disponíveis: ${availableCount}/${driverIds.length}`);
    
    if (allFixes.length > 0) {
      console.log(`\n🔧 Correções aplicadas:`);
      allFixes.forEach(fix => {
        console.log(`   ${fix.driverId}...: ${JSON.stringify(fix.fixes)}`);
      });
    }
    
    console.log('='.repeat(60) + '\n');
    console.log('✅ Processo concluído! Todos os motoristas devem estar disponíveis agora.\n');
    
  } catch (error) {
    console.error('❌ Erro fatal:', error);
    process.exit(1);
  }
}

// Executar
main();

