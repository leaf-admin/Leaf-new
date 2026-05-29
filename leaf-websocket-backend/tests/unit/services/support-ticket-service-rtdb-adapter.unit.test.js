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
});
