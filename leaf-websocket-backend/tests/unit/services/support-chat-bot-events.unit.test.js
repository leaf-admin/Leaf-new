const mockEmit = jest.fn().mockResolvedValue({ queued: 1 });
const mockPublish = jest.fn().mockResolvedValue(1);

jest.mock('../../../utils/redis-pool', () => ({
  ensureConnection: jest.fn().mockResolvedValue(undefined),
  getConnection: jest.fn(() => ({ publish: mockPublish, on: jest.fn(), duplicate: jest.fn(() => ({ on: jest.fn(), subscribe: jest.fn() })) }))
}));

jest.mock('../../../firebase-config', () => ({ getFirestore: jest.fn(() => null) }));

jest.mock('../../../utils/logger', () => ({
  logger: { debug: jest.fn(), error: jest.fn(), info: jest.fn(), warn: jest.fn() },
  logStructured: jest.fn(),
  logError: jest.fn()
}));

jest.mock('../../../services/bot-event-service', () => ({
  emit: (...args) => mockEmit(...args)
}));

const supportChatService = require('../../../services/support-chat-service');

describe('support chat wakes the support bot', () => {
  beforeEach(() => {
    mockEmit.mockClear();
    supportChatService.redis = { publish: mockPublish };
  });

  it('emits for a user message with the money flag and no user data', async () => {
    await supportChatService.sendMessage('passenger-77', 'Quero o reembolso, fui cobrado duas vezes');

    expect(mockEmit).toHaveBeenCalledTimes(1);
    const [type, data, options] = mockEmit.mock.calls[0];
    expect(type).toBe('support.chat_message');
    expect(data).toMatchObject({ category: 'payment', resolutionClass: 'D', senderType: 'user', source: 'app_chat' });
    expect(options.money).toBe(true);
    expect(JSON.stringify(data)).not.toMatch(/passenger-77|reembolso/);
  });

  it('stays silent for agent replies', async () => {
    await supportChatService.sendMessage('passenger-77', 'Estamos verificando', 'agent');
    expect(mockEmit).not.toHaveBeenCalled();
  });
});
