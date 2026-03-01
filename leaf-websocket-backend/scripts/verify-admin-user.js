/**
 * Script para verificar se o usuário admin foi criado corretamente
 * 
 * Uso: node scripts/verify-admin-user.js <email>
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
  } else {
    console.error('❌ Erro ao inicializar Firebase Admin:', error);
    process.exit(1);
  }
}

const db = admin.firestore();
const auth = admin.auth();

async function verifyAdminUser() {
  try {
    const email = process.argv[2];
    
    if (!email) {
      console.error('❌ Por favor, forneça o email do usuário');
      console.log('Uso: node scripts/verify-admin-user.js <email>');
      process.exit(1);
    }

    console.log(`\n🔍 Verificando usuário: ${email}\n`);

    // 1. Verificar no Firebase Authentication
    let userRecord;
    try {
      userRecord = await auth.getUserByEmail(email);
      console.log('✅ Usuário encontrado no Firebase Authentication');
      console.log(`   UID: ${userRecord.uid}`);
      console.log(`   Email: ${userRecord.email}`);
      console.log(`   Email verificado: ${userRecord.emailVerified}`);
      console.log(`   Nome: ${userRecord.displayName || 'Não definido'}`);
    } catch (error) {
      if (error.code === 'auth/user-not-found') {
        console.error('❌ Usuário não encontrado no Firebase Authentication');
        console.log('   Execute o script create-admin-user.js primeiro');
        process.exit(1);
      } else {
        throw error;
      }
    }

    // 2. Verificar no Firestore
    const adminUserDoc = await db.collection('adminUsers').doc(userRecord.uid).get();
    
    if (!adminUserDoc.exists) {
      console.error('❌ Documento não encontrado no Firestore (adminUsers)');
      console.log('\n📝 Criando documento no Firestore...\n');
      
      const adminUserData = {
        email: email,
        displayName: userRecord.displayName || 'Administrador',
        role: 'super-admin',
        permissions: [
          'dashboard:read',
          'users:read',
          'users:write',
          'rides:read',
          'rides:write',
          'reports:read',
          'reports:write',
          'system:config',
          'drivers:read',
          'drivers:write',
          'drivers:approve',
          'drivers:suspend',
          'promotions:read',
          'promotions:write',
          'subscriptions:read',
          'subscriptions:write'
        ],
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        lastLogin: null,
        active: true
      };

      await db.collection('adminUsers').doc(userRecord.uid).set(adminUserData);
      console.log('✅ Documento criado no Firestore');
    } else {
      const data = adminUserDoc.data();
      console.log('✅ Documento encontrado no Firestore');
      console.log(`   Role: ${data.role}`);
      console.log(`   Permissões: ${data.permissions?.length || 0} permissões`);
      console.log(`   Ativo: ${data.active !== false ? 'Sim' : 'Não'}`);
    }

    // 3. Verificar claims customizadas
    const user = await auth.getUser(userRecord.uid);
    if (user.customClaims && user.customClaims.admin) {
      console.log('✅ Claims customizadas configuradas');
      console.log(`   Role: ${user.customClaims.role}`);
    } else {
      console.log('⚠️  Claims customizadas não configuradas');
      console.log('   Configurando claims...');
      
      await auth.setCustomUserClaims(userRecord.uid, {
        admin: true,
        role: 'super-admin',
        permissions: [
          'dashboard:read',
          'users:read',
          'users:write',
          'rides:read',
          'rides:write',
          'reports:read',
          'reports:write',
          'system:config'
        ]
      });
      console.log('✅ Claims customizadas configuradas');
    }

    console.log('\n🎉 Verificação concluída!');
    console.log('\n💡 Se ainda houver erro de permissões:');
    console.log('   1. Verifique as regras de segurança do Firestore no console do Firebase');
    console.log('   2. Certifique-se de que a coleção adminUsers permite leitura para usuários autenticados');
    console.log('   3. Ou configure regras temporárias para desenvolvimento\n');

  } catch (error) {
    console.error('\n❌ Erro ao verificar usuário:', error);
    if (error.code) {
      console.error(`   Código: ${error.code}`);
    }
    process.exit(1);
  }
}

verifyAdminUser();




