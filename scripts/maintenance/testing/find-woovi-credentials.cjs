#!/usr/bin/env node

// 🔍 ENCONTRAR CREDENCIAIS WOOVI CORRETAS - LEAF APP

console.log('🔍 ENCONTRAR CREDENCIAIS WOOVI CORRETAS');
console.log('=' .repeat(50));

console.log('\n📋 SITUAÇÃO ATUAL:');
console.log('Você mudou de uma conta de teste para uma conta de produção');
console.log('As credenciais antigas funcionavam, as novas não');

console.log('\n🎯 POSSÍVEIS CAUSAS:');
console.log('1. Conta de teste vs produção');
console.log('2. Credenciais diferentes entre ambientes');
console.log('3. Conta pode não estar ativa');
console.log('4. Saldo insuficiente para testes');

console.log('\n💡 SOLUÇÕES:');

console.log('\n1. VERIFICAR DASHBOARD:');
console.log('   Acesse: https://app.openpix.com.br');
console.log('   Verifique:');
console.log('   - Se está na conta correta');
console.log('   - Status da conta (ativa/inativa)');
console.log('   - Saldo disponível');
console.log('   - Modo sandbox/produção');

console.log('\n2. VERIFICAR CREDENCIAIS:');
console.log('   No dashboard, vá em:');
console.log('   - Desenvolvedores → Suas Aplicações');
console.log('   - Verifique se a API está ativa');
console.log('   - Copie as credenciais corretas');

console.log('\n3. TESTAR CREDENCIAIS ANTIGAS:');
console.log('   Se você tem as credenciais da conta de teste:');
console.log('   - Use-as temporariamente');
console.log('   - Ou crie uma nova conta de teste');

console.log('\n4. CONTATAR SUPORTE:');
console.log('   Se nada funcionar:');
console.log('   - Email: suporte@openpix.com.br');
console.log('   - Informe: Client ID e erro "appID inválido"');

console.log('\n🔧 CONFIGURAÇÕES PARA TESTAR:');

const configs = [
    {
        name: 'Conta de Teste (Sandbox)',
        description: 'Se você tem credenciais de teste',
        baseURL: 'https://api.openpix.com.br',
        headers: {
            'AppId': 'SEU_APP_ID_DE_TESTE',
            'Content-Type': 'application/json'
        }
    },
    {
        name: 'Conta de Produção (Atual)',
        description: 'Credenciais que você forneceu',
        baseURL: 'https://api.openpix.com.br',
        headers: {
            'AppId': 'Client_Id_7bd2d925-4878-4c9d-a33a-ed76c3d4e100',
            'Content-Type': 'application/json'
        }
    },
    {
        name: 'Woovi.com (Alternativo)',
        description: 'API alternativa',
        baseURL: 'https://api.woovi.com',
        headers: {
            'AppId': 'Client_Id_7bd2d925-4878-4c9d-a33a-ed76c3d4e100',
            'Content-Type': 'application/json'
        }
    }
];

configs.forEach((config, index) => {
    console.log(`\n${index + 1}. ${config.name}`);
    console.log(`   Descrição: ${config.description}`);
    console.log(`   Base URL: ${config.baseURL}`);
    console.log(`   Headers: ${JSON.stringify(config.headers, null, 2)}`);
});

console.log('\n🎯 PRÓXIMOS PASSOS:');
console.log('1. Acesse o dashboard da OpenPix');
console.log('2. Verifique se está na conta correta');
console.log('3. Copie as credenciais corretas');
console.log('4. Teste com o script de diagnóstico');
console.log('5. Se necessário, contate o suporte');

console.log('\n📞 CONTATOS ÚTEIS:');
console.log('- Dashboard: https://app.openpix.com.br');
console.log('- Documentação: https://docs.openpix.com.br');
console.log('- Suporte: suporte@openpix.com.br');

console.log('\n🏁 DIAGNÓSTICO CONCLUÍDO');
console.log('Verifique o dashboard e as credenciais! 🚀'); 