const fs = require('fs');
const path = require('path');

describe('dashboard KYC identity review boundary', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../../routes/dashboard.js'),
    'utf8'
  );
  const start = source.indexOf("'/api/drivers/:driverId/kyc/identity-reviews/reconcile'");
  const end = source.indexOf("router.post('/api/drivers/:driverId/approve'", start);
  const reviewRoutes = source.slice(start, end > start ? end : undefined);

  it('keeps list, evidence, reconcile and decisions behind the restricted KYC role', () => {
    expect(start).toBeGreaterThan(0);
    expect(reviewRoutes).toContain('authenticateJWT');
    expect(reviewRoutes.match(/requireRole\(DASHBOARD_KYC_REVIEW_ROLES\)/g)).toHaveLength(5);
    expect(source).toContain("const DASHBOARD_KYC_REVIEW_ROLES = ['admin', 'super-admin', 'manager']");
  });

  it('reconciles a durable pending ticket with reviewer audit instead of losing the request', () => {
    expect(reviewRoutes).toContain('reconciledBy: reviewerContext');
    expect(reviewRoutes).toContain("identityReviewLinkStatus: 'registered'");
    expect(reviewRoutes).toContain("action: 'KYC_IDENTITY_REVIEW_TICKET_RECONCILED'");
  });

  it('streams only integrity-checked evidence through Leaf with no public provider URL', () => {
    expect(reviewRoutes).toContain("'Cache-Control': 'private, no-store, max-age=0'");
    expect(reviewRoutes).toContain("'X-Content-Type-Options': 'nosniff'");
    expect(reviewRoutes).toContain('sha256Buffer(imageBuffer)');
    expect(reviewRoutes).not.toMatch(/RekognitionClient|CompareFacesCommand|getSignedUrl/);
  });

  it('requires explicit fraud confirmation and applies all decisions outside active trips', () => {
    expect(source).toContain("const KYC_PERMANENT_BLOCK_CONFIRMATION = 'CONFIRMAR FRAUDE E BLOQUEAR'");
    expect(reviewRoutes).toContain('req.body?.explicitDecision !== true');
    expect(reviewRoutes).toContain('req.body?.confirmPermanentBlock !== true');
    expect(reviewRoutes).toContain('runOutsideActiveTrip(driverId');
  });

  it('blocks both CNH review mutations and replacement uploads during an identity hold', () => {
    expect(source.match(/assertCnhUploadAllowed\(driverId\)/g)?.length || 0).toBeGreaterThanOrEqual(2);
    expect(source).toContain('A CNH não pode ser alterada enquanto a identidade está bloqueada ou em análise.');
    expect(source).toContain('A CNH não pode ser substituída enquanto a identidade está bloqueada ou em análise.');
  });
});
