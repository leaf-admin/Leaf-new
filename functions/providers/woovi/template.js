const WooviPixProvider = require('./checkout');

// Template de configuração Woovi PIX
const wooviTemplate = {
    name: 'Woovi PIX',
    logo: 'woovi-logo.png',
    description: 'Pagamento PIX instantâneo via Woovi',
    features: [
        'PIX instantâneo',
        'QR Code personalizado',
        'Webhooks em tempo real',
        'Relatórios detalhados',
        'Suporte 24/7'
    ],
    
    // Configurações padrão
    config: {
        baseURL: 'https://api.openpix.com.br',
        timeout: 30000,
        retries: 3,
        webhookTimeout: 5000
    },

    // Campos de configuração necessários
    requiredFields: [
        {
            name: 'WOOVI_APP_ID',
            type: 'text',
            label: 'App ID',
            description: 'ID da aplicação OpenPix/Woovi',
            required: true
        },
        {
            name: 'WOOVI_WEBHOOK_URL',
            type: 'url',
            label: 'Webhook URL',
            description: 'URL para receber notificações',
            required: true,
            defaultValue: 'https://leaf-reactnative.web.app/woovi-webhook'
        }
    ],

    // Função de inicialização
    initialize: (config) => {
        return new WooviPixProvider(config);
    },

    // Função de teste
    testConnection: async (config) => {
        try {
            const provider = new WooviPixProvider(config);
            const result = await provider.listCharges({ limit: 1 });
            return {
                success: result.success,
                message: result.success ? 'Conexão estabelecida com sucesso!' : result.error
            };
        } catch (error) {
            return {
                success: false,
                message: `Erro ao testar conexão: ${error.message}`
            };
        }
    },

    // Função de criação de pagamento
    createPayment: async (config, paymentData) => {
        try {
            const provider = new WooviPixProvider(config);
            const result = await provider.createCustomPixCharge({
                value: paymentData.amount,
                customerName: paymentData.customerName,
                customerId: paymentData.customerId,
                bookingId: paymentData.bookingId,
                driverId: paymentData.driverId,
                comment: `Pagamento LEAF - ${paymentData.customerName}`,
                expiresIn: 3600 // 1 hora
            });

            return {
                success: result.success,
                data: result.qrCode,
                error: result.error
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    },

    // Função de consulta de status
    checkStatus: async (config, chargeId) => {
        try {
            const provider = new WooviPixProvider(config);
            const result = await provider.getChargeStatus(chargeId);
            
            return {
                success: result.success,
                status: result.status,
                data: result.data,
                error: result.error
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    },

    // Função de processamento de webhook
    processWebhook: (config, webhookData, signature, timestamp) => {
        try {
            const provider = new WooviPixProvider(config);
            
            // Validar assinatura do webhook
            if (!provider.validateWebhook(signature, timestamp, JSON.stringify(webhookData))) {
                return {
                    success: false,
                    error: 'Assinatura do webhook inválida'
                };
            }

            // Processar webhook
            const result = provider.processWebhook(webhookData);
            
            return {
                success: result.success,
                event: result.event,
                data: result,
                error: result.error
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    },

    // Configurações de UI
    ui: {
        colors: {
            primary: '#00D4AA',
            secondary: '#0066CC',
            success: '#28A745',
            warning: '#FFC107',
            danger: '#DC3545'
        },
        logo: {
            width: 120,
            height: 40,
            alt: 'Woovi PIX'
        }
    },

    // Documentação
    documentation: {
        setup: [
            '1. Crie uma conta na Woovi (https://woovi.com)',
            '2. Acesse o painel de desenvolvedores',
            '3. Crie uma nova aplicação',
            '4. Copie o App ID e Secret Key',
            '5. Configure o webhook URL',
            '6. Teste a integração'
        ],
        webhook: [
            'URL: https://leaf-reactnative.web.app/woovi-webhook',
            'Eventos: charge.confirmed, charge.expired, charge.overdue',
            'Método: POST',
            'Content-Type: application/json'
        ],
        testing: [
            'Use o ambiente de sandbox para testes',
            'Teste com valores pequenos primeiro',
            'Verifique os webhooks em tempo real',
            'Monitore os logs de transação'
        ]
    }
};

module.exports = wooviTemplate; 