import authService from './AuthService';

const cache = new Map();
const pending = new Map();
const revisions = new Map();
const CACHE_TTL_MS = 30000;

export const DEFAULT_MOBILE_PREFERENCES = Object.freeze({
  notificationsEnabled: true,
  trafficLayerEnabled: true,
  voiceGuidanceEnabled: false,
  schemaVersion: 1,
});

async function request(endpoint, options = {}) {
  const response = await authService.authenticatedRequest(endpoint, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.message || payload?.error || 'Não foi possível salvar suas preferências.');
    error.status = response.status;
    error.code = payload?.code || null;
    throw error;
  }
  return payload;
}

function normalizePreferences(value = {}) {
  return {
    ...DEFAULT_MOBILE_PREFERENCES,
    ...(typeof value.notificationsEnabled === 'boolean' ? { notificationsEnabled: value.notificationsEnabled } : {}),
    ...(typeof value.trafficLayerEnabled === 'boolean' ? { trafficLayerEnabled: value.trafficLayerEnabled } : {}),
    ...(typeof value.voiceGuidanceEnabled === 'boolean' ? { voiceGuidanceEnabled: value.voiceGuidanceEnabled } : {}),
    updatedAt: value.updatedAt || null,
  };
}

async function requireOwner(uid) {
  const actor = await authService.getCurrentUser();
  if (!actor?.uid || (uid && actor.uid !== uid)) {
    throw new Error('A sessão mudou. Abra novamente suas configurações.');
  }
  return actor.uid;
}

export function getCachedMobilePreferences(uid) {
  const entry = cache.get(uid);
  return entry && Date.now() - entry.fetchedAt < CACHE_TTL_MS ? entry.preferences : null;
}

function remember(uid, preferences) {
  cache.set(uid, { preferences, fetchedAt: Date.now() });
  if (cache.size > 10) cache.delete(cache.keys().next().value);
}

function readPreferences(payload) {
  if (!payload?.preferences || typeof payload.preferences !== 'object') {
    throw new Error('Não foi possível consultar suas preferências. Tente novamente.');
  }
  return normalizePreferences(payload.preferences);
}

class MobilePreferencesService {
  async getPreferences({ uid, forceRefresh = false } = {}) {
    const owner = await requireOwner(uid);
    const cached = getCachedMobilePreferences(owner);
    if (cached && !forceRefresh) return cached;
    if (pending.has(owner)) return pending.get(owner);
    const revision = revisions.get(owner) || 0;
    const task = (async () => {
      const payload = await request('/account/preferences', { method: 'GET' });
      await requireOwner(owner);
      const preferences = readPreferences(payload);
      if ((revisions.get(owner) || 0) !== revision) return getCachedMobilePreferences(owner) || preferences;
      remember(owner, preferences);
      return preferences;
    })();
    pending.set(owner, task);
    try { return await task; }
    finally { if (pending.get(owner) === task) pending.delete(owner); }
  }

  async updatePreferences(patch, { uid } = {}) {
    const owner = await requireOwner(uid);
    const supported = Object.fromEntries(['notificationsEnabled', 'trafficLayerEnabled', 'voiceGuidanceEnabled']
      .filter(key => typeof patch?.[key] === 'boolean').map(key => [key, patch[key]]));
    if (!Object.keys(supported).length) throw new Error('Nenhuma preferência válida foi informada.');
    const payload = await request('/account/preferences', {
      method: 'PATCH',
      body: JSON.stringify({ preferences: supported }),
    });
    await requireOwner(owner);
    const preferences = readPreferences(payload);
    revisions.set(owner, (revisions.get(owner) || 0) + 1);
    remember(owner, preferences);
    return preferences;
  }
}

export { normalizePreferences };
export default new MobilePreferencesService();
