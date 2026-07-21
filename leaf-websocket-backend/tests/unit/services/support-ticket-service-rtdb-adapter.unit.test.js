const fs = require('fs');
const path = require('path');

describe('support ticket RTDB adapter boundary', () => {
  it('keeps direct RTDB path access inside the repository', () => {
    const serviceSource = fs.readFileSync(
      path.join(__dirname, '../../../services/support-ticket-service.js'),
      'utf8'
    );

    expect(serviceSource).not.toMatch(/\.ref\(/);
    expect(serviceSource).toContain('SupportLegacyRtdbRepository');
  });

  it('keeps legacy import and RTDB mirror disabled unless explicitly enabled', () => {
    const serviceSource = fs.readFileSync(
      path.join(__dirname, '../../../services/support-ticket-service.js'),
      'utf8'
    );

    expect(serviceSource).toContain(
      "const LEGACY_IMPORT_ENABLED = process.env.SUPPORT_TICKETS_ENABLE_LEGACY_IMPORT === 'true'"
    );
    expect(serviceSource).toContain(
      "const LEGACY_MIRROR_ENABLED = process.env.SUPPORT_TICKETS_ENABLE_LEGACY_RTDB_MIRROR === 'true'"
    );
    expect(serviceSource).not.toContain("SUPPORT_TICKETS_ENABLE_LEGACY_IMPORT !== 'false'");
  });
});
