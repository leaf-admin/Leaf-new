const SANDBOX_BASE_URL = 'https://api.woovi-sandbox.com/api/v1';
const PRODUCTION_BASE_URL = 'https://api.woovi.com/api/v1';
const DEFAULT_BASE_URL = SANDBOX_BASE_URL;
const CLIENT_ID_PATTERN = /^Client_Id_/i;

function firstNonEmpty(...values) {
  for (const value of values) {
    const normalized = String(value || '').trim();
    if (normalized) {
      return normalized;
    }
  }
  return '';
}

function looksLikeClientId(value) {
  return CLIENT_ID_PATTERN.test(String(value || '').trim());
}

function normalizeBaseUrl(rawUrl) {
  const source = String(rawUrl || '').trim();
  if (!source) {
    return SANDBOX_BASE_URL;
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
  const legacyWooviAppId = firstNonEmpty(process.env.WOOVI_APP_ID);
  const clientId = firstNonEmpty(
    process.env.WOOVI_CLIENT_ID,
    looksLikeClientId(legacyWooviAppId) ? legacyWooviAppId : ''
  );
  const clientSecret = firstNonEmpty(process.env.WOOVI_CLIENT_SECRET);
  const derivedAuthorizationAppId = clientId && clientSecret
    ? Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
    : '';

  // Na documentação da Woovi/OpenPix, o header Authorization recebe o "AppID".
  // O valor Client_Id_... não deve ser enviado como Authorization.
  const authorizationAppId = firstNonEmpty(
    process.env.WOOVI_AUTHORIZATION_APP_ID,
    process.env.WOOVI_APP_ID_TOKEN,
    process.env.WOOVI_API_TOKEN,
    looksLikeClientId(legacyWooviAppId) ? '' : legacyWooviAppId,
    derivedAuthorizationAppId
  );

  const rawBaseUrl = firstNonEmpty(
    process.env.WOOVI_BASE_URL,
    environment === 'production' ? PRODUCTION_BASE_URL : SANDBOX_BASE_URL
  );
  const forcingSandbox = environment !== 'production' && /api\.woovi\.com/i.test(rawBaseUrl);
  const baseUrl = normalizeBaseUrl(forcingSandbox ? SANDBOX_BASE_URL : rawBaseUrl);

  return {
    environment,
    apiToken: authorizationAppId,
    authorizationAppId,
    clientId,
    // Compatibilidade com código legado: daqui para frente appId representa o
    // identificador da aplicação, não o token de Authorization.
    appId: clientId,
    baseUrl,
    // Fallback para reduzir erros operacionais: se não houver chave master dedicada,
    // usa o token principal informado em WOOVI_API_TOKEN.
    masterApiToken: firstNonEmpty(
      process.env.WOOVI_MASTER_AUTHORIZATION_APP_ID,
      process.env.WOOVI_MASTER_APP_ID_TOKEN,
      process.env.WOOVI_MASTER_API_TOKEN,
      authorizationAppId
    ) || null,
    masterAppId: firstNonEmpty(
      process.env.WOOVI_MASTER_CLIENT_ID,
      process.env.WOOVI_MASTER_APP_ID,
      clientId
    ) || null,
    leafPixKey: process.env.LEAF_PIX_KEY || ''
  };
}

function getWooviAuthHeaders(config = getWooviConfig()) {
  const headers = {
    'Content-Type': 'application/json'
  };

  const authorizationAppId = config.authorizationAppId || config.apiToken;
  if (authorizationAppId) {
    headers.Authorization = authorizationAppId;
  }

  // A criação/listagem de cobranças usa Authorization: <AppID>. O x-app-id fica
  // reservado para cenários legados/diagnóstico e só é enviado via opt-in.
  const sendAppId = String(process.env.WOOVI_SEND_APP_ID || '').toLowerCase() === 'true';
  const clientId = config.clientId || config.appId;
  if (sendAppId && clientId) {
    headers['x-app-id'] = clientId;
  }

  return headers;
}

module.exports = {
  DEFAULT_BASE_URL,
  PRODUCTION_BASE_URL,
  SANDBOX_BASE_URL,
  normalizeBaseUrl,
  looksLikeClientId,
  getWooviConfig,
  getWooviAuthHeaders
};
