import {
  MAX_DIRECTIONS_REQUESTS_PER_BOOKING,
  buildQuoteLockRouteKey,
  buildQuoteLockSnapshot,
  clearDirectionsBudgetForBooking,
  normalizePersistedQuoteLock,
  normalizeRuntimeCoordinate,
  normalizeRuntimeRouteCoordinates,
  registerDirectionsRequestForBooking,
  resetDirectionsBudgetForTests,
  resolveActiveQuoteLock,
} from '../src/screens/prototype/prototypeQuoteRuntime';

describe('prototype quote runtime helpers', () => {
  beforeEach(() => {
    jest.useRealTimers();
    resetDirectionsBudgetForTests();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('normalizes coordinates and route coordinates safely', () => {
    expect(normalizeRuntimeCoordinate({ lat: '-22.98391', lng: '-43.21788' })).toEqual({
      latitude: -22.98391,
      longitude: -43.21788,
    });
    expect(normalizeRuntimeCoordinate({ latitude: 'n/a', longitude: -43.21 })).toBeNull();

    expect(normalizeRuntimeRouteCoordinates([
      { latitude: -22.98, longitude: -43.21 },
      { latitude: 'nope', longitude: -43.22 },
      { lat: -22.99, lng: -43.23 },
    ])).toEqual([
      { latitude: -22.98, longitude: -43.21 },
      { latitude: -22.99, longitude: -43.23 },
    ]);
  });

  it('builds a stable route key with coordinate precision', () => {
    expect(buildQuoteLockRouteKey(
      { latitude: -22.98391, longitude: -43.21788 },
      { latitude: -22.99943, longitude: -43.36544 },
    )).toBe('-22.984:-43.218:-22.999:-43.365');

    expect(buildQuoteLockRouteKey(null, { latitude: -22.99, longitude: -43.36 })).toBe('');
  });

  it('builds normalized quote lock snapshots with ttl and capped route points', () => {
    const nowMs = Date.parse('2026-06-06T12:00:00.000Z');
    const coordinates = Array.from({ length: 220 }, (_, index) => ({
      latitude: -22.98 - index * 0.001,
      longitude: -43.21 - index * 0.001,
    }));

    const snapshot = buildQuoteLockSnapshot({
      originCoordinate: { latitude: -22.98391, longitude: -43.21788 },
      destinationCoordinate: { latitude: -22.99943, longitude: -43.36544 },
      distanceKm: 7.74,
      durationMinutes: 13.6,
      coordinates,
      nowMs,
    });

    expect(snapshot).toEqual(expect.objectContaining({
      routeKey: '-22.984:-43.218:-22.999:-43.365',
      distanceKm: 7.7,
      durationMinutes: 14,
      etaText: 'Chegada estimada em 14 min',
      createdAt: nowMs,
    }));
    expect(snapshot.expiresAt).toBeGreaterThan(nowMs);
    expect(snapshot.coordinates).toHaveLength(180);
  });

  it('normalizes only valid and fresh persisted quote locks', () => {
    const nowMs = Date.parse('2026-06-06T12:00:00.000Z');
    const validLock = {
      routeKey: '-22.984:-43.218:-22.999:-43.365',
      distanceKm: '8.26',
      durationMinutes: '11.2',
      createdAt: nowMs - 1000,
      expiresAt: nowMs + 60000,
      coordinates: [{ lat: -22.98, lng: -43.21 }],
    };

    expect(normalizePersistedQuoteLock(validLock, nowMs)).toEqual(expect.objectContaining({
      distanceKm: 8.3,
      durationMinutes: 11,
      etaText: 'Chegada estimada em 11 min',
      coordinates: [{ latitude: -22.98, longitude: -43.21 }],
    }));
    expect(normalizePersistedQuoteLock({ ...validLock, expiresAt: nowMs - 1 }, nowMs)).toBeNull();
    expect(normalizePersistedQuoteLock({ ...validLock, distanceKm: 0 }, nowMs)).toBeNull();
    expect(normalizePersistedQuoteLock({ ...validLock, routeKey: '' }, nowMs)).toBeNull();
  });

  it('resolves active quote locks only when route keys match', () => {
    const nowMs = Date.parse('2026-06-06T12:00:00.000Z');
    const routeKey = '-22.984:-43.218:-22.999:-43.365';
    const lock = {
      routeKey,
      distanceKm: 8,
      durationMinutes: 12,
      createdAt: nowMs - 1000,
      expiresAt: nowMs + 60000,
    };

    expect(resolveActiveQuoteLock(lock, routeKey, nowMs)).toEqual(expect.objectContaining({
      routeKey,
      distanceKm: 8,
    }));
    expect(resolveActiveQuoteLock(lock, 'different-route', nowMs)).toBeNull();
  });

  it('enforces and clears the per-booking directions request budget', () => {
    const bookingId = 'booking-directions-budget';

    for (let index = 1; index <= MAX_DIRECTIONS_REQUESTS_PER_BOOKING; index += 1) {
      expect(registerDirectionsRequestForBooking(bookingId)).toEqual(expect.objectContaining({
        allowed: true,
        count: index,
      }));
    }

    expect(registerDirectionsRequestForBooking(bookingId)).toEqual(expect.objectContaining({
      allowed: false,
      count: MAX_DIRECTIONS_REQUESTS_PER_BOOKING,
    }));

    clearDirectionsBudgetForBooking(bookingId);
    expect(registerDirectionsRequestForBooking(bookingId)).toEqual(expect.objectContaining({
      allowed: true,
      count: 1,
    }));
    expect(registerDirectionsRequestForBooking('')).toEqual(expect.objectContaining({
      allowed: true,
      count: 0,
    }));
  });
});
