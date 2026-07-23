const fs = require('fs');
const path = require('path');

describe('dashboard driver quick approval boundary', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../../routes/dashboard.js'),
    'utf8'
  );

  it('disables legacy mass application mutations', () => {
    const applicationApproveStart = source.indexOf("router.post('/api/drivers/applications/:id/approve'");
    const applicationRejectStart = source.indexOf("router.post('/api/drivers/applications/:id/reject'");
    const applicationApproveSource = source.slice(applicationApproveStart, applicationRejectStart);

    expect(applicationApproveSource).toContain('LEGACY_DRIVER_APPLICATION_MUTATIONS_ENABLED');
    expect(applicationApproveSource).toContain('LEGACY_DRIVER_APPLICATION_MUTATION_DISABLED');
  });

  it('requires explicit audit fields before quick driver approval', () => {
    expect(source).toContain("router.post('/api/drivers/:driverId/approve'");
    expect(source).toContain('QUICK_APPROVAL_AUDIT_REQUIRED');
    expect(source).toContain('approvalReason');
    expect(source).toContain('approvalEvidence.length === 0');
    expect(source).toContain("action: 'driver.quick_manual_approval'");
    expect(source).toContain("resource: 'driver'");
  });

  it('keeps quick approval as audit-only until canonical evidence is complete', () => {
    const quickApproveStart = source.indexOf("router.post('/api/drivers/:driverId/approve'");
    const quickApproveEnd = source.indexOf("router.post('/api/drivers/:driverId/suspend'");
    const quickApproveSource = source.slice(quickApproveStart, quickApproveEnd);

    expect(quickApproveSource).toContain('manualApprovalAudit');
    expect(quickApproveSource).toContain('previousState');
    expect(quickApproveSource).toContain('nextState');
    expect(quickApproveSource).toContain('CANONICAL_DRIVER_EVIDENCE_REQUIRED');
    expect(quickApproveSource).toContain('canApproveFromCanonicalEvidence');
    expect(quickApproveSource).not.toContain('kycDriverStatusService.unblockDriver');
    expect(quickApproveSource).not.toContain('manualOverride: true');
    expect(quickApproveSource).not.toContain("backgroundCheck: true");
    expect(quickApproveSource).toContain('activationStatus?.canGoOnline === true');
    expect(quickApproveSource).toContain('emitDriverActivationUnlockedEvent(req, driverId, activationStatus)');
  });

  it('keeps generic support out of dashboard mutation roles', () => {
    expect(source).toContain("const DASHBOARD_OPERATION_ROLES = ['admin', 'super-admin', 'manager', 'support', 'development']");
    expect(source).toContain("const DASHBOARD_OPERATION_MUTATION_ROLES = ['admin', 'super-admin', 'manager', 'development']");
    expect(source).toContain("router.post('/api/drivers/:driverId/approve', authenticateJWT, requireRole(DASHBOARD_OPERATION_MUTATION_ROLES)");
    expect(source).toContain("router.post('/api/drivers/:driverId/suspend', authenticateJWT, requireRole(DASHBOARD_OPERATION_MUTATION_ROLES)");
  });

  it('keeps dashboard reports behind financial roles', () => {
    expect(source).toContain("normalizedPath.includes('/reports')");
    expect(source).toContain("router.get('/api/reports/comprehensive', authenticateJWT, requireRole(DASHBOARD_FINANCIAL_ROLES)");
    expect(source).toContain("router.get('/api/reports/export/:reportId', authenticateJWT, requireRole(DASHBOARD_FINANCIAL_ROLES)");
  });

  it('stores integrity-bound dashboard uploads without returning provider URLs', () => {
    const uploadStart = source.indexOf("'/api/drivers/:driverId/documents/:documentType/upload'");
    const uploadEnd = source.indexOf("router.post('/api/drivers/:driverId/vehicle/config'", uploadStart);
    const uploadSource = source.slice(uploadStart, uploadEnd);

    expect(uploadStart).toBeGreaterThan(-1);
    expect(uploadEnd).toBeGreaterThan(uploadStart);
    expect(uploadSource).toContain('requireRole(DASHBOARD_KYC_REVIEW_ROLES)');
    expect(uploadSource).toContain('const [storedMetadata] = await storageFile.getMetadata()');
    expect(uploadSource).toContain('storageGeneration');
    expect(uploadSource).toContain('documentSha256: sha256Buffer(req.file.buffer)');
    expect(uploadSource).toContain('contentAvailable: true');
    expect(uploadSource).not.toContain('getSignedUrl');
    expect(uploadSource).not.toContain('fileUrl:');
    expect(uploadSource).not.toContain('fileUrlExpiresAt');
  });

  it('streams the current document through an authenticated and audited Leaf boundary', () => {
    const routeStart = source.indexOf("'/api/drivers/:driverId/documents/:documentType/content'");
    const routeEnd = source.indexOf("function dashboardActivationDocumentReviewError", routeStart);
    const routeSource = source.slice(routeStart, routeEnd);

    expect(routeStart).toBeGreaterThan(-1);
    expect(routeEnd).toBeGreaterThan(routeStart);
    expect(routeSource).toContain('authenticateJWT');
    expect(routeSource).toContain('requireRole(DASHBOARD_KYC_REVIEW_ROLES)');
    expect(routeSource).toContain('downloadStoragePath(filePath');
    expect(routeSource).toContain('includeMetadata: true');
    expect(routeSource).toContain('resolveDashboardKycRuntime(req, driverId)');
    expect(routeSource).toContain('isCanonicalDashboardDocumentPath(driverId, documentType, filePath)');
    expect(routeSource).toContain('customMetadata.driverId');
    expect(routeSource).toContain("action: 'driver.document_content_view'");
    expect(routeSource).toContain('await auditService.requireEvent({');
    expect(routeSource).toContain("'Cache-Control': 'private, no-store, max-age=0'");
    expect(routeSource).toContain("'X-Content-Type-Options': 'nosniff'");
    expect(routeSource).not.toContain('document.fileUrl');
  });

  it('does not project persisted provider URLs in driver document metadata', () => {
    expect(source).toContain('projectDashboardDocumentMetadata(application.documents || {})');
    expect(source).toContain('DASHBOARD_DOCUMENT_PROVIDER_URL_KEYS');
  });

  it('keeps the document review queue on the restricted KYC role', () => {
    const queueStart = source.indexOf("'/api/drivers/documents/review-queue'");
    const queueEnd = source.indexOf("'/api/drivers/:driverId/documents/:documentType/upload'", queueStart);
    const queueSource = source.slice(queueStart, queueEnd);

    expect(queueStart).toBeGreaterThan(-1);
    expect(queueSource).toContain('requireRole(DASHBOARD_KYC_REVIEW_ROLES)');
    expect(queueSource).not.toContain('requireRole(DASHBOARD_OPERATION_ROLES)');
  });

  it('does not promote a driver account from an individual document review alone', () => {
    const reviewStart = source.indexOf("'/api/drivers/:driverId/documents/:documentType/review'");
    const reviewEnd = source.indexOf("router.get('/api/drivers/:driverId/documents'", reviewStart);
    const reviewSource = source.slice(reviewStart, reviewEnd);

    expect(reviewSource).toContain('await recomputeDriverActivationStatus(driverId)');
    expect(reviewSource).toContain("action: 'driver.document_review'");
    expect(reviewSource).toContain("resource: 'driver_document'");
    expect(reviewSource).toContain('driver_activation/${driverId}/documents/${normalizedDocumentType}/status');
    expect(reviewSource).toContain("emit('driverDocumentStatusUpdated'");
    expect(reviewSource).not.toContain('const allApproved =');
    expect(reviewSource).not.toContain('approvedAt: new Date().toISOString(),');
  });

  it('writes central audit logs for dashboard vehicle configuration changes', () => {
    const vehicleConfigStart = source.indexOf("router.post('/api/drivers/:driverId/vehicle/config'");
    const vehicleConfigEnd = source.indexOf("// 🚗 Aprovar Aplicação de Motorista", vehicleConfigStart);
    const vehicleConfigSource = source.slice(vehicleConfigStart, vehicleConfigEnd);

    expect(vehicleConfigSource).toContain("action: 'driver.vehicle_config_update'");
    expect(vehicleConfigSource).toContain("resource: 'driver_vehicle'");
    expect(vehicleConfigSource).toContain('auditService.logEvent');
  });

  it('delegates legacy driver suspension endpoints to canonical operational status management', () => {
    const suspendStart = source.indexOf("router.post('/api/drivers/:driverId/suspend'");
    const unsuspendStart = source.indexOf("router.post('/api/drivers/:driverId/unsuspend'");
    const routeEnd = source.indexOf('hardenDashboardApiRoutes();', unsuspendStart);
    const suspendSource = source.slice(suspendStart, unsuspendStart);
    const unsuspendSource = source.slice(unsuspendStart, routeEnd);

    expect(suspendSource).toContain('updateUserOperationalStatus(');
    expect(suspendSource).toContain("status: 'suspended'");
    expect(suspendSource).toContain('durationDays: duration');
    expect(suspendSource).not.toContain('db.ref(`users/${driverId}`).update');
    expect(unsuspendSource).toContain('updateUserOperationalStatus(');
    expect(unsuspendSource).toContain("status: 'active'");
    expect(unsuspendSource).not.toContain('db.ref(`users/${driverId}`).update');
  });
});
