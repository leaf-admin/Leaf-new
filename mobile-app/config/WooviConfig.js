const DEFAULT_PUBLIC_BACKEND_URL = 'https://api.62.169.31.231.sslip.io';

const normalizeBaseUrl = (url) => {
    const raw = String(url || '').trim();
    if (!raw) return DEFAULT_PUBLIC_BACKEND_URL;
    const withoutTrailingSlash = raw.replace(/\/+$/, '');
    return withoutTrailingSlash.replace(/\/api$/i, '');
};

const publicBackendBaseUrl = normalizeBaseUrl(
    process.env.EXPO_PUBLIC_WOOVI_WEBHOOK_BASE_URL ||
    process.env.EXPO_PUBLIC_BACKEND_URL ||
    process.env.EXPO_PUBLIC_API_URL ||
    DEFAULT_PUBLIC_BACKEND_URL
);

module.exports.WooviConfig = {
    // OBS: Mobile não deve chamar Woovi diretamente em produção.
    // O fluxo oficial usa o backend Leaf.
    apiKey: '',
    baseUrl: 'https://api.woovi.com/api/v1',
    webhookUrl: `${publicBackendBaseUrl}/api/woovi/webhook`,
    appId: '',
    environment: process.env.EXPO_PUBLIC_ENV || process.env.NODE_ENV || 'production',

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
