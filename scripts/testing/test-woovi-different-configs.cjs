#!/usr/bin/env node

// 🧪 TESTE DIFERENTES CONFIGURAÇÕES WOOVI - LEAF APP
const axios = require('axios');

async function testDifferentConfigs() {
    console.log('🧪 TESTANDO DIFERENTES CONFIGURAÇÕES WOOVI');
    console.log('=' .repeat(50));

    const baseURL = 'https://api.openpix.com.br';
    
    // Configurações para testar
    const configs = [
        {
            name: 'Configuração Atual (Produção)',
            headers: {
                'AppId': 'Client_Id_7bd2d925-4878-4c9d-a33a-ed76c3d4e100',
                'Content-Type': 'application/json'
            }
        },
        {
            name: 'Configuração Atual (Token)',
            headers: {
                'Authorization': 'Bearer Q2xpZW50X0lkXzdiZDJkOTI1LTQ4NzgtNGM5ZC1hMzNhLWVkNzZjM2Q0ZTEwMDpDbGllbnRfU2VjcmV0X2RDeUJHcFNSSWdiK0dPTm02eTBkbkNxbDQrdXNQZll5KzFWWE1mYzdaUzQ9',
                'Content-Type': 'application/json'
            }
        },
        {
            name: 'Configuração Woovi.com (Sandbox)',
            headers: {
                'AppId': 'Client_Id_7bd2d925-4878-4c9d-a33a-ed76c3d4e100',
                'Content-Type': 'application/json'
            },
            baseURL: 'https://api.woovi.com'
        },
        {
            name: 'Configuração Woovi.com (Token)',
            headers: {
                'Authorization': 'Bearer Q2xpZW50X0lkXzdiZDJkOTI1LTQ4NzgtNGM5ZC1hMzNhLWVkNzZjM2Q0ZTEwMDpDbGllbnRfU2VjcmV0X2RDeUJHcFNSSWdiK0dPTm02eTBkbkNxbDQrdXNQZll5KzFWWE1mYzdaUzQ9',
                'Content-Type': 'application/json'
            },
            baseURL: 'https://api.woovi.com'
        }
    ];

    for (const config of configs) {
        console.log(`\n🔧 TESTANDO: ${config.name}`);
        console.log('-'.repeat(40));
        
        try {
            const url = `${config.baseURL || baseURL}/api/v1/charge`;
            const response = await axios.get(url, {
                headers: config.headers,
                timeout: 10000
            });
            
            console.log('✅ SUCESSO!');
            console.log(`  Status: ${response.status}`);
            console.log(`  Data: ${JSON.stringify(response.data, null, 2)}`);
            
            // Se funcionou, vamos testar criar uma cobrança
            console.log('\n💰 TESTANDO CRIAÇÃO DE COBRANÇA...');
            const chargeData = {
                correlationID: `test_${Date.now()}`,
                value: 0.01,
                comment: 'Teste de configuração',
                expiresIn: 3600
            };
            
            const chargeResponse = await axios.post(url, chargeData, {
                headers: config.headers,
                timeout: 10000
            });
            
            console.log('✅ COBRANÇA CRIADA!');
            console.log(`  Charge ID: ${chargeResponse.data.correlationID}`);
            console.log(`  Status: ${chargeResponse.data.status}`);
            
            // Esta configuração funcionou!
            console.log('\n🎉 CONFIGURAÇÃO FUNCIONANDO!');
            console.log(`Use esta configuração: ${config.name}`);
            return config;
            
        } catch (error) {
            console.log('❌ FALHOU');
            console.log(`  Status: ${error.response?.status || 'N/A'}`);
            console.log(`  Error: ${error.response?.data || error.message}`);
        }
    }
    
    console.log('\n❌ NENHUMA CONFIGURAÇÃO FUNCIONOU');
    console.log('\n💡 POSSÍVEIS SOLUÇÕES:');
    console.log('1. Verificar se a conta está ativa');
    console.log('2. Verificar se as credenciais estão corretas');
    console.log('3. Verificar se há saldo para testes');
    console.log('4. Contatar suporte da OpenPix');
    
    return null;
}

// Executar teste
testDifferentConfigs().then((workingConfig) => {
    if (workingConfig) {
        console.log('\n🎯 CONFIGURAÇÃO FUNCIONANDO ENCONTRADA!');
        console.log('=' .repeat(40));
        console.log(`Nome: ${workingConfig.name}`);
        console.log(`Base URL: ${workingConfig.baseURL || 'https://api.openpix.com.br'}`);
        console.log('Headers:', JSON.stringify(workingConfig.headers, null, 2));
    }
    console.log('\n🏁 TESTE CONCLUÍDO');
    process.exit(0);
}).catch(error => {
    console.error('❌ ERRO FATAL:', error);
    process.exit(1);
}); 