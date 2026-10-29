import authService from './AuthService';

const cache = new Map();
const pending = new Map();
const revisions = new Map();
const CACHE_TTL_MS = 30000;

export const DEFAULT_MOBILE_PREFERENCES = Object.freeze({
  notificationsEnabled: true,
  trafficLayerEnabled: true,
  voiceGuidanceEnabled: false,
  // Passenger comfort the driver sees after accepting; 'any' means no preference.
  rideTemperature: 'any',
  rideSound: 'any',
  rideComfortAsked: false,
  schemaVersion: 1,
});

export const RIDE_TEMPERATURE_CHOICES = Object.freeze(['cool', 'mild', 'any']);
export const RIDE_SOUND_CHOICES = Object.freeze(['quiet', 'music', 'any']);
const BOOLEAN_FIELDS = ['notificationsEnabled', 'trafficLayerEnabled', 'voiceGuidanceEnabled', 'rideComfortAsked'];
const CHOICE_FIELDS = { rideTemperature: RIDE_TEMPERATURE_CHOICES, rideSound: RIDE_SOUND_CHOICES };

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

function pickSupported(value = {}) {
  const picked = {};
  BOOLEAN_FIELDS.forEach((key) => {
    if (typeof value?.[key] === 'boolean') picked[key] = value[key];
  });
  Object.entries(CHOICE_FIELDS).forEach(([key, choices]) => {
    if (choices.includes(value?.[key])) picked[key] = value[key];
  });
  return picked;
}

function normalizePreferences(value = {}) {
  return {
    ...DEFAULT_MOBILE_PREFERENCES,
    ...pickSupported(value),
    updatedAt: value.updatedAt || null,
  };
}

// What goes into the booking's preferences: the server rewrites labels and drops 'any'.
export function buildRideComfortFromPreferences(preferences) {
  if (!preferences) return null;
  const temperature = RIDE_TEMPERATURE_CHOICES.includes(preferences.rideTemperature) ? preferences.rideTemperature : 'any';
  const sound = RIDE_SOUND_CHOICES.includes(preferences.rideSound) ? preferences.rideSound : 'any';
  if (temperature === 'any' && sound === 'any') return null;
  return { temperature, sound };
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

// Last answer for this account regardless of age: comfort changes rarely and the
// booking must not wait on the network for it.
export function getLastKnownMobilePreferences(uid) {
  return cache.get(uid)?.preferences || null;
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
    const supported = pickSupported(patch);
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
