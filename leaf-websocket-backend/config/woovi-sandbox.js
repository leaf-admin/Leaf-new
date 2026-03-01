// Configuração Woovi Sandbox
const { getNgrokWebhookUrl } = require('./load-ngrok-url');

// ✅ Função para obter webhookUrl dinamicamente (carrega do ngrok automaticamente)
function getWebhookUrl() {
  return getNgrokWebhookUrl();
}

const WOOVI_SANDBOX_CONFIG = {
  // Credenciais Sandbox
  clientId: 'Client_Id_18c0dc27-6306-41dc-a2de-b6303347c3ae',
  clientSecret: 'Client_Secret_oVXw4Mrnny9kD8GyZSWWWMQ8++8vkLaGAeVDTfsrxw=',
  apiToken: 'Q2xpZW50X0lkXzE4YzBkYzI3LTYzMDYtNDFkYy1hMmRlLWI2MzAzMzQ3YzNhZTpDbGllbnRfU2VjcmV0X29WWHc0TXJubnk5a0Q4R3laU1dXV01ROCsrbzh2a0xhR0FlVkRUZnNyeHc9',
  
  // URLs da API
  baseUrl: 'https://api-sandbox.woovi.com',
  // ✅ Carrega URL do ngrok automaticamente (arquivo .ngrok-url.json ou variável de ambiente)
  // ✅ Prioridade: WOOVI_WEBHOOK_URL env > arquivo .ngrok-url.json > fallback local
  // ✅ Usar getWebhookUrl() para obter URL dinamicamente
  get webhookUrl() {
    return getWebhookUrl();
  },
  
  // Configurações de ambiente
  environment: 'sandbox',
  timeout: 30000,
  
  // Webhooks disponíveis
  webhooks: {
    'TEST_LEAF001': 'Cobrança paga',
    'Leaf-charge.received': 'Transação PIX recebida',
    'Leaf-refund.received': 'Reembolso concluído',
    'Leaf-notthesame': 'Cobrança paga por outra pessoa',
    'Leaf-charge.confirmed': 'Cobrança paga',
    'Leaf-charge.expired': 'Cobrança expirada',
    'Leaf-charge.created': 'Nova cobrança criada'
  },
  
  // Configurações BaaS
  baas: {
    enabled: true,
    accountType: 'driver',
    defaultBalance: 0,
    minBalance: 0,
    maxBalance: 10000,
    transactionLimits: {
      daily: 5000,
      monthly: 50000,
      perTransaction: 1000
    }
  },
  
  // Configurações de PIX
  pix: {
    enabled: true,
    qrCodeExpiration: 3600, // 1 hora
    maxValue: 1000,
    minValue: 0.01
  }
};

module.exports = WOOVI_SANDBOX_CONFIG;
module.exports.getWebhookUrl = getWebhookUrl;










