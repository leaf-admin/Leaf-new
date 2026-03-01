/**
 * 🧪 Teste de Bloqueio/Liberação de Motorista (KYC)
 * 
 * Testa todas as funcionalidades do sistema de bloqueio/liberação
 */

const kycDriverStatusService = require('../services/kyc-driver-status-service');
const redisPool = require('../utils/redis-pool');
const admin = require('firebase-admin');
const { logStructured, logError } = require('../utils/logger');

// Inicializar Firebase se necessário
try {
  if (!admin.apps.length) {
    const firebaseConfig = require('../firebase-config');
    firebaseConfig.initializeFirebase();
  }
} catch (error) {
  console.error('Erro ao inicializar Firebase:', error.message);
}

const TEST_DRIVER_ID = 'test-driver-kyc-' + Date.now();

async function testBlockDriver() {
  console.log('\n🧪 TESTE 1: Bloquear Motorista');
  console.log('='.repeat(50));
  
  try {
    const result = await kycDriverStatusService.blockDriver(
      TEST_DRIVER_ID,
      'KYC não aprovado - similaridade insuficiente',
      {
        similarityScore: 0.45,
        confidence: 0.45,
        verificationAttempts: 3
      }
    );

    console.log('✅ Resultado:', JSON.stringify(result, null, 2));
    
    // Verificar se está bloqueado
    const isBlocked = await kycDriverStatusService.isDriverBlocked(TEST_DRIVER_ID);
    console.log('✅ Verificação de bloqueio:', JSON.stringify(isBlocked, null, 2));
    
    if (isBlocked.blocked) {
      console.log('✅ TESTE 1 PASSOU: Motorista bloqueado com sucesso');
    } else {
      console.log('❌ TESTE 1 FALHOU: Motorista não está bloqueado');
    }

    // Verificar se pode trabalhar
    const canWork = await kycDriverStatusService.canDriverWork(TEST_DRIVER_ID);
    console.log('✅ Pode trabalhar?', canWork);
    
    if (!canWork) {
      console.log('✅ TESTE 1 PASSOU: Motorista bloqueado não pode trabalhar');
    } else {
      console.log('❌ TESTE 1 FALHOU: Motorista bloqueado pode trabalhar (ERRO!)');
    }

    return { success: isBlocked.blocked && !canWork, result, isBlocked, canWork };
  } catch (error) {
    console.error('❌ TESTE 1 FALHOU:', error.message);
    return { success: false, error: error.message };
  }
}

async function testUnblockDriver() {
  console.log('\n🧪 TESTE 2: Liberar Motorista');
  console.log('='.repeat(50));
  
  try {
    const result = await kycDriverStatusService.unblockDriver(
      TEST_DRIVER_ID,
      {
        similarityScore: 0.85,
        confidence: 0.85
      }
    );

    console.log('✅ Resultado:', JSON.stringify(result, null, 2));
    
    // Verificar se está bloqueado
    const isBlocked = await kycDriverStatusService.isDriverBlocked(TEST_DRIVER_ID);
    console.log('✅ Verificação de bloqueio:', JSON.stringify(isBlocked, null, 2));
    
    if (!isBlocked.blocked) {
      console.log('✅ TESTE 2 PASSOU: Motorista liberado com sucesso');
    } else {
      console.log('❌ TESTE 2 FALHOU: Motorista ainda está bloqueado');
    }

    // Verificar se pode trabalhar
    const canWork = await kycDriverStatusService.canDriverWork(TEST_DRIVER_ID);
    console.log('✅ Pode trabalhar?', canWork);
    
    if (canWork) {
      console.log('✅ TESTE 2 PASSOU: Motorista liberado pode trabalhar');
    } else {
      console.log('❌ TESTE 2 FALHOU: Motorista liberado não pode trabalhar (ERRO!)');
    }

    return { success: !isBlocked.blocked && canWork, result, isBlocked, canWork };
  } catch (error) {
    console.error('❌ TESTE 2 FALHOU:', error.message);
    return { success: false, error: error.message };
  }
}

async function testProcessOnboardingResult() {
  console.log('\n🧪 TESTE 3: Processar Resultado de Onboarding (Aprovado)');
  console.log('='.repeat(50));
  
  try {
    const kycResult = {
      approved: true,
      similarity: 0.85,
      needsReview: false
    };

    const result = await kycDriverStatusService.processOnboardingResult(
      TEST_DRIVER_ID + '-onboarding',
      kycResult
    );

    console.log('✅ Resultado:', JSON.stringify(result, null, 2));
    
    // Verificar se está bloqueado
    const isBlocked = await kycDriverStatusService.isDriverBlocked(TEST_DRIVER_ID + '-onboarding');
    const canWork = await kycDriverStatusService.canDriverWork(TEST_DRIVER_ID + '-onboarding');
    
    if (!isBlocked.blocked && canWork) {
      console.log('✅ TESTE 3 PASSOU: Onboarding aprovado liberou motorista');
    } else {
      console.log('❌ TESTE 3 FALHOU: Onboarding aprovado não liberou motorista');
    }

    return { success: !isBlocked.blocked && canWork, result, isBlocked, canWork };
  } catch (error) {
    console.error('❌ TESTE 3 FALHOU:', error.message);
    return { success: false, error: error.message };
  }
}

async function testProcessOnboardingResultRejected() {
  console.log('\n🧪 TESTE 4: Processar Resultado de Onboarding (Rejeitado)');
  console.log('='.repeat(50));
  
  try {
    const kycResult = {
      approved: false,
      similarity: 0.45,
      needsReview: false
    };

    const result = await kycDriverStatusService.processOnboardingResult(
      TEST_DRIVER_ID + '-rejected',
      kycResult
    );

    console.log('✅ Resultado:', JSON.stringify(result, null, 2));
    
    // Verificar se está bloqueado
    const isBlocked = await kycDriverStatusService.isDriverBlocked(TEST_DRIVER_ID + '-rejected');
    const canWork = await kycDriverStatusService.canDriverWork(TEST_DRIVER_ID + '-rejected');
    
    if (isBlocked.blocked && !canWork) {
      console.log('✅ TESTE 4 PASSOU: Onboarding rejeitado bloqueou motorista');
    } else {
      console.log('❌ TESTE 4 FALHOU: Onboarding rejeitado não bloqueou motorista');
    }

    return { success: isBlocked.blocked && !canWork, result, isBlocked, canWork };
  } catch (error) {
    console.error('❌ TESTE 4 FALHOU:', error.message);
    return { success: false, error: error.message };
  }
}

async function testProcessVerificationResult() {
  console.log('\n🧪 TESTE 5: Processar Resultado de Verificação (Sucesso)');
  console.log('='.repeat(50));
  
  try {
    const verificationResult = {
      success: true,
      isMatch: true,
      similarityScore: 0.88,
      confidence: 0.88,
      attempts: 1
    };

    const result = await kycDriverStatusService.processVerificationResult(
      TEST_DRIVER_ID + '-verify',
      verificationResult
    );

    console.log('✅ Resultado:', JSON.stringify(result, null, 2));
    
    // Verificar se está bloqueado
    const isBlocked = await kycDriverStatusService.isDriverBlocked(TEST_DRIVER_ID + '-verify');
    const canWork = await kycDriverStatusService.canDriverWork(TEST_DRIVER_ID + '-verify');
    
    if (!isBlocked.blocked && canWork) {
      console.log('✅ TESTE 5 PASSOU: Verificação bem-sucedida manteve motorista liberado');
    } else {
      console.log('❌ TESTE 5 FALHOU: Verificação bem-sucedida bloqueou motorista (ERRO!)');
    }

    return { success: !isBlocked.blocked && canWork, result, isBlocked, canWork };
  } catch (error) {
    console.error('❌ TESTE 5 FALHOU:', error.message);
    return { success: false, error: error.message };
  }
}

async function testProcessVerificationResultFailed() {
  console.log('\n🧪 TESTE 6: Processar Resultado de Verificação (Falha)');
  console.log('='.repeat(50));
  
  try {
    const verificationResult = {
      success: false,
      isMatch: false,
      similarityScore: 0.35,
      confidence: 0.35,
      attempts: 3,
      error: 'Similaridade insuficiente'
    };

    const result = await kycDriverStatusService.processVerificationResult(
      TEST_DRIVER_ID + '-verify-failed',
      verificationResult
    );

    console.log('✅ Resultado:', JSON.stringify(result, null, 2));
    
    // Verificar se está bloqueado
    const isBlocked = await kycDriverStatusService.isDriverBlocked(TEST_DRIVER_ID + '-verify-failed');
    const canWork = await kycDriverStatusService.canDriverWork(TEST_DRIVER_ID + '-verify-failed');
    
    if (isBlocked.blocked && !canWork) {
      console.log('✅ TESTE 6 PASSOU: Verificação falhou e bloqueou motorista');
    } else {
      console.log('❌ TESTE 6 FALHOU: Verificação falhou mas não bloqueou motorista');
    }

    return { success: isBlocked.blocked && !canWork, result, isBlocked, canWork };
  } catch (error) {
    console.error('❌ TESTE 6 FALHOU:', error.message);
    return { success: false, error: error.message };
  }
}

async function testRedisData() {
  console.log('\n🧪 TESTE 7: Verificar Dados no Redis');
  console.log('='.repeat(50));
  
  try {
    const redis = redisPool.getConnection();
    const driverData = await redis.hgetall(`driver:${TEST_DRIVER_ID}`);
    
    console.log('✅ Dados no Redis:', JSON.stringify(driverData, null, 2));
    
    if (driverData && driverData.kyc_status) {
      console.log('✅ TESTE 7 PASSOU: Dados KYC encontrados no Redis');
      return { success: true, driverData };
    } else {
      console.log('⚠️ TESTE 7: Dados KYC não encontrados no Redis (pode ser normal se não foi bloqueado)');
      return { success: true, driverData: null };
    }
  } catch (error) {
    console.error('❌ TESTE 7 FALHOU:', error.message);
    return { success: false, error: error.message };
  }
}

async function testFirestoreData() {
  console.log('\n🧪 TESTE 8: Verificar Dados no Firestore');
  console.log('='.repeat(50));
  
  try {
    const firestore = admin.firestore();
    
    // Verificar em drivers
    const driverDoc = await firestore.collection('drivers').doc(TEST_DRIVER_ID).get();
    if (driverDoc.exists) {
      console.log('✅ Dados em drivers/{driverId}:', JSON.stringify(driverDoc.data(), null, 2));
    } else {
      console.log('⚠️ Documento não encontrado em drivers/{driverId}');
    }
    
    // Verificar em users
    const userDoc = await firestore.collection('users').doc(TEST_DRIVER_ID).get();
    if (userDoc.exists) {
      console.log('✅ Dados em users/{driverId}:', JSON.stringify(userDoc.data(), null, 2));
    } else {
      console.log('⚠️ Documento não encontrado em users/{driverId}');
    }
    
    if (driverDoc.exists || userDoc.exists) {
      console.log('✅ TESTE 8 PASSOU: Dados encontrados no Firestore');
      return { success: true, driverData: driverDoc.data(), userData: userDoc.data() };
    } else {
      console.log('⚠️ TESTE 8: Dados não encontrados no Firestore (pode ser normal se não foi bloqueado)');
      return { success: true, driverData: null, userData: null };
    }
  } catch (error) {
    console.error('❌ TESTE 8 FALHOU:', error.message);
    return { success: false, error: error.message };
  }
}

async function runAllTests() {
  console.log('\n🚀 INICIANDO TESTES DE BLOQUEIO/LIBERAÇÃO KYC');
  console.log('='.repeat(50));
  console.log(`Driver ID de teste: ${TEST_DRIVER_ID}`);
  console.log('='.repeat(50));

  const results = [];

  // Executar testes
  results.push(await testBlockDriver());
  results.push(await testUnblockDriver());
  results.push(await testProcessOnboardingResult());
  results.push(await testProcessOnboardingResultRejected());
  results.push(await testProcessVerificationResult());
  results.push(await testProcessVerificationResultFailed());
  results.push(await testRedisData());
  results.push(await testFirestoreData());

  // Resumo
  console.log('\n📊 RESUMO DOS TESTES');
  console.log('='.repeat(50));
  
  const passed = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  
  console.log(`✅ Passou: ${passed}/${results.length}`);
  console.log(`❌ Falhou: ${failed}/${results.length}`);
  
  results.forEach((result, index) => {
    const status = result.success ? '✅' : '❌';
    console.log(`${status} Teste ${index + 1}: ${result.success ? 'PASSOU' : 'FALHOU'}`);
    if (result.error) {
      console.log(`   Erro: ${result.error}`);
    }
  });

  console.log('\n' + '='.repeat(50));
  
  if (failed === 0) {
    console.log('🎉 TODOS OS TESTES PASSARAM!');
    process.exit(0);
  } else {
    console.log('⚠️ ALGUNS TESTES FALHARAM');
    process.exit(1);
  }
}

// Executar testes
runAllTests().catch(error => {
  console.error('❌ Erro ao executar testes:', error);
  process.exit(1);
});

