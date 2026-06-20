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
  it('does not broadcast rideAccepted globally when accepting through legacy driverResponse', async () => {
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
});
