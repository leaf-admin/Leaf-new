/**
 * Unit tests (atualizados) para KYC service singleton.
 */

jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn(),
  logError: jest.fn()
}));

describe('kyc-service', () => {
  let kycService;

  beforeEach(() => {
    jest.resetModules();
    kycService = require('../../../services/kyc-service');
  });

  test('should export singleton instance with expected API', () => {
    expect(kycService).toBeDefined();
    expect(typeof kycService.initialize).toBe('function');
    expect(typeof kycService.normalizeImage).toBe('function');
    expect(typeof kycService.generateFaceEmbedding).toBe('function');
    expect(typeof kycService.calculateCosineSimilarity).toBe('function');
    expect(typeof kycService.cleanup).toBe('function');
  });

  test('calculateCosineSimilarity should return value between -1 and 1', () => {
    const similarity = kycService.calculateCosineSimilarity([1, 0, 0], [1, 0, 0]);
    expect(similarity).toBeGreaterThanOrEqual(-1);
    expect(similarity).toBeLessThanOrEqual(1);
  });
});
