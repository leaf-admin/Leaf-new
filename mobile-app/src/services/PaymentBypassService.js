import Logger from '../utils/Logger';
// PaymentBypassService.js
// Serviço para bypass de pagamentos em usuários de teste

import AsyncStorage from '@react-native-async-storage/async-storage';


class PaymentBypassService {
    constructor() {
        // Usa __DEV__ para permitir apenas no modo desenvolvedor do RN ou se E2E_TEST for explicitly true
        this.isTestMode = __DEV__ || process.env.EXPO_PUBLIC_E2E_TEST === 'true';
    }

    // Verificar se é customer de teste
    async isTestCustomer() {
        try {
            const isTestCustomer = await AsyncStorage.getItem('@test_customer');
            return isTestCustomer === 'true';
        } catch (error) {
            Logger.error('❌ Erro ao verificar customer de teste:', error);
            return false;
        }
    }

    // Verificar se tem bypass de pagamento
    async hasPaymentBypass() {
        try {
            const userData = await AsyncStorage.getItem('@user_data');
            if (!userData) return false;

            const user = JSON.parse(userData);
            return user?.permissions?.bypassPayment === true;
        } catch (error) {
            Logger.error('❌ Erro ao verificar bypass de pagamento:', error);
            return false;
        }
    }

    // Simular pagamento bem-sucedido
    async simulatePaymentSuccess(paymentData) {
        try {
            if (!this.isTestMode) {
                throw new Error('Bypass de pagamento apenas disponível em desenvolvimento');
            }

            const hasBypass = await this.hasPaymentBypass();
            if (!hasBypass) {
                throw new Error('Usuário não tem permissão para bypass de pagamento');
            }

            Logger.log('🧪 BYPASS: Simulando pagamento bem-sucedido...');
            Logger.log('📊 Dados do pagamento:', paymentData);

            // Simular delay de processamento
            await new Promise(resolve => setTimeout(resolve, 1000));

            const mockPaymentResult = {
                success: true,
                paymentId: `mock_payment_${Date.now()}`,
                transactionId: `txn_${Date.now()}`,
                amount: paymentData.amount || 25.50,
                status: 'confirmed',
                method: paymentData.method || 'credit_card',
                timestamp: new Date().toISOString(),
                bypassed: true,
                message: 'Pagamento simulado com sucesso (modo teste)'
            };

            Logger.log('✅ Pagamento simulado:', mockPaymentResult);
            return mockPaymentResult;

        } catch (error) {
            Logger.error('❌ Erro ao simular pagamento:', error);
            throw error;
        }
    }

    // Simular verificação de status de pagamento
    async simulatePaymentStatusCheck(paymentId) {
        try {
            if (!this.isTestMode) {
                throw new Error('Bypass de pagamento apenas disponível em desenvolvimento');
            }

            const hasBypass = await this.hasPaymentBypass();
            if (!hasBypass) {
                throw new Error('Usuário não tem permissão para bypass de pagamento');
            }

            Logger.log('🧪 BYPASS: Simulando verificação de status...');
            Logger.log('📊 Payment ID:', paymentId);

            // Simular delay de verificação
            await new Promise(resolve => setTimeout(resolve, 500));

            const mockStatusResult = {
                success: true,
                paymentId: paymentId,
                status: 'confirmed',
                amount: 25.50,
                timestamp: new Date().toISOString(),
                bypassed: true,
                message: 'Status verificado com sucesso (modo teste)'
            };

            Logger.log('✅ Status verificado:', mockStatusResult);
            return mockStatusResult;

        } catch (error) {
            Logger.error('❌ Erro ao verificar status:', error);
            throw error;
        }
    }

    // Simular cancelamento de pagamento
    async simulatePaymentCancellation(paymentId) {
        try {
            if (!this.isTestMode) {
                throw new Error('Bypass de pagamento apenas disponível em desenvolvimento');
            }

            const hasBypass = await this.hasPaymentBypass();
            if (!hasBypass) {
                throw new Error('Usuário não tem permissão para bypass de pagamento');
            }

            Logger.log('🧪 BYPASS: Simulando cancelamento de pagamento...');
            Logger.log('📊 Payment ID:', paymentId);

            // Simular delay de cancelamento
            await new Promise(resolve => setTimeout(resolve, 500));

            const mockCancellationResult = {
                success: true,
                paymentId: paymentId,
                status: 'cancelled',
                refundAmount: 25.50,
                refundStatus: 'processed',
                timestamp: new Date().toISOString(),
                bypassed: true,
                message: 'Pagamento cancelado com sucesso (modo teste)'
            };

            Logger.log('✅ Pagamento cancelado:', mockCancellationResult);
            return mockCancellationResult;

        } catch (error) {
            Logger.error('❌ Erro ao cancelar pagamento:', error);
            throw error;
        }
    }

    // Verificar se deve usar bypass
    async shouldUseBypass() {
        try {
            return this.isTestMode && await this.hasPaymentBypass();
        } catch (error) {
            Logger.error('❌ Erro ao verificar se deve usar bypass:', error);
            return false;
        }
    }

    // Logar informações de debug
    async logDebugInfo() {
        try {
            const isTestCustomer = await this.isTestCustomer();
            const hasBypass = await this.hasPaymentBypass();
            const shouldUse = await this.shouldUseBypass();

            Logger.log('🔍 DEBUG - Payment Bypass Service:');
            Logger.log('  Modo de teste:', this.isTestMode);
            Logger.log('  É customer de teste:', isTestCustomer);
            Logger.log('  Tem bypass de pagamento:', hasBypass);
            Logger.log('  Deve usar bypass:', shouldUse);
        } catch (error) {
            Logger.error('❌ Erro ao logar informações de debug:', error);
        }
    }
}

// Exportar instância singleton
export default new PaymentBypassService();


