// Envio do pacote de emergência para uma força de segurança (ex.: central 190), pronto para quando
// houver termo de cooperação. Desligado por padrão: sem PUBLIC_SAFETY_DISPATCH_ENABLED=true e uma
// URL HTTPS configurada, nada sai da Leaf. Nunca lança erro para quem chama: o fluxo de emergência
// segue igual e o resultado fica registrado no incidente.
const crypto = require('crypto');

const DEFAULT_TIMEOUT_MS = 4000;

function readConfig(env = process.env) {
  const enabled = String(env.PUBLIC_SAFETY_DISPATCH_ENABLED || 'false').trim().toLowerCase() === 'true';
  const url = String(env.PUBLIC_SAFETY_DISPATCH_URL || '').trim();
  const secret = String(env.PUBLIC_SAFETY_DISPATCH_SECRET || '').trim();
  const agency = String(env.PUBLIC_SAFETY_DISPATCH_AGENCY || '').trim() || null;
  const timeoutMs = Math.min(
    15000,
    Math.max(500, Number.parseInt(env.PUBLIC_SAFETY_DISPATCH_TIMEOUT_MS || `${DEFAULT_TIMEOUT_MS}`, 10) || DEFAULT_TIMEOUT_MS)
  );
  return { enabled, url, secret, agency, timeoutMs };
}

function signBody(secret, timestamp, body) {
  return `sha256=${crypto.createHmac('sha256', secret).update(`${timestamp}.`).update(body).digest('hex')}`;
}

function createPublicSafetyDispatchService({
  env = process.env,
  fetchImpl = (...args) => fetch(...args),
  now = () => new Date().toISOString()
} = {}) {
  async function dispatch({ incident, emergencyPackage, namespace = 'operational' } = {}) {
    const config = readConfig(env);
    const attemptedAt = now();
    const base = { agency: config.agency, attemptedAt };

    if (namespace === 'sandbox') return { ...base, status: 'skipped_sandbox' };
    if (!config.enabled) return { ...base, status: 'disabled' };
    if (!/^https:\/\//i.test(config.url) || !config.secret) return { ...base, status: 'not_configured' };
    if (!incident?.incidentId || !emergencyPackage) return { ...base, status: 'invalid_payload' };

    const body = JSON.stringify({
      source: 'leaf',
      incidentId: incident.incidentId,
      category: incident.category || 'emergency',
      openedAt: incident.openedAt || attemptedAt,
      package: emergencyPackage
    });
    const timestamp = String(Math.floor(Date.parse(attemptedAt) / 1000));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const response = await fetchImpl(config.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-leaf-timestamp': timestamp,
          'x-leaf-signature': signBody(config.secret, timestamp, body),
          'idempotency-key': incident.incidentId
        },
        body,
        signal: controller.signal
      });
      return {
        ...base,
        status: response.ok ? 'sent' : 'failed',
        httpStatus: response.status
      };
    } catch (error) {
      return {
        ...base,
        status: 'failed',
        error: error?.name === 'AbortError' ? 'timeout' : 'network_error'
      };
    } finally {
      clearTimeout(timer);
    }
  }

  return { dispatch, readConfig: () => readConfig(env) };
}

let defaultService = null;
function getDefaultPublicSafetyDispatchService() {
  if (!defaultService) defaultService = createPublicSafetyDispatchService();
  return defaultService;
}

module.exports = {
  createPublicSafetyDispatchService,
  getDefaultPublicSafetyDispatchService,
  signBody
};
