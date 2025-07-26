const admin = require('firebase-admin');

// Configuração do Firebase Admin
const serviceAccount = {
  "type": "service_account",
  "project_id": "leaf-reactnative",
  "private_key_id": "YOUR_PRIVATE_KEY_ID",
  "private_key": "YOUR_PRIVATE_KEY",
  "client_email": "YOUR_CLIENT_EMAIL",
  "client_id": "YOUR_CLIENT_ID",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
  "client_x509_cert_url": "YOUR_CERT_URL"
};

// Inicializar Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://leaf-reactnative-default-rtdb.firebaseio.com"
});

async function testPhoneAuth() {
  try {
    console.log('🔍 Testando configuração do Firebase Auth...');
    
    // Verificar se Phone Authentication está habilitado
    const authConfig = await admin.auth().getAuthConfig();
    console.log('✅ Auth config:', authConfig);
    
    // Testar criação de usuário com telefone
    const phoneNumber = '+5521999814802';
    console.log('📱 Testando com número:', phoneNumber);
    
    // Verificar se o usuário já existe
    try {
      const userRecord = await admin.auth().getUserByPhoneNumber(phoneNumber);
      console.log('✅ Usuário encontrado:', userRecord.uid);
    } catch (error) {
      if (error.code === 'auth/user-not-found') {
        console.log('ℹ️ Usuário não encontrado (normal para teste)');
      } else {
        console.error('❌ Erro ao verificar usuário:', error);
      }
    }
    
  } catch (error) {
    console.error('❌ Erro no teste:', error);
  }
}

testPhoneAuth(); 