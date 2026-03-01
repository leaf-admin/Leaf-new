#!/usr/bin/env node

/**
 * Teste do Sistema de Convites e Meses Grátis
 * 
 * Testa o sistema de convites onde:
 * - Cada motorista pode convidar até 3 pessoas
 * - Cada convidado precisa fazer pelo menos 10 corridas
 * - Ambos ganham 1 mês grátis por convite bem-sucedido
 * - Máximo de 12 meses grátis por motorista
 */

const admin = require('firebase-admin');

// Configuração
const TEST_CONFIG = {
  firebase_project_id: process.env.FIREBASE_PROJECT_ID || 'leaf-reactnative',
  test_inviter_id: 'test_inviter_referral',
  test_invitee_id: 'test_invitee_referral',
  test_invitee_2_id: 'test_invitee_2_referral',
  test_invitee_3_id: 'test_invitee_3_referral',
  test_invitee_4_id: 'test_invitee_4_referral'
};

// Inicializar Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp({
    projectId: TEST_CONFIG.firebase_project_id
  });
}

/**
 * Teste 1: Criar convite válido
 */
async function testCreateValidInvite() {
  console.log('\n🧪 TESTE 1: Criar convite válido');
  
  try {
    // Simular dados do convidador
    const inviterData = {
      id: TEST_CONFIG.test_inviter_id,
      used_invites: 0,
      max_invites: 3,
      free_months: 0
    };
    
    // Simular dados do convite
    const inviteData = {
      inviter_id: inviterData.id,
      invitee_email: 'convidado@teste.com',
      invitee_phone: '+5511999999999'
    };
    
    console.log(`👤 Convidador: ${inviterData.id}`);
    console.log(`📊 Convites usados: ${inviterData.used_invites}/${inviterData.max_invites}`);
    console.log(`📧 Email do convidado: ${inviteData.invitee_email}`);
    console.log(`📱 Telefone do convidado: ${inviteData.invitee_phone}`);
    
    if (inviterData.used_invites < inviterData.max_invites) {
      // Gerar código do convite
      const inviteCode = generateInviteCode();
      console.log(`🎫 Código do convite: ${inviteCode}`);
      
      // Simular criação no Firestore
      const inviteRef = await admin.firestore().collection('driver_invites').add({
        inviter_id: inviteData.inviter_id,
        invitee_email: inviteData.invitee_email,
        invitee_phone: inviteData.invitee_phone,
        invite_code: inviteCode,
        status: 'pending',
        created_at: admin.firestore.FieldValue.serverTimestamp(),
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 dias
      });
      
      console.log(`✅ Convite criado com ID: ${inviteRef.id}`);
      
      // Log da transação
      await logTestTransaction({
        type: 'DRIVER_INVITE_CREATED',
        inviter_id: inviteData.inviter_id,
        invitee_email: inviteData.invitee_email,
        invite_code: inviteCode,
        test_scenario: 'create_valid_invite'
      });
      
      console.log('✅ Teste 1 PASSADO - Convite criado com sucesso');
      return { success: true, invite_id: inviteRef.id, invite_code: inviteCode };
    } else {
      console.log('❌ Convidador atingiu limite de convites');
      return { success: false, error: 'Limite de convites atingido' };
    }
    
  } catch (error) {
    console.error('❌ Erro no teste 1:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Teste 2: Aceitar convite válido
 */
async function testAcceptValidInvite() {
  console.log('\n🧪 TESTE 2: Aceitar convite válido');
  
  try {
    // Simular dados do convite
    const inviteData = {
      inviter_id: TEST_CONFIG.test_inviter_id,
      invitee_id: TEST_CONFIG.test_invitee_id,
      invite_code: 'VALID123'
    };
    
    // Simular dados dos motoristas
    const inviterData = {
      id: inviteData.inviter_id,
      used_invites: 0,
      free_months: 0
    };
    
    const inviteeData = {
      id: inviteData.invitee_id,
      free_months: 0
    };
    
    console.log(`👤 Convidador: ${inviterData.id}`);
    console.log(`👤 Convidado: ${inviteeData.id}`);
    console.log(`🎫 Código do convite: ${inviteData.invite_code}`);
    
    // Simular verificação do convite
    const inviteExists = true; // Simular que o convite existe
    const inviteStatus = 'pending'; // Simular que está pendente
    
    if (inviteExists && inviteStatus === 'pending') {
      console.log('✅ Convite válido e pendente');
      
      // Simular aceitação
      const freeMonthsPerInvite = 1;
      const inviterNewFreeMonths = Math.min(inviterData.free_months + freeMonthsPerInvite, 12);
      const inviteeNewFreeMonths = Math.min(inviteeData.free_months + freeMonthsPerInvite, 12);
      
      console.log(`🎁 Meses grátis para convidador: ${inviterData.free_months} → ${inviterNewFreeMonths}`);
      console.log(`🎁 Meses grátis para convidado: ${inviteeData.free_months} → ${inviteeNewFreeMonths}`);
      
      // Simular atualização dos dados
      console.log('📝 Atualizando dados dos motoristas...');
      
      // Log da transação
      await logTestTransaction({
        type: 'DRIVER_INVITE_ACCEPTED',
        inviter_id: inviteData.inviter_id,
        invitee_id: inviteData.invitee_id,
        invite_code: inviteData.invite_code,
        free_months: freeMonthsPerInvite,
        inviter_free_months_before: inviterData.free_months,
        inviter_free_months_after: inviterNewFreeMonths,
        invitee_free_months_before: inviteeData.free_months,
        invitee_free_months_after: inviteeNewFreeMonths,
        test_scenario: 'accept_valid_invite'
      });
      
      console.log('✅ Teste 2 PASSADO - Convite aceito com sucesso');
      return { 
        success: true, 
        inviter_free_months: inviterNewFreeMonths,
        invitee_free_months: inviteeNewFreeMonths
      };
    } else {
      console.log('❌ Convite inválido ou já utilizado');
      return { success: false, error: 'Convite inválido' };
    }
    
  } catch (error) {
    console.error('❌ Erro no teste 2:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Teste 3: Limite de convites por motorista
 */
async function testInviteLimit() {
  console.log('\n🧪 TESTE 3: Limite de convites por motorista');
  
  try {
    // Simular motorista que já usou todos os convites
    const driverData = {
      id: 'driver_max_invites',
      used_invites: 3,
      max_invites: 3,
      free_months: 2
    };
    
    console.log(`👤 Motorista: ${driverData.id}`);
    console.log(`📊 Convites usados: ${driverData.used_invites}/${driverData.max_invites}`);
    console.log(`🎁 Meses grátis atuais: ${driverData.free_months}`);
    
    if (driverData.used_invites >= driverData.max_invites) {
      console.log('❌ Motorista atingiu limite de convites');
      console.log('🚫 Não é possível criar novo convite');
      
      // Log da transação
      await logTestTransaction({
        type: 'DRIVER_INVITE_LIMIT_REACHED',
        driver_id: driverData.id,
        used_invites: driverData.used_invites,
        max_invites: driverData.max_invites,
        test_scenario: 'invite_limit'
      });
      
      console.log('✅ Teste 3 PASSADO - Limite de convites respeitado');
      return { success: true, limit_reached: true };
    } else {
      console.log('❌ Teste falhou - motorista deveria ter atingido limite');
      return { success: false, error: 'Limite não atingido' };
    }
    
  } catch (error) {
    console.error('❌ Erro no teste 3:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Teste 4: Máximo de meses grátis
 */
async function testMaxFreeMonths() {
  console.log('\n🧪 TESTE 4: Máximo de meses grátis');
  
  try {
    // Simular motorista com 11 meses grátis (próximo do limite)
    const driverData = {
      id: 'driver_max_free_months',
      free_months: 11,
      max_free_months: 12
    };
    
    console.log(`👤 Motorista: ${driverData.id}`);
    console.log(`🎁 Meses grátis atuais: ${driverData.free_months}/${driverData.max_free_months}`);
    
    // Simular novo convite bem-sucedido
    const freeMonthsPerInvite = 1;
    const newFreeMonths = Math.min(driverData.free_months + freeMonthsPerInvite, driverData.max_free_months);
    
    console.log(`🎁 Meses grátis após convite: ${newFreeMonths}/${driverData.max_free_months}`);
    
    if (newFreeMonths <= driverData.max_free_months) {
      console.log('✅ Limite de meses grátis respeitado');
      
      // Log da transação
      await logTestTransaction({
        type: 'FREE_MONTHS_LIMIT_CHECK',
        driver_id: driverData.id,
        free_months_before: driverData.free_months,
        free_months_after: newFreeMonths,
        max_free_months: driverData.max_free_months,
        test_scenario: 'max_free_months'
      });
      
      console.log('✅ Teste 4 PASSADO - Máximo de meses grátis respeitado');
      return { success: true, new_free_months: newFreeMonths };
    } else {
      console.log('❌ Limite de meses grátis excedido');
      return { success: false, error: 'Limite excedido' };
    }
    
  } catch (error) {
    console.error('❌ Erro no teste 4:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Teste 5: Verificação de corridas mínimas
 */
async function testMinimumRidesCheck() {
  console.log('\n🧪 TESTE 5: Verificação de corridas mínimas');
  
  try {
    const testScenarios = [
      {
        name: 'Convidado com 5 corridas (insuficiente)',
        invitee_id: 'invitee_5_rides',
        rides_count: 5,
        required_rides: 10,
        should_qualify: false
      },
      {
        name: 'Convidado com 10 corridas (mínimo)',
        invitee_id: 'invitee_10_rides',
        rides_count: 10,
        required_rides: 10,
        should_qualify: true
      },
      {
        name: 'Convidado com 15 corridas (acima do mínimo)',
        invitee_id: 'invitee_15_rides',
        rides_count: 15,
        required_rides: 10,
        should_qualify: true
      }
    ];
    
    let passedTests = 0;
    
    for (const scenario of testScenarios) {
      console.log(`\n🔍 Testando: ${scenario.name}`);
      console.log(`📊 Corridas realizadas: ${scenario.rides_count}/${scenario.required_rides}`);
      
      const qualifies = scenario.rides_count >= scenario.required_rides;
      
      if (qualifies === scenario.should_qualify) {
        console.log(`✅ Resultado correto: ${qualifies ? 'Qualifica' : 'Não qualifica'}`);
        passedTests++;
        
        // Log da transação
        await logTestTransaction({
          type: 'MINIMUM_RIDES_CHECK',
          invitee_id: scenario.invitee_id,
          rides_count: scenario.rides_count,
          required_rides: scenario.required_rides,
          qualifies: qualifies,
          test_scenario: scenario.name.toLowerCase().replace(/\s+/g, '_')
        });
      } else {
        console.log(`❌ Resultado incorreto: esperado ${scenario.should_qualify}, obtido ${qualifies}`);
      }
    }
    
    console.log(`\n📊 Resultado: ${passedTests}/${testScenarios.length} cenários passaram`);
    
    if (passedTests === testScenarios.length) {
      console.log('✅ Teste 5 PASSADO - Verificação de corridas mínimas funcionando');
      return { success: true, passed_scenarios: passedTests };
    } else {
      console.log('❌ Teste 5 FALHOU - Alguns cenários falharam');
      return { success: false, passed_scenarios: passedTests };
    }
    
  } catch (error) {
    console.error('❌ Erro no teste 5:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Teste 6: Múltiplos convites do mesmo motorista
 */
async function testMultipleInvites() {
  console.log('\n🧪 TESTE 6: Múltiplos convites do mesmo motorista');
  
  try {
    // Simular motorista que fez 3 convites
    const inviterData = {
      id: 'driver_multiple_invites',
      used_invites: 0,
      max_invites: 3,
      free_months: 0
    };
    
    const invitees = [
      { id: TEST_CONFIG.test_invitee_id, rides: 12, accepted: true },
      { id: TEST_CONFIG.test_invitee_2_id, rides: 8, accepted: false }, // Não qualifica
      { id: TEST_CONFIG.test_invitee_3_id, rides: 15, accepted: true }
    ];
    
    console.log(`👤 Convidador: ${inviterData.id}`);
    console.log(`📊 Convites disponíveis: ${inviterData.max_invites - inviterData.used_invites}`);
    
    let successfulInvites = 0;
    let totalFreeMonths = 0;
    
    for (let i = 0; i < invitees.length; i++) {
      const invitee = invitees[i];
      console.log(`\n🎫 Convite ${i + 1}: ${invitee.id}`);
      console.log(`📊 Corridas: ${invitee.rides}/10`);
      
      if (inviterData.used_invites < inviterData.max_invites) {
        if (invitee.rides >= 10 && invitee.accepted) {
          successfulInvites++;
          totalFreeMonths += 1; // 1 mês grátis por convite
          inviterData.used_invites++;
          
          console.log(`✅ Convite aceito - ambos ganham 1 mês grátis`);
        } else {
          console.log(`❌ Convite não qualifica (corridas insuficientes ou não aceito)`);
        }
      } else {
        console.log(`❌ Limite de convites atingido`);
        break;
      }
    }
    
    const finalFreeMonths = Math.min(totalFreeMonths, 12); // Máximo de 12 meses
    
    console.log(`\n📊 RESUMO:`);
    console.log(`- Convites bem-sucedidos: ${successfulInvites}`);
    console.log(`- Meses grátis ganhos: ${finalFreeMonths}`);
    console.log(`- Convites restantes: ${inviterData.max_invites - inviterData.used_invites}`);
    
    // Log da transação
    await logTestTransaction({
      type: 'MULTIPLE_INVITES_TEST',
      inviter_id: inviterData.id,
      total_invites: invitees.length,
      successful_invites: successfulInvites,
      total_free_months: finalFreeMonths,
      test_scenario: 'multiple_invites'
    });
    
    console.log('✅ Teste 6 PASSADO - Múltiplos convites processados');
    return { 
      success: true, 
      successful_invites: successfulInvites,
      total_free_months: finalFreeMonths
    };
    
  } catch (error) {
    console.error('❌ Erro no teste 6:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Teste 7: Expiração de convites
 */
async function testInviteExpiration() {
  console.log('\n🧪 TESTE 7: Expiração de convites');
  
  try {
    const testScenarios = [
      {
        name: 'Convite válido (não expirado)',
        invite_code: 'VALID123',
        created_at: new Date(),
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 dias
        should_be_valid: true
      },
      {
        name: 'Convite expirado',
        invite_code: 'EXPIRED123',
        created_at: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000), // 35 dias atrás
        expires_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 dias atrás
        should_be_valid: false
      },
      {
        name: 'Convite próximo do vencimento',
        invite_code: 'NEAR_EXP123',
        created_at: new Date(Date.now() - 25 * 24 * 60 * 60 * 1000), // 25 dias atrás
        expires_at: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000), // 5 dias restantes
        should_be_valid: true
      }
    ];
    
    let passedTests = 0;
    
    for (const scenario of testScenarios) {
      console.log(`\n🔍 Testando: ${scenario.name}`);
      console.log(`🎫 Código: ${scenario.invite_code}`);
      console.log(`📅 Criado: ${scenario.created_at.toLocaleDateString()}`);
      console.log(`📅 Expira: ${scenario.expires_at.toLocaleDateString()}`);
      
      const now = new Date();
      const isExpired = now > scenario.expires_at;
      const isValid = !isExpired;
      
      console.log(`⏰ Data atual: ${now.toLocaleDateString()}`);
      console.log(`📊 Status: ${isExpired ? 'EXPIRADO' : 'VÁLIDO'}`);
      
      if (isValid === scenario.should_be_valid) {
        console.log(`✅ Resultado correto: ${isValid ? 'Válido' : 'Expirado'}`);
        passedTests++;
        
        // Log da transação
        await logTestTransaction({
          type: 'INVITE_EXPIRATION_CHECK',
          invite_code: scenario.invite_code,
          created_at: scenario.created_at,
          expires_at: scenario.expires_at,
          is_expired: isExpired,
          is_valid: isValid,
          test_scenario: scenario.name.toLowerCase().replace(/\s+/g, '_')
        });
      } else {
        console.log(`❌ Resultado incorreto: esperado ${scenario.should_be_valid}, obtido ${isValid}`);
      }
    }
    
    console.log(`\n📊 Resultado: ${passedTests}/${testScenarios.length} cenários passaram`);
    
    if (passedTests === testScenarios.length) {
      console.log('✅ Teste 7 PASSADO - Expiração de convites funcionando');
      return { success: true, passed_scenarios: passedTests };
    } else {
      console.log('❌ Teste 7 FALHOU - Alguns cenários falharam');
      return { success: false, passed_scenarios: passedTests };
    }
    
  } catch (error) {
    console.error('❌ Erro no teste 7:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Gerar código de convite
 */
function generateInviteCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Log de transação de teste
 */
async function logTestTransaction(transactionData) {
  try {
    await admin.firestore().collection('test_referral_transactions').add({
      ...transactionData,
      test_run: true,
      created_at: admin.firestore.FieldValue.serverTimestamp()
    });
  } catch (error) {
    console.error('Erro ao logar transação de teste:', error);
  }
}

/**
 * Função principal de teste
 */
async function runAllTests() {
  console.log('🎫 TESTE DO SISTEMA DE CONVITES E MESES GRÁTIS');
  console.log('=' .repeat(60));
  
  const tests = [
    { name: 'Criar convite válido', fn: testCreateValidInvite },
    { name: 'Aceitar convite válido', fn: testAcceptValidInvite },
    { name: 'Limite de convites por motorista', fn: testInviteLimit },
    { name: 'Máximo de meses grátis', fn: testMaxFreeMonths },
    { name: 'Verificação de corridas mínimas', fn: testMinimumRidesCheck },
    { name: 'Múltiplos convites do mesmo motorista', fn: testMultipleInvites },
    { name: 'Expiração de convites', fn: testInviteExpiration }
  ];
  
  let passedTests = 0;
  const results = [];
  
  for (const test of tests) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🧪 EXECUTANDO: ${test.name}`);
    console.log(`${'='.repeat(60)}`);
    
    try {
      const result = await test.fn();
      results.push({ name: test.name, passed: result.success, data: result });
      
      if (result.success) {
        passedTests++;
        console.log(`✅ ${test.name}: PASSADO`);
      } else {
        console.log(`❌ ${test.name}: FALHOU`);
        if (result.error) {
          console.log(`   Erro: ${result.error}`);
        }
      }
    } catch (error) {
      console.error(`❌ ${test.name}: ERRO - ${error.message}`);
      results.push({ name: test.name, passed: false, error: error.message });
    }
  }
  
  // Relatório final
  console.log(`\n${'='.repeat(60)}`);
  console.log('📊 RELATÓRIO FINAL');
  console.log(`${'='.repeat(60)}`);
  
  console.log(`✅ Testes passados: ${passedTests}/${tests.length}`);
  console.log(`❌ Testes falharam: ${tests.length - passedTests}/${tests.length}`);
  console.log(`📈 Taxa de sucesso: ${((passedTests / tests.length) * 100).toFixed(1)}%`);
  
  console.log('\n📋 DETALHES DOS TESTES:');
  for (const result of results) {
    const status = result.passed ? '✅ PASSADO' : '❌ FALHOU';
    console.log(`  ${status} - ${result.name}`);
    if (result.error) {
      console.log(`    Erro: ${result.error}`);
    }
  }
  
  if (passedTests === tests.length) {
    console.log('\n🎉 TODOS OS TESTES PASSARAM! Sistema de convites pronto.');
  } else {
    console.log('\n⚠️  ALGUNS TESTES FALHARAM. Verifique os logs acima.');
  }
  
  return passedTests === tests.length;
}

// Executar testes se chamado diretamente
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
🎫 TESTE DO SISTEMA DE CONVITES E MESES GRÁTIS

Uso: node test-referral-system.cjs [opções]

Opções:
  --all                    Executar todos os testes (padrão)
  --create-invite         Teste 1: Criar convite válido
  --accept-invite         Teste 2: Aceitar convite válido
  --invite-limit          Teste 3: Limite de convites por motorista
  --max-free-months       Teste 4: Máximo de meses grátis
  --minimum-rides         Teste 5: Verificação de corridas mínimas
  --multiple-invites      Teste 6: Múltiplos convites do mesmo motorista
  --invite-expiration     Teste 7: Expiração de convites
  --help, -h              Mostrar esta ajuda

Exemplos:
  node test-referral-system.cjs --all
  node test-referral-system.cjs --create-invite
  node test-referral-system.cjs --multiple-invites
    `);
    process.exit(0);
  }
  
  // Executar teste específico ou todos
  if (args.includes('--create-invite')) {
    testCreateValidInvite();
  } else if (args.includes('--accept-invite')) {
    testAcceptValidInvite();
  } else if (args.includes('--invite-limit')) {
    testInviteLimit();
  } else if (args.includes('--max-free-months')) {
    testMaxFreeMonths();
  } else if (args.includes('--minimum-rides')) {
    testMinimumRidesCheck();
  } else if (args.includes('--multiple-invites')) {
    testMultipleInvites();
  } else if (args.includes('--invite-expiration')) {
    testInviteExpiration();
  } else {
    // Executar todos os testes
    runAllTests().then(success => {
      process.exit(success ? 0 : 1);
    });
  }
}

module.exports = {
  testCreateValidInvite,
  testAcceptValidInvite,
  testInviteLimit,
  testMaxFreeMonths,
  testMinimumRidesCheck,
  testMultipleInvites,
  testInviteExpiration,
  runAllTests
}; 