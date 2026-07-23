const mockApi = {
  post: jest.fn(),
  get: jest.fn(),
  put: jest.fn(),
};

jest.mock('../src/utils/Logger', () => ({
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../src/config/ApiConfig', () => ({
  getSelfHostedApiUrl: jest.fn(() => 'https://api.leaf.test'),
}));

jest.mock('../src/utils/axiosInterceptor', () => ({
  createAxiosInstance: jest.fn(() => mockApi),
}));

describe('paymentService createPixCharge quote lock guard', () => {
  let createPixCharge;

  beforeAll(() => {
    ({ createPixCharge } = require('../src/services/paymentService'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('fails closed before creating a backend Pix charge when quoteLockId is missing', async () => {
    await expect(
      createPixCharge({
        amount: 76.9,
        rideId: 'ride_missing_lock',
        passengerId: 'passenger_missing_lock',
      }),
    ).rejects.toMatchObject({
      code: 'QUOTE_LOCK_REQUIRED',
      message: 'Cotação expirada ou ausente. Recalcule a tarifa antes de pagar.',
    });

    expect(mockApi.post).not.toHaveBeenCalled();
  });

  it('forwards the locked quote id to the Leaf payment backend', async () => {
    mockApi.post.mockResolvedValueOnce({
      data: {
        chargeId: 'charge_locked_1',
        qrCode: 'pix-qr-code',
        paymentLink: 'https://pay.leaf.test/charge_locked_1',
      },
    });

    const result = await createPixCharge({
      amount: 76.9,
      rideId: 'ride_locked_1',
      passengerId: 'passenger_locked_1',
      quoteSessionId: 'quote_session_locked_1',
      quoteLockId: 'ql_locked_1',
      rideDetails: {
        origin: 'Carioca Shopping',
        destination: 'Mercadao de Madureira',
      },
    });

    expect(mockApi.post).toHaveBeenCalledWith(
      '/api/payment/advance',
      expect.objectContaining({
        passengerId: 'passenger_locked_1',
        amount: 7690,
        rideId: 'ride_locked_1',
        quoteSessionId: 'quote_session_locked_1',
        quoteLockId: 'ql_locked_1',
      }),
    );
    expect(result.data.charge).toEqual(
      expect.objectContaining({
        id: 'charge_locked_1',
        status: 'PENDING',
        qrCodeImage: 'pix-qr-code',
        paymentLinkUrl: 'https://pay.leaf.test/charge_locked_1',
      }),
    );
  });

  it('accepts quoteLockId from nested ride details for legacy callers', async () => {
    mockApi.post.mockResolvedValueOnce({
      data: {
        chargeId: 'charge_nested_lock',
        bypass: true,
      },
    });

    await createPixCharge({
      value: 42.5,
      rideId: 'ride_nested_lock',
      passengerId: 'passenger_nested_lock',
      rideDetails: {
        quoteLockId: 'ql_nested_1',
        pickupLocation: { latitude: -22.887, longitude: -43.343 },
        destinationLocation: { latitude: -22.871, longitude: -43.337 },
      },
    });

    expect(mockApi.post).toHaveBeenCalledWith(
      '/api/payment/advance',
      expect.objectContaining({
        amount: 4250,
        quoteLockId: 'ql_nested_1',
        pickupLocation: { latitude: -22.887, longitude: -43.343 },
        destinationLocation: { latitude: -22.871, longitude: -43.337 },
      }),
    );
  });
});
