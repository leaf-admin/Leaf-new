describe('ReceiptService', () => {
  let mockApiGet;
  let mockAxiosInstance;
  let mockSetupAxiosInterceptor;

  beforeEach(() => {
    jest.resetModules();
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
  });

  it('loads receipts through the Leaf API', async () => {
    jest.doMock('../src/config/backendBaseUrl', () => 'https://api.leaf.test');

    const receipt = { rideId: 'booking_123', financial: { totalPaid: { formatted: 'R$ 79,61' } } };
    mockApiGet.mockResolvedValue({ data: { success: true, receipt } });

    const service = require('../src/services/ReceiptService').default;
    const { createAxiosInstance } = require('../src/utils/axiosInterceptor');

    await expect(service.getReceiptByRideId('booking_123')).resolves.toEqual(receipt);
    expect(createAxiosInstance).toHaveBeenCalledWith({ baseURL: 'https://api.leaf.test/api' });
    expect(mockSetupAxiosInterceptor).toHaveBeenCalledWith(mockAxiosInstance);
    expect(mockApiGet).toHaveBeenCalledWith('/receipts/booking_123');
  });

  it('fails visibly when the Leaf API has no authoritative receipt', async () => {
    jest.doMock('../src/config/backendBaseUrl', () => 'https://api.leaf.test');

    mockApiGet.mockResolvedValue({ data: { success: false } });

    const service = require('../src/services/ReceiptService').default;

    await expect(service.getReceiptByRideId('booking_missing')).rejects.toThrow(
      'Recibo não encontrado',
    );
    expect(mockApiGet).toHaveBeenCalledWith('/receipts/booking_missing');
  });
});
