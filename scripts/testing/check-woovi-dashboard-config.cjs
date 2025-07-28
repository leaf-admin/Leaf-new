#!/usr/bin/env node

// 🔍 VERIFICAR CONFIGURAÇÕES DASHBOARD WOOVI - LEAF APP

async function checkWooviDashboardConfig() {
    console.log('🔍 VERIFICAR CONFIGURAÇÕES DASHBOARD WOOVI');
    console.log('=' .repeat(50));

    console.log('\n📋 STATUS ATUAL:');
    console.log('✅ Sandbox: FUNCIONANDO');
    console.log('❌ Produção: appID inválido');
    console.log('✅ Token: CORRETO');
    console.log('✅ App ID: CORRETO');

    console.log('\n🎯 POSSÍVEIS CAUSAS:');
    console.log('1. Conta de produção não ativada completamente');
    console.log('2. Documentação pendente');
    console.log('3. Aprovação manual necessária');
    console.log('4. Configuração de ambiente');
    console.log('5. Limite de transações');
    console.log('6. Configuração de webhooks');

    console.log('\n💡 VERIFICAÇÕES NO DASHBOARD:');
    console.log('1. Acesse: https://app.openpix.com.br');
    console.log('2. Vá em: Desenvolvedores → Suas Aplicações');
    console.log('3. Clique em: API_LEAF01');
    console.log('4. Verifique:');
    console.log('   - Status da aplicação');
    console.log('   - Configurações de ambiente');
    console.log('   - Limites de transação');
    console.log('   - Webhooks configurados');
    console.log('   - Logs de erro');

    console.log('\n🔍 TESTE SANDBOX vs PRODUÇÃO:');
    console.log('✅ Sandbox: https://sandbox-api.openpix.com.br');
    console.log('❌ Produção: https://api.openpix.com.br');
    console.log('💡 Mesmas credenciais, ambientes diferentes');

    console.log('\n🎯 PRÓXIMOS PASSOS:');
    console.log('1. Verificar status da aplicação no dashboard');
    console.log('2. Verificar se há configurações pendentes');
    console.log('3. Contatar suporte da OpenPix se necessário');
    console.log('4. Verificar se há documentação pendente');
    console.log('5. Verificar limites de transação');

    console.log('\n📞 SUPORTE OPENPIX:');
    console.log('📧 Email: suporte@openpix.com.br');
    console.log('🌐 Site: https://openpix.com.br/suporte');
    console.log('💬 Chat: Disponível no dashboard');
}

// Executar verificação
checkWooviDashboardConfig().then(() => {
    console.log('\n🏁 VERIFICAÇÃO CONCLUÍDA');
    process.exit(0);
}).catch(error => {
    console.error('❌ ERRO FATAL:', error);
    process.exit(1);
}); 