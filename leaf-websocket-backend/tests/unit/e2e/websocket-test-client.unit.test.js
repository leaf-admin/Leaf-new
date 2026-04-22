const { EventEmitter } = require('events');

const WebSocketTestClient = require('../../../tests/e2e/backend/__helpers__/websocket-test-client');

class FakeSocket extends EventEmitter {
  constructor() {
    super();
    this.id = 'socket_test';
    this.connected = true;
  }

  disconnect() {}
}

describe('websocket-test-client createBooking listener matching', () => {
  it('ignores unrelated bookingCreated events and resolves on the matching idempotency key', async () => {
    const client = new WebSocketTestClient('http://localhost:3001');
    const socket = new FakeSocket();
    client.socket = socket;
    client.userId = 'customer_123';
    client.getEvents = jest.fn(() => []);

    const requestPayload = {
      customerId: 'customer_123',
      idempotencyKey: 'request_match_key',
      pickupLocation: { lat: -22.9, lng: -43.1 },
      destinationLocation: { lat: -22.91, lng: -43.12 },
      paymentMethod: 'pix'
    };

    const promise = client.createBooking(requestPayload, {
      timeoutMs: 2000,
      lateEventGraceMs: 0
    });

    socket.emit('bookingCreated', {
      bookingId: 'booking_other',
      idempotencyKey: 'other_key'
    });

    setTimeout(() => {
      socket.emit('bookingCreated', {
        bookingId: 'booking_match',
        idempotencyKey: 'request_match_key'
      });
    }, 10);

    await expect(promise).resolves.toEqual(
      expect.objectContaining({
        bookingId: 'booking_match',
        idempotencyKey: 'request_match_key'
      })
    );
  });
});
