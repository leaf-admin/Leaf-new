jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

const { logger } = require('../../../utils/logger');
const {
  CONTEXT_TTL_SECONDS,
  buildPaymentConfirmedPayload,
  formatCentsAsReais,
  getWhatsAppPaymentNotificationConfig,
  rememberPixChargeContext,
  sanitizeTextParameter,
  sendPaymentConfirmedNotification
} = require('../../../services/whatsapp-payment-notification-service');

const enabledEnv = {
  WHATSAPP_PAYMENT_NOTIFICATIONS_ENABLED: 'true',
  WHATSAPP_META_ACCESS_TOKEN: 'meta-test-token',
  WHATSAPP_META_PHONE_NUMBER_ID: '123456789012345',
  WHATSAPP_META_GRAPH_VERSION: 'v23.0'
};

function createRedis() {
  const store = new Map();
  return {
    store,
    get: jest.fn(async (key) => (store.has(key) ? store.get(key) : null)),
    set: jest.fn(async (key, value, ...args) => {
      if (args.includes('NX') && store.has(key)) return null;
      store.set(key, value);
      return 'OK';
    })
  };
}

describe('whatsapp-payment-notification-service', () => {
  const mockAxios = { post: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    mockAxios.post.mockReset();
    mockAxios.post.mockResolvedValue({ data: { messages: [{ id: 'wamid.test' }] } });
  });

  it('is off unless the flag is set', () => {
    expect(getWhatsAppPaymentNotificationConfig({}).enabled).toBe(false);
    const config = getWhatsAppPaymentNotificationConfig(enabledEnv);
    expect(config.configured).toBe(true);
    expect(config.confirmedTemplate).toBe('leaf_pagamento_confirmado');
    expect(config.confirmedNoTollTemplate).toBe('leaf_pagamento_confirmado_sem_pedagio');
  });

  it('reports missing Meta credentials when enabled', () => {
    const config = getWhatsAppPaymentNotificationConfig({ WHATSAPP_PAYMENT_NOTIFICATIONS_ENABLED: 'true' });
    expect(config.configured).toBe(false);
    expect(config.missing).toEqual(['WHATSAPP_META_ACCESS_TOKEN', 'WHATSAPP_META_PHONE_NUMBER_ID']);
  });

  it('formats money and cleans template parameters', () => {
    expect(formatCentsAsReais(3240)).toBe('32,40');
    expect(formatCentsAsReais(123456)).toBe('1.234,56');
    expect(sanitizeTextParameter('Av.\nAtlântica   1702', 'x')).toBe('Av. Atlântica 1702');
    expect(sanitizeTextParameter('   ', 'seu destino')).toBe('seu destino');
    expect(sanitizeTextParameter('a'.repeat(80), 'x')).toHaveLength(60);
  });

  it('uses the toll template with four parameters when there is toll', () => {
    const config = getWhatsAppPaymentNotificationConfig(enabledEnv);
    const payload = buildPaymentConfirmedPayload({
      to: '+55 21 99999-0001',
      context: { passengerName: 'Ana Souza', destination: 'Niterói', tollCents: 620 },
      amountInCents: 3240,
      config
    });

    expect(payload.to).toBe('5521999990001');
    expect(payload.template.name).toBe('leaf_pagamento_confirmado');
    expect(payload.template.language).toEqual({ code: 'pt_BR' });
    expect(payload.template.components[0].parameters.map((p) => p.text))
      .toEqual(['Ana', '32,40', 'Niterói', '6,20']);
  });

  it('uses the no-toll template with three parameters without toll', () => {
    const config = getWhatsAppPaymentNotificationConfig(enabledEnv);
    const payload = buildPaymentConfirmedPayload({
      to: '5521999990001',
      context: { passengerName: '', destination: 'Copacabana', tollCents: 0 },
      amountInCents: 2490,
      config
    });

    expect(payload.template.name).toBe('leaf_pagamento_confirmado_sem_pedagio');
    expect(payload.template.components[0].parameters.map((p) => p.text))
      .toEqual(['passageiro', '24,90', 'Copacabana']);
  });

  it('does not store context when disabled or without a verified phone', async () => {
    const redis = createRedis();
    await expect(rememberPixChargeContext({ redis, chargeId: 'c1', verifiedPhone: '+5521999990001', env: {} }))
      .resolves.toEqual({ stored: false });
    await expect(rememberPixChargeContext({ redis, chargeId: 'c1', verifiedPhone: null, env: enabledEnv }))
      .resolves.toEqual({ stored: false });
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('stores context with a TTL and sends once per charge', async () => {
    const redis = createRedis();
    await rememberPixChargeContext({
      redis,
      chargeId: 'charge-1',
      passengerId: 'uid-1',
      verifiedPhone: '+5521999990001',
      passengerName: 'Ana Souza',
      destination: 'Niterói',
      tollCents: 620,
      env: enabledEnv
    });
    expect(redis.set).toHaveBeenCalledWith(
      'whatsapp_pix_ctx:charge-1',
      expect.any(String),
      'EX',
      CONTEXT_TTL_SECONDS
    );

    const first = await sendPaymentConfirmedNotification({
      redis, chargeId: 'charge-1', amountInCents: 3240, axiosClient: mockAxios, env: enabledEnv
    });
    const second = await sendPaymentConfirmedNotification({
      redis, chargeId: 'charge-1', amountInCents: 3240, axiosClient: mockAxios, env: enabledEnv
    });

    expect(first).toEqual({ sent: true, messageId: 'wamid.test' });
    expect(second).toEqual({ sent: false, reason: 'ALREADY_SENT' });
    expect(mockAxios.post).toHaveBeenCalledTimes(1);
    expect(mockAxios.post).toHaveBeenCalledWith(
      'https://graph.facebook.com/v23.0/123456789012345/messages',
      expect.objectContaining({ to: '5521999990001' }),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer meta-test-token' })
      })
    );
  });

  it('skips when disabled or when the charge has no context', async () => {
    const redis = createRedis();
    await expect(sendPaymentConfirmedNotification({ redis, chargeId: 'c1', env: {} }))
      .resolves.toEqual({ sent: false, reason: 'DISABLED' });
    await expect(sendPaymentConfirmedNotification({
      redis, chargeId: 'c1', axiosClient: mockAxios, env: enabledEnv
    })).resolves.toEqual({ sent: false, reason: 'NO_CONTEXT' });
    expect(mockAxios.post).not.toHaveBeenCalled();
  });

  it('never throws and logs without the full phone when Meta fails', async () => {
    const redis = createRedis();
    await rememberPixChargeContext({
      redis, chargeId: 'c2', verifiedPhone: '+5521999990001', destination: 'Centro', env: enabledEnv
    });
    mockAxios.post.mockRejectedValue(Object.assign(new Error('boom'), { response: { status: 400 } }));

    await expect(sendPaymentConfirmedNotification({
      redis, chargeId: 'c2', amountInCents: 2490, axiosClient: mockAxios, env: enabledEnv
    })).resolves.toEqual({ sent: false, reason: 'DELIVERY_FAILED' });
    expect(logger.warn).toHaveBeenCalledWith(
      '[WHATSAPP PAYMENT] payment confirmed message failed',
      expect.objectContaining({ chargeId: 'c2', providerStatus: 400 })
    );
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('999990001');
  });
});
