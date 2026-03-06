const DEFAULT_BASE_URL = 'https://api.woovi-sandbox.com/api/v1';

function normalizeBaseUrl(rawUrl) {
  const source = String(rawUrl || '').trim();
  if (!source) {
    return DEFAULT_BASE_URL;
  }

  const noTrailingSlash = source.replace(/\/+$/, '');
  // Se o usuário configurou apenas o host, anexar /api/v1 automaticamente.
  if (/\/api\/v1$/i.test(noTrailingSlash)) {
    return noTrailingSlash;
  }
  return `${noTrailingSlash}/api/v1`;
}

function getWooviConfig() {
  const environment = (process.env.WOOVI_ENVIRONMENT || process.env.NODE_ENV || 'sandbox').toLowerCase();
  const clientSecret = process.env.WOOVI_CLIENT_SECRET || '';
  const appId = process.env.WOOVI_APP_ID || '';
  const preferApiToken = String(process.env.WOOVI_PREFER_API_TOKEN || '').toLowerCase() === 'true';
  const envApiToken = process.env.WOOVI_API_TOKEN || '';
  const derivedApiToken = appId && clientSecret
    ? Buffer.from(`${appId}:${clientSecret}`).toString('base64')
    : '';
  const apiToken = (!preferApiToken && derivedApiToken) ? derivedApiToken : (envApiToken || derivedApiToken);
  const rawBaseUrl = process.env.WOOVI_BASE_URL || DEFAULT_BASE_URL;
  const forcingSandbox = environment !== 'production' && /api\.woovi\.com/i.test(rawBaseUrl);
  const baseUrl = normalizeBaseUrl(forcingSandbox ? DEFAULT_BASE_URL : rawBaseUrl);

  return {
    environment,
    apiToken,
    appId,
    baseUrl,
    masterApiToken: process.env.WOOVI_MASTER_API_TOKEN || null,
    masterAppId: process.env.WOOVI_MASTER_APP_ID || null,
    leafPixKey: process.env.LEAF_PIX_KEY || ''
  };
}

function getWooviAuthHeaders(config = getWooviConfig()) {
  const headers = {
    'Content-Type': 'application/json'
  };

  if (config.apiToken) {
    headers.Authorization = config.apiToken;
  }

  // Alguns ambientes sandbox rejeitam x-app-id mesmo com token válido.
  // Só envia quando explicitamente habilitado.
  const sendAppId = String(process.env.WOOVI_SEND_APP_ID || '').toLowerCase() === 'true';
  if (sendAppId && config.appId) {
    headers['x-app-id'] = config.appId;
  }

  return headers;
}

module.exports = {
  DEFAULT_BASE_URL,
  normalizeBaseUrl,
  getWooviConfig,
  getWooviAuthHeaders
};
