jest.mock('../../../firebase-config', () => ({
  getFromRealtimeDB: jest.fn()
}));
jest.mock('../../../services/sandbox-persistence-context', () => ({
  resolvePersistenceScope: jest.fn(() => ({
    namespace: 'operational',
    collections: { bookings: 'bookings' }
  })),
  resolveUserPersistenceScope: jest.fn().mockResolvedValue({
    namespace: 'operational',
    collections: { bookings: 'bookings' }
  }),
  assertStoredRecordMatchesScope: jest.fn()
}));

const firebaseConfig = require('../../../firebase-config');
const {
  resolveUserPersistenceScope,
  assertStoredRecordMatchesScope
} = require('../../../services/sandbox-persistence-context');
const {
  assertRideParticipant,
  normalizeSocketTextMessage,
  resolveSupportChatAuthorization
} = require('../../../services/socket-scope-guard');

describe('socket-scope-guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resolveUserPersistenceScope.mockResolvedValue({
      namespace: 'operational',
      collections: { bookings: 'bookings' }
    });
  });

  it('allows only real ride participants from the authenticated socket identity', async () => {
    const io = {
      activeBookings: new Map([
        ['ride_1', {
          bookingId: 'ride_1',
          customerId: 'passenger_1',
          driverId: 'driver_1',
          status: 'ACCEPTED'
        }]
      ])
    };

    const allowed = await assertRideParticipant({
      socket: { userId: 'passenger_1', userType: 'customer' },
      io,
      bookingId: 'ride_1'
    });
    const denied = await assertRideParticipant({
      socket: { userId: 'passenger_2', userType: 'customer' },
      io,
      bookingId: 'ride_1'
    });

    expect(allowed).toMatchObject({
      allowed: true,
      participantRole: 'passenger'
    });
    expect(denied).toMatchObject({
      allowed: false,
      code: 'RIDE_SCOPE_DENIED'
    });
  });

  it('falls back to realtime booking data when memory and redis do not have the ride', async () => {
    firebaseConfig.getFromRealtimeDB.mockResolvedValueOnce({
      customerId: 'passenger_1',
      driverId: 'driver_1',
      status: 'COMPLETED'
    });

    const result = await assertRideParticipant({
      socket: { userId: 'driver_1', userType: 'driver' },
      io: { activeBookings: new Map() },
      bookingId: 'ride_2'
    });

    expect(firebaseConfig.getFromRealtimeDB).toHaveBeenCalledWith('bookings/ride_2');
    expect(result).toMatchObject({
      allowed: true,
      participantRole: 'driver',
      scope: expect.objectContaining({
        source: 'realtime_db'
      })
    });
  });

  it('uses only the sandbox booking root for a sandbox participant terminal fallback', async () => {
    const sandboxScope = {
      namespace: 'sandbox',
      collections: { bookings: 'sandbox_bookings' },
      financialContext: { namespace: 'sandbox', contextId: 'ctx_sandbox' }
    };
    resolveUserPersistenceScope.mockResolvedValueOnce(sandboxScope);
    firebaseConfig.getFromRealtimeDB.mockImplementation(async (path) => (
      path === 'sandbox_bookings/ride_sandbox_terminal'
        ? {
          customerId: 'passenger_sandbox',
          driverId: 'driver_sandbox',
          status: 'COMPLETED',
          financialContext: sandboxScope.financialContext
        }
        : null
    ));

    const result = await assertRideParticipant({
      socket: { userId: 'passenger_sandbox', userType: 'customer' },
      io: { activeBookings: new Map() },
      bookingId: 'ride_sandbox_terminal',
      preferPersistentTerminal: true
    });

    expect(result).toMatchObject({
      allowed: true,
      participantRole: 'passenger',
      scope: expect.objectContaining({
        source: 'realtime_db',
        persistenceScope: sandboxScope
      })
    });
    expect(firebaseConfig.getFromRealtimeDB).toHaveBeenCalledTimes(1);
    expect(firebaseConfig.getFromRealtimeDB).toHaveBeenCalledWith(
      'sandbox_bookings/ride_sandbox_terminal'
    );
    expect(firebaseConfig.getFromRealtimeDB).not.toHaveBeenCalledWith(
      'bookings/ride_sandbox_terminal'
    );
    expect(assertStoredRecordMatchesScope).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'COMPLETED' }),
      sandboxScope
    );
  });

  it('rejects an operational in-memory poison record for a sandbox actor', async () => {
    const sandboxScope = {
      namespace: 'sandbox',
      collections: { bookings: 'sandbox_bookings' },
      financialContext: { namespace: 'sandbox', contextId: 'ctx_sandbox' }
    };
    resolveUserPersistenceScope.mockResolvedValueOnce(sandboxScope);
    assertStoredRecordMatchesScope.mockImplementationOnce(() => {
      const error = new Error('Registro sandbox sem contexto financeiro válido');
      error.code = 'SANDBOX_RECORD_CONTEXT_INVALID';
      throw error;
    });

    const result = await assertRideParticipant({
      socket: { userId: 'passenger_sandbox', userType: 'customer' },
      io: {
        activeBookings: new Map([[
          'ride_poison',
          {
            bookingId: 'ride_poison',
            customerId: 'passenger_sandbox',
            driverId: 'driver_operational',
            status: 'IN_PROGRESS'
          }
        ]])
      },
      bookingId: 'ride_poison'
    });

    expect(result).toMatchObject({
      allowed: false,
      code: 'SANDBOX_RECORD_CONTEXT_INVALID'
    });
    expect(firebaseConfig.getFromRealtimeDB).not.toHaveBeenCalled();
  });

  it('prefers a terminal persistent scope over stale in-memory scope when requested', async () => {
    const redis = {
      hgetall: jest.fn().mockResolvedValue({
        bookingId: 'ride_completed_1',
        customerId: 'passenger_1',
        driverId: 'driver_1',
        status: 'COMPLETED'
      })
    };
    const io = {
      activeBookings: new Map([
        ['ride_completed_1', {
          bookingId: 'ride_completed_1',
          customerId: 'passenger_1',
          driverId: 'driver_1',
          status: 'IN_PROGRESS'
        }]
      ])
    };

    const result = await assertRideParticipant({
      socket: { userId: 'passenger_1', userType: 'customer' },
      io,
      redisPool: { getConnection: () => redis },
      bookingId: 'ride_completed_1',
      preferPersistentTerminal: true
    });

    expect(redis.hgetall).toHaveBeenCalledWith('booking:ride_completed_1');
    expect(result).toMatchObject({
      allowed: true,
      participantRole: 'passenger',
      scope: expect.objectContaining({
        source: 'redis',
        status: 'COMPLETED'
      })
    });
  });

  it('does not let a normal support chat user target another user id', () => {
    const result = resolveSupportChatAuthorization(
      { userId: 'user_1', userType: 'passenger' },
      { userId: 'user_2', message: 'oi' }
    );

    expect(result).toMatchObject({
      allowed: false,
      code: 'SUPPORT_SCOPE_DENIED'
    });
  });

  it('allows support actors to target a user chat as agent', () => {
    const result = resolveSupportChatAuthorization(
      { userId: 'agent_1', userRole: 'support' },
      { userId: 'user_2', senderType: 'user', message: 'oi' }
    );

    expect(result).toMatchObject({
      allowed: true,
      userId: 'user_2',
      senderType: 'agent'
    });
  });

  it('normalizes socket text messages without accepting empty or oversized payloads', () => {
    expect(normalizeSocketTextMessage('  oi  ')).toEqual({
      valid: true,
      code: null,
      error: null,
      text: 'oi'
    });
    expect(normalizeSocketTextMessage('   ')).toMatchObject({
      valid: false,
      code: 'MESSAGE_REQUIRED'
    });
    expect(normalizeSocketTextMessage('abcd', { maxLength: 3 })).toMatchObject({
      valid: false,
      code: 'MESSAGE_TOO_LONG'
    });
  });
});
