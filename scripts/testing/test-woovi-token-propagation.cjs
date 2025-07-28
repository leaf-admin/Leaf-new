#!/usr/bin/env node

// 🧪 TESTE PROPAGAÇÃO TOKEN WOOVI - LEAF APP
const axios = require('axios');

async function testWooviTokenPropagation() {
    console.log('🧪 TESTE PROPAGAÇÃO TOKEN WOOVI');
    console.log('=' .repeat(50));

    const appId = 'Client_Id_7bd2d925-4878-4c9d-a33a-ed76c3d4e100';
    const apiKey = 'Q2xpZW50X0lkXzdiZDJkOTI1LTQ4NzgtNGM5ZC1hMzNhLWVkNzZjM2Q0ZTEwMDpDbGllbnRfU2VjcmV0XzVrS3lVNWdHaTNqbTNsNE9jRmhaZkdQcmtBVTlvR3crbkRndWJ3NWNZOFk9';

    console.log('\n📋 CONFIGURAÇÃO:');
    console.log('✅ App ID:', appId);
    console.log('✅ API Key:', apiKey.substring(0, 20) + '...');
    console.log('✅ Token regenerado recentemente');

    console.log('\n🔍 TESTE 1: VERIFICAR SE O TOKEN FOI PROPAGADO');
    console.log('Aguardando 5 segundos para propagação...');
    
    await new Promise(resolve => setTimeout(resolve, 5000));

    try {
        const response = await axios.get('https://api.openpix.com.br/api/v1/charge', {
            headers: {
                'AppId': appId,
                'Content-Type': 'application/json'
            }
        });
        
        console.log('✅ TOKEN PROPAGADO: OK');
        console.log('Status:', response.status);
        console.log('Dados:', response.data);
        
    } catch (error) {
        console.log('❌ ERRO TOKEN PROPAGADO:', error.response?.data?.errors?.[0]?.message || error.message);
    }

    console.log('\n🔍 TESTE 2: TESTAR COM CACHE LIMPO');
    try {
        const response = await axios.get('https://api.openpix.com.br/api/v1/charge', {
            headers: {
                'AppId': appId,
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache',
                'Content-Type': 'application/json'
            }
        });
        
        console.log('✅ CACHE LIMPO: OK');
        console.log('Status:', response.status);
        console.log('Dados:', response.data);
        
    } catch (error) {
        console.log('❌ ERRO CACHE LIMPO:', error.response?.data?.errors?.[0]?.message || error.message);
    }

    console.log('\n🔍 TESTE 3: TESTAR ENDPOINT DE STATUS');
    try {
        const response = await axios.get('https://api.openpix.com.br/api/v1/status', {
            headers: {
                'AppId': appId,
                'Content-Type': 'application/json'
            }
        });
        
        console.log('✅ STATUS API: OK');
        console.log('Status:', response.status);
        console.log('Dados:', response.data);
        
    } catch (error) {
        console.log('❌ ERRO STATUS API:', error.response?.data?.errors?.[0]?.message || error.message);
    }

    console.log('\n🎯 POSSÍVEIS SOLUÇÕES:');
    console.log('1. Aguardar mais tempo para propagação (15-30 min)');
    console.log('2. Regenerar token novamente');
    console.log('3. Verificar se há manutenção na API');
    console.log('4. Contatar suporte da OpenPix');
    console.log('5. Verificar logs de erro no dashboard');

    console.log('\n💡 PRÓXIMOS PASSOS:');
    console.log('1. Aguardar 15-30 minutos');
    console.log('2. Testar novamente');
    console.log('3. Se não funcionar, regenerar token');
    console.log('4. Contatar suporte se persistir');
}

// Executar teste
testWooviTokenPropagation().then(() => {
    console.log('\n🏁 TESTE CONCLUÍDO');
    process.exit(0);
}).catch(error => {
    console.error('❌ ERRO FATAL:', error);
    process.exit(1);
}); 