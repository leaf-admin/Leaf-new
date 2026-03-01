/**
 * 🧪 TESTE DA ARQUITETURA KYC
 * 
 * Testa:
 * 1. Firebase Storage Service (buscar URL e baixar CNH)
 * 2. KYC VPS Client (comunicação com VPS)
 * 3. Fluxo completo (simulado)
 */

const FirebaseStorageService = require('./services/firebase-storage-service');
const KYCVPSClient = require('./services/kyc-vps-client');
const { initializeFirebase, getFirestore } = require('./firebase-config');

// Cores para output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function testFirebaseStorageService() {
  log('\n📦 TESTE 1: Firebase Storage Service', 'cyan');
  log('='.repeat(50), 'cyan');

  try {
    // Inicializar Firebase
    log('🔧 Inicializando Firebase...', 'yellow');
    initializeFirebase();
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Criar serviço
    const storageService = new FirebaseStorageService();
    log('✅ Firebase Storage Service criado', 'green');

    // Teste 1: Buscar URL da CNH
    log('\n📋 Teste 1.1: Buscar URL da CNH', 'yellow');
    log('   Forneça um userId válido para testar:', 'yellow');
    
    // Usar userId de teste (pode ser passado como argumento)
    let testUserId = process.argv[2];
    
    // Se não fornecido, tentar buscar um driver real do Firestore
    if (!testUserId) {
      log('   🔍 Buscando driver real no Firestore...', 'yellow');
      try {
        const firestore = getFirestore();
        if (firestore) {
          const usersRef = firestore.collection('users');
          const snapshot = await usersRef.limit(5).get();
          
          for (const doc of snapshot.docs) {
            const userData = doc.data();
            // Verificar se tem documentos
            const docsRef = doc.ref.collection('documents');
            const docsSnapshot = await docsRef.limit(1).get();
            
            if (!docsSnapshot.empty || userData.licenseImage || userData.verifyIdImage) {
              testUserId = doc.id;
              log(`   ✅ Driver encontrado: ${testUserId}`, 'green');
              break;
            }
          }
        }
      } catch (searchError) {
        log(`   ⚠️ Erro ao buscar driver: ${searchError.message}`, 'yellow');
      }
    }
    
    if (!testUserId) {
      testUserId = 'test-user-id';
      log(`   ⚠️ Usando userId de teste: ${testUserId}`, 'yellow');
      log('   💡 Passe um userId real como argumento para testar com dados reais', 'yellow');
    } else {
      log(`   Usando userId: ${testUserId}`, 'yellow');
    }
    
    const cnhUrl = await storageService.getCNHUrl(testUserId);
    
    if (cnhUrl) {
      log(`   ✅ URL encontrada: ${cnhUrl.substring(0, 80)}...`, 'green');
      
      // Teste 2: Baixar CNH
      log('\n📥 Teste 1.2: Baixar CNH do Firebase Storage', 'yellow');
      try {
        const cnhBuffer = await storageService.downloadFile(cnhUrl);
        log(`   ✅ CNH baixada: ${cnhBuffer.length} bytes`, 'green');
        log(`   ✅ Tipo: ${cnhBuffer.slice(0, 4).toString('hex')}`, 'green');
        
        // Verificar se é imagem
        const isJPEG = cnhBuffer[0] === 0xFF && cnhBuffer[1] === 0xD8;
        const isPNG = cnhBuffer[0] === 0x89 && cnhBuffer[1] === 0x50;
        
        if (isJPEG) {
          log('   ✅ Formato: JPEG', 'green');
        } else if (isPNG) {
          log('   ✅ Formato: PNG', 'green');
        } else {
          log('   ⚠️ Formato desconhecido', 'yellow');
        }
        
        return { success: true, cnhBuffer, cnhUrl };
        
      } catch (downloadError) {
        log(`   ❌ Erro ao baixar: ${downloadError.message}`, 'red');
        return { success: false, error: downloadError.message };
      }
    } else {
      log(`   ⚠️ CNH não encontrada para userId: ${testUserId}`, 'yellow');
      log('   💡 Isso é normal se o usuário não tem CNH cadastrada', 'yellow');
      return { success: false, error: 'CNH não encontrada' };
    }

  } catch (error) {
    log(`❌ Erro no teste: ${error.message}`, 'red');
    console.error(error);
    return { success: false, error: error.message };
  }
}

async function testKYCVPSClient() {
  log('\n🌐 TESTE 2: KYC VPS Client', 'cyan');
  log('='.repeat(50), 'cyan');

  try {
    const vpsClient = new KYCVPSClient();
    log(`✅ KYC VPS Client criado`, 'green');
    log(`   URL configurada: ${vpsClient.vpsUrl}`, 'yellow');
    log(`   API Key: ${vpsClient.apiKey ? '***configurada***' : 'não configurada'}`, 'yellow');

    // Teste 1: Health Check
    log('\n🏥 Teste 2.1: Health Check da VPS', 'yellow');
    try {
      const health = await vpsClient.healthCheck();
      
      if (health.status === 'healthy') {
        log('   ✅ VPS está saudável!', 'green');
        log(`   Resposta: ${JSON.stringify(health.response, null, 2)}`, 'green');
        return { success: true, health };
      } else {
        log(`   ⚠️ VPS não está saudável: ${health.error}`, 'yellow');
        log('   💡 Isso é normal se a VPS ainda não foi configurada', 'yellow');
        return { success: false, health };
      }
    } catch (healthError) {
      log(`   ⚠️ Erro no health check: ${healthError.message}`, 'yellow');
      log('   💡 Isso é normal se a VPS ainda não foi configurada', 'yellow');
      return { success: false, error: healthError.message };
    }

  } catch (error) {
    log(`❌ Erro no teste: ${error.message}`, 'red');
    console.error(error);
    return { success: false, error: error.message };
  }
}

async function testFullFlow() {
  log('\n🔄 TESTE 3: Fluxo Completo (Simulado)', 'cyan');
  log('='.repeat(50), 'cyan');

  try {
    const storageService = new FirebaseStorageService();
    const vpsClient = new KYCVPSClient();

    // Simular dados
    const testUserId = process.argv[2] || 'test-user-id';
    log(`   Usando userId: ${testUserId}`, 'yellow');

    // 1. Buscar CNH
    log('\n   📋 Passo 1: Buscar CNH...', 'yellow');
    const cnhUrl = await storageService.getCNHUrl(testUserId);
    
    if (!cnhUrl) {
      log('   ⚠️ CNH não encontrada, simulando...', 'yellow');
      log('   💡 Criando buffer simulado para teste', 'yellow');
      
      // Criar buffer simulado (imagem JPEG mínima)
      const simulatedCNH = Buffer.from([
        0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46
      ]);
      const simulatedCurrent = Buffer.from([
        0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46
      ]);

      log('\n   🚀 Passo 2: Enviar para VPS KYC (simulado)...', 'yellow');
      
      try {
        const result = await vpsClient.processKYC(
          testUserId,
          simulatedCNH,
          simulatedCurrent
        );
        
        log('   ✅ Processamento bem-sucedido!', 'green');
        log(`   Resultado: ${JSON.stringify(result, null, 2)}`, 'green');
        return { success: true, result };
        
      } catch (vpsError) {
        log(`   ⚠️ Erro ao processar na VPS: ${vpsError.message}`, 'yellow');
        log('   💡 Isso é normal se a VPS ainda não foi configurada', 'yellow');
        return { success: false, error: vpsError.message };
      }
    } else {
      log(`   ✅ CNH encontrada: ${cnhUrl.substring(0, 60)}...`, 'green');
      
      // 2. Baixar CNH
      log('\n   📥 Passo 2: Baixar CNH...', 'yellow');
      const cnhBuffer = await storageService.downloadFile(cnhUrl);
      log(`   ✅ CNH baixada: ${cnhBuffer.length} bytes`, 'green');

      // 3. Simular foto atual (criar buffer simulado)
      log('\n   📸 Passo 3: Criar foto atual (simulada)...', 'yellow');
      const simulatedCurrent = Buffer.from([
        0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46
      ]);
      log('   ✅ Foto atual simulada criada', 'green');

      // 4. Enviar para VPS
      log('\n   🚀 Passo 4: Enviar para VPS KYC...', 'yellow');
      try {
        const result = await vpsClient.processKYC(
          testUserId,
          cnhBuffer,
          simulatedCurrent
        );
        
        log('   ✅ Processamento bem-sucedido!', 'green');
        log(`   Resultado: ${JSON.stringify(result, null, 2)}`, 'green');
        return { success: true, result };
        
      } catch (vpsError) {
        log(`   ⚠️ Erro ao processar na VPS: ${vpsError.message}`, 'yellow');
        log('   💡 Isso é normal se a VPS ainda não foi configurada', 'yellow');
        return { success: false, error: vpsError.message };
      }
    }

  } catch (error) {
    log(`❌ Erro no teste: ${error.message}`, 'red');
    console.error(error);
    return { success: false, error: error.message };
  }
}

async function runAllTests() {
  log('\n🧪 INICIANDO TESTES DA ARQUITETURA KYC', 'blue');
  log('='.repeat(50), 'blue');
  log('💡 Dica: Passe um userId válido como argumento:', 'yellow');
  log('   node test-kyc-architecture.js <userId>', 'yellow');
  log('='.repeat(50), 'blue');

  const results = {
    firebaseStorage: null,
    vpsClient: null,
    fullFlow: null
  };

  // Teste 1: Firebase Storage Service
  results.firebaseStorage = await testFirebaseStorageService();

  // Teste 2: KYC VPS Client
  results.vpsClient = await testKYCVPSClient();

  // Teste 3: Fluxo Completo
  results.fullFlow = await testFullFlow();

  // Resumo
  log('\n📊 RESUMO DOS TESTES', 'cyan');
  log('='.repeat(50), 'cyan');
  
  log(`\n✅ Firebase Storage Service: ${results.firebaseStorage.success ? 'PASSOU' : 'FALHOU'}`, 
    results.firebaseStorage.success ? 'green' : 'red');
  if (!results.firebaseStorage.success && results.firebaseStorage.error) {
    log(`   Erro: ${results.firebaseStorage.error}`, 'red');
  }

  log(`\n✅ KYC VPS Client: ${results.vpsClient.success ? 'PASSOU' : 'FALHOU (esperado se VPS não configurada)'}`, 
    results.vpsClient.success ? 'green' : 'yellow');
  if (!results.vpsClient.success && results.vpsClient.error) {
    log(`   Erro: ${results.vpsClient.error}`, 'yellow');
  }

  log(`\n✅ Fluxo Completo: ${results.fullFlow.success ? 'PASSOU' : 'FALHOU (esperado se VPS não configurada)'}`, 
    results.fullFlow.success ? 'green' : 'yellow');
  if (!results.fullFlow.success && results.fullFlow.error) {
    log(`   Erro: ${results.fullFlow.error}`, 'yellow');
  }

  log('\n' + '='.repeat(50), 'cyan');
  log('✅ Testes concluídos!', 'green');
  log('='.repeat(50), 'cyan');

  process.exit(0);
}

// Executar testes
runAllTests().catch(error => {
  log(`\n❌ ERRO FATAL: ${error.message}`, 'red');
  console.error(error);
  process.exit(1);
});

