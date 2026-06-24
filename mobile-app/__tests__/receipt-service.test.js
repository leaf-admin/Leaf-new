describe('ReceiptService', () => {
  let mockApiGet;
  let mockAxiosInstance;
  let mockSetupAxiosInterceptor;

  beforeEach(() => {
    jest.resetModules();
    delete process.env.EXPO_PUBLIC_RECEIPT_RTDATABASE_FALLBACK;
    mockApiGet = jest.fn();
    mockAxiosInstance = { get: mockApiGet };
    mockSetupAxiosInterceptor = jest.fn();
    jest.doMock('../src/utils/axiosInterceptor', () => ({
      createAxiosInstance: jest.fn(() => mockAxiosInstance),
      setupAxiosInterceptor: mockSetupAxiosInterceptor,
    }));
  });

  afterEach(() => {
    jest.dontMock('../src/utils/axiosInterceptor');
    jest.dontMock('../src/config/backendBaseUrl');
    jest.dontMock('@react-native-firebase/database');
  });

  it('loads receipts through the Leaf API without touching RTDB by default', async () => {
    const databaseRef = jest.fn();
    jest.doMock('@react-native-firebase/database', () => ({
      __esModule: true,
      default: jest.fn(() => ({
        ref: databaseRef,
      })),
    }));
    jest.doMock('../src/config/backendBaseUrl', () => 'https://api.leaf.test');

    const receipt = { rideId: 'booking_123', financial: { totalPaid: { formatted: 'R$ 79,61' } } };
    mockApiGet.mockResolvedValue({ data: { success: true, receipt } });

    const service = require('../src/services/ReceiptService').default;
    const { createAxiosInstance } = require('../src/utils/axiosInterceptor');

    await expect(service.getReceiptByRideId('booking_123')).resolves.toEqual(receipt);
    expect(createAxiosInstance).toHaveBeenCalledWith({ baseURL: 'https://api.leaf.test/api' });
    expect(mockSetupAxiosInterceptor).toHaveBeenCalledWith(mockAxiosInstance);
    expect(mockApiGet).toHaveBeenCalledWith('/receipts/booking_123');
    expect(databaseRef).not.toHaveBeenCalled();
  });

  it('uses RTDB only when the legacy fallback flag is explicitly enabled', async () => {
    process.env.EXPO_PUBLIC_RECEIPT_RTDATABASE_FALLBACK = 'true';
    const snapshot = {
      exists: jest.fn(() => true),
      val: jest.fn(() => ({ rideId: 'booking_legacy' })),
    };
    const once = jest.fn().mockResolvedValue(snapshot);
    const ref = jest.fn(() => ({ once }));
    jest.doMock('@react-native-firebase/database', () => ({
      __esModule: true,
      default: jest.fn(() => ({ ref })),
    }));
    jest.doMock('../src/config/backendBaseUrl', () => 'https://api.leaf.test');

    mockApiGet.mockResolvedValue({ data: { success: false } });

    const service = require('../src/services/ReceiptService').default;

    await expect(service.getReceiptByRideId('booking_legacy')).resolves.toEqual({
      rideId: 'booking_legacy',
    });
    expect(mockApiGet).toHaveBeenCalledWith('/receipts/booking_legacy');
    expect(ref).toHaveBeenCalledWith('receipts/booking_legacy');
  });
});
