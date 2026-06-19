const registerSocketCancelDriverSearchHandler = require('../../../bootstrap/register-socket-cancel-driver-search-handler');

describe('registerSocketCancelDriverSearchHandler', () => {
  let handlers;
  let socket;

  beforeEach(() => {
    handlers = {};
    socket = {
      id: 'socket_1',
      userId: 'customer_1',
      on: jest.fn((event, handler) => {
        handlers[event] = handler;
      }),
      emit: jest.fn()
    };

    registerSocketCancelDriverSearchHandler({
      socket,
      logStructured: jest.fn()
    });
  });

  it('does not acknowledge a fake cancellation without the canonical cancelRide flow', async () => {
    await handlers.cancelDriverSearch({
      bookingId: 'booking_1',
      reason: 'Cancelado pelo passageiro'
    });

    expect(socket.emit).toHaveBeenCalledWith('driverSearchCancelled', {
      success: false,
      bookingId: 'booking_1',
      reason: 'Cancelado pelo passageiro',
      code: 'CANONICAL_CANCEL_REQUIRED',
      error: 'Use cancelRide para encerrar a busca e reconciliar pagamento e estado'
    });
  });
});
