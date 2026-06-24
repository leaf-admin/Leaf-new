const mockRedis = {
  get: jest.fn(),
  hgetall: jest.fn()
};
const mockCanDriverWork = jest.fn();
const mockIsDriverLocked = jest.fn();

jest.mock('../../../utils/redis-pool', () => ({
  getConnection: jest.fn(() => mockRedis)
}));

jest.mock('../../../services/driver-lock-manager', () => ({
  isDriverLocked: (...args) => mockIsDriverLocked(...args)
}));

jest.mock('../../../services/kyc-driver-status-service', () => ({
  canDriverWork: (...args) => mockCanDriverWork(...args)
}));

jest.mock('../../../services/response-handler', () =>
  jest.fn().mockImplementation(() => ({}))
);

jest.mock('../../../utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn()
  }
}));

const DriverPoolMonitor = require('../../../services/driver-pool-monitor');

describe('DriverPoolMonitor KYC availability guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedis.get.mockResolvedValue(null);
    mockRedis.hgetall.mockResolvedValue({
      isOnline: 'true',
      status: 'available'
    });
    mockCanDriverWork.mockResolvedValue(true);
    mockIsDriverLocked.mockResolvedValue({ isLocked: false });
  });

  it('does not expose a driver when the KYC check fails', async () => {
    mockCanDriverWork.mockRejectedValue(new Error('kyc unavailable'));

    const monitor = new DriverPoolMonitor({});
    await expect(monitor.isDriverAvailable('driver_kyc_error')).resolves.toBe(false);

    expect(mockIsDriverLocked).not.toHaveBeenCalled();
    expect(mockRedis.get).not.toHaveBeenCalled();
    expect(mockRedis.hgetall).not.toHaveBeenCalled();
  });

  it('does not expose a driver blocked by KYC', async () => {
    mockCanDriverWork.mockResolvedValue(false);

    const monitor = new DriverPoolMonitor({});
    await expect(monitor.isDriverAvailable('driver_kyc_blocked')).resolves.toBe(false);

    expect(mockIsDriverLocked).not.toHaveBeenCalled();
    expect(mockRedis.get).not.toHaveBeenCalled();
    expect(mockRedis.hgetall).not.toHaveBeenCalled();
  });
});
