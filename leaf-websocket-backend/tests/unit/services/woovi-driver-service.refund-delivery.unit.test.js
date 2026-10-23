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

    await expect(service.processRefund('charge_1', 3646, 'motivo', { refundCorrelationId: 'refund_operation_1' })).resolves.toMatchObject({
      success: false,
      errorCode: 'ECONNREFUSED',
      providerDelivery: 'NOT_SENT'
    });
    await expect(service.processRefund('charge_1', 3646, 'motivo', { refundCorrelationId: 'refund_operation_1' })).resolves.toMatchObject({
      success: false,
      errorCode: 'ECONNABORTED',
      providerDelivery: 'UNKNOWN'
    });
    await expect(service.processRefund('charge_1', 3646, 'motivo', { refundCorrelationId: 'refund_operation_1' })).resolves.toEqual({
      success: true,
      refundId: 'refund_1',
      refund: { id: 'refund_1' }
    });
    expect(post).toHaveBeenCalledWith('/charge/charge_1/refund', {
      correlationID: 'refund_operation_1', value: 3646, comment: 'motivo'
    });
  });

  it.each([400, 401, 404, 422, 502])('não registra sucesso se o Axios resolver uma resposta HTTP %s', async (status) => {
    const error = { errors: [{ message: 'provider refusal' }] };
    const post = jest.fn().mockResolvedValue({ status, data: error });
    const service = Object.create(WooviDriverService.prototype);
    service.api = { post };

    await expect(service.processRefund('charge_1', 3646, 'motivo', { refundCorrelationId: 'refund_operation_1' })).resolves.toMatchObject({
      success: false,
      error,
      httpStatus: status,
      providerDelivery: status < 500 ? 'REJECTED' : 'UNKNOWN'
    });
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('requires the durable operation ID before sending any refund', async () => {
    const service = Object.create(WooviDriverService.prototype);
    service.api = { post: jest.fn() };
    await expect(service.processRefund('charge_1', 100, 'reason')).resolves.toMatchObject({
      success: false, code: 'REFUND_CORRELATION_ID_REQUIRED', providerDelivery: 'NOT_SENT'
    });
    expect(service.api.post).not.toHaveBeenCalled();
  });

  it('sends the required contract and preserves the provider correlation reference', async () => {
    const post = jest.fn(async (url, body) => {
      expect(url).toBe('/charge/charge%2Fwith%25reserved/refund');
      expect(body).toEqual({ correlationID: 'durable_operation_id', value: 100, comment: 'reason' });
      return { status: 200, data: { refund: {
        status: 'IN_PROCESSING', value: 100, correlationID: body.correlationID
      } } };
    });
    const service = Object.create(WooviDriverService.prototype);
    service.api = { post };
    await expect(service.processRefund('charge/with%reserved', 100, 'reason', {
      refundCorrelationId: 'durable_operation_id'
    })).resolves.toMatchObject({ success: true, refundId: 'durable_operation_id' });
    expect(post).toHaveBeenCalledTimes(1);
  });
});
