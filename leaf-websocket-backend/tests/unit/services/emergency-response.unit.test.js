const crypto = require('crypto');
const { createEmergencyPackageService } = require('../../../services/emergency-package-service');
const { createPublicSafetyDispatchService } = require('../../../services/public-safety-dispatch-service');
const { createEmergencyResponseService } = require('../../../services/emergency-response-service');

jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn(),
  logError: jest.fn(),
  logger: { debug: jest.fn(), error: jest.fn(), info: jest.fn(), warn: jest.fn() }
}));

const NOW = '2026-11-12T22:00:00.000Z';

function fakeRedis(hashes = {}) {
  return {
    hgetall: jest.fn(async (key) => {
      if (hashes[key] instanceof Error) throw hashes[key];
      return hashes[key] || {};
    })
  };
}

const booking = {
  status: 'IN_PROGRESS',
  driverId: 'driver-1',
  customerId: 'passenger-1',
  driverName: 'Ana',
  vehiclePlate: 'RJA2D41',
  vehicleModel: 'Onix',
  vehicleColor: 'Prata',
  carType: 'Leaf Plus',
  pickupLocation: JSON.stringify({ lat: -22.97, lng: -43.18, add: 'Copacabana' }),
  destinationLocation: JSON.stringify({ lat: -22.98, lng: -43.2, add: 'Ipanema' }),
  acceptedAt: '2026-11-12T21:50:00.000Z',
  startedAt: '2026-11-12T21:55:00.000Z'
};

const users = {
  'driver-1': { fullName: 'Ana Souza', phoneNumber: '+5521900000001' },
  'passenger-1': { firstName: 'Bruno', lastName: 'Lima', mobile: '+5521900000002' }
};

function packageService(hashes, readUser = async (_fs, id) => users[id] || null) {
  return createEmergencyPackageService({
    getRedis: () => fakeRedis(hashes),
    getFirestore: () => ({}),
    readUser,
    now: () => NOW
  });
}

describe('emergency-package-service', () => {
  it('monta carro, pessoas, rota e prioriza a localização de quem acionou', async () => {
    const service = packageService({
      'booking:ride-1': booking,
      'trip_loc_meta:ride-1': { canonicalLastLat: '-22.975', canonicalLastLng: '-43.19', canonicalLastReceivedAt: '1794520800000' }
    });

    const pkg = await service.buildEmergencyPackage({
      bookingId: 'ride-1',
      reporterId: 'passenger-1',
      reporterType: 'passenger',
      location: { lat: -22.976, lng: -43.191, accuracy: 12.4 }
    });

    expect(pkg.vehicle).toEqual({ plate: 'RJA2D41', model: 'Onix', color: 'Prata', category: 'Leaf Plus' });
    expect(pkg.driver).toEqual({ userId: 'driver-1', name: 'Ana Souza', phone: '+5521900000001' });
    expect(pkg.passenger).toEqual({ userId: 'passenger-1', name: 'Bruno Lima', phone: '+5521900000002' });
    expect(pkg.ride).toEqual(expect.objectContaining({
      bookingId: 'ride-1',
      status: 'IN_PROGRESS',
      pickup: { lat: -22.97, lng: -43.18, address: 'Copacabana' }
    }));
    expect(pkg.location).toEqual({ lat: -22.976, lng: -43.191, accuracyMeters: 12, capturedAt: NOW, source: 'reporter_device' });
    expect(pkg.lastTripLocation).toEqual(expect.objectContaining({ lat: -22.975, lng: -43.19, source: 'trip_stream' }));
    expect(pkg.warnings).toEqual([]);
  });

  it('usa a última posição da viagem quando o celular não mandou localização', async () => {
    const service = packageService({
      'booking:ride-1': booking,
      'trip_loc_meta:ride-1': { canonicalLastLat: '-22.975', canonicalLastLng: '-43.19' }
    });

    const pkg = await service.buildEmergencyPackage({ bookingId: 'ride-1', reporterId: 'driver-1', reporterType: 'driver' });

    expect(pkg.location).toEqual(expect.objectContaining({ lat: -22.975, lng: -43.19, source: 'trip_stream' }));
  });

  it('não derruba o fluxo quando uma leitura falha', async () => {
    const service = packageService(
      { 'booking:ride-1': booking, 'trip_loc_meta:ride-1': new Error('redis down') },
      async () => { throw new Error('firestore down'); }
    );

    const pkg = await service.buildEmergencyPackage({ bookingId: 'ride-1', reporterId: 'passenger-1' });

    expect(pkg.driver).toEqual({ userId: 'driver-1', name: 'Ana', phone: null });
    expect(pkg.location).toBeNull();
    expect(pkg.warnings).toEqual(expect.arrayContaining(['driver_profile_unavailable', 'passenger_profile_unavailable', 'trip_location_unavailable']));
  });

  it('sem corrida, guarda só quem acionou e onde estava', async () => {
    const service = packageService({});

    const pkg = await service.buildEmergencyPackage({ reporterId: 'passenger-1', location: { latitude: -22.9, longitude: -43.1 } });

    expect(pkg.ride).toBeNull();
    expect(pkg.vehicle).toBeNull();
    expect(pkg.location).toEqual(expect.objectContaining({ lat: -22.9, lng: -43.1 }));
  });
});

describe('public-safety-dispatch-service', () => {
  const incident = { incidentId: 'INC-1', category: 'emergency', openedAt: NOW };
  const emergencyPackage = { version: 1, vehicle: { plate: 'RJA2D41' } };

  it('fica desligado por padrão e não chama a rede', async () => {
    const fetchImpl = jest.fn();
    const service = createPublicSafetyDispatchService({ env: {}, fetchImpl, now: () => NOW });

    await expect(service.dispatch({ incident, emergencyPackage })).resolves.toEqual(expect.objectContaining({ status: 'disabled' }));
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('exige URL HTTPS e segredo antes de enviar', async () => {
    const fetchImpl = jest.fn();
    const service = createPublicSafetyDispatchService({
      env: { PUBLIC_SAFETY_DISPATCH_ENABLED: 'true', PUBLIC_SAFETY_DISPATCH_URL: 'http://190.example', PUBLIC_SAFETY_DISPATCH_SECRET: 's' },
      fetchImpl,
      now: () => NOW
    });

    await expect(service.dispatch({ incident, emergencyPackage })).resolves.toEqual(expect.objectContaining({ status: 'not_configured' }));
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('nunca envia incidente do sandbox', async () => {
    const fetchImpl = jest.fn();
    const service = createPublicSafetyDispatchService({
      env: { PUBLIC_SAFETY_DISPATCH_ENABLED: 'true', PUBLIC_SAFETY_DISPATCH_URL: 'https://190.example', PUBLIC_SAFETY_DISPATCH_SECRET: 's' },
      fetchImpl,
      now: () => NOW
    });

    await expect(service.dispatch({ incident, emergencyPackage, namespace: 'sandbox' }))
      .resolves.toEqual(expect.objectContaining({ status: 'skipped_sandbox' }));
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('envia assinado com HMAC e chave de idempotência quando ligado', async () => {
    const fetchImpl = jest.fn(async () => ({ ok: true, status: 202 }));
    const service = createPublicSafetyDispatchService({
      env: {
        PUBLIC_SAFETY_DISPATCH_ENABLED: 'true',
        PUBLIC_SAFETY_DISPATCH_URL: 'https://190.example/leaf',
        PUBLIC_SAFETY_DISPATCH_SECRET: 'segredo',
        PUBLIC_SAFETY_DISPATCH_AGENCY: 'pmerj'
      },
      fetchImpl,
      now: () => NOW
    });

    const result = await service.dispatch({ incident, emergencyPackage });

    expect(result).toEqual({ agency: 'pmerj', attemptedAt: NOW, status: 'sent', httpStatus: 202 });
    const [url, request] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://190.example/leaf');
    expect(request.headers['idempotency-key']).toBe('INC-1');
    const expected = `sha256=${crypto.createHmac('sha256', 'segredo').update(`${request.headers['x-leaf-timestamp']}.`).update(request.body).digest('hex')}`;
    expect(request.headers['x-leaf-signature']).toBe(expected);
    expect(JSON.parse(request.body)).toEqual(expect.objectContaining({ incidentId: 'INC-1', package: emergencyPackage }));
  });

  it('devolve falha sem lançar erro quando a central não responde', async () => {
    const env = { PUBLIC_SAFETY_DISPATCH_ENABLED: 'true', PUBLIC_SAFETY_DISPATCH_URL: 'https://190.example', PUBLIC_SAFETY_DISPATCH_SECRET: 's' };
    const rejected = createPublicSafetyDispatchService({ env, fetchImpl: async () => { throw new Error('ECONNREFUSED'); }, now: () => NOW });
    const refused = createPublicSafetyDispatchService({ env, fetchImpl: async () => ({ ok: false, status: 503 }), now: () => NOW });

    await expect(rejected.dispatch({ incident, emergencyPackage })).resolves.toEqual(expect.objectContaining({ status: 'failed', error: 'network_error' }));
    await expect(refused.dispatch({ incident, emergencyPackage })).resolves.toEqual(expect.objectContaining({ status: 'failed', httpStatus: 503 }));
  });
});

describe('emergency-response-service', () => {
  it('monta o pacote, tenta o envio, guarda no incidente e audita', async () => {
    const emergencyPackage = { version: 1, location: { lat: 1, lng: 2 }, warnings: [] };
    const incidentService = { attachEmergencyPackage: jest.fn(async () => true) };
    const packageService = { buildEmergencyPackage: jest.fn(async () => emergencyPackage) };
    const dispatchService = { dispatch: jest.fn(async () => ({ status: 'disabled', agency: null })) };
    const auditService = { logEvent: jest.fn(async () => ({})) };
    const service = createEmergencyResponseService({ incidentService, packageService, dispatchService, auditService });
    const incident = { incidentId: 'INC-1', bookingId: 'ride-1', financialNamespace: 'operational' };

    const result = await service.handleEmergencyIncident({
      incident,
      reporterId: 'passenger-1',
      reporterType: 'passenger',
      location: { lat: 1, lng: 2 },
      persistenceContext: { namespace: 'operational' }
    });

    expect(result).toEqual({ status: 'stored', dispatchStatus: 'disabled' });
    expect(packageService.buildEmergencyPackage).toHaveBeenCalledWith({
      bookingId: 'ride-1', reporterId: 'passenger-1', reporterType: 'passenger', location: { lat: 1, lng: 2 }
    });
    expect(dispatchService.dispatch).toHaveBeenCalledWith({ incident, emergencyPackage, namespace: 'operational' });
    expect(incidentService.attachEmergencyPackage).toHaveBeenCalledWith('INC-1', {
      emergencyPackage,
      publicSafetyDispatch: { status: 'disabled', agency: null },
      persistenceContext: { namespace: 'operational' }
    });
    expect(auditService.logEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'safety.emergency_package',
      details: expect.objectContaining({ incidentId: 'INC-1', dispatchStatus: 'disabled', hasLocation: true })
    }));
    expect(JSON.stringify(auditService.logEvent.mock.calls[0][0])).not.toMatch(/phone|plate/i);
  });
});
