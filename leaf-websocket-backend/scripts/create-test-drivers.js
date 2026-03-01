/**
 * Script para criar 20 motoristas de teste autenticados
 * Posiciona-os em um raio de 5km da localização atual do dispositivo
 * 
 * Uso: node scripts/create-test-drivers.js [latitude] [longitude]
 * Exemplo: node scripts/create-test-drivers.js -23.5505 -46.6333
 * 
 * Se não fornecer coordenadas, tentará obter do dispositivo conectado via adb
 */

const admin = require('firebase-admin');
const path = require('path');
const { execSync } = require('child_process');
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
const auth = admin.auth();
const firestore = admin.firestore();

/**
 * Obter localização do dispositivo conectado via adb
 */
function getDeviceLocation() {
  try {
    console.log('📱 Tentando obter localização do dispositivo conectado...');
    const result = execSync('adb shell dumpsys location | grep -A 5 "last location" | head -10', { encoding: 'utf-8' });
    
    // Tentar extrair latitude e longitude
    const latMatch = result.match(/latitude=([-\d.]+)/);
    const lngMatch = result.match(/longitude=([-\d.]+)/);
    
    if (latMatch && lngMatch) {
      const lat = parseFloat(latMatch[1]);
      const lng = parseFloat(lngMatch[1]);
      console.log(`✅ Localização obtida: ${lat}, ${lng}`);
      return { lat, lng };
    }
    
    // Tentar método alternativo
    const altResult = execSync('adb shell "dumpsys location | grep mLastLocation"', { encoding: 'utf-8' });
    const altLatMatch = altResult.match(/latitude=([-\d.]+)/);
    const altLngMatch = altResult.match(/longitude=([-\d.]+)/);
    
    if (altLatMatch && altLngMatch) {
      const lat = parseFloat(altLatMatch[1]);
      const lng = parseFloat(altLngMatch[1]);
      console.log(`✅ Localização obtida (método alternativo): ${lat}, ${lng}`);
      return { lat, lng };
    }
    
    throw new Error('Não foi possível extrair coordenadas');
  } catch (error) {
    console.warn('⚠️  Não foi possível obter localização do dispositivo:', error.message);
    return null;
  }
}

/**
 * Gerar coordenadas aleatórias em um raio de 5km
 */
function generateRandomLocation(centerLat, centerLng, radiusKm = 5) {
  // Converter raio para graus (aproximado)
  const radiusInDegrees = radiusKm / 111; // 1 grau ≈ 111 km
  
  // Gerar ângulo aleatório
  const angle = Math.random() * 2 * Math.PI;
  
  // Gerar distância aleatória (uniforme no círculo)
  const distance = Math.sqrt(Math.random()) * radiusInDegrees;
  
  // Calcular nova posição
  const lat = centerLat + (distance * Math.cos(angle));
  const lng = centerLng + (distance * Math.sin(angle) / Math.cos(centerLat * Math.PI / 180));
  
  return { lat, lng };
}

/**
 * Gerar dados de motorista
 */
function generateDriverData(index, location) {
  const firstNames = ['João', 'Maria', 'Pedro', 'Ana', 'Carlos', 'Juliana', 'Roberto', 'Fernanda', 'Ricardo', 'Patricia', 'Marcos', 'Camila', 'Lucas', 'Beatriz', 'Rafael', 'Mariana', 'Felipe', 'Gabriela', 'Thiago', 'Larissa'];
  const lastNames = ['Silva', 'Santos', 'Oliveira', 'Souza', 'Pereira', 'Costa', 'Rodrigues', 'Almeida', 'Nascimento', 'Lima', 'Araújo', 'Fernandes', 'Carvalho', 'Gomes', 'Martins', 'Rocha', 'Ribeiro', 'Alves', 'Monteiro', 'Mendes'];
  
  const vehicles = [
    { name: 'Honda Civic', year: 2020, color: 'Branco', plate: `ABC${1000 + index}` },
    { name: 'Toyota Corolla', year: 2019, color: 'Prata', plate: `DEF${2000 + index}` },
    { name: 'Volkswagen Jetta', year: 2021, color: 'Preto', plate: `GHI${3000 + index}` },
    { name: 'Chevrolet Onix', year: 2022, color: 'Vermelho', plate: `JKL${4000 + index}` },
    { name: 'Fiat Argo', year: 2021, color: 'Azul', plate: `MNO${5000 + index}` },
  ];
  
  const firstName = firstNames[index % firstNames.length];
  const lastName = lastNames[index % lastNames.length];
  const fullName = `${firstName} ${lastName}`;
  const email = `driver${index + 1}@leaf-test.com`;
  const phone = `+5511999${String(10000 + index).slice(-5)}`;
  const vehicle = vehicles[index % vehicles.length];
  
  return {
    firstName,
    lastName,
    fullName,
    email,
    phone,
    vehicle,
    location,
    rating: (4.0 + Math.random() * 1.0).toFixed(1), // 4.0 a 5.0
    totalRides: Math.floor(Math.random() * 500),
    cpf: `${String(100000000 + index).slice(-9)}${String(10 + index).slice(-2)}`, // CPF fake
  };
}

/**
 * Criar motorista no Firebase
 */
async function createDriver(driverData, index) {
  try {
    const { email, phone, fullName, firstName, lastName, vehicle, location, rating, totalRides, cpf } = driverData;
    
    // 1. Criar usuário no Firebase Authentication
    let userRecord;
    const password = `Driver${index + 1}@123`; // Senha padrão
    
    try {
      userRecord = await auth.createUser({
        email: email,
        password: password,
        displayName: fullName,
        phoneNumber: phone,
        emailVerified: true,
        disabled: false,
      });
      console.log(`✅ [${index + 1}/20] Usuário criado: ${email} (UID: ${userRecord.uid})`);
    } catch (error) {
      if (error.code === 'auth/email-already-exists') {
        console.log(`⚠️  [${index + 1}/20] Email já existe, buscando usuário: ${email}`);
        userRecord = await auth.getUserByEmail(email);
        // Atualizar senha
        await auth.updateUser(userRecord.uid, { password });
        console.log(`✅ [${index + 1}/20] Senha atualizada para usuário existente`);
      } else {
        throw error;
      }
    }
    
    const uid = userRecord.uid;
    const now = Date.now();
    const timestamp = admin.database.ServerValue.TIMESTAMP;
    
    // ✅ Distribuir motoristas entre Leaf Plus e Leaf Elite (50% cada)
    const carTypes = ['Leaf Plus', 'Leaf Elite'];
    const assignedCarType = carTypes[index % 2]; // Alterna entre os dois tipos
    
    // 2. Salvar no Realtime Database - users/{uid}
    const userData = {
      firstName,
      lastName,
      usertype: 'driver',
      userType: 'driver',
      email,
      mobile: phone,
      cpf,
      approved: true,
      driverActiveStatus: true,
      queue: false,
      profile_image: null,
      referralId: `leaf${Math.floor(1000 + Math.random() * 9000)}`,
      walletBalance: 0,
      rating: parseFloat(rating),
      totalRides,
      carType: assignedCarType, // ✅ Adicionar carType no Firebase também
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    
    await db.ref(`users/${uid}`).set(userData);
    console.log(`   📝 Dados salvos em users/${uid}`);
    
    // 3. Salvar localização em locations/{uid}
    const locationData = {
      lat: location.lat,
      lng: location.lng,
      timestamp: timestamp,
      platform: 'mobile',
      isOnline: true,
      last_updated: timestamp,
    };
    
    await db.ref(`locations/${uid}`).set(locationData);
    console.log(`   📍 Localização salva: ${location.lat.toFixed(6)}, ${location.lng.toFixed(6)}`);
    
    // 4. Salvar status do motorista em driver_status (Firestore)
    const driverStatusData = {
      uid,
      status: 'available',
      isOnline: true,
      lat: location.lat,
      lng: location.lng,
      lastUpdate: admin.firestore.FieldValue.serverTimestamp(),
      last_updated: admin.firestore.FieldValue.serverTimestamp(),
      synced_at: admin.firestore.FieldValue.serverTimestamp(),
      source: 'test-script',
      rating: parseFloat(rating),
      vehicle: {
        name: vehicle.name,
        year: vehicle.year,
        color: vehicle.color,
        plate: vehicle.plate,
      },
    };
    
    await firestore.collection('driver_status').doc(uid).set(driverStatusData);
    console.log(`   🚗 Status do motorista salvo em driver_status/${uid}`);
    
    // 5. Salvar em user_locations (Firestore) também
    const userLocationData = {
      uid,
      lat: location.lat,
      lng: location.lng,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      platform: 'mobile',
      isOnline: true,
      last_updated: admin.firestore.FieldValue.serverTimestamp(),
      synced_at: admin.firestore.FieldValue.serverTimestamp(),
      source: 'test-script',
    };
    
    await firestore.collection('user_locations').doc(uid).set(userLocationData);
    console.log(`   📍 Localização salva em user_locations/${uid}`);
    
    // 6. ✅ ADICIONAR AO REDIS GEO (CRÍTICO para busca funcionar)
    try {
      const redis = redisPool.getConnection();
      
      // Verificar se Redis está conectado
      if (redis.status !== 'ready' && redis.status !== 'connect') {
        await redis.connect();
      }
      
      // Salvar status do motorista no Redis
      const driverStatus = {
        id: uid,
        isOnline: 'true',
        status: 'AVAILABLE',
        lat: location.lat.toString(),
        lng: location.lng.toString(),
        heading: '0',
        speed: '0',
        lastUpdate: now.toString(),
        timestamp: now.toString(),
        lastSeen: new Date().toISOString(),
        rating: rating,
        carType: assignedCarType, // ✅ Usar "Leaf Plus" ou "Leaf Elite" ao invés do nome do veículo
        firstName: firstName,
        lastName: lastName,
      };
      
      console.log(`   🚗 Tipo de carro atribuído: ${assignedCarType}`);
      
      await redis.hset(`driver:${uid}`, driverStatus);
      
      // Adicionar ao Redis GEO (driver_locations)
      await redis.geoadd('driver_locations', location.lng, location.lat, uid);
      
      // TTL de 90 segundos (será renovado quando motorista atualizar localização)
      await redis.expire(`driver:${uid}`, 90);
      
      console.log(`   ✅ Motorista adicionado ao Redis GEO: ${location.lat.toFixed(6)}, ${location.lng.toFixed(6)}`);
    } catch (redisError) {
      console.warn(`   ⚠️  Erro ao adicionar motorista ao Redis (continuando):`, redisError.message);
      // Não falhar o script se Redis não estiver disponível
    }
    
    return {
      uid,
      email,
      password,
      location,
      success: true,
    };
  } catch (error) {
    console.error(`❌ [${index + 1}/20] Erro ao criar motorista ${driverData.email}:`, error.message);
    return {
      uid: null,
      email: driverData.email,
      password: null,
      location: driverData.location,
      success: false,
      error: error.message,
    };
  }
}

/**
 * Função principal
 */
async function main() {
  try {
    console.log('\n🚗 Criando 20 motoristas de teste...\n');
    
    // Obter localização
    let centerLat, centerLng;
    
    if (process.argv.length >= 4) {
      centerLat = parseFloat(process.argv[2]);
      centerLng = parseFloat(process.argv[3]);
      console.log(`📍 Usando coordenadas fornecidas: ${centerLat}, ${centerLng}`);
    } else {
      const deviceLocation = getDeviceLocation();
      if (deviceLocation) {
        centerLat = deviceLocation.lat;
        centerLng = deviceLocation.lng;
        console.log(`📍 Usando localização do dispositivo: ${centerLat}, ${centerLng}`);
      } else {
        console.log('⚠️  Não foi possível obter localização do dispositivo.');
        console.log('💡 Use: node scripts/create-test-drivers.js <latitude> <longitude>');
        console.log('💡 Exemplo: node scripts/create-test-drivers.js -23.5505 -46.6333');
        process.exit(1);
      }
    }
    
    if (isNaN(centerLat) || isNaN(centerLng)) {
      console.error('❌ Coordenadas inválidas');
      process.exit(1);
    }
    
    // Gerar 20 motoristas
    const results = [];
    for (let i = 0; i < 20; i++) {
      const location = generateRandomLocation(centerLat, centerLng, 5);
      const driverData = generateDriverData(i, location);
      const result = await createDriver(driverData, i);
      results.push(result);
      
      // Pequeno delay para evitar rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // Resumo
    console.log('\n📊 Resumo:\n');
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);
    
    console.log(`✅ Criados com sucesso: ${successful.length}/20`);
    console.log(`❌ Falhas: ${failed.length}/20\n`);
    
    if (successful.length > 0) {
      console.log('📋 Credenciais dos motoristas criados:\n');
      successful.forEach((result, index) => {
        console.log(`${index + 1}. Email: ${result.email}`);
        console.log(`   Senha: ${result.password}`);
        console.log(`   Localização: ${result.location.lat.toFixed(6)}, ${result.location.lng.toFixed(6)}`);
        console.log(`   UID: ${result.uid}\n`);
      });
    }
    
    if (failed.length > 0) {
      console.log('❌ Motoristas que falharam:\n');
      failed.forEach((result, index) => {
        console.log(`${index + 1}. Email: ${result.email}`);
        console.log(`   Erro: ${result.error}\n`);
      });
    }
    
    console.log('✅ Processo concluído!\n');
    
  } catch (error) {
    console.error('❌ Erro fatal:', error);
    process.exit(1);
  }
}

// Executar
main();

