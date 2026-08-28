const fs = require('fs');
const path = require('path');

describe('cleanup-prod-test-data financial boundary', () => {
  const scriptPath = path.resolve(
    __dirname,
    '../../../scripts/ops/cleanup-prod-test-data.js'
  );
  const source = fs.readFileSync(scriptPath, 'utf8');

  it('deletes only the isolated sandbox financial namespace', () => {
    expect(source).toContain('const SANDBOX_FINANCIAL_COLLECTIONS = [');
    expect(source).toContain('for (const collectionName of SANDBOX_FINANCIAL_COLLECTIONS)');
    expect(source).not.toContain('for (const collectionName of FINANCIAL_TEST_COLLECTIONS)');
  });

  it('keeps legacy operational financial matches audit-only', () => {
    expect(source).toContain('const LEGACY_OPERATIONAL_FINANCIAL_COLLECTIONS = [');
    expect(source).toContain('AUDIT_ONLY_REQUIRES_COMPENSATING_FINANCIAL_MIGRATION');
    expect(source).toContain('legacyOperationalFinancialDocsSkipped');
  });

  it('neutralizes sandbox balance transactions before deleting ledger documents', () => {
    const balanceNeutralization = source.indexOf('sandboxBalanceTransactionsDeleted');
    const financialDeleteLoop = source.indexOf('if (targets.firestoreFinancialDocs.length > 0');
    expect(balanceNeutralization).toBeGreaterThan(-1);
    expect(financialDeleteLoop).toBeGreaterThan(balanceNeutralization);
    expect(source).toContain("row.collection === 'sandbox_driver_balances'");
    expect(source).toContain("'sandbox_financial_ledger_events'");
  });

  it('resolves the runtime Firebase credential before the legacy local fallback', () => {
    expect(source).toContain('FIREBASE_SERVICE_ACCOUNT_JSON');
    expect(source).toContain('GOOGLE_APPLICATION_CREDENTIALS_JSON');
    expect(source).toContain('GOOGLE_APPLICATION_CREDENTIALS');
    expect(source.indexOf('FIREBASE_SERVICE_ACCOUNT_JSON')).toBeLessThan(
      source.indexOf('GOOGLE_APPLICATION_CREDENTIALS')
    );
    expect(source).toContain("path.join(ROOT, 'leaf-reactnative-firebase-adminsdk-fbsvc-456a95e2fc.json')");
  });
});
