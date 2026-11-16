jest.unmock('express');

const express = require('express');
const request = require('supertest');

const mockHoldService = {
  HOLD_STATUS: { AWAITING_PASSENGER: 'awaiting_passenger' },
  listHolds: jest.fn(),
  recordPassengerAnswer: jest.fn(),
  toPublicView: jest.fn((hold) => ({ bookingId: hold.bookingId }))
};

jest.mock('../../../middleware/firebase-user-auth', () => ({
  requireFirebaseUser: (req, _res, next) => {
    req.authenticatedUser = { uid: 'customer-1' };
    next();
  }
}));
jest.mock('../../../services/payout-hold-service', () => mockHoldService);
jest.mock('../../../utils/redis-pool', () => ({
  ensureConnection: jest.fn().mockResolvedValue(undefined),
  getConnection: jest.fn(() => ({}))
}));
jest.mock('../../../utils/logger', () => ({ logError: jest.fn(), logStructured: jest.fn() }));

const routes = require('../../../routes/ride-confirmations');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/', routes);
  return app;
}

describe('ride confirmation routes', () => {
  beforeEach(() => jest.clearAllMocks());

  it('lists only the caller pending confirmations', async () => {
    mockHoldService.listHolds.mockResolvedValue([
      { bookingId: 'b1', customerId: 'customer-1', status: 'awaiting_passenger' },
      { bookingId: 'b2', customerId: 'customer-2', status: 'awaiting_passenger' },
      { bookingId: 'b3', customerId: 'customer-1', status: 'in_review' }
    ]);

    const response = await request(createApp()).get('/api/rides/confirmations/pending');

    expect(response.status).toBe(200);
    expect(response.body.pending).toEqual([{ bookingId: 'b1' }]);
  });

  it('records the answer for the authenticated passenger', async () => {
    mockHoldService.recordPassengerAnswer.mockResolvedValue({ ok: true, hold: {} });

    const response = await request(createApp()).post('/api/rides/b1/confirmation').send({ tookRide: true });

    expect(response.status).toBe(200);
    expect(mockHoldService.recordPassengerAnswer).toHaveBeenCalledWith({}, {
      bookingId: 'b1',
      customerId: 'customer-1',
      tookRide: true
    });
  });

  it('rejects a missing answer and hides rides of other passengers', async () => {
    const missing = await request(createApp()).post('/api/rides/b1/confirmation').send({});
    expect(missing.status).toBe(400);

    mockHoldService.recordPassengerAnswer.mockResolvedValue({ ok: false, code: 'HOLD_CUSTOMER_MISMATCH' });
    const other = await request(createApp()).post('/api/rides/b2/confirmation').send({ tookRide: false });
    expect(other.status).toBe(404);
  });
});
