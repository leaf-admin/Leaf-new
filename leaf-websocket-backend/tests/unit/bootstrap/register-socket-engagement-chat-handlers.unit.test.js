jest.mock('../../../services/chat-persistence-service', () => ({
  saveMessage: jest.fn(),
  getMessages: jest.fn(),
  markMessageAsRead: jest.fn()
}));

jest.mock('../../../firebase-config', () => ({
  getFromRealtimeDB: jest.fn()
}));

const chatPersistenceService = require('../../../services/chat-persistence-service');
const registerSocketEngagementChatHandlers = require('../../../bootstrap/register-socket-engagement-chat-handlers');

function createHarness({
  socketUserId = 'passenger_1',
  socketUserType = 'customer',
  bookingStatus = 'ACCEPTED'
} = {}) {
  const handlers = {};
  const socket = {
    id: 'socket_1',
    userId: socketUserId,
    userType: socketUserType,
    on: jest.fn((event, handler) => {
      handlers[event] = handler;
    }),
    emit: jest.fn()
  };
  const receiverSocket = { emit: jest.fn() };
  const io = {
    activeBookings: new Map([
      ['ride_1', {
        bookingId: 'ride_1',
        customerId: 'passenger_1',
        driverId: 'driver_1',
        status: bookingStatus
      }]
    ]),
    connectedUsers: new Map([
      ['driver_1', receiverSocket],
      ['passenger_1', receiverSocket]
    ])
  };
  const rateLimiterService = {
    checkRateLimit: jest.fn(async () => ({
      allowed: true,
      limit: 60,
      remaining: 59,
      resetAt: Date.now() + 1000
    }))
  };

  registerSocketEngagementChatHandlers({
    socket,
    io,
    logStructured: jest.fn(),
    rateLimiterService,
    redisPool: null
  });

  return { handlers, io, rateLimiterService, receiverSocket, socket };
}

describe('registerSocketEngagementChatHandlers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    chatPersistenceService.saveMessage.mockResolvedValue({ success: true });
    chatPersistenceService.getMessages.mockResolvedValue({ success: true, messages: [] });
    chatPersistenceService.markMessageAsRead.mockResolvedValue({ success: true });
  });

  it('uses the authenticated socket identity instead of spoofed chat sender fields', async () => {
    const { handlers, receiverSocket, socket } = createHarness();

    await handlers.sendMessage({
      bookingId: 'ride_1',
      senderId: 'driver_1',
      receiverId: 'passenger_999',
      senderType: 'driver',
      message: '  Cheguei  '
    });

    expect(chatPersistenceService.saveMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: 'ride_1',
        rideId: 'ride_1',
        senderId: 'passenger_1',
        receiverId: 'driver_1',
        senderType: 'passenger',
        message: 'Cheguei'
      })
    );
    expect(socket.emit).toHaveBeenCalledWith(
      'messageSent',
      expect.objectContaining({
        senderId: 'passenger_1',
        senderType: 'passenger'
      })
    );
    expect(receiverSocket.emit).toHaveBeenCalledWith(
      'newMessage',
      expect.objectContaining({
        senderId: 'passenger_1',
        senderType: 'passenger'
      })
    );
  });

  it('rejects empty ride chat messages before persistence or delivery', async () => {
    const { handlers, receiverSocket, socket } = createHarness();

    await handlers.sendMessage({
      bookingId: 'ride_1',
      message: '   '
    });

    expect(chatPersistenceService.saveMessage).not.toHaveBeenCalled();
    expect(receiverSocket.emit).not.toHaveBeenCalledWith('newMessage', expect.any(Object));
    expect(socket.emit).toHaveBeenCalledWith(
      'messageError',
      expect.objectContaining({
        code: 'MESSAGE_REQUIRED',
        bookingId: 'ride_1',
        chatId: 'ride_1'
      })
    );
  });

  it('rejects oversized ride chat messages before persistence or delivery', async () => {
    const { handlers, receiverSocket, socket } = createHarness();

    await handlers.sendMessage({
      bookingId: 'ride_1',
      message: 'x'.repeat(2001)
    });

    expect(chatPersistenceService.saveMessage).not.toHaveBeenCalled();
    expect(receiverSocket.emit).not.toHaveBeenCalledWith('newMessage', expect.any(Object));
    expect(socket.emit).toHaveBeenCalledWith(
      'messageError',
      expect.objectContaining({
        code: 'MESSAGE_TOO_LONG',
        bookingId: 'ride_1',
        chatId: 'ride_1'
      })
    );
  });

  it('persists and delivers active-ride chat sent by the authenticated driver', async () => {
    const { handlers, receiverSocket, socket } = createHarness({
      socketUserId: 'driver_1',
      socketUserType: 'driver',
      bookingStatus: 'STARTED'
    });

    await handlers.sendMessage({
      bookingId: 'ride_1',
      senderId: 'passenger_1',
      receiverId: 'driver_999',
      senderType: 'passenger',
      message: 'Estou seguindo pela rota'
    });

    expect(chatPersistenceService.saveMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: 'ride_1',
        rideId: 'ride_1',
        senderId: 'driver_1',
        receiverId: 'passenger_1',
        senderType: 'driver',
        message: 'Estou seguindo pela rota'
      })
    );
    expect(socket.emit).toHaveBeenCalledWith(
      'messageSent',
      expect.objectContaining({
        senderId: 'driver_1',
        senderType: 'driver'
      })
    );
    expect(receiverSocket.emit).toHaveBeenCalledWith(
      'newMessage',
      expect.objectContaining({
        senderId: 'driver_1',
        senderType: 'driver'
      })
    );
  });

  it('namespaces a retried client message id by conversation and authenticated sender', async () => {
    const passenger = createHarness();
    const driver = createHarness({
      socketUserId: 'driver_1',
      socketUserType: 'driver',
      bookingStatus: 'STARTED'
    });

    await passenger.handlers.sendMessage({
      bookingId: 'ride_1',
      clientMessageId: 'retry_1',
      message: 'Mensagem do passageiro'
    });
    await driver.handlers.sendMessage({
      bookingId: 'ride_1',
      clientMessageId: 'retry_1',
      message: 'Mensagem do motorista'
    });

    const [passengerPayload, driverPayload] = chatPersistenceService.saveMessage.mock.calls.map(
      ([payload]) => payload,
    );
    expect(passengerPayload.messageId).toMatch(/^msg_[a-f0-9]{40}$/);
    expect(driverPayload.messageId).toMatch(/^msg_[a-f0-9]{40}$/);
    expect(passengerPayload.messageId).not.toBe(driverPayload.messageId);
  });

  it('blocks chat from a socket user that is not a ride participant', async () => {
    const { handlers, socket } = createHarness({
      socketUserId: 'intruder_1',
      socketUserType: 'customer'
    });

    await handlers.sendMessage({
      bookingId: 'ride_1',
      message: 'oi'
    });

    expect(chatPersistenceService.saveMessage).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith(
      'messageError',
      expect.objectContaining({
        code: 'RIDE_SCOPE_DENIED'
      })
    );
  });

  it('does not acknowledge or deliver chat when persistence fails', async () => {
    chatPersistenceService.saveMessage.mockResolvedValue({
      success: false,
      error: 'firestore_unavailable'
    });
    const { handlers, receiverSocket, socket } = createHarness();

    await handlers.sendMessage({
      bookingId: 'ride_1',
      message: 'Cheguei'
    });

    expect(socket.emit).toHaveBeenCalledWith(
      'messageError',
      expect.objectContaining({
        code: 'CHAT_PERSISTENCE_FAILED',
        bookingId: 'ride_1'
      })
    );
    expect(socket.emit).not.toHaveBeenCalledWith('messageSent', expect.any(Object));
    expect(receiverSocket.emit).not.toHaveBeenCalledWith('newMessage', expect.any(Object));
  });

  it('loads persisted messages through the canonical handler for an authenticated participant', async () => {
    chatPersistenceService.getMessages.mockResolvedValue({
      success: true,
      messages: [
        { messageId: 'message_2', senderId: 'driver_1', receiverId: 'passenger_1', message: 'Cheguei' },
        { messageId: 'message_1', senderId: 'passenger_1', receiverId: 'driver_1', message: 'Estou aqui' }
      ]
    });
    const { handlers, socket } = createHarness();

    await handlers.load_messages({ chatId: 'ride_1', page: 0, limit: 20 });

    expect(chatPersistenceService.getMessages).toHaveBeenCalledWith('ride_1', 20);
    expect(socket.emit).toHaveBeenCalledWith(
      'messages_loaded',
      expect.objectContaining({
        success: true,
        chatId: 'ride_1',
        messages: expect.arrayContaining([
          expect.objectContaining({ messageId: 'message_2' })
        ])
      })
    );
  });

  it('refuses chat history to a user outside the ride scope', async () => {
    const { handlers, socket } = createHarness({ socketUserId: 'intruder_1' });

    await handlers.load_messages({ chatId: 'ride_1' });

    expect(chatPersistenceService.getMessages).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith(
      'messages_loaded',
      expect.objectContaining({ code: 'RIDE_SCOPE_DENIED' })
    );
  });

  it('marks only messages addressed to the authenticated ride participant as read', async () => {
    chatPersistenceService.getMessages.mockResolvedValue({
      success: true,
      messages: [
        { messageId: 'to_passenger', senderId: 'driver_1', receiverId: 'passenger_1' },
        { messageId: 'from_passenger', senderId: 'passenger_1', receiverId: 'driver_1' }
      ]
    });
    const { handlers, socket } = createHarness();

    await handlers.mark_messages_read({
      chatId: 'ride_1',
      messageIds: ['to_passenger', 'from_passenger']
    });

    expect(chatPersistenceService.markMessageAsRead).toHaveBeenCalledTimes(1);
    expect(chatPersistenceService.markMessageAsRead).toHaveBeenCalledWith('to_passenger');
    expect(socket.emit).toHaveBeenCalledWith(
      'messages_marked_read',
      expect.objectContaining({ markedCount: 1, messageIds: ['to_passenger'] })
    );
  });
});
