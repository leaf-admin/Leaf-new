const registerSocketDriverResponseHandler = require('../../../bootstrap/register-socket-driver-response-handler');

function createHarness(activeBooking = null) {
  const handlers = {};
  const socket = {
    id: 'socket_driver_1',
    userId: 'driver_1',
    on: jest.fn((eventName, handler) => {
      handlers[eventName] = handler;
    }),
    emit: jest.fn()
  };
  const room = { emit: jest.fn() };
  const io = {
    activeBookings: new Map(activeBooking ? [[activeBooking.bookingId, activeBooking]] : []),
    emit: jest.fn(),
    to: jest.fn(() => room)
  };
  const logStructured = jest.fn();

  registerSocketDriverResponseHandler({ socket, io, logStructured });

  return { handlers, io, logStructured, room, socket };
}

describe('registerSocketDriverResponseHandler', () => {
  const originalLegacyAcceptFlag = process.env.ENABLE_LEGACY_DRIVER_RESPONSE_ACCEPT;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    delete process.env.ENABLE_LEGACY_DRIVER_RESPONSE_ACCEPT;
  });

  afterAll(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalLegacyAcceptFlag === undefined) {
      delete process.env.ENABLE_LEGACY_DRIVER_RESPONSE_ACCEPT;
    } else {
      process.env.ENABLE_LEGACY_DRIVER_RESPONSE_ACCEPT = originalLegacyAcceptFlag;
    }
  });

  it('cannot be reopened in production by environment drift', async () => {
    process.env.NODE_ENV = 'production';
    process.env.ENABLE_LEGACY_DRIVER_RESPONSE_ACCEPT = 'true';
    const { handlers, io, room, socket } = createHarness({
      bookingId: 'booking_production',
      customerId: 'customer_production',
      status: 'SEARCHING'
    });

    await handlers.driverResponse({ bookingId: 'booking_production', accepted: true });

    expect(io.to).not.toHaveBeenCalled();
    expect(room.emit).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith(
      'driverResponseError',
      expect.objectContaining({ code: 'LEGACY_DRIVER_RESPONSE_ACCEPT_DISABLED' })
    );
  });

  it('blocks legacy acceptance by default and directs clients to acceptRide', async () => {
    const { handlers, io, room, socket } = createHarness({
      bookingId: 'booking_disabled',
      customerId: 'customer_disabled',
      status: 'SEARCHING'
    });

    await handlers.driverResponse({ bookingId: 'booking_disabled', accepted: true });

    expect(io.emit).not.toHaveBeenCalled();
    expect(io.to).not.toHaveBeenCalled();
    expect(room.emit).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith('driverResponseError', {
      code: 'LEGACY_DRIVER_RESPONSE_ACCEPT_DISABLED',
      error: 'Aceite legado desabilitado; use o fluxo acceptRide',
      bookingId: 'booking_disabled'
    });
  });

  it('does not broadcast rideAccepted globally when accepting through legacy driverResponse', async () => {
    process.env.ENABLE_LEGACY_DRIVER_RESPONSE_ACCEPT = 'true';
    const { handlers, io, room, socket } = createHarness({
      bookingId: 'booking_1',
      customerId: 'customer_1',
      status: 'SEARCHING'
    });

    await handlers.driverResponse({ bookingId: 'booking_1', accepted: true });

    expect(io.emit).not.toHaveBeenCalled();
    expect(io.to).toHaveBeenCalledWith('customer_customer_1');
    expect(room.emit).toHaveBeenCalledWith(
      'rideAccepted',
      expect.objectContaining({
        bookingId: 'booking_1',
        driverId: 'driver_1',
        success: true
      })
    );
    expect(socket.emit).toHaveBeenCalledWith(
      'rideAccepted',
      expect.objectContaining({
        bookingId: 'booking_1',
        driverId: 'driver_1',
        success: true
      })
    );
  });

  it('blocks passenger fan-out when the booking owner cannot be resolved', async () => {
    process.env.ENABLE_LEGACY_DRIVER_RESPONSE_ACCEPT = 'true';
    const { handlers, io, room, socket } = createHarness();

    await handlers.driverResponse({ bookingId: 'booking_2', accepted: true });

    expect(io.emit).not.toHaveBeenCalled();
    expect(io.to).not.toHaveBeenCalled();
    expect(room.emit).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith(
      'rideAccepted',
      expect.objectContaining({
        bookingId: 'booking_2',
        success: true
      })
    );
  });

  it('rejects legacy acceptance when the active booking is terminal', async () => {
    process.env.ENABLE_LEGACY_DRIVER_RESPONSE_ACCEPT = 'true';
    const { handlers, io, room, socket } = createHarness({
      bookingId: 'booking_3',
      customerId: 'customer_3',
      status: 'COMPLETED'
    });

    await handlers.driverResponse({ bookingId: 'booking_3', accepted: true });

    expect(io.emit).not.toHaveBeenCalled();
    expect(io.to).not.toHaveBeenCalled();
    expect(room.emit).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith(
      'driverResponseError',
      expect.objectContaining({
        bookingId: 'booking_3',
        error: 'Corrida já encerrada'
      })
    );
  });

  it('keeps the legacy rejection path available while acceptance is disabled', async () => {
    const { handlers, io, room, socket } = createHarness({
      bookingId: 'booking_rejected',
      customerId: 'customer_rejected',
      status: 'SEARCHING'
    });

    await handlers.driverResponse({
      bookingId: 'booking_rejected',
      accepted: false,
      reason: 'Fora da rota'
    });

    expect(io.emit).not.toHaveBeenCalled();
    expect(io.to).not.toHaveBeenCalled();
    expect(room.emit).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith('rideRejected', {
      success: true,
      bookingId: 'booking_rejected',
      message: 'Corrida recusada',
      reason: 'Fora da rota'
    });
  });
});
