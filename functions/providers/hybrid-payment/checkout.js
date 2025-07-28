const WooviPixProvider = require('../woovi/checkout');
const AbacatePayPixProvider = require('../abacatepay/checkout');
const MercadoPagoProvider = require('../mercadopago/checkout');
const PagSeguroCardProvider = require('../pagseguro/checkout');

class HybridPaymentProvider {
    constructor() {
        this.pixProviders = [
            new WooviPixProvider(),
            new AbacatePayPixProvider()
        ];
        
        this.cardProviders = [
            new MercadoPagoProvider(),
            new PagSeguroCardProvider()
        ];
        
        this.currentPixProvider = 0;
        this.currentCardProvider = 0;
    }

    // Criar cobrança PIX com fallback
    async createPixCharge(chargeData) {
        let lastError = null;
        
        // Tentar todos os provedores PIX
        for (let i = 0; i < this.pixProviders.length; i++) {
            const provider = this.pixProviders[i];
            const providerName = provider.constructor.name;
            
            try {
                console.log(`🔄 Tentando PIX com ${providerName}...`);
                
                const result = await provider.createPixCharge(chargeData);
                
                if (result.success) {
                    console.log(`✅ PIX criado com sucesso via ${providerName}`);
                    this.currentPixProvider = i; // Atualizar provedor atual
                    return {
                        ...result,
                        fallbackUsed: i > 0,
                        primaryProvider: this.pixProviders[0].constructor.name,
                        actualProvider: providerName
                    };
                } else {
                    lastError = result.error;
                    console.log(`❌ Falha no ${providerName}: ${result.error}`);
                }
                
            } catch (error) {
                lastError = error.message;
                console.log(`❌ Erro no ${providerName}: ${error.message}`);
            }
        }
        
        // Se chegou aqui, todos os provedores falharam
        console.error('❌ Todos os provedores PIX falharam');
        return {
            success: false,
            error: `Todos os provedores PIX falharam. Último erro: ${lastError}`,
            fallbackUsed: false,
            providers: this.pixProviders.map(p => p.constructor.name)
        };
    }

    // Criar transação de cartão com fallback
    async createCardTransaction(transactionData) {
        let lastError = null;
        
        // Tentar todos os provedores de cartão
        for (let i = 0; i < this.cardProviders.length; i++) {
            const provider = this.cardProviders[i];
            const providerName = provider.constructor.name;
            
            try {
                console.log(`🔄 Tentando cartão com ${providerName}...`);
                
                let result;
                if (providerName === 'MercadoPagoProvider') {
                    // MercadoPago usa método diferente
                    result = await this.createMercadoPagoTransaction(provider, transactionData);
                } else {
                    result = await provider.createCardTransaction(transactionData);
                }
                
                if (result.success) {
                    console.log(`✅ Transação de cartão criada com sucesso via ${providerName}`);
                    this.currentCardProvider = i; // Atualizar provedor atual
                    return {
                        ...result,
                        fallbackUsed: i > 0,
                        primaryProvider: this.cardProviders[0].constructor.name,
                        actualProvider: providerName
                    };
                } else {
                    lastError = result.error;
                    console.log(`❌ Falha no ${providerName}: ${result.error}`);
                }
                
            } catch (error) {
                lastError = error.message;
                console.log(`❌ Erro no ${providerName}: ${error.message}`);
            }
        }
        
        // Se chegou aqui, todos os provedores falharam
        console.error('❌ Todos os provedores de cartão falharam');
        return {
            success: false,
            error: `Todos os provedores de cartão falharam. Último erro: ${lastError}`,
            fallbackUsed: false,
            providers: this.cardProviders.map(p => p.constructor.name)
        };
    }

    // Método específico para MercadoPago
    async createMercadoPagoTransaction(provider, transactionData) {
        try {
            const preference = {
                items: [
                    {
                        id: transactionData.orderId,
                        quantity: 1,
                        currency_id: 'BRL',
                        unit_price: parseFloat(transactionData.amount)
                    }
                ],
                back_urls: {
                    'success': transactionData.successUrl || 'https://leaf.app/success',
                    'failure': transactionData.failureUrl || 'https://leaf.app/failure'
                },
                auto_return: 'approved',
                notification_url: transactionData.notificationUrl || 'https://leaf-app-91dfdce0.cloudfunctions.net/mercadopago-webhook'
            };

            const result = await provider.createPreference(preference);
            
            return {
                success: true,
                data: result,
                preferenceId: result.id,
                initPoint: result.init_point,
                provider: 'mercadopago'
            };

        } catch (error) {
            return {
                success: false,
                error: error.message,
                provider: 'mercadopago'
            };
        }
    }

    // Consultar status de cobrança PIX
    async getPixChargeStatus(chargeId, providerIndex = null) {
        const providers = providerIndex !== null ? [this.pixProviders[providerIndex]] : this.pixProviders;
        
        for (const provider of providers) {
            try {
                const result = await provider.getChargeStatus(chargeId);
                if (result.success) {
                    return result;
                }
            } catch (error) {
                console.log(`❌ Erro ao consultar status em ${provider.constructor.name}: ${error.message}`);
            }
        }
        
        return {
            success: false,
            error: 'Não foi possível consultar o status da cobrança'
        };
    }

    // Consultar status de transação de cartão
    async getCardTransactionStatus(transactionId, providerIndex = null) {
        const providers = providerIndex !== null ? [this.cardProviders[providerIndex]] : this.cardProviders;
        
        for (const provider of providers) {
            try {
                const result = await provider.getTransactionStatus(transactionId);
                if (result.success) {
                    return result;
                }
            } catch (error) {
                console.log(`❌ Erro ao consultar status em ${provider.constructor.name}: ${error.message}`);
            }
        }
        
        return {
            success: false,
            error: 'Não foi possível consultar o status da transação'
        };
    }

    // Processar webhook PIX
    async processPixWebhook(webhookData, providerIndex = null) {
        const providers = providerIndex !== null ? [this.pixProviders[providerIndex]] : this.pixProviders;
        
        for (const provider of providers) {
            try {
                const result = await provider.processWebhook(webhookData);
                if (result.success) {
                    return result;
                }
            } catch (error) {
                console.log(`❌ Erro ao processar webhook em ${provider.constructor.name}: ${error.message}`);
            }
        }
        
        return {
            success: false,
            error: 'Não foi possível processar o webhook'
        };
    }

    // Processar webhook de cartão
    async processCardWebhook(webhookData, providerIndex = null) {
        const providers = providerIndex !== null ? [this.cardProviders[providerIndex]] : this.cardProviders;
        
        for (const provider of providers) {
            try {
                const result = await provider.processWebhook(webhookData);
                if (result.success) {
                    return result;
                }
            } catch (error) {
                console.log(`❌ Erro ao processar webhook em ${provider.constructor.name}: ${error.message}`);
            }
        }
        
        return {
            success: false,
            error: 'Não foi possível processar o webhook'
        };
    }

    // Obter estatísticas dos provedores
    getProviderStats() {
        return {
            pixProviders: this.pixProviders.map(p => ({
                name: p.constructor.name,
                status: 'active'
            })),
            cardProviders: this.cardProviders.map(p => ({
                name: p.constructor.name,
                status: 'active'
            })),
            currentPixProvider: this.pixProviders[this.currentPixProvider].constructor.name,
            currentCardProvider: this.cardProviders[this.currentCardProvider].constructor.name
        };
    }

    // Testar conectividade dos provedores
    async testProviderConnectivity() {
        const results = {
            pix: {},
            card: {}
        };

        // Testar provedores PIX
        for (const provider of this.pixProviders) {
            const providerName = provider.constructor.name;
            try {
                // Teste simples de conectividade
                const testResult = await provider.createPixCharge({
                    value: 0.01,
                    comment: 'Teste de conectividade',
                    correlationID: `test_${Date.now()}`
                });
                
                results.pix[providerName] = {
                    status: testResult.success ? 'online' : 'error',
                    error: testResult.error || null
                };
            } catch (error) {
                results.pix[providerName] = {
                    status: 'error',
                    error: error.message
                };
            }
        }

        // Testar provedores de cartão
        for (const provider of this.cardProviders) {
            const providerName = provider.constructor.name;
            try {
                // Teste simples de conectividade
                const testResult = await provider.createSession ? 
                    await provider.createSession() : 
                    { success: true }; // MercadoPago não tem createSession
                
                results.card[providerName] = {
                    status: testResult.success ? 'online' : 'error',
                    error: testResult.error || null
                };
            } catch (error) {
                results.card[providerName] = {
                    status: 'error',
                    error: error.message
                };
            }
        }

        return results;
    }
}

module.exports = HybridPaymentProvider; 