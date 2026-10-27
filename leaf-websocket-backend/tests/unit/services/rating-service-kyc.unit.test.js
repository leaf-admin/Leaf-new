const mockMarkDriverForPhotoMismatch = jest.fn().mockResolvedValue({ success: true });
const mockIsPhotoMismatchReport = jest.fn();
const { sealFinancialContext } = require('../../../services/financial-runtime-context');
const { fakeRatingsFirestore } = require('../../helpers/fake-ratings-firestore');

jest.mock('../../../services/kyc-policy-service', () => ({
  isPhotoMismatchReport: (...args) => mockIsPhotoMismatchReport(...args),
  markDriverForPhotoMismatch: (...args) => mockMarkDriverForPhotoMismatch(...args)
}));

jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn()
}));

describe('rating-service KYC escalation', () => {
  let ratingService;
  let mockFirestore;
  let mockAnnotations;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockMarkDriverForPhotoMismatch.mockResolvedValue({ success: true });
    mockIsPhotoMismatchReport.mockReturnValue(false);

    mockFirestore = fakeRatingsFirestore();
    mockAnnotations = [];
    jest.doMock('../../../firebase-config', () => ({
      getFirestore: () => mockFirestore
    }));
    jest.doMock('../../../services/ride-annotation-store', () => ({
      updateAnnotation: jest.fn(async (_firestore, root, id, patch) => {
        mockAnnotations.push({ root, id, patch });
      })
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
    }, {
      tripScope: {
        bookingId: 'trip-1',
        customerId: 'passenger-1',
        driverId: 'driver-1',
        status: 'COMPLETED'
      }
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
    expect(mockFirestore.paths().some(path => path.startsWith('ratings/'))).toBe(true);
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
    }, {
      tripScope: {
        bookingId: 'trip-2',
        customerId: 'passenger-2',
        driverId: 'driver-2',
        status: 'COMPLETED'
      }
    });

    expect(result.success).toBe(true);
    expect(mockMarkDriverForPhotoMismatch).not.toHaveBeenCalled();
    expect(result.kycEscalation).toBeNull();
  });

  test('should prefer authenticated socket context over spoofed rating payload fields', async () => {
    const result = await ratingService.submitRating({
      tripId: 'trip-3',
      userId: 'driver-1',
      reviewerId: 'driver-1',
      userType: 'driver',
      reviewerType: 'driver',
      targetUserId: 'passenger-1',
      rating: 4
    }, {
      socketUserId: 'passenger-1',
      socketUserType: 'passenger',
      tripScope: {
        bookingId: 'trip-3',
        customerId: 'passenger-1',
        driverId: 'driver-1',
        status: 'COMPLETED'
      }
    });

    expect(result.success).toBe(true);
    expect(mockFirestore.docs.get(`ratings/${result.ratingId}`)).toMatchObject({
      reviewerId: 'passenger-1',
      reviewerType: 'passenger',
      targetUserId: 'driver-1'
    });
  });

  test('should not mutate operational KYC state from a sandbox rating', async () => {
    mockIsPhotoMismatchReport.mockReturnValue(true);
    const financialContext = sealFinancialContext({
      providerEnvironment: 'sandbox',
      paymentProfileId: 'qa-test-users-sandbox-durable',
      paymentProfileSource: 'firestore',
      testUserSandbox: true
    });

    const result = await ratingService.submitRating({
      tripId: 'trip-sandbox',
      rating: 1,
      selectedOptions: ['motorista diferente da foto'],
      comment: 'Nao era a mesma pessoa'
    }, {
      socketUserId: 'passenger-sandbox',
      socketUserType: 'passenger',
      tripScope: {
        bookingId: 'trip-sandbox',
        customerId: 'passenger-sandbox',
        driverId: 'driver-sandbox',
        status: 'COMPLETED',
        raw: {
          bookingId: 'trip-sandbox',
          financialContext,
          financialNamespace: 'sandbox',
          financialContextId: financialContext.contextId
        }
      }
    });

    expect(result.success).toBe(true);
    expect(mockMarkDriverForPhotoMismatch).not.toHaveBeenCalled();
    expect(mockFirestore.paths().every((path) => path.startsWith('sandbox_'))).toBe(true);
    expect(mockAnnotations.every(({ root }) => root === 'sandbox_bookings')).toBe(true);
  });
});
