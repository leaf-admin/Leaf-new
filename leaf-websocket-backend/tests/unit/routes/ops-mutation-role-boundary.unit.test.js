const fs = require('fs');
const path = require('path');

describe('ops mutation role boundary', () => {
  it('keeps generic support out of high-risk ops mutations', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../../../routes/ops.js'),
      'utf8'
    );

    expect(source).toContain("const OPS_ROLES = ['admin', 'manager', 'super-admin', 'support', 'development', 'viewer']");
    expect(source).toContain("const MUTATION_ROLES = ['admin', 'manager', 'super-admin', 'development']");
    expect(source).toContain("router.post('/passengers/:userId/block', requireSupportRoles(MUTATION_ROLES)");
    expect(source).toContain("router.post('/areas/policies', requireSupportRoles(MUTATION_ROLES)");
    expect(source).toContain("router.post('/disputes/:disputeId/decision', requireSupportRoles(MUTATION_ROLES)");
  });
});
