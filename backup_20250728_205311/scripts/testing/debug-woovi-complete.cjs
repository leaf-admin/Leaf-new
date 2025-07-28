#!/usr/bin/env node

// 🔍 DEBUG COMPLETO WOOVI - LEAF APP
const axios = require('axios');

async function debugWooviComplete() {
    console.log('🔍 DEBUG COMPLETO WOOVI');
    console.log('=' .repeat(50));

    const appId = 'Client_Id_7bd2d925-4878-4c9d-a33a-ed76c3d4e100';
    const apiKey = 'Q2xpZW50X0lkXzdiZDJkOTI1LTQ4NzgtNGM5ZC1hMzNhLWVkNzZjM2Q0ZTEwMDpDbGllbnRfU2VjcmV0XzVrS3lVNWdHaTNqbTNsNE9jRmhaZkdQcmtBVTlvR3crbkRndWJ3NWNZOFk9';

    console.log('\n📋 INFORMAÇÕES DO TOKEN:');
    console.log('App ID:', appId);
    console.log('API Key (decodificado):', Buffer.from(apiKey, 'base64').toString());
    
    // Decodificar o token para ver o conteúdo
    try {
        const decoded = Buffer.from(apiKey, 'base64').toString();
        console.log('Token decodificado:', decoded);
        
        // Verificar se contém Client_Id e Client_Secret
        if (decoded.includes('Client_Id_') && decoded.includes('Client_Secret_')) {
            console.log('✅ Token parece estar no formato correto');
        } else {
            console.log('❌ Token pode estar em formato incorreto');
        }
    } catch (error) {
        console.log('❌ Erro ao decodificar token');
    }

    console.log('\n🔍 TESTE 1: VERIFICAR DOCUMENTAÇÃO OFICIAL');
    console.log('URL da documentação: https://docs.openpix.com.br');
    console.log('Endpoint correto: https://api.openpix.com.br/api/v1/charge');
    console.log('Headers necessários: AppId + Content-Type');

    console.log('\n🔍 TESTE 2: VERIFICAR SE É PROBLEMA DE SANDBOX/PRODUÇÃO');
    const environments = [
        {
            name: 'PRODUÇÃO',
            url: 'https://api.openpix.com.br/api/v1/charge'
        },
        {
            name: 'SANDBOX',
            url: 'https://sandbox-api.openpix.com.br/api/v1/charge'
        }
    ];

    for (const env of environments) {
        console.log(`\n🔍 TESTE ${env.name}:`);
        try {
            const response = await axios.get(env.url, {
                headers: {
                    'AppId': appId,
                    'Content-Type': 'application/json'
                }
            });
            console.log(`✅ ${env.name}: SUCESSO`);
            console.log('📊 Status:', response.status);
        } catch (error) {
            console.log(`❌ ${env.name}: FALHOU`);
            console.log('📊 Status:', error.response?.status);
            console.log('📊 Erro:', error.response?.data);
        }
    }

    console.log('\n🔍 TESTE 3: VERIFICAR SE É PROBLEMA DE CONTA');
    console.log('Possíveis problemas:');
    console.log('1. Conta não está completamente ativada');
    console.log('2. Documentação pendente');
    console.log('3. Aprovação manual necessária');
    console.log('4. Configuração de IPs permitidos');
    console.log('5. Conta bancária não configurada');

    console.log('\n🔍 TESTE 4: VERIFICAR FORMATO DO APP ID');
    console.log('App ID atual:', appId);
    console.log('Formato esperado: Client_Id_XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX');
    console.log('Seu formato:', appId.startsWith('Client_Id_') ? '✅ CORRETO' : '❌ INCORRETO');

    console.log('\n🎯 DIAGNÓSTICO FINAL:');
    console.log('O problema pode ser:');
    console.log('1. Conta não está 100% ativada no dashboard');
    console.log('2. Necessário configurar conta bancária');
    console.log('3. Necessário aguardar aprovação manual');
    console.log('4. Necessário configurar IPs permitidos');

    console.log('\n💡 SOLUÇÃO DEFINITIVA:');
    console.log('1. Acesse: https://app.openpix.com.br');
    console.log('2. Vá em: Configurações → Conta Bancária');
    console.log('3. Configure uma conta bancária');
    console.log('4. Vá em: Desenvolvedores → Suas Aplicações');
    console.log('5. Clique em: API_LEAF01');
    console.log('6. Verifique se há mensagens de pendência');
    console.log('7. Se houver, aguarde aprovação ou configure o que estiver pendente');

    console.log('\n📞 CONTATO SUPORTE:');
    console.log('Se tudo estiver correto, contate:');
    console.log('Email: suporte@openpix.com.br');
    console.log('Informe: "appID inválido" mesmo com token regenerado');
    console.log('App ID: Client_Id_7bd2d925-4878-4c9d-a33a-ed76c3d4e100');
}

debugWooviComplete().then(() => {
    console.log('\n✅ DEBUG CONCLUÍDO');
    process.exit(0);
}).catch(error => {
    console.error('❌ ERRO FATAL:', error);
    process.exit(1);
}); 