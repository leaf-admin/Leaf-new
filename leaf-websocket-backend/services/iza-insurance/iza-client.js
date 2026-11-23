'use strict';

// Cliente HTTP da API de seguro intermitente da IZA (acidentes pessoais por corrida).
// Documentação: https://integracao.iza.com.vc/ — autenticação Basic com
// User API ID e Secret Key, uma credencial por ambiente (HML não vale em produção).
//
// O que a homologação mostrou e difere da documentação (testado em 2026-11-23):
// - POST /persons repetido devolve 201 com a mesma pessoa (não 409).
// - POST de período com o mesmo início cria OUTRO período: não há trava de
//   duplicidade. Quem tenta de novo precisa consultar a lista antes.
// - Na lista, status 1 = aberto, 2 = encerrado, 3 = cancelado, e o "Z" do
//   startedAt é horário de Brasília, não UTC.
// - Erros 409 de período vêm em { error: { detail } }; os de cadastro em
//   { errors: { detail | details | <campo>: [...] } }.

const DEFAULT_TIMEOUT_MS = 10000;
const IZA_TIMEZONE = 'America/Sao_Paulo';

const PERIOD_LIST_STATUS = Object.freeze({ 1: 'open', 2: 'finished', 3: 'canceled' });

class IzaApiError extends Error {
  constructor(message, { status = null, body = null, method = null, path = null, retryable = false, code = null } = {}) {
    super(message);
    this.name = 'IzaApiError';
    this.status = status;
    this.body = body;
    this.method = method;
    this.path = path;
    this.retryable = retryable;
    this.code = code;
  }
}

function readIzaConfig(env = process.env) {
  return {
    enabled: String(env.IZA_INSURANCE_ENABLED || 'false').trim().toLowerCase() === 'true',
    environment: String(env.IZA_ENV || 'hml').trim().toLowerCase(),
    baseUrl: String(env.IZA_API_BASE_URL || '').trim().replace(/\/+$/, ''),
    userApiId: String(env.IZA_USER_API_ID || '').trim(),
    secretKey: String(env.IZA_SECRET_KEY || '').trim(),
    timeoutMs: Math.max(1000, Number.parseInt(env.IZA_API_TIMEOUT_MS || String(DEFAULT_TIMEOUT_MS), 10) || DEFAULT_TIMEOUT_MS)
  };
}

function isIzaConfigured(config) {
  return Boolean(config?.baseUrl && config?.userApiId && config?.secretKey);
}

// Usado pelo config:validate. Com a flag ligada, credencial completa e host do
// mesmo ambiente (a credencial de homologação não funciona em produção).
function izaConfigErrors(env = process.env) {
  const config = readIzaConfig(env);
  if (!config.enabled) return [];
  const errors = [];
  if (!isIzaConfigured(config)) errors.push('IZA_INSURANCE_ENABLED=true exige IZA_API_BASE_URL, IZA_USER_API_ID e IZA_SECRET_KEY');
  if (!['hml', 'prod'].includes(config.environment)) errors.push('IZA_ENV deve ser hml ou prod');
  if (config.baseUrl && !config.baseUrl.startsWith('https://')) errors.push('IZA_API_BASE_URL precisa ser https');
  const isHmlHost = /\.hml\./i.test(config.baseUrl);
  if (config.baseUrl && config.environment === 'prod' && isHmlHost) errors.push('IZA_ENV=prod apontando para o host de homologação da IZA');
  if (config.baseUrl && config.environment === 'hml' && !isHmlHost) errors.push('IZA_ENV=hml apontando para o host de produção da IZA');
  return errors;
}

// Data e hora de Brasília sem offset ("2026-08-13T14:22:00"), o formato que a IZA pede.
function toIzaLocalDateTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: IZA_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(date).map((part) => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

// A IZA devolve horário de Brasília com um "Z" que não é UTC; aqui só tiramos o sufixo.
function normalizeIzaLocalDateTime(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  return raw.replace(/(\.\d+)?Z$/i, '').slice(0, 19);
}

function errorDetail(body) {
  if (!body || typeof body !== 'object') return typeof body === 'string' ? body.slice(0, 200) : null;
  const holder = body.errors || body.error || {};
  if (typeof holder === 'string') return holder;
  if (holder.detail) return String(holder.detail);
  if (holder.details) return String(holder.details);
  const [field, messages] = Object.entries(holder)[0] || [];
  if (field) return `${field}: ${Array.isArray(messages) ? messages.join(', ') : messages}`;
  return null;
}

function createIzaClient({ config = readIzaConfig(), fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch indisponível para o cliente da IZA');
  const authorization = `Basic ${Buffer.from(`${config.userApiId}:${config.secretKey}`).toString('base64')}`;

  async function request(method, path, body) {
    if (!isIzaConfigured(config)) {
      throw new IzaApiError('Credencial da IZA não configurada', { method, path, code: 'IZA_NOT_CONFIGURED' });
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    let response;
    try {
      response = await fetchImpl(`${config.baseUrl}${path}`, {
        method,
        headers: { Authorization: authorization, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal
      });
    } catch (error) {
      throw new IzaApiError(`Falha de rede na IZA: ${error?.name === 'AbortError' ? 'timeout' : error?.message}`, {
        method,
        path,
        retryable: true,
        code: error?.name === 'AbortError' ? 'IZA_TIMEOUT' : 'IZA_NETWORK'
      });
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text().catch(() => '');
    let parsed = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch (_) {
        parsed = text;
      }
    }
    // Fora do horário (8h às 20h) a homologação responde 503 com uma página HTML.
    const retryable = response.status >= 500 || response.status === 429;
    return { status: response.status, body: parsed, retryable, detail: errorDetail(parsed) };
  }

  function fail(result, method, path, code) {
    throw new IzaApiError(`IZA ${method} ${path} respondeu ${result.status}: ${result.detail || 'sem detalhe'}`, {
      status: result.status,
      body: result.body,
      method,
      path,
      retryable: result.retryable,
      code
    });
  }

  return {
    config,

    async getPartnerInfo() {
      const result = await request('GET', '/partner-info');
      if (result.status !== 200) fail(result, 'GET', '/partner-info', 'IZA_PARTNER_INFO');
      return result.body?.partner_info || result.body;
    },

    // Cadastra a pessoa. Já existente = sucesso (201 repetido ou 409).
    async createPerson({ doc, name, birthedAt, email, mainCellPhone }) {
      const payload = { doc, name };
      if (birthedAt) payload.birthed_at = birthedAt;
      if (email) payload.email = email;
      if (mainCellPhone) payload.main_cell_phone = mainCellPhone;
      const result = await request('POST', '/persons', payload);
      if (result.status === 201 || result.status === 200) return { created: true, person: result.body };
      if (result.status === 409) return { created: false, person: null };
      const detail = String(result.detail || '');
      let code = 'IZA_PERSON_REJECTED';
      if (detail.includes('invalid_verifier')) code = 'IZA_INVALID_CPF';
      else if (detail.includes('unsupported_age')) code = 'IZA_UNSUPPORTED_AGE';
      else if (/^email:/.test(detail)) code = 'IZA_EMAIL_TAKEN';
      else if (/^main_cell_phone:/.test(detail)) code = 'IZA_PHONE_TAKEN';
      else if (/^name:/.test(detail)) code = 'IZA_NAME_INVALID';
      return fail(result, 'POST', '/persons', code);
    },

    // Um contrato por CPF. Já existente (400 already_has_contract) = sucesso.
    async createContract({ doc }) {
      const result = await request('POST', '/contracts', { doc });
      if (result.status === 201 || result.status === 200) return { created: true, contractId: result.body?.id || null };
      if (String(result.detail || '').includes('already_has_contract')) return { created: false, contractId: null };
      return fail(result, 'POST', '/contracts', 'IZA_CONTRACT_REJECTED');
    },

    async openPeriod({ doc, startedAt, timezone = IZA_TIMEZONE }) {
      const path = '/intermittent/persons/periods';
      const result = await request('POST', path, { doc, started_at: startedAt, timezone });
      if ((result.status === 201 || result.status === 200) && result.body?.id) return { periodId: String(result.body.id) };
      const detail = String(result.detail || '');
      let code = 'IZA_PERIOD_OPEN_REJECTED';
      if (result.status === 404 && detail.includes('individual')) code = 'IZA_PERSON_NOT_REGISTERED';
      else if (detail.includes('tolerance')) code = 'IZA_PERIOD_TOLERANCE_EXCEEDED';
      else if (detail.includes('vigency')) code = 'IZA_OUTSIDE_CONTRACT_VIGENCY';
      else if (detail.includes('future')) code = 'IZA_PERIOD_IN_FUTURE';
      else if (result.status === 409) code = 'IZA_PERIOD_OVERLAP';
      else if (result.status === 401) code = 'IZA_UNAUTHORIZED';
      else if (result.status === 403) code = 'IZA_ACCESS_NOT_ACTIVE';
      return fail(result, 'POST', path, code);
    },

    // Encerra. 409 com o período já encerrado/cancelado volta como alreadyFinal.
    async closePeriod({ periodId, finishedAt }) {
      const path = `/intermittent/persons/periods/${encodeURIComponent(periodId)}`;
      const result = await request('PUT', path, { finished_at: finishedAt });
      if (result.status === 200 || result.status === 204) return { closed: true, alreadyFinal: false };
      const detail = String(result.detail || '');
      if (result.status === 409 && !/higher than the start/i.test(detail)) return { closed: false, alreadyFinal: true, detail };
      let code = 'IZA_PERIOD_CLOSE_REJECTED';
      if (result.status === 404) code = 'IZA_PERIOD_NOT_FOUND';
      else if (/higher than the start/i.test(detail)) code = 'IZA_FINISH_BEFORE_START';
      else if (/future/i.test(detail)) code = 'IZA_PERIOD_IN_FUTURE';
      return fail(result, 'PUT', path, code);
    },

    // Cancela (só vale nos 2 primeiros minutos). Fora do prazo volta tooLate: o
    // período segue valendo e precisa ser encerrado.
    async cancelPeriod({ periodId }) {
      const path = `/intermittent/persons/periods/${encodeURIComponent(periodId)}/cancel`;
      const result = await request('PUT', path);
      if (result.status === 200 || result.status === 204) return { canceled: true };
      const detail = String(result.detail || '');
      if (result.status === 409 && /tolerance/i.test(detail)) return { canceled: false, tooLate: true };
      if (result.status === 409 && /already canceled/i.test(detail)) return { canceled: true, alreadyFinal: true };
      if (result.status === 409) return { canceled: false, alreadyFinal: true, detail };
      return fail(result, 'PUT', path, result.status === 404 ? 'IZA_PERIOD_NOT_FOUND' : 'IZA_PERIOD_CANCEL_REJECTED');
    },

    async sendGeolocation({ doc, datetime, lat, lng }) {
      const path = '/intermittent/persons/geolocation';
      const result = await request('POST', path, {
        doc,
        datetime,
        lat: Number(lat).toFixed(6),
        long: Number(lng).toFixed(6)
      });
      if (result.status === 204 || result.status === 200 || result.status === 201) return { sent: true };
      return fail(result, 'POST', path, 'IZA_GEOLOCATION_REJECTED');
    },

    // Períodos de um CPF numa janela (padrão da IZA: últimos 7 dias).
    async listPeriods({ doc, startedAt, finishedAt } = {}) {
      const params = new URLSearchParams();
      if (doc) params.set('doc', doc);
      if (startedAt) params.set('started_at', startedAt);
      if (finishedAt) params.set('finished_at', finishedAt);
      const query = params.toString();
      const path = `/intermittent/persons/periods${query ? `?${query}` : ''}`;
      const result = await request('GET', path);
      if (result.status === 404) return [];
      if (result.status !== 200) fail(result, 'GET', '/intermittent/persons/periods', 'IZA_PERIOD_LIST');
      const rows = (Array.isArray(result.body) ? result.body : [])
        // Sem CPF a IZA agrupa por pessoa; com CPF a lista vem plana.
        .flatMap((row) => (Array.isArray(row?.periods) ? row.periods : [row]));
      return rows.map((row) => ({
        id: String(row.id || ''),
        startedAt: normalizeIzaLocalDateTime(row.startedAt || row.started_at),
        finishedAt: normalizeIzaLocalDateTime(row.finishedAt || row.finished_at),
        status: PERIOD_LIST_STATUS[row.status] || String(row.status || '')
      }));
    }
  };
}

module.exports = {
  IZA_TIMEZONE,
  IzaApiError,
  createIzaClient,
  isIzaConfigured,
  izaConfigErrors,
  normalizeIzaLocalDateTime,
  readIzaConfig,
  toIzaLocalDateTime
};
