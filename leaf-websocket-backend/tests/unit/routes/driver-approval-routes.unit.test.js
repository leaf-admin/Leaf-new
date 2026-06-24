jest.unmock('express');

const express = require('express');
const request = require('supertest');

const mockApproveDriver = jest.fn();
const mockAuthenticateJWT = jest.fn((req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ success: false, error: 'Token nao fornecido' });
  }
  req.user = { id: 'admin_1', uid: 'admin_1', role: token, email: 'admin@leaf.test' };
  return next();
});
const mockRequireRole = jest.fn((roles) => (req, res, next) => {
  if (!roles.includes(req.user?.role)) {
    return res.status(403).json({ success: false, error: 'Acesso negado' });
  }
  return next();
});

jest.mock('../../../middleware/jwt-auth', () => ({
  authenticateJWT: mockAuthenticateJWT,
  requireRole: mockRequireRole
}));

jest.mock('../../../services/driver-approval-service', () =>
  jest.fn().mockImplementation(() => ({
    approveDriver: (...args) => mockApproveDriver(...args),
    processRideEarnings: jest.fn(),
    checkDriverWooviAccount: jest.fn(),
    createWooviAccountForExistingDriver: jest.fn()
  }))
);

jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn(),
  logError: jest.fn()
}));

function createApp() {
  jest.resetModules();
  const routes = require('../../../routes/driver-approval');
  const app = express();
  app.use(express.json());
  app.use('/driver-approval', routes);
  return app;
}

describe('driver approval routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockApproveDriver.mockResolvedValue({
      success: true,
      message: 'ok',
      driverData: { id: 'driver_1' },
      wooviClientId: 'subaccount_1'
    });
  });

  it('passes authenticated admin audit trail into manual driver approval', async () => {
    const response = await request(createApp())
      .post('/driver-approval/approve')
      .set('Authorization', 'Bearer admin')
      .send({
        driverId: 'driver_1',
        name: 'Motorista Leaf',
        email: 'driver@leaf.test',
        phone: '+5521999990000',
        cpf: '12345678909',
        approvalReason: 'Documentos e KYC revisados manualmente',
        provenance: 'driver_approval_dashboard',
        evidenceRefs: ['doc_review_1']
      });

    expect(response.status).toBe(200);
    expect(mockApproveDriver).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'driver_1',
        approvalAudit: expect.objectContaining({
          actorId: 'admin_1',
          actorRole: 'admin',
          reason: 'Documentos e KYC revisados manualmente',
          provenance: 'driver_approval_dashboard',
          evidence: ['doc_review_1']
        })
      })
    );
  });

  it('keeps service audit validation errors as a 400 response', async () => {
    mockApproveDriver.mockResolvedValueOnce({
      success: false,
      error: 'APPROVAL_AUDIT_REQUIRED',
      details: 'Aprovação manual exige actorId, actorRole, reason, provenance e evidence.'
    });

    const response = await request(createApp())
      .post('/driver-approval/approve')
      .set('Authorization', 'Bearer admin')
      .send({
        driverId: 'driver_1',
        name: 'Motorista Leaf',
        email: 'driver@leaf.test',
        phone: '+5521999990000',
        cpf: '12345678909'
      });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      success: false,
      error: 'APPROVAL_AUDIT_REQUIRED'
    });
  });

  it('returns conflict when canonical driver evidence blocks manual approval', async () => {
    mockApproveDriver.mockResolvedValueOnce({
      success: false,
      error: 'CANONICAL_DRIVER_EVIDENCE_REQUIRED',
      details: 'Aprovação manual não substitui CNH válida, CRLV/veículo ativo, liveness, face compare e demais evidências canônicas.',
      activationStatus: {
        canGoOnline: false,
        activationState: 'APPROVED_NEEDS_LIVENESS'
      }
    });

    const response = await request(createApp())
      .post('/driver-approval/approve')
      .set('Authorization', 'Bearer admin')
      .send({
        driverId: 'driver_1',
        name: 'Motorista Leaf',
        email: 'driver@leaf.test',
        phone: '+5521999990000',
        cpf: '12345678909',
        approvalReason: 'Documentos e KYC revisados manualmente',
        provenance: 'driver_approval_dashboard',
        evidenceRefs: ['doc_review_1']
      });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      success: false,
      error: 'CANONICAL_DRIVER_EVIDENCE_REQUIRED',
      activationStatus: {
        canGoOnline: false,
        activationState: 'APPROVED_NEEDS_LIVENESS'
      }
    });
  });

  it('returns unavailable when canonical driver evidence cannot be checked', async () => {
    mockApproveDriver.mockResolvedValueOnce({
      success: false,
      error: 'CANONICAL_DRIVER_EVIDENCE_CHECK_FAILED',
      details: 'activation read failed'
    });

    const response = await request(createApp())
      .post('/driver-approval/approve')
      .set('Authorization', 'Bearer admin')
      .send({
        driverId: 'driver_1',
        name: 'Motorista Leaf',
        email: 'driver@leaf.test',
        phone: '+5521999990000',
        cpf: '12345678909',
        approvalReason: 'Documentos e KYC revisados manualmente',
        provenance: 'driver_approval_dashboard',
        evidenceRefs: ['doc_review_1']
      });

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      success: false,
      error: 'CANONICAL_DRIVER_EVIDENCE_CHECK_FAILED',
      activationStatus: null
    });
  });
});
