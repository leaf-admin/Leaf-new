/**
 * Script para criar usuários de teste COMPLETOS do zero
 * Cria: Firebase Auth + Realtime Database + Veículo (motorista)
 * 
 * Uso: node scripts/criar-usuarios-teste-completo.js
 */

const admin = require('firebase-admin');
const path = require('path');

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

// Dados dos usuários de teste
const TEST_USERS = {
  passenger: {
    email: 'joao.teste@leaf.com',
    password: 'teste123',
    phone: '+5511999999999',
    firstName: 'João',
    lastName: 'Silva Teste',
    cpf: '12345678901',
    usertype: 'customer'
  },
  driver: {
    email: 'maria.teste@leaf.com',
    password: 'teste123',
    phone: '+5511888888888',
    firstName: 'Maria',
    lastName: 'Santos Teste',
    cpf: '98765432109',
    usertype: 'driver',
    vehicle: {
      make: 'Honda',
      model: 'Civic',
      year: '2020',
      color: 'Prata',
      plate: 'ABC1234',
      carType: 'Leaf Plus'
    }
  }
};

/**
 * Criar usuário completo (Auth + Realtime Database)
 */
async function createCompleteUser(userData, isDriver = false) {
  const userType = isDriver ? 'motorista' : 'passageiro';
  console.log(`\n${'='.repeat(60)}`);
  console.log(`👤 Criando ${userType}: ${userData.firstName} ${userData.lastName}`);
  console.log('='.repeat(60));
  
  let userRecord;
  let createdAuth = false;
  
  // 1. Criar no Firebase Auth
  try {
    console.log(`\n1️⃣ Criando no Firebase Auth...`);
    console.log(`   Email: ${userData.email}`);
    console.log(`   Telefone: ${userData.phone}`);
    
    // Verificar se já existe
    try {
      const existing = await auth.getUserByEmail(userData.email);
      console.log(`   ⚠️  Usuário já existe no Firebase Auth (UID: ${existing.uid})`);
      userRecord = existing;
      
      // Atualizar senha
      await auth.updateUser(existing.uid, { password: userData.password });
      console.log(`   ✅ Senha atualizada`);
    } catch (error) {
      if (error.code === 'auth/user-not-found') {
        // Criar novo usuário
        userRecord = await auth.createUser({
          email: userData.email,
          password: userData.password,
          displayName: `${userData.firstName} ${userData.lastName}`,
          phoneNumber: userData.phone,
          emailVerified: true,
          disabled: false
        });
        createdAuth = true;
        console.log(`   ✅ Usuário criado no Firebase Auth`);
        console.log(`   📋 UID: ${userRecord.uid}`);
      } else {
        throw error;
      }
    }
  } catch (error) {
    console.error(`   ❌ Erro ao criar no Firebase Auth:`, error);
    return { success: false, error: error.message };
  }
  
  const uid = userRecord.uid;
  
  // 2. Criar perfil no Realtime Database
  try {
    console.log(`\n2️⃣ Criando perfil no Realtime Database...`);
    console.log(`   Caminho: users/${uid}`);
    
    const profileData = {
      uid: uid,
      firstName: userData.firstName,
      lastName: userData.lastName,
      name: `${userData.firstName} ${userData.lastName}`,
      email: userData.email,
      mobile: userData.phone,
      phone: userData.phone,
      phoneNumber: userData.phone,
      cpf: userData.cpf,
      usertype: userData.usertype,
      userType: userData.usertype,
      approved: true,
      isApproved: true,
      phoneValidated: true,
      profileComplete: true,
      onboardingCompleted: true,
      walletBalance: isDriver ? 1000 : 500,
      rating: isDriver ? 4.8 : 4.9,
      totalRides: 0,
      referralId: `leaf${Math.floor(1000 + Math.random() * 9000)}`,
      profile_image: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastLogin: new Date().toISOString()
    };
    
    // Dados específicos por tipo
    if (isDriver) {
      profileData.driverActiveStatus = true;
      profileData.queue = false;
      profileData.cnhUploaded = true;
      profileData.carType = userData.vehicle.carType;
      profileData.carModel = userData.vehicle.model;
      profileData.carPlate = userData.vehicle.plate;
      profileData.vehicleNumber = userData.vehicle.plate;
      profileData.vehicleMake = userData.vehicle.make;
      profileData.vehicleModel = userData.vehicle.model;
      profileData.vehicleYear = userData.vehicle.year;
      profileData.vehicleColor = userData.vehicle.color;
      profileData.carApproved = true;
      profileData.totalEarned = 0;
    } else {
      profileData.totalSpent = 0;
      profileData.customerData = {
        preferredPaymentMethod: 'credit_card',
        hasValidPayment: true,
        totalRides: 0,
        totalSpent: 0,
        favoriteLocations: [],
        emergencyContact: {
          name: 'Contato de Emergência',
          phone: '+5511999999998'
        }
      };
    }
    
    // Verificar se já existe
    const existing = await db.ref(`users/${uid}`).once('value');
    if (existing.val()) {
      console.log(`   ⚠️  Perfil já existe, atualizando...`);
      await db.ref(`users/${uid}`).update(profileData);
      console.log(`   ✅ Perfil atualizado no Realtime Database`);
    } else {
      await db.ref(`users/${uid}`).set(profileData);
      console.log(`   ✅ Perfil criado no Realtime Database`);
    }
  } catch (error) {
    console.error(`   ❌ Erro ao criar perfil no Realtime Database:`, error);
    return { success: false, error: error.message, uid };
  }
  
  // 3. Criar veículo (apenas para motorista)
  let vehicleId = null;
  if (isDriver && userData.vehicle) {
    try {
      console.log(`\n3️⃣ Criando veículo...`);
      
      const vehicleData = {
        driver: uid,
        vehicleMake: userData.vehicle.make,
        vehicleModel: userData.vehicle.model,
        vehicleYear: userData.vehicle.year,
        vehicleColor: userData.vehicle.color,
        vehicleNumber: userData.vehicle.plate,
        carType: userData.vehicle.carType,
        other_info: 'Veículo de teste para App Store/Play Store',
        active: true,
        approved: true,
        carApproved: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      
      const vehicleRef = db.ref('vehicles').push();
      await vehicleRef.set(vehicleData);
      vehicleId = vehicleRef.key;
      
      // Atualizar perfil com ID do veículo
      await db.ref(`users/${uid}`).update({ vehicleId: vehicleId });
      
      console.log(`   ✅ Veículo criado: ${vehicleId}`);
      console.log(`   📋 Placa: ${userData.vehicle.plate}`);
    } catch (error) {
      console.warn(`   ⚠️  Erro ao criar veículo (não crítico):`, error.message);
    }
  }
  
  return {
    success: true,
    uid,
    email: userData.email,
    phone: userData.phone,
    password: userData.password,
    vehicleId
  };
}

/**
 * Função principal
 */
async function main() {
  console.log('🚀 CRIANDO USUÁRIOS DE TESTE COMPLETOS\n');
  console.log('Este script criará:');
  console.log('  ✅ Firebase Auth (autenticação)');
  console.log('  ✅ Realtime Database (perfis)');
  console.log('  ✅ Veículo (motorista)\n');
  
  const results = {};
  
  // Criar passageiro
  results.passenger = await createCompleteUser(TEST_USERS.passenger, false);
  
  // Criar motorista
  results.driver = await createCompleteUser(TEST_USERS.driver, true);
  
  // Resumo
  console.log(`\n${'='.repeat(60)}`);
  console.log('📊 RESUMO');
  console.log('='.repeat(60));
  
  if (results.passenger.success) {
    console.log(`\n✅ PASSAGEIRO CRIADO:`);
    console.log(`   UID: ${results.passenger.uid}`);
    console.log(`   Email: ${results.passenger.email}`);
    console.log(`   Telefone: ${results.passenger.phone}`);
    console.log(`   Senha: ${results.passenger.password}`);
  } else {
    console.log(`\n❌ ERRO AO CRIAR PASSAGEIRO: ${results.passenger.error}`);
  }
  
  if (results.driver.success) {
    console.log(`\n✅ MOTORISTA CRIADO:`);
    console.log(`   UID: ${results.driver.uid}`);
    console.log(`   Email: ${results.driver.email}`);
    console.log(`   Telefone: ${results.driver.phone}`);
    console.log(`   Senha: ${results.driver.password}`);
    if (results.driver.vehicleId) {
      console.log(`   Veículo ID: ${results.driver.vehicleId}`);
    }
  } else {
    console.log(`\n❌ ERRO AO CRIAR MOTORISTA: ${results.driver.error}`);
  }
  
  console.log(`\n${'='.repeat(60)}`);
  
  if (results.passenger.success && results.driver.success) {
    console.log('✅ Todos os usuários foram criados com sucesso!');
    console.log('\n📝 Próximos passos:');
    console.log('   1. Atualizar documentos com os novos UIDs');
    console.log('   2. Verificar no Firebase Console');
    console.log('   3. Testar login no app');
  } else {
    console.log('⚠️  Alguns usuários não foram criados. Verifique os erros acima.');
  }
  
  process.exit(
    results.passenger.success && results.driver.success ? 0 : 1
  );
}

// Executar
main().catch((error) => {
  console.error('❌ Erro fatal:', error);
  process.exit(1);
});


