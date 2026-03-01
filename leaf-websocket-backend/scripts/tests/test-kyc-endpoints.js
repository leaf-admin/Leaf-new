#!/usr/bin/env node

/**
 * Script de teste para endpoints KYC
 * Testa todos os endpoints principais do sistema KYC
 */

const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.API_URL || 'http://localhost:3001';
// Gerar UUID válido para teste
const { randomUUID } = require('crypto');
const TEST_USER_ID = randomUUID();

console.log('🧪 TESTE DE ENDPOINTS KYC');
console.log('========================');
console.log(`🌐 Base URL: ${BASE_URL}`);
console.log(`👤 Test User ID: ${TEST_USER_ID}`);
console.log('');

// Cores para output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSuccess(message) {
  log(`✅ ${message}`, 'green');
}

function logError(message) {
  log(`❌ ${message}`, 'red');
}

function logInfo(message) {
  log(`ℹ️  ${message}`, 'blue');
}

function logWarning(message) {
  log(`⚠️  ${message}`, 'yellow');
}

// Testes
async function testHealthCheck() {
  logInfo('Testando Health Check...');
  try {
    const response = await axios.get(`${BASE_URL}/api/kyc/health`);
    if (response.data.status === 'healthy') {
      logSuccess('Health Check: OK');
      console.log('   Dados:', JSON.stringify(response.data, null, 2));
      return true;
    } else {
      logError('Health Check: Status não é healthy');
      return false;
    }
  } catch (error) {
    logError(`Health Check: ${error.message}`);
    return false;
  }
}

async function testStats() {
  logInfo('Testando Stats...');
  try {
    const response = await axios.get(`${BASE_URL}/api/kyc/stats`);
    if (response.data.success) {
      logSuccess('Stats: OK');
      console.log('   Total Encodings:', response.data.stats.totalEncodings);
      console.log('   Total Verifications:', response.data.stats.totalVerifications);
      return true;
    } else {
      logError('Stats: Resposta não é success');
      return false;
    }
  } catch (error) {
    logError(`Stats: ${error.message}`);
    return false;
  }
}

async function testAnalytics() {
  logInfo('Testando Analytics...');
  try {
    const response = await axios.get(`${BASE_URL}/api/kyc-analytics/analytics?days=7`);
    if (response.data.success) {
      logSuccess('Analytics: OK');
      console.log('   Total Attempts:', response.data.data.totalAttempts);
      console.log('   Success Rate:', response.data.data.successRate);
      return true;
    } else {
      logError('Analytics: Resposta não é success');
      return false;
    }
  } catch (error) {
    logError(`Analytics: ${error.message}`);
    return false;
  }
}

async function testGetEncoding(userId) {
  logInfo(`Testando GET Encoding para ${userId}...`);
  try {
    const response = await axios.get(`${BASE_URL}/api/kyc/encoding/${userId}`);
    if (response.status === 404) {
      logWarning('Encoding não encontrado (esperado para novo usuário)');
      return true; // 404 é esperado se não existe encoding
    } else if (response.data.success) {
      logSuccess('GET Encoding: OK');
      return true;
    } else {
      logError('GET Encoding: Resposta não é success');
      return false;
    }
  } catch (error) {
    if (error.response && error.response.status === 404) {
      logWarning('Encoding não encontrado (esperado para novo usuário)');
      return true;
    }
    logError(`GET Encoding: ${error.message}`);
    return false;
  }
}

async function testDeleteEncoding(userId) {
  logInfo(`Testando DELETE Encoding para ${userId}...`);
  try {
    const response = await axios.delete(`${BASE_URL}/api/kyc/encoding/${userId}`);
    if (response.status === 404) {
      logWarning('Encoding não encontrado para deletar (esperado)');
      return true; // 404 é esperado se não existe
    } else if (response.data.success) {
      logSuccess('DELETE Encoding: OK');
      return true;
    } else {
      logError('DELETE Encoding: Resposta não é success');
      return false;
    }
  } catch (error) {
    if (error.response && error.response.status === 404) {
      logWarning('Encoding não encontrado para deletar (esperado)');
      return true;
    }
    logError(`DELETE Encoding: ${error.message}`);
    return false;
  }
}

async function testUploadProfile(userId) {
  logInfo(`Testando Upload Profile para ${userId}...`);
  try {
    // Criar uma imagem de teste simples (1x1 pixel PNG)
    const testImageBuffer = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    );

    const formData = new FormData();
    formData.append('image', testImageBuffer, {
      filename: 'test-profile.png',
      contentType: 'image/png'
    });
    formData.append('userId', userId);

    const response = await axios.post(
      `${BASE_URL}/api/kyc/upload-profile`,
      formData,
      {
        headers: formData.getHeaders(),
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      }
    );

    if (response.data.success) {
      logSuccess('Upload Profile: OK');
      console.log('   Confidence:', response.data.confidence);
      return true;
    } else {
      logError(`Upload Profile: ${response.data.error || 'Erro desconhecido'}`);
      return false;
    }
  } catch (error) {
    logError(`Upload Profile: ${error.message}`);
    if (error.response) {
      console.log('   Resposta:', JSON.stringify(error.response.data, null, 2));
    }
    return false;
  }
}

async function testVerifyDriver(userId) {
  logInfo(`Testando Verify Driver para ${userId}...`);
  try {
    // Criar uma imagem de teste simples
    const testImageBuffer = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    );

    const formData = new FormData();
    formData.append('currentImage', testImageBuffer, {
      filename: 'test-verify.png',
      contentType: 'image/png'
    });
    formData.append('userId', userId);

    const response = await axios.post(
      `${BASE_URL}/api/kyc/verify-driver`,
      formData,
      {
        headers: formData.getHeaders(),
        maxContentLength: Infinity,
        maxBodyLength: Infinity
      }
    );

    if (response.data.success !== undefined) {
      logSuccess('Verify Driver: OK');
      console.log('   Is Match:', response.data.isMatch);
      console.log('   Similarity Score:', response.data.similarityScore);
      console.log('   Confidence:', response.data.confidence);
      return true;
    } else {
      logError(`Verify Driver: ${response.data.error || 'Erro desconhecido'}`);
      return false;
    }
  } catch (error) {
    logError(`Verify Driver: ${error.message}`);
    if (error.response) {
      console.log('   Resposta:', JSON.stringify(error.response.data, null, 2));
    }
    return false;
  }
}

// Executar todos os testes
async function runAllTests() {
  const results = {
    healthCheck: false,
    stats: false,
    analytics: false,
    getEncoding: false,
    deleteEncoding: false,
    uploadProfile: false,
    verifyDriver: false
  };

  console.log('');
  log('=== TESTES BÁSICOS ===', 'blue');
  results.healthCheck = await testHealthCheck();
  console.log('');
  results.stats = await testStats();
  console.log('');
  results.analytics = await testAnalytics();
  console.log('');

  log('=== TESTES DE ENCODING ===', 'blue');
  results.getEncoding = await testGetEncoding(TEST_USER_ID);
  console.log('');
  results.deleteEncoding = await testDeleteEncoding(TEST_USER_ID);
  console.log('');

  log('=== TESTES DE UPLOAD E VERIFICAÇÃO ===', 'blue');
  logWarning('⚠️  Nota: Upload e verificação requerem imagens válidas com faces detectáveis');
  logWarning('⚠️  Testando com imagem mínima (pode falhar na detecção facial)');
  console.log('');
  
  results.uploadProfile = await testUploadProfile(TEST_USER_ID);
  console.log('');
  results.verifyDriver = await testVerifyDriver(TEST_USER_ID);
  console.log('');

  // Resumo
  console.log('');
  log('=== RESUMO DOS TESTES ===', 'blue');
  const total = Object.keys(results).length;
  const passed = Object.values(results).filter(r => r).length;
  
  for (const [test, result] of Object.entries(results)) {
    if (result) {
      logSuccess(`${test}: PASSOU`);
    } else {
      logError(`${test}: FALHOU`);
    }
  }
  
  console.log('');
  log(`Total: ${passed}/${total} testes passaram`, passed === total ? 'green' : 'yellow');
  
  if (passed === total) {
    logSuccess('🎉 Todos os testes passaram!');
    process.exit(0);
  } else {
    logWarning('⚠️  Alguns testes falharam. Verifique os logs acima.');
    process.exit(1);
  }
}

// Executar
runAllTests().catch(error => {
  logError(`Erro fatal: ${error.message}`);
  console.error(error);
  process.exit(1);
});

