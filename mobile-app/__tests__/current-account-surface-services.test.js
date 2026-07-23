const mockAuthenticatedRequest = jest.fn();

jest.mock('../src/services/AuthService', () => ({
  __esModule: true,
  default: {
    authenticatedRequest: (...args) => mockAuthenticatedRequest(...args),
  },
}));

function jsonResponse(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: jest.fn().mockResolvedValue(payload),
    text: jest.fn().mockResolvedValue(JSON.stringify(payload)),
  };
}

describe('current account surface services', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses only authenticated Leaf account APIs for vehicle CRUD', async () => {
    const service = require('../src/services/MobileVehicleService').default;
    mockAuthenticatedRequest
      .mockResolvedValueOnce(jsonResponse({ vehicles: [{ id: 'vehicle_1' }] }))
      .mockResolvedValueOnce(jsonResponse({ vehicle: { id: 'vehicle_2' } }, { status: 201 }))
      .mockResolvedValueOnce(jsonResponse({ activeVehicleId: 'vehicle_2' }))
      .mockResolvedValueOnce(jsonResponse({ removedVehicleId: 'vehicle_1' }));

    await expect(service.listVehicles()).resolves.toEqual([{ id: 'vehicle_1' }]);
    await expect(service.addVehicle({ plate: 'ABC1D23' })).resolves.toEqual({ id: 'vehicle_2' });
    await expect(service.selectVehicle('vehicle_2')).resolves.toBe('vehicle_2');
    await expect(service.removeVehicle('vehicle_1')).resolves.toBe(true);

    expect(mockAuthenticatedRequest.mock.calls).toEqual([
      ['/account/vehicles', { method: 'GET' }],
      ['/account/vehicles', { method: 'POST', body: JSON.stringify({ vehicle: { plate: 'ABC1D23' } }) }],
      ['/account/vehicles/vehicle_2/active', { method: 'PATCH', body: JSON.stringify({ active: true }) }],
      ['/account/vehicles/vehicle_1', { method: 'DELETE' }],
    ]);
  });

  it('persists preferences and profile through authenticated account APIs', async () => {
    const preferencesService = require('../src/services/MobilePreferencesService').default;
    const profileService = require('../src/services/MobileProfileService').default;
    mockAuthenticatedRequest
      .mockResolvedValueOnce(jsonResponse({ preferences: { notificationsEnabled: false } }))
      .mockResolvedValueOnce(jsonResponse({ preferences: { notificationsEnabled: true } }))
      .mockResolvedValueOnce(jsonResponse({ profile: { name: 'Leaf Teste' } }))
      .mockResolvedValueOnce(jsonResponse({ profile: { name: 'Leaf Atualizado' } }));

    await expect(preferencesService.getPreferences()).resolves.toEqual(expect.objectContaining({ notificationsEnabled: false }));
    await expect(preferencesService.updatePreferences({ notificationsEnabled: true })).resolves.toEqual(expect.objectContaining({ notificationsEnabled: true }));
    await expect(profileService.getCurrentProfileOrThrow()).resolves.toEqual({ name: 'Leaf Teste' });
    await expect(profileService.upsertCurrentProfileOrThrow({ name: 'Leaf Atualizado' })).resolves.toEqual({ name: 'Leaf Atualizado' });

    expect(mockAuthenticatedRequest).toHaveBeenCalledWith('/account/preferences', expect.objectContaining({ method: 'GET' }));
    expect(mockAuthenticatedRequest).toHaveBeenCalledWith('/account/preferences', expect.objectContaining({ method: 'PATCH' }));
    expect(mockAuthenticatedRequest).toHaveBeenCalledWith('/account/profile', expect.objectContaining({ method: 'GET' }));
    expect(mockAuthenticatedRequest).toHaveBeenCalledWith('/account/profile', expect.objectContaining({ method: 'PUT' }));
  });

  it('preserves backend mutation errors for honest loading/error/retry UI', async () => {
    const service = require('../src/services/MobileVehicleService').default;
    mockAuthenticatedRequest.mockResolvedValueOnce(jsonResponse({
      code: 'DRIVER_MUST_BE_OFFLINE',
      message: 'Fique offline.',
    }, { ok: false, status: 409 }));

    await expect(service.addVehicle({ plate: 'ABC1D23' })).rejects.toMatchObject({
      status: 409,
      code: 'DRIVER_MUST_BE_OFFLINE',
      message: 'Fique offline.',
    });
  });
});
