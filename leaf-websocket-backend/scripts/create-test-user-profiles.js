/**
 * Script para criar perfis no Realtime Database para usuários de teste
 * que já existem no Firebase Auth mas não têm perfil no Realtime Database
 * 
 * Uso: node scripts/create-test-user-profiles.js
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

// UIDs dos usuários de teste (já existem no Firebase Auth)
const TEST_USERS = {
  passenger: {
    uid: 'gyEGB07CssbnsACPJlywos40yaK2',
    phone: '+5511999999999',
    email: 'joao.teste@leaf.com',
    firstName: 'João',
    lastName: 'Silva Teste',
    cpf: '12345678901',
    usertype: 'customer',
    userType: 'customer'
  },
  driver: {
    uid: 'G62Nd6i22GhxhFm9R3PT08d0Ouw2',
    phone: '+5511888888888',
    email: 'maria.teste@leaf.com',
    firstName: 'Maria',
    lastName: 'Santos Teste',
    cpf: '98765432109',
    usertype: 'driver',
    userType: 'driver'
  }
};

/**
 * Criar perfil do passageiro no Realtime Database
 */
async function createPassengerProfile() {
  const user = TEST_USERS.passenger;
  
  console.log(`\n👤 Criando perfil do passageiro (${user.uid})...`);
  
  try {
    // Verificar se usuário existe no Firebase Auth
    try {
      const userRecord = await auth.getUser(user.uid);
      console.log(`✅ Usuário encontrado no Firebase Auth: ${userRecord.email || userRecord.phoneNumber}`);
    } catch (error) {
      if (error.code === 'auth/user-not-found') {
        console.error(`❌ Usuário não encontrado no Firebase Auth: ${user.uid}`);
        console.error('   Por favor, crie o usuário no Firebase Auth primeiro.');
        return false;
      }
      throw error;
    }
    
    // Verificar se perfil já existe
    const existingProfile = await db.ref(`users/${user.uid}`).once('value');
    if (existingProfile.val()) {
      console.log(`⚠️  Perfil já existe no Realtime Database`);
      const update = await question('Deseja atualizar o perfil? (s/N): ');
      if (update.toLowerCase() !== 's' && update.toLowerCase() !== 'sim') {
        console.log('❌ Operação cancelada');
        return false;
      }
    }
    
    // Dados do perfil do passageiro
    const profileData = {
      uid: user.uid,
      firstName: user.firstName,
      lastName: user.lastName,
      name: `${user.firstName} ${user.lastName}`,
      email: user.email,
      mobile: user.phone,
      phone: user.phone,
      phoneNumber: user.phone,
      cpf: user.cpf,
      usertype: user.usertype,
      userType: user.userType,
      approved: true, // Customer sempre aprovado
      phoneValidated: true,
      profileComplete: true,
      onboardingCompleted: true,
      walletBalance: 500, // Saldo inicial para testes
      rating: 4.9,
      totalRides: 0,
      totalSpent: 0,
      referralId: `leaf${Math.floor(1000 + Math.random() * 9000)}`,
      profile_image: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastLogin: new Date().toISOString(),
      // Dados específicos de customer
      customerData: {
        preferredPaymentMethod: 'credit_card',
        hasValidPayment: true,
        totalRides: 0,
        totalSpent: 0,
        favoriteLocations: [],
        emergencyContact: {
          name: 'Contato de Emergência',
          phone: '+5511999999998'
        }
      }
    };
    
    // Salvar no Realtime Database
    await db.ref(`users/${user.uid}`).set(profileData);
    console.log(`✅ Perfil do passageiro criado/atualizado com sucesso!`);
    console.log(`   📍 Caminho: users/${user.uid}`);
    
    return true;
  } catch (error) {
    console.error(`❌ Erro ao criar perfil do passageiro:`, error);
    return false;
  }
}

/**
 * Criar perfil do motorista no Realtime Database
 */
async function createDriverProfile() {
  const user = TEST_USERS.driver;
  
  console.log(`\n🚗 Criando perfil do motorista (${user.uid})...`);
  
  try {
    // Verificar se usuário existe no Firebase Auth
    try {
      const userRecord = await auth.getUser(user.uid);
      console.log(`✅ Usuário encontrado no Firebase Auth: ${userRecord.email || userRecord.phoneNumber}`);
    } catch (error) {
      if (error.code === 'auth/user-not-found') {
        console.error(`❌ Usuário não encontrado no Firebase Auth: ${user.uid}`);
        console.error('   Por favor, crie o usuário no Firebase Auth primeiro.');
        return false;
      }
      throw error;
    }
    
    // Verificar se perfil já existe
    const existingProfile = await db.ref(`users/${user.uid}`).once('value');
    if (existingProfile.val()) {
      console.log(`⚠️  Perfil já existe no Realtime Database`);
      const update = await question('Deseja atualizar o perfil? (s/N): ');
      if (update.toLowerCase() !== 's' && update.toLowerCase() !== 'sim') {
        console.log('❌ Operação cancelada');
        return false;
      }
    }
    
    // Dados do perfil do motorista
    const profileData = {
      uid: user.uid,
      firstName: user.firstName,
      lastName: user.lastName,
      name: `${user.firstName} ${user.lastName}`,
      email: user.email,
      mobile: user.phone,
      phone: user.phone,
      phoneNumber: user.phone,
      cpf: user.cpf,
      usertype: user.usertype,
      userType: user.userType,
      approved: true, // Motorista aprovado
      isApproved: true,
      driverActiveStatus: true,
      phoneValidated: true,
      profileComplete: true,
      onboardingCompleted: true,
      cnhUploaded: true,
      walletBalance: 1000, // Saldo inicial para testes
      rating: 4.8,
      totalRides: 0,
      totalEarned: 0,
      queue: false,
      referralId: `leaf${Math.floor(1000 + Math.random() * 9000)}`,
      profile_image: null,
      // Dados do veículo
      carType: 'Leaf Plus',
      carModel: 'Honda Civic',
      carPlate: 'ABC1234',
      vehicleNumber: 'ABC1234',
      vehicleMake: 'Honda',
      vehicleModel: 'Civic',
      vehicleYear: '2020',
      vehicleColor: 'Prata',
      carApproved: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastLogin: new Date().toISOString()
    };
    
    // Salvar no Realtime Database
    await db.ref(`users/${user.uid}`).set(profileData);
    console.log(`✅ Perfil do motorista criado/atualizado com sucesso!`);
    console.log(`   📍 Caminho: users/${user.uid}`);
    
    // Criar veículo separado também (se necessário)
    try {
      const vehicleData = {
        driver: user.uid,
        vehicleMake: 'Honda',
        vehicleModel: 'Civic',
        vehicleYear: '2020',
        vehicleColor: 'Prata',
        vehicleNumber: 'ABC1234',
        carType: 'Leaf Plus',
        other_info: 'Veículo de teste para App Store/Play Store',
        active: true,
        approved: true,
        carApproved: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      
      const vehicleRef = db.ref('vehicles').push();
      await vehicleRef.set(vehicleData);
      const vehicleId = vehicleRef.key;
      
      // Atualizar perfil com ID do veículo
      await db.ref(`users/${user.uid}`).update({ vehicleId: vehicleId });
      console.log(`✅ Veículo criado: ${vehicleId}`);
    } catch (vehicleError) {
      console.warn(`⚠️  Erro ao criar veículo (não crítico):`, vehicleError.message);
    }
    
    return true;
  } catch (error) {
    console.error(`❌ Erro ao criar perfil do motorista:`, error);
    return false;
  }
}

/**
 * Função helper para perguntas (simples, sem readline)
 */
function question(query) {
  return new Promise((resolve) => {
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

/**
 * Função principal
 */
async function main() {
  console.log('🚀 Criando perfis no Realtime Database para usuários de teste\n');
  console.log('📋 UIDs que serão processados:');
  console.log(`   Passageiro: ${TEST_USERS.passenger.uid}`);
  console.log(`   Motorista: ${TEST_USERS.driver.uid}\n`);
  
  let successCount = 0;
  
  // Criar perfil do passageiro
  const passengerSuccess = await createPassengerProfile();
  if (passengerSuccess) successCount++;
  
  // Criar perfil do motorista
  const driverSuccess = await createDriverProfile();
  if (driverSuccess) successCount++;
  
  // Resumo
  console.log('\n' + '='.repeat(60));
  console.log('📊 RESUMO:');
  console.log(`   ✅ Perfis criados/atualizados: ${successCount}/2`);
  console.log('='.repeat(60));
  
  if (successCount === 2) {
    console.log('\n✅ Todos os perfis foram criados com sucesso!');
    console.log('\n📝 Próximos passos:');
    console.log('   1. Verificar no Firebase Console → Realtime Database → users/');
    console.log('   2. Verificar no Dashboard → Usuários');
    console.log('   3. Testar login com os usuários de teste');
  } else {
    console.log('\n⚠️  Alguns perfis não foram criados. Verifique os erros acima.');
  }
  
  process.exit(successCount === 2 ? 0 : 1);
}

// Executar
main().catch((error) => {
  console.error('❌ Erro fatal:', error);
  process.exit(1);
});


