jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn(),
  logError: jest.fn()
}));

const DeviceFaceEmbeddingVerificationService = require('../../../services/device-face-embedding-verification-service');

function unitVector(index = 0) {
  return Array.from({ length: 512 }, (_, currentIndex) => (currentIndex === index ? 1 : 0));
}

describe('DeviceFaceEmbeddingVerificationService', () => {
  test('compares a valid mobile embedding against the stored CNH embedding', async () => {
    const embedding = unitVector(0);
    const service = new DeviceFaceEmbeddingVerificationService({
      faceClient: { isConfigured: () => false },
      getCnhFaceEmbedding: jest.fn().mockResolvedValue({
        embedding,
        source: 'unit_test'
      }),
      allowedModes: 'mobile_arcface_w600k_r50_v1',
      approveThreshold: 0.9,
      reviewThreshold: 0.78
    });

    const result = await service.verify('driver-1', {
      mode: 'mobile_arcface_w600k_r50_v1',
      embeddingFormat: 'float32-l2-normalized-512',
      embedding
    });

    expect(result.success).toBe(true);
    expect(result.isMatch).toBe(true);
    expect(result.similarityScore).toBe(1);
    expect(result.decision).toBe('approve');
    expect(result.embeddingDimension).toBe(512);
  });

  test('rejects unexpected mobile embedding mode', async () => {
    const service = new DeviceFaceEmbeddingVerificationService({
      faceClient: { isConfigured: () => false },
      getCnhFaceEmbedding: jest.fn(),
      allowedModes: 'mobile_arcface_w600k_r50_v1'
    });

    await expect(service.verify('driver-1', {
      mode: 'other_model',
      embeddingFormat: 'float32-l2-normalized-512',
      embedding: unitVector(0)
    })).rejects.toMatchObject({
      code: 'DEVICE_FACE_EMBEDDING_MODE_NOT_ALLOWED'
    });
  });

  test('rejects embeddings with invalid dimension', async () => {
    const service = new DeviceFaceEmbeddingVerificationService({
      faceClient: { isConfigured: () => false },
      getCnhFaceEmbedding: jest.fn(),
      allowedModes: 'mobile_arcface_w600k_r50_v1'
    });

    await expect(service.verify('driver-1', {
      mode: 'mobile_arcface_w600k_r50_v1',
      embeddingFormat: 'float32-l2-normalized-512',
      embedding: [1, 0, 0]
    })).rejects.toMatchObject({
      code: 'DEVICE_FACE_EMBEDDING_INVALID_DIMENSION'
    });
  });
});
