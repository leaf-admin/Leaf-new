jest.mock('firebase-admin', () => {
  const firestore = jest.fn();
  firestore.FieldValue = { serverTimestamp: jest.fn(() => 'SERVER_TIMESTAMP') };
  return { apps: [], firestore, database: jest.fn() };
});
jest.mock('../../../firebase-config', () => ({
  getFirestore: jest.fn(() => null),
  getRealtimeDB: jest.fn(() => null)
}));
jest.mock('../../../services/driver-subscription-service', () => ({
  syncDriverSubscription: jest.fn()
}));
jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn()
}));

const {
  SubscriptionStateService
} = require('../../../services/subscription-state-service');

function firestoreWithDocument(data, { exists = true } = {}) {
  const docRef = {
    get: jest.fn().mockResolvedValue({ exists, data: () => data }),
    set: jest.fn()
  };
  return {
    docRef,
    firestore: {
      collection: jest.fn(() => ({ doc: jest.fn(() => docRef) }))
    }
  };
}

describe('subscription-state-service authority and cache contract', () => {
  it('uses a valid Redis snapshot without consulting Firestore', async () => {
    const service = new SubscriptionStateService();
    const redis = {
      get: jest.fn().mockResolvedValue(JSON.stringify({
        driverId: 'driver-1',
        subscriptionStatus: 'blocked',
        billingStatus: 'suspended',
        pendingFeeCents: 490,
        authoritySource: 'firestore',
        cachedAt: new Date().toISOString()
      }))
    };
    const firestore = { collection: jest.fn() };

    await expect(service.getGateState('driver-1', { redis, firestore })).resolves.toMatchObject({
      source: 'redis_cache',
      subscriptionStatus: 'blocked',
      billingStatus: 'suspended'
    });
    expect(firestore.collection).not.toHaveBeenCalled();
  });

  it('rejects a Redis snapshot older than the configured bounded cache window', async () => {
    const service = new SubscriptionStateService();
    const redis = {
      get: jest.fn().mockResolvedValue(JSON.stringify({
        driverId: 'driver-1',
        subscriptionStatus: 'active',
        billingStatus: 'active',
        authoritySource: 'firestore',
        cachedAt: new Date(Date.now() - 61_000).toISOString()
      })),
      set: jest.fn().mockResolvedValue('OK')
    };
    const { firestore } = firestoreWithDocument({
      status: 'blocked',
      billingStatus: 'suspended'
    });

    await expect(service.getGateState('driver-1', { redis, firestore })).resolves.toMatchObject({
      source: 'firestore',
      subscriptionStatus: 'blocked',
      billingStatus: 'suspended'
    });
    expect(redis.set).toHaveBeenCalled();
  });

  it('loads Firestore on cache miss and refreshes Redis with a bounded TTL', async () => {
    const service = new SubscriptionStateService();
    const redis = { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue('OK') };
    const { firestore } = firestoreWithDocument({
      status: 'active',
      billingStatus: 'active',
      pendingFeeCents: 0
    });

    await expect(service.getGateState('driver-1', { redis, firestore })).resolves.toMatchObject({
      source: 'firestore',
      subscriptionStatus: 'active',
      billingStatus: 'active'
    });
    expect(redis.set).toHaveBeenCalledWith(
      'subscription:online-gate:v1:driver-1',
      expect.any(String),
      'EX',
      60
    );
  });

  it('does not consult RTDB when the authoritative Firestore document exists', async () => {
    const service = new SubscriptionStateService();
    const realtimeDb = { ref: jest.fn() };
    const { firestore } = firestoreWithDocument({ status: 'active' });

    await expect(service.getState('driver-1', { db: realtimeDb, firestore })).resolves.toMatchObject({
      exists: true,
      source: 'firestore',
      subscription: { driverId: 'driver-1', status: 'active' },
      userData: {}
    });
    expect(realtimeDb.ref).not.toHaveBeenCalled();
  });

  it('rejects a cold cache miss when Firestore authority is unavailable', async () => {
    const service = new SubscriptionStateService();
    const redis = { get: jest.fn().mockResolvedValue(null) };
    const { firestore, docRef } = firestoreWithDocument({});
    docRef.get.mockRejectedValue(new Error('firestore unavailable'));

    await expect(service.getGateState('driver-1', { redis, firestore }))
      .rejects.toThrow('firestore unavailable');
  });

  it('does not let an RTDB user shadow override an existing Firestore subscription', async () => {
    const service = new SubscriptionStateService();
    jest.spyOn(service, 'getState').mockResolvedValue({
      source: 'firestore',
      subscription: { status: 'active' },
      userData: {
        billing_status: 'suspended',
        subscription_pending_fee_cents: 999
      }
    });

    await expect(service.getBillingData('driver-1')).resolves.toMatchObject({
      authorityAvailable: true,
      subscriptionStatus: 'active',
      billingStatus: 'active',
      pendingFeeCents: 0
    });
  });

  it('never falls back to an RTDB transaction when the Firestore transaction fails', async () => {
    const service = new SubscriptionStateService();
    jest.spyOn(service, 'getState').mockResolvedValue({
      source: 'firestore',
      subscription: { status: 'active' },
      userData: {}
    });
    const transaction = jest.fn();
    const db = { ref: jest.fn(() => ({ transaction })) };
    const { firestore } = firestoreWithDocument({ status: 'active' });
    firestore.runTransaction = jest.fn().mockRejectedValue(new Error('transaction unavailable'));

    await expect(service.runTransaction('driver-1', () => ({ status: 'blocked' }), { db, firestore }))
      .resolves.toEqual({ success: false, error: 'Falha na autoridade Firestore de assinatura' });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('keeps a committed Firestore update successful when the RTDB mirror fails', async () => {
    const service = new SubscriptionStateService();
    jest.spyOn(service, 'getState').mockResolvedValue({
      source: 'firestore',
      subscription: { status: 'active', createdAt: '2026-08-01T00:00:00.000Z' },
      userData: {}
    });
    jest.spyOn(service, 'writeGateCache').mockResolvedValue({});
    jest.spyOn(service, 'syncMirrors').mockRejectedValue(new Error('RTDB unavailable'));
    const { firestore } = firestoreWithDocument({ status: 'active' });
    firestore.runTransaction = jest.fn(async (callback) => callback({
      get: jest.fn().mockResolvedValue({
        exists: true,
        data: () => ({ status: 'active', createdAt: '2026-08-01T00:00:00.000Z' })
      }),
      set: jest.fn()
    }));

    await expect(service.runTransaction('driver-1', () => ({ status: 'blocked' }), { firestore }))
      .resolves.toMatchObject({
        success: true,
        subscription: { driverId: 'driver-1', status: 'blocked' },
        billingStatus: 'suspended'
      });
    expect(service.writeGateCache).toHaveBeenCalledWith(
      'driver-1',
      expect.objectContaining({ status: 'blocked' }),
      {},
      { authoritySource: 'firestore' }
    );
  });
});
