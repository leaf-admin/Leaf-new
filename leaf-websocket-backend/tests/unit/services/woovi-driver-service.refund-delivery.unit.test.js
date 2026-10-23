jest.mock('../../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  logStructured: jest.fn(),
  logError: jest.fn()
}));

const WooviDriverService = require('../../../services/woovi-driver-service');

const { classifyRefundProviderDelivery } = WooviDriverService;

describe('WooviDriverService - entrega do pedido de reembolso', () => {
  it('só considera não enviado quando a conexão nem foi aberta', () => {
    ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH'].forEach((code) => {
      expect(classifyRefundProviderDelivery({ code })).toBe('NOT_SENT');
    });
  });

  it('trata timeout, conexão derrubada e erro sem código como resultado desconhecido', () => {
    ['ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET', 'EPIPE', 'ERR_BAD_RESPONSE', undefined].forEach((code) => {
      expect(classifyRefundProviderDelivery({ code, message: 'timeout of 30000ms exceeded' })).toBe('UNKNOWN');
    });
    expect(classifyRefundProviderDelivery()).toBe('UNKNOWN');
  });

  it('separa a recusa do provedor (4xx) do erro do provedor (5xx)', () => {
    expect(classifyRefundProviderDelivery({ response: { status: 400 } })).toBe('REJECTED');
    expect(classifyRefundProviderDelivery({ response: { status: 404 } })).toBe('REJECTED');
    expect(classifyRefundProviderDelivery({ response: { status: 500 } })).toBe('UNKNOWN');
    expect(classifyRefundProviderDelivery({ response: { status: 504 }, code: 'ECONNREFUSED' })).toBe('UNKNOWN');
  });

  it('devolve a classificação junto com a falha do reembolso sem mudar o pedido enviado', async () => {
    const post = jest.fn()
      .mockRejectedValueOnce(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }))
      .mockRejectedValueOnce(Object.assign(new Error('timeout of 30000ms exceeded'), { code: 'ECONNABORTED' }))
      .mockResolvedValueOnce({ status: 200, data: { refund: { id: 'refund_1' } } });
    const service = Object.create(WooviDriverService.prototype);
    service.api = { post };

    await expect(service.processRefund('charge_1', 3646, 'motivo')).resolves.toMatchObject({
      success: false,
      errorCode: 'ECONNREFUSED',
      providerDelivery: 'NOT_SENT'
    });
    await expect(service.processRefund('charge_1', 3646, 'motivo')).resolves.toMatchObject({
      success: false,
      errorCode: 'ECONNABORTED',
      providerDelivery: 'UNKNOWN'
    });
    await expect(service.processRefund('charge_1', 3646, 'motivo')).resolves.toEqual({
      success: true,
      refundId: 'refund_1',
      refund: { id: 'refund_1' }
    });
    expect(post).toHaveBeenCalledWith('/charge/charge_1/refund', { value: 3646, comment: 'motivo' });
  });

  it.each([400, 401, 404, 422, 502])('não registra sucesso se o Axios resolver uma resposta HTTP %s', async (status) => {
    const error = { errors: [{ message: 'provider refusal' }] };
    const post = jest.fn().mockResolvedValue({ status, data: error });
    const service = Object.create(WooviDriverService.prototype);
    service.api = { post };

    await expect(service.processRefund('charge_1', 3646, 'motivo')).resolves.toMatchObject({
      success: false,
      error,
      httpStatus: status,
      providerDelivery: status < 500 ? 'REJECTED' : 'UNKNOWN'
    });
    expect(post).toHaveBeenCalledTimes(1);
  });
});
