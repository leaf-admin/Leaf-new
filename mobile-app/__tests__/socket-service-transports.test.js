const mockIo = jest.fn();
const mockGetIdToken = jest.fn();

jest.mock('socket.io-client', () => ({
  io: (...args) => mockIo(...args),
}));

jest.mock('@react-native-firebase/auth', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    currentUser: {
      getIdToken: mockGetIdToken,
    },
  })),
}));

jest.mock('../src/config/WebSocketConfig', () => ({
  getWebSocketUrl: jest.fn(() => 'https://socket.leaf.test'),
  getWebSocketConfig: jest.fn(() => ({
    transports: ['websocket'],
    timeout: 20000,
    reconnectionAttempts: 3,
    reconnectionDelay: 500,
  })),
}));

const SocketService = require('../src/services/SocketService').default;

describe('SocketService transports', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetIdToken.mockResolvedValue('firebase-token');
    mockIo.mockReturnValue({
      id: 'socket_1',
      on: jest.fn(),
      emit: jest.fn(),
      disconnect: jest.fn(),
    });
  });

  it('connects with websocket-only transport to avoid polling load', async () => {
    await SocketService.connect();

    expect(mockIo).toHaveBeenCalledWith(
      'https://socket.leaf.test',
      expect.objectContaining({
        auth: { token: 'firebase-token' },
        transports: ['websocket'],
      })
    );
    expect(mockIo.mock.calls[0][1].transports).not.toContain('polling');
  });
});
