const fs = require('fs');
const path = require('path');

describe('support tier role boundary', () => {
  it('recognizes dashboard support_n1/n2/n3 roles as backend support agents', () => {
    const middlewareSource = fs.readFileSync(
      path.join(__dirname, '../../../middleware/support-auth.js'),
      'utf8'
    );
    const routeSource = fs.readFileSync(
      path.join(__dirname, '../../../routes/support.js'),
      'utf8'
    );

    expect(middlewareSource).toContain("const SUPPORT_TIER_ROLES = ['support', 'support_n1', 'support_n2', 'support_n3']");
    expect(middlewareSource).toContain('...SUPPORT_TIER_ROLES');
    expect(routeSource).toContain("'support_n1'");
    expect(routeSource).toContain("'support_n2'");
    expect(routeSource).toContain("'support_n3'");
  });
});
