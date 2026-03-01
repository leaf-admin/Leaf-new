// test-user-quick.js
// Script rápido para testar o usuário de teste

import TestUserService from './src/services/TestUserService';

const testUserQuick = async () => {
    try {
        console.log('🧪 TESTE RÁPIDO - Usuário de Teste');
        console.log('=====================================');

        // 1. Verificar status atual
        console.log('\n1. Verificando status atual...');
        const isTest = await TestUserService.isTestUser();
        console.log('   É usuário de teste:', isTest);

        // 2. Ativar usuário de teste
        console.log('\n2. Ativando usuário de teste...');
        const success = await TestUserService.simulateTestUserAuth();
        console.log('   Sucesso:', success);

        // 3. Configurar como driver
        console.log('\n3. Configurando como driver...');
        await TestUserService.setTestUserAsDriver();

        // 4. Verificar dados
        console.log('\n4. Verificando dados...');
        const userId = await TestUserService.getUserId();
        const userData = await TestUserService.getUserData();
        console.log('   ID do usuário:', userId);
        console.log('   Dados do usuário:', userData);

        // 5. Logar informações de debug
        console.log('\n5. Informações de debug:');
        await TestUserService.logDebugInfo();

        console.log('\n✅ Teste concluído!');
        console.log('Agora você pode clicar em "ficar online" sem problemas.');

    } catch (error) {
        console.error('❌ Erro no teste:', error);
    }
};

// Executar se chamado diretamente
if (typeof window !== 'undefined') {
    testUserQuick();
}

export default testUserQuick;


