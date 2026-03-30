const mockMarkDriverForPhotoMismatch = jest.fn().mockResolvedValue({ success: true });
const mockIsPhotoMismatchReport = jest.fn();

jest.mock('../../../services/kyc-policy-service', () => ({
  isPhotoMismatchReport: (...args) => mockIsPhotoMismatchReport(...args),
  markDriverForPhotoMismatch: (...args) => mockMarkDriverForPhotoMismatch(...args)
}));

jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn()
}));

describe('rating-service KYC escalation', () => {
  let ratingService;
  let mockGetFromRealtimeDB;
  let mockUpdateRealtimeDBRoot;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockMarkDriverForPhotoMismatch.mockResolvedValue({ success: true });
    mockIsPhotoMismatchReport.mockReturnValue(false);

    mockGetFromRealtimeDB = jest.fn().mockResolvedValue(null);
    mockUpdateRealtimeDBRoot = jest.fn().mockResolvedValue(true);

    jest.doMock('../../../firebase-config', () => ({
      isRealtimeDBAvailable: jest.fn(() => true),
      getFromRealtimeDB: (...args) => mockGetFromRealtimeDB(...args),
      updateRealtimeDBRoot: (...args) => mockUpdateRealtimeDBRoot(...args)
    }));

    ratingService = require('../../../services/rating-service');
  });

  test('should trigger KYC escalation when passenger reports photo mismatch', async () => {
    mockIsPhotoMismatchReport.mockReturnValue(true);

    const result = await ratingService.submitRating({
      tripId: 'trip-1',
      userId: 'passenger-1',
      userType: 'passenger',
      driverId: 'driver-1',
      rating: 1,
      selectedOptions: ['motorista diferente da foto'],
      comment: 'Nao era a mesma pessoa'
    });

    expect(result.success).toBe(true);
    expect(mockMarkDriverForPhotoMismatch).toHaveBeenCalledTimes(1);
    expect(mockMarkDriverForPhotoMismatch).toHaveBeenCalledWith(
      expect.objectContaining({
        driverId: 'driver-1',
        tripId: 'trip-1',
        reporterId: 'passenger-1',
        reporterType: 'passenger'
      })
    );
    expect(mockUpdateRealtimeDBRoot).toHaveBeenCalled();
    expect(result.kycEscalation).toEqual({ success: true });
  });

  test('should not trigger KYC escalation for neutral feedback', async () => {
    mockIsPhotoMismatchReport.mockReturnValue(false);

    const result = await ratingService.submitRating({
      tripId: 'trip-2',
      userId: 'passenger-2',
      userType: 'passenger',
      driverId: 'driver-2',
      rating: 5,
      selectedOptions: ['Direcao segura'],
      comment: 'Tudo certo'
    });

    expect(result.success).toBe(true);
    expect(mockMarkDriverForPhotoMismatch).not.toHaveBeenCalled();
    expect(result.kycEscalation).toBeNull();
  });
});
