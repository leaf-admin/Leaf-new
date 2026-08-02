const fs = require('fs');
const path = require('path');

describe('KYC legacy boundary', () => {
  it('does not keep the obsolete dummy-embedding KYC service', () => {
    expect(
      fs.existsSync(path.join(__dirname, '../../../services/kyc-service.js'))
    ).toBe(false);
  });

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

  it('does not expose the retired KYC proxy or its runtime flag', () => {
    const runtimeSource = fs.readFileSync(
      path.join(__dirname, '../../../bootstrap/register-http-routes.js'),
      'utf8'
    );
    const configurationFiles = [
      '../../../scripts/deploy/validate-runtime-config.js',
      '../../../docker-compose.gateway-scale.yml',
      '../../../docker-compose.production.yml',
      '../../../config/soft-release.env.example',
      '../../../config/kyc-aws-strict.env.example'
    ];

    expect(runtimeSource).not.toContain('ENABLE_LEGACY_KYC_PROXY');
    expect(runtimeSource).not.toContain("require('../routes/kyc-proxy-routes')");
    expect(
      fs.existsSync(path.join(__dirname, '../../../routes/kyc-proxy-routes.js'))
    ).toBe(false);
    expect(
      fs.existsSync(path.join(__dirname, '../../../services/KYCClient.js'))
    ).toBe(false);

    for (const relativePath of configurationFiles) {
      const source = fs.readFileSync(path.join(__dirname, relativePath), 'utf8');
      expect(source).not.toContain('ENABLE_LEGACY_KYC_PROXY');
    }
  });
});
