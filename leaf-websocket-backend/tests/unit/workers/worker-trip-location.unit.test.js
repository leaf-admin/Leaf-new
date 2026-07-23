const mockRegisterListener = jest.fn();
const mockStart = jest.fn().mockResolvedValue(undefined);
const mockBufferLocationEvent = jest.fn().mockResolvedValue({ success: true });

jest.mock('../../../workers/WorkerManager', () => jest.fn().mockImplementation(() => ({
  registerListener: mockRegisterListener,
  getStats: jest.fn(() => ({})),
  stop: jest.fn().mockResolvedValue(undefined),
  start: mockStart
})));

jest.mock('../../../services/trip-location-persistence-service', () => ({
  bufferLocationEvent: mockBufferLocationEvent,
  flushPendingTrips: jest.fn().mockResolvedValue({ success: true })
}));

jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn()
}));

describe('worker-trip-location sandbox persistence context', () => {
  const previousWorkerFlag = process.env.ENABLE_TRIP_LOCATION_PERSISTENCE_WORKER;
  let tripLocationListener;

  beforeAll(() => {
    jest.useFakeTimers();
    process.env.ENABLE_TRIP_LOCATION_PERSISTENCE_WORKER = 'true';
    require('../../../workers/worker-trip-location');
    const listenerRegistration = mockRegisterListener.mock.calls.find(
      ([eventType]) => eventType === 'trip.location.v1'
    );
    tripLocationListener = listenerRegistration?.[1];
  });

  afterAll(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    if (previousWorkerFlag === undefined) {
      delete process.env.ENABLE_TRIP_LOCATION_PERSISTENCE_WORKER;
    } else {
      process.env.ENABLE_TRIP_LOCATION_PERSISTENCE_WORKER = previousWorkerFlag;
    }
  });

  beforeEach(() => {
    mockBufferLocationEvent.mockClear();
  });

  test('preserves the server-authored sandbox envelope from stream payload to persistence', async () => {
    expect(tripLocationListener).toBeDefined();
    await tripLocationListener({
      bookingId: 'sandbox-trip-1',
      driverId: 'sandbox-driver-1',
      customerId: 'sandbox-customer-1',
      data: {
        tripId: 'sandbox-trip-1',
        driverId: 'sandbox-driver-1',
        customerId: 'sandbox-customer-1',
        seq: 7,
        lat: -22.9,
        lng: -43.2,
        capturedAt: 1710000000000,
        receivedAt: 1710000000100,
        financialContext: '{"version":1,"namespace":"sandbox","contextId":"sandbox-context-id"}',
        financialNamespace: 'sandbox',
        financialContextId: 'sandbox-context-id',
        providerEnvironment: 'sandbox',
        paymentProfileId: 'qa-sandbox',
        testUserSandbox: 'true'
      }
    });

    expect(mockBufferLocationEvent).toHaveBeenCalledWith(expect.objectContaining({
      tripId: 'sandbox-trip-1',
      driverId: 'sandbox-driver-1',
      financialContext: '{"version":1,"namespace":"sandbox","contextId":"sandbox-context-id"}',
      financialNamespace: 'sandbox',
      financialContextId: 'sandbox-context-id',
      providerEnvironment: 'sandbox',
      paymentProfileId: 'qa-sandbox',
      testUserSandbox: 'true'
    }));
  });
});
