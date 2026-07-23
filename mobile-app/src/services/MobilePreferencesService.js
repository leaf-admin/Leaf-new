import authService from './AuthService';

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

class MobilePreferencesService {
  async getPreferences() {
    const payload = await request('/account/preferences', { method: 'GET' });
    return normalizePreferences(payload?.preferences);
  }

  async updatePreferences(patch) {
    const payload = await request('/account/preferences', {
      method: 'PATCH',
      body: JSON.stringify({ preferences: patch }),
    });
    return normalizePreferences(payload?.preferences);
  }
}

export { normalizePreferences };
export default new MobilePreferencesService();
