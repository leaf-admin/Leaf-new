jest.mock('../../../firebase-config', () => ({
  getFromRealtimeDB: jest.fn()
}));

const firebaseConfig = require('../../../firebase-config');
const {
  assertRideParticipant,
  normalizeSocketTextMessage,
  resolveSupportChatAuthorization
} = require('../../../services/socket-scope-guard');

describe('socket-scope-guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
