jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

const { logger } = require('../../../utils/logger');
const {
  buildAuthenticationTemplatePayload,
  buildMessagesUrl,
  getWhatsAppOtpConfig,
  isRetryableDeliveryError,
  normalizeRecipient,
  sendOtp
} = require('../../../services/whatsapp-otp-service');

const configuredEnv = {
  NODE_ENV: 'test',
  AUTH_OTP_PROVIDER: 'whatsapp',
  WHATSAPP_META_ACCESS_TOKEN: 'meta-test-token',
  WHATSAPP_META_PHONE_NUMBER_ID: '123456789012345',
  WHATSAPP_META_GRAPH_BASE_URL: 'https://graph.facebook.com',
  WHATSAPP_META_GRAPH_VERSION: 'v23.0',
  WHATSAPP_OTP_TEMPLATE_NAME: 'leaf_authentication',
  WHATSAPP_OTP_TEMPLATE_LANGUAGE: 'pt_BR',
  WHATSAPP_OTP_TIMEOUT_MS: '5000',
  WHATSAPP_OTP_MAX_ATTEMPTS: '2',
  WHATSAPP_OTP_RETRY_DELAY_MS: '0'
};
const mockAxios = { post: jest.fn() };

describe('whatsapp-otp-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAxios.post.mockReset();
  });

  it('requires provider credentials only when WhatsApp is selected', () => {
    expect(getWhatsAppOtpConfig({ NODE_ENV: 'production', AUTH_OTP_PROVIDER: 'simulation' })).toMatchObject({
      provider: 'simulation',
      enabled: false,
      configured: false,
      missing: []
    });

    expect(getWhatsAppOtpConfig({
      ...configuredEnv,
      WHATSAPP_META_ACCESS_TOKEN: ''
    })).toMatchObject({
      provider: 'whatsapp',
      enabled: true,
      configured: false,
      missing: ['WHATSAPP_META_ACCESS_TOKEN']
    });
  });

  it('builds the Meta authentication template payload without exposing the bearer token', () => {
    const payload = buildAuthenticationTemplatePayload({
      to: '+55 (21) 99999-9999',
      otp: '123456',
      templateName: 'leaf_authentication',
      templateLanguage: 'pt_BR'
    });

    expect(payload).toEqual({
      messaging_product: 'whatsapp',
      to: '5521999999999',
      type: 'template',
      template: {
        name: 'leaf_authentication',
        language: { code: 'pt_BR' },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: '123456' }] },
          {
            type: 'button',
            sub_type: 'url',
            index: '0',
            parameters: [{ type: 'text', text: '123456' }]
          }
        ]
      }
    });
    expect(JSON.stringify(payload)).not.toContain('meta-test-token');
  });

  it('normalizes recipients and builds the versioned messages endpoint', () => {
    expect(normalizeRecipient('+55 21 99999-9999')).toBe('5521999999999');
    expect(buildMessagesUrl(getWhatsAppOtpConfig(configuredEnv))).toBe(
      'https://graph.facebook.com/v23.0/123456789012345/messages'
    );
  });

  it('sends an authentication template and records only safe delivery metadata', async () => {
    mockAxios.post.mockResolvedValue({ data: { messages: [{ id: 'wamid.unit' }] } });

    const result = await sendOtp({
      phoneNumber: '+5521999999999',
      otp: '123456',
      verificationId: 'vid_unit',
      axiosClient: mockAxios,
      env: configuredEnv
    });

    expect(result).toEqual({ provider: 'whatsapp', messageId: 'wamid.unit' });
    expect(mockAxios.post).toHaveBeenCalledWith(
      'https://graph.facebook.com/v23.0/123456789012345/messages',
      expect.objectContaining({
        messaging_product: 'whatsapp',
        to: '5521999999999',
        type: 'template'
      }),
      expect.objectContaining({
        timeout: 5000,
        headers: expect.objectContaining({
          Authorization: 'Bearer meta-test-token',
          'Content-Type': 'application/json'
        })
      })
    );
    expect(logger.info).toHaveBeenCalledWith('[WHATSAPP OTP] delivery accepted', expect.objectContaining({
      phoneLast4: '9999',
      verificationId: 'vid_unit',
      messageId: 'wamid.unit'
    }));
    expect(logger.info.mock.calls.flat().join(' ')).not.toContain('123456');
  });

  it('retries transient Meta responses and returns a sanitized delivery error', async () => {
    mockAxios.post
      .mockRejectedValueOnce({ response: { status: 503 }, message: 'provider secret should not leak' })
      .mockRejectedValueOnce({ response: { status: 429 }, message: 'rate limited' });

    await expect(sendOtp({
      phoneNumber: '+5521999999999',
      otp: '123456',
      verificationId: 'vid_failure',
      axiosClient: mockAxios,
      env: configuredEnv
    })).rejects.toMatchObject({
      code: 'WHATSAPP_OTP_DELIVERY_FAILED',
      status: 502,
      message: 'Falha ao enviar OTP via WhatsApp'
    });
    expect(mockAxios.post).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith('[WHATSAPP OTP] delivery failed', expect.objectContaining({
      phoneLast4: '9999',
      verificationId: 'vid_failure',
      providerStatus: 429
    }));
    expect(logger.warn.mock.calls.flat().join(' ')).not.toContain('provider secret should not leak');
  });

  it('does not retry a non-transient Meta validation error', async () => {
    mockAxios.post.mockRejectedValue({ response: { status: 400 }, message: 'invalid template' });

    await expect(sendOtp({
      phoneNumber: '+5521999999999',
      otp: '123456',
      verificationId: 'vid_bad_request',
      axiosClient: mockAxios,
      env: configuredEnv
    })).rejects.toMatchObject({ code: 'WHATSAPP_OTP_DELIVERY_FAILED' });
    expect(mockAxios.post).toHaveBeenCalledTimes(1);
  });

  it('retries a transient network timeout within the configured attempt limit', async () => {
    mockAxios.post
      .mockRejectedValueOnce(Object.assign(new Error('timeout'), { code: 'ECONNABORTED' }))
      .mockResolvedValueOnce({ data: { messages: [{ id: 'wamid.retry' }] } });

    await expect(sendOtp({
      phoneNumber: '+5521999999999',
      otp: '123456',
      verificationId: 'vid_network_retry',
      axiosClient: mockAxios,
      env: configuredEnv
    })).resolves.toEqual({ provider: 'whatsapp', messageId: 'wamid.retry' });
    expect(isRetryableDeliveryError({ code: 'ECONNABORTED' })).toBe(true);
    expect(mockAxios.post).toHaveBeenCalledTimes(2);
  });
});
