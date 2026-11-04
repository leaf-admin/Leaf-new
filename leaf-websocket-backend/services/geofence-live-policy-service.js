'use strict';

/**
 * Área de atendimento editada ao vivo pelo painel.
 *
 * Só funciona com GEOFENCE_ADMIN_EDIT_ENABLED=true. Cada salvamento vira uma
 * versão em `geofence_versions` (com autor e data) e passa a ser a versão viva
 * em `operational_configs/geofence_admin` (campo `liveVersion`). O gateway que
 * salvou aplica na hora e avisa os outros pelo Redis; todos também conferem a
 * versão viva de tempos em tempos, para o caso de perder o aviso. Sem versão
 * viva gravada, vale o arquivo versionado (config/geofence.json).
 */

const crypto = require('crypto');
const { logStructured } = require('../utils/logger');

const VERSIONS_COLLECTION = 'geofence_versions';
const CHANNEL = 'leaf:geofence:live-updated';
const POLL_INTERVAL_MS = 120000;
const MAX_RINGS = 200;
const MAX_TOTAL_POINTS = 20000;
const POLICY_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,63}$/;
// Limites do Brasil com folga: barra polígono com lat/lng trocados ou de outro país.
const BOUNDS = { minLat: -34, maxLat: 6, minLng: -74, maxLng: -28 };

function isLiveEditEnabled(env = process.env) {
  return String(env.GEOFENCE_ADMIN_EDIT_ENABLED || '').trim().toLowerCase() === 'true';
}

function invalid(message) {
  return { ok: false, error: message };
}

function samePoint(a, b) {
  return a[0] === b[0] && a[1] === b[1];
}

function orientation(a, b, c) {
  const value = (b[1] - a[1]) * (c[0] - b[0]) - (b[0] - a[0]) * (c[1] - b[1]);
  if (Math.abs(value) < 1e-15) return 0;
  return value > 0 ? 1 : 2;
}

function onSegment(a, b, c) {
  return b[0] <= Math.max(a[0], c[0]) && b[0] >= Math.min(a[0], c[0])
    && b[1] <= Math.max(a[1], c[1]) && b[1] >= Math.min(a[1], c[1]);
}

function segmentsIntersect(p1, q1, p2, q2) {
  const o1 = orientation(p1, q1, p2);
  const o2 = orientation(p1, q1, q2);
  const o3 = orientation(p2, q2, p1);
  const o4 = orientation(p2, q2, q1);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(p1, p2, q1)) return true;
  if (o2 === 0 && onSegment(p1, q2, q1)) return true;
  if (o3 === 0 && onSegment(p2, p1, q2)) return true;
  if (o4 === 0 && onSegment(p2, q1, q2)) return true;
  return false;
}

// Anel fechado sem cruzar a si mesmo (segmentos vizinhos podem se tocar).
function ringSelfIntersects(ring) {
  const segments = ring.length - 1;
  for (let i = 0; i < segments; i += 1) {
    for (let j = i + 2; j < segments; j += 1) {
      if (i === 0 && j === segments - 1) continue;
      if (segmentsIntersect(ring[i], ring[i + 1], ring[j], ring[j + 1])) return true;
    }
  }
  return false;
}

function normalizeRing(points) {
  if (!Array.isArray(points)) return null;
  const ring = [];
  for (const raw of points) {
    if (!Array.isArray(raw) || raw.length < 2) return null;
    const point = [Number(raw[0]), Number(raw[1])];
    if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) return null;
    if (ring.length && samePoint(ring[ring.length - 1], point)) continue;
    ring.push(point);
  }
  if (ring.length > 1 && samePoint(ring[0], ring[ring.length - 1])) ring.pop();
  if (ring.length < 3) return null;
  return [...ring, [ring[0][0], ring[0][1]]];
}

// Aceita um anel [[lng, lat], ...] ou uma lista de anéis.
function validateLiveRegion(region) {
  if (!Array.isArray(region) || region.length === 0) return invalid('Envie ao menos uma área.');
  const candidates = Array.isArray(region[0]) && !Array.isArray(region[0][0]) ? [region] : region;
  if (candidates.length > MAX_RINGS) return invalid(`No máximo ${MAX_RINGS} áreas.`);

  const rings = [];
  let totalPoints = 0;
  for (let index = 0; index < candidates.length; index += 1) {
    const ring = normalizeRing(candidates[index]);
    if (!ring) return invalid(`Área ${index + 1}: precisa de ao menos 3 pontos [lng, lat] válidos.`);
    const outside = ring.find(([lng, lat]) => lat < BOUNDS.minLat || lat > BOUNDS.maxLat
      || lng < BOUNDS.minLng || lng > BOUNDS.maxLng);
    if (outside) return invalid(`Área ${index + 1}: ponto fora do Brasil (${outside[1]}, ${outside[0]}). Confira a ordem [lng, lat].`);
    totalPoints += ring.length - 1;
    if (totalPoints > MAX_TOTAL_POINTS) return invalid(`No máximo ${MAX_TOTAL_POINTS} pontos no total.`);
    if (ringSelfIntersects(ring)) return invalid(`Área ${index + 1}: as bordas se cruzam. Ajuste os vértices.`);
    rings.push(ring);
  }
  return { ok: true, rings, polygonCount: rings.length, pointCount: totalPoints };
}

function versionSummary(id, data = {}) {
  return {
    id,
    policyId: data.policyId || null,
    name: data.name || null,
    polygonCount: Number(data.polygonCount || 0),
    pointCount: Number(data.pointCount || 0),
    createdAt: data.createdAt || null,
    createdBy: data.createdBy || null,
    restoredFrom: data.restoredFrom || null
  };
}

class GeofenceLivePolicyService {
  constructor({
    geofenceService = require('./geofence-service'),
    opsConfigStore = require('./ops-config-store'),
    getFirebaseConfig = () => require('../firebase-config'),
    createSubscriber = null,
    getPublisher = null,
    env = process.env,
    now = () => new Date()
  } = {}) {
    this.geofenceService = geofenceService;
    this.opsConfigStore = opsConfigStore;
    this.getFirebaseConfig = getFirebaseConfig;
    this.createSubscriber = createSubscriber;
    this.getPublisher = getPublisher;
    this.env = env;
    this.now = now;
    this.appliedVersionId = null;
    this.subscriber = null;
    this.pollTimer = null;
  }

  isEnabled() {
    return isLiveEditEnabled(this.env);
  }

  firestore() {
    const firestore = this.getFirebaseConfig()?.getFirestore?.();
    if (!firestore) throw new Error('Firestore indisponível para a geofence');
    return firestore;
  }

  // Aplica a versão viva gravada no config admin; false se não houver ou for inválida.
  applyLiveConfig(config) {
    const live = config?.liveVersion;
    if (!this.isEnabled() || !live?.id) return false;
    const check = validateLiveRegion(config.region);
    if (!check.ok) {
      logStructured('warn', 'Versão viva da geofence inválida; mantendo a área atual', {
        service: 'geofence-live-policy', versionId: live.id, reason: check.error
      });
      return false;
    }
    const applied = this.geofenceService.updateRegion(check.rings, {
      source: 'admin-live',
      version: live.policyId || live.id,
      name: live.name,
      updatedAt: live.createdAt
    });
    if (applied) this.appliedVersionId = live.id;
    return applied;
  }

  async loadAndApply() {
    const { raw } = await this.opsConfigStore.load(this.getFirebaseConfig(), 'geofenceAdmin');
    if (!raw?.liveVersion?.id || raw.liveVersion.id === this.appliedVersionId) return false;
    const applied = this.applyLiveConfig(raw);
    logStructured('info', 'Geofence recarregada da versão viva', {
      service: 'geofence-live-policy', versionId: raw.liveVersion.id, applied
    });
    return applied;
  }

  async saveVersion({ region, policyId, name, actor, restoredFrom = null, baseConfig = {} }) {
    if (!this.isEnabled()) throw Object.assign(new Error('Edição da geofence pelo painel está desligada.'), { statusCode: 409 });
    const id = String(policyId || '').trim();
    if (!POLICY_ID_PATTERN.test(id)) {
      throw Object.assign(new Error('Versão inválida: use letras minúsculas, números e hífen (ex.: rio-zona-sul-v4).'), { statusCode: 400 });
    }
    const check = validateLiveRegion(region);
    if (!check.ok) throw Object.assign(new Error(check.error), { statusCode: 400 });

    const createdAt = this.now().toISOString();
    const versionId = `${createdAt.replace(/[-:.TZ]/g, '').slice(0, 14)}-${crypto.randomBytes(3).toString('hex')}`;
    const label = String(name || '').trim().slice(0, 120) || id;
    const record = {
      policyId: id,
      name: label,
      polygonCount: check.polygonCount,
      pointCount: check.pointCount,
      createdAt,
      createdBy: actor || 'system',
      restoredFrom,
      json: JSON.stringify(check.rings)
    };
    await this.firestore().collection(VERSIONS_COLLECTION).doc(versionId).set(record);

    const liveVersion = { id: versionId, policyId: id, name: label, createdAt, createdBy: record.createdBy };
    const config = {
      ...baseConfig,
      version: Number(baseConfig.version || 1) + 1,
      enabled: true,
      region: check.rings,
      liveVersion,
      updatedAt: createdAt,
      updatedBy: record.createdBy
    };
    await this.opsConfigStore.persist(this.getFirebaseConfig(), 'geofenceAdmin', config);
    this.applyLiveConfig(config);
    await this.publish(versionId);
    logStructured('info', 'Nova versão da geofence publicada pelo painel', {
      service: 'geofence-live-policy', action: 'geofence.live_version.saved',
      versionId, policyId: id, polygons: check.polygonCount, points: check.pointCount,
      operator: record.createdBy, restoredFrom
    });
    return { config, version: versionSummary(versionId, record) };
  }

  async listVersions(limit = 20) {
    const snapshot = await this.firestore().collection(VERSIONS_COLLECTION)
      .orderBy('createdAt', 'desc').limit(Math.min(Math.max(Number(limit) || 20, 1), 50)).get();
    return snapshot.docs.map((doc) => versionSummary(doc.id, doc.data()));
  }

  async restoreVersion(versionId, { actor, baseConfig } = {}) {
    const doc = await this.firestore().collection(VERSIONS_COLLECTION).doc(String(versionId || '')).get();
    if (!doc.exists) throw Object.assign(new Error('Versão não encontrada.'), { statusCode: 404 });
    const data = doc.data();
    return this.saveVersion({
      region: JSON.parse(data.json),
      policyId: data.policyId,
      name: data.name,
      actor,
      restoredFrom: doc.id,
      baseConfig
    });
  }

  async publish(versionId) {
    try {
      const publisher = this.getPublisher ? await this.getPublisher() : null;
      if (publisher?.publish) await publisher.publish(CHANNEL, JSON.stringify({ versionId }));
    } catch (error) {
      // Sem o aviso os outros gateways pegam a versão na próxima conferência.
      logStructured('warn', 'Falha ao avisar os gateways da nova geofence', {
        service: 'geofence-live-policy', versionId, error: error.message
      });
    }
  }

  start() {
    if (!this.isEnabled() || this.pollTimer) return;
    const reload = () => this.loadAndApply().catch((error) => logStructured('warn', 'Falha ao recarregar a geofence', {
      service: 'geofence-live-policy', error: error.message
    }));
    Promise.resolve()
      .then(() => (this.createSubscriber ? this.createSubscriber() : null))
      .then((subscriber) => {
        if (!subscriber) return;
        this.subscriber = subscriber;
        subscriber.on('message', (channel) => { if (channel === CHANNEL) reload(); });
        subscriber.on('error', (error) => logStructured('warn', 'Assinatura da geofence no Redis falhou', {
          service: 'geofence-live-policy', error: error.message
        }));
        return subscriber.subscribe(CHANNEL);
      })
      .catch((error) => logStructured('warn', 'Sem assinatura Redis da geofence; seguindo só com a conferência periódica', {
        service: 'geofence-live-policy', error: error.message
      }));
    this.pollTimer = setInterval(reload, POLL_INTERVAL_MS);
    this.pollTimer.unref?.();
  }
}

// Redis só é carregado quando a edição ao vivo está ligada e o serviço inicia.
function createDefaultService() {
  const redisPool = () => require('../utils/redis-pool');
  return new GeofenceLivePolicyService({
    getPublisher: async () => {
      await redisPool().ensureConnection?.();
      return redisPool().getConnection();
    },
    createSubscriber: async () => {
      await redisPool().ensureConnection?.();
      return redisPool().getConnection().duplicate();
    }
  });
}

module.exports = createDefaultService();
module.exports.GeofenceLivePolicyService = GeofenceLivePolicyService;
module.exports.validateLiveRegion = validateLiveRegion;
module.exports.isLiveEditEnabled = isLiveEditEnabled;
module.exports.CHANNEL = CHANNEL;
