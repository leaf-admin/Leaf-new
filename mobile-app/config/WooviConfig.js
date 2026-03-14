module.exports.WooviConfig = {
    // OBS: Mobile não deve chamar Woovi diretamente em produção.
    // O fluxo oficial usa o backend Leaf.
    apiKey: '',
    baseUrl: 'https://api.woovi.com/api/v1',
    webhookUrl: 'https://api.leaf.app.br/api/woovi/webhook', // URL para produção ou ngrok
    appId: '',
    environment: 'production',

    // Configurações PIX
    pixKey: '', // Configurar somente no backend
    beneficiary: {
        name: 'Leaf App - Sandbox',
        document: '12345678000199', // CNPJ de teste
        city: 'Rio de Janeiro',
        identifier: 'LEAF_SANDBOX'
    },

    // Configurações de teste
    testMode: false,
    timeout: 30000
};
