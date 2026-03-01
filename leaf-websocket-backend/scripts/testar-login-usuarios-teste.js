/**
 * Script para testar login dos usuários de teste
 * Testa: Email + Senha, Telefone + Senha, e verifica perfis
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
    uid: 'iDiAKrLjeDWbIOYFEqkHLS3JBGN2',
    email: 'joao.teste@leaf.com',
    password: 'teste123',
    phone: '+5511999999999',
    name: 'João Silva Teste'
  },
  driver: {
    uid: '5zgeX92yleYa2wH8JnMvqOU76fX2',
    email: 'maria.teste@leaf.com',
    password: 'teste123',
    phone: '+5511888888888',
    name: 'Maria Santos Teste'
  }
};

/**
 * Testar login por email + senha (simulado)
 */
async function testEmailPasswordLogin(user) {
  console.log(`\n🔐 Testando login por Email + Senha...`);
  console.log(`   Email: ${user.email}`);
  console.log(`   Senha: ${user.password}`);
  
  try {
    // Verificar se usuário existe
    const userRecord = await auth.getUserByEmail(user.email);
    
    if (userRecord.uid !== user.uid) {
      console.log(`   ⚠️  UID diferente! Esperado: ${user.uid}, Real: ${userRecord.uid}`);
      return { success: false, error: 'UID mismatch' };
    }
    
    console.log(`   ✅ Usuário encontrado no Firebase Auth`);
    console.log(`   📋 UID: ${userRecord.uid}`);
    console.log(`   📧 Email: ${userRecord.email}`);
    console.log(`   📱 Telefone: ${userRecord.phoneNumber || 'N/A'}`);
    console.log(`   ✅ Email verificado: ${userRecord.emailVerified}`);
    
    // Verificar se senha está configurada (não podemos testar diretamente, mas podemos verificar se o usuário existe)
    // O Firebase Admin SDK não permite testar senha diretamente, mas podemos verificar se o usuário pode ser autenticado
    // Para isso, precisaríamos usar o Firebase Client SDK, mas aqui vamos apenas verificar se o usuário existe
    
    return { success: true, userRecord };
  } catch (error) {
    if (error.code === 'auth/user-not-found') {
      console.log(`   ❌ Usuário não encontrado no Firebase Auth`);
      return { success: false, error: 'User not found' };
    }
    console.error(`   ❌ Erro:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * Verificar perfil no Realtime Database
 */
async function verifyProfile(user) {
  console.log(`\n💾 Verificando perfil no Realtime Database...`);
  console.log(`   Caminho: users/${user.uid}`);
  
  try {
    const snapshot = await db.ref(`users/${user.uid}`).once('value');
    
    if (!snapshot.val()) {
      console.log(`   ❌ Perfil não encontrado no Realtime Database`);
      return { success: false, error: 'Profile not found' };
    }
    
    const profile = snapshot.val();
    console.log(`   ✅ Perfil encontrado!`);
    console.log(`   📋 Nome: ${profile.firstName || ''} ${profile.lastName || ''}`);
    console.log(`   📧 Email: ${profile.email || 'N/A'}`);
    console.log(`   📱 Telefone: ${profile.mobile || profile.phone || 'N/A'}`);
    console.log(`   👤 Tipo: ${profile.usertype || profile.userType || 'N/A'}`);
    console.log(`   ✅ Aprovado: ${profile.approved || profile.isApproved || false}`);
    console.log(`   💰 Saldo: R$ ${(profile.walletBalance || 0).toFixed(2)}`);
    console.log(`   ⭐ Rating: ${profile.rating || 'N/A'}`);
    
    if (profile.usertype === 'driver' || profile.userType === 'driver') {
      console.log(`   🚗 Veículo: ${profile.carModel || 'N/A'} - ${profile.carPlate || 'N/A'}`);
      console.log(`   ✅ Veículo aprovado: ${profile.carApproved || false}`);
    }
    
    return { success: true, profile };
  } catch (error) {
    console.error(`   ❌ Erro ao verificar perfil:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * Verificar se senha está configurada (indiretamente)
 */
async function verifyPassword(user) {
  console.log(`\n🔑 Verificando senha...`);
  
  try {
    // Não podemos testar senha diretamente com Admin SDK
    // Mas podemos verificar se o usuário tem provider de senha
    const userRecord = await auth.getUser(user.uid);
    
    const hasPasswordProvider = userRecord.providerData.some(
      provider => provider.providerId === 'password'
    );
    
    if (hasPasswordProvider) {
      console.log(`   ✅ Provider de senha configurado`);
      console.log(`   ℹ️  Senha configurada: ${user.password}`);
      console.log(`   ⚠️  Nota: Não podemos testar senha diretamente com Admin SDK`);
      console.log(`   ⚠️  Para testar senha real, use o app ou Firebase Client SDK`);
      return { success: true, hasPassword: true };
    } else {
      console.log(`   ❌ Provider de senha NÃO configurado`);
      return { success: false, error: 'Password provider not configured' };
    }
  } catch (error) {
    console.error(`   ❌ Erro ao verificar senha:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * Testar usuário completo
 */
async function testUser(user, userType) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🧪 TESTANDO: ${user.name.toUpperCase()} (${userType})`);
  console.log('='.repeat(60));
  
  const results = {
    emailLogin: await testEmailPasswordLogin(user),
    profile: await verifyProfile(user),
    password: await verifyPassword(user)
  };
  
  const allSuccess = results.emailLogin.success && 
                     results.profile.success && 
                     results.password.success;
  
  return { success: allSuccess, results, user };
}

/**
 * Função principal
 */
async function main() {
  console.log('🧪 TESTE DE LOGIN DOS USUÁRIOS DE TESTE\n');
  console.log('Este script verifica:');
  console.log('  ✅ Existência no Firebase Auth');
  console.log('  ✅ Perfil no Realtime Database');
  console.log('  ✅ Configuração de senha');
  console.log('  ⚠️  Nota: Login real precisa ser testado no app\n');
  
  const results = {
    passenger: await testUser(TEST_USERS.passenger, 'Passageiro'),
    driver: await testUser(TEST_USERS.driver, 'Motorista')
  };
  
  // Resumo
  console.log(`\n${'='.repeat(60)}`);
  console.log('📊 RESUMO DOS TESTES');
  console.log('='.repeat(60));
  
  console.log(`\n👤 PASSAGEIRO:`);
  console.log(`   Firebase Auth: ${results.passenger.results.emailLogin.success ? '✅' : '❌'}`);
  console.log(`   Realtime Database: ${results.passenger.results.profile.success ? '✅' : '❌'}`);
  console.log(`   Senha configurada: ${results.passenger.results.password.success ? '✅' : '❌'}`);
  console.log(`   Status geral: ${results.passenger.success ? '✅ OK' : '❌ FALHOU'}`);
  
  console.log(`\n🚗 MOTORISTA:`);
  console.log(`   Firebase Auth: ${results.driver.results.emailLogin.success ? '✅' : '❌'}`);
  console.log(`   Realtime Database: ${results.driver.results.profile.success ? '✅' : '❌'}`);
  console.log(`   Senha configurada: ${results.driver.results.password.success ? '✅' : '❌'}`);
  console.log(`   Status geral: ${results.driver.success ? '✅ OK' : '❌ FALHOU'}`);
  
  console.log(`\n${'='.repeat(60)}`);
  
  if (results.passenger.success && results.driver.success) {
    console.log('✅ TODOS OS TESTES PASSARAM!');
    console.log('\n📝 Credenciais para testar no app:');
    console.log('\n   PASSAGEIRO:');
    console.log(`   - Telefone: ${TEST_USERS.passenger.phone.replace('+55', '')}`);
    console.log(`   - Email: ${TEST_USERS.passenger.email}`);
    console.log(`   - Senha: ${TEST_USERS.passenger.password}`);
    console.log(`   - OTP: 000000 (código fixo para números de teste)`);
    console.log('\n   MOTORISTA:');
    console.log(`   - Telefone: ${TEST_USERS.driver.phone.replace('+55', '')}`);
    console.log(`   - Email: ${TEST_USERS.driver.email}`);
    console.log(`   - Senha: ${TEST_USERS.driver.password}`);
    console.log(`   - OTP: 000000 (código fixo para números de teste)`);
  } else {
    console.log('⚠️  ALGUNS TESTES FALHARAM');
    console.log('   Verifique os erros acima');
  }
  
  console.log(`\n${'='.repeat(60)}`);
  
  process.exit(
    results.passenger.success && results.driver.success ? 0 : 1
  );
}

// Executar
main().catch((error) => {
  console.error('❌ Erro fatal:', error);
  process.exit(1);
});


