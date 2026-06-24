jest.mock('../src/utils/Logger', () => ({
  log: jest.fn(),
  error: jest.fn(),
}));

jest.mock('@react-native-firebase/auth', () =>
  jest.fn(() => ({
    currentUser: { uid: 'user_1' },
  })),
);

jest.mock('../src/services/WebSocketManager', () => ({
  __esModule: true,
  default: {
    getInstance: jest.fn(() => ({
      isConnected: jest.fn(() => true),
      socket: {
        on: jest.fn(),
        off: jest.fn(),
      },
    })),
  },
}));

jest.mock('../src/services/AuthService', () => ({
  __esModule: true,
  default: {
    authenticatedRequest: jest.fn(),
  },
}));

import SupportChatService from '../src/services/SupportChatService';
import AuthService from '../src/services/AuthService';

describe('SupportChatService fail-visible history loading', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    SupportChatService.disconnect();
  });

  it('does not turn a support history failure into an empty successful conversation', async () => {
    AuthService.authenticatedRequest.mockResolvedValue({
      ok: false,
      status: 503,
      json: jest.fn().mockResolvedValue({ error: 'support history unavailable' }),
    });

    await expect(SupportChatService.initialize('user_1')).resolves.toBe(false);
    await expect(SupportChatService.getMessages('user_1')).rejects.toThrow(
      'support history unavailable',
    );
  });

  it('fails visibly before sending an empty support chat message', async () => {
    await expect(SupportChatService.sendMessage('   ', 'user_1')).resolves.toEqual(
      expect.objectContaining({
        success: false,
        error: 'Mensagem obrigatória',
      }),
    );
    expect(AuthService.authenticatedRequest).not.toHaveBeenCalled();
  });

  it('fails visibly before sending an oversized support chat message', async () => {
    await expect(SupportChatService.sendMessage('x'.repeat(2001), 'user_1')).resolves.toEqual(
      expect.objectContaining({
        success: false,
        error: 'Mensagem muito longa (máximo 2000 caracteres)',
      }),
    );
    expect(AuthService.authenticatedRequest).not.toHaveBeenCalled();
  });
});
