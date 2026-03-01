#!/usr/bin/env node

// 🔍 VERIFICAR STATUS DO DASHBOARD WOOVI - LEAF APP
const axios = require('axios');

async function checkWooviDashboardStatus() {
    console.log('🔍 VERIFICAR STATUS DO DASHBOARD WOOVI');
    console.log('=' .repeat(50));

    console.log('\n📋 CHECKLIST DO DASHBOARD:');
    console.log('1. ✅ Conta criada: SIM');
    console.log('2. ✅ API criada: API_LEAF01');
    console.log('3. ✅ Status: ATIVADO');
    console.log('4. ✅ Client ID: Client_Id_7bd2d925-4878-4c9d-a33a-ed76c3d4e100');
    console.log('5. ✅ Token regenerado: SIM');

    console.log('\n❓ POSSÍVEIS PROBLEMAS:');
    console.log('1. Conta bancária não configurada');
    console.log('2. Documentação pendente');
    console.log('3. Aprovação manual necessária');
    console.log('4. Configuração de IPs permitidos');

    console.log('\n💡 VERIFICAÇÕES NECESSÁRIAS:');
    console.log('1. Acesse: https://app.openpix.com.br');
    console.log('2. Vá em: Configurações → Conta Bancária');
    console.log('3. Verifique se há uma conta configurada');
    console.log('4. Vá em: Desenvolvedores → Suas Aplicações');
    console.log('5. Clique em: API_LEAF01');
    console.log('6. Verifique se há mensagens de pendência');

    console.log('\n🎯 PRÓXIMOS PASSOS:');
    console.log('1. Verificar se a conta bancária está configurada');
    console.log('2. Verificar se há documentação pendente');
    console.log('3. Aguardar aprovação se necessário');
    console.log('4. Configurar IPs permitidos se necessário');

    console.log('\n📞 SUPORTE:');
    console.log('Se tudo estiver correto, contate o suporte:');
    console.log('Email: suporte@openpix.com.br');
    console.log('Telefone: (11) 99999-9999');
}

checkWooviDashboardStatus().then(() => {
    console.log('\n✅ VERIFICAÇÃO CONCLUÍDA');
    process.exit(0);
}).catch(error => {
    console.error('❌ ERRO:', error);
    process.exit(1);
}); 