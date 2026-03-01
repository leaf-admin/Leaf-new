// activate-test-customer.js
// Script para ativar rapidamente um customer de teste

import TestUserService from './src/services/TestUserService';
import PaymentBypassService from './src/services/PaymentBypassService';

const activateTestCustomer = async () => {
    try {
        console.log('🚀 Ativando Customer de Teste...');
        
        // Criar customer de teste
        const customerData = await TestUserService.createTestCustomer('11888888888');
        
        if (customerData) {
            console.log('✅ Customer de teste criado com sucesso!');
            console.log('📊 Dados do customer:', customerData);
            
            // Logar informações de debug
            await TestUserService.logDebugInfo();
            await PaymentBypassService.logDebugInfo();
            
            console.log('\n🎯 INFORMAÇÕES DO CUSTOMER DE TESTE:');
            console.log('📱 Número de telefone: 11888888888');
            console.log('👤 Nome: Customer de Teste');
            console.log('💰 Saldo inicial: R$ 500,00');
            console.log('⭐ Rating: 4.9');
            console.log('💳 Método de pagamento preferido: Cartão de Crédito');
            console.log('🔓 Bypass de pagamento: ATIVADO');
            console.log('🔓 Bypass de KYC: ATIVADO');
            console.log('🔓 Bypass de database: ATIVADO');
            
            console.log('\n🚀 PRÓXIMOS PASSOS:');
            console.log('1. Use o número 11888888888 para login');
            console.log('2. Todos os pagamentos serão simulados');
            console.log('3. Não será necessário KYC');
            console.log('4. Acesso total ao database');
            
            return customerData;
        } else {
            console.error('❌ Falha ao criar customer de teste');
            return false;
        }
        
    } catch (error) {
        console.error('❌ Erro ao ativar customer de teste:', error);
        return false;
    }
};

// Executar se chamado diretamente
if (require.main === module) {
    activateTestCustomer();
}

export default activateTestCustomer;


