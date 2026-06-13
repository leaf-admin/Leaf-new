const firebaseConfig = require('../firebase-config');
const { logStructured } = require('../utils/logger');

const COLLECTION = 'systemConfig';
const DOCUMENT_ID = 'h3VisualPolicy';
const DEFAULT_CACHE_TTL_MS = 30 * 1000;

const DEFAULT_POLICY = Object.freeze({
  enabled: true,
  opacity: 1,
  resolutionOffset: -1,
  palette: {
    yellow: '#FACC15',
    red: '#EF4444',
    purple: '#7E22CE',
    yellowStroke: '#CA8A04',
    redStroke: '#B91C1C',
    purpleStroke: '#581C87'
  },
  label: {
    enabled: true,
    minPercent: 3,
    maxVisible: 5,
    template: '+{percent}%',
    backgroundColor: '#171412',
    backgroundOpacity: 0.9,
    textColor: '#FFFFFF',
    borderColor: '#FFFFFF',
    borderOpacity: 0.82,
    fontSize: 12
  },
  version: 1
});

function clamp(value, min, max) {
  return Math.min(Math.max(Number(value), min), max);
}

function normalizeHex(value, fallback) {
  const normalized = String(value || '').trim().toUpperCase();
  return /^#[0-9A-F]{6}$/.test(normalized) ? normalized : fallback;
}

function normalizeTemplate(value) {
  const normalized = String(value || DEFAULT_POLICY.label.template).trim().slice(0, 24);
  return normalized.includes('{percent}') ? normalized : DEFAULT_POLICY.label.template;
}

function normalizePolicy(raw = {}, currentVersion = DEFAULT_POLICY.version) {
  const palette = raw.palette || {};
  const label = raw.label || {};

  return {
    enabled: raw.enabled !== false,
    opacity: Number(clamp(raw.opacity ?? DEFAULT_POLICY.opacity, 0.15, 1).toFixed(2)),
    resolutionOffset: Math.round(clamp(raw.resolutionOffset ?? DEFAULT_POLICY.resolutionOffset, -1, 1)),
    palette: {
      yellow: normalizeHex(palette.yellow, DEFAULT_POLICY.palette.yellow),
      red: normalizeHex(palette.red, DEFAULT_POLICY.palette.red),
      purple: normalizeHex(palette.purple, DEFAULT_POLICY.palette.purple),
      yellowStroke: normalizeHex(palette.yellowStroke, DEFAULT_POLICY.palette.yellowStroke),
      redStroke: normalizeHex(palette.redStroke, DEFAULT_POLICY.palette.redStroke),
      purpleStroke: normalizeHex(palette.purpleStroke, DEFAULT_POLICY.palette.purpleStroke)
    },
    label: {
      enabled: label.enabled !== false,
      minPercent: Math.round(clamp(label.minPercent ?? DEFAULT_POLICY.label.minPercent, 1, 35)),
      maxVisible: Math.round(clamp(label.maxVisible ?? DEFAULT_POLICY.label.maxVisible, 0, 8)),
      template: normalizeTemplate(label.template),
      backgroundColor: normalizeHex(label.backgroundColor, DEFAULT_POLICY.label.backgroundColor),
      backgroundOpacity: Number(clamp(
        label.backgroundOpacity ?? DEFAULT_POLICY.label.backgroundOpacity,
        0.35,
        1
      ).toFixed(2)),
      textColor: normalizeHex(label.textColor, DEFAULT_POLICY.label.textColor),
      borderColor: normalizeHex(label.borderColor, DEFAULT_POLICY.label.borderColor),
      borderOpacity: Number(clamp(
        label.borderOpacity ?? DEFAULT_POLICY.label.borderOpacity,
        0,
        1
      ).toFixed(2)),
      fontSize: Math.round(clamp(label.fontSize ?? DEFAULT_POLICY.label.fontSize, 10, 16))
    },
    version: Math.max(1, Number.parseInt(raw.version || currentVersion, 10) || 1)
  };
}

class H3VisualPolicyService {
  constructor(options = {}) {
    this.cacheTtlMs = Number.parseInt(
      options.cacheTtlMs || process.env.H3_VISUAL_POLICY_CACHE_TTL_MS || DEFAULT_CACHE_TTL_MS,
      10
    );
    this.cache = {
      loadedAt: 0,
      policy: normalizePolicy(DEFAULT_POLICY)
    };
  }

  getDefaultPolicy() {
    return normalizePolicy(DEFAULT_POLICY);
  }

  async getPolicy({ forceRefresh = false } = {}) {
    const now = Date.now();
    if (!forceRefresh && this.cache.loadedAt && now - this.cache.loadedAt < this.cacheTtlMs) {
      return this.cache.policy;
    }

    const firestore = firebaseConfig.getFirestore();
    if (!firestore) {
      this.cache = { loadedAt: now, policy: this.getDefaultPolicy() };
      return this.cache.policy;
    }

    try {
      const snapshot = await firestore.collection(COLLECTION).doc(DOCUMENT_ID).get();
      const policy = snapshot.exists
        ? normalizePolicy(snapshot.data())
        : this.getDefaultPolicy();
      this.cache = { loadedAt: now, policy };
      return policy;
    } catch (error) {
      logStructured('warn', 'Falha ao carregar política visual H3; usando cache/default', {
        service: 'h3-visual-policy-service',
        error: error.message
      });
      return this.cache.policy || this.getDefaultPolicy();
    }
  }

  async updatePolicy(input = {}, actor = {}) {
    const current = await this.getPolicy({ forceRefresh: true });
    const next = normalizePolicy({
      ...current,
      ...input,
      palette: {
        ...current.palette,
        ...(input.palette || {})
      },
      label: {
        ...current.label,
        ...(input.label || {})
      },
      version: current.version + 1
    }, current.version + 1);

    const firestore = firebaseConfig.getFirestore();
    if (!firestore) {
      throw new Error('Firestore indisponível para salvar política visual H3');
    }

    const updatedAt = new Date();
    await firestore.collection(COLLECTION).doc(DOCUMENT_ID).set({
      ...next,
      updatedAt,
      updatedBy: actor.id || actor.userId || 'dashboard',
      updatedByEmail: actor.email || null,
      updatedByRole: actor.role || null
    }, { merge: true });

    this.cache = {
      loadedAt: Date.now(),
      policy: next
    };

    return next;
  }
}

module.exports = new H3VisualPolicyService();
module.exports.H3VisualPolicyService = H3VisualPolicyService;
module.exports.helpers = {
  normalizePolicy,
  normalizeHex,
  normalizeTemplate
};
