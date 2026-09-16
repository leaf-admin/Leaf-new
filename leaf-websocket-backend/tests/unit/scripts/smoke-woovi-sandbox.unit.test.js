const {
  isChargeNotFoundResponse,
  resolveChargeReference,
} = require('../../../scripts/tests/smoke-woovi-sandbox.cjs');

describe('Woovi sandbox smoke cleanup contract', () => {
  it('prefers the provider identifier over the correlation id for cleanup', () => {
    expect(resolveChargeReference({
      correlationID: 'leaf-correlation',
      identifier: 'woovi-identifier',
      transactionID: 'woovi-transaction',
    }, 'fallback')).toBe('woovi-identifier');
  });

  it('recognizes provider not-found responses during cleanup verification', () => {
    expect(isChargeNotFoundResponse({
      status: 400,
      data: { error: 'Cobrança não encontrada' },
    })).toBe(true);
    expect(isChargeNotFoundResponse({
      status: 404,
      data: 'Not Found',
    })).toBe(true);
    expect(isChargeNotFoundResponse({
      status: 400,
      data: { error: 'invalid charge' },
    })).toBe(false);
  });
});
