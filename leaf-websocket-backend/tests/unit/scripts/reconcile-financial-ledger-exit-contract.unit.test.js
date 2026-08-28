const fs = require('fs');
const path = require('path');

describe('reconcile-financial-ledger exit contract', () => {
  const scriptPath = path.resolve(
    __dirname,
    '../../../scripts/ops/reconcile-financial-ledger.cjs'
  );
  const source = fs.readFileSync(scriptPath, 'utf8');

  it('fails the process when the reconciliation summary is unsuccessful', () => {
    expect(source).toContain('if (summary && summary.success === false)');
    expect(source).toContain('process.exitCode = 1;');
  });
});
