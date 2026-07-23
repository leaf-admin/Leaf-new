jest.mock('../../../services/chat-persistence-service', () => ({
  saveMessage: jest.fn(),
  getMessages: jest.fn(),
  markMessageAsRead: jest.fn()
}));

jest.mock('../../../firebase-config', () => ({
  getFromRealtimeDB: jest.fn()
}));

jest.mock('../../../services/payment-runtime-profile-service', () => ({
  resolveProfile: jest.fn()
}));

const chatPersistenceService = require('../../../services/chat-persistence-service');
const paymentRuntimeProfileService = require('../../../services/payment-runtime-profile-service');
const registerSocketEngagementChatHandlers = require('../../../bootstrap/register-socket-engagement-chat-handlers');
const { sealFinancialContext } = require('../../../services/financial-runtime-context');

function createHarness({
  socketUserId = 'passenger_1',
  socketUserType = 'customer',
  socketUserPermissions = [],
  bookingStatus = 'ACCEPTED',
  persistedBookingStatus = null,
  bookingOverrides = {}
} = {}) {
  const handlers = {};
  const socket = {
    id: 'socket_1',
    userId: socketUserId,
    userType: socketUserType,
    userPermissions: socketUserPermissions,
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
        status: bookingStatus,
        ...bookingOverrides
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
  const redis = persistedBookingStatus
    ? {
        hgetall: jest.fn(async (key) => (
          key === 'booking:ride_1'
            ? {
                bookingId: 'ride_1',
                customerId: 'passenger_1',
                driverId: 'driver_1',
                status: persistedBookingStatus,
                ...bookingOverrides
              }
            : {}
        )),
        hget: jest.fn(async () => null),
        get: jest.fn(async () => null),
        setex: jest.fn(async () => 'OK')
      }
    : null;
  const redisPool = redis
    ? { getConnection: jest.fn(() => redis) }
    : null;

  registerSocketEngagementChatHandlers({
    socket,
    io,
    logStructured: jest.fn(),
    rateLimiterService,
    redisPool
  });

  return { handlers, io, rateLimiterService, receiverSocket, redis, socket };
}

describe('registerSocketEngagementChatHandlers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    chatPersistenceService.saveMessage.mockResolvedValue({ success: true });
    chatPersistenceService.getMessages.mockResolvedValue({ success: true, messages: [] });
    chatPersistenceService.markMessageAsRead.mockResolvedValue({ success: true });
    paymentRuntimeProfileService.resolveProfile.mockResolvedValue({
      profileId: 'env-default',
      environment: 'production',
      source: 'env',
      testUserSandbox: false
    });
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

  it.each(['EARLY_ENDED_BY_RIDER', 'INTERRUPTED_OPERATIONAL_ENDED'])(
    'blocks create, send and history for terminal status %s',
    async (bookingStatus) => {
      const { handlers, socket } = createHarness({ bookingStatus });

      await handlers.createChat({ bookingId: 'ride_1' });
      await handlers.sendMessage({ bookingId: 'ride_1', message: 'Ainda está aberto?' });
      await handlers.load_messages({ chatId: 'ride_1' });

      expect(chatPersistenceService.saveMessage).not.toHaveBeenCalled();
      expect(chatPersistenceService.getMessages).not.toHaveBeenCalled();
      expect(socket.emit).toHaveBeenCalledWith(
        'chatError',
        expect.objectContaining({ code: 'CHAT_POST_TRIP_BLOCKED' })
      );
      expect(socket.emit).toHaveBeenCalledWith(
        'messageError',
        expect.objectContaining({ code: 'CHAT_POST_TRIP_BLOCKED' })
      );
      expect(socket.emit).toHaveBeenCalledWith(
        'messages_loaded',
        expect.objectContaining({ code: 'CHAT_POST_TRIP_BLOCKED' })
      );
    }
  );

  it('prefers a persistent terminal status over stale active-memory chat state', async () => {
    const { handlers, redis, socket } = createHarness({
      bookingStatus: 'ACCEPTED',
      persistedBookingStatus: 'EARLY_ENDED_BY_RIDER'
    });

    await handlers.sendMessage({ bookingId: 'ride_1', message: 'Mensagem tardia' });

    expect(redis.hgetall).toHaveBeenCalledWith('booking:ride_1');
    expect(chatPersistenceService.saveMessage).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith(
      'messageError',
      expect.objectContaining({ code: 'CHAT_POST_TRIP_BLOCKED' })
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

    expect(chatPersistenceService.getMessages).toHaveBeenCalledWith(
      'ride_1',
      20,
      expect.objectContaining({ namespace: 'operational' })
    );
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
    expect(chatPersistenceService.markMessageAsRead).toHaveBeenCalledWith(
      'to_passenger',
      expect.objectContaining({ namespace: 'operational' })
    );
    expect(socket.emit).toHaveBeenCalledWith(
      'messages_marked_read',
      expect.objectContaining({ markedCount: 1, messageIds: ['to_passenger'] })
    );
  });

  it('uses one authoritative sandbox context for both ride participants', async () => {
    paymentRuntimeProfileService.resolveProfile.mockResolvedValue({
      profileId: 'qa-test-users-sandbox-durable',
      environment: 'sandbox',
      source: 'firestore',
      testUserSandbox: true
    });
    const financialContext = sealFinancialContext({
      providerEnvironment: 'sandbox',
      paymentProfileId: 'qa-test-users-sandbox-durable',
      paymentProfileSource: 'firestore',
      testUserSandbox: true
    });
    const bookingOverrides = {
      financialContext,
      financialNamespace: 'sandbox',
      financialContextId: financialContext.contextId,
      providerEnvironment: 'sandbox',
      paymentProfileId: financialContext.paymentProfileId
    };
    const passenger = createHarness({ bookingOverrides });
    const driver = createHarness({
      socketUserId: 'driver_1',
      socketUserType: 'driver',
      bookingStatus: 'STARTED',
      bookingOverrides
    });

    await passenger.handlers.sendMessage({ bookingId: 'ride_1', message: 'Estou no embarque' });
    await driver.handlers.sendMessage({ bookingId: 'ride_1', message: 'Estou chegando' });

    const [passengerPayload, driverPayload] = chatPersistenceService.saveMessage.mock.calls.map(
      ([payload]) => payload
    );
    expect(passengerPayload).toMatchObject({
      financialNamespace: 'sandbox',
      financialContextId: financialContext.contextId
    });
    expect(driverPayload).toMatchObject({
      financialNamespace: 'sandbox',
      financialContextId: financialContext.contextId
    });
    expect(driverPayload.financialContext).toEqual(passengerPayload.financialContext);
  });

  it('blocks the first sandbox message when the other ride participant diverges', async () => {
    const financialContext = sealFinancialContext({
      providerEnvironment: 'sandbox',
      paymentProfileId: 'qa-test-users-sandbox-durable',
      paymentProfileSource: 'firestore',
      testUserSandbox: true
    });
    paymentRuntimeProfileService.resolveProfile.mockImplementation(async ({ userId }) => (
      userId === 'driver_1'
        ? {
            profileId: 'env-default',
            environment: 'production',
            source: 'env',
            testUserSandbox: false
          }
        : {
            profileId: 'qa-test-users-sandbox-durable',
            environment: 'sandbox',
            source: 'firestore',
            testUserSandbox: true
          }
    ));
    const { handlers, socket } = createHarness({
      bookingOverrides: {
        financialContext,
        financialNamespace: 'sandbox',
        financialContextId: financialContext.contextId,
        providerEnvironment: 'sandbox'
      }
    });

    await handlers.sendMessage({ bookingId: 'ride_1', message: 'Não deve persistir' });

    expect(chatPersistenceService.saveMessage).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith(
      'messageError',
      expect.objectContaining({ code: 'SANDBOX_PARTICIPANT_CONTEXT_MISMATCH' })
    );
  });

  it('blocks QA sandbox users when the booking lost its entire financial envelope', async () => {
    paymentRuntimeProfileService.resolveProfile.mockResolvedValue({
      profileId: 'qa-test-users-sandbox-durable',
      environment: 'sandbox',
      source: 'firestore',
      testUserSandbox: true
    });
    const { handlers, socket } = createHarness();

    await handlers.sendMessage({ bookingId: 'ride_1', message: 'Não deve cair no operacional' });

    expect(chatPersistenceService.saveMessage).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith(
      'messageError',
      expect.objectContaining({ code: 'SANDBOX_RECORD_CONTEXT_INVALID' })
    );
  });

  it('requires an explicit sandbox request and permission from a support socket', async () => {
    paymentRuntimeProfileService.resolveProfile.mockResolvedValue({
      profileId: 'qa-test-users-sandbox-durable',
      environment: 'sandbox',
      source: 'firestore',
      testUserSandbox: true
    });
    const financialContext = sealFinancialContext({
      providerEnvironment: 'sandbox',
      paymentProfileId: 'qa-test-users-sandbox-durable',
      paymentProfileSource: 'firestore',
      testUserSandbox: true
    });
    const bookingOverrides = {
      financialContext,
      financialNamespace: 'sandbox',
      financialContextId: financialContext.contextId,
      providerEnvironment: 'sandbox'
    };
    const denied = createHarness({
      socketUserId: 'support_1',
      socketUserType: 'support',
      bookingOverrides
    });

    await denied.handlers.sendMessage({ bookingId: 'ride_1', message: 'Acesso sem escopo' });

    expect(chatPersistenceService.saveMessage).not.toHaveBeenCalled();
    expect(denied.socket.emit).toHaveBeenCalledWith(
      'messageError',
      expect.objectContaining({ code: 'SANDBOX_PERSISTENCE_ACCESS_DENIED' })
    );

    const allowed = createHarness({
      socketUserId: 'support_1',
      socketUserType: 'support',
      socketUserPermissions: ['support:sandbox'],
      bookingOverrides
    });
    await allowed.handlers.sendMessage({
      bookingId: 'ride_1',
      persistenceScope: 'sandbox',
      message: 'Acesso autorizado'
    });

    expect(chatPersistenceService.saveMessage).toHaveBeenCalledWith(
      expect.objectContaining({ financialNamespace: 'sandbox' })
    );
  });

  it('fails closed before persistence when a sandbox ride loses its financial context', async () => {
    const { handlers, socket } = createHarness({
      bookingOverrides: {
        financialNamespace: 'sandbox',
        providerEnvironment: 'sandbox'
      }
    });

    await handlers.sendMessage({ bookingId: 'ride_1', message: 'Não deve persistir' });

    expect(chatPersistenceService.saveMessage).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenCalledWith(
      'messageError',
      expect.objectContaining({ code: 'SANDBOX_RECORD_OPERATIONAL_ACCESS_DENIED' })
    );
  });
});
