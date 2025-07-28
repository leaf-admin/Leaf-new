#!/usr/bin/env node

// 🧪 TESTE WOOVI COM TOKEN REGENERADO - LEAF APP
const axios = require('axios');

async function testWooviWithRegeneratedToken() {
    console.log('🧪 TESTE WOOVI COM TOKEN REGENERADO');
    console.log('=' .repeat(50));

    console.log('\n📋 CONFIGURAÇÃO ATUAL:');
    console.log('✅ Conta de produção: CORRETA');
    console.log('✅ API: API_LEAF01');
    console.log('✅ Client ID: Client_Id_7bd2d925-4878-4c9d-a33a-ed76c3d4e100');
    console.log('✅ Status: ATIVADO');
    console.log('❌ Token: PRECISA SER REGENERADO');

    console.log('\n🎯 PRÓXIMOS PASSOS:');
    console.log('1. No dashboard da OpenPix, clique em "Poder regenerar seu token de autorização da API"');
    console.log('2. Copie o novo token gerado');
    console.log('3. Use o novo token nos testes');

    console.log('\n💡 INSTRUÇÕES DETALHADAS:');
    console.log('1. Acesse: https://app.openpix.com.br');
    console.log('2. Vá em: Desenvolvedores → Suas Aplicações');
    console.log('3. Clique em: API_LEAF01');
    console.log('4. Clique em: "Poder regenerar seu token de autorização da API"');
    console.log('5. Copie o novo token');
    console.log('6. Teste com o script abaixo');

    console.log('\n🔧 SCRIPT PARA TESTAR COM NOVO TOKEN:');
    console.log('```bash');
    console.log('cd scripts/testing');
    console.log('export WOOVI_APP_ID="Client_Id_7bd2d925-4878-4c9d-a33a-ed76c3d4e100"');
    console.log('export WOOVI_API_KEY="SEU_NOVO_TOKEN_AQUI"');
    console.log('node test-woovi-integration.cjs');
    console.log('```');

    console.log('\n📊 TESTE RÁPIDO COM CURL:');
    console.log('```bash');
    console.log('curl -X GET "https://api.openpix.com.br/api/v1/charge" \\');
    console.log('  -H "AppId: Client_Id_7bd2d925-4878-4c9d-a33a-ed76c3d4e100" \\');
    console.log('  -H "Content-Type: application/json"');
    console.log('```');

    console.log('\n🎯 POSSÍVEIS CAUSAS DO PROBLEMA:');
    console.log('1. ✅ Conta ativa: SIM');
    console.log('2. ✅ API ativada: SIM');
    console.log('3. ❌ Token expirado: PROVÁVEL');
    console.log('4. ❌ Token incorreto: POSSÍVEL');

    console.log('\n💡 SOLUÇÃO:');
    console.log('Regenere o token no dashboard e teste novamente!');

    console.log('\n🏁 PRÓXIMO PASSO:');
    console.log('Regenere o token e me informe o novo token para testarmos! 🚀');
}

// Executar teste
testWooviWithRegeneratedToken().then(() => {
    console.log('\n✅ DIAGNÓSTICO CONCLUÍDO');
    process.exit(0);
}).catch(error => {
    console.error('❌ ERRO:', error);
    process.exit(1);
}); 