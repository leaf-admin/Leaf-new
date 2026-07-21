const crypto = require('crypto');

jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn(),
  logError: jest.fn()
}));

const CanonicalAwsFaceCompareService = require('../../../services/canonical-aws-face-compare-service');
const { logStructured, logError } = require('../../../utils/logger');

const jpeg = (value) => Buffer.from([0xff, 0xd8, 0xff, 0xe0, value, value + 1, value + 2]);
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

function buildRequest(overrides = {}) {
  const driverId = 'driver-compare-1';
  const sourceImageBuffer = jpeg(10);
  const livenessReferenceImageBuffer = jpeg(20);
  return {
    driverId,
    sourceImageBuffer,
    livenessReferenceImageBuffer,
    reference: {
      bindingVersion: 3,
      source: 'approved_cnh_pdf_crop_v1',
      documentType: 'cnh',
      status: 'approved',
      analysisStatus: 'approved',
      approvalSource: 'dashboard_manual_review',
      reviewedBy: 'admin-1',
      reviewedAt: '2026-07-13T12:00:00.000Z',
      submissionId: 'submission-current-1',
      documentPath: `driver-activation/${driverId}/cnh/current-cnh.pdf`,
      documentSha256: sha256(Buffer.from('approved-cnh-pdf')),
      storageGeneration: '1784000000000000',
      cropVersion: 'cnh_digital_photo_crop_v1',
      createdAt: '2026-07-13T12:00:00.000Z'
    },
    liveness: {
      provider: 'aws_rekognition_face_liveness',
      sessionId: 'aws-session-secret-1',
      status: 'SUCCEEDED',
      livenessPassed: true,
      confidence: 99.4,
      threshold: 80
    },
    ...overrides
  };
}

function createService(send, overrides = {}) {
  return new CanonicalAwsFaceCompareService({
    enabled: true,
    client: { send },
    approveThreshold: 0.95,
    reviewThreshold: 0.80,
    qualityFilter: 'AUTO',
    estimatedUnitCostUsd: 0.001,
    ...overrides
  });
}

describe('canonical-aws-face-compare-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('compares the approved CNH crop as source against the bound liveness image', async () => {
    const send = jest.fn().mockResolvedValue({
      FaceMatches: [{ Similarity: 97.25, Face: { Confidence: 99.8 } }],
      UnmatchedFaces: [],
      SourceImageFace: { Confidence: 99.9 },
      $metadata: { requestId: 'request-compare-1' }
    });
    const service = createService(send);
    const request = buildRequest();

    const result = await service.verifyApprovedCnhAgainstLiveness(request);

    expect(send).toHaveBeenCalledTimes(1);
    const commandInput = send.mock.calls[0][0].input;
    expect(commandInput.SourceImage.Bytes).toBe(request.sourceImageBuffer);
    expect(commandInput.TargetImage.Bytes).toBe(request.livenessReferenceImageBuffer);
    expect(commandInput.SimilarityThreshold).toBe(80);
    expect(commandInput.QualityFilter).toBe('AUTO');
    expect(result).toEqual(expect.objectContaining({
      success: true,
      userId: request.driverId,
      isMatch: true,
      needsReview: false,
      decision: 'approve',
      similarityScore: 0.9725,
      similarityPercent: 97.25,
      threshold: 0.95,
      reviewThreshold: 0.80,
      provider: 'aws_rekognition_compare_faces',
      comparisonProvider: 'aws_rekognition_compare_faces',
      mode: 'server_aws_compare_faces_v1',
      providerRequestId: 'request-compare-1'
    }));
    expect(result.reference).toEqual({
      bindingVersion: 3,
      source: 'approved_cnh_pdf_crop_v1',
      documentType: 'cnh',
      model: 'aws_rekognition_compare_faces_managed',
      submissionId: 'submission-current-1',
      documentPathSha256: sha256(request.reference.documentPath),
      documentSha256: request.reference.documentSha256,
      storageGeneration: '1784000000000000',
      approvalSource: 'dashboard_manual_review',
      reviewedByHash: sha256('admin-1'),
      reviewedAt: '2026-07-13T12:00:00.000Z',
      imageSha256: sha256(request.sourceImageBuffer),
      cropVersion: 'cnh_digital_photo_crop_v1',
      createdAt: '2026-07-13T12:00:00.000Z'
    });
    expect(result.reference).not.toHaveProperty('documentPath');
    expect(result.liveness).toEqual(expect.objectContaining({
      provider: 'aws_rekognition_face_liveness',
      sessionIdHash: sha256(`${request.driverId}:${request.liveness.sessionId}`),
      status: 'SUCCEEDED',
      livenessPassed: true,
      referenceImageSha256: sha256(request.livenessReferenceImageBuffer)
    }));
    expect(result.liveness).not.toHaveProperty('sessionId');
  });

  test.each([
    [80, 'reject', false, 0.8],
    [89.5, 'reject', false, 0.895],
    [94.99, 'reject', false, 0.9499],
    [95, 'approve', true, 0.95]
  ])(
    'maps AWS similarity %s to normalized %s decision',
    async (similarity, decision, isMatch, normalized) => {
      const send = jest.fn().mockResolvedValue({
        FaceMatches: [{ Similarity: similarity }]
      });
      const service = createService(send);

      const result = await service.verifyApprovedCnhAgainstLiveness(buildRequest());

      expect(result).toEqual(expect.objectContaining({
        decision,
        isMatch,
        needsReview: false,
        similarityScore: normalized
      }));
    }
  );

  test('enforces the canonical 0.95 floor even when runtime config requests 0.90', async () => {
    const send = jest.fn().mockResolvedValue({
      FaceMatches: [{ Similarity: 94 }]
    });
    const service = createService(send, { approveThreshold: 0.90 });

    const result = await service.verifyApprovedCnhAgainstLiveness(buildRequest());

    expect(service.getConfigSummary().approveThreshold).toBe(0.95);
    expect(result).toEqual(expect.objectContaining({
      threshold: 0.95,
      similarityScore: 0.94,
      decision: 'reject',
      isMatch: false,
      needsReview: false
    }));
  });

  test('rejects when AWS returns no match at or above the provider query threshold', async () => {
    const send = jest.fn().mockResolvedValue({
      FaceMatches: [],
      UnmatchedFaces: [{ Confidence: 99 }]
    });
    const service = createService(send);

    const result = await service.verifyApprovedCnhAgainstLiveness(buildRequest());

    expect(result).toEqual(expect.objectContaining({
      success: true,
      decision: 'reject',
      isMatch: false,
      needsReview: false,
      similarityScore: 0,
      similarityPercent: null
    }));
    expect(result.current.unmatchedFacesCount).toBe(1);
  });

  test('converts a cached pre-policy review result into a hard failure without another AWS call', async () => {
    const send = jest.fn();
    const costGuard = {
      isEnabled: jest.fn(() => true),
      getConfigSummary: jest.fn(() => ({ enabled: true })),
      claimCompareDispatch: jest.fn(async () => ({
        replay: true,
        result: {
          success: true,
          isMatch: false,
          needsReview: true,
          decision: 'review',
          similarityScore: 0.895
        }
      }))
    };
    const service = createService(send, { costGuard });
    const request = buildRequest();
    request.liveness.costGuardOperationId = 'cost-operation-review-replay';

    const result = await service.verifyApprovedCnhAgainstLiveness(request);

    expect(result).toEqual(expect.objectContaining({
      isMatch: false,
      needsReview: false,
      decision: 'reject',
      similarityScore: 0.895,
      idempotentReplay: true
    }));
    expect(send).not.toHaveBeenCalled();
  });

  test('refuses a PDF before any paid CompareFaces request', async () => {
    const send = jest.fn();
    const service = createService(send);

    await expect(service.verifyApprovedCnhAgainstLiveness(buildRequest({
      sourceImageBuffer: Buffer.from('%PDF-1.7 fake-cnh')
    }))).rejects.toMatchObject({
      code: 'AWS_COMPARE_FACES_SOURCE_IMAGE_FORMAT_INVALID'
    });
    expect(send).not.toHaveBeenCalled();
  });

  test.each([
    ['profile_anchor', 'cnh'],
    ['approved_cnh_pdf_crop_v1', 'profile']
  ])('refuses non-CNH reference source=%s type=%s before AWS', async (source, documentType) => {
    const send = jest.fn();
    const service = createService(send);
    const request = buildRequest();

    await expect(service.verifyApprovedCnhAgainstLiveness({
      ...request,
      reference: {
        ...request.reference,
        source,
        documentType
      }
    })).rejects.toMatchObject({
      code: 'AWS_COMPARE_FACES_APPROVED_CNH_REFERENCE_INVALID'
    });
    expect(send).not.toHaveBeenCalled();
  });

  test('binds the approved CNH to the current driver storage path', async () => {
    const send = jest.fn();
    const service = createService(send);
    const request = buildRequest();

    await expect(service.verifyApprovedCnhAgainstLiveness({
      ...request,
      reference: {
        ...request.reference,
        documentPath: 'driver-activation/another-driver/cnh/cnh.pdf'
      }
    })).rejects.toMatchObject({
      code: 'AWS_COMPARE_FACES_APPROVED_CNH_REFERENCE_INVALID'
    });
    expect(send).not.toHaveBeenCalled();
  });

  test('detects tampered source and liveness image hashes before AWS', async () => {
    const send = jest.fn();
    const service = createService(send);
    const request = buildRequest();

    await expect(service.verifyApprovedCnhAgainstLiveness({
      ...request,
      reference: {
        ...request.reference,
        imageSha256: 'a'.repeat(64)
      }
    })).rejects.toMatchObject({
      code: 'AWS_COMPARE_FACES_CNH_IMAGE_HASH_MISMATCH'
    });
    await expect(service.verifyApprovedCnhAgainstLiveness({
      ...request,
      liveness: {
        ...request.liveness,
        referenceImageSha256: 'b'.repeat(64)
      }
    })).rejects.toMatchObject({
      code: 'AWS_COMPARE_FACES_LIVENESS_IMAGE_HASH_MISMATCH'
    });
    expect(send).not.toHaveBeenCalled();
  });

  test('requires a successful bound AWS liveness result before AWS face compare', async () => {
    const send = jest.fn();
    const service = createService(send);
    const request = buildRequest();

    await expect(service.verifyApprovedCnhAgainstLiveness({
      ...request,
      liveness: {
        ...request.liveness,
        livenessPassed: false
      }
    })).rejects.toMatchObject({
      code: 'AWS_COMPARE_FACES_LIVENESS_BINDING_INVALID'
    });
    expect(send).not.toHaveBeenCalled();
  });

  test('fails closed on invalid provider thresholds before AWS', async () => {
    const send = jest.fn();
    const service = createService(send, {
      approveThreshold: 0.95,
      reviewThreshold: 0.95
    });

    await expect(service.verifyApprovedCnhAgainstLiveness(buildRequest()))
      .rejects.toMatchObject({
        code: 'AWS_COMPARE_FACES_THRESHOLD_CONFIG_INVALID'
      });
    expect(send).not.toHaveBeenCalled();
  });

  test.each([
    ['AccessDeniedException', 'AWS_COMPARE_FACES_ACCESS_DENIED', false],
    ['ThrottlingException', 'AWS_COMPARE_FACES_THROTTLED', true]
  ])('normalizes provider error %s without returning image data', async (
    providerCode,
    expectedCode,
    retryable
  ) => {
    const providerError = new Error('provider detail that must not reach the client');
    providerError.name = providerCode;
    const send = jest.fn().mockRejectedValue(providerError);
    const service = createService(send);

    await expect(service.verifyApprovedCnhAgainstLiveness(buildRequest()))
      .rejects.toMatchObject({
        code: expectedCode,
        providerCode,
        retryable,
        message: 'Falha ao executar comparacao facial AWS'
      });
    expect(logError).toHaveBeenCalledTimes(1);
    const serializedLog = JSON.stringify(logError.mock.calls);
    expect(serializedLog).not.toContain('current-cnh.pdf');
    expect(serializedLog).not.toContain('aws-session-secret-1');
  });

  test('logs only normalized comparison metadata and never raw bindings', async () => {
    const send = jest.fn().mockResolvedValue({
      FaceMatches: [{ Similarity: 98 }]
    });
    const service = createService(send);
    const request = buildRequest();

    await service.verifyApprovedCnhAgainstLiveness(request);

    const serializedLog = JSON.stringify(logStructured.mock.calls);
    expect(serializedLog).not.toContain(request.reference.documentPath);
    expect(serializedLog).not.toContain(request.liveness.sessionId);
    expect(serializedLog).not.toContain(request.sourceImageBuffer.toString('hex'));
    expect(serializedLog).not.toContain(request.livenessReferenceImageBuffer.toString('hex'));
  });

  test('retries durable result persistence without repeating the paid CompareFaces call', async () => {
    const send = jest.fn().mockResolvedValue({
      FaceMatches: [{ Similarity: 98.1 }]
    });
    const transientError = Object.assign(new Error('firestore temporarily unavailable'), {
      code: 'KYC_AWS_COST_GUARD_UNAVAILABLE'
    });
    const costGuard = {
      isEnabled: jest.fn(() => true),
      getConfigSummary: jest.fn(() => ({ enabled: true })),
      claimCompareDispatch: jest.fn(async () => ({ claimed: true, replay: false })),
      completeCompare: jest.fn()
        .mockRejectedValueOnce(transientError)
        .mockResolvedValueOnce({ success: true, decision: 'approve', similarityScore: 0.981 })
    };
    const service = createService(send, {
      costGuard,
      resultPersistenceMaxAttempts: 3
    });
    const request = buildRequest();
    request.liveness.costGuardOperationId = 'cost-operation-1';

    const result = await service.verifyApprovedCnhAgainstLiveness(request);

    expect(result).toMatchObject({ decision: 'approve', similarityScore: 0.981 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(costGuard.completeCompare).toHaveBeenCalledTimes(2);
    expect(costGuard.completeCompare.mock.calls[0][2]).not.toHaveProperty('userId');
  });
});
