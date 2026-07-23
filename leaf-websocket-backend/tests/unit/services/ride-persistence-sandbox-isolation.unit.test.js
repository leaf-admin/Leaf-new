const documents = new Map();
const collectionCalls = [];

function createDocRef(path) {
  return {
    set: jest.fn(async (data, options = {}) => {
      const previous = documents.get(path) || {};
      documents.set(path, options.merge ? { ...previous, ...data } : { ...data });
    }),
    update: jest.fn(async (data) => {
      if (!documents.has(path)) throw new Error(`missing document: ${path}`);
      documents.set(path, { ...documents.get(path), ...data });
    }),
    get: jest.fn(async () => ({
      exists: documents.has(path),
      data: () => documents.get(path)
    }))
  };
}

const firestore = {
  collection: jest.fn((name) => {
    collectionCalls.push(name);
    return {
      doc: (id) => createDocRef(`${name}/${id}`)
    };
  })
};

const redisHashes = new Map();
const redis = {
  status: 'ready',
  hset: jest.fn(async (key, fieldOrData, maybeValue) => {
    if (typeof fieldOrData === 'string') {
      const current = redisHashes.get(key) || {};
      current[fieldOrData] = maybeValue;
      redisHashes.set(key, current);
      return 1;
    }
    redisHashes.set(key, {
      ...(redisHashes.get(key) || {}),
      ...(fieldOrData || {})
    });
    return 1;
  }),
  hgetall: jest.fn(async (key) => redisHashes.get(key) || {}),
  hdel: jest.fn(async (key, field) => {
    const current = redisHashes.get(key) || {};
    delete current[field];
    redisHashes.set(key, current);
    return 1;
  })
};

jest.mock('../../../firebase-config', () => ({
  getFirestore: jest.fn(() => firestore)
}));

jest.mock('../../../utils/redis-pool', () => ({
  getConnection: jest.fn(() => redis)
}));

jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }
}));

jest.mock('firebase-admin', () => ({
  firestore: {
    FieldValue: {
      serverTimestamp: jest.fn(() => '__SERVER_TIMESTAMP__')
    }
  }
}));

const { sealFinancialContext } = require('../../../services/financial-runtime-context');
const ridePersistenceService = require('../../../services/ride-persistence-service');

function sandboxContext() {
  return sealFinancialContext({
    providerEnvironment: 'sandbox',
    paymentProfileId: 'qa-test-users-sandbox-durable',
    paymentProfileSource: 'firestore',
    testUserSandbox: true
  });
}

function baseRide(overrides = {}) {
  return {
    rideId: 'ride_qa_1',
    bookingId: 'ride_qa_1',
    passengerId: 'qa_passenger',
    pickupLocation: { lat: -22.9, lng: -43.2 },
    destinationLocation: { lat: -22.91, lng: -43.21 },
    estimatedFare: 42,
    paymentMethod: 'pix',
    paymentStatus: 'in_holding',
    status: 'pending',
    ...overrides
  };
}

describe('ride persistence sandbox isolation', () => {
  beforeEach(() => {
    documents.clear();
    collectionCalls.length = 0;
    redisHashes.clear();
    jest.clearAllMocks();
    ridePersistenceService.firestore = firestore;
    ridePersistenceService.maxRetries = 1;
    ridePersistenceService.retryDelay = 0;
  });

  it('writes a sealed QA ride only to sandbox_rides', async () => {
    const financialContext = sandboxContext();
    const result = await ridePersistenceService.saveRide(baseRide({
      financialContext,
      financialNamespace: 'sandbox',
      financialContextId: financialContext.contextId,
      providerEnvironment: 'sandbox',
      testUserSandbox: true
    }));

    expect(result).toMatchObject({
      success: true,
      financialNamespace: 'sandbox'
    });
    expect(documents.has('rides/ride_qa_1')).toBe(false);
    expect(documents.get('sandbox_rides/ride_qa_1')).toMatchObject({
      rideId: 'ride_qa_1',
      passengerId: 'qa_passenger',
      financialNamespace: 'sandbox',
      financialContextId: financialContext.contextId,
      financialContext
    });
  });

  it('keeps a context-less legacy call on the operational collection', async () => {
    const result = await ridePersistenceService.saveRide(baseRide({ rideId: 'ride_legacy_1' }));

    expect(result).toMatchObject({
      success: true,
      financialNamespace: 'operational'
    });
    expect(documents.has('rides/ride_legacy_1')).toBe(true);
    expect(documents.has('sandbox_rides/ride_legacy_1')).toBe(false);
    expect(documents.get('rides/ride_legacy_1')).not.toHaveProperty('financialContext');
  });

  it('fails before Redis or Firestore when a sandbox signal lost its seal', async () => {
    const result = await ridePersistenceService.saveRide(baseRide({
      rideId: 'ride_lost_context',
      financialNamespace: 'sandbox',
      providerEnvironment: 'sandbox'
    }));

    expect(result).toMatchObject({
      success: false,
      code: 'FINANCIAL_SANDBOX_CONTEXT_LOST'
    });
    expect(documents.size).toBe(0);
    expect(redis.hset).not.toHaveBeenCalled();
  });

  it('keeps accept, start, finalization and reads inside the sandbox namespace', async () => {
    const financialContext = sandboxContext();
    const persistenceInput = {
      financialContext,
      financialNamespace: 'sandbox',
      financialContextId: financialContext.contextId,
      providerEnvironment: 'sandbox',
      testUserSandbox: true
    };
    await ridePersistenceService.saveRide(baseRide(persistenceInput));

    await ridePersistenceService.updateRideDriver('ride_qa_1', 'qa_driver', persistenceInput);
    await ridePersistenceService.markRideStarted('ride_qa_1', persistenceInput);
    const finalResult = await ridePersistenceService.saveFinalRideData('ride_qa_1', {
      ...persistenceInput,
      fare: 42,
      distance: 8.2,
      duration: 900,
      completionType: 'INTERRUPTED_OPERATIONAL_ENDED'
    });
    const stored = await ridePersistenceService.getRide('ride_qa_1', persistenceInput);

    expect(finalResult).toMatchObject({ success: true, financialNamespace: 'sandbox' });
    expect(stored).toMatchObject({
      driverId: 'qa_driver',
      status: 'INTERRUPTED_OPERATIONAL_ENDED',
      finalPrice: 42,
      financialContextId: financialContext.contextId
    });
    expect(collectionCalls).not.toContain('rides');
  });

  it('marks a sandbox no-driver ride terminal without writing operational rides', async () => {
    const financialContext = sandboxContext();
    const persistenceInput = {
      financialContext,
      financialNamespace: 'sandbox',
      financialContextId: financialContext.contextId,
      providerEnvironment: 'sandbox',
      testUserSandbox: true
    };
    await ridePersistenceService.saveRide(baseRide({
      rideId: 'booking_sandbox_no_drivers',
      bookingId: 'booking_sandbox_no_drivers',
      ...persistenceInput
    }));

    const result = await ridePersistenceService.markRideCancelled(
      'booking_sandbox_no_drivers',
      'NO_DRIVERS_AVAILABLE',
      persistenceInput
    );

    expect(result).toMatchObject({
      success: true,
      financialNamespace: 'sandbox'
    });
    expect(documents.get('sandbox_rides/booking_sandbox_no_drivers')).toMatchObject({
      status: 'cancelled',
      cancellationReason: 'NO_DRIVERS_AVAILABLE',
      financialNamespace: 'sandbox',
      financialContextId: financialContext.contextId
    });
    expect(documents.has('rides/booking_sandbox_no_drivers')).toBe(false);
    expect(collectionCalls).not.toContain('rides');
  });

  it('stores sandbox outbox entries with an explicit namespace and sealed context', async () => {
    const financialContext = sandboxContext();
    const result = await ridePersistenceService.queueFinalizationOutbox('ride_qa_1', {
      financialContext,
      financialNamespace: 'sandbox',
      financialContextId: financialContext.contextId,
      providerEnvironment: 'sandbox',
      fare: 42
    }, 'test_failure');

    expect(result.success).toBe(true);
    const entry = JSON.parse(redisHashes.get('rides:finalization_outbox')['sandbox:ride_qa_1']);
    expect(entry).toMatchObject({
      rideId: 'ride_qa_1',
      financialNamespace: 'sandbox',
      financialContextId: financialContext.contextId,
      finalData: expect.objectContaining({
        financialContextId: financialContext.contextId
      })
    });
  });
});
