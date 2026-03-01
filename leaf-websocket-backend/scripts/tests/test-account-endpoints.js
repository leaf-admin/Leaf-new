/**
 * Teste dos Endpoints de Conta e Autenticação
 * 
 * Endpoints testados:
 * - GET /api/auth/verify
 * - POST /api/account/delete
 */

const axios = require('axios');

// Configuração
const BASE_URL = process.env.TEST_URL || 'http://localhost:3001';
const TEST_TOKEN = process.env.TEST_TOKEN || null; // Token Firebase para teste

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

function logSection(title) {
  console.log('\n' + '='.repeat(60));
  log(title, 'cyan');
  console.log('='.repeat(60));
}

async function testAuthVerify(token) {
  logSection('TESTE 1: GET /api/auth/verify');
  
  try {
    // Teste 1.1: Sem token
    log('\n📋 Teste 1.1: Verificação sem token', 'yellow');
    try {
      const response = await axios.get(`${BASE_URL}/api/auth/verify`);
      log(`❌ FALHA: Deveria retornar 401, mas retornou ${response.status}`, 'red');
    } catch (error) {
      if (error.response?.status === 401) {
        log('✅ PASSOU: Retornou 401 (não autenticado)', 'green');
      } else {
        log(`❌ FALHA: Erro inesperado - ${error.message}`, 'red');
      }
    }

    // Teste 1.2: Token inválido
    log('\n📋 Teste 1.2: Verificação com token inválido', 'yellow');
    try {
      const response = await axios.get(`${BASE_URL}/api/auth/verify`, {
        headers: {
          'Authorization': 'Bearer token-invalido-12345'
        }
      });
      log(`❌ FALHA: Deveria retornar 401, mas retornou ${response.status}`, 'red');
    } catch (error) {
      if (error.response?.status === 401) {
        log('✅ PASSOU: Retornou 401 (token inválido)', 'green');
      } else {
        log(`❌ FALHA: Erro inesperado - ${error.message}`, 'red');
      }
    }

    // Teste 1.3: Token válido (se fornecido)
    if (token) {
      log('\n📋 Teste 1.3: Verificação com token válido', 'yellow');
      try {
        const response = await axios.get(`${BASE_URL}/api/auth/verify`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        
        if (response.data.authenticated === true) {
          log('✅ PASSOU: Token válido, usuário autenticado', 'green');
          log(`   UID: ${response.data.user?.uid}`, 'blue');
          log(`   Email: ${response.data.user?.email || 'N/A'}`, 'blue');
        } else {
          log('❌ FALHA: Token válido mas authenticated = false', 'red');
        }
      } catch (error) {
        log(`❌ FALHA: Erro ao verificar token válido - ${error.message}`, 'red');
        if (error.response?.data) {
          log(`   Resposta: ${JSON.stringify(error.response.data)}`, 'red');
        }
      }
    } else {
      log('\n⚠️  Teste 1.3: PULADO (token não fornecido)', 'yellow');
      log('   Para testar com token válido, defina TEST_TOKEN=seu_token', 'yellow');
    }

    // Teste 1.4: POST /api/auth/verify (alternativa)
    log('\n📋 Teste 1.4: POST /api/auth/verify sem token', 'yellow');
    try {
      const response = await axios.post(`${BASE_URL}/api/auth/verify`);
      log(`❌ FALHA: Deveria retornar 401, mas retornou ${response.status}`, 'red');
    } catch (error) {
      if (error.response?.status === 401) {
        log('✅ PASSOU: Retornou 401 (não autenticado)', 'green');
      } else {
        log(`❌ FALHA: Erro inesperado - ${error.message}`, 'red');
      }
    }

  } catch (error) {
    log(`❌ ERRO GERAL no teste de verificação: ${error.message}`, 'red');
  }
}

async function testAccountDelete(token) {
  logSection('TESTE 2: POST /api/account/delete');
  
  if (!token) {
    log('\n⚠️  Teste PULADO: Token não fornecido', 'yellow');
    log('   Para testar exclusão de conta, defina TEST_TOKEN=seu_token', 'yellow');
    return;
  }

  try {
    // Teste 2.1: Sem autenticação
    log('\n📋 Teste 2.1: Exclusão sem token', 'yellow');
    try {
      const response = await axios.post(`${BASE_URL}/api/account/delete`, {
        reason: 'nao-uso-mais',
        phone: '11999999999',
        password: 'senha123'
      });
      log(`❌ FALHA: Deveria retornar 401, mas retornou ${response.status}`, 'red');
    } catch (error) {
      if (error.response?.status === 401) {
        log('✅ PASSOU: Retornou 401 (não autenticado)', 'green');
      } else {
        log(`❌ FALHA: Erro inesperado - ${error.message}`, 'red');
      }
    }

    // Teste 2.2: Sem campos obrigatórios
    log('\n📋 Teste 2.2: Exclusão sem campos obrigatórios', 'yellow');
    try {
      const response = await axios.post(`${BASE_URL}/api/account/delete`, {
        // Sem reason, phone, password
      }, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      log(`❌ FALHA: Deveria retornar 400, mas retornou ${response.status}`, 'red');
    } catch (error) {
      if (error.response?.status === 400) {
        log('✅ PASSOU: Retornou 400 (campos obrigatórios faltando)', 'green');
      } else {
        log(`⚠️  Retornou ${error.response?.status} em vez de 400`, 'yellow');
      }
    }

    // Teste 2.3: Com dados válidos (CUIDADO: vai tentar excluir!)
    log('\n⚠️  Teste 2.3: Exclusão com dados válidos', 'yellow');
    log('   ⚠️  ATENÇÃO: Este teste pode realmente excluir uma conta!', 'red');
    log('   ⚠️  Pressione Ctrl+C para cancelar ou aguarde 5 segundos...', 'red');
    
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    try {
      // Buscar dados do usuário primeiro via /api/auth/verify
      const verifyResponse = await axios.get(`${BASE_URL}/api/auth/verify`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (verifyResponse.data.authenticated) {
        const userPhone = verifyResponse.data.user?.phone || '11999999999'; // Fallback
        
        log(`\n📋 Tentando exclusão com telefone: ${userPhone}`, 'blue');
        
        const response = await axios.post(`${BASE_URL}/api/account/delete`, {
          reason: 'teste-automatizado',
          additionalInfo: 'Este é um teste automatizado dos endpoints',
          phone: userPhone,
          password: 'senha-teste' // Senha real deve ser fornecida
        }, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        log(`⚠️  Resposta recebida: ${response.status}`, 'yellow');
        log(`   Mensagem: ${response.data.message || response.data.error}`, 'yellow');
        
        if (response.data.success) {
          log('✅ PASSOU: Exclusão processada (pode ter sido apenas marcada para exclusão)', 'green');
        } else {
          log('⚠️  Exclusão não processada (verifique telefone/senha)', 'yellow');
        }
      }
    } catch (error) {
      if (error.response?.status === 400) {
        log('✅ PASSOU: Retornou 400 (telefone ou senha incorretos)', 'green');
        log(`   Mensagem: ${error.response.data.message}`, 'blue');
      } else if (error.response?.status === 404) {
        log('⚠️  Usuário não encontrado no Firestore', 'yellow');
      } else {
        log(`⚠️  Erro: ${error.message}`, 'yellow');
        if (error.response?.data) {
          log(`   Resposta: ${JSON.stringify(error.response.data)}`, 'yellow');
        }
      }
    }

  } catch (error) {
    log(`❌ ERRO GERAL no teste de exclusão: ${error.message}`, 'red');
  }
}

async function runTests() {
  logSection('INICIANDO TESTES DOS ENDPOINTS DE CONTA E AUTENTICAÇÃO');
  log(`URL Base: ${BASE_URL}`, 'blue');
  log(`Token fornecido: ${TEST_TOKEN ? 'Sim' : 'Não'}`, 'blue');

  try {
    // Verificar se servidor está rodando
    log('\n📋 Verificando se servidor está rodando...', 'yellow');
    try {
      const healthCheck = await axios.get(`${BASE_URL}/health`, { timeout: 3000 });
      log('✅ Servidor está rodando', 'green');
    } catch (error) {
      log(`❌ Servidor não está respondendo em ${BASE_URL}`, 'red');
      log('   Verifique se o servidor está rodando na porta 3001', 'yellow');
      process.exit(1);
    }

    // Executar testes
    await testAuthVerify(TEST_TOKEN);
    await testAccountDelete(TEST_TOKEN);

    logSection('TESTES CONCLUÍDOS');
    log('✅ Todos os testes foram executados', 'green');

  } catch (error) {
    log(`\n❌ ERRO FATAL: ${error.message}`, 'red');
    process.exit(1);
  }
}

// Executar testes
if (require.main === module) {
  runTests();
}

module.exports = { runTests, testAuthVerify, testAccountDelete };















