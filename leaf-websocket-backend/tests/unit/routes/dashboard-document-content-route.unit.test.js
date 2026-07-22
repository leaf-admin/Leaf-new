'use strict';

jest.unmock('express');

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');

const mockDownloadStoragePath = jest.fn();
const mockRequireAuditEvent = jest.fn();
const mockResolveRuntimeForUser = jest.fn();
const mockRealtimeOnce = jest.fn();
const mockRealtimeRef = jest.fn(() => ({ once: mockRealtimeOnce }));
const mockRealtimeDb = { ref: mockRealtimeRef };

jest.mock('../../../middleware/jwt-auth', () => ({
  authenticateJWT(req, res, next) {
    const role = String(req.get('X-Test-Role') || '').trim();
    if (!role) {
      return res.status(401).json({ success: false, error: 'Token não fornecido' });
    }
    req.user = {
      id: 'reviewer-1',
      email: 'reviewer@leaf.test',
      role,
      permissions: String(req.get('X-Test-Permissions') || '')
        .split(',')
        .map((permission) => permission.trim())
        .filter(Boolean)
    };
    return next();
  },
  requireRole(roles) {
    return (req, res, next) => {
      if (!req.user) return res.status(401).json({ success: false, error: 'Não autenticado' });
      if (!roles.includes(req.user.role)) {
        return res.status(403).json({ success: false, error: 'Acesso negado' });
      }
      return next();
    };
  },
  requirePermission: () => (_req, _res, next) => next()
}));

jest.mock('../../../utils/jwt-secret-resolver', () => ({
  resolveJwtSecret: jest.fn(() => 'dashboard-document-content-test-secret')
}));

jest.mock('../../../utils/redis-pool', () => ({
  ensureConnection: jest.fn(async () => undefined),
  getConnection: jest.fn(() => null),
  shutdown: jest.fn(async () => undefined)
}));

jest.mock('../../../firebase-config', () => ({
  getRealtimeDB: jest.fn(() => mockRealtimeDb),
  getFirestore: jest.fn(),
  initializeFirebase: jest.fn()
}));

jest.mock('../../../services/firebase-storage-service', () => (
  jest.fn().mockImplementation(() => ({
    downloadStoragePath: (...args) => mockDownloadStoragePath(...args)
  }))
));

jest.mock('../../../services/audit-service', () => ({
  requireEvent: (...args) => mockRequireAuditEvent(...args)
}));

jest.mock('../../../services/kyc-runtime-scope-service', () => ({
  resolveForUser: (...args) => mockResolveRuntimeForUser(...args)
}));

jest.mock('../../../services/kyc-policy-service', () => ({}));

jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn(),
  logError: jest.fn(),
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }
}));

const dashboardRoutes = require('../../../routes/dashboard');

const DOCUMENT_BUFFER = Buffer.from('%PDF-1.4\nleaf canonical document');
const DOCUMENT_SHA256 = crypto.createHash('sha256').update(DOCUMENT_BUFFER).digest('hex');
const STORAGE_GENERATION = '1784000000000000';

function operationalRuntime() {
  return {
    scope: {
      namespace: 'operational',
      financialContext: {
        contextId: 'operational-context-1',
        providerEnvironment: 'production',
        testUserSandbox: false
      },
      financialContextId: 'operational-context-1'
    },
    workflow: {},
    evidence: {},
    trust: {}
  };
}

function sandboxRuntime() {
  return {
    scope: {
      namespace: 'sandbox',
      financialContext: {
        contextId: 'sandbox-context-1',
        testUserSandbox: true
      },
      financialContextId: 'sandbox-context-1'
    },
    workflow: {},
    evidence: {},
    trust: {}
  };
}

function canonicalDocument(overrides = {}) {
  return {
    filePath: 'driver-activation/driver-1/cnh/current.pdf',
    storageGeneration: STORAGE_GENERATION,
    documentSha256: DOCUMENT_SHA256,
    fileName: 'cnh-aprovada.pdf',
    fileType: 'application/pdf',
    submissionId: 'submission-1',
    ...overrides
  };
}

function setDocument(document = canonicalDocument()) {
  mockRealtimeOnce.mockResolvedValue({
    exists: () => true,
    val: () => document
  });
}

function setStoredObject(overrides = {}) {
  mockDownloadStoragePath.mockResolvedValue({
    buffer: DOCUMENT_BUFFER,
    metadata: {
      generation: STORAGE_GENERATION,
      contentType: 'application/pdf',
      customMetadata: {
        driverId: 'driver-1',
        documentType: 'cnh'
      },
      ...overrides
    }
  });
}

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/', dashboardRoutes);
  return app;
}

function getDocument({
  role = 'admin',
  permissions = '',
  driverId = 'driver-1',
  documentType = 'cnh',
  scope
} = {}) {
  let call = request(createApp())
    .get(`/api/drivers/${encodeURIComponent(driverId)}/documents/${encodeURIComponent(documentType)}/content`);
  if (role) call = call.set('X-Test-Role', role);
  if (permissions) call = call.set('X-Test-Permissions', permissions);
  if (scope) call = call.query({ scope });
  return call;
}

describe('GET /api/drivers/:driverId/documents/:documentType/content', () => {
  beforeEach(() => {
    mockResolveRuntimeForUser.mockResolvedValue(operationalRuntime());
    setDocument();
    setStoredObject();
    mockRequireAuditEvent.mockResolvedValue({ success: true, logId: 'audit-1' });
  });

  it('requires authentication before resolving scope or reading document state', async () => {
    const response = await getDocument({ role: null });

    expect(response.status).toBe(401);
    expect(mockResolveRuntimeForUser).not.toHaveBeenCalled();
    expect(mockRealtimeRef).not.toHaveBeenCalled();
    expect(mockDownloadStoragePath).not.toHaveBeenCalled();
  });

  it('restricts document content to KYC review roles before downstream access', async () => {
    const response = await getDocument({ role: 'support' });

    expect(response.status).toBe(403);
    expect(mockResolveRuntimeForUser).not.toHaveBeenCalled();
    expect(mockRealtimeRef).not.toHaveBeenCalled();
    expect(mockDownloadStoragePath).not.toHaveBeenCalled();
  });

  it('rejects an authoritative sandbox driver from the default operational scope', async () => {
    mockResolveRuntimeForUser.mockResolvedValue(sandboxRuntime());

    const response = await getDocument();

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      success: false,
      code: 'KYC_DASHBOARD_SCOPE_USER_MISMATCH'
    });
    expect(mockRealtimeRef).not.toHaveBeenCalled();
    expect(mockDownloadStoragePath).not.toHaveBeenCalled();
  });

  it('denies sandbox document access without support:sandbox permission', async () => {
    mockResolveRuntimeForUser.mockResolvedValue(sandboxRuntime());

    const response = await getDocument({ scope: 'sandbox' });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      success: false,
      code: 'KYC_DASHBOARD_SANDBOX_ACCESS_DENIED',
      message: 'Você não tem permissão para abrir este documento.'
    });
    expect(mockRealtimeRef).not.toHaveBeenCalled();
    expect(mockDownloadStoragePath).not.toHaveBeenCalled();
  });

  it.each([
    [
      'another driver',
      canonicalDocument({ filePath: 'driver-activation/driver-2/cnh/current.pdf' })
    ],
    [
      'another document type',
      canonicalDocument({ filePath: 'driver-activation/driver-1/crlv/current.pdf' })
    ]
  ])('rejects a current binding for %s before Storage download', async (_label, document) => {
    setDocument(document);

    const response = await getDocument();

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('DRIVER_DOCUMENT_BINDING_PATH_MISMATCH');
    expect(mockDownloadStoragePath).not.toHaveBeenCalled();
    expect(mockRequireAuditEvent).not.toHaveBeenCalled();
  });

  it('rejects an unsupported or path-shaped type before scope and Storage access', async () => {
    const response = await getDocument({ documentType: '..%2Fcrlv' });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('DRIVER_DOCUMENT_TYPE_INVALID');
    expect(mockResolveRuntimeForUser).not.toHaveBeenCalled();
    expect(mockRealtimeRef).not.toHaveBeenCalled();
    expect(mockDownloadStoragePath).not.toHaveBeenCalled();
  });

  it('fails closed when Storage reports a generation mismatch', async () => {
    const generationError = new Error('generation mismatch');
    generationError.code = 'FIREBASE_STORAGE_GENERATION_MISMATCH';
    mockDownloadStoragePath.mockRejectedValue(generationError);

    const response = await getDocument();

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      success: false,
      code: 'FIREBASE_STORAGE_GENERATION_MISMATCH'
    });
    expect(mockDownloadStoragePath).toHaveBeenCalledWith(
      'driver-activation/driver-1/cnh/current.pdf',
      { generation: STORAGE_GENERATION, includeMetadata: true }
    );
    expect(mockRequireAuditEvent).not.toHaveBeenCalled();
  });

  it('fails closed when the downloaded bytes do not match the canonical hash', async () => {
    setDocument(canonicalDocument({ documentSha256: 'a'.repeat(64) }));

    const response = await getDocument();

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('DRIVER_DOCUMENT_INTEGRITY_MISMATCH');
    expect(mockRequireAuditEvent).not.toHaveBeenCalled();
  });

  it.each([
    ['driver', { driverId: 'driver-2', documentType: 'cnh' }],
    ['type', { driverId: 'driver-1', documentType: 'crlv' }]
  ])('fails closed when Storage custom metadata has a different %s', async (_label, customMetadata) => {
    setStoredObject({ customMetadata });

    const response = await getDocument();

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('DRIVER_DOCUMENT_BINDING_METADATA_MISMATCH');
    expect(mockRequireAuditEvent).not.toHaveBeenCalled();
  });

  it('does not stream bytes when the sensitive-access audit cannot be persisted', async () => {
    const auditError = new Error('audit unavailable');
    auditError.code = 'AUDIT_WRITE_UNAVAILABLE';
    mockRequireAuditEvent.mockRejectedValue(auditError);

    const response = await getDocument();

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      success: false,
      code: 'AUDIT_WRITE_UNAVAILABLE'
    });
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(mockRequireAuditEvent).toHaveBeenCalledTimes(1);
  });

  it('streams the integrity-bound blob with private no-store headers after audit succeeds', async () => {
    const response = await getDocument();

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/application\/pdf/);
    expect(response.headers['cache-control']).toBe('private, no-store, max-age=0');
    expect(response.headers.pragma).toBe('no-cache');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-disposition']).toBe('inline; filename="cnh-aprovada.pdf"');
    expect(Buffer.isBuffer(response.body)).toBe(true);
    expect(response.body).toEqual(DOCUMENT_BUFFER);
    expect(mockRequireAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'reviewer-1',
      action: 'driver.document_content_view',
      resource: 'driver_document',
      success: true,
      details: expect.objectContaining({
        driverId: 'driver-1',
        documentType: 'cnh',
        submissionId: 'submission-1'
      })
    }));
    expect(mockRequireAuditEvent.mock.calls[0][0].details).not.toHaveProperty('filePath');
  });

  it('allows a matching sandbox scope only with permission and audits the sandbox envelope', async () => {
    mockResolveRuntimeForUser.mockResolvedValue(sandboxRuntime());

    const response = await getDocument({
      scope: 'sandbox',
      permissions: 'support:sandbox'
    });

    expect(response.status).toBe(200);
    expect(mockRequireAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      financialNamespace: 'sandbox',
      financialContextId: 'sandbox-context-1',
      testUserSandbox: true
    }));
  });
});
