// Configuração Woovi Sandbox
const { getNgrokWebhookUrl } = require('./load-ngrok-url');

// ✅ Função para obter webhookUrl dinamicamente (carrega do ngrok automaticamente)
function getWebhookUrl() {
  return getNgrokWebhookUrl();
}

const WOOVI_SANDBOX_CONFIG = {
  // Credenciais Sandbox
  // IMPORTANTE: preencher via .env / variáveis do ambiente.
  // Não manter segredos hardcoded no repositório.
  clientId: process.env.WOOVI_APP_ID || '',
  clientSecret: process.env.WOOVI_CLIENT_SECRET || '',
  apiToken: process.env.WOOVI_API_TOKEN || '',
  
  // URLs da API
  // Endpoint REST da API Woovi Sandbox
  baseUrl: process.env.WOOVI_BASE_URL || 'https://api.woovi-sandbox.com/api/v1',
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









