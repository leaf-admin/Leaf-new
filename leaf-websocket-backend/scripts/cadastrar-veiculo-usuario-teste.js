/**
 * Script para cadastrar veículo para usuário de teste com telefone 21999999999
 * 
 * Uso: node scripts/cadastrar-veiculo-usuario-teste.js
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

// Telefone do usuário de teste
const TEST_PHONE = '+5521999999999';
const TEST_PHONE_NORMALIZED = '21999999999';

/**
 * Buscar usuário por telefone no Firebase Auth
 */
async function findUserInAuth(phone) {
  try {
    console.log(`\n🔍 Buscando usuário no Firebase Auth com telefone: ${phone}...`);
    
    const listUsersResult = await auth.listUsers(1000);
    const foundUser = listUsersResult.users.find(u => u.phoneNumber === phone);
    
    if (foundUser) {
      console.log(`✅ Usuário encontrado no Firebase Auth!`);
      console.log(`   UID: ${foundUser.uid}`);
      console.log(`   Email: ${foundUser.email || 'N/A'}`);
      console.log(`   Telefone: ${foundUser.phoneNumber || 'N/A'}`);
      return foundUser;
    }
    
    console.log('❌ Usuário não encontrado no Firebase Auth');
    return null;
  } catch (error) {
    console.error('❌ Erro ao buscar no Firebase Auth:', error);
    return null;
  }
}

/**
 * Buscar usuário por telefone no Realtime Database
 */
async function findUserByPhone(phone) {
  try {
    console.log(`\n🔍 Buscando usuário no Realtime Database com telefone: ${phone}...`);
    
    const usersRef = db.ref('users');
    const snapshot = await usersRef.once('value');
    
    if (!snapshot.exists()) {
      console.log('ℹ️  Nenhum usuário encontrado no banco');
      return null;
    }
    
    let foundUser = null;
    snapshot.forEach((childSnapshot) => {
      const userData = childSnapshot.val();
      const userPhone = userData?.mobile || userData?.phone || userData?.phoneNumber || '';
      const userPhoneNormalized = userPhone.replace(/\D/g, '');
      const searchPhoneNormalized = phone.replace(/\D/g, '');
      
      // Comparar números normalizados
      if (userPhoneNormalized === searchPhoneNormalized || 
          userPhoneNormalized === searchPhoneNormalized.replace(/^55/, '') ||
          userPhoneNormalized.replace(/^55/, '') === searchPhoneNormalized) {
        foundUser = {
          uid: childSnapshot.key,
          ...userData
        };
        return true; // Parar iteração
      }
    });
    
    if (foundUser) {
      console.log(`✅ Usuário encontrado no Realtime Database!`);
      console.log(`   UID: ${foundUser.uid}`);
      console.log(`   Nome: ${foundUser.firstName || ''} ${foundUser.lastName || ''}`);
      console.log(`   Telefone: ${foundUser.mobile || foundUser.phone || 'N/A'}`);
      console.log(`   Tipo: ${foundUser.usertype || foundUser.userType || 'N/A'}`);
      return foundUser;
    }
    
    console.log('ℹ️  Usuário não encontrado no Realtime Database');
    return null;
  } catch (error) {
    console.error('❌ Erro ao buscar usuário:', error);
    return null;
  }
}

/**
 * Criar usuário completo (Auth + Realtime Database)
 */
async function createCompleteUser(phone) {
  try {
    console.log(`\n📝 Criando usuário completo para ${phone}...`);
    
    // 1. Criar no Firebase Auth
    let authUser;
    try {
      authUser = await auth.createUser({
        phoneNumber: phone,
        email: `${phone.replace(/\D/g, '')}@leaf.com`,
        emailVerified: true,
        disabled: false
      });
      console.log(`   ✅ Usuário criado no Firebase Auth: ${authUser.uid}`);
    } catch (error) {
      if (error.code === 'auth/phone-number-already-exists') {
        // Buscar usuário existente
        const listUsersResult = await auth.listUsers(1000);
        authUser = listUsersResult.users.find(u => u.phoneNumber === phone);
        if (authUser) {
          console.log(`   ℹ️  Usuário já existe no Firebase Auth: ${authUser.uid}`);
        } else {
          throw error;
        }
      } else {
        throw error;
      }
    }
    
    // 2. Criar perfil no Realtime Database
    const profileData = {
      uid: authUser.uid,
      phone: phone,
      mobile: phone,
      phoneNumber: phone,
      email: authUser.email || `${phone.replace(/\D/g, '')}@leaf.com`,
      usertype: 'driver',
      userType: 'driver',
      firstName: 'Motorista',
      lastName: 'de Teste',
      name: 'Motorista de Teste',
      approved: true,
      isApproved: true,
      driverActiveStatus: true,
      phoneValidated: true,
      profileComplete: true,
      onboardingCompleted: true,
      cnhUploaded: true,
      walletBalance: 1000,
      rating: 4.8,
      totalRides: 0,
      totalEarned: 0,
      queue: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastLogin: new Date().toISOString()
    };
    
    await db.ref(`users/${authUser.uid}`).set(profileData);
    console.log(`   ✅ Perfil criado no Realtime Database`);
    
    return {
      uid: authUser.uid,
      ...profileData
    };
  } catch (error) {
    console.error('❌ Erro ao criar usuário:', error);
    return null;
  }
}

/**
 * Cadastrar veículo para o usuário
 */
async function registerVehicleForUser(userId, userData) {
  try {
    console.log(`\n🚗 Cadastrando veículo para usuário ${userId}...`);
    
    // Dados do veículo de teste
    const vehicleData = {
      driver: userId,
      driverId: userId,
      vehicleMake: 'Honda',
      vehicleModel: 'Civic',
      vehicleYear: '2020',
      vehicleColor: 'Prata',
      vehicleNumber: 'TEST2199',
      plate: 'TEST2199',
      carType: 'Leaf Plus',
      other_info: 'Veículo de teste para usuário 21999999999',
      active: true,
      approved: true,
      carApproved: true,
      status: 'approved',
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    // 1. Criar veículo na tabela vehicles
    const vehicleRef = db.ref('vehicles').push();
    await vehicleRef.set(vehicleData);
    const vehicleId = vehicleRef.key;
    console.log(`   ✅ Veículo criado na tabela vehicles: ${vehicleId}`);
    console.log(`   📋 Placa: ${vehicleData.vehicleNumber}`);
    
    // 2. Criar relacionamento em user_vehicles
    const userVehicleId = `${userId}_${vehicleId}_${Date.now()}`;
    const userVehicleData = {
      id: userVehicleId,
      userId: userId,
      vehicleId: vehicleId,
      status: 'approved',
      isActive: true,
      approved: true,
      carApproved: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    const userVehicleRef = db.ref(`user_vehicles/${userId}/${userVehicleId}`);
    await userVehicleRef.set(userVehicleData);
    console.log(`   ✅ Relacionamento criado em user_vehicles: ${userVehicleId}`);
    
    // 3. Atualizar perfil do usuário com dados do veículo
    const profileUpdates = {
      vehicleId: vehicleId,
      carType: vehicleData.carType,
      carModel: vehicleData.vehicleModel,
      carPlate: vehicleData.vehicleNumber,
      vehicleNumber: vehicleData.vehicleNumber,
      vehicleMake: vehicleData.vehicleMake,
      vehicleModel: vehicleData.vehicleModel,
      vehicleYear: vehicleData.vehicleYear,
      vehicleColor: vehicleData.vehicleColor,
      carApproved: true,
      updatedAt: new Date().toISOString()
    };
    
    await db.ref(`users/${userId}`).update(profileUpdates);
    console.log(`   ✅ Perfil do usuário atualizado com dados do veículo`);
    
    return {
      success: true,
      vehicleId: vehicleId,
      userVehicleId: userVehicleId,
      vehicleData: vehicleData
    };
    
  } catch (error) {
    console.error('❌ Erro ao cadastrar veículo:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Função principal
 */
async function main() {
  console.log('🚀 CADASTRANDO VEÍCULO PARA USUÁRIO DE TESTE\n');
  console.log(`📱 Telefone: ${TEST_PHONE}`);
  console.log('─'.repeat(50));
  
  try {
    // 1. Buscar usuário no Realtime Database
    let user = await findUserByPhone(TEST_PHONE);
    
    // 2. Se não encontrou no Database, buscar no Firebase Auth
    if (!user) {
      const authUser = await findUserInAuth(TEST_PHONE);
      
      if (authUser) {
        // Criar perfil no Realtime Database
        console.log('\n📝 Usuário existe no Auth mas não tem perfil no Database');
        user = await createUserProfile(authUser);
      } else {
        // Criar usuário completo do zero
        console.log('\n📝 Usuário não existe. Criando usuário completo...');
        user = await createCompleteUser(TEST_PHONE);
      }
    }
    
    if (!user) {
      console.log('\n❌ Não foi possível criar/encontrar o usuário!');
      process.exit(1);
    }
    
    // 2. Verificar se já tem veículo
    if (user.vehicleId || user.carPlate || user.vehicleNumber) {
      console.log('\n⚠️  Usuário já tem veículo cadastrado!');
      console.log(`   Vehicle ID: ${user.vehicleId || 'N/A'}`);
      console.log(`   Placa: ${user.carPlate || user.vehicleNumber || 'N/A'}`);
      
      // Perguntar se deseja atualizar (simular com process.argv)
      const forceUpdate = process.argv.includes('--force');
      if (!forceUpdate) {
        console.log('\n💡 Use --force para forçar atualização');
        process.exit(0);
      }
      console.log('   🔄 Forçando atualização...');
    }
    
    // 3. Cadastrar veículo
    const result = await registerVehicleForUser(user.uid, user);
    
    if (result.success) {
      console.log('\n✅ VEÍCULO CADASTRADO COM SUCESSO!');
      console.log('─'.repeat(50));
      console.log(`📋 Resumo:`);
      console.log(`   UID do usuário: ${user.uid}`);
      console.log(`   Vehicle ID: ${result.vehicleId}`);
      console.log(`   User Vehicle ID: ${result.userVehicleId}`);
      console.log(`   Placa: ${result.vehicleData.vehicleNumber}`);
      console.log(`   Modelo: ${result.vehicleData.vehicleMake} ${result.vehicleData.vehicleModel}`);
      console.log(`   Tipo: ${result.vehicleData.carType}`);
      console.log('\n✅ O usuário agora pode ficar online!');
    } else {
      console.log('\n❌ ERRO AO CADASTRAR VEÍCULO');
      console.log(`   Erro: ${result.error}`);
      process.exit(1);
    }
    
  } catch (error) {
    console.error('\n❌ Erro fatal:', error);
    process.exit(1);
  }
}

// Executar
main().then(() => {
  console.log('\n✅ Script concluído!');
  process.exit(0);
}).catch((error) => {
  console.error('\n❌ Erro fatal:', error);
  process.exit(1);
});

