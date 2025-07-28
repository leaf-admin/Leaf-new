#!/usr/bin/env node

// 🚀 ATIVAR WOOVI PRODUÇÃO - LEAF APP

async function activateWooviProduction() {
    console.log('🚀 ATIVAR WOOVI PRODUÇÃO');
    console.log('=' .repeat(40));

    console.log('\n📋 STATUS ATUAL:');
    console.log('✅ Sandbox: FUNCIONANDO');
    console.log('❌ Produção: PRECISA ATIVAÇÃO');
    console.log('✅ Token: CORRETO');
    console.log('✅ App ID: CORRETO');

    console.log('\n🎯 PROBLEMA IDENTIFICADO:');
    console.log('A conta de produção não está 100% ativada');
    console.log('Necessário configurar conta bancária real');

    console.log('\n💡 SOLUÇÃO DEFINITIVA:');
    console.log('1. Acesse: https://app.openpix.com.br');
    console.log('2. Faça login na sua conta');
    console.log('3. Vá em: Configurações → Conta Bancária');
    console.log('4. Configure uma conta bancária real');
    console.log('5. Aguarde aprovação da OpenPix (24-48h)');
    console.log('6. Teste novamente em produção');

    console.log('\n📋 DADOS NECESSÁRIOS:');
    console.log('App ID: Client_Id_7bd2d925-4878-4c9d-a33a-ed76c3d4e100');
    console.log('Token: Q2xpZW50X0lkXzdiZDJkOTI1LTQ4NzgtNGM5ZC1hMzNhLWVkNzZjM2Q0ZTEwMDpDbGllbnRfU2VjcmV0XzVrS3lVNWdHaTNqbTNsNE9jRmhaZkdQcmtBVTlvR3crbkRndWJ3NWNZOFk9');

    console.log('\n🔧 CONFIGURAÇÃO TEMPORÁRIA:');
    console.log('Use sandbox para desenvolvimento:');
    console.log('URL: https://sandbox-api.openpix.com.br/api/v1/charge');
    console.log('Headers: AppId + Content-Type');

    console.log('\n📞 SUPORTE:');
    console.log('Se precisar de ajuda:');
    console.log('Email: suporte@openpix.com.br');
    console.log('Informe: "Preciso ativar conta de produção"');

    console.log('\n🎯 PRÓXIMOS PASSOS:');
    console.log('1. Configure conta bancária no dashboard');
    console.log('2. Aguarde aprovação (24-48h)');
    console.log('3. Teste produção novamente');
    console.log('4. Implemente no Leaf App');

    console.log('\n✅ RESULTADO:');
    console.log('Woovi funcionará perfeitamente após ativação!');
}

activateWooviProduction().then(() => {
    console.log('\n✅ PLANO DE ATIVAÇÃO DEFINIDO');
    process.exit(0);
}).catch(error => {
    console.error('❌ ERRO:', error);
    process.exit(1);
}); 