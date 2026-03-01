// activate-test-user.js
// Script para ativar usuário de teste rapidamente

import TestUserService from './src/services/TestUserService';

const activateTestUser = async () => {
    try {
        console.log('🧪 Ativando usuário de teste...');
        
        // Verificar se estamos em desenvolvimento
        if (!__DEV__) {
            console.log('⚠️ Este script só funciona em modo de desenvolvimento');
            return;
        }

        // Ativar usuário de teste
        const success = await TestUserService.simulateTestUserAuth();
        
        if (success) {
            console.log('✅ Usuário de teste ativado com sucesso!');
            
            // Configurar como driver por padrão
            await TestUserService.setTestUserAsDriver();
            console.log('🚗 Configurado como driver');
            
            // Logar informações de debug
            await TestUserService.logDebugInfo();
            
        } else {
            console.log('❌ Falha ao ativar usuário de teste');
        }
        
    } catch (error) {
        console.error('❌ Erro ao ativar usuário de teste:', error);
    }
};

// Executar se chamado diretamente
if (typeof window !== 'undefined') {
    activateTestUser();
}

export default activateTestUser;


