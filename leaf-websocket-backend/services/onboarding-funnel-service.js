'use strict';

/**
 * Funil do cadastro no app, lido do PostHog com as chaves do servidor.
 *
 * O app manda `onboarding_step_viewed` (uma vez por etapa vista) e
 * `signup_completed`. A consulta agrupa por pessoa e devolve só contagens:
 * quantas pessoas viram cada etapa, separadas pelo perfil escolhido. Quem parou
 * antes de escolher o perfil fica em "unknown". Nenhum id de pessoa sai daqui.
 * O resultado fica em cache no Redis para não gastar a cota da API.
 */

const axios = require('axios');
const redisPool = require('../utils/redis-pool');
const { logStructured } = require('../utils/logger');

const CACHE_KEY_PREFIX = 'observability:onboarding-funnel:v1';
const ALLOWED_DAYS = [7, 14, 30];
const DEFAULT_DAYS = 14;
const CACHE_TTL_SECONDS = 600;
const SOURCE_TIMEOUT_MS = 8000;
const MAX_PEOPLE = 10000;
const ROLES = ['customer', 'driver', 'unknown'];

// Mesma ordem das etapas do AuthFlow; o código do telefone é etapa própria.
const STEPS = [
  'phone_validation',
  'phone_code',
  'profile_selection',
  'profile_data',
  'document_data',
  'credentials',
  'driver_contact',
  'driver_intro'
];

function env(source, key) {
  return String(source[key] || '').trim();
}

function posthogApiHost(config) {
  const explicit = env(config, 'POSTHOG_API_HOST');
  if (explicit) return explicit.replace(/\/$/, '');
  // O host de ingestão (eu.i.posthog.com) não serve a API privada.
  return (env(config, 'POSTHOG_HOST') || 'https://eu.i.posthog.com')
    .replace('.i.posthog.com', '.posthog.com')
    .replace(/\/$/, '');
}

function normalizeRole(value) {
  const role = String(value || '').trim().toLowerCase();
  return role === 'customer' || role === 'driver' ? role : 'unknown';
}

function buildQuery(days) {
  return [
    'select',
    'person_id,',
    "groupUniqArrayIf(toString(properties.step), event = 'onboarding_step_viewed'),",
    "argMaxIf(toString(properties.role), timestamp, toString(properties.role) in ('customer', 'driver')),",
    "countIf(event = 'signup_completed') > 0",
    'from events',
    "where event in ('onboarding_step_viewed', 'signup_completed')",
    `and timestamp > now() - interval ${days} day`,
    'group by person_id',
    `limit ${MAX_PEOPLE + 1}`
  ].join(' ');
}

function emptyRoleSummary() {
  return {
    people: 0,
    completed: 0,
    steps: STEPS.map((step) => ({ step, people: 0 }))
  };
}

function summarizePeople(rows = []) {
  const truncated = rows.length > MAX_PEOPLE;
  const byRole = Object.fromEntries(ROLES.map((role) => [role, emptyRoleSummary()]));
  const all = emptyRoleSummary();

  rows.slice(0, MAX_PEOPLE).forEach((row) => {
    const [, rawSteps, rawRole, rawCompleted] = Array.isArray(row) ? row : [];
    const seen = new Set(Array.isArray(rawSteps) ? rawSteps.map(String) : []);
    const completed = rawCompleted === true || rawCompleted === 1 || rawCompleted === '1';
    const targets = [all, byRole[normalizeRole(rawRole)]];
    targets.forEach((summary) => {
      summary.people += 1;
      if (completed) summary.completed += 1;
      summary.steps.forEach((entry) => {
        if (seen.has(entry.step)) entry.people += 1;
      });
    });
  });

  return { all, roles: byRole, truncated };
}

class OnboardingFunnelService {
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
  }

  async getRedis() {
    if (this.redisPool?.ensureConnection) {
      await this.redisPool.ensureConnection();
    }
    return this.redisPool?.getConnection ? this.redisPool.getConnection() : null;
  }

  async readCache(key) {
    try {
      const redis = await this.getRedis();
      const cached = redis?.get ? await redis.get(key) : null;
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      logStructured('warn', 'Falha ao ler cache do funil de cadastro', {
        service: 'onboarding-funnel',
        error: error.message
      });
      return null;
    }
  }

  async writeCache(key, snapshot) {
    try {
      const redis = await this.getRedis();
      if (redis?.set) {
        await redis.set(key, JSON.stringify(snapshot), 'EX', CACHE_TTL_SECONDS);
      }
    } catch (error) {
      logStructured('warn', 'Falha ao gravar cache do funil de cadastro', {
        service: 'onboarding-funnel',
        error: error.message
      });
    }
  }

  async collect(days) {
    const base = {
      days,
      generatedAt: new Date(this.now()).toISOString(),
      ttlSeconds: CACHE_TTL_SECONDS,
      steps: STEPS
    };
    const token = env(this.config, 'POSTHOG_PERSONAL_API_KEY');
    const projectId = env(this.config, 'POSTHOG_PROJECT_ID');
    if (!token || !projectId) {
      return { ...base, status: 'not_configured' };
    }

    try {
      const response = await this.http.post(
        `${posthogApiHost(this.config)}/api/projects/${encodeURIComponent(projectId)}/query/`,
        { query: { kind: 'HogQLQuery', query: buildQuery(days) } },
        { headers: { Authorization: `Bearer ${token}` }, timeout: SOURCE_TIMEOUT_MS }
      );
      return { ...base, status: 'ok', ...summarizePeople(response.data?.results || []) };
    } catch (error) {
      const status = error?.response?.status;
      const reason = status ? `HTTP ${status}` : (error?.code || 'unavailable');
      logStructured('warn', 'PostHog indisponível para o funil de cadastro', {
        service: 'onboarding-funnel',
        reason
      });
      return { ...base, status: 'error', error: reason };
    }
  }

  async getSnapshot({ days = DEFAULT_DAYS, forceRefresh = false } = {}) {
    const window = ALLOWED_DAYS.includes(Number(days)) ? Number(days) : DEFAULT_DAYS;
    const key = `${CACHE_KEY_PREFIX}:${window}`;
    if (!forceRefresh) {
      const cached = await this.readCache(key);
      if (cached) return { ...cached, cache: 'HIT' };
    }
    const snapshot = await this.collect(window);
    // Erro não entra no cache: a próxima abertura tenta de novo.
    if (snapshot.status === 'ok') await this.writeCache(key, snapshot);
    return { ...snapshot, cache: 'MISS' };
  }
}

module.exports = new OnboardingFunnelService();
module.exports.OnboardingFunnelService = OnboardingFunnelService;
module.exports.summarizePeople = summarizePeople;
module.exports.buildQuery = buildQuery;
module.exports.ALLOWED_DAYS = ALLOWED_DAYS;
module.exports.STEPS = STEPS;
