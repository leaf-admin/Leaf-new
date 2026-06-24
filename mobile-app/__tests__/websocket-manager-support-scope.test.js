jest.mock('@react-native-firebase/auth', () => () => ({
  currentUser: null,
}));

jest.mock('socket.io-client', () => jest.fn());

jest.mock('../src/utils/friendlyErrorMessages', () => ({
  toUserFriendlyError: jest.fn((payload, context = {}) => {
    const error = new Error(payload?.message || context?.fallbackMessage || 'Erro');
    if (payload?.code) {
      error.code = payload.code;
    }
    error.payload = payload;
    return error;
  }),
}));

jest.mock('../src/config/NetworkConfig', () => ({
  getApiURL: jest.fn(() => 'https://api.test'),
  getWebSocketURL: jest.fn(() => 'https://socket.test'),
}));

import WebSocketManager from '../src/services/WebSocketManager';

function createSocketMock() {
  const handlers = new Map();

  const addHandler = (eventName, callback) => {
    const eventHandlers = handlers.get(eventName) || new Set();
    eventHandlers.add(callback);
    handlers.set(eventName, eventHandlers);
  };

  const removeHandler = (eventName, callback) => {
    const eventHandlers = handlers.get(eventName);
    if (!eventHandlers) {
      return;
    }
    eventHandlers.delete(callback);
    if (eventHandlers.size === 0) {
      handlers.delete(eventName);
    }
  };

  return {
    connected: true,
    emit: jest.fn(),
    once: jest.fn(addHandler),
    off: jest.fn(removeHandler),
    trigger(eventName, payload) {
      const eventHandlers = Array.from(handlers.get(eventName) || []);
      handlers.delete(eventName);
      eventHandlers.forEach((callback) => callback(payload));
    },
  };
}

describe('WebSocketManager support scope', () => {
  beforeEach(() => {
    WebSocketManager.instance = null;
    jest.clearAllMocks();
  });

  it('sends booking scope with support tickets and rejects backend scope errors immediately', async () => {
    const manager = WebSocketManager.getInstance();
    const socket = createSocketMock();
    manager.socket = socket;

    const promise = manager.createSupportTicket(
      'trip',
      'N2',
      'Motorista nao encontrou o ponto.',
      [],
      {
        bookingId: 'booking_1',
        rideId: 'booking_1',
        tripId: 'booking_1',
        source: 'passenger-trip',
        bookingStatus: 'started',
      },
    );

    expect(socket.emit).toHaveBeenCalledWith(
      'createSupportTicket',
      expect.objectContaining({
        bookingId: 'booking_1',
        rideId: 'booking_1',
        tripId: 'booking_1',
        source: 'passenger-trip',
        bookingStatus: 'started',
      }),
    );

    socket.trigger('supportTicketError', {
      success: false,
      code: 'RIDE_SCOPE_DENIED',
      error: 'Booking fora do escopo do usuario.',
    });

    await expect(promise).rejects.toMatchObject({
      code: 'RIDE_SCOPE_DENIED',
    });
  });

  it('sends booking scope with incident reports and rejects backend scope errors immediately', async () => {
    const manager = WebSocketManager.getInstance();
    const socket = createSocketMock();
    manager.socket = socket;

    const promise = manager.reportIncident(
      'safety',
      'Relato de seguranca na corrida.',
      [],
      { lat: -22.88, lng: -43.33 },
      {
        bookingId: 'booking_2',
        rideId: 'booking_2',
        tripId: 'booking_2',
        source: 'driver-trip',
        bookingStatus: 'started',
      },
    );

    expect(socket.emit).toHaveBeenCalledWith(
      'reportIncident',
      expect.objectContaining({
        bookingId: 'booking_2',
        rideId: 'booking_2',
        tripId: 'booking_2',
        source: 'driver-trip',
        bookingStatus: 'started',
      }),
    );

    socket.trigger('incidentReportError', {
      success: false,
      code: 'RIDE_SCOPE_DENIED',
      error: 'Booking fora do escopo do usuario.',
    });

    await expect(promise).rejects.toMatchObject({
      code: 'RIDE_SCOPE_DENIED',
    });
  });

  it('rejects createChat immediately when backend denies the ride chat scope', async () => {
    const manager = WebSocketManager.getInstance();
    const socket = createSocketMock();
    manager.socket = socket;

    const promise = manager.createChat({
      bookingId: 'booking_3',
      tripId: 'booking_3',
      type: 'trip_chat',
    });

    expect(socket.emit).toHaveBeenCalledWith(
      'createChat',
      expect.objectContaining({
        bookingId: 'booking_3',
        tripId: 'booking_3',
      }),
    );

    socket.trigger('chatError', {
      success: false,
      code: 'CHAT_NOT_AVAILABLE_YET',
      error: 'Chat fica disponível após o motorista aceitar a corrida',
      bookingId: 'booking_3',
      chatId: 'booking_3',
    });

    await expect(promise).rejects.toMatchObject({
      code: 'CHAT_NOT_AVAILABLE_YET',
    });
  });

  it('rejects sendMessage immediately when backend reports a message error', async () => {
    const manager = WebSocketManager.getInstance();
    const socket = createSocketMock();
    manager.socket = socket;

    const promise = manager.sendMessage({
      chatId: 'booking_4',
      bookingId: 'booking_4',
      tripId: 'booking_4',
      message: 'Cheguei ao ponto.',
    });

    expect(socket.emit).toHaveBeenCalledWith(
      'sendMessage',
      expect.objectContaining({
        chatId: 'booking_4',
        bookingId: 'booking_4',
        message: 'Cheguei ao ponto.',
      }),
    );

    socket.trigger('messageError', {
      success: false,
      code: 'CHAT_PERSISTENCE_FAILED',
      error: 'Mensagem não persistida. Tente novamente.',
      bookingId: 'booking_4',
      chatId: 'booking_4',
    });

    await expect(promise).rejects.toMatchObject({
      code: 'CHAT_PERSISTENCE_FAILED',
    });
  });
});
