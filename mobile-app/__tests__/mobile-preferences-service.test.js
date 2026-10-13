import service, { DEFAULT_MOBILE_PREFERENCES, getCachedMobilePreferences } from '../src/services/MobilePreferencesService';
import authService from '../src/services/AuthService';
jest.mock('../src/services/AuthService', () => ({ __esModule: true, default: { getCurrentUser: jest.fn(), authenticatedRequest: jest.fn() } }));

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const response = preferences => ({ ok: true, json: async () => ({ preferences }) });
let sequence = 0;
describe('authenticated mobile preferences', () => {
  let uid;
  beforeEach(() => {
    jest.clearAllMocks(); uid = `preferences_${++sequence}`;
    authService.getCurrentUser.mockResolvedValue({ uid });
    authService.authenticatedRequest.mockResolvedValue(response(DEFAULT_MOBILE_PREFERENCES));
  });
  it('uses the existing Leaf API and caches only for the authenticated actor', async () => {
    await service.getPreferences({ uid }); await service.getPreferences({ uid });
    expect(authService.authenticatedRequest).toHaveBeenCalledTimes(1);
    expect(authService.authenticatedRequest).toHaveBeenCalledWith('/account/preferences', { method: 'GET' });
    expect(getCachedMobilePreferences('another_user')).toBeNull();
  });
  it('deduplicates simultaneous reads', async () => {
    const task = deferred(); authService.authenticatedRequest.mockReturnValue(task.promise);
    const first = service.getPreferences({ uid }); const second = service.getPreferences({ uid });
    await Promise.resolve(); await Promise.resolve(); task.resolve(response(DEFAULT_MOBILE_PREFERENCES));
    await Promise.all([first, second]); expect(authService.authenticatedRequest).toHaveBeenCalledTimes(1);
  });
  it('rejects an actor switch before exposing or caching the response', async () => {
    const task = deferred(); authService.authenticatedRequest.mockReturnValue(task.promise);
    const read = service.getPreferences({ uid }); await Promise.resolve(); await Promise.resolve();
    authService.getCurrentUser.mockResolvedValue({ uid: 'different_user' });
    task.resolve(response({ trafficLayerEnabled: false }));
    await expect(read).rejects.toThrow('sessão mudou'); expect(getCachedMobilePreferences(uid)).toBeNull();
  });
  it('persists only supported booleans without an actor id in the body', async () => {
    await service.updatePreferences({ trafficLayerEnabled: false, takeRate: 25, uid: 'different_user' }, { uid });
    expect(authService.authenticatedRequest).toHaveBeenCalledWith('/account/preferences', {
      method: 'PATCH', body: JSON.stringify({ preferences: { trafficLayerEnabled: false } }),
    });
  });
  it('retains confirmed values when the PATCH fails', async () => {
    await service.getPreferences({ uid });
    authService.authenticatedRequest.mockResolvedValue({ ok: false, status: 503, json: async () => ({ message: 'Offline' }) });
    await expect(service.updatePreferences({ trafficLayerEnabled: false }, { uid })).rejects.toThrow('Offline');
    expect(getCachedMobilePreferences(uid).trafficLayerEnabled).toBe(true);
  });
  it('does not overwrite a confirmed mutation with an older GET', async () => {
    const task = deferred(); authService.authenticatedRequest.mockImplementation((path, options) => options.method === 'GET' ? task.promise : Promise.resolve(response({ trafficLayerEnabled: false })));
    const old = service.getPreferences({ uid }); await Promise.resolve(); await Promise.resolve();
    await service.updatePreferences({ trafficLayerEnabled: false }, { uid }); task.resolve(response({ trafficLayerEnabled: true }));
    expect((await old).trafficLayerEnabled).toBe(false); expect(getCachedMobilePreferences(uid).trafficLayerEnabled).toBe(false);
  });
  it('rejects malformed success responses and unsupported updates', async () => {
    authService.authenticatedRequest.mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    await expect(service.getPreferences({ uid })).rejects.toThrow('consultar');
    await expect(service.updatePreferences({ trafficLayerEnabled: 'false' }, { uid })).rejects.toThrow('Nenhuma preferência');
  });
});
