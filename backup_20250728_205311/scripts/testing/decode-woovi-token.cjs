#!/usr/bin/env node

// 🔍 DECODIFICAR TOKEN WOOVI - LEAF APP

async function decodeWooviToken() {
    console.log('🔍 DECODIFICAR TOKEN WOOVI');
    console.log('=' .repeat(40));

    const apiKey = 'Q2xpZW50X0lkXzdiZDJkOTI1LTQ4NzgtNGM5ZC1hMzNhLWVkNzZjM2Q0ZTEwMDpDbGllbnRfU2VjcmV0XzVrS3lVNWdHaTNqbTNsNE9jRmhaZkdQcmtBVTlvR3crbkRndWJ3NWNZOFk9';

    console.log('\n📋 TOKEN ORIGINAL:');
    console.log(apiKey);

    console.log('\n🔍 DECODIFICANDO TOKEN:');
    try {
        const decoded = Buffer.from(apiKey, 'base64').toString();
        console.log('✅ Token decodificado:', decoded);
        
        // Analisar o conteúdo
        const parts = decoded.split(':');
        if (parts.length === 2) {
            console.log('\n📋 ANÁLISE DO TOKEN:');
            console.log('Client ID:', parts[0]);
            console.log('Client Secret:', parts[1].substring(0, 20) + '...');
            
            // Verificar se o Client ID está correto
            const expectedClientId = 'Client_Id_7bd2d925-4878-4c9d-a33a-ed76c3d4e100';
            if (parts[0] === expectedClientId) {
                console.log('✅ Client ID: CORRETO');
            } else {
                console.log('❌ Client ID: DIFERENTE');
                console.log('Esperado:', expectedClientId);
                console.log('Encontrado:', parts[0]);
            }
        } else {
            console.log('❌ Formato do token inválido');
        }
        
    } catch (error) {
        console.log('❌ ERRO AO DECODIFICAR:', error.message);
    }

    console.log('\n🎯 POSSÍVEIS PROBLEMAS:');
    console.log('1. Token expirado');
    console.log('2. Client ID incorreto no token');
    console.log('3. Conta não ativada completamente');
    console.log('4. Problema de permissões');
    console.log('5. Endpoint incorreto');

    console.log('\n💡 PRÓXIMOS PASSOS:');
    console.log('1. Verificar se o Client ID no token é igual ao do dashboard');
    console.log('2. Regenerar token se necessário');
    console.log('3. Verificar status da conta no dashboard');
    console.log('4. Contatar suporte da OpenPix');
}

// Executar análise
decodeWooviToken().then(() => {
    console.log('\n🏁 ANÁLISE CONCLUÍDA');
    process.exit(0);
}).catch(error => {
    console.error('❌ ERRO FATAL:', error);
    process.exit(1);
}); 