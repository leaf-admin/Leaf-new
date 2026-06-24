const fs = require('fs');
const path = require('path');

describe('KYC legacy boundary', () => {
  it('does not route IntegratedKYCService fallback through legacy kyc-service', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../../../services/IntegratedKYCService.js'),
      'utf8'
    );

    expect(source).not.toContain("require('./kyc-service')");
    expect(source).toContain('verifyDriverServerSideSelfie');
    expect(source).toContain('leaf_face_compare_service');
  });

  it('does not mount legacy kyc-service in onboarding routes', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../../../routes/kyc-onboarding.js'),
      'utf8'
    );

    expect(source).not.toContain("require('../services/kyc-service')");
    expect(source).toContain('KYC multipart legado desativado');
    expect(source).toContain('Reverificacao KYC legada desativada');
  });

  it('keeps legacy KYC proxy behind an explicit runtime flag', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../../../bootstrap/register-http-routes.js'),
      'utf8'
    );

    expect(source).toContain('ENABLE_LEGACY_KYC_PROXY');
    expect(source).toContain("require('../routes/kyc-proxy-routes')");
    expect(source.indexOf('ENABLE_LEGACY_KYC_PROXY')).toBeLessThan(
      source.indexOf("require('../routes/kyc-proxy-routes')")
    );
  });

  it('keeps legacy KYC proxy behind an explicit runtime flag in the VPS runtime', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../../../server.vps.js'),
      'utf8'
    );

    const mountIndex = source.indexOf("app.use('/api/kyc-proxy'");
    expect(source).toContain('ENABLE_LEGACY_KYC_PROXY');
    expect(mountIndex).toBeGreaterThan(-1);
    expect(source.lastIndexOf('ENABLE_LEGACY_KYC_PROXY', mountIndex)).toBeGreaterThan(-1);
  });
});
