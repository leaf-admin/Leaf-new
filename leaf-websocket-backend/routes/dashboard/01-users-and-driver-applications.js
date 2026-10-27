// Gerado a partir de routes/dashboard.js (divisão mecânica, mesma ordem de registro).
// Usuários, cadastro de motoristas, documentos e aprovação

const {
  DASHBOARD_KYC_REVIEW_ROLES,
  DASHBOARD_OPERATION_MUTATION_ROLES,
  DASHBOARD_OPERATION_ROLES,
  DASHBOARD_REVIEWABLE_DOCUMENT_TYPES,
  LEGACY_DRIVER_APPLICATION_MUTATIONS_ENABLED,
  adjustDocumentIndexCounters,
  getDocumentFirestore,
  driverDocumentStore,
  userStore,
  admin,
  adminDocumentUpload,
  assertCurrentCrlvReviewBinding,
  assertDashboardCnhMutationWindowHeld,
  auditService,
  authenticateJWT,
  backofficeCostGuardService,
  canAccessDashboardKycSandbox,
  canonicalDriverDocumentApprovalService,
  commitDriverOnlineProjection,
  crypto,
  dashboardKycAuditEnvelope,
  dashboardKycBoundaryError,
  driverApplicationService,
  emitDriverActivationUnlockedEvent,
  firebaseConfig,
  getDashboardKycStorageService,
  getUserDetails,
  getUserStats,
  isCanonicalDashboardDocumentPath,
  isDashboardCnhMutationGuardError,
  isSafeFirebasePathSegment,
  kycDriverStatusService,
  listUsers,
  logError,
  logStructured,
  normalizeDashboardDocumentContentType,
  normalizeId,
  normalizeVehicleOcrPayload,
  path,
  projectDashboardDocumentMetadata,
  recomputeDriverActivationStatus,
  redisPool,
  requireDashboardCnhMutationWindow,
  requireRole,
  resolveActiveTripForDriver,
  resolveDashboardKycRuntime,
  resolveRequestedDashboardKycScope,
  respondKycReviewError,
  restrictDashboardDirectDocumentUpload,
  router,
  runWithCurrentDocumentBinding,
  runWithDocumentMutationLease,
  sanitizeDocumentType,
  sanitizeFilename,
  sendDashboardCnhMutationGuardError,
  sendDashboardDocumentContentError,
  sha256Buffer,
  updateUserProfile
} = require('./shared');

// 📊 DASHBOARD APIs
// Estas APIs serão implementadas para fornecer dados para o dashboard

// 👥 User Management - DADOS REAIS (Firebase + Redis)
router.get('/api/users/stats', async (req, res) => {
  try {
    const redis = redisPool.getConnection();
    const stats = await getUserStats(redis, req.query || {});
    res.json(stats);
  } catch (error) {
    logError(error, 'Erro ao buscar stats de usuários:', { service: 'dashboard-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

const adminReadBudget = require('../../utils/admin-read-budget');

// 👥 Enhanced User Management - GESTÃO AVANÇADA
router.get('/api/users', authenticateJWT, requireRole(DASHBOARD_OPERATION_ROLES), adminReadBudget.rateLimiter, adminReadBudget.run(async (req, res) => {
  try {
    const response = await listUsers(req.query || {});
    res.json(response);
  } catch (error) {
    logError(error, 'Erro ao buscar usuários:', { service: 'dashboard-routes' });
    res.status(error.statusCode || 500).json({ error: error.statusCode && error.statusCode < 500 ? error.message : 'Erro interno do servidor' });
  }
}));

router.get('/api/users/:userId', authenticateJWT, requireRole(DASHBOARD_OPERATION_ROLES), async (req, res) => {
  try {
    const user = await getUserDetails(req.params.userId);
    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    return res.json(user);
  } catch (error) {
    logError(error, 'Erro ao buscar detalhes do usuário', { service: 'dashboard-routes' });
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 👤 Atualizar dados cadastrais de usuário via dashboard (admin)
router.patch('/api/users/:userId', authenticateJWT, requireRole(DASHBOARD_OPERATION_MUTATION_ROLES), async (req, res) => {
  try {
    const { userId } = req.params;
    const safeUserId = normalizeId(userId);
    if (!safeUserId) {
      return res.status(400).json({ error: 'userId inválido' });
    }
    const updatedUser = await updateUserProfile(safeUserId, req.body || {}, {
      operator: {
        id: req.user?.id || req.user?.userId || null,
        email: req.user?.email || null,
        role: req.user?.role || null
      }
    });

    if (!updatedUser) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    if (updatedUser.skipped) {
      return res.status(400).json({ error: 'Nenhum campo válido para atualização' });
    }

    return res.json({
      success: true,
      message: 'Dados cadastrais atualizados com sucesso',
      user: {
        id: safeUserId,
        firstName: updatedUser.raw?.firstName || '',
        lastName: updatedUser.raw?.lastName || '',
        email: updatedUser.email || '',
        mobile: updatedUser.mobile || '',
        city: updatedUser.city || '',
        state: updatedUser.state || '',
        approved: Boolean(updatedUser.approved),
        updatedAt: updatedUser.raw?.updatedAt || null
      }
    });
  } catch (error) {
    logError(error, 'Erro ao atualizar dados cadastrais de usuário', { service: 'dashboard-routes' });
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 🚗 Driver Applications - SISTEMA COMPLETO DE APROVAÇÃO
router.get('/api/drivers/applications', authenticateJWT, requireRole(DASHBOARD_KYC_REVIEW_ROLES), async (req, res) => {
  try {
    const requestedScope = resolveRequestedDashboardKycScope(req);
    if (requestedScope === 'sandbox' && !canAccessDashboardKycSandbox(req.user)) {
      return res.status(403).json({
        success: false,
        code: 'KYC_DASHBOARD_SANDBOX_ACCESS_DENIED',
        message: 'O acesso ao KYC sandbox exige permissão específica.'
      });
    }
    const response = await driverApplicationService.listApplications({
      ...(req.query || {}),
      persistenceScope: requestedScope
    });
    res.json(response);
  } catch (error) {
    logError(error, 'Erro ao buscar aplicações:', { service: 'dashboard-routes' });
    res.status(500).json({
      success: false,
      code: 'DRIVER_APPLICATIONS_UNAVAILABLE',
      message: 'Não foi possível carregar os motoristas agora.'
    });
  }
});

// Canonical metadata-only detail shadows the legacy provider-URL route registered later.
router.get(
  '/api/drivers/applications/:id',
  authenticateJWT,
  requireRole(DASHBOARD_KYC_REVIEW_ROLES),
  async (req, res) => {
    try {
      const driverId = String(req.params.id || '').trim();
      const kycRuntime = await resolveDashboardKycRuntime(req, driverId);
      const application = await driverApplicationService.getDriverApplication(driverId, {
        refresh: true,
        includeRatings: true
      });
      if (!application) {
        return res.status(404).json({
          success: false,
          message: 'Motorista não encontrado.'
        });
      }
      await auditService.requireEvent({
        userId: req.user?.id || req.user?.userId || req.user?.email,
        action: 'driver.application_metadata_view',
        resource: 'driver_application',
        severity: 'INFO',
        details: {
          driverId,
          actorEmail: req.user?.email || null,
          actorRole: req.user?.role || null
        },
        ip: req.ip,
        userAgent: req.headers['user-agent'] || 'unknown',
        success: true,
        ...dashboardKycAuditEnvelope(kycRuntime)
      });
      return res.json(application);
    } catch (error) {
      logError(error, 'Erro ao buscar aplicação canônica do motorista', {
        service: 'dashboard-routes',
        driverId: req.params.id
      });
      return respondKycReviewError(res, error);
    }
  }
);

// 📋 Aprovar/Rejeitar Documento Específico - NOVO SISTEMA
// ✅ Protegido com autenticação JWT e permissão de admin
router.post(
  '/api/drivers/:driverId/documents/:documentType/review',
  authenticateJWT,
  requireRole(DASHBOARD_KYC_REVIEW_ROLES),
  requireDashboardCnhMutationWindow,
  async (req, res) => {
    try {
      const { driverId, documentType } = req.params;
      const { action, rejectionReason } = req.body; // action: 'approve' | 'reject'
    const reviewedBy = req.user.id; // ✅ ID do admin logado
    const normalizedDocumentType = sanitizeDocumentType(documentType);

    if (!DASHBOARD_REVIEWABLE_DOCUMENT_TYPES.has(normalizedDocumentType)) {
      return res.status(400).json({
        success: false,
        code: 'DRIVER_DOCUMENT_TYPE_NOT_REVIEWABLE',
        message: 'Este tipo de documento não pode ser revisado por esta tela.'
      });
    }

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({
        success: false,
        message: 'Ação inválida. Use "approve" ou "reject".'
      });
    }

    if (action === 'reject' && !rejectionReason) {
      return res.status(400).json({
        success: false,
        message: 'Motivo da rejeição é obrigatório.'
      });
    }

    try {
      if (firebaseConfig && firebaseConfig.getRealtimeDB) {
        const db = firebaseConfig.getRealtimeDB();
        const firestore = getDocumentFirestore();

        // Verificar se o documento existe
        const driverUser = await driverDocumentStore.readUser(firestore, driverId);
        const storedDocument = driverUser?.documents?.[normalizedDocumentType] || null;

        if (!storedDocument) {
          return res.status(404).json({
            success: false,
            message: 'Documento não encontrado.'
          });
        }

        let existingDocument = storedDocument;
        const nextStatus = action === 'approve' ? 'approved' : 'rejected';
        const canonicalActivationStatus = action === 'approve' ? 'approved' : 'failed';
        let reviewAtIso = null;
        let reviewData = null;
        let canonicalReviewPending = null;
        const expectedReviewBinding = {
          submissionId: existingDocument.lastSubmissionId || existingDocument.submissionId,
          filePath: existingDocument.filePath,
          documentSha256: existingDocument.documentSha256,
          storageGeneration: existingDocument.storageGeneration
        };
        const reviewMutationId = `document_review_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
        const reviewAuditEnvelope = dashboardKycAuditEnvelope(req.dashboardDocumentKycRuntime);
        const reviewAuditIntent = await auditService.requireEvent({
          userId: reviewedBy,
          action: 'driver.document_review_intent',
          resource: 'driver_document',
          severity: action === 'reject' ? 'WARNING' : 'INFO',
          details: {
            mutationId: reviewMutationId,
            driverId,
            documentType: normalizedDocumentType,
            submissionId: expectedReviewBinding.submissionId || null,
            action,
            reviewedByEmail: req.user.email || null
          },
          ip: req.ip,
          userAgent: req.headers['user-agent'] || 'unknown',
          success: true,
          ...reviewAuditEnvelope
        });

        const applyReviewMutation = async ({
          documentLease = null,
          currentUserDocument = existingDocument
        }) => {
          const documentForReview = currentUserDocument || {};

          if (normalizedDocumentType === 'crlv') {
            await assertCurrentCrlvReviewBinding({
              firestore,
              driverId,
              document: documentForReview,
              action
            });
          }

          if (normalizedDocumentType === 'cnh') {
            await assertDashboardCnhMutationWindowHeld(req, driverId);
            await canonicalDriverDocumentApprovalService.assertReviewableBinding({
              driverId,
              documentType: normalizedDocumentType,
              submissionId: documentForReview.lastSubmissionId || documentForReview.submissionId,
              filePath: documentForReview.filePath,
              documentSha256: documentForReview.documentSha256,
              storageGeneration: documentForReview.storageGeneration
            });
            canonicalReviewPending = await canonicalDriverDocumentApprovalService.beginManualReview({
              driverId,
              documentType: normalizedDocumentType,
              submissionId: documentForReview.lastSubmissionId || documentForReview.submissionId,
              filePath: documentForReview.filePath,
              documentSha256: documentForReview.documentSha256,
              storageGeneration: documentForReview.storageGeneration,
              analysisStatus: documentForReview.analysisStatus,
              action,
              rejectionReason,
              reviewedBy,
              reviewedByEmail: req.user.email
            });
          }

          reviewAtIso = new Date().toISOString();
          reviewData = {
            status: nextStatus,
            reviewAuditIntentId: reviewAuditIntent.logId,
            reviewMutationId,
            reviewedAt: reviewAtIso,
            reviewedBy,
            reviewedByEmail: req.user.email,
            updatedAt: reviewAtIso,
            rejectionReason: action === 'reject' ? rejectionReason : null
          };

          // driver_documents_index is no longer written: nothing reads it and it
          // is not served by Firestore (writes were dropped after RTDB retired).
          const reviewReason = action === 'reject' ? rejectionReason : '';
          const reviewWrites = [
            ...Object.entries(reviewData).map(([field, value]) =>
              driverDocumentStore.userField(driverId, ['documents', normalizedDocumentType, field], value)),
            driverDocumentStore.userField(driverId, ['documents', normalizedDocumentType, 'analysisStatus'], canonicalActivationStatus),
            ...Object.entries({
              status: canonicalActivationStatus,
              reason: reviewReason,
              reviewedAt: reviewAtIso,
              reviewedBy,
              reviewedByEmail: req.user.email || null,
              updatedAt: reviewAtIso
            }).map(([field, value]) =>
              driverDocumentStore.activationField(driverId, ['documents', normalizedDocumentType, field], value)),
            driverDocumentStore.activationField(driverId, ['updatedAt'], reviewAtIso)
          ];
          const reviewSubmissionId = documentForReview.lastSubmissionId || documentForReview.submissionId;
          if (reviewSubmissionId) {
            Object.entries({
              status: canonicalActivationStatus,
              reason: reviewReason,
              reviewedAt: reviewAtIso,
              reviewedBy,
              reviewedByEmail: req.user.email || null,
              reviewAuditIntentId: reviewAuditIntent.logId,
              reviewMutationId,
              updatedAt: reviewAtIso
            }).forEach(([field, value]) => {
              reviewWrites.push(driverDocumentStore.activationField(
                driverId, ['documents_history', reviewSubmissionId, field], value
              ));
            });
          }

          if (normalizedDocumentType === 'cnh') {
            await assertDashboardCnhMutationWindowHeld(req, driverId);
          }
          await documentLease?.assertHeld();
          await driverDocumentStore.commit(firestore, reviewWrites);

          if (normalizedDocumentType === 'cnh') {
            await assertDashboardCnhMutationWindowHeld(req, driverId);
            await canonicalDriverDocumentApprovalService.finalizeManualReview({
              driverId,
              documentType: normalizedDocumentType,
              submissionId: documentForReview.lastSubmissionId || documentForReview.submissionId,
              filePath: documentForReview.filePath,
              documentSha256: documentForReview.documentSha256,
              storageGeneration: documentForReview.storageGeneration,
              reviewSyncToken: canonicalReviewPending.reviewSyncToken
            });
          }

          await documentLease?.assertHeld();
          await adjustDocumentIndexCounters(
            firestore,
            normalizedDocumentType,
            documentForReview.status || null,
            nextStatus
          );

          return documentForReview;
        };

        if (DASHBOARD_REVIEWABLE_DOCUMENT_TYPES.has(normalizedDocumentType)) {
          existingDocument = await runWithCurrentDocumentBinding({
            db,
            driverId,
            documentType: normalizedDocumentType,
            expectedBinding: expectedReviewBinding,
            scope: 'dashboard_document_review'
          }, async ({ lease, userDocument }) => applyReviewMutation({
            documentLease: lease,
            currentUserDocument: userDocument
          }));
        } else {
          existingDocument = await applyReviewMutation({});
        }

        await auditService.requireEvent({
          userId: reviewedBy,
          action: 'driver.document_review',
          resource: 'driver_document',
          severity: action === 'reject' ? 'WARNING' : 'INFO',
          details: {
            mutationId: reviewMutationId,
            auditIntentId: reviewAuditIntent.logId,
            driverId,
            documentType: normalizedDocumentType,
            action,
            previousStatus: existingDocument.status || null,
            nextStatus,
            rejectionReason: action === 'reject' ? rejectionReason : null,
            reviewedByEmail: req.user.email || null
          },
          ip: req.ip,
          userAgent: req.headers['user-agent'] || 'unknown',
          success: true,
          ...reviewAuditEnvelope
        });

        // Document review never grants operational access by itself. The canonical
        // activation service also evaluates vehicle, KYC and liveness evidence.
        let activationStatus = null;
        try {
          activationStatus = await recomputeDriverActivationStatus(driverId);
        } catch (recomputeError) {
          logStructured('warn', 'Falha ao recomputar ativação após revisão de documento', {
            service: 'dashboard-routes',
            driverId,
            documentType: normalizedDocumentType,
            error: recomputeError?.message || String(recomputeError)
          });
        }

        const io = req.app.get('io') || req.app.locals?.io || null;
        if (io) {
          io.to(`driver_${driverId}`).emit('driverDocumentStatusUpdated', {
            driverId,
            documentType: normalizedDocumentType,
            status: canonicalActivationStatus,
            reason: action === 'reject' ? rejectionReason : '',
            updatedAt: reviewAtIso,
            canGoOnline: Boolean(activationStatus?.canGoOnline),
            activationState: activationStatus?.activationState || null
          });
        }

        try {
          await driverApplicationService.syncDriverApplication(driverId, {
            db,
            includeRatings: false
          });
        } catch (syncError) {
          logStructured('warn', 'Falha ao sincronizar espelho Firestore da aplicação do motorista', {
            service: 'dashboard-routes',
            driverId,
            error: syncError.message
          });
        }

        logStructured('info', `✅ Documento ${normalizedDocumentType} do motorista ${driverId} ${action === 'approve' ? 'aprovado' : 'rejeitado'} por ${req.user.email} (${reviewedBy})`, { service: 'dashboard-routes' });

        res.json({
          success: true,
          message: `Documento ${action === 'approve' ? 'aprovado' : 'rejeitado'} com sucesso!`,
          data: {
            driverId,
            documentType: normalizedDocumentType,
            action,
            reviewedAt: reviewData.reviewedAt
          }
        });
      } else {
        throw new Error('Firebase não configurado');
      }
    } catch (error) {
      if (normalizedDocumentType === 'cnh' && isDashboardCnhMutationGuardError(error)) {
        return sendDashboardCnhMutationGuardError(res, error);
      }
      if (String(error?.code || '').startsWith('DRIVER_ACTIVATION_DOCUMENT_')) {
        return res.status(409).json({
          success: false,
          code: error.code,
          message: error.message
        });
      }
      if (String(error?.code || '').startsWith('KYC_CANONICAL_DOCUMENT_')) {
        return res.status(409).json({
          success: false,
          code: error.code,
          message: error.message
        });
      }
      if (error?.code === 'AUDIT_WRITE_UNAVAILABLE') {
        return res.status(503).json({
          success: false,
          code: 'DRIVER_DOCUMENT_AUDIT_UNAVAILABLE',
          message: 'Não foi possível registrar esta ação com segurança. Tente novamente.'
        });
      }
      logError(error, '❌ Erro ao revisar documento:', { service: 'dashboard-routes' });
      return res.status(500).json({
        success: false,
        message: 'Não foi possível concluir a revisão do documento agora.'
      });
    }
    } catch (error) {
      logError(error, '❌ Erro na API de review de documento:', { service: 'dashboard-routes' });
      return res.status(500).json({
        success: false,
        message: 'Erro interno do servidor.'
      });
    }
  }
);

// 📋 Buscar Documentos de um Motorista Específico - NOVA API
// ✅ Protegido com autenticação JWT e permissão de admin
router.get('/api/drivers/:driverId/documents', authenticateJWT, requireRole(DASHBOARD_KYC_REVIEW_ROLES), async (req, res) => {
  try {
    const { driverId } = req.params;
    await resolveDashboardKycRuntime(req, driverId);
    const application = await driverApplicationService.getDriverApplication(driverId, {
      refresh: true,
      includeRatings: true
    });
    if (!application) {
      return res.status(404).json({
        success: false,
        message: 'Motorista não encontrado.'
      });
    }

    res.json({
      success: true,
      data: {
        driverId,
        driver: application.driver,
        ratingInsights: application.ratingInsights || {
          averageRating: null,
          totalRatings: 0,
          latestNegativeReviews: []
        },
        kyc: application.kyc || {},
        documents: projectDashboardDocumentMetadata(application.documents || {}),
        totalDocuments: application.totalDocuments || 0,
        vehicleConfig: application.vehicleConfig || {
          vehicles: []
        }
      }
    });
  } catch (error) {
    logError(error, '❌ Erro na API de documentos:', { service: 'dashboard-routes' });
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor.'
    });
  }
});

router.get(
  '/api/drivers/:driverId/documents/:documentType/content',
  authenticateJWT,
  requireRole(DASHBOARD_KYC_REVIEW_ROLES),
  async (req, res) => {
    const driverId = String(req.params.driverId || '').trim();
    const documentType = sanitizeDocumentType(req.params.documentType);

    try {
      if (!isSafeFirebasePathSegment(driverId)) {
        throw dashboardKycBoundaryError('DRIVER_DOCUMENT_DRIVER_ID_INVALID', 'Motorista inválido.');
      }
      if (!DASHBOARD_REVIEWABLE_DOCUMENT_TYPES.has(documentType)) {
        throw dashboardKycBoundaryError('DRIVER_DOCUMENT_TYPE_INVALID', 'Tipo de documento inválido.');
      }
      const kycRuntime = await resolveDashboardKycRuntime(req, driverId);

      const firestore = firebaseConfig?.getFirestore?.();
      if (!firestore) {
        throw dashboardKycBoundaryError(
          'DRIVER_DOCUMENT_STORE_UNAVAILABLE',
          'Armazenamento de documentos indisponível.'
        );
      }

      const driverUser = await driverDocumentStore.readUser(firestore, driverId);
      const document = driverUser?.documents?.[documentType] || null;
      if (!document) {
        throw dashboardKycBoundaryError('DRIVER_DOCUMENT_NOT_FOUND', 'Documento não encontrado.');
      }

      const filePath = String(document.filePath || '').trim();
      if (!isCanonicalDashboardDocumentPath(driverId, documentType, filePath)) {
        throw dashboardKycBoundaryError(
          'DRIVER_DOCUMENT_BINDING_PATH_MISMATCH',
          'O vínculo do documento não corresponde ao motorista e ao tipo solicitados.'
        );
      }

      const storageGeneration = String(document.storageGeneration || '').trim();
      const documentSha256 = String(document.documentSha256 || '').trim().toLowerCase();
      if (!/^\d+$/.test(storageGeneration) || !/^[a-f0-9]{64}$/.test(documentSha256)) {
        throw dashboardKycBoundaryError(
          'DRIVER_DOCUMENT_REUPLOAD_REQUIRED',
          'Documento sem vínculo canônico.'
        );
      }

      const storedObject = await getDashboardKycStorageService().downloadStoragePath(filePath, {
        ...(storageGeneration ? { generation: storageGeneration } : {}),
        includeMetadata: true
      });
      const documentBuffer = storedObject?.buffer;
      if (!Buffer.isBuffer(documentBuffer) || documentBuffer.length === 0) {
        throw dashboardKycBoundaryError(
          'DRIVER_DOCUMENT_CONTENT_INVALID',
          'Conteúdo do documento inválido.'
        );
      }
      if (sha256Buffer(documentBuffer) !== documentSha256) {
        throw dashboardKycBoundaryError(
          'DRIVER_DOCUMENT_INTEGRITY_MISMATCH',
          'Integridade do documento divergiu.'
        );
      }
      const customMetadata = storedObject?.metadata?.customMetadata || {};
      if (
        String(customMetadata.driverId || '').trim() !== driverId ||
        sanitizeDocumentType(customMetadata.documentType) !== documentType
      ) {
        throw dashboardKycBoundaryError(
          'DRIVER_DOCUMENT_BINDING_METADATA_MISMATCH',
          'Os metadados do documento divergem do vínculo atual.'
        );
      }

      await auditService.requireEvent({
        userId: req.user?.id || req.user?.userId || req.user?.email,
        action: 'driver.document_content_view',
        resource: 'driver_document',
        severity: 'INFO',
        details: {
          driverId,
          documentType,
          submissionId: document.lastSubmissionId || document.submissionId || null,
          actorEmail: req.user?.email || null,
          actorRole: req.user?.role || null
        },
        ip: req.ip,
        userAgent: req.headers['user-agent'] || 'unknown',
        success: true,
        ...dashboardKycAuditEnvelope(kycRuntime)
      });

      const contentType = normalizeDashboardDocumentContentType(
        storedObject?.metadata?.contentType || document.fileType
      );
      const fallbackExtension = contentType === 'application/pdf' ? '.pdf' : '';
      const filename = sanitizeFilename(
        document.fileName || path.basename(filePath) || `${documentType}${fallbackExtension}`
      );
      res.set({
        'Content-Type': contentType,
        'Content-Length': String(documentBuffer.length),
        'Cache-Control': 'private, no-store, max-age=0',
        Pragma: 'no-cache',
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': `inline; filename="${filename || `documento-${documentType}${fallbackExtension}`}"`
      });
      return res.status(200).send(documentBuffer);
    } catch (error) {
      logError(error, 'Falha ao abrir documento do motorista no dashboard', {
        service: 'dashboard-routes',
        driverId,
        documentType
      });
      return sendDashboardDocumentContentError(res, error);
    }
  }
);

// 📚 Fila de revisão de documentos usando índice denormalizado
router.get(
  '/api/drivers/documents/review-queue',
  authenticateJWT,
  requireRole(DASHBOARD_KYC_REVIEW_ROLES),
  async (req, res) => {
    try {
      const requestedScope = resolveRequestedDashboardKycScope(req);
      if (requestedScope === 'sandbox' && !canAccessDashboardKycSandbox(req.user)) {
        return res.status(403).json({
          success: false,
          code: 'KYC_DASHBOARD_SANDBOX_ACCESS_DENIED',
          message: 'O acesso ao KYC sandbox exige permissão específica.'
        });
      }
      const data = await driverApplicationService.listReviewQueue({
        ...(req.query || {}),
        persistenceScope: requestedScope
      });
      const payload = await backofficeCostGuardService.attachToResponse(
        res,
        'drivers.documents.reviewQueue',
        {
          success: true,
          data
        },
        {
          limit: req.query?.limit
        }
      );
      return res.json(payload);
    } catch (error) {
      logError(error, 'Erro ao buscar fila de revisão de documentos', { service: 'dashboard-routes' });
      return res.status(500).json({
        success: false,
        code: 'DRIVER_DOCUMENT_REVIEW_QUEUE_UNAVAILABLE',
        message: 'Não foi possível carregar a fila de revisão agora.'
      });
    }
  }
);

// 📎 Upload de documento pelo dashboard (ex.: certidão de antecedentes)
router.post(
  '/api/drivers/:driverId/documents/:documentType/upload',
  authenticateJWT,
  requireRole(DASHBOARD_KYC_REVIEW_ROLES),
  restrictDashboardDirectDocumentUpload,
  requireDashboardCnhMutationWindow,
  (req, res, next) => {
    adminDocumentUpload.single('file')(req, res, (err) => {
      if (err) {
        return res.status(400).json({
          success: false,
          message: err.message || 'Falha ao receber arquivo'
        });
      }
      return next();
    });
  },
  async (req, res) => {
    let storageFile = null;
    let storageObjectCreated = false;
    let documentCommitted = false;
    try {
      const { driverId } = req.params;
      const documentType = sanitizeDocumentType(req.params.documentType);

      if (!driverId || !documentType) {
        return res.status(400).json({
          success: false,
          message: 'driverId e documentType são obrigatórios.'
        });
      }

      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: 'Arquivo é obrigatório.'
        });
      }

      if (!firebaseConfig || !firebaseConfig.getRealtimeDB) {
        return res.status(503).json({
          success: false,
          message: 'Firebase não configurado.'
        });
      }

      const db = firebaseConfig.getRealtimeDB();
      const firestore = getDocumentFirestore();
      if (!(await driverDocumentStore.readUser(firestore, driverId))) {
        return res.status(404).json({
          success: false,
          message: 'Motorista não encontrado.'
        });
      }

      const requestedMime = String(req.file.mimetype || '').toLowerCase();
      if (documentType === 'antecedentes_criminais' && requestedMime !== 'application/pdf') {
        return res.status(400).json({
          success: false,
          message: 'A certidão de antecedentes deve ser enviada em PDF.'
        });
      }

      const nowIso = new Date().toISOString();
      const bucketName = process.env.FIREBASE_STORAGE_BUCKET || 'leaf-reactnative.firebasestorage.app';
      const bucket = admin.storage().bucket(bucketName);
      const fileName = sanitizeFilename(req.file.originalname || `${documentType}.pdf`);
      const extension = path.extname(fileName) || (requestedMime === 'application/pdf' ? '.pdf' : '');
      const objectPath = `documents/${driverId}/${documentType}/${Date.now()}_${fileName.replace(extension, '')}${extension}`;
      const submissionId = `dashboard_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
      const uploadAuditEnvelope = dashboardKycAuditEnvelope(req.dashboardDocumentKycRuntime);
      const uploadAuditIntent = await auditService.requireEvent({
        userId: req.user?.id || req.user?.userId || req.user?.email,
        action: 'driver.document_upload_intent',
        resource: 'driver_document',
        severity: 'INFO',
        details: {
          mutationId: submissionId,
          driverId,
          documentType,
          fileName,
          fileSize: Number(req.file.size || 0),
          actorEmail: req.user?.email || null,
          actorRole: req.user?.role || null
        },
        ip: req.ip,
        userAgent: req.headers['user-agent'] || 'unknown',
        success: true,
        ...uploadAuditEnvelope
      });
      storageFile = bucket.file(objectPath);
      await storageFile.save(req.file.buffer, {
        resumable: false,
        metadata: {
          contentType: req.file.mimetype,
          metadata: {
            uploadedBy: String(req.user?.id || ''),
            uploadedByEmail: String(req.user?.email || ''),
            documentType,
            driverId
          }
        }
      });
      storageObjectCreated = true;
      const [storedMetadata] = await storageFile.getMetadata();
      const storageGeneration = String(storedMetadata?.generation || '').trim();
      if (!/^\d+$/.test(storageGeneration)) {
        throw dashboardKycBoundaryError(
          'DRIVER_DOCUMENT_STORAGE_GENERATION_INVALID',
          'O armazenamento não confirmou a versão do documento.'
        );
      }

      const documentPayload = {
        type: documentType,
        documentType,
        submissionId,
        lastSubmissionId: submissionId,
        uploadAuditIntentId: uploadAuditIntent.logId,
        uploadMutationId: submissionId,
        status: 'pending',
        filePath: objectPath,
        storageGeneration,
        documentSha256: sha256Buffer(req.file.buffer),
        fileType: req.file.mimetype,
        fileName,
        fileSize: Number(req.file.size || 0),
        uploadedAt: nowIso,
        uploadedBy: String(req.user?.id || ''),
        uploadedByEmail: String(req.user?.email || ''),
        updatedAt: nowIso
      };

      await runWithDocumentMutationLease({
        db,
        driverId,
        documentType,
        scope: `dashboard_upload_${submissionId}`
      }, async ({ lease }) => {
        const { userDocument: previousDocument } = await driverDocumentStore.readDocumentBinding(firestore, {
          driverId,
          documentType
        });
        const activationPayload = {
          ...documentPayload,
          lastSubmissionId: null,
          reason: '',
          source: 'dashboard_document_upload'
        };
        await lease.assertHeld();
        await driverDocumentStore.commit(firestore, [
          driverDocumentStore.userField(driverId, ['documents', documentType], documentPayload),
          driverDocumentStore.activationField(driverId, ['documents', documentType], activationPayload),
          driverDocumentStore.activationField(driverId, ['documents_history', submissionId], activationPayload),
          driverDocumentStore.activationField(driverId, ['updatedAt'], nowIso)
        ]);
        documentCommitted = true;
        await lease.assertHeld();
        try {
          await adjustDocumentIndexCounters(
            firestore,
            documentType,
            previousDocument?.status || null,
            'pending'
          );
        } catch (counterError) {
          logStructured('warn', 'Falha ao atualizar contadores após upload documental', {
            service: 'dashboard-routes',
            driverId,
            documentType,
            error: counterError?.message || String(counterError)
          });
        }
      });

      try {
        await driverApplicationService.syncDriverApplication(driverId, {
          db,
          includeRatings: false
        });
      } catch (syncError) {
        logStructured('warn', 'Falha ao sincronizar espelho Firestore após upload de documento no dashboard', {
          service: 'dashboard-routes',
          driverId,
          documentType,
          error: syncError.message
        });
      }

      await auditService.requireEvent({
        userId: req.user?.id || req.user?.userId || req.user?.email,
        action: 'driver.document_upload',
        resource: 'driver_document',
        severity: 'INFO',
        details: {
          mutationId: submissionId,
          auditIntentId: uploadAuditIntent.logId,
          driverId,
          documentType,
          submissionId,
          actorEmail: req.user?.email || null,
          actorRole: req.user?.role || null
        },
        ip: req.ip,
        userAgent: req.headers['user-agent'] || 'unknown',
        success: true,
        ...uploadAuditEnvelope
      });

      logStructured('info', 'Documento enviado via dashboard', {
        service: 'dashboard-routes',
        driverId,
        documentType,
        uploadedBy: req.user?.email || req.user?.id || 'admin',
        fileSize: documentPayload.fileSize
      });

      return res.json({
        success: true,
        message: 'Documento enviado com sucesso.',
        data: {
          driverId,
          documentType,
          contentAvailable: true,
          status: 'pending'
        }
      });
    } catch (error) {
      if (storageObjectCreated && !documentCommitted && storageFile) {
        await storageFile.delete({ ignoreNotFound: true }).catch((cleanupError) => {
          logStructured('warn', 'Falha ao remover upload incompleto de documento do dashboard', {
            service: 'dashboard-routes',
            driverId: req.params?.driverId || null,
            documentType: sanitizeDocumentType(req.params?.documentType),
            error: cleanupError?.message || String(cleanupError)
          });
        });
      }
      logError(error, 'Erro ao fazer upload de documento no dashboard', { service: 'dashboard-routes' });
      return res.status(500).json({
        success: false,
        code: error?.code || 'DRIVER_DOCUMENT_UPLOAD_UNAVAILABLE',
        message: 'Não foi possível enviar o documento agora. Tente novamente.'
      });
    }
  }
);

// 🚗 Atualizar configuração manual de veículo/categoria do motorista
// ✅ Protegido com autenticação JWT e permissão de admin
router.post('/api/drivers/:driverId/vehicle/config', authenticateJWT, requireRole(DASHBOARD_OPERATION_MUTATION_ROLES), async (req, res) => {
  try {
    const { driverId } = req.params;
    const {
      userVehicleId,
      setActive = true,
      category,
      vehicleStatus,
      acceptPlusWithElite
    } = req.body || {};

    if (!userVehicleId) {
      return res.status(400).json({
        success: false,
        message: 'userVehicleId é obrigatório.'
      });
    }

    const normalizedCategory = category ? String(category).trim().toLowerCase() : null;
    if (normalizedCategory && !['plus', 'elite', 'moto'].includes(normalizedCategory)) {
      return res.status(400).json({
        success: false,
        message: 'Categoria inválida. Use plus, elite ou moto.'
      });
    }

    const normalizedVehicleStatus = vehicleStatus ? String(vehicleStatus).toLowerCase() : null;
    if (normalizedVehicleStatus && !['approved', 'pending', 'rejected', 'active', 'inactive'].includes(normalizedVehicleStatus)) {
      return res.status(400).json({
        success: false,
        message: 'vehicleStatus inválido.'
      });
    }

    if (!firebaseConfig || !firebaseConfig.getRealtimeDB) {
      return res.status(503).json({
        success: false,
        message: 'Firebase não configurado.'
      });
    }

    const db = firebaseConfig.getRealtimeDB();
    const driverRecord = await userStore.readUser(firebaseConfig.getFirestore(), driverId);
    if (!driverRecord) {
      return res.status(404).json({ success: false, message: 'Motorista não encontrado.' });
    }

    const userVehiclesRef = db.ref(`user_vehicles/${driverId}`);
    const userVehiclesSnapshot = await userVehiclesRef.once('value');
    const userVehicles = userVehiclesSnapshot.val() || {};
    const selected = userVehicles[userVehicleId];

    if (!selected) {
      return res.status(404).json({
        success: false,
        message: 'Veículo do motorista não encontrado.'
      });
    }

    const selectedVehicleId = selected.vehicleId || null;
    const nowIso = new Date().toISOString();
    const requestsOperationalRevocation =
      setActive === false || ['pending', 'rejected', 'inactive'].includes(normalizedVehicleStatus);
    const shouldActivateVehicle = setActive !== false && !requestsOperationalRevocation;
    if (shouldActivateVehicle && !selectedVehicleId) {
      return res.status(400).json({
        success: false,
        message: 'Não é possível ativar vínculo sem vehicleId associado.'
      });
    }

    let canonicalSelectedVehicleData = null;
    const requestsOperationalVehicleConfig =
      !requestsOperationalRevocation && (
        shouldActivateVehicle || ['approved', 'active'].includes(normalizedVehicleStatus)
      );
    if (requestsOperationalVehicleConfig) {
      let canonicalCrlvNode;
      try {
        const crlvSnapshot = await db
          .ref(`driver_activation/${driverId}/documents/crlv`)
          .once('value');
        canonicalCrlvNode = crlvSnapshot.val() || {};
      } catch (crlvReadError) {
        logStructured('error', 'Falha ao ler CRLV canônico antes da configuração operacional do veículo', {
          service: 'dashboard-routes',
          driverId,
          userVehicleId,
          error: crlvReadError.message
        });
        return res.status(503).json({
          success: false,
          code: 'CANONICAL_CRLV_STATUS_UNAVAILABLE',
          message: 'Não foi possível validar o CRLV canônico. A configuração operacional foi bloqueada.'
        });
      }

      const canonicalCrlvStatus = String(canonicalCrlvNode?.status || '').trim().toLowerCase();
      if (canonicalCrlvStatus !== 'approved') {
        return res.status(409).json({
          success: false,
          code: 'CANONICAL_CRLV_APPROVAL_REQUIRED',
          message: 'O CRLV canônico precisa estar aprovado antes de aprovar ou ativar o veículo.',
          data: {
            driverId,
            userVehicleId,
            crlvStatus: canonicalCrlvStatus || 'missing'
          }
        });
      }

      try {
        const selectedVehicleSnapshot = await db
          .ref(`vehicles/${selectedVehicleId}`)
          .once('value');
        canonicalSelectedVehicleData = selectedVehicleSnapshot.val() || {};
      } catch (vehicleReadError) {
        logStructured('error', 'Falha ao ler identidade canônica do veículo antes da configuração operacional', {
          service: 'dashboard-routes',
          driverId,
          userVehicleId,
          vehicleId: selectedVehicleId,
          error: vehicleReadError.message
        });
        return res.status(503).json({
          success: false,
          code: 'CANONICAL_VEHICLE_IDENTITY_UNAVAILABLE',
          message: 'Não foi possível validar a identidade canônica do veículo. A configuração operacional foi bloqueada.'
        });
      }

      const canonicalCrlvData = canonicalCrlvNode?.data || canonicalCrlvNode?.extractedData || {};
      const canonicalCrlvPlate = normalizeVehicleOcrPayload(canonicalCrlvData).plate || '';
      const canonicalVehiclePlate = normalizeVehicleOcrPayload({
        plate:
          canonicalSelectedVehicleData?.plateNormalized ||
          canonicalSelectedVehicleData?.plate ||
          canonicalSelectedVehicleData?.placa ||
          canonicalSelectedVehicleData?.vehicleNumber ||
          canonicalSelectedVehicleData?.carPlate ||
          canonicalSelectedVehicleData?.ocrData?.data?.plateNormalized ||
          canonicalSelectedVehicleData?.ocrData?.data?.plate ||
          ''
      }).plate || '';

      if (!canonicalCrlvPlate || !canonicalVehiclePlate) {
        return res.status(409).json({
          success: false,
          code: 'CANONICAL_CRLV_VEHICLE_IDENTITY_REQUIRED',
          message: 'CRLV e veículo precisam ter placa canônica antes da aprovação ou ativação.',
          data: {
            driverId,
            userVehicleId,
            vehicleId: selectedVehicleId,
            crlvPlatePresent: Boolean(canonicalCrlvPlate),
            vehiclePlatePresent: Boolean(canonicalVehiclePlate)
          }
        });
      }

      if (canonicalCrlvPlate !== canonicalVehiclePlate) {
        return res.status(409).json({
          success: false,
          code: 'CANONICAL_CRLV_VEHICLE_MISMATCH',
          message: 'A placa do CRLV aprovado não corresponde ao veículo selecionado.',
          data: {
            driverId,
            userVehicleId,
            vehicleId: selectedVehicleId,
            crlvPlate: canonicalCrlvPlate,
            vehiclePlate: canonicalVehiclePlate
          }
        });
      }
    }

    const updates = {};
    Object.keys(userVehicles).forEach((id) => {
      updates[`user_vehicles/${driverId}/${id}/isActive`] = false;
      updates[`user_vehicles/${driverId}/${id}/updatedAt`] = nowIso;
    });

    updates[`user_vehicles/${driverId}/${userVehicleId}/isActive`] = shouldActivateVehicle;
    updates[`user_vehicles/${driverId}/${userVehicleId}/updatedAt`] = nowIso;
    updates[`users/${driverId}/activeVehicleId`] = shouldActivateVehicle ? (selectedVehicleId || '') : '';
    updates[`users/${driverId}/updatedAt`] = nowIso;

    if (vehicleStatus) {
      const nextStatus = normalizedVehicleStatus;
      updates[`user_vehicles/${driverId}/${userVehicleId}/status`] = nextStatus;
      updates[`user_vehicles/${driverId}/${userVehicleId}/approved`] = ['approved', 'active'].includes(nextStatus);
      updates[`user_vehicles/${driverId}/${userVehicleId}/reviewedAt`] = nowIso;
      updates[`user_vehicles/${driverId}/${userVehicleId}/reviewedBy`] = req.user.id;
    }

    if (requestsOperationalVehicleConfig && canonicalSelectedVehicleData) {
      const canonicalVehicleIdentity = normalizeVehicleOcrPayload({
        ...canonicalSelectedVehicleData,
        ...(canonicalSelectedVehicleData?.ocrData?.data || {})
      });
      const canonicalLinkFields = {
        plate: canonicalVehicleIdentity.plate,
        plateNormalized: canonicalVehicleIdentity.plateNormalized,
        brand: canonicalVehicleIdentity.brand || canonicalVehicleIdentity.make,
        model: canonicalVehicleIdentity.model,
        color: canonicalVehicleIdentity.color,
        year: canonicalVehicleIdentity.year
      };
      Object.entries(canonicalLinkFields).forEach(([field, value]) => {
        if (value) {
          updates[`user_vehicles/${driverId}/${userVehicleId}/${field}`] = value;
        }
      });
    }

    if (normalizedCategory) {
      const categoryLabel = normalizedCategory === 'elite'
        ? 'Leaf Elite'
        : normalizedCategory === 'moto'
          ? 'Leaf Moto'
          : 'Leaf Plus';
      if (selected.vehicleId) {
        updates[`vehicles/${selected.vehicleId}/manualCategory`] = normalizedCategory;
        updates[`vehicles/${selected.vehicleId}/carType`] = categoryLabel;
        updates[`vehicles/${selected.vehicleId}/category`] = normalizedCategory;
        updates[`vehicles/${selected.vehicleId}/updatedAt`] = nowIso;
      }
      updates[`users/${driverId}/carType`] = categoryLabel;
      updates[`users/${driverId}/updatedAt`] = nowIso;
    }

    if (typeof acceptPlusWithElite === 'boolean') {
      updates[`users/${driverId}/acceptPlusWithElite`] = acceptPlusWithElite;
      updates[`users/${driverId}/updatedAt`] = nowIso;
    }

    await db.ref().update(updates);

    await auditService.logEvent({
      userId: req.user?.id || req.user?.userId || req.user?.email || 'dashboard',
      action: 'driver.vehicle_config_update',
      resource: 'driver_vehicle',
      severity: vehicleStatus ? 'WARNING' : 'INFO',
      details: {
        driverId,
        userVehicleId,
        vehicleId: selectedVehicleId || null,
        category: normalizedCategory || null,
        setActive: shouldActivateVehicle,
        requestedSetActive: setActive !== false,
        vehicleStatus: vehicleStatus || null,
        acceptPlusWithElite: typeof acceptPlusWithElite === 'boolean' ? acceptPlusWithElite : null,
        actorEmail: req.user?.email || null,
        actorRole: req.user?.role || null
      },
      ip: req.ip,
      userAgent: req.headers['user-agent'] || 'unknown',
      success: true
    });

    let operationalSyncPending = false;
    let operationalRevocation = null;
    if (requestsOperationalRevocation) {
      operationalRevocation = {
        requested: true,
        synced: false,
        dispatchEligible: false,
        offlineDeferred: true,
        offlineDeferredReason: 'OPERATIONAL_SYNC_PENDING',
        activeTripId: null,
        activeTripStateKnown: false,
        reason: 'VEHICLE_CONFIGURATION_REVOKED'
      };

      try {
        const redis = redisPool.getConnection();
        await redisPool.ensureConnection();
        const driverKey = `driver:${driverId}`;
        const eligibleDriverGeoKey = process.env.ELIGIBLE_DRIVER_GEO_KEY || 'driver_locations_eligible';
        const revokedAt = new Date().toISOString();

        // O bloqueio de novos despachos precede a leitura da corrida ativa. Assim,
        // uma revogação nunca cria uma nova oferta, mas também não derruba uma
        // corrida que já esteja em andamento.
        await commitDriverOnlineProjection(redis, {
          driverId,
          driverKey,
          eligibleGeoKey: eligibleDriverGeoKey,
          projectionScope: 'eligibility_only',
          dispatchEligible: false,
          fields: {
            driverId,
            dispatchEligible: 'false',
            dispatchEligibilityCode: 'VEHICLE_CONFIGURATION_REVOKED',
            dispatchEligibilityCheckedAt: revokedAt,
            vehicleAccessRevoked: 'true',
            updatedAt: revokedAt
          }
        });

        let activeTripStateKnown = false;
        let activeTrip = { tripId: null, customerId: null };
        try {
          activeTrip = await resolveActiveTripForDriver(redis, driverId) || activeTrip;
          activeTripStateKnown = true;
        } catch (activeTripReadError) {
          logStructured('warn', 'Falha ao consultar corrida ativa durante revogação do veículo', {
            service: 'dashboard-routes',
            driverId,
            userVehicleId,
            error: activeTripReadError?.message || String(activeTripReadError)
          });
        }

        const hasActiveTrip = Boolean(activeTrip?.tripId);
        const offlineDeferred = hasActiveTrip || !activeTripStateKnown;
        const offlineDeferredReason = hasActiveTrip
          ? 'ACTIVE_TRIP'
          : !activeTripStateKnown
            ? 'ACTIVE_TRIP_STATE_UNKNOWN'
            : null;
        const revocationReason = hasActiveTrip
          ? 'VEHICLE_CONFIGURATION_REVOKED_ACTIVE_TRIP'
          : !activeTripStateKnown
            ? 'VEHICLE_CONFIGURATION_REVOKED_ACTIVE_TRIP_STATE_UNKNOWN'
            : 'VEHICLE_CONFIGURATION_REVOKED';

        if (offlineDeferred) {
          await commitDriverOnlineProjection(redis, {
            driverId,
            driverKey,
            eligibleGeoKey: eligibleDriverGeoKey,
            projectionScope: 'eligibility_only',
            dispatchEligible: false,
            fields: {
              dispatchEligible: 'false',
              dispatchEligibilityCode: revocationReason,
              vehicleOfflinePendingAfterTrip: 'true',
              vehicleOfflineDeferredReason: offlineDeferredReason,
              ...(hasActiveTrip ? { activeTripId: String(activeTrip.tripId) } : {}),
              updatedAt: revokedAt
            }
          });
        } else {
          await commitDriverOnlineProjection(redis, {
            driverId,
            driverKey,
            eligibleGeoKey: eligibleDriverGeoKey,
            isOnline: false,
            dispatchEligible: false,
            fields: {
              status: 'OFFLINE',
              isOnline: 'false',
              dispatchEligible: 'false',
              dispatchEligibilityCode: revocationReason,
              vehicleOfflinePendingAfterTrip: 'false',
              vehicleOfflineDeferredReason: '',
              updatedAt: revokedAt
            }
          });
        }

        operationalRevocation = {
          requested: true,
          synced: true,
          dispatchEligible: false,
          offlineDeferred,
          offlineDeferredReason,
          activeTripId: activeTrip?.tripId || null,
          activeTripStateKnown,
          reason: revocationReason
        };
      } catch (operationalSyncError) {
        operationalSyncPending = true;
        logStructured('error', 'Falha ao aplicar revogação operacional do veículo no Redis', {
          service: 'dashboard-routes',
          driverId,
          userVehicleId,
          error: operationalSyncError?.message || String(operationalSyncError)
        });
      }
    }

    // Melhor esforço: atualizar metadados de veículo e invalidar o cache derivado.
    let cacheSyncPending = false;
    try {
      const redis = redisPool.getConnection();
      await redisPool.ensureConnection();
      const userData = await userStore.readUser(firebaseConfig.getFirestore(), driverId) || {};
      const selectedVehicleSnapshot = !canonicalSelectedVehicleData && selected.vehicleId
        ? await db.ref(`vehicles/${selected.vehicleId}`).once('value')
        : null;
      const selectedVehicleData = canonicalSelectedVehicleData || selectedVehicleSnapshot?.val() || {};
      const plate = selectedVehicleData.plate || selectedVehicleData.vehicleNumber || userData.vehicleNumber || userData.carPlate || '';
      const resolvedCategory = normalizedCategory ||
        selectedVehicleData.manualCategory ||
        selectedVehicleData.category ||
        (
          String(userData.carType || '').toLowerCase().includes('elite')
            ? 'elite'
            : String(userData.carType || '').toLowerCase().includes('moto')
              ? 'moto'
              : 'plus'
        );

      await redis.hset(`driver:${driverId}`, {
        carType: resolvedCategory === 'elite' ? 'Leaf Elite' : resolvedCategory === 'moto' ? 'Leaf Moto' : 'Leaf Plus',
        vehicleCategory: resolvedCategory,
        vehicleNumber: plate,
        acceptsPlusWithElite: String(userData.acceptPlusWithElite === true || acceptPlusWithElite === true),
        activeVehicleId: shouldActivateVehicle ? (selected.vehicleId || '') : '',
        driverApproved: String(userData.approved === true),
        vehicleApproved: String(
          normalizedVehicleStatus
            ? ['approved', 'active'].includes(normalizedVehicleStatus)
            : ((selected.status || '') === 'approved' || selected.approved === true)
        ),
        lastVehicleConfigUpdate: nowIso
      });
      await redis.del(`driver_eligibility_profile:${driverId}`, `driver_activation_gate:${driverId}`);
    } catch (redisSyncError) {
      cacheSyncPending = true;
      logStructured('warn', 'Falha ao sincronizar configuração de veículo no Redis', {
        service: 'dashboard-routes',
        driverId,
        error: redisSyncError.message
      });
    }

    let activationSyncPending = false;
    let activationStatus = null;
    try {
      activationStatus = await recomputeDriverActivationStatus(driverId);
      emitDriverActivationUnlockedEvent(req, driverId, activationStatus);
    } catch (recomputeError) {
      activationSyncPending = true;
      logStructured('warn', 'Falha ao recomputar ativação após configuração do veículo', {
        service: 'dashboard-routes',
        driverId,
        userVehicleId,
        error: recomputeError?.message || String(recomputeError)
      });
      try {
        emitDriverActivationUnlockedEvent(req, driverId, {
          canGoOnline: false,
          activationState: 'VEHICLE_PENDING',
          activationSyncPending: true,
          blockingReason: 'ACTIVATION_SYNC_PENDING'
        });
      } catch (fallbackEmitError) {
        logStructured('warn', 'Falha ao emitir fallback de ativação pendente após configuração do veículo', {
          service: 'dashboard-routes',
          driverId,
          userVehicleId,
          error: fallbackEmitError?.message || String(fallbackEmitError)
        });
      }
    }

    const hasPendingSync = operationalSyncPending || cacheSyncPending || activationSyncPending;
    res.json({
      success: true,
      message: hasPendingSync
        ? 'Configuração persistida, mas há sincronização operacional pendente.'
        : 'Configuração do veículo atualizada com sucesso.',
      data: {
        driverId,
        userVehicleId,
        category: normalizedCategory || null,
        setActive: shouldActivateVehicle,
        requestedSetActive: setActive !== false,
        vehicleStatus: vehicleStatus || null,
        acceptPlusWithElite: typeof acceptPlusWithElite === 'boolean' ? acceptPlusWithElite : null,
        operationalSyncPending,
        cacheSyncPending,
        activationSyncPending,
        activationState:
          activationStatus?.state ||
          activationStatus?.activationState ||
          (activationSyncPending ? 'VEHICLE_PENDING' : null),
        canGoOnline: activationStatus?.canGoOnline === true,
        operationalRevocation
      }
    });
  } catch (error) {
    logError(error, 'Erro ao atualizar configuração de veículo do motorista', { service: 'dashboard-routes' });
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor.'
    });
  }
});

// 🚗 Aprovar Aplicação de Motorista
// ✅ Protegido com autenticação JWT e permissão de admin
router.post('/api/drivers/applications/:id/approve', authenticateJWT, requireRole(DASHBOARD_OPERATION_MUTATION_ROLES), async (req, res) => {
  if (!LEGACY_DRIVER_APPLICATION_MUTATIONS_ENABLED) {
    return res.status(410).json({
      success: false,
      code: 'LEGACY_DRIVER_APPLICATION_MUTATION_DISABLED',
      error: 'Aprovação em massa legada está desativada. Revise documentos individualmente e use o fluxo canônico de ativação.'
    });
  }

  try {
    const { id } = req.params;
    const { notes } = req.body;
    const adminId = req.user.id; // ✅ ID do admin logado

    try {
      if (firebaseConfig && firebaseConfig.getRealtimeDB) {
        const db = firebaseConfig.getRealtimeDB();

        // Verificar se o usuário existe
        const firestore = getDocumentFirestore();
        const user = await userStore.readUser(firestore, id);
        if (!user) {
          return res.status(404).json({ error: 'Motorista não encontrado' });
        }

        if (user.usertype !== 'driver') {
          return res.status(400).json({ error: 'Usuário não é um motorista' });
        }

        const documents = (await userStore.readUser(firestore, id))?.documents || {};
        const manualApprovalEvidence = Object.entries(documents).map(([docType, doc]) => ({
          type: sanitizeDocumentType(docType) || docType,
          status: doc?.status || null,
          fileName: doc?.fileName || null,
          fileType: doc?.fileType || null,
          uploadedAt: doc?.uploadedAt || null
        }));
        const manualApprovalAudit = {
          actorId: adminId,
          actorRole: req.user.role || 'admin',
          reason: notes || 'Aprovacao manual de aplicacao de motorista pelo dashboard',
          provenance: 'dashboard_driver_application_approval',
          evidence: manualApprovalEvidence.length > 0
            ? manualApprovalEvidence
            : [{ type: 'dashboard_application', ref: id }]
        };

        await kycDriverStatusService.unblockDriver(id, {
          confidence: 1,
          similarityScore: 1,
          manualOverride: true,
          audit: {
            ...manualApprovalAudit,
            reason: `${manualApprovalAudit.reason}; liberacao KYC vinculada a aprovacao manual`
          }
        });

        // ✅ Atualizar status de aprovação no Firebase Realtime Database
        const updates = {
          approved: true,
          approvedAt: new Date().toISOString(),
          approvedBy: adminId,
          approvedByEmail: req.user.email, // ✅ Email do admin para auditoria
          adminNotes: notes || '',
          manualApprovalAudit,
          status: 'approved',
          kycStatus: 'approved',
          kycBlocked: false,
          kycUpdatedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };

        // ✅ Salvar no Firebase Realtime Database
        await userStore.updateUser(firestore, id, updates);

        // ✅ Atualizar também todos os documentos para aprovados
        const documentUpdates = [];
        const counterTransitions = [];
        const reviewedAtIso = new Date().toISOString();
        Object.keys(documents).forEach(docType => {
          const normalizedDocType = sanitizeDocumentType(docType);
          if (!normalizedDocType) return;
          const existingDoc = documents[docType] || {};
          const previousStatus = existingDoc.status || null;
          Object.entries({
            status: 'approved',
            reviewedAt: reviewedAtIso,
            reviewedBy: adminId,
            updatedAt: reviewedAtIso,
            rejectionReason: null
          }).forEach(([field, value]) => {
            documentUpdates.push(driverDocumentStore.userField(id, ['documents', normalizedDocType, field], value));
          });
          counterTransitions.push({ documentType: normalizedDocType, previousStatus, nextStatus: 'approved' });
        });
        if (documentUpdates.length > 0) {
          await driverDocumentStore.commit(firestore, documentUpdates);
          if (counterTransitions.length > 0) {
            await Promise.all(
              counterTransitions.map((entry) =>
                adjustDocumentIndexCounters(firestore, entry.documentType, entry.previousStatus, entry.nextStatus)
              )
            );
          }
        }

        const activationUpdatedAt = new Date().toISOString();
        await driverDocumentStore.commit(firestore, [
          driverDocumentStore.userField(id, ['driverActivationConsent', 'backgroundCheck'], true),
          driverDocumentStore.userField(id, ['driverActivationConsent', 'updatedAt'], activationUpdatedAt),
          driverDocumentStore.activationField(id, ['consent', 'backgroundCheck', 'accepted'], true),
          driverDocumentStore.activationField(id, ['consent', 'backgroundCheck', 'acceptedAt'], activationUpdatedAt),
          driverDocumentStore.activationField(id, ['consent', 'backgroundCheck', 'updatedAt'], activationUpdatedAt)
        ]);

        try {
          await recomputeDriverActivationStatus(id);
        } catch (recomputeError) {
          logStructured('warn', 'Falha ao recomputar ativação após aprovação de aplicação', {
            service: 'dashboard-routes',
            driverId: id,
            error: recomputeError?.message || String(recomputeError)
          });
        }

        emitDriverActivationUnlockedEvent(req, id, {
          activationState: 'ACTIVE'
        });

        try {
          await driverApplicationService.syncDriverApplication(id, {
            db,
            includeRatings: false
          });
        } catch (syncError) {
          logStructured('warn', 'Falha ao sincronizar espelho Firestore após aprovação de motorista', {
            service: 'dashboard-routes',
            driverId: id,
            error: syncError.message
          });
        }

        logStructured('info', `✅ Aplicação aprovada: ${id} por ${req.user.email} (${adminId})`, { service: 'dashboard-routes' });

        res.json({
          success: true,
          message: 'Aplicação aprovada com sucesso',
          data: { driverId: id, approvedAt: updates.approvedAt }
        });
      } else {
        res.status(503).json({ error: 'Firebase não disponível' });
      }
    } catch (firebaseError) {
      logStructured('error', 'Erro ao aprovar no Firebase:', firebaseError, { service: 'dashboard-routes' });
      res.status(500).json({ error: 'Erro ao salvar aprovação' });
    }
  } catch (error) {
    logError(error, 'Erro ao aprovar aplicação:', { service: 'dashboard-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 🚗 Rejeitar Aplicação de Motorista
// ✅ Protegido com autenticação JWT e permissão de admin
router.post('/api/drivers/applications/:id/reject', authenticateJWT, requireRole(DASHBOARD_OPERATION_MUTATION_ROLES), async (req, res) => {
  if (!LEGACY_DRIVER_APPLICATION_MUTATIONS_ENABLED) {
    return res.status(410).json({
      success: false,
      code: 'LEGACY_DRIVER_APPLICATION_MUTATION_DISABLED',
      error: 'Rejeição em massa legada está desativada. Use a revisão individual de documentos com motivo auditável.'
    });
  }

  try {
    const { id } = req.params;
    const { notes, rejectionReasons } = req.body;
    const adminId = req.user.id; // ✅ ID do admin logado

    if (!rejectionReasons) {
      return res.status(400).json({ error: 'Motivo da rejeição é obrigatório' });
    }

    try {
      if (firebaseConfig && firebaseConfig.getRealtimeDB) {
        const db = firebaseConfig.getRealtimeDB();

        // Verificar se o usuário existe
        const firestore = getDocumentFirestore();
        const user = await userStore.readUser(firestore, id);
        if (!user) {
          return res.status(404).json({ error: 'Motorista não encontrado' });
        }

        if (user.usertype !== 'driver') {
          return res.status(400).json({ error: 'Usuário não é um motorista' });
        }

        // ✅ Atualizar status de rejeição no Firebase Realtime Database
        const updates = {
          approved: false,
          rejectedAt: new Date().toISOString(),
          rejectedBy: adminId,
          rejectedByEmail: req.user.email, // ✅ Email do admin para auditoria
          rejectionReasons: rejectionReasons,
          adminNotes: notes || '',
          status: 'rejected',
          kycStatus: 'rejected',
          kycBlocked: true,
          kycUpdatedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };

        // ✅ Salvar no Firebase Realtime Database
        await userStore.updateUser(firestore, id, updates);

        // ✅ Atualizar também todos os documentos para rejeitados
        const documents = (await userStore.readUser(firestore, id))?.documents || {};
        const documentUpdates = [];
        const counterTransitions = [];
        const reviewedAtIso = new Date().toISOString();
        Object.keys(documents).forEach(docType => {
          const normalizedDocType = sanitizeDocumentType(docType);
          if (!normalizedDocType) return;
          const existingDoc = documents[docType] || {};
          const previousStatus = existingDoc.status || null;
          Object.entries({
            status: 'rejected',
            reviewedAt: reviewedAtIso,
            reviewedBy: adminId,
            updatedAt: reviewedAtIso,
            rejectionReason: rejectionReasons?.join(', ') || 'Aplicação rejeitada'
          }).forEach(([field, value]) => {
            documentUpdates.push(driverDocumentStore.userField(id, ['documents', normalizedDocType, field], value));
          });
          counterTransitions.push({ documentType: normalizedDocType, previousStatus, nextStatus: 'rejected' });
        });
        if (documentUpdates.length > 0) {
          await driverDocumentStore.commit(firestore, documentUpdates);
          if (counterTransitions.length > 0) {
            await Promise.all(
              counterTransitions.map((entry) =>
                adjustDocumentIndexCounters(firestore, entry.documentType, entry.previousStatus, entry.nextStatus)
              )
            );
          }
        }

        // Melhor esforço: bloquear também no pipeline KYC para impedir operação.
        try {
          await kycDriverStatusService.blockDriver(
            id,
            `Aprovação manual rejeitada: ${Array.isArray(rejectionReasons) ? rejectionReasons.join(', ') : rejectionReasons}`,
            { verificationAttempts: 0 }
          );
        } catch (kycBlockError) {
          logStructured('warn', 'Falha ao bloquear motorista no serviço KYC após rejeição manual', {
            service: 'dashboard-routes',
            driverId: id,
            error: kycBlockError.message
          });
        }

        try {
          await driverApplicationService.syncDriverApplication(id, {
            db,
            includeRatings: false
          });
        } catch (syncError) {
          logStructured('warn', 'Falha ao sincronizar espelho Firestore após rejeição de motorista', {
            service: 'dashboard-routes',
            driverId: id,
            error: syncError.message
          });
        }

        logStructured('info', `❌ Aplicação rejeitada: ${id} por ${req.user.email} (${adminId})`, { service: 'dashboard-routes' });

        res.json({
          success: true,
          message: 'Aplicação rejeitada',
          data: { driverId: id, rejectedAt: updates.rejectedAt }
        });
      } else {
        res.status(503).json({ error: 'Firebase não disponível' });
      }
    } catch (firebaseError) {
      logStructured('error', 'Erro ao rejeitar no Firebase:', firebaseError, { service: 'dashboard-routes' });
      res.status(500).json({ error: 'Erro ao salvar rejeição' });
    }
  } catch (error) {
    logError(error, 'Erro ao rejeitar aplicação:', { service: 'dashboard-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});
