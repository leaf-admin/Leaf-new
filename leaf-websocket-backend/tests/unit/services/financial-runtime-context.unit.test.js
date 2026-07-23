const {
  FINANCIAL_COLLECTIONS,
  sealFinancialContext,
  resolveFinancialContext,
  getFinancialCollections,
  contextsMatch
} = require('../../../services/financial-runtime-context');

describe('financial-runtime-context', () => {
  it('seals durable test-user sandbox context into the isolated namespace', () => {
    const context = sealFinancialContext({
      providerEnvironment: 'sandbox',
      paymentProfileId: 'qa-test-users-sandbox-durable',
      paymentProfileSource: 'firestore',
      testUserSandbox: true
    });

    expect(context).toMatchObject({
      version: 1,
      namespace: 'sandbox',
      classification: 'sandbox_test_user',
      providerEnvironment: 'sandbox',
      testUserSandbox: true
    });
    expect(getFinancialCollections(context).collections).toEqual(FINANCIAL_COLLECTIONS.sandbox);
  });

  it('fails closed when a sandbox signal survives but the sealed context is lost', () => {
    expect(resolveFinancialContext({
      providerEnvironment: 'sandbox',
      paymentProfileId: 'qa-test-users-sandbox-durable'
    }, { allowLegacyOperational: true })).toMatchObject({
      ok: false,
      code: 'FINANCIAL_SANDBOX_CONTEXT_LOST'
    });
  });

  it('rejects a tampered immutable classification', () => {
    const context = sealFinancialContext({
      providerEnvironment: 'sandbox',
      paymentProfileId: 'qa-test-users-sandbox-durable',
      testUserSandbox: true
    });
    const tampered = { ...context, namespace: 'operational' };

    expect(resolveFinancialContext({ financialContext: tampered })).toMatchObject({
      ok: false,
      code: 'FINANCIAL_CONTEXT_INVALID'
    });
    expect(contextsMatch(context, tampered)).toBe(false);
  });

  it('keeps legacy records operational only when they carry no sandbox signal', () => {
    const result = resolveFinancialContext({}, { allowLegacyOperational: true });

    expect(result).toMatchObject({
      ok: true,
      legacy: true,
      context: {
        namespace: 'operational',
        providerEnvironment: 'production'
      }
    });
  });
});
