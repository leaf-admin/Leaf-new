const firestore = {
  collection: jest.fn(),
};

jest.mock('../../../firebase-config', () => ({
  getFirestore: jest.fn(() => firestore),
}));

jest.mock('firebase-admin', () => ({
  firestore: {
    FieldValue: {
      serverTimestamp: jest.fn(() => 'server-timestamp'),
    },
    Timestamp: {
      fromDate: jest.fn(date => date),
      now: jest.fn(() => new Date()),
    },
  },
}));

jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn(),
  logError: jest.fn(),
}));

const chatPersistenceService = require('../../../services/chat-persistence-service');
const { logError, logStructured } = require('../../../utils/logger');
const { sealFinancialContext } = require('../../../services/financial-runtime-context');

describe('chat-persistence-service error boundaries', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the original persistence error without masking it with conversationId scope', async () => {
    firestore.collection.mockReturnValue({
      doc: jest.fn(() => ({ set: jest.fn() })),
    });
    jest
      .spyOn(chatPersistenceService, 'retryOperation')
      .mockRejectedValueOnce(new Error('write failed'));

    const result = await chatPersistenceService.saveMessage({
      bookingId: 'ride_1',
      senderId: 'passenger_1',
      receiverId: 'driver_1',
      message: 'Cheguei',
      senderType: 'passenger',
    });

    expect(result).toEqual({ success: false, error: 'write failed' });
    expect(logError).toHaveBeenCalledWith(
      expect.any(Error),
      'Erro ao salvar mensagem no Firestore',
      expect.objectContaining({ conversationId: 'ride_1' }),
    );
  });

  it('marks a message as read without referencing a conversation outside scope', async () => {
    firestore.collection.mockReturnValue({
      doc: jest.fn(() => ({ update: jest.fn() })),
    });
    jest
      .spyOn(chatPersistenceService, 'retryOperation')
      .mockResolvedValueOnce(undefined);

    await expect(
      chatPersistenceService.markMessageAsRead('message_1'),
    ).resolves.toEqual({ success: true, messageId: 'message_1' });
    expect(logStructured).toHaveBeenCalledWith(
      'info',
      'Mensagem marcada como lida',
      { service: 'chat-persistence', messageId: 'message_1' },
    );
  });

  it('writes a QA ride message only to sandbox_chat_messages', async () => {
    const set = jest.fn().mockResolvedValue(undefined);
    firestore.collection.mockReturnValue({
      doc: jest.fn(() => ({ set }))
    });
    jest.spyOn(chatPersistenceService, 'retryOperation').mockImplementation(async (operation) => operation());
    jest.spyOn(chatPersistenceService, 'cleanupOldMessages').mockResolvedValue({ success: true });
    const financialContext = sealFinancialContext({
      providerEnvironment: 'sandbox',
      paymentProfileId: 'qa-test-users-sandbox-durable',
      paymentProfileSource: 'firestore',
      testUserSandbox: true
    });

    const result = await chatPersistenceService.saveMessage({
      bookingId: 'ride_sandbox_1',
      senderId: 'qa_passenger',
      receiverId: 'qa_driver',
      message: 'Cheguei',
      senderType: 'passenger',
      financialContext,
      financialNamespace: 'sandbox',
      financialContextId: financialContext.contextId
    });

    expect(result.success).toBe(true);
    expect(firestore.collection).toHaveBeenCalledWith('sandbox_chat_messages');
    expect(firestore.collection).not.toHaveBeenCalledWith('chat_messages');
    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      financialNamespace: 'sandbox',
      financialContextId: financialContext.contextId
    }));
  });

  it('does not touch Firestore when a sandbox signal lost its sealed context', async () => {
    const result = await chatPersistenceService.saveMessage({
      bookingId: 'ride_sandbox_lost',
      senderId: 'qa_passenger',
      message: 'Mensagem que deve falhar',
      financialNamespace: 'sandbox',
      providerEnvironment: 'sandbox'
    });

    expect(result).toMatchObject({
      success: false,
      code: 'FINANCIAL_SANDBOX_CONTEXT_LOST'
    });
    expect(firestore.collection).not.toHaveBeenCalled();
  });

  it('reads QA ride history only from sandbox_chat_messages', async () => {
    const get = jest.fn().mockResolvedValue({
      docs: [],
      forEach: jest.fn()
    });
    const limit = jest.fn(() => ({ get }));
    const where = jest.fn(() => ({ limit }));
    firestore.collection.mockReturnValue({ where });
    const financialContext = sealFinancialContext({
      providerEnvironment: 'sandbox',
      paymentProfileId: 'qa-test-users-sandbox-durable',
      testUserSandbox: true
    });

    const result = await chatPersistenceService.getMessages(
      'ride_sandbox_1',
      20,
      financialContext
    );

    expect(result).toEqual({ success: true, messages: [], total: 0 });
    expect(firestore.collection).toHaveBeenCalledWith('sandbox_chat_messages');
    expect(firestore.collection).not.toHaveBeenCalledWith('chat_messages');
  });

  it('marks QA ride messages read only inside sandbox_chat_messages', async () => {
    const update = jest.fn().mockResolvedValue(undefined);
    firestore.collection.mockReturnValue({
      doc: jest.fn(() => ({ update }))
    });
    jest.spyOn(chatPersistenceService, 'retryOperation').mockImplementation(async (operation) => operation());
    const financialContext = sealFinancialContext({
      providerEnvironment: 'sandbox',
      paymentProfileId: 'qa-test-users-sandbox-durable',
      testUserSandbox: true
    });

    const result = await chatPersistenceService.markMessageAsRead(
      'message_sandbox_1',
      financialContext
    );

    expect(result).toEqual({ success: true, messageId: 'message_sandbox_1' });
    expect(firestore.collection).toHaveBeenCalledWith('sandbox_chat_messages');
    expect(firestore.collection).not.toHaveBeenCalledWith('chat_messages');
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ read: true }));
  });

  it('rejects sandbox history records from another sealed payment context', async () => {
    const requestedContext = sealFinancialContext({
      providerEnvironment: 'sandbox',
      paymentProfileId: 'qa-test-users-sandbox-durable',
      testUserSandbox: true
    });
    const foreignContext = sealFinancialContext({
      providerEnvironment: 'sandbox',
      paymentProfileId: 'other-sandbox-profile',
      testUserSandbox: true
    });
    const foreignMessage = {
      conversationId: 'ride_sandbox_1',
      messageId: 'foreign_message',
      message: 'Não deve vazar',
      financialContext: foreignContext,
      financialNamespace: 'sandbox',
      financialContextId: foreignContext.contextId,
      expiresAt: new Date(Date.now() + 60_000)
    };
    const snapshot = {
      docs: [{ id: 'foreign_message', data: () => foreignMessage }],
      forEach: (callback) => callback({ id: 'foreign_message', data: () => foreignMessage })
    };
    const get = jest.fn().mockResolvedValue(snapshot);
    const limit = jest.fn(() => ({ get }));
    const where = jest.fn(() => ({ limit }));
    firestore.collection.mockReturnValue({ where });

    const result = await chatPersistenceService.getMessages(
      'ride_sandbox_1',
      20,
      requestedContext
    );

    expect(result).toMatchObject({
      success: false,
      code: 'SANDBOX_RECORD_CONTEXT_MISMATCH'
    });
  });
});
