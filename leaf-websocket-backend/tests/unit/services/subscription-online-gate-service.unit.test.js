jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn()
}));
jest.mock('../../../services/subscription-state-service', () => ({
  getGateState: jest.fn()
}));

const fs = require('fs');
const path = require('path');

const {
  SubscriptionOnlineGateService
} = require('../../../services/subscription-online-gate-service');

describe('subscription-online-gate-service', () => {
  const originalGate = process.env.SUBSCRIPTION_ONLINE_GATE_ENABLED;
  const originalGrace = process.env.SUBSCRIPTION_BLOCK_ON_GRACE_EXPIRY;

  afterEach(() => {
    if (originalGate === undefined) delete process.env.SUBSCRIPTION_ONLINE_GATE_ENABLED;
    else process.env.SUBSCRIPTION_ONLINE_GATE_ENABLED = originalGate;
    if (originalGrace === undefined) delete process.env.SUBSCRIPTION_BLOCK_ON_GRACE_EXPIRY;
    else process.env.SUBSCRIPTION_BLOCK_ON_GRACE_EXPIRY = originalGrace;
  });

  it('keeps server wiring on the canonical service without an inline RTDB fallback', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../server.js'), 'utf8');
    const start = source.indexOf('async function enforceSubscriptionForOnline');
    const end = source.indexOf('async function enforceDailyKYCForOnline', start);
    const boundary = source.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(boundary).toContain('subscriptionOnlineGateService.enforce(driverId)');
    expect(boundary).not.toContain('getRealtimeDB');
    expect(boundary).not.toContain('fail-open');
  });

  it('allows an active Firestore-backed subscription', async () => {
    const stateService = {
      getGateState: jest.fn().mockResolvedValue({
        subscriptionStatus: 'active',
        billingStatus: 'active',
        pendingFeeCents: 0,
        source: 'firestore'
      })
    };
    const service = new SubscriptionOnlineGateService({ stateService });

    await expect(service.enforce('driver-1')).resolves.toMatchObject({
      allowed: true,
      code: 'subscriptionActive',
      details: { source: 'firestore' }
    });
  });

  it.each([
    { subscriptionStatus: 'blocked', billingStatus: 'active' },
    { subscriptionStatus: 'cancelled', billingStatus: 'active' },
    { subscriptionStatus: 'active', billingStatus: 'suspended' }
  ])('blocks commercial suspension state %#', async (state) => {
    const service = new SubscriptionOnlineGateService({
      stateService: {
        getGateState: jest.fn().mockResolvedValue({ ...state, source: 'redis_cache' })
      }
    });

    await expect(service.enforce('driver-1')).resolves.toMatchObject({
      allowed: false,
      code: 'subscriptionBlocked'
    });
  });

  it('blocks an expired grace period only when the approved flag is enabled', async () => {
    process.env.SUBSCRIPTION_BLOCK_ON_GRACE_EXPIRY = 'true';
    const service = new SubscriptionOnlineGateService({
      now: () => Date.parse('2026-08-02T12:00:00.000Z'),
      stateService: {
        getGateState: jest.fn().mockResolvedValue({
          subscriptionStatus: 'grace_period',
          billingStatus: 'overdue',
          gracePeriodEndsAt: '2026-08-01T12:00:00.000Z',
          source: 'firestore'
        })
      }
    });

    await expect(service.enforce('driver-1')).resolves.toMatchObject({
      allowed: false,
      code: 'subscriptionBlocked'
    });
  });

  it('fails closed when neither Firestore authority nor Redis cache is available', async () => {
    const service = new SubscriptionOnlineGateService({
      stateService: {
        getGateState: jest.fn().mockRejectedValue(new Error('Firestore unavailable'))
      }
    });

    await expect(service.enforce('driver-1')).resolves.toEqual({
      allowed: false,
      reason: 'Não foi possível validar a assinatura agora',
      code: 'subscriptionAuthorityUnavailable',
      retryable: true
    });
  });

  it('keeps the explicit commercial kill switch behavior', async () => {
    process.env.SUBSCRIPTION_ONLINE_GATE_ENABLED = 'false';
    const stateService = { getGateState: jest.fn() };
    const service = new SubscriptionOnlineGateService({ stateService });

    await expect(service.enforce('driver-1')).resolves.toMatchObject({
      allowed: true,
      code: 'subscriptionGateDisabled'
    });
    expect(stateService.getGateState).not.toHaveBeenCalled();
  });
});
