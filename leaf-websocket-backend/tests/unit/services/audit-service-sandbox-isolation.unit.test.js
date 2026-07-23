const addedDocuments = new Map();

const firestore = {
  collection: jest.fn((name) => ({
    add: jest.fn(async (data) => {
      const id = `${name}_1`;
      addedDocuments.set(`${name}/${id}`, data);
      return { id };
    })
  }))
};

jest.mock('../../../firebase-config', () => ({
  getFirestore: jest.fn(() => firestore)
}));

jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn(),
  logError: jest.fn()
}));

jest.mock('../../../services/payment-runtime-profile-service', () => ({
  resolveProfile: jest.fn()
}));

const { sealFinancialContext } = require('../../../services/financial-runtime-context');
const paymentRuntimeProfileService = require('../../../services/payment-runtime-profile-service');
const auditService = require('../../../services/audit-service');

describe('audit service sandbox isolation', () => {
  beforeEach(() => {
    addedDocuments.clear();
    jest.clearAllMocks();
    paymentRuntimeProfileService.resolveProfile.mockResolvedValue({
      profileId: 'env-default',
      environment: 'production',
      source: 'env',
      testUserSandbox: false
    });
  });

  it('writes a sealed QA ride audit only to sandbox_audit_logs', async () => {
    const financialContext = sealFinancialContext({
      providerEnvironment: 'sandbox',
      paymentProfileId: 'qa-test-users-sandbox-durable',
      paymentProfileSource: 'firestore',
      testUserSandbox: true
    });

    const result = await auditService.logRideAction(
      'qa_passenger',
      'createBooking',
      'ride_qa_1',
      {
        financialContext,
        financialNamespace: 'sandbox',
        financialContextId: financialContext.contextId,
        providerEnvironment: 'sandbox',
        testUserSandbox: true
      }
    );

    expect(result.success).toBe(true);
    expect(firestore.collection).toHaveBeenCalledWith('sandbox_audit_logs');
    expect(firestore.collection).not.toHaveBeenCalledWith('audit_logs');
    expect([...addedDocuments.values()][0]).toMatchObject({
      userId: 'qa_passenger',
      financialNamespace: 'sandbox',
      financialContextId: financialContext.contextId
    });
  });

  it('keeps a legacy context-less audit operational', async () => {
    const result = await auditService.logRideAction(
      'operational_user',
      'createBooking',
      'ride_operational_1'
    );

    expect(result.success).toBe(true);
    expect(firestore.collection).toHaveBeenCalledWith('audit_logs');
    expect(firestore.collection).not.toHaveBeenCalledWith('sandbox_audit_logs');
  });

  it('classifies a context-less test-user failure before choosing the audit collection', async () => {
    paymentRuntimeProfileService.resolveProfile.mockResolvedValueOnce({
      profileId: 'qa-test-users-sandbox-durable',
      environment: 'sandbox',
      source: 'firestore',
      testUserSandbox: true
    });

    const result = await auditService.logSecurityAction(
      'qa_passenger',
      'rateLimitExceeded',
      'createBooking',
      { reason: 'test' }
    );

    expect(result.success).toBe(true);
    expect(paymentRuntimeProfileService.resolveProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'qa_passenger',
        uid: 'qa_passenger'
      })
    );
    expect(firestore.collection).toHaveBeenCalledWith('sandbox_audit_logs');
    expect(firestore.collection).not.toHaveBeenCalledWith('audit_logs');
  });

  it('fails closed without writing when a sandbox signal lost its seal', async () => {
    const result = await auditService.logRideAction(
      'qa_passenger',
      'createBooking',
      'ride_lost_context',
      {
        financialNamespace: 'sandbox',
        providerEnvironment: 'sandbox'
      }
    );

    expect(result).toMatchObject({ success: false });
    expect(firestore.collection).not.toHaveBeenCalled();
  });
});
