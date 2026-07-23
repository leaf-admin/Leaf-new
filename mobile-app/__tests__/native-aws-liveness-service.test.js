const mockPlatform = { OS: 'ios' };
const mockLeafAwsLiveness = {
  start: jest.fn(),
  cancel: jest.fn(),
};

jest.mock('react-native', () => ({
  Platform: mockPlatform,
  NativeModules: {
    LeafAwsLiveness: mockLeafAwsLiveness,
  },
}));

const nativeAwsLivenessService =
  require('../src/services/NativeAwsLivenessService').default;

describe('NativeAwsLivenessService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPlatform.OS = 'ios';
    mockLeafAwsLiveness.start.mockResolvedValue({
      success: true,
      sessionId: 'session-1',
    });
    mockLeafAwsLiveness.cancel.mockResolvedValue({
      success: true,
      cancelled: true,
    });
  });

  test('normalizes temporary credentials before starting the native detector', async () => {
    await nativeAwsLivenessService.start({
      sessionId: 'session-1',
      region: 'us-east-1',
      credentials: {
        AccessKeyId: 'access-key',
        SecretAccessKey: 'secret-key',
        SessionToken: 'session-token',
        Expiration: '2026-07-16T18:00:00.000Z',
      },
    });

    expect(mockLeafAwsLiveness.start).toHaveBeenCalledWith({
      sessionId: 'session-1',
      region: 'us-east-1',
      credentials: {
        accessKeyId: 'access-key',
        secretAccessKey: 'secret-key',
        sessionToken: 'session-token',
        expiration: '2026-07-16T18:00:00.000Z',
      },
    });
  });

  test('delegates cancellation and reports that the native surface was closed', async () => {
    await expect(nativeAwsLivenessService.cancel()).resolves.toEqual({
      success: true,
      cancelled: true,
      supported: true,
    });
    expect(mockLeafAwsLiveness.cancel).toHaveBeenCalledTimes(1);
  });

  test('keeps cleanup idempotent when the installed native build has no cancel method', async () => {
    const originalCancel = mockLeafAwsLiveness.cancel;
    try {
      mockLeafAwsLiveness.cancel = undefined;

      await expect(nativeAwsLivenessService.cancel()).resolves.toEqual({
        success: true,
        cancelled: false,
        supported: false,
      });
    } finally {
      mockLeafAwsLiveness.cancel = originalCancel;
    }
  });

  test('does not expose the native module on unsupported platforms', () => {
    mockPlatform.OS = 'web';
    expect(nativeAwsLivenessService.isAvailable()).toBe(false);
  });
});
