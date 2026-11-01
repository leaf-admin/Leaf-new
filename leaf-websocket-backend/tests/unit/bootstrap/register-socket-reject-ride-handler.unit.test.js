const registerSocketRejectRideHandler = require('../../../bootstrap/register-socket-reject-ride-handler');
const validationService = require('../../../services/validation-service');

function buildHarness() {
  const listeners = {};
  const socket = {
    id: 'socket-1',
    userId: 'driver-1',
    on: jest.fn((event, handler) => {
      listeners[event] = handler;
    }),
    emit: jest.fn()
  };
  const responseHandler = {
    handleRejectRide: jest.fn().mockResolvedValue({ success: true, message: 'ok' })
  };
  registerSocketRejectRideHandler({
    socket,
    rateLimiterService: { checkRateLimit: jest.fn().mockResolvedValue({ allowed: true }) },
    logStructured: jest.fn(),
    validationService,
    getSocketMetadata: jest.fn(() => ({})),
    auditService: { logRideAction: jest.fn().mockResolvedValue(undefined) },
    responseHandler
  });
  return { listeners, socket, responseHandler };
}

describe('registerSocketRejectRideHandler', () => {
  it('accepts the rideId sent by installed apps', async () => {
    const { listeners, socket } = buildHarness();

    await listeners.rejectRide({ rideId: 'booking-1', reason: 'Indisponível' });

    expect(socket.emit).not.toHaveBeenCalledWith(
      'rejectRideError',
      expect.objectContaining({ code: 'VALIDATION_ERROR' })
    );
  });

  it('still refuses a rejection without a ride', async () => {
    const { listeners, socket } = buildHarness();

    await listeners.rejectRide({ reason: 'Indisponível' });

    expect(socket.emit).toHaveBeenCalledWith(
      'rejectRideError',
      expect.objectContaining({ code: 'VALIDATION_ERROR' })
    );
  });
});
