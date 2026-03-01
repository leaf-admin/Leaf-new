module.exports.WooviConfig = {
    // Configuração Sandbox Woovi
    apiKey: 'Q2xpZW50X0lkXzE4YzBkYzI3LTYzMDYtNDFkYy1hMmRlLWI2MzAzMzQ3YzNhZTpDbGllbnRfU2VjcmV0X29WWHc0TXJubnk5a0Q4R3laU1dXV01ROCsrbzh2a0xhR0FlVkRUZnNyeHc9',
    baseUrl: 'https://api-sandbox.woovi.com/api/v1',
    webhookUrl: 'http://localhost:3001/api/woovi/webhooks',
    appId: 'Client_Id_18c0dc27-6306-41dc-a2de-b6303347c3ae',
    environment: 'sandbox',
    
    // Configurações PIX
    pixKey: 'test@leaf.app.br', // Chave PIX de teste
    beneficiary: {
        name: 'Leaf App - Sandbox',
        document: '12345678000199', // CNPJ de teste
        city: 'Rio de Janeiro',
        identifier: 'LEAF_SANDBOX'
    },
    
    // Configurações de teste
    testMode: true,
    timeout: 30000
}; 