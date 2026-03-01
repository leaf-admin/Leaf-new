/**
 * 🧪 TESTE DE INTEGRAÇÃO KYC COM VPS
 * 
 * Testa o fluxo completo:
 * 1. Buscar CNH do Firebase Storage
 * 2. Processar na VPS
 * 3. Verificar resultado
 */

require('dotenv').config();
const IntegratedKYCService = require('./services/IntegratedKYCService');
const { v4: uuidv4 } = require('uuid');

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

async function testKYCIntegration() {
  log('\n🧪 TESTE DE INTEGRAÇÃO KYC COM VPS', 'cyan');
  log('='.repeat(50), 'cyan');

  try {
    // Inicializar serviço
    log('\n🔧 Inicializando KYC Service...', 'yellow');
    const kycService = new IntegratedKYCService();
    
    // Aguardar inicialização
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    if (!kycService.initialized) {
      log('❌ KYC Service não inicializou', 'red');
      process.exit(1);
    }
    
    log('✅ KYC Service inicializado', 'green');
    log(`   VPS Disponível: ${kycService.vpsAvailable ? 'Sim' : 'Não'}`, 'yellow');

    // Obter userId do argumento ou usar padrão
    const testUserId = process.argv[2];
    
    if (!testUserId) {
      log('\n⚠️ Nenhum userId fornecido', 'yellow');
      log('💡 Uso: node test-kyc-vps-integration.js <userId>', 'yellow');
      log('💡 Ou: node test-kyc-vps-integration.js <userId> <caminho-imagem-atual>', 'yellow');
      process.exit(1);
    }

    // Validar UUID
    if (!kycService.isValidUUID(testUserId)) {
      log(`❌ userId inválido: ${testUserId}`, 'red');
      log('💡 userId deve ser um UUID válido', 'yellow');
      process.exit(1);
    }

    log(`\n📋 Testando com userId: ${testUserId}`, 'yellow');

    // Verificar se tem verificação válida em cache
    log('\n🔍 Verificando cache de verificação...', 'yellow');
    const cacheStatus = await kycService.hasValidVerification(testUserId, 24);
    
    if (cacheStatus.hasValid) {
      log(`   ✅ Verificação em cache encontrada (idade: ${cacheStatus.age}s)`, 'green');
      log(`   Confidence: ${cacheStatus.confidence}`, 'green');
      log(`   Similarity: ${cacheStatus.similarityScore}`, 'green');
      log('\n💡 Para forçar nova verificação, use: invalidate-cache', 'yellow');
    } else {
      log(`   ⚠️ Nenhuma verificação em cache: ${cacheStatus.reason}`, 'yellow');
    }

    // Teste 1: Verificar status sem processar
    log('\n📊 TESTE 1: Verificação de Status', 'cyan');
    log('='.repeat(50), 'cyan');
    
    const status = await kycService.hasValidVerification(testUserId);
    log(`   Has Valid: ${status.hasValid}`, status.hasValid ? 'green' : 'yellow');
    if (status.reason) {
      log(`   Reason: ${status.reason}`, 'yellow');
    }

    // Teste 2: Processar verificação (se imagem fornecida)
    const imagePath = process.argv[3];
    
    if (imagePath) {
      log('\n🔄 TESTE 2: Processamento KYC com VPS', 'cyan');
      log('='.repeat(50), 'cyan');
      
      const fs = require('fs');
      
      if (!fs.existsSync(imagePath)) {
        log(`❌ Arquivo não encontrado: ${imagePath}`, 'red');
        process.exit(1);
      }
      
      log(`   📸 Carregando imagem: ${imagePath}`, 'yellow');
      const currentImageBuffer = fs.readFileSync(imagePath);
      log(`   ✅ Imagem carregada: ${currentImageBuffer.length} bytes`, 'green');
      
      log(`\n   🚀 Processando verificação KYC...`, 'yellow');
      const startTime = Date.now();
      
      const result = await kycService.verifyDriver(
        testUserId,
        currentImageBuffer,
        {
          forceRecheck: true, // Forçar nova verificação
          minConfidence: 0.75
        }
      );
      
      const duration = Date.now() - startTime;
      
      if (result.success) {
        log(`\n   ✅ Verificação bem-sucedida!`, 'green');
        log(`   Match: ${result.isMatch}`, result.isMatch ? 'green' : 'red');
        log(`   Similarity: ${result.similarityScore}`, 'green');
        log(`   Confidence: ${result.confidence}`, 'green');
        log(`   Processing Time: ${result.processingTime}ms`, 'green');
        log(`   Total Time: ${duration}ms`, 'green');
        log(`   From VPS: ${result.fromVPS ? 'Sim' : 'Não'}`, result.fromVPS ? 'green' : 'yellow');
        log(`   From Cache: ${result.fromCache ? 'Sim' : 'Não'}`, result.fromCache ? 'yellow' : 'green');
        log(`   Attempts: ${result.attempts || 1}`, 'green');
      } else {
        log(`\n   ❌ Verificação falhou`, 'red');
        log(`   Error: ${result.error}`, 'red');
        if (result.retryReason) {
          log(`   Retry Reason: ${result.retryReason}`, 'yellow');
        }
      }
    } else {
      log('\n💡 Para testar processamento completo, forneça uma imagem:', 'yellow');
      log('   node test-kyc-vps-integration.js <userId> <caminho-imagem>', 'yellow');
    }

    // Teste 3: Health Check
    log('\n🏥 TESTE 3: Health Check', 'cyan');
    log('='.repeat(50), 'cyan');
    
    const health = await kycService.healthCheck();
    log(`   Status: ${health.status}`, health.status === 'healthy' ? 'green' : 'red');
    log(`   Initialized: ${health.initialized}`, health.initialized ? 'green' : 'red');
    log(`   Redis Connected: ${health.redisConnected}`, health.redisConnected ? 'green' : 'red');
    log(`   Workers Active: ${health.workersActive || 0}`, 'green');

    // Resumo
    log('\n📊 RESUMO DOS TESTES', 'cyan');
    log('='.repeat(50), 'cyan');
    log(`✅ KYC Service: ${kycService.initialized ? 'OK' : 'FALHOU'}`, 
      kycService.initialized ? 'green' : 'red');
    log(`✅ VPS Disponível: ${kycService.vpsAvailable ? 'Sim' : 'Não'}`, 
      kycService.vpsAvailable ? 'green' : 'yellow');
    log(`✅ Health Check: ${health.status}`, 
      health.status === 'healthy' ? 'green' : 'red');
    
    if (imagePath && result) {
      log(`✅ Processamento: ${result.success ? 'OK' : 'FALHOU'}`, 
        result.success ? 'green' : 'red');
    }

    log('\n' + '='.repeat(50), 'cyan');
    log('✅ Testes concluídos!', 'green');
    log('='.repeat(50), 'cyan');

    process.exit(0);

  } catch (error) {
    log(`\n❌ ERRO FATAL: ${error.message}`, 'red');
    console.error(error);
    process.exit(1);
  }
}

// Executar testes
testKYCIntegration();



