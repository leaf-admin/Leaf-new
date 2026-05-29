const {
  isRetryableCnhFaceBiometricError
} = require('../../../services/driver-document-analysis-queue');

describe('driver-document-analysis-queue biometric retry policy', () => {
  test('retries transient biometric service failures', () => {
    expect(isRetryableCnhFaceBiometricError({ status: 503 })).toBe(true);
    expect(isRetryableCnhFaceBiometricError({ status: 429 })).toBe(true);
    expect(isRetryableCnhFaceBiometricError({ code: 'ECONNRESET' })).toBe(true);
    expect(isRetryableCnhFaceBiometricError({ code: 'UNAVAILABLE' })).toBe(true);
    expect(isRetryableCnhFaceBiometricError({ message: 'request timeout of 90000ms exceeded' })).toBe(true);
    expect(isRetryableCnhFaceBiometricError({ message: 'RTDB unavailable while writing biometric payload' })).toBe(true);
  });

  test('does not retry deterministic document/image failures', () => {
    expect(isRetryableCnhFaceBiometricError({ status: 401 })).toBe(false);
    expect(isRetryableCnhFaceBiometricError({ status: 422, message: 'No face detected' })).toBe(false);
    expect(isRetryableCnhFaceBiometricError({ message: 'upload must be an image' })).toBe(false);
    expect(isRetryableCnhFaceBiometricError({ message: 'image is too large' })).toBe(false);
  });
});
