jest.mock('../../../services/rating-service', () => ({
  submitRating: jest.fn(),
  getTripRatings: jest.fn(),
  getUserRatings: jest.fn(),
  hasUserRatedTrip: jest.fn()
}));

jest.mock('../../../firebase-config', () => ({
  getFromRealtimeDB: jest.fn()
}));

const ratingService = require('../../../services/rating-service');
const registerSocketRatingHandler = require('../../../bootstrap/register-socket-rating-handler');

function createHarness(socketOverrides = {}) {
  const handlers = {};
  const socket = {
    id: 'socket_1',
    userId: 'passenger_1',
    userType: 'customer',
    on: jest.fn((event, handler) => {
      handlers[event] = handler;
    }),
    emit: jest.fn(),
    ...socketOverrides
  };
  const room = { emit: jest.fn() };
  const io = {
    activeBookings: new Map([
      ['ride_1', {
        bookingId: 'ride_1',
        customerId: 'passenger_1',
        driverId: 'driver_1',
        status: 'COMPLETED'
      }]
    ]),
    to: jest.fn(() => room)
  };

  registerSocketRatingHandler({
    socket,
    io,
    redisPool: null,
    logStructured: jest.fn()
  });

  return { handlers, io, room, socket };
}

describe('registerSocketRatingHandler scope guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    ratingService.submitRating.mockResolvedValue({
      success: true,
      ratingId: 'rating_1',
      rating: {
        tripId: 'ride_1',
        rating: 5,
        comment: 'ok',
        reviewerId: 'passenger_1',
        reviewerType: 'passenger',
        targetUserId: 'driver_1',
        createdAt: '2026-06-22T00:00:00.000Z'
      }
    });
    ratingService.getTripRatings.mockResolvedValue({ success: true, ratings: [] });
    ratingService.getUserRatings.mockResolvedValue({ success: true, ratings: [] });
    ratingService.hasUserRatedTrip.mockResolvedValue({ success: true, hasRated: false });
  });

  it('canonicalizes submitRating reviewer and target from the authenticated ride participant', async () => {
    const { handlers } = createHarness();

    await handlers.submitRating({
      tripId: 'ride_1',
      reviewerId: 'driver_1',
      userId: 'driver_1',
      reviewerType: 'driver',
      targetUserId: 'passenger_1',
      rating: 5
    });

    expect(ratingService.submitRating).toHaveBeenCalledWith(
      expect.objectContaining({
        tripId: 'ride_1',
        reviewerId: 'passenger_1',
        userId: 'passenger_1',
        reviewerType: 'passenger',
        userType: 'passenger',
        targetUserId: 'driver_1'
      }),
      expect.objectContaining({
        socketUserId: 'passenger_1',
        socketUserType: 'passenger',
        tripScope: expect.objectContaining({
          customerId: 'passenger_1',
          driverId: 'driver_1'
        })
      })
    );
  });

  it('returns idempotent rating replay metadata as a successful socket acknowledgement', async () => {
    ratingService.submitRating.mockResolvedValueOnce({
      success: true,
      ratingId: 'rating_existing',
      idempotentReplay: true,
      rating: {
        tripId: 'ride_1',
        rating: 4,
        comment: 'persisted',
        reviewerId: 'passenger_1',
        reviewerType: 'passenger',
        targetUserId: 'driver_1',
        createdAt: '2026-06-22T00:00:00.000Z'
      }
    });
    const { handlers, socket } = createHarness();

    await handlers.submitRating({
      tripId: 'ride_1',
      rating: 5
    });

    expect(socket.emit).toHaveBeenCalledWith(
      'ratingSubmitted',
      expect.objectContaining({
        success: true,
        idempotentReplay: true,
        ratingId: 'rating_existing',
        rating: 4,
        comment: 'persisted'
      })
    );
  });

  it('rejects submitRating from a socket user that is not a ride participant', async () => {
    const { handlers, socket } = createHarness({
      userId: 'intruder_1',
      userType: 'customer'
    });

    await handlers.submitRating({
      tripId: 'ride_1',
      rating: 1
    });

    expect(ratingService.submitRating).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith(
      'ratingError',
      expect.objectContaining({
        code: 'RIDE_SCOPE_DENIED'
      })
    );
  });

  it('blocks getUserRatings for another user unless the socket is support/admin', async () => {
    const { handlers, socket } = createHarness();

    await handlers.getUserRatings({
      targetUserId: 'driver_1'
    });

    expect(ratingService.getUserRatings).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith(
      'userRatings',
      expect.objectContaining({
        code: 'RATING_SCOPE_DENIED'
      })
    );
  });
});
