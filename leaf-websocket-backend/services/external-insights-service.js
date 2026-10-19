'use strict';

/**
 * Dados externos para o dashboard e os bots: erros (Sentry), uso (PostHog),
 * disponibilidade (UptimeRobot), tráfego do site (Cloudflare) e downloads da
 * App Store. Só leitura, com as chaves do servidor; o navegador nunca fala com
 * esses fornecedores. Cada fonte é opcional: sem a chave, ela aparece como
 * "not_configured" e as outras seguem. O snapshot inteiro fica em cache no
 * Redis para não gastar a cota das APIs a cada abertura do dashboard.
 */

const crypto = require('crypto');
const fs = require('fs');
const zlib = require('zlib');
const axios = require('axios');
const redisPool = require('../utils/redis-pool');
const { logStructured } = require('../utils/logger');

const CACHE_KEY = 'observability:external-insights:v1';
const DEFAULT_TTL_SECONDS = 600;
const MIN_TTL_SECONDS = 120;
const MAX_TTL_SECONDS = 3600;
const SOURCE_TIMEOUT_MS = 8000;
const ISSUES_PER_PROJECT = 5;
const DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

const UPTIME_STATUS = {
  0: 'paused',
  1: 'not_checked',
  2: 'up',
  8: 'seems_down',
  9: 'down'
};

// Product Type Identifier do relatório de vendas da Apple.
const APP_STORE_UNIT_TYPES = {
  downloads: new Set(['1', '1F', '1T', 'F1']),
  redownloads: new Set(['3', '3F', 'F3']),
  updates: new Set(['7', '7F', '7T', 'F7'])
};

function clampNumber(value, fallback, min, max) {
  const numeric = Number.parseInt(value, 10);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

function env(source, key) {
  return String(source[key] || '').trim();
}

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function isoDay(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

// Só o status HTTP e o código: a mensagem do axios pode trazer URL ou corpo.
function describeError(error) {
  if (error?.notConfigured) return null;
  const status = error?.response?.status;
  if (status) return `http_${status}`;
  return String(error?.code || 'request_failed');
}

function notConfigured() {
  const error = new Error('not_configured');
  error.notConfigured = true;
  return error;
}

function requireValues(values) {
  if (values.some((value) => !value)) throw notConfigured();
}

async function fetchSentry({ http, config }) {
  const token = env(config, 'SENTRY_READ_TOKEN');
  const org = env(config, 'SENTRY_ORG');
  const projects = [env(config, 'SENTRY_PROJECT_BACKEND'), env(config, 'SENTRY_PROJECT_MOBILE')].filter(Boolean);
  requireValues([token, org, projects.length]);
  const baseUrl = env(config, 'SENTRY_API_URL') || 'https://sentry.io';

  const results = await Promise.all(projects.map(async (project) => {
    const response = await http.get(`${baseUrl}/api/0/projects/${encodeURIComponent(org)}/${encodeURIComponent(project)}/issues/`, {
      params: { query: 'is:unresolved', statsPeriod: '24h', sort: 'freq', limit: ISSUES_PER_PROJECT },
      headers: { Authorization: `Bearer ${token}` },
      timeout: SOURCE_TIMEOUT_MS
    });
    const issues = Array.isArray(response.data) ? response.data : [];
    return {
      project,
      unresolvedSeen24h: toNumber(response.headers?.['x-hits'] ?? issues.length),
      topIssues: issues.map((issue) => ({
        id: String(issue.id),
        title: String(issue.title || '').slice(0, 160),
        culprit: String(issue.culprit || '').slice(0, 120),
        level: issue.level || 'error',
        events: toNumber(issue.count),
        users: toNumber(issue.userCount),
        firstSeen: issue.firstSeen || null,
        lastSeen: issue.lastSeen || null,
        link: issue.permalink || null
      }))
    };
  }));

  return { projects: results };
}

function posthogApiHost(config) {
  const explicit = env(config, 'POSTHOG_API_HOST');
  if (explicit) return explicit.replace(/\/$/, '');
  // O host de ingestão (eu.i.posthog.com) não serve a API privada.
  return (env(config, 'POSTHOG_HOST') || 'https://eu.i.posthog.com')
    .replace('.i.posthog.com', '.posthog.com')
    .replace(/\/$/, '');
}

async function fetchPosthog({ http, config }) {
  const token = env(config, 'POSTHOG_PERSONAL_API_KEY');
  const projectId = env(config, 'POSTHOG_PROJECT_ID');
  requireValues([token, projectId]);

  const query = [
    'select',
    'countIf(timestamp > now() - interval 1 day),',
    'uniqIf(person_id, timestamp > now() - interval 1 day),',
    'count(),',
    'uniq(person_id),',
    "countIf(event = '$rageclick'),",
    "countIf(event = '$exception')",
    `from events where timestamp > now() - interval ${DAYS} day`
  ].join(' ');
  const response = await http.post(
    `${posthogApiHost(config)}/api/projects/${encodeURIComponent(projectId)}/query/`,
    { query: { kind: 'HogQLQuery', query } },
    { headers: { Authorization: `Bearer ${token}` }, timeout: SOURCE_TIMEOUT_MS }
  );
  const [row = []] = response.data?.results || [];
  return {
    events24h: toNumber(row[0]),
    users24h: toNumber(row[1]),
    events7d: toNumber(row[2]),
    users7d: toNumber(row[3]),
    rageClicks7d: toNumber(row[4]),
    exceptions7d: toNumber(row[5])
  };
}

function parseUptimeRatios(value) {
  const [day, week, month] = String(value || '').split('-').map((part) => (
    part === '' || part === undefined ? null : Number(part)
  ));
  return { uptime24h: day ?? null, uptime7d: week ?? null, uptime30d: month ?? null };
}

async function fetchUptime({ http, config }) {
  const apiKey = env(config, 'UPTIMEROBOT_READ_ONLY_API_KEY');
  requireValues([apiKey]);

  const body = new URLSearchParams({
    api_key: apiKey,
    format: 'json',
    custom_uptime_ratios: '1-7-30',
    response_times: '1',
    response_times_limit: '1'
  }).toString();
  const response = await http.post('https://api.uptimerobot.com/v2/getMonitors', body, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: SOURCE_TIMEOUT_MS
  });
  if (response.data?.stat !== 'ok') {
    const error = new Error('uptime_api_error');
    error.code = 'uptime_api_error';
    throw error;
  }
  const monitors = (response.data.monitors || []).map((monitor) => ({
    name: monitor.friendly_name || monitor.url,
    url: monitor.url,
    status: UPTIME_STATUS[monitor.status] || 'unknown',
    ...parseUptimeRatios(monitor.custom_uptime_ratio),
    responseMs: monitor.average_response_time == null ? null : toNumber(monitor.average_response_time)
  }));
  return {
    monitors,
    down: monitors.filter((monitor) => ['down', 'seems_down'].includes(monitor.status)).length
  };
}

async function fetchCloudflare({ http, config, now }) {
  const token = env(config, 'CLOUDFLARE_READ_TOKEN');
  const zoneId = env(config, 'CLOUDFLARE_ZONE_ID');
  requireValues([token, zoneId]);
  if (!/^[a-f0-9]{32}$/.test(zoneId)) throw notConfigured();

  const since = isoDay(now() - (DAYS - 1) * DAY_MS);
  const query = `{viewer{zones(filter:{zoneTag:"${zoneId}"}){httpRequests1dGroups(limit:${DAYS + 1},orderBy:[date_ASC],filter:{date_geq:"${since}"}){dimensions{date} sum{requests threats} uniq{uniques}}}}}`;
  const response = await http.post('https://api.cloudflare.com/client/v4/graphql', { query }, {
    headers: { Authorization: `Bearer ${token}` },
    timeout: SOURCE_TIMEOUT_MS
  });
  if (response.data?.errors?.length) {
    const error = new Error('cloudflare_graphql_error');
    error.code = 'cloudflare_graphql_error';
    throw error;
  }
  const groups = response.data?.data?.viewer?.zones?.[0]?.httpRequests1dGroups || [];
  const days = groups.map((group) => ({
    date: group.dimensions?.date,
    requests: toNumber(group.sum?.requests),
    threats: toNumber(group.sum?.threats),
    visitors: toNumber(group.uniq?.uniques)
  }));
  return {
    days,
    requests7d: days.reduce((total, day) => total + day.requests, 0),
    threats7d: days.reduce((total, day) => total + day.threats, 0)
  };
}

function appStorePrivateKey(config) {
  const inline = env(config, 'ASC_PRIVATE_KEY');
  if (inline) return inline.replace(/\\n/g, '\n');
  const base64 = env(config, 'ASC_PRIVATE_KEY_BASE64');
  if (base64) return Buffer.from(base64, 'base64').toString('utf8');
  const file = env(config, 'ASC_KEY_FILE');
  if (file && fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
  return '';
}

function appStoreToken({ issuerId, keyId, privateKey, now }) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const issuedAt = Math.floor(now() / 1000);
  const unsigned = `${encode({ alg: 'ES256', kid: keyId, typ: 'JWT' })}.${encode({
    iss: issuerId,
    iat: issuedAt,
    exp: issuedAt + 600,
    aud: 'appstoreconnect-v1'
  })}`;
  const signature = crypto
    .sign('sha256', Buffer.from(unsigned), { key: privateKey, dsaEncoding: 'ieee-p1363' })
    .toString('base64url');
  return `${unsigned}.${signature}`;
}

function parseAppStoreReport(buffer, appId) {
  const raw = Buffer.from(buffer);
  const text = raw[0] === 0x1f && raw[1] === 0x8b ? zlib.gunzipSync(raw).toString('utf8') : raw.toString('utf8');
  const [header = '', ...rows] = text.trim().split('\n');
  const columns = header.split('\t');
  const column = (name) => columns.indexOf(name);
  const totals = { downloads: 0, redownloads: 0, updates: 0 };
  rows.forEach((row) => {
    const fields = row.split('\t');
    if (fields[column('Apple Identifier')] !== appId) return;
    const type = fields[column('Product Type Identifier')];
    const units = toNumber(fields[column('Units')]);
    Object.entries(APP_STORE_UNIT_TYPES).forEach(([key, types]) => {
      if (types.has(type)) totals[key] += units;
    });
  });
  return totals;
}

async function fetchAppStore({ http, config, now }) {
  const issuerId = env(config, 'ASC_ISSUER_ID');
  const keyId = env(config, 'ASC_KEY_ID');
  const vendorNumber = env(config, 'ASC_VENDOR_NUMBER');
  const appId = env(config, 'ASC_APP_APPLE_ID');
  const privateKey = appStorePrivateKey(config);
  requireValues([issuerId, keyId, vendorNumber, appId, privateKey]);

  const token = appStoreToken({ issuerId, keyId, privateKey, now });
  // A Apple publica o dia anterior com atraso; começa em ontem.
  const dates = Array.from({ length: DAYS }, (_, index) => isoDay(now() - (index + 1) * DAY_MS)).reverse();
  const days = await Promise.all(dates.map(async (date) => {
    try {
      const response = await http.get('https://api.appstoreconnect.apple.com/v1/salesReports', {
        params: {
          'filter[frequency]': 'DAILY',
          'filter[reportType]': 'SALES',
          'filter[reportSubType]': 'SUMMARY',
          'filter[vendorNumber]': vendorNumber,
          'filter[reportDate]': date
        },
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/a-gzip' },
        responseType: 'arraybuffer',
        decompress: false,
        timeout: SOURCE_TIMEOUT_MS
      });
      return { date, ...parseAppStoreReport(response.data, appId) };
    } catch (error) {
      // 404 = dia sem nenhum download na conta ou relatório ainda não publicado.
      if (error?.response?.status === 404) {
        return { date, downloads: 0, redownloads: 0, updates: 0 };
      }
      throw error;
    }
  }));
  return {
    days,
    downloads7d: days.reduce((total, day) => total + day.downloads, 0),
    redownloads7d: days.reduce((total, day) => total + day.redownloads, 0),
    updates7d: days.reduce((total, day) => total + day.updates, 0)
  };
}

const SOURCES = [
  ['sentry', fetchSentry],
  ['posthog', fetchPosthog],
  ['uptime', fetchUptime],
  ['cloudflare', fetchCloudflare],
  ['appStore', fetchAppStore]
];

class ExternalInsightsService {
  constructor({
    redis = redisPool,
    http = axios,
    config = process.env,
    now = () => Date.now()
  } = {}) {
    this.redisPool = redis;
    this.http = http;
    this.config = config;
    this.now = now;
    this.ttlSeconds = clampNumber(
      config.EXTERNAL_INSIGHTS_TTL_SECONDS,
      DEFAULT_TTL_SECONDS,
      MIN_TTL_SECONDS,
      MAX_TTL_SECONDS
    );
  }

  async getRedis() {
    if (this.redisPool?.ensureConnection) {
      await this.redisPool.ensureConnection();
    }
    return this.redisPool?.getConnection ? this.redisPool.getConnection() : null;
  }

  async readCache() {
    try {
      const redis = await this.getRedis();
      const cached = redis?.get ? await redis.get(CACHE_KEY) : null;
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      logStructured('warn', 'Falha ao ler cache dos dados externos', {
        service: 'external-insights',
        error: error.message
      });
      return null;
    }
  }

  async writeCache(snapshot) {
    try {
      const redis = await this.getRedis();
      if (redis?.set) {
        await redis.set(CACHE_KEY, JSON.stringify(snapshot), 'EX', this.ttlSeconds);
      }
    } catch (error) {
      logStructured('warn', 'Falha ao gravar cache dos dados externos', {
        service: 'external-insights',
        error: error.message
      });
    }
  }

  async collect() {
    const context = { http: this.http, config: this.config, now: this.now };
    const entries = await Promise.all(SOURCES.map(async ([id, fetchSource]) => {
      try {
        return [id, { status: 'ok', data: await fetchSource(context) }];
      } catch (error) {
        if (error?.notConfigured) {
          return [id, { status: 'not_configured' }];
        }
        const reason = describeError(error);
        logStructured('warn', 'Fonte de dados externa indisponível', {
          service: 'external-insights',
          source: id,
          reason
        });
        return [id, { status: 'error', error: reason }];
      }
    }));
    return {
      generatedAt: new Date(this.now()).toISOString(),
      ttlSeconds: this.ttlSeconds,
      sources: Object.fromEntries(entries)
    };
  }

  async getSnapshot({ forceRefresh = false } = {}) {
    if (!forceRefresh) {
      const cached = await this.readCache();
      if (cached) return { ...cached, cache: 'HIT' };
    }
    const snapshot = await this.collect();
    await this.writeCache(snapshot);
    return { ...snapshot, cache: 'MISS' };
  }
}

module.exports = new ExternalInsightsService();
module.exports.ExternalInsightsService = ExternalInsightsService;
module.exports.parseAppStoreReport = parseAppStoreReport;
