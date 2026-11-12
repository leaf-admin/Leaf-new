jest.unmock('express');

const express = require('express');
const request = require('supertest');

const mockGetIncident = jest.fn();
const mockGetPackage = jest.fn();
const mockReadCurrentLocation = jest.fn();
const mockRequiredRoles = [];

jest.mock('../../../middleware/support-auth', () => ({
  authenticateSupport: (req, _res, next) => {
    req.user = { uid: 'support-1', role: 'support' };
    next();
  },
  requireSupportRoles: (roles) => {
    mockRequiredRoles.push(roles);
    return (_req, _res, next) => next();
  }
}));

jest.mock('../../../services/safety-incident-service', () => ({
  getIncident: (...args) => mockGetIncident(...args),
  getEmergencyPackage: (...args) => mockGetPackage(...args),
  listIncidents: jest.fn()
}));

jest.mock('../../../services/emergency-package-service', () => ({
  getDefaultEmergencyPackageService: () => ({ readCurrentLocation: (...args) => mockReadCurrentLocation(...args) })
}));

jest.mock('../../../utils/logger', () => ({
  logError: jest.fn(),
  logRedis: jest.fn(),
  logStructured: jest.fn(),
  logger: { debug: jest.fn(), error: jest.fn(), info: jest.fn(), warn: jest.fn() }
}));

jest.mock('../../../utils/redis-pool', () => ({
  ensureConnection: jest.fn().mockResolvedValue(undefined),
  getConnection: jest.fn(() => null)
}));

const opsRoutes = require('../../../routes/ops');

function createApp() {
  const app = express();
  app.use('/api/ops', opsRoutes);
  return app;
}

describe('ops emergency package route', () => {
  beforeEach(() => {
    mockGetIncident.mockReset();
    mockGetPackage.mockReset();
    mockReadCurrentLocation.mockReset();
  });

  it('fecha o pacote para o perfil só leitura', () => {
    const packageRoles = mockRequiredRoles.find((roles) => Array.isArray(roles) && roles.includes('support') && !roles.includes('viewer'));
    expect(packageRoles).toEqual(['admin', 'manager', 'super-admin', 'support', 'development']);
  });

  it('devolve o pacote com a posição atual da viagem', async () => {
    mockGetIncident.mockResolvedValue({ incidentId: 'INC-1', bookingId: 'ride-1', status: 'OPEN', publicSafetyDispatch: { status: 'disabled' } });
    mockGetPackage.mockResolvedValue({ version: 1, vehicle: { plate: 'RJA2D41' } });
    mockReadCurrentLocation.mockResolvedValue({ location: { lat: -22.9, lng: -43.1, source: 'trip_stream' } });

    const response = await request(createApp()).get('/api/ops/incidents/INC-1/emergency-package');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      incidentId: 'INC-1',
      publicSafetyDispatch: { status: 'disabled' },
      emergencyPackage: { version: 1, vehicle: { plate: 'RJA2D41' } },
      currentLocation: { lat: -22.9, lng: -43.1, source: 'trip_stream' }
    }));
    expect(mockReadCurrentLocation).toHaveBeenCalledWith('ride-1');
  });

  it('responde 404 sem incidente ou sem pacote', async () => {
    mockGetIncident.mockResolvedValueOnce(null).mockResolvedValueOnce({ incidentId: 'INC-2' });
    mockGetPackage.mockResolvedValueOnce(null);

    const missingIncident = await request(createApp()).get('/api/ops/incidents/INC-9/emergency-package');
    const missingPackage = await request(createApp()).get('/api/ops/incidents/INC-2/emergency-package');

    expect(missingIncident.status).toBe(404);
    expect(missingPackage.status).toBe(404);
  });
});
