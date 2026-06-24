const mockCreateSubaccount = jest.fn();
const mockCreateDriverBaaSAccount = jest.fn();
const mockCreateDriverClient = jest.fn();
const mockRecomputeDriverActivationStatus = jest.fn();

jest.mock('../../../services/woovi-driver-service', () =>
  jest.fn().mockImplementation(() => ({
    createSubaccount: mockCreateSubaccount,
    createDriverBaaSAccount: mockCreateDriverBaaSAccount,
    createDriverClient: mockCreateDriverClient
  }))
);

jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn(),
  logError: jest.fn()
}));

jest.mock('../../../services/driver-document-analysis-queue', () => ({
  recomputeDriverActivationStatus: (...args) => mockRecomputeDriverActivationStatus(...args)
}));

const docs = new Map();

function createFirestoreMock() {
  return {
    collection: (collectionName) => ({
      doc: (id) => ({
        set: async (payload, options = {}) => {
          const key = `${collectionName}/${id}`;
          const previous = docs.get(key) || {};
          docs.set(key, options.merge ? { ...previous, ...payload } : { ...payload });
        },
        get: async () => {
          const key = `${collectionName}/${id}`;
          return {
            exists: docs.has(key),
            data: () => docs.get(key)
          };
        }
      })
    })
  };
}

jest.mock('../../../firebase-config', () => ({
  getFirestore: jest.fn(() => createFirestoreMock())
}));

const DriverApprovalService = require('../../../services/driver-approval-service');
const firebaseConfig = require('../../../firebase-config');

function buildApprovalAudit(overrides = {}) {
  return {
    actorId: 'admin_1',
    actorRole: 'admin',
    reason: 'Documentos e KYC revisados manualmente',
    provenance: 'driver_approval_dashboard',
    evidence: [{ type: 'document_review', ref: 'review_1' }],
    ...overrides
  };
}

describe('DriverApprovalService Woovi subaccount integration', () => {
  beforeEach(() => {
    docs.clear();
    jest.clearAllMocks();
    firebaseConfig.getFirestore.mockReturnValue(createFirestoreMock());
    mockRecomputeDriverActivationStatus.mockResolvedValue({
      canGoOnline: true,
      activationState: 'ACTIVE',
      checklist: {
        cnhEar: true,
        vehicleRegistration: true,
        backgroundCheckConsent: true
      },
      vehicle: {
        approved: true,
        plate: 'LEF2042',
        color: 'Prata'
      },
      liveness: {
        passed: true
      },
      faceCompare: {
        passed: true
      }
    });
    mockCreateSubaccount.mockResolvedValue({
      success: true,
      pixKey: 'driver-pix-key',
      subaccount: {
        id: 'subaccount_1',
        pixKey: 'driver-pix-key'
      }
    });
    mockCreateDriverBaaSAccount.mockResolvedValue({
      success: false,
      useFallback: true
    });
    mockCreateDriverClient.mockResolvedValue({
      success: true,
      wooviClientId: 'customer_1'
    });
  });

  it('approves driver with Woovi subaccount when pix key is available', async () => {
    const service = new DriverApprovalService();

    const result = await service.approveDriver({
      id: 'driver_1',
      name: 'Motorista Leaf',
      email: 'driver@leaf.app.br',
      phone: '+5521999990000',
      cpf: '12345678909',
      pixKey: 'driver-pix-key',
      approvalAudit: buildApprovalAudit()
    });

    expect(result).toMatchObject({
      success: true,
      wooviAccountId: 'subaccount_1',
      wooviSubaccountPixKey: 'driver-pix-key'
    });
    expect(mockCreateSubaccount).toHaveBeenCalledWith({
      name: 'Motorista Leaf',
      email: 'driver@leaf.app.br',
      phone: '+5521999990000',
      taxID: '12345678909',
      pixKey: 'driver-pix-key'
    });
    expect(mockCreateDriverBaaSAccount).not.toHaveBeenCalled();
    expect(docs.get('users/driver_1')).toMatchObject({
      wooviSubaccountId: 'subaccount_1',
      wooviSubaccountPixKey: 'driver-pix-key',
      baasAccountCreated: false,
      fallbackToCustomer: false,
      isApproved: true,
      approvalAuditActorId: 'admin_1',
      approvalAuditProvenance: 'driver_approval_dashboard'
    });
    expect(docs.get('users/driver_1').approvalAuditTrail).toMatchObject({
      actorId: 'admin_1',
      reason: 'Documentos e KYC revisados manualmente',
      canonicalEvidenceConfirmed: true,
      activationStatus: expect.objectContaining({
        canGoOnline: true,
        activationState: 'ACTIVE'
      }),
      previousState: {
        exists: false
      },
      nextState: expect.objectContaining({
        driverStatus: 'approved'
      })
    });
  });

  it('rejects manual approval when canonical driver evidence is incomplete before calling Woovi', async () => {
    mockRecomputeDriverActivationStatus.mockResolvedValueOnce({
      canGoOnline: false,
      activationState: 'APPROVED_NEEDS_LIVENESS',
      blockingReason: 'Primeira validacao facial obrigatoria antes de ficar online.',
      checklist: {
        cnhEar: true,
        vehicleRegistration: true,
        backgroundCheckConsent: true
      },
      vehicle: {
        approved: true
      },
      liveness: {
        passed: false
      },
      faceCompare: {
        passed: false
      }
    });
    const service = new DriverApprovalService();

    const result = await service.approveDriver({
      id: 'driver_missing_liveness',
      name: 'Motorista Leaf',
      email: 'driver4@leaf.app.br',
      phone: '+5521999990004',
      cpf: '12345678909',
      pixKey: 'driver-pix-key',
      approvalAudit: buildApprovalAudit()
    });

    expect(result).toMatchObject({
      success: false,
      error: 'CANONICAL_DRIVER_EVIDENCE_REQUIRED',
      activationStatus: expect.objectContaining({
        canGoOnline: false,
        activationState: 'APPROVED_NEEDS_LIVENESS'
      })
    });
    expect(mockCreateSubaccount).not.toHaveBeenCalled();
    expect(mockCreateDriverClient).not.toHaveBeenCalled();
    expect(docs.get('users/driver_missing_liveness')).toEqual(undefined);
  });

  it('fails closed when canonical driver evidence cannot be checked', async () => {
    mockRecomputeDriverActivationStatus.mockRejectedValueOnce(new Error('activation read failed'));
    const service = new DriverApprovalService();

    const result = await service.approveDriver({
      id: 'driver_evidence_unavailable',
      name: 'Motorista Leaf',
      email: 'driver5@leaf.app.br',
      phone: '+5521999990005',
      cpf: '12345678909',
      pixKey: 'driver-pix-key',
      approvalAudit: buildApprovalAudit()
    });

    expect(result).toMatchObject({
      success: false,
      error: 'CANONICAL_DRIVER_EVIDENCE_CHECK_FAILED',
      details: 'activation read failed'
    });
    expect(mockCreateSubaccount).not.toHaveBeenCalled();
    expect(mockCreateDriverClient).not.toHaveBeenCalled();
    expect(docs.get('users/driver_evidence_unavailable')).toEqual(undefined);
  });

  it('rejects manual driver approval without audit trail before calling Woovi', async () => {
    const service = new DriverApprovalService();

    const result = await service.approveDriver({
      id: 'driver_missing_audit',
      name: 'Motorista Leaf',
      email: 'driver3@leaf.app.br',
      phone: '+5521999990002',
      cpf: '12345678909',
      pixKey: 'driver-pix-key'
    });

    expect(result).toMatchObject({
      success: false,
      error: 'APPROVAL_AUDIT_REQUIRED'
    });
    expect(mockCreateSubaccount).not.toHaveBeenCalled();
    expect(mockCreateDriverClient).not.toHaveBeenCalled();
    expect(mockRecomputeDriverActivationStatus).not.toHaveBeenCalled();
  });

  it('falls back to customer flow without creating legacy BaaS when driver pix key is missing', async () => {
    const service = new DriverApprovalService();

    const result = await service.approveDriver({
      id: 'driver_2',
      name: 'Motorista Leaf',
      email: 'driver2@leaf.app.br',
      phone: '+5521999990001',
      cpf: '12345678909',
      approvalAudit: buildApprovalAudit({ evidence: ['review_2'] })
    });

    expect(result).toMatchObject({
      success: true,
      wooviClientId: 'customer_1'
    });
    expect(mockCreateSubaccount).not.toHaveBeenCalled();
    expect(mockCreateDriverBaaSAccount).not.toHaveBeenCalled();
    expect(mockCreateDriverClient).toHaveBeenCalled();
    expect(docs.get('users/driver_2')).toMatchObject({
      baasAccountCreated: false,
      baasUpgradePending: false,
      fallbackToCustomer: true,
      isApproved: true,
      approvalAuditActorId: 'admin_1'
    });
  });

  it('does not mark an existing driver approved when only creating a Woovi subaccount', async () => {
    const service = new DriverApprovalService();

    const result = await service.createWooviAccountForExistingDriver({
      id: 'driver_payment_account_only',
      name: 'Motorista Leaf',
      email: 'driver6@leaf.app.br',
      phone: '+5521999990006',
      cpf: '12345678909',
      pixKey: 'driver-pix-key'
    });

    expect(result).toMatchObject({
      success: true,
      wooviClientId: 'subaccount_1'
    });
    expect(docs.get('users/driver_payment_account_only')).toMatchObject({
      wooviSubaccountId: 'subaccount_1',
      wooviSubaccountPixKey: 'driver-pix-key',
      wooviSubaccountCreated: true
    });
    expect(docs.get('users/driver_payment_account_only')).not.toHaveProperty('isApproved');
    expect(docs.get('users/driver_payment_account_only')).not.toHaveProperty('approvedAt');
    expect(docs.get('users/driver_payment_account_only')).not.toHaveProperty('approvalAuditTrail');
  });
});
