module.exports.WooviConfig = {
    apiKey: 'YOUR_SANDBOX_API_KEY', // Substitua pela sua API Key do sandbox
    baseUrl: 'https://api.woovi.com/api/v1',
    webhookUrl: 'https://leaf-reactnative-default-rtdb.firebaseio.com/webhooks/woovi',
    pixKey: 'YOUR_PIX_KEY', // Substitua pela sua chave PIX
    beneficiary: {
        name: 'Leaf App',
        document: 'YOUR_CPF_OR_CNPJ', // Substitua pelo CPF/CNPJ
        city: 'YOUR_CITY', // Substitua pela cidade
        identifier: 'LEAF_APP' // Identificador opcional
    }
}; 