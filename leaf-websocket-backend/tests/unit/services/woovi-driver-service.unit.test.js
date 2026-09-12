const mockApi = {
  get: jest.fn(),
  post: jest.fn(),
};

jest.mock('axios', () => ({
  create: jest.fn(() => mockApi),
}));

jest.mock('../../../config/woovi-config', () => ({
  getWooviConfig: jest.fn(() => ({
    environment: 'sandbox',
    baseUrl: 'https://api.woovi-sandbox.com/api/v1',
    apiToken: 'sandbox-test-token',
    authorizationAppId: 'sandbox-test-token',
    appId: 'Client_Id_sandbox',
  })),
  getWooviAuthHeaders: jest.fn(() => ({
    'Content-Type': 'application/json',
    Authorization: 'sandbox-test-token',
  })),
}));

jest.mock('../../../config/load-ngrok-url', () => ({
  getNgrokWebhookUrl: jest.fn(() => 'https://qa.example.test/api/woovi/webhook'),
}));

jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn(),
  logError: jest.fn(),
}));

const WooviDriverService = require('../../../services/woovi-driver-service');

describe('WooviDriverService Pix response contract', () => {
  let service;

  beforeEach(() => {
    mockApi.get.mockReset();
    mockApi.post.mockReset();
    service = new WooviDriverService();
  });

  it('exposes the provider QR image, brCode, and payment link from charge creation', async () => {
    mockApi.post.mockResolvedValue({
      status: 201,
      data: {
        charge: {
          identifier: 'woovi_charge_1',
          status: 'ACTIVE',
          value: 2243,
          brCode: '00020101021226880014br.gov.bcb.pix',
          qrCodeImage: 'https://api.woovi-sandbox.com/qr/woovi_charge_1.png',
          paymentLinkUrl: 'https://woovi-sandbox.com/pay/woovi_charge_1',
        },
      },
    });

    const result = await service.createCharge({
      value: 2243,
      correlationID: 'leaf_ride_1',
      comment: 'QA ride',
    });

    expect(result).toMatchObject({
      success: true,
      chargeId: 'woovi_charge_1',
      brCode: '00020101021226880014br.gov.bcb.pix',
      qrCodeText: '00020101021226880014br.gov.bcb.pix',
      qrCodeImage: 'https://api.woovi-sandbox.com/qr/woovi_charge_1.png',
      paymentLink: 'https://woovi-sandbox.com/pay/woovi_charge_1',
      paymentLinkUrl: 'https://woovi-sandbox.com/pay/woovi_charge_1',
    });
    expect(result.charge.identifier).toBe('woovi_charge_1');
  });

  it('accepts the direct charge shape returned by the provider status endpoint', async () => {
    mockApi.get.mockResolvedValue({
      status: 200,
      data: {
        identifier: 'woovi_charge_2',
        status: 'COMPLETED',
        value: 2243,
        brCode: '000201010212direct-status-brcode',
        qrCodeImage: 'https://api.woovi-sandbox.com/qr/woovi_charge_2.png',
        paymentLinkUrl: 'https://woovi-sandbox.com/pay/woovi_charge_2',
      },
    });

    const result = await service.getChargeStatus('woovi_charge_2', {
      wooviConfig: {
        environment: 'sandbox',
        baseUrl: 'https://api.woovi-sandbox.com/api/v1',
        apiToken: 'sandbox-test-token',
        authorizationAppId: 'sandbox-test-token',
        appId: 'Client_Id_sandbox',
      },
    });

    expect(result).toMatchObject({
      success: true,
      status: 'COMPLETED',
      amount: 2243,
      chargeId: 'woovi_charge_2',
      brCode: '000201010212direct-status-brcode',
      qrCodeText: '000201010212direct-status-brcode',
    });
    expect(mockApi.get).toHaveBeenCalledWith('/charge/woovi_charge_2');
  });

  it('returns a typed error instead of treating an invalid 2xx response as a pending charge', async () => {
    mockApi.get.mockResolvedValue({
      status: 200,
      data: { message: 'provider response without charge' },
    });

    const result = await service.getChargeStatus('woovi_charge_invalid');

    expect(result).toMatchObject({
      success: false,
      code: 'WOOVI_CHARGE_RESPONSE_INVALID',
      error: 'Resposta inválida da API Woovi',
    });
  });
});
