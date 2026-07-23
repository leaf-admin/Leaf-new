const crypto = require('crypto');

jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn(),
  logError: jest.fn()
}));

jest.mock('../../../firebase-config', () => ({
  getFirestore: jest.fn(() => null),
  getStorage: jest.fn(() => null)
}));

jest.mock('../../../services/audit-service', () => ({
  logEvent: jest.fn(async () => ({ success: true, logId: 'default-audit' }))
}));

const {
  KycFailedBiometricEvidenceService,
  REVIEW_OUTCOMES
} = require('../../../services/kyc-failed-biometric-evidence-service');

const EVIDENCE_ID = 'evidence_opaque_000000000001';
const DRIVER_ID = 'driver-private-identity';
const RAW_SESSION_ID = 'aws-liveness-session-secret';
const NOW_ISO = '2026-07-17T15:00:00.000Z';

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function clone(value) {
  if (value instanceof Date) return new Date(value.getTime());
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  }
  return value;
}

function merge(current, patch) {
  return { ...(current || {}), ...clone(patch) };
}

function createFakeFirestore() {
  const values = new Map();

  function makeSnapshot(path) {
    const value = values.get(path);
    return {
      exists: value !== undefined,
      id: path.split('/').pop(),
      data: () => clone(value)
    };
  }

  function makeRef(collectionName, id) {
    const path = `${collectionName}/${id}`;
    return {
      path,
      id,
      async get() {
        return makeSnapshot(path);
      },
      async create(value) {
        if (values.has(path)) {
          const error = new Error('already exists');
          error.code = 6;
          throw error;
        }
        values.set(path, clone(value));
      },
      async set(value, options = {}) {
        values.set(path, options.merge ? merge(values.get(path), value) : clone(value));
      },
      async delete() {
        values.delete(path);
      }
    };
  }

  const firestore = {
    collection(name) {
      return { doc: (id) => makeRef(name, id) };
    },
    async runTransaction(callback) {
      const writes = [];
      const transaction = {
        get: async (ref) => makeSnapshot(ref.path),
        set(ref, value, options = {}) {
          writes.push({ ref, value: clone(value), options });
        }
      };
      const result = await callback(transaction);
      for (const write of writes) {
        const current = values.get(write.ref.path);
        values.set(
          write.ref.path,
          write.options.merge ? merge(current, write.value) : clone(write.value)
        );
      }
      return result;
    }
  };

  return { firestore, values };
}

function createFakeStorage() {
  const objects = new Map();
  const calls = {
    bucket: [],
    file: [],
    save: [],
    getMetadata: [],
    getSignedUrl: [],
    delete: []
  };
  let nextGeneration = 1800000000000000n;

  function file(path, fileOptions) {
    calls.file.push({ path, options: clone(fileOptions) });
    return {
      async save(buffer, options) {
        calls.save.push({ path, buffer: Buffer.from(buffer), options: clone(options) });
        if (options?.preconditionOpts?.ifGenerationMatch === 0 && objects.has(path)) {
          const error = new Error('precondition failed');
          error.code = 412;
          throw error;
        }
        const generation = String(nextGeneration++);
        objects.set(path, {
          buffer: Buffer.from(buffer),
          generation,
          metadata: clone(options?.metadata || {})
        });
      },
      async getMetadata() {
        calls.getMetadata.push({ path, options: clone(fileOptions) });
        const object = objects.get(path);
        if (!object) {
          const error = new Error('not found');
          error.code = 404;
          throw error;
        }
        return [{
          generation: object.generation,
          size: String(object.buffer.length),
          ...clone(object.metadata)
        }];
      },
      async getSignedUrl(options) {
        calls.getSignedUrl.push({ path, fileOptions: clone(fileOptions), options: clone(options) });
        return [`https://signed.invalid/${path}?generation=${fileOptions?.generation || ''}`];
      },
      async delete(options) {
        calls.delete.push({ path, fileOptions: clone(fileOptions), options: clone(options) });
        const object = objects.get(path);
        if (!object) {
          if (options?.ignoreNotFound) return;
          throw new Error('not found');
        }
        if (fileOptions?.generation && String(fileOptions.generation) !== object.generation) {
          const error = new Error('generation mismatch');
          error.code = 412;
          throw error;
        }
        objects.delete(path);
      }
    };
  }

  const storage = {
    bucket(name) {
      calls.bucket.push(name);
      return { file };
    }
  };

  return { storage, objects, calls };
}

function createHarness({ auditSuccess = true } = {}) {
  const { firestore, values } = createFakeFirestore();
  const { storage, objects, calls } = createFakeStorage();
  const auditEvents = [];
  let currentTime = new Date(NOW_ISO);
  const audit = {
    logEvent: jest.fn(async (event) => {
      auditEvents.push(clone(event));
      return auditSuccess
        ? { success: true, logId: `audit-${auditEvents.length}` }
        : { success: false, error: 'audit unavailable' };
    })
  };
  const service = new KycFailedBiometricEvidenceService({
    firestoreProvider: () => firestore,
    storageProvider: () => storage,
    auditService: audit,
    now: () => new Date(currentTime.getTime()),
    idGenerator: () => EVIDENCE_ID,
    bucketName: 'leaf-private-test-bucket'
  });

  return {
    service,
    values,
    objects,
    storageCalls: calls,
    audit,
    auditEvents,
    setNow(value) {
      currentTime = new Date(value);
    }
  };
}

function buildInput(overrides = {}) {
  const referenceImageBuffer = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01
  ]);
  const input = {
    driverId: DRIVER_ID,
    referenceImageBuffer,
    liveness: {
      provider: 'aws_rekognition_face_liveness',
      status: 'SUCCEEDED',
      livenessPassed: true,
      sessionIdHash: sha256(`${DRIVER_ID}:${RAW_SESSION_ID}`),
      referenceImageSha256: sha256(referenceImageBuffer)
    },
    comparison: {
      success: true,
      provider: 'aws_rekognition_compare_faces',
      mode: 'server_aws_compare_faces_v1',
      providerRequestId: 'aws-compare-request-1',
      decision: 'reject',
      isMatch: false,
      needsReview: false,
      similarityScore: 0.42,
      threshold: 0.95,
      reference: {
        bindingVersion: 3,
        source: 'approved_cnh_pdf_crop_v1',
        documentType: 'cnh',
        submissionId: 'cnh-submission-approved-1',
        documentSha256: sha256(Buffer.from('canonical-approved-cnh'))
      }
    }
  };

  return {
    ...input,
    ...overrides,
    liveness: { ...input.liveness, ...(overrides.liveness || {}) },
    comparison: { ...input.comparison, ...(overrides.comparison || {}) }
  };
}

function containsBuffer(value) {
  if (Buffer.isBuffer(value)) return true;
  if (Array.isArray(value)) return value.some(containsBuffer);
  if (value && typeof value === 'object') return Object.values(value).some(containsBuffer);
  return false;
}

describe('kyc-failed-biometric-evidence-service', () => {
  test('stores only a canonical failed ReferenceImage in a private opaque object with 30-day metadata', async () => {
    const harness = createHarness();
    const input = buildInput();

    const result = await harness.service.captureRejectedComparisonEvidence(input);

    expect(result).toMatchObject({
      evidenceId: EVIDENCE_ID,
      driverId: DRIVER_ID,
      state: 'available',
      objectPath: `restricted/kyc-failed-biometric-evidence/v1/${EVIDENCE_ID}.jpg`,
      contentType: 'image/jpeg',
      referenceImageSha256: sha256(input.referenceImageBuffer),
      cnhSubmissionId: 'cnh-submission-approved-1',
      cnhDocumentSha256: input.comparison.reference.documentSha256,
      livenessSessionSha256: input.liveness.sessionIdHash,
      compareProvider: 'aws_rekognition_compare_faces',
      providerRequestId: 'aws-compare-request-1',
      decision: 'reject',
      similarityScore: 0.42,
      threshold: 0.95,
      ticketId: null,
      caseId: null,
      permanentBlockRecommended: false
    });
    expect(result.createdAt.toISOString()).toBe(NOW_ISO);
    expect(result.expiresAt.toISOString()).toBe('2026-08-16T15:00:00.000Z');
    expect(result.storageGeneration).toMatch(/^\d+$/);
    expect(result.objectPath).not.toContain(DRIVER_ID);

    expect(harness.storageCalls.bucket).toContain('leaf-private-test-bucket');
    const saveCall = harness.storageCalls.save[0];
    expect(saveCall.buffer).toEqual(input.referenceImageBuffer);
    expect(saveCall.options).toMatchObject({
      resumable: false,
      preconditionOpts: { ifGenerationMatch: 0 },
      metadata: {
        contentType: 'image/jpeg',
        cacheControl: 'private, no-store, max-age=0',
        contentDisposition: 'inline',
        metadata: {
          classification: 'restricted_kyc_failed_biometric_evidence',
          evidenceId: EVIDENCE_ID,
          sha256: sha256(input.referenceImageBuffer),
          expiresAt: '2026-08-16T15:00:00.000Z'
        }
      }
    });
    expect(JSON.stringify(saveCall.options)).not.toContain(DRIVER_ID);
    expect(saveCall.options).not.toHaveProperty('public');
    expect(saveCall.options).not.toHaveProperty('predefinedAcl', 'publicRead');

    const persisted = harness.values.get(`kyc_failed_biometric_evidence/${EVIDENCE_ID}`);
    expect(persisted).toEqual(result);
    expect(containsBuffer(persisted)).toBe(false);
    expect(JSON.stringify(persisted)).not.toContain(RAW_SESSION_ID);
    expect(JSON.stringify(persisted)).not.toContain('http://');
    expect(JSON.stringify(persisted)).not.toContain('https://');
    expect(harness.auditEvents[0]).toMatchObject({
      action: 'KYC_FAILED_BIOMETRIC_EVIDENCE_CAPTURED',
      details: { evidenceId: EVIDENCE_ID, decision: 'reject' }
    });
    expect(containsBuffer(harness.auditEvents)).toBe(false);
  });

  test.each([
    [
      'approval',
      buildInput({
        comparison: {
          decision: 'approve',
          isMatch: true,
          similarityScore: 0.98
        }
      }),
      'KYC_FAILED_EVIDENCE_COMPARE_RESULT_INVALID'
    ],
    [
      'technical comparison failure',
      buildInput({ comparison: { success: false } }),
      'KYC_FAILED_EVIDENCE_COMPARE_RESULT_INVALID'
    ],
    [
      'failed liveness',
      buildInput({ liveness: { livenessPassed: false } }),
      'KYC_FAILED_EVIDENCE_LIVENESS_BINDING_INVALID'
    ],
    [
      'invalid image bytes',
      buildInput({ referenceImageBuffer: Buffer.from('not-an-image') }),
      'KYC_FAILED_EVIDENCE_IMAGE_FORMAT_INVALID'
    ]
  ])('rejects %s before writing any evidence', async (_label, input, code) => {
    const harness = createHarness();

    await expect(harness.service.captureRejectedComparisonEvidence(input))
      .rejects.toMatchObject({ code });

    expect(harness.values.size).toBe(0);
    expect(harness.objects.size).toBe(0);
    expect(harness.storageCalls.save).toHaveLength(0);
  });

  test('rejects bytes that do not match the canonical AWS ReferenceImage hash', async () => {
    const harness = createHarness();
    const input = buildInput({
      liveness: { referenceImageSha256: sha256(Buffer.from('different-image')) }
    });

    await expect(harness.service.captureRejectedComparisonEvidence(input))
      .rejects.toMatchObject({ code: 'KYC_FAILED_EVIDENCE_LIVENESS_BINDING_INVALID' });
    expect(harness.objects.size).toBe(0);
  });

  test('removes the object and metadata when the mandatory capture audit cannot be recorded', async () => {
    const harness = createHarness({ auditSuccess: false });

    await expect(harness.service.captureRejectedComparisonEvidence(buildInput()))
      .rejects.toMatchObject({ code: 'KYC_FAILED_EVIDENCE_AUDIT_FAILED' });

    expect(harness.objects.size).toBe(0);
    expect(harness.values.size).toBe(0);
  });

  test('never deletes an existing object when an opaque evidence id collides', async () => {
    const harness = createHarness();
    const input = buildInput();
    const first = await harness.service.captureRejectedComparisonEvidence(input);

    await expect(harness.service.captureRejectedComparisonEvidence(input))
      .rejects.toMatchObject({ code: 412 });

    expect(harness.objects.get(first.objectPath)?.buffer).toEqual(input.referenceImageBuffer);
    expect(harness.values.get(`kyc_failed_biometric_evidence/${EVIDENCE_ID}`))
      .toMatchObject({ storageGeneration: first.storageGeneration });
  });

  test('links exactly one ticket and grants only short-lived generation-bound audited read access', async () => {
    const harness = createHarness();
    await harness.service.captureRejectedComparisonEvidence(buildInput());
    await harness.service.linkTicket(EVIDENCE_ID, {
      ticketId: 'ticket-kyc-1',
      caseId: 'case-fraud-1',
      actorId: 'reviewer-1'
    });

    await expect(harness.service.createReadAccess(EVIDENCE_ID, {
      actorId: 'reviewer-1',
      ticketId: 'ticket-other',
      reason: 'Analise do chamado'
    })).rejects.toMatchObject({ code: 'KYC_FAILED_EVIDENCE_TICKET_REQUIRED' });

    const access = await harness.service.createReadAccess(EVIDENCE_ID, {
      actorId: 'reviewer-1',
      ticketId: 'ticket-kyc-1',
      reason: 'Comparar selfie com a CNH aprovada',
      ttlSeconds: 180
    });

    expect(access).toEqual({
      evidenceId: EVIDENCE_ID,
      signedUrl: expect.stringContaining('https://signed.invalid/'),
      expiresAt: '2026-07-17T15:03:00.000Z',
      contentType: 'image/jpeg',
      storageGeneration: expect.stringMatching(/^\d+$/)
    });
    const signedCall = harness.storageCalls.getSignedUrl[0];
    expect(signedCall.fileOptions).toEqual({ generation: access.storageGeneration });
    expect(signedCall.options).toEqual({
      version: 'v4',
      action: 'read',
      expires: new Date('2026-07-17T15:03:00.000Z'),
      responseDisposition: 'inline'
    });
    expect(harness.auditEvents.at(-1)).toMatchObject({
      userId: 'reviewer-1',
      action: 'KYC_FAILED_BIOMETRIC_EVIDENCE_READ_ACCESS_GRANTED',
      details: {
        evidenceId: EVIDENCE_ID,
        ticketId: 'ticket-kyc-1',
        reason: 'Comparar selfie com a CNH aprovada'
      }
    });
    const persisted = harness.values.get(`kyc_failed_biometric_evidence/${EVIDENCE_ID}`);
    expect(JSON.stringify(persisted)).not.toContain(access.signedUrl);

    await expect(harness.service.createReadAccess(EVIDENCE_ID, {
      actorId: 'reviewer-1',
      ticketId: 'ticket-kyc-1',
      reason: 'TTL indevido',
      ttlSeconds: 301
    })).rejects.toMatchObject({ code: 'KYC_FAILED_EVIDENCE_ACCESS_TTL_INVALID' });
  });

  test('prevents relinking evidence to a different support ticket', async () => {
    const harness = createHarness();
    await harness.service.captureRejectedComparisonEvidence(buildInput());
    await harness.service.linkTicket(EVIDENCE_ID, {
      ticketId: 'ticket-original',
      actorId: 'reviewer-1'
    });

    await expect(harness.service.linkTicket(EVIDENCE_ID, {
      ticketId: 'ticket-other',
      actorId: 'reviewer-2'
    })).rejects.toMatchObject({ code: 'KYC_FAILED_EVIDENCE_TICKET_CONFLICT' });
  });

  test('records an immutable fraud decision and signals permanent blocking to the workflow', async () => {
    const harness = createHarness();
    await harness.service.captureRejectedComparisonEvidence(buildInput());
    await harness.service.linkTicket(EVIDENCE_ID, {
      ticketId: 'ticket-fraud-1',
      caseId: 'case-fraud-1',
      actorId: 'reviewer-1'
    });

    const result = await harness.service.recordReviewOutcome(EVIDENCE_ID, {
      outcome: REVIEW_OUTCOMES.FRAUD_CONFIRMED,
      actorId: 'reviewer-antifraud-1',
      ticketId: 'ticket-fraud-1',
      caseId: 'case-fraud-1',
      reason: 'Selfie pertence a terceiro e diverge da CNH canonica'
    });

    expect(result).toMatchObject({
      reviewOutcome: 'fraud_confirmed',
      reviewedBy: 'reviewer-antifraud-1',
      reviewReason: 'Selfie pertence a terceiro e diverge da CNH canonica',
      permanentBlockRecommended: true,
      idempotentReplay: false
    });
    expect(result.reviewedAt).toEqual(new Date(NOW_ISO));
    expect(harness.auditEvents.at(-1)).toMatchObject({
      severity: 'CRITICAL',
      action: 'KYC_FAILED_BIOMETRIC_EVIDENCE_REVIEW_RECORDED',
      details: {
        outcome: 'fraud_confirmed',
        permanentBlockRecommended: true
      }
    });

    await expect(harness.service.recordReviewOutcome(EVIDENCE_ID, {
      outcome: REVIEW_OUTCOMES.NO_FRAUD_CONFIRMED,
      actorId: 'reviewer-antifraud-2',
      ticketId: 'ticket-fraud-1',
      reason: 'Tentativa de sobrescrever decisao final'
    })).rejects.toMatchObject({ code: 'KYC_FAILED_EVIDENCE_REVIEW_CONFLICT' });
  });

  test('enforces expiry on lookup/read and deletes both object and Firestore metadata lazily', async () => {
    const harness = createHarness();
    await harness.service.captureRejectedComparisonEvidence(buildInput());
    await harness.service.linkTicket(EVIDENCE_ID, {
      ticketId: 'ticket-expired-1',
      actorId: 'reviewer-1'
    });
    harness.setNow('2026-08-17T15:00:00.000Z');

    await expect(harness.service.getMetadata(EVIDENCE_ID))
      .rejects.toMatchObject({ code: 'KYC_FAILED_EVIDENCE_EXPIRED' });
    await expect(harness.service.createReadAccess(EVIDENCE_ID, {
      actorId: 'reviewer-1',
      ticketId: 'ticket-expired-1',
      reason: 'Nao deve abrir evidencia expirada'
    })).rejects.toMatchObject({ code: 'KYC_FAILED_EVIDENCE_EXPIRED' });

    const deletion = await harness.service.deleteExpiredEvidence(EVIDENCE_ID);

    expect(deletion).toEqual({ evidenceId: EVIDENCE_ID, deleted: true, expired: true });
    expect(harness.objects.size).toBe(0);
    expect(harness.values.size).toBe(0);
    expect(harness.storageCalls.delete.at(-1)).toMatchObject({
      fileOptions: { generation: expect.stringMatching(/^\d+$/) },
      options: { ignoreNotFound: true }
    });
  });
});
