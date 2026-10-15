jest.mock('ioredis', () => jest.fn());
jest.mock('../../../services/KYCFaceWorker', () => jest.fn());
jest.mock('../../../services/KYCRetryService', () => jest.fn());
jest.mock('../../../services/KYCAnalyticsService', () => jest.fn());
jest.mock('../../../services/KYCNotificationService', () => jest.fn());
jest.mock('../../../services/kyc-vps-client', () => jest.fn());
jest.mock('../../../services/firebase-storage-service', () => jest.fn());
jest.mock('../../../services/device-face-embedding-verification-service', () => jest.fn());
jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn(),
  logError: jest.fn()
}));

const IntegratedKYCService = require('../../../services/IntegratedKYCService');
const { logError, logStructured } = require('../../../utils/logger');

// Before the fix these catch blocks logged an undeclared `userId` (and the
// cleanup log an undeclared `deletedCount`), so they threw ReferenceError.
describe('IntegratedKYCService error logs', () => {
  beforeEach(() => jest.clearAllMocks());

  test.each([
    ['sendLivenessCheckNotification', 'sendLivenessCheck'],
    ['sendRetryNotification', 'sendRetryAttempt'],
    ['sendCompletionNotification', 'sendVerificationCompleted']
  ])('%s swallows a notification failure and logs the driver', async (method, notifier) => {
    const fakeThis = { notificationService: { [notifier]: jest.fn().mockRejectedValue(new Error('push down')) } };

    await expect(IntegratedKYCService.prototype[method].call(fakeThis, 'driver-1', {})).resolves.toBeUndefined();
    expect(logError).toHaveBeenCalledWith(expect.any(Error), expect.any(String), expect.objectContaining({ driverId: 'driver-1' }));
  });

  test('configureRetry rethrows the original error', async () => {
    const fakeThis = { retryService: { configureRetry: jest.fn(() => { throw new Error('bad options'); }) } };

    await expect(IntegratedKYCService.prototype.configureRetry.call(fakeThis, {})).rejects.toThrow('bad options');
  });

  test('cleanupOldData logs success instead of a ReferenceError', async () => {
    const fakeThis = { analyticsService: { cleanupOldData: jest.fn().mockResolvedValue(undefined) } };

    await IntegratedKYCService.prototype.cleanupOldData.call(fakeThis);

    expect(logStructured).toHaveBeenCalledWith('info', 'Limpeza de dados antigos concluída', expect.any(Object));
    expect(logError).not.toHaveBeenCalled();
  });
});
