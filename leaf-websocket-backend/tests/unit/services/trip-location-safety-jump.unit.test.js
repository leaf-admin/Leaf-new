jest.mock('../../../utils/redis-pool', () => ({
  ensureConnection: jest.fn(),
  getConnection: jest.fn()
}));

jest.mock('../../../firebase-config', () => ({
  getFirestore: jest.fn(() => null)
}));

jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn(),
  logError: jest.fn()
}));

jest.mock('../../../services/safety-signal-service', () => ({
  record: jest.fn().mockResolvedValue({ recorded: true })
}));

const safetySignalService = require('../../../services/safety-signal-service');
const service = require('../../../services/trip-location-persistence-service');

const START = Date.parse('2026-10-21T12:00:00Z');
const previous = { lat: -22.9068, lng: -43.1729 };

function point(overrides = {}) {
  return {
    tripId: 'trip-1',
    driverId: 'driver-1',
    lat: -22.9068,
    lng: -43.1729,
    capturedAt: START + 30000,
    accuracy: 10,
    ...overrides
  };
}

describe('trip location safety jump', () => {
  beforeEach(() => jest.clearAllMocks());

  it('flags an impossible jump between two device captures', () => {
    // ~11 km ao norte em 30 s (~1300 km/h).
    const result = service.checkLocationJump(
      point({ lat: -22.8068 }),
      previous,
      { canonicalLastCapturedAt: String(START) }
    );

    expect(result.speedKmh).toBeGreaterThan(1000);
    expect(safetySignalService.record).toHaveBeenCalledWith(expect.objectContaining({
      type: 'location_jump',
      driverId: 'driver-1',
      bookingId: 'trip-1',
      sandbox: false,
      dedupeKey: 'trip-1'
    }));
  });

  it('ignores normal driving, imprecise points, replays without capture time and test rides stay silent', () => {
    // ~1.1 km em 60 s (~66 km/h): direção normal.
    expect(service.checkLocationJump(point({ lat: -22.8968, capturedAt: START + 60000 }), previous, { canonicalLastCapturedAt: String(START) })).toBeNull();
    // Ponto impreciso (precisão pior que 200 m).
    expect(service.checkLocationJump(point({ lat: -22.8068, accuracy: 900 }), previous, { canonicalLastCapturedAt: String(START) })).toBeNull();
    // Sem horário de captura anterior (corrida que começou antes deste campo existir).
    expect(service.checkLocationJump(point({ lat: -22.8068 }), previous, {})).toBeNull();
    // Captura fora de ordem (ponto reenviado mais antigo que o último).
    expect(service.checkLocationJump(point({ lat: -22.8068, capturedAt: START - 1000 }), previous, { canonicalLastCapturedAt: String(START) })).toBeNull();
    expect(safetySignalService.record).not.toHaveBeenCalled();

    service.checkLocationJump(point({ lat: -22.8068, testUserSandbox: true }), previous, { canonicalLastCapturedAt: String(START) });
    expect(safetySignalService.record).toHaveBeenCalledWith(expect.objectContaining({ sandbox: true }));
  });
});
