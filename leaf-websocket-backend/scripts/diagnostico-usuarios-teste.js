/**
 * Script de diagnóstico para verificar onde os usuários de teste estão armazenados
 * Verifica: Firebase Auth, Realtime Database, Firestore
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
const firestore = admin.firestore();

// UIDs e dados dos usuários de teste
const TEST_USERS = {
  passenger: {
    uid: 'gyEGB07CssbnsACPJlywos40yaK2',
    phone: '+5511999999999',
    email: 'joao.teste@leaf.com',
    name: 'João Silva Teste'
  },
  driver: {
    uid: 'G62Nd6i22GhxhFm9R3PT08d0Ouw2',
    phone: '+5511888888888',
    email: 'maria.teste@leaf.com',
    name: 'Maria Santos Teste'
  }
};

/**
 * Verificar usuário no Firebase Auth
 */
async function checkFirebaseAuth(user) {
  console.log(`\n🔐 Verificando Firebase Auth para ${user.name}...`);
  console.log(`   UID: ${user.uid}`);
  console.log(`   Email: ${user.email}`);
  console.log(`   Telefone: ${user.phone}`);
  
  try {
    // Tentar buscar por UID
    try {
      const userRecord = await auth.getUser(user.uid);
      console.log(`   ✅ Usuário encontrado por UID!`);
      console.log(`      Email no Auth: ${userRecord.email || 'N/A'}`);
      console.log(`      Telefone no Auth: ${userRecord.phoneNumber || 'N/A'}`);
      console.log(`      Email verificado: ${userRecord.emailVerified || false}`);
      console.log(`      Desabilitado: ${userRecord.disabled || false}`);
      return { found: true, method: 'uid', userRecord };
    } catch (uidError) {
      if (uidError.code === 'auth/user-not-found') {
        console.log(`   ❌ Usuário NÃO encontrado por UID`);
      } else {
        console.log(`   ⚠️  Erro ao buscar por UID: ${uidError.message}`);
      }
    }
    
    // Tentar buscar por email
    try {
      const userRecord = await auth.getUserByEmail(user.email);
      console.log(`   ✅ Usuário encontrado por EMAIL!`);
      console.log(`      UID real: ${userRecord.uid}`);
      console.log(`      Email: ${userRecord.email}`);
      console.log(`      Telefone: ${userRecord.phoneNumber || 'N/A'}`);
      return { found: true, method: 'email', userRecord, realUid: userRecord.uid };
    } catch (emailError) {
      if (emailError.code === 'auth/user-not-found') {
        console.log(`   ❌ Usuário NÃO encontrado por email`);
      } else {
        console.log(`   ⚠️  Erro ao buscar por email: ${emailError.message}`);
      }
    }
    
    // Tentar buscar por telefone (se disponível)
    if (user.phone) {
      try {
        // Firebase Auth não tem método direto para buscar por telefone
        // Mas podemos listar todos e filtrar
        console.log(`   ℹ️  Buscando por telefone (listando todos os usuários)...`);
        const listUsersResult = await auth.listUsers(1000);
        const foundByPhone = listUsersResult.users.find(u => u.phoneNumber === user.phone);
        if (foundByPhone) {
          console.log(`   ✅ Usuário encontrado por TELEFONE!`);
          console.log(`      UID real: ${foundByPhone.uid}`);
          console.log(`      Email: ${foundByPhone.email || 'N/A'}`);
          return { found: true, method: 'phone', userRecord: foundByPhone, realUid: foundByPhone.uid };
        } else {
          console.log(`   ❌ Usuário NÃO encontrado por telefone`);
        }
      } catch (phoneError) {
        console.log(`   ⚠️  Erro ao buscar por telefone: ${phoneError.message}`);
      }
    }
    
    return { found: false };
  } catch (error) {
    console.error(`   ❌ Erro ao verificar Firebase Auth:`, error);
    return { found: false, error: error.message };
  }
}

/**
 * Verificar perfil no Realtime Database
 */
async function checkRealtimeDatabase(user) {
  console.log(`\n💾 Verificando Realtime Database para ${user.name}...`);
  console.log(`   Caminho: users/${user.uid}`);
  
  try {
    const snapshot = await db.ref(`users/${user.uid}`).once('value');
    if (snapshot.val()) {
      const data = snapshot.val();
      console.log(`   ✅ Perfil encontrado no Realtime Database!`);
      console.log(`      Nome: ${data.firstName || ''} ${data.lastName || ''}`);
      console.log(`      Tipo: ${data.usertype || data.userType || 'N/A'}`);
      console.log(`      Email: ${data.email || 'N/A'}`);
      console.log(`      Telefone: ${data.mobile || data.phone || 'N/A'}`);
      console.log(`      Aprovado: ${data.approved || data.isApproved || false}`);
      return { found: true, data };
    } else {
      console.log(`   ❌ Perfil NÃO encontrado no Realtime Database`);
      return { found: false };
    }
  } catch (error) {
    console.error(`   ❌ Erro ao verificar Realtime Database:`, error);
    return { found: false, error: error.message };
  }
}

/**
 * Verificar perfil no Firestore
 */
async function checkFirestore(user) {
  console.log(`\n🔥 Verificando Firestore para ${user.name}...`);
  console.log(`   Collection: users/${user.uid}`);
  
  try {
    const doc = await firestore.collection('users').doc(user.uid).get();
    if (doc.exists) {
      const data = doc.data();
      console.log(`   ✅ Perfil encontrado no Firestore!`);
      console.log(`      Nome: ${data.firstName || ''} ${data.lastName || ''}`);
      console.log(`      Tipo: ${data.usertype || data.userType || 'N/A'}`);
      console.log(`      Email: ${data.email || 'N/A'}`);
      return { found: true, data };
    } else {
      console.log(`   ❌ Perfil NÃO encontrado no Firestore`);
      
      // Tentar buscar por email
      try {
        const emailQuery = await firestore.collection('users')
          .where('email', '==', user.email)
          .limit(1)
          .get();
        
        if (!emailQuery.empty) {
          const foundDoc = emailQuery.docs[0];
          console.log(`   ✅ Perfil encontrado no Firestore por EMAIL!`);
          console.log(`      UID real: ${foundDoc.id}`);
          console.log(`      Dados:`, foundDoc.data());
          return { found: true, method: 'email', doc: foundDoc, realUid: foundDoc.id, data: foundDoc.data() };
        }
      } catch (emailError) {
        console.log(`   ⚠️  Erro ao buscar por email no Firestore: ${emailError.message}`);
      }
      
      return { found: false };
    }
  } catch (error) {
    console.error(`   ❌ Erro ao verificar Firestore:`, error);
    return { found: false, error: error.message };
  }
}

/**
 * Buscar todos os usuários no Firebase Auth (para comparação)
 */
async function listAllAuthUsers() {
  console.log(`\n📋 Listando todos os usuários no Firebase Auth (primeiros 100)...`);
  try {
    const listUsersResult = await auth.listUsers(100);
    console.log(`   Total encontrado: ${listUsersResult.users.length} usuários`);
    
    // Procurar por email ou telefone
    const foundUsers = [];
    for (const testUser of Object.values(TEST_USERS)) {
      const found = listUsersResult.users.find(u => 
        u.email === testUser.email || 
        u.phoneNumber === testUser.phone ||
        u.uid === testUser.uid
      );
      if (found) {
        foundUsers.push({ testUser, found });
        console.log(`\n   ✅ Encontrado: ${testUser.name}`);
        console.log(`      UID esperado: ${testUser.uid}`);
        console.log(`      UID real: ${found.uid}`);
        console.log(`      Email: ${found.email || 'N/A'}`);
        console.log(`      Telefone: ${found.phoneNumber || 'N/A'}`);
      }
    }
    
    if (foundUsers.length === 0) {
      console.log(`   ⚠️  Nenhum dos usuários de teste foi encontrado nos primeiros 100 usuários`);
    }
    
    return foundUsers;
  } catch (error) {
    console.error(`   ❌ Erro ao listar usuários:`, error);
    return [];
  }
}

/**
 * Função principal
 */
async function main() {
  console.log('🔍 DIAGNÓSTICO COMPLETO DE USUÁRIOS DE TESTE\n');
  console.log('='.repeat(60));
  
  const results = {};
  
  // Verificar cada usuário
  for (const [key, user] of Object.entries(TEST_USERS)) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`👤 VERIFICANDO: ${user.name.toUpperCase()}`);
    console.log('='.repeat(60));
    
    results[key] = {
      auth: await checkFirebaseAuth(user),
      realtime: await checkRealtimeDatabase(user),
      firestore: await checkFirestore(user)
    };
  }
  
  // Listar todos os usuários no Auth
  await listAllAuthUsers();
  
  // Resumo
  console.log(`\n${'='.repeat(60)}`);
  console.log('📊 RESUMO DO DIAGNÓSTICO');
  console.log('='.repeat(60));
  
  for (const [key, user] of Object.entries(TEST_USERS)) {
    console.log(`\n${user.name}:`);
    console.log(`   Firebase Auth: ${results[key].auth.found ? '✅' : '❌'}`);
    console.log(`   Realtime Database: ${results[key].realtime.found ? '✅' : '❌'}`);
    console.log(`   Firestore: ${results[key].firestore.found ? '✅' : '❌'}`);
    
    if (results[key].auth.found && results[key].auth.realUid && results[key].auth.realUid !== user.uid) {
      console.log(`   ⚠️  UID DIFERENTE! Esperado: ${user.uid}, Real: ${results[key].auth.realUid}`);
    }
  }
  
  console.log(`\n${'='.repeat(60)}`);
  console.log('✅ Diagnóstico completo!');
  console.log('='.repeat(60));
}

// Executar
main().catch((error) => {
  console.error('❌ Erro fatal:', error);
  process.exit(1);
});


