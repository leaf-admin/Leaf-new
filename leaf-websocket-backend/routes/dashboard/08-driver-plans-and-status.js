// Gerado a partir de routes/dashboard.js (divisão mecânica, mesma ordem de registro).
// Planos, assinatura, aprovação e suspensão de motoristas

const {
  DASHBOARD_FINANCIAL_ROLES,
  DASHBOARD_KYC_REVIEW_ROLES,
  DASHBOARD_OPERATION_MUTATION_ROLES,
  DASHBOARD_OPERATION_ROLES,
  DashboardUserManagementError,
  KYC_PERMANENT_BLOCK_CONFIRMATION,
  applyConfirmedIdentityFraudBlock,
  applyDashboardIdentityReverificationGate,
  assertDriverIdentityNotPermanentlyBlocked,
  auditService,
  authenticateJWT,
  canonicalDriverDocumentApprovalService,
  crypto,
  dashboardKycAuditEnvelope,
  dashboardKycPersistenceContext,
  emitDriverActivationUnlockedEvent,
  firebaseConfig,
  getDashboardKycCnhFaceService,
  getDashboardKycReviewer,
  getDashboardKycStorageService,
  logError,
  logStructured,
  logger,
  normalizeKycReviewReason,
  normalizeManualApprovalEvidence,
  recomputeDriverActivationStatus,
  requireAdminMutationsEnabled,
  requireDashboardKycScopedPolicy,
  requireRole,
  resolveDashboardKycRuntime,
  resolveRideDriverNetAmount,
  respondKycReviewError,
  router,
  sha256Buffer,
  subscriptionStateService,
  supportTicketService,
  updateUserOperationalStatus
} = require('./shared');

// ==================== GESTÃO COMPLETA DE MOTORISTAS ====================

/**
 * Lista completa de motoristas com todas as informações de negócio
 * GET /api/drivers/complete
 * Query params: status, planType, approvalStatus, search, page, limit
 */
router.get('/api/drivers/complete', authenticateJWT, requireRole(DASHBOARD_OPERATION_ROLES), async (req, res) => {
  try {
    const {
      status, // 'active', 'pending', 'suspended', 'expired'
      planType, // 'plus', 'elite', 'none'
      approvalStatus, // 'approved', 'pending', 'rejected'
      search,
      page = 1,
      limit = 50
    } = req.query;

    if (!firebaseConfig || !firebaseConfig.getRealtimeDB) {
      return res.status(500).json({ error: 'Firebase não disponível' });
    }

    const db = firebaseConfig.getRealtimeDB();
    const promotionService = require('../../services/promotion-service');

    // Buscar todos os motoristas
    const usersSnapshot = await db.ref('users').orderByChild('usertype').equalTo('driver').once('value');
    const users = usersSnapshot.val() || {};

    // Buscar veículos
    const carsSnapshot = await db.ref('cars').once('value');
    const cars = carsSnapshot.val() || {};

    // Buscar corridas para estatísticas
    const bookingsSnapshot = await db.ref('bookings').once('value');
    const bookings = bookingsSnapshot.val() || {};

    const now = new Date();
    const drivers = [];

    for (const driverId of Object.keys(users)) {
      const driver = users[driverId];

      // Buscar veículo do motorista
      const driverCar = Object.values(cars).find(car => car.driver === driverId);

      // Calcular estatísticas de corridas
      const driverBookings = Object.values(bookings).filter(b => b.driver === driverId);
      const completedBookings = driverBookings.filter(b => b.status === 'COMPLETED');
      const totalEarnings = completedBookings.reduce((sum, b) => sum + resolveRideDriverNetAmount(b), 0);

      // Determinar plano
      let driverPlanType = 'none';
      let planName = 'Sem Plano';
      let weeklyFee = 0;

      if (driver.planType === 'elite') {
        driverPlanType = 'elite';
        planName = 'Leaf Elite';
        weeklyFee = 99.90;
      } else if (driver.planType === 'plus') {
        driverPlanType = 'plus';
        planName = 'Leaf Plus';
        weeklyFee = 49.90;
      }

      // Calcular período grátis
      const freeTrialEnd = driver.free_trial_end ? new Date(driver.free_trial_end) : null;
      const freeMonthsEnd = driver.free_months_end ? new Date(driver.free_months_end) : null;
      const promotionFreeEnd = driver.promotion_free_end ? new Date(driver.promotion_free_end) : null;

      let latestFreeEnd = null;
      let isFree = false;
      let freeReason = null;

      if (freeTrialEnd && freeTrialEnd > now) {
        latestFreeEnd = freeTrialEnd;
        isFree = true;
        freeReason = 'Free Trial';
      }
      if (freeMonthsEnd && freeMonthsEnd > now) {
        if (!latestFreeEnd || freeMonthsEnd > latestFreeEnd) {
          latestFreeEnd = freeMonthsEnd;
          isFree = true;
          freeReason = 'Meses Grátis (Indicação)';
        }
      }
      if (promotionFreeEnd && promotionFreeEnd > now) {
        if (!latestFreeEnd || promotionFreeEnd > latestFreeEnd) {
          latestFreeEnd = promotionFreeEnd;
          isFree = true;
          freeReason = 'Promoção Ativa';
        }
      }

      // Calcular próxima renovação
      let nextRenewal = null;
      let subscriptionStatus = 'none';
      let daysUntilRenewal = null;

      if (driverPlanType !== 'none') {
        if (isFree && latestFreeEnd) {
          nextRenewal = latestFreeEnd;
          subscriptionStatus = 'free';
          daysUntilRenewal = Math.ceil((latestFreeEnd - now) / (1000 * 60 * 60 * 24));
        } else {
          // Calcular próxima segunda-feira + 2 dias (quarta-feira)
          const currentDay = now.getDay();
          const daysUntilMonday = currentDay === 0 ? 1 : (8 - currentDay) % 7;
          const nextMonday = new Date(now);
          nextMonday.setDate(now.getDate() + daysUntilMonday);
          nextMonday.setHours(0, 0, 0, 0);

          nextRenewal = new Date(nextMonday);
          nextRenewal.setDate(nextMonday.getDate() + 2); // Quarta-feira

          daysUntilRenewal = Math.ceil((nextRenewal - now) / (1000 * 60 * 60 * 24));

          // Verificar status da assinatura
          const billingStatus = driver.billing_status || 'active';
          if (billingStatus === 'overdue') {
            subscriptionStatus = 'overdue';
          } else if (billingStatus === 'suspended') {
            subscriptionStatus = 'suspended';
          } else {
            subscriptionStatus = 'active';
          }
        }
      }

      // Status de aprovação
      const approvalStatus = driver.approved ? 'approved' : (driver.licenseImage ? 'pending' : 'not_submitted');

      // Status geral do motorista
      let driverStatus = 'active';
      if (!driver.approved) {
        driverStatus = 'pending';
      } else if (driver.suspended) {
        driverStatus = 'suspended';
      } else if (subscriptionStatus === 'suspended') {
        driverStatus = 'suspended';
      }

      const driverData = {
        id: driverId,
        // Informações básicas
        name: `${driver.firstName || ''} ${driver.lastName || ''}`.trim(),
        email: driver.email || '',
        phone: driver.mobile || '',
        profileImage: driver.profile_image || '',
        registrationDate: driver.createdAt ? new Date(driver.createdAt).toISOString() : null,
        lastActivity: driver.lastLogin ? new Date(driver.lastLogin).toISOString() : null,

        // Status de aprovação
        approvalStatus,
        approved: driver.approved || false,
        kycStatus: driver.kyc_status || 'pending',
        documents: {
          license: driver.licenseImage ? 'uploaded' : 'missing',
          vehicle: driverCar ? 'uploaded' : 'missing',
          verified: driver.approved || false
        },

        // Plano e assinatura
        plan: {
          type: driverPlanType,
          name: planName,
          weeklyFee,
          status: subscriptionStatus,
          isFree,
          freeReason,
          freeUntil: latestFreeEnd ? latestFreeEnd.toISOString() : null,
          nextRenewal: nextRenewal ? nextRenewal.toISOString() : null,
          daysUntilRenewal
        },

        // Veículo
        vehicle: driverCar ? {
          make: driverCar.carMake || '',
          model: driverCar.carModel || '',
          plate: driverCar.carNumber || '',
          color: driverCar.carColor || '',
          type: driverCar.carType || '',
          year: driverCar.carYear || ''
        } : null,

        // Estatísticas
        stats: {
          totalTrips: driverBookings.length,
          completedTrips: completedBookings.length,
          totalEarnings: totalEarnings.toFixed(2),
          averageRating: parseFloat(driver.driverRating || 0).toFixed(1),
          walletBalance: parseFloat(driver.walletBalance || 0).toFixed(2)
        },

        // Status online
        online: {
          isOnline: driver.driverActiveStatus || false,
          lastSeen: driver.lastLocationUpdate ? new Date(driver.lastLocationUpdate).toISOString() : null
        },

        // Status geral
        status: driverStatus,
        suspended: driver.suspended || false
      };

      // Aplicar filtros
      if (status && status !== 'all' && driverData.status !== status) continue;
      if (planType && planType !== 'all' && driverData.plan.type !== planType) continue;
      if (approvalStatus && approvalStatus !== 'all' && driverData.approvalStatus !== approvalStatus) continue;
      if (search) {
        const searchLower = search.toLowerCase();
        if (
          !driverData.name.toLowerCase().includes(searchLower) &&
          !driverData.email.toLowerCase().includes(searchLower) &&
          !driverData.phone.includes(search) &&
          !driverId.toLowerCase().includes(searchLower)
        ) continue;
      }

      drivers.push(driverData);
    }

    // Ordenar por data de registro (mais recente primeiro)
    drivers.sort((a, b) => {
      const dateA = a.registrationDate ? new Date(a.registrationDate) : new Date(0);
      const dateB = b.registrationDate ? new Date(b.registrationDate) : new Date(0);
      return dateB - dateA;
    });

    // Paginação
    const total = drivers.length;
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + parseInt(limit);
    const paginatedDrivers = drivers.slice(startIndex, endIndex);

    res.json({
      success: true,
      drivers: paginatedDrivers,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    logger.error('❌ Erro ao buscar lista completa de motoristas:', error);
    res.status(500).json({
      error: 'Erro interno do servidor',
      message: error.message
    });
  }
});

/**
 * Detalhes completos de um motorista específico
 * GET /api/drivers/:driverId/complete
 */
router.get('/api/drivers/:driverId/complete', authenticateJWT, requireRole(DASHBOARD_OPERATION_ROLES), async (req, res) => {
  try {
    const { driverId } = req.params;

    if (!firebaseConfig || !firebaseConfig.getRealtimeDB) {
      return res.status(500).json({ error: 'Firebase não disponível' });
    }

    const db = firebaseConfig.getRealtimeDB();

    // Buscar motorista
    const driverSnapshot = await db.ref(`users/${driverId}`).once('value');
    const driver = driverSnapshot.val();

    if (!driver || driver.usertype !== 'driver') {
      return res.status(404).json({ error: 'Motorista não encontrado' });
    }

    // Buscar veículo
    const carsSnapshot = await db.ref('cars').once('value');
    const cars = carsSnapshot.val() || {};
    const driverCar = Object.values(cars).find(car => car.driver === driverId);

    // Buscar corridas
    const bookingsSnapshot = await db.ref('bookings').orderByChild('driver').equalTo(driverId).once('value');
    const bookings = bookingsSnapshot.val() || {};

    // Buscar histórico de pagamentos de assinatura
    const paymentsSnapshot = await db.ref('payments').orderByChild('driverId').equalTo(driverId).once('value');
    const payments = paymentsSnapshot.val() || {};

    // Calcular todas as informações
    const now = new Date();

    // Determinar plano
    let planType = 'none';
    let planName = 'Sem Plano';
    let weeklyFee = 0;

    if (driver.planType === 'elite') {
      planType = 'elite';
      planName = 'Leaf Elite';
      weeklyFee = 99.90;
    } else if (driver.planType === 'plus') {
      planType = 'plus';
      planName = 'Leaf Plus';
      weeklyFee = 49.90;
    }

    // Calcular período grátis
    const freeTrialEnd = driver.free_trial_end ? new Date(driver.free_trial_end) : null;
    const freeMonthsEnd = driver.free_months_end ? new Date(driver.free_months_end) : null;
    const promotionFreeEnd = driver.promotion_free_end ? new Date(driver.promotion_free_end) : null;

    let latestFreeEnd = null;
    let isFree = false;
    let freeReason = null;

    if (freeTrialEnd && freeTrialEnd > now) {
      latestFreeEnd = freeTrialEnd;
      isFree = true;
      freeReason = 'Free Trial';
    }
    if (freeMonthsEnd && freeMonthsEnd > now) {
      if (!latestFreeEnd || freeMonthsEnd > latestFreeEnd) {
        latestFreeEnd = freeMonthsEnd;
        isFree = true;
        freeReason = 'Meses Grátis (Indicação)';
      }
    }
    if (promotionFreeEnd && promotionFreeEnd > now) {
      if (!latestFreeEnd || promotionFreeEnd > latestFreeEnd) {
        latestFreeEnd = promotionFreeEnd;
        isFree = true;
        freeReason = 'Promoção Ativa';
      }
    }

    // Calcular próxima renovação
    let nextRenewal = null;
    let subscriptionStatus = 'none';
    let daysUntilRenewal = null;

    if (planType !== 'none') {
      if (isFree && latestFreeEnd) {
        nextRenewal = latestFreeEnd;
        subscriptionStatus = 'free';
        daysUntilRenewal = Math.ceil((latestFreeEnd - now) / (1000 * 60 * 60 * 24));
      } else {
        const currentDay = now.getDay();
        const daysUntilMonday = currentDay === 0 ? 1 : (8 - currentDay) % 7;
        const nextMonday = new Date(now);
        nextMonday.setDate(now.getDate() + daysUntilMonday);
        nextMonday.setHours(0, 0, 0, 0);

        nextRenewal = new Date(nextMonday);
        nextRenewal.setDate(nextMonday.getDate() + 2);

        daysUntilRenewal = Math.ceil((nextRenewal - now) / (1000 * 60 * 60 * 24));

        const billingStatus = driver.billing_status || 'active';
        if (billingStatus === 'overdue') {
          subscriptionStatus = 'overdue';
        } else if (billingStatus === 'suspended') {
          subscriptionStatus = 'suspended';
        } else {
          subscriptionStatus = 'active';
        }
      }
    }

    // Calcular estatísticas
    const driverBookings = Object.values(bookings);
    const completedBookings = driverBookings.filter(b => b.status === 'COMPLETED');
    const totalEarnings = completedBookings.reduce((sum, b) => sum + resolveRideDriverNetAmount(b), 0);

    // Histórico de pagamentos
    const subscriptionPayments = Object.values(payments)
      .filter(p => p.type === 'subscription')
      .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));

    const driverData = {
      id: driverId,
      // Informações básicas
      name: `${driver.firstName || ''} ${driver.lastName || ''}`.trim(),
      email: driver.email || '',
      phone: driver.mobile || '',
      profileImage: driver.profile_image || '',
      registrationDate: driver.createdAt ? new Date(driver.createdAt).toISOString() : null,
      lastActivity: driver.lastLogin ? new Date(driver.lastLogin).toISOString() : null,

      // Status de aprovação
      approvalStatus: driver.approved ? 'approved' : (driver.licenseImage ? 'pending' : 'not_submitted'),
      approved: driver.approved || false,
      approvedAt: driver.approvedAt || null,
      kycStatus: driver.kyc_status || 'pending',
      documents: {
        license: driver.licenseImage ? 'uploaded' : 'missing',
        licenseImage: driver.licenseImage || null,
        vehicle: driverCar ? 'uploaded' : 'missing',
        verified: driver.approved || false
      },

      // Plano e assinatura
      plan: {
        type: planType,
        name: planName,
        weeklyFee,
        status: subscriptionStatus,
        isFree,
        freeReason,
        freeUntil: latestFreeEnd ? latestFreeEnd.toISOString() : null,
        nextRenewal: nextRenewal ? nextRenewal.toISOString() : null,
        daysUntilRenewal,
        billingStatus: driver.billing_status || 'active'
      },

      // Veículo
      vehicle: driverCar ? {
        make: driverCar.carMake || '',
        model: driverCar.carModel || '',
        plate: driverCar.carNumber || '',
        color: driverCar.carColor || '',
        type: driverCar.carType || '',
        year: driverCar.carYear || '',
        image: driverCar.carImage || null
      } : null,

      // Estatísticas
      stats: {
        totalTrips: driverBookings.length,
        completedTrips: completedBookings.length,
        cancelledTrips: driverBookings.filter(b => b.status === 'CANCELED').length,
        totalEarnings: totalEarnings.toFixed(2),
        averageRating: parseFloat(driver.driverRating || 0).toFixed(1),
        walletBalance: parseFloat(driver.walletBalance || 0).toFixed(2),
        totalWithdrawals: 0 // TODO: calcular de histórico de saques
      },

      // Histórico de pagamentos
      paymentHistory: subscriptionPayments.map(p => ({
        id: p.id || '',
        amount: parseFloat(p.amount || 0).toFixed(2),
        status: p.status || 'pending',
        weekStart: p.weekStart || null,
        timestamp: p.timestamp || null,
        method: p.method || 'unknown'
      })),

      // Status online
      online: {
        isOnline: driver.driverActiveStatus || false,
        lastSeen: driver.lastLocationUpdate ? new Date(driver.lastLocationUpdate).toISOString() : null
      },

      // Status geral
      status: driver.suspended ? 'suspended' : (driver.approved ? 'active' : 'pending'),
      suspended: driver.suspended || false,
      suspendedAt: driver.suspendedAt || null,
      suspendReason: driver.suspendReason || null,
      suspendedUntil: driver.suspendedUntil || null
    };

    res.json({
      success: true,
      driver: driverData
    });

  } catch (error) {
    logger.error(`❌ Erro ao buscar detalhes do motorista ${req.params.driverId}:`, error);
    res.status(500).json({
      error: 'Erro interno do servidor',
      message: error.message
    });
  }
});

/**
 * Atualizar plano do motorista
 * PATCH /api/drivers/:driverId/plan
 * Body: { planType: 'plus' | 'elite' | 'none' }
 */
router.patch('/api/drivers/:driverId/plan', authenticateJWT, requireRole(DASHBOARD_FINANCIAL_ROLES), requireAdminMutationsEnabled, async (req, res) => {
  try {
    const { driverId } = req.params;
    const { planType } = req.body;

    if (!['plus', 'elite', 'none'].includes(planType)) {
      return res.status(400).json({ error: 'Tipo de plano inválido' });
    }

    if (!firebaseConfig || !firebaseConfig.getRealtimeDB) {
      return res.status(500).json({ error: 'Firebase não disponível' });
    }

    const db = firebaseConfig.getRealtimeDB();

    // Atualizar plano
    await db.ref(`users/${driverId}/planType`).set(planType);

    logger.info(`✅ Plano do motorista ${driverId} atualizado para ${planType}`);

    res.json({
      success: true,
      message: `Plano atualizado para ${planType}`,
      driverId,
      planType
    });

  } catch (error) {
    logger.error(`❌ Erro ao atualizar plano do motorista ${req.params.driverId}:`, error);
    res.status(500).json({
      error: 'Erro interno do servidor',
      message: error.message
    });
  }
});

/**
 * Atualizar status de assinatura
 * PATCH /api/drivers/:driverId/subscription
 * Body: { status: 'active' | 'suspended' | 'cancelled', billing_status: 'active' | 'overdue' | 'suspended' }
 */
router.patch('/api/drivers/:driverId/subscription', authenticateJWT, requireRole(DASHBOARD_FINANCIAL_ROLES), requireAdminMutationsEnabled, async (req, res) => {
  try {
    const { driverId } = req.params;
    const {
      status,
      billing_status,
      adminId = 'admin1',
      notes,
      planType,
      waveId,
      dailyFeeCents,
      dailyFeeOverrideCents,
      isFeeExempt,
      feeExemptUntil,
      collectionMode
    } = req.body || {};

    if (!firebaseConfig || !firebaseConfig.getRealtimeDB) {
      return res.status(500).json({ error: 'Firebase não disponível' });
    }

    const db = firebaseConfig.getRealtimeDB();
    const nowIso = new Date().toISOString();

    const subscriptionPatch = {};
    if (status) {
      subscriptionPatch.status = status;
    }
    if (billing_status) {
      subscriptionPatch.billingStatus = billing_status;
    }

    if (planType) {
      if (!['plus', 'elite', 'none'].includes(String(planType).toLowerCase())) {
        return res.status(400).json({ error: 'planType inválido (use plus, elite ou none)' });
      }
      subscriptionPatch.planType = String(planType).toLowerCase();
    }

    if (waveId !== undefined) {
      const normalizedWave = String(waveId || '').trim();
      subscriptionPatch.waveId = normalizedWave || null;
    }

    const requestedDailyFeeCents = dailyFeeOverrideCents !== undefined
      ? dailyFeeOverrideCents
      : dailyFeeCents;
    if (requestedDailyFeeCents !== undefined) {
      const parsedDailyFee = Number.parseInt(requestedDailyFeeCents, 10);
      if (!Number.isFinite(parsedDailyFee) || parsedDailyFee < 0) {
        return res.status(400).json({ error: 'dailyFeeCents inválido' });
      }
      subscriptionPatch.dailyFeeOverrideCents = parsedDailyFee;
      subscriptionPatch.dailyFeeCents = parsedDailyFee;
    }

    if (isFeeExempt !== undefined) {
      const parsedExempt = isFeeExempt === true || String(isFeeExempt).toLowerCase() === 'true';
      subscriptionPatch.isFeeExempt = parsedExempt;
    }

    if (feeExemptUntil !== undefined) {
      if (feeExemptUntil === null || String(feeExemptUntil).trim() === '') {
        subscriptionPatch.feeExemptUntil = null;
      } else {
        const parsedDate = new Date(feeExemptUntil);
        if (Number.isNaN(parsedDate.getTime())) {
          return res.status(400).json({ error: 'feeExemptUntil inválido (use ISO8601)' });
        }
        subscriptionPatch.feeExemptUntil = parsedDate.toISOString();
      }
    }

    if (collectionMode !== undefined) {
      const normalizedMode = String(collectionMode || '').toLowerCase();
      if (!['withdrawal', 'balance'].includes(normalizedMode)) {
        return res.status(400).json({ error: 'collectionMode inválido (use withdrawal ou balance)' });
      }
      subscriptionPatch.collectionMode = normalizedMode;
    }

    if (notes !== undefined) {
      subscriptionPatch.adminNotes = String(notes || '').trim();
    }

    subscriptionPatch.updatedAt = nowIso;
    subscriptionPatch.updatedBy = adminId;

    if (Object.keys(subscriptionPatch).length === 2) {
      return res.status(400).json({ error: 'Nenhum campo válido para atualizar assinatura' });
    }

    const subscriptionWrite = await subscriptionStateService.runTransaction(driverId, (state) => ({
      ...state,
      ...subscriptionPatch
    }), { db });
    if (!subscriptionWrite.success) {
      throw new Error(subscriptionWrite.error || 'Falha ao atualizar assinatura');
    }

    logger.info(`✅ Status de assinatura do motorista ${driverId} atualizado`);

    res.json({
      success: true,
      message: 'Status de assinatura atualizado',
      driverId,
      status,
      billing_status,
      applied: {
        planType: planType || undefined,
        waveId: waveId !== undefined ? (String(waveId || '').trim() || null) : undefined,
        dailyFeeOverrideCents: requestedDailyFeeCents !== undefined ? Number.parseInt(requestedDailyFeeCents, 10) : undefined,
        isFeeExempt: isFeeExempt !== undefined
          ? (isFeeExempt === true || String(isFeeExempt).toLowerCase() === 'true')
          : undefined,
        feeExemptUntil: feeExemptUntil !== undefined
          ? (feeExemptUntil ? new Date(feeExemptUntil).toISOString() : null)
          : undefined,
        collectionMode: collectionMode !== undefined ? String(collectionMode).toLowerCase() : undefined
      }
    });

  } catch (error) {
    logger.error(`❌ Erro ao atualizar status de assinatura do motorista ${req.params.driverId}:`, error);
    res.status(500).json({
      error: 'Erro interno do servidor',
      message: error.message
    });
  }
});

/**
 * Estender período grátis do motorista
 * POST /api/drivers/:driverId/extend-free
 * Body: { type: 'trial' | 'months' | 'promotion', days: number, reason: string }
 */
router.post('/api/drivers/:driverId/extend-free', authenticateJWT, requireRole(DASHBOARD_FINANCIAL_ROLES), requireAdminMutationsEnabled, async (req, res) => {
  try {
    const { driverId } = req.params;
    const { type, days, reason } = req.body;

    if (!['trial', 'months', 'promotion'].includes(type)) {
      return res.status(400).json({ error: 'Tipo de período grátis inválido' });
    }

    if (!days || days <= 0) {
      return res.status(400).json({ error: 'Número de dias inválido' });
    }

    if (!firebaseConfig || !firebaseConfig.getRealtimeDB) {
      return res.status(500).json({ error: 'Firebase não disponível' });
    }

    const db = firebaseConfig.getRealtimeDB();

    const now = new Date();
    const newEndDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    let fieldName = '';
    if (type === 'trial') fieldName = 'free_trial_end';
    else if (type === 'months') fieldName = 'free_months_end';
    else if (type === 'promotion') fieldName = 'promotion_free_end';

    await db.ref(`users/${driverId}/${fieldName}`).set(newEndDate.toISOString());

    logger.info(`✅ Período grátis do motorista ${driverId} estendido: ${type} até ${newEndDate.toISOString()}`);

    res.json({
      success: true,
      message: `Período grátis estendido até ${newEndDate.toISOString().split('T')[0]}`,
      driverId,
      type,
      freeUntil: newEndDate.toISOString(),
      reason: reason || 'Extensão manual via dashboard'
    });

  } catch (error) {
    logger.error(`❌ Erro ao estender período grátis do motorista ${req.params.driverId}:`, error);
    res.status(500).json({
      error: 'Erro interno do servidor',
      message: error.message
    });
  }
});

/**
 * Revisao restrita de divergencia facial (CNH canonica x selfie rejeitada)
 */
router.post(
  '/api/drivers/:driverId/kyc/orphan-identity-hold/recovery',
  authenticateJWT,
  requireRole(DASHBOARD_KYC_REVIEW_ROLES),
  async (req, res) => {
    try {
      if (req.body?.explicitRecovery !== true) {
        const error = new Error('A recuperacao exige confirmacao administrativa explicita.');
        error.code = 'KYC_ORPHAN_HOLD_RECOVERY_EXPLICIT_CONFIRMATION_REQUIRED';
        throw error;
      }

      const driverId = String(req.params.driverId || '').trim();
      const kycRuntime = await resolveDashboardKycRuntime(req, driverId);
      requireDashboardKycScopedPolicy(kycRuntime);
      const failureEvidenceId = String(req.body?.failureEvidenceId || '').trim();
      const expectedStateRevision = Number(req.body?.expectedStateRevision);
      const expectedRevokedAt = String(req.body?.expectedRevokedAt || '').trim();
      const reason = normalizeKycReviewReason(req.body?.reason);
      const reviewerContext = getDashboardKycReviewer(req);
      const recovery = await kycRuntime.workflow.authorizeOrphanHoldRecovery({
        driverId,
        failureEvidenceId,
        expectedStateRevision,
        expectedRevokedAt,
        reviewerContext,
        reason
      });

      const challengeId = `idrev_or_${crypto
        .createHash('sha1')
        .update(recovery.recoveryId)
        .digest('hex')
        .slice(0, 18)}`;
      let retryChallenge;
      try {
        retryChallenge = await applyDashboardIdentityReverificationGate(kycRuntime, {
          driverId,
          reporterId: reviewerContext.uid,
          reporterType: 'admin',
          supportTicketId: null,
          challengeId,
          payload: {
            reasonCode: 'kyc_orphan_hold_retry_authorized',
            publicReason: 'Uma nova validacao de identidade foi autorizada pelo suporte.',
            selectedOptions: ['orphan_hold_recovery'],
            attemptScope: recovery.attemptScope
          },
          notify: true
        });
      } catch (setupError) {
        await kycRuntime.workflow.abortOrphanHoldRecoverySetup({
          driverId,
          recoveryId: recovery.recoveryId,
          reason: setupError?.code || 'identity_reverification_setup_failed'
        }).catch((compensationError) => {
          logError(compensationError, 'Falha ao compensar recuperacao KYC sem challenge', {
            service: 'dashboard-routes',
            driverId,
            recoveryId: recovery.recoveryId
          });
        });
        throw setupError;
      }

      await auditService.logEvent({
        ...dashboardKycAuditEnvelope(kycRuntime),
        userId: reviewerContext.uid,
        action: 'KYC_ORPHAN_IDENTITY_HOLD_RECOVERY_CHALLENGE_CREATED',
        resource: 'kyc_identity_retry_authorization',
        severity: 'WARNING',
        success: true,
        details: {
          driverId,
          recoveryId: recovery.recoveryId,
          challengeId,
          idempotentReplay: recovery.idempotentReplay === true
        }
      });

      res.set('Cache-Control', 'private, no-store, max-age=0');
      return res.status(recovery.idempotentReplay ? 200 : 201).json({
        success: true,
        persistenceScope: kycRuntime.scope.namespace,
        recovery: {
          recoveryId: recovery.recoveryId,
          status: recovery.authorization?.status || null,
          remainingAttempts: recovery.authorization?.remainingAttempts ?? null,
          expiresAt: recovery.authorization?.expiresAt || null,
          idempotentReplay: recovery.idempotentReplay === true
        },
        challenge: {
          challengeId: retryChallenge?.challengeId || challengeId,
          requirement: retryChallenge?.requirement || 'IDENTITY_REVERIFICATION',
          attemptScope: recovery.attemptScope
        }
      });
    } catch (error) {
      logError(error, 'Falha ao autorizar recuperacao de hold KYC orfao', {
        service: 'dashboard-routes',
        driverId: req.params.driverId
      });
      return respondKycReviewError(res, error);
    }
  }
);

router.post(
  '/api/drivers/:driverId/kyc/identity-reviews/reconcile',
  authenticateJWT,
  requireRole(DASHBOARD_KYC_REVIEW_ROLES),
  async (req, res) => {
    try {
      const { driverId } = req.params;
      const kycRuntime = await resolveDashboardKycRuntime(req, driverId);
      const ticketId = String(req.body?.ticketId || '').trim();
      const evidenceId = String(req.body?.evidenceId || '').trim();
      const reason = normalizeKycReviewReason(req.body?.reason);
      const reviewerContext = getDashboardKycReviewer(req);
      const result = await kycRuntime.workflow.openCaseFromTicket({
        driverId,
        evidenceId,
        ticketId,
        requestedBy: { uid: driverId, type: 'driver' },
        reconciledBy: reviewerContext
      });
      await supportTicketService.updateTicketMetadata(ticketId, {
        identityReviewLinkStatus: 'registered',
        identityReviewCaseId: result.case.caseId,
        identityReviewLinkUpdatedAt: new Date().toISOString(),
        identityReviewReconciledBy: reviewerContext.uid
      }, dashboardKycPersistenceContext(kycRuntime));
      await auditService.logEvent({
        ...dashboardKycAuditEnvelope(kycRuntime),
        userId: reviewerContext.uid,
        action: 'KYC_IDENTITY_REVIEW_TICKET_RECONCILED',
        resource: 'kyc_identity_review_case',
        severity: 'WARNING',
        success: true,
        details: {
          driverId,
          ticketId,
          evidenceId,
          caseId: result.case.caseId,
          reason
        }
      });
      return res.json({
        success: true,
        persistenceScope: kycRuntime.scope.namespace,
        case: result.case,
        idempotentReplay: result.idempotentReplay === true
      });
    } catch (error) {
      logError(error, 'Falha ao reconciliar ticket com caso KYC', {
        service: 'dashboard-routes',
        driverId: req.params.driverId,
        ticketId: req.body?.ticketId || null
      });
      return respondKycReviewError(res, error);
    }
  }
);

router.get(
  '/api/drivers/:driverId/kyc/identity-reviews',
  authenticateJWT,
  requireRole(DASHBOARD_KYC_REVIEW_ROLES),
  async (req, res) => {
    try {
      const driverId = req.params.driverId;
      const kycRuntime = await resolveDashboardKycRuntime(req, driverId);
      const reviewerContext = getDashboardKycReviewer(req);
      const [cases, orphanRecoveryCandidate, verificationStatus] = await Promise.all([
        kycRuntime.workflow.listCasesForDriver(driverId, { reviewerContext }),
        kycRuntime.workflow.getOrphanHoldRecoveryCandidate(
          driverId,
          { reviewerContext }
        ),
        kycRuntime.workflow.getDashboardIdentityStatus(
          driverId,
          { reviewerContext }
        )
      ]);
      res.set('Cache-Control', 'private, no-store, max-age=0');
      return res.json({
        success: true,
        persistenceScope: kycRuntime.scope.namespace,
        cases,
        orphanRecoveryCandidate,
        verificationStatus
      });
    } catch (error) {
      logError(error, 'Falha ao listar casos KYC de identidade', {
        service: 'dashboard-routes',
        driverId: req.params.driverId
      });
      return respondKycReviewError(res, error);
    }
  }
);

router.post(
  '/api/drivers/:driverId/kyc/identity-reviews/:caseId/evidence/:kind',
  authenticateJWT,
  requireRole(DASHBOARD_KYC_REVIEW_ROLES),
  async (req, res) => {
    try {
      const { driverId, caseId } = req.params;
      const kycRuntime = await resolveDashboardKycRuntime(req, driverId);
      const kind = String(req.params.kind || '').trim().toLowerCase();
      if (!['cnh', 'selfie'].includes(kind)) {
        const error = new Error('Tipo de evidencia invalido.');
        error.code = 'KYC_IDENTITY_REVIEW_EVIDENCE_KIND_INVALID';
        throw error;
      }
      const ticketId = String(req.body?.ticketId || '').trim();
      const reason = normalizeKycReviewReason(req.body?.reason);
      const evidenceBindingHash = String(req.body?.evidenceBindingHash || '').trim();
      const reviewerContext = getDashboardKycReviewer(req);
      const reviewCase = await kycRuntime.workflow.getCaseForDriver(
        driverId,
        caseId,
        { reviewerContext }
      );
      if (!evidenceBindingHash || evidenceBindingHash !== reviewCase.evidenceBindingHash) {
        const error = new Error('A evidencia selecionada foi alterada; recarregue o caso.');
        error.code = 'KYC_IDENTITY_REVIEW_EVIDENCE_BINDING_INVALID';
        throw error;
      }
      const context = await kycRuntime.workflow.getReviewContext({
        driverId,
        caseId,
        ticketId,
        reviewerContext,
        reason
      });

      let imageBuffer;
      let contentType = 'image/jpeg';
      if (kind === 'selfie') {
        const metadata = await kycRuntime.evidence.getMetadata(
          context.evidence.evidenceId
        );
        imageBuffer = await getDashboardKycStorageService().downloadStoragePath(
          metadata.objectPath,
          { generation: metadata.storageGeneration }
        );
        if (sha256Buffer(imageBuffer) !== metadata.referenceImageSha256) {
          const error = new Error('Integridade da selfie de evidencia divergiu.');
          error.code = 'KYC_IDENTITY_REVIEW_SELFIE_INTEGRITY_MISMATCH';
          throw error;
        }
        contentType = metadata.contentType || contentType;
      } else {
        const canonicalCnh = await canonicalDriverDocumentApprovalService.requireApprovedCnh(driverId);
        if (canonicalCnh.submissionId !== context.case.evidence.approvedCnhSubmissionId) {
          const error = new Error('A CNH aprovada atual diverge do caso analisado.');
          error.code = 'KYC_IDENTITY_REVIEW_CNH_BINDING_MISMATCH';
          throw error;
        }
        const documentBuffer = await getDashboardKycStorageService().downloadStoragePath(
          canonicalCnh.filePath,
          { generation: canonicalCnh.storageGeneration }
        );
        if (sha256Buffer(documentBuffer) !== canonicalCnh.documentSha256) {
          const error = new Error('Integridade da CNH canonica divergiu.');
          error.code = 'KYC_IDENTITY_REVIEW_CNH_INTEGRITY_MISMATCH';
          throw error;
        }
        const portrait = await getDashboardKycCnhFaceService().extractCnhPortraitImage(
          documentBuffer,
          { allowFullPageFallback: false }
        );
        imageBuffer = portrait.imageBuffer;
      }

      res.set({
        'Content-Type': contentType,
        'Cache-Control': 'private, no-store, max-age=0',
        Pragma: 'no-cache',
        'X-Content-Type-Options': 'nosniff',
        'Content-Disposition': 'inline; filename="kyc-review-evidence.jpg"',
        'X-Leaf-KYC-Scope': kycRuntime.scope.namespace
      });
      return res.status(200).send(imageBuffer);
    } catch (error) {
      logError(error, 'Falha ao abrir evidencia visual KYC', {
        service: 'dashboard-routes',
        driverId: req.params.driverId,
        caseId: req.params.caseId,
        kind: req.params.kind
      });
      return respondKycReviewError(res, error);
    }
  }
);

router.post(
  '/api/drivers/:driverId/kyc/identity-reviews/:caseId/start',
  authenticateJWT,
  requireRole(DASHBOARD_KYC_REVIEW_ROLES),
  async (req, res) => {
    try {
      const kycRuntime = await resolveDashboardKycRuntime(req, req.params.driverId);
      const reviewerContext = getDashboardKycReviewer(req);
      const reason = normalizeKycReviewReason(req.body?.reason);
      const service = kycRuntime.workflow.caseService(reviewerContext);
      const result = await service.startReview({
        caseId: req.params.caseId,
        ticketId: req.body?.ticketId,
        reviewer: { uid: reviewerContext.uid, email: reviewerContext.email },
        reason,
        evidenceBindingHash: req.body?.evidenceBindingHash
      });
      const reviewCase = await kycRuntime.workflow.getCaseForDriver(
        req.params.driverId,
        req.params.caseId,
        { reviewerContext }
      );
      return res.json({
        success: true,
        persistenceScope: kycRuntime.scope.namespace,
        case: reviewCase,
        idempotentReplay: result?.idempotentReplay === true
      });
    } catch (error) {
      logError(error, 'Falha ao iniciar revisao KYC', {
        service: 'dashboard-routes',
        driverId: req.params.driverId,
        caseId: req.params.caseId
      });
      return respondKycReviewError(res, error);
    }
  }
);

router.post(
  '/api/drivers/:driverId/kyc/identity-reviews/:caseId/decision',
  authenticateJWT,
  requireRole(DASHBOARD_KYC_REVIEW_ROLES),
  async (req, res) => {
    try {
      const { driverId, caseId } = req.params;
      const kycRuntime = await resolveDashboardKycRuntime(req, driverId);
      const reviewerContext = getDashboardKycReviewer(req);
      const reason = normalizeKycReviewReason(req.body?.reason);
      const decision = String(req.body?.decision || '').trim().toUpperCase();
      if (!['CONFIRMED_FRAUD', 'FALSE_POSITIVE'].includes(decision)) {
        const error = new Error('Decisao KYC invalida.');
        error.code = 'KYC_IDENTITY_REVIEW_DECISION_INVALID';
        throw error;
      }
      if (req.body?.explicitDecision !== true) {
        const error = new Error('A decisao exige confirmacao administrativa explicita.');
        error.code = 'KYC_IDENTITY_REVIEW_EXPLICIT_DECISION_REQUIRED';
        throw error;
      }
      if (
        decision === 'CONFIRMED_FRAUD' &&
        (
          req.body?.confirmPermanentBlock !== true ||
          req.body?.confirmationPhrase !== KYC_PERMANENT_BLOCK_CONFIRMATION
        )
      ) {
        const error = new Error('Confirme explicitamente o bloqueio permanente.');
        error.code = 'KYC_IDENTITY_REVIEW_PERMANENT_BLOCK_CONFIRMATION_REQUIRED';
        throw error;
      }

      if (decision === 'FALSE_POSITIVE') {
        requireDashboardKycScopedPolicy(kycRuntime);
      }

      const service = kycRuntime.workflow.caseService(reviewerContext);
      let decisionResult;
      let retryChallenge = null;
      await kycRuntime.workflow.runWithVerificationWindow(
        driverId,
        `dashboard_identity_decision_${caseId}`,
        async () => {
        decisionResult = await service.decideCase({
          caseId,
          ticketId: req.body?.ticketId,
          reviewer: { uid: reviewerContext.uid, email: reviewerContext.email },
          reason,
          evidenceBindingHash: req.body?.evidenceBindingHash,
          decision,
          explicitDecision: true,
          confirmPermanentBlock: decision === 'CONFIRMED_FRAUD'
        });

        if (decision === 'CONFIRMED_FRAUD') {
          if (kycRuntime.scope.namespace === 'operational') {
            await applyConfirmedIdentityFraudBlock({
              driverId,
              enforcement: decisionResult.enforcement,
              reviewer: reviewerContext,
              reason: `Fraude de identidade confirmada no caso ${caseId}: ${reason}`
            });
          }
        } else {
          const attemptScope = `manual_review_retry_${caseId}`.toLowerCase();
          retryChallenge = await applyDashboardIdentityReverificationGate(kycRuntime, {
            driverId,
            reporterId: reviewerContext.uid,
            reporterType: 'admin',
            supportTicketId: req.body?.ticketId,
            challengeId: `idrev_review_${crypto.createHash('sha1').update(caseId).digest('hex').slice(0, 18)}`,
            payload: {
              reasonCode: 'kyc_identity_false_positive_retry_authorized',
              publicReason: 'Uma nova validacao de identidade foi autorizada pelo suporte.',
              selectedOptions: ['false_positive_review'],
              attemptScope
            },
            notify: true
          });
        }
        }
      );

      const evidenceId = decisionResult?.case?.evidenceBinding?.evidenceId;
      if (evidenceId) {
        await kycRuntime.evidence.recordReviewOutcome(evidenceId, {
          outcome: decision === 'CONFIRMED_FRAUD' ? 'fraud_confirmed' : 'no_fraud_confirmed',
          actorId: reviewerContext.uid,
          ticketId: req.body?.ticketId,
          caseId,
          reason
        }).catch((evidenceError) => {
          logError(evidenceError, 'Falha ao espelhar decisao na evidencia KYC', {
            service: 'dashboard-routes',
            driverId,
            caseId,
            evidenceId
          });
        });
      }

      const reviewCase = await kycRuntime.workflow.getCaseForDriver(
        driverId,
        caseId,
        { reviewerContext }
      );
      return res.json({
        success: true,
        persistenceScope: kycRuntime.scope.namespace,
        case: reviewCase,
        permanentBlockApplied: decision === 'CONFIRMED_FRAUD',
        operationalMirrorApplied:
          decision === 'CONFIRMED_FRAUD' &&
          kycRuntime.scope.namespace === 'operational',
        retryAuthorization: decisionResult?.retryAuthorization || null,
        retryChallenge
      });
    } catch (error) {
      logError(error, 'Falha ao decidir revisao KYC', {
        service: 'dashboard-routes',
        driverId: req.params.driverId,
        caseId: req.params.caseId
      });
      return respondKycReviewError(res, error);
    }
  }
);

/**
 * Aprovar motorista
 * POST /api/drivers/:driverId/approve
 */
router.post('/api/drivers/:driverId/approve', authenticateJWT, requireRole(DASHBOARD_OPERATION_MUTATION_ROLES), async (req, res) => {
  try {
    const { driverId } = req.params;
    const approvalReason = String(
      req.body?.reason ||
        req.body?.approvalReason ||
        req.body?.reviewReason ||
        req.body?.notes ||
        ''
    ).trim();
    const approvalEvidence = normalizeManualApprovalEvidence(
      req.body?.evidence ||
        req.body?.evidenceRefs ||
        req.body?.documents ||
        req.body?.documentRefs
    );

    if (!approvalReason || approvalEvidence.length === 0) {
      return res.status(400).json({
        success: false,
        code: 'QUICK_APPROVAL_AUDIT_REQUIRED',
        error: 'Aprovação rápida exige reason e evidence para auditoria.'
      });
    }

    await assertDriverIdentityNotPermanentlyBlocked(driverId);

    if (!firebaseConfig || !firebaseConfig.getRealtimeDB) {
      return res.status(500).json({ error: 'Firebase não disponível' });
    }

    const db = firebaseConfig.getRealtimeDB();
    const nowIso = new Date().toISOString();
	    const userSnapshot = await db.ref(`users/${driverId}`).once('value');
	    const currentUser = userSnapshot.val() || {};
	    let activationStatus = null;
	    try {
	      activationStatus = await recomputeDriverActivationStatus(driverId);
	    } catch (recomputeError) {
	      logStructured('warn', 'Falha ao recomputar ativação antes da revisão rápida', {
	        service: 'dashboard-routes',
	        driverId,
	        error: recomputeError?.message || String(recomputeError)
	      });
	    }
	    const canApproveFromCanonicalEvidence = activationStatus?.canGoOnline === true;
	    const manualApprovalAudit = {
	      action: 'driver.quick_manual_approval',
	      driverId,
      actorId: req.user.id,
      actorRole: req.user.role || 'admin',
      reason: approvalReason,
      provenance: 'dashboard_quick_driver_approval',
      evidence: approvalEvidence,
	      previousState: {
	        approved: currentUser.approved ?? currentUser.isApproved ?? null,
	        status: currentUser.status || null,
	        kycStatus: currentUser.kycStatus || currentUser.kyc_status || null
	      },
	      nextState: {
	        approved: canApproveFromCanonicalEvidence ? true : currentUser.approved ?? null,
	        status: canApproveFromCanonicalEvidence ? 'approved' : currentUser.status || null,
	        kycStatus: currentUser.kycStatus || currentUser.kyc_status || null,
	        manualReviewStatus: canApproveFromCanonicalEvidence
	          ? 'canonical_evidence_confirmed'
	          : 'pending_canonical_evidence'
	      },
	      activationStatus: activationStatus || null,
	      createdAt: nowIso
	    };

	    const approvalUpdate = {
	      manualApprovalAudit,
	      approvalAuditTrail: manualApprovalAudit,
	      approvalAuditUpdatedAt: nowIso,
	      manualReviewStatus: manualApprovalAudit.nextState.manualReviewStatus,
	      manualReviewedAt: nowIso,
	      manualReviewedBy: req.user.id,
	      manualReviewedByEmail: req.user.email || null,
	      updatedAt: nowIso
	    };
	    if (canApproveFromCanonicalEvidence) {
	      approvalUpdate.approved = true;
	      approvalUpdate.approvedAt = nowIso;
	      approvalUpdate.approvedBy = req.user.id;
	      approvalUpdate.approvedByEmail = req.user.email || null;
	      approvalUpdate.status = 'approved';
	    }

	    await db.ref(`users/${driverId}`).update(approvalUpdate);

    await auditService.logEvent({
      userId: req.user?.id || req.user?.userId || req.user?.email || 'dashboard',
      action: 'driver.quick_manual_approval',
      resource: 'driver',
	      severity: 'WARNING',
	      details: {
	        driverId,
	        reason: approvalReason,
	        evidence: approvalEvidence,
	        previousState: manualApprovalAudit.previousState,
	        nextState: manualApprovalAudit.nextState,
	        activationStatus,
	        canonicalEvidenceConfirmed: canApproveFromCanonicalEvidence,
	        actorEmail: req.user?.email || null,
	        actorRole: req.user?.role || null
	      },
	      ip: req.ip,
	      userAgent: req.headers['user-agent'] || 'unknown',
	      success: canApproveFromCanonicalEvidence
	    });

	    if (!canApproveFromCanonicalEvidence) {
	      return res.status(409).json({
	        success: false,
	        code: 'CANONICAL_DRIVER_EVIDENCE_REQUIRED',
	        error: 'Aprovação rápida não substitui CNH, CRLV/veículo ativo, KYC, liveness e consentimentos canônicos.',
	        driverId,
	        activationStatus
	      });
	    }

	    if (activationStatus?.canGoOnline === true) {
	      emitDriverActivationUnlockedEvent(req, driverId, activationStatus);
    }

    // Verificar e aplicar promoções elegíveis
    const promotionService = require('../../services/promotion-service');
    await promotionService.checkAndApplyEligiblePromotions(driverId);

    logger.info(`✅ Motorista ${driverId} aprovado`);

    res.json({
      success: true,
      message: 'Motorista aprovado com sucesso',
      driverId
    });

  } catch (error) {
    logger.error(`❌ Erro ao aprovar motorista ${req.params.driverId}:`, error);
    res.status(error instanceof DashboardUserManagementError ? error.statusCode || 400 : 500).json({
      success: false,
      code: error instanceof DashboardUserManagementError ? error.code : undefined,
      error: error instanceof DashboardUserManagementError ? error.message : 'Erro interno do servidor'
    });
  }
});

/**
 * Suspender motorista
 * POST /api/drivers/:driverId/suspend
 * Body: { reason: string, duration?: number }
 */
router.post('/api/drivers/:driverId/suspend', authenticateJWT, requireRole(DASHBOARD_OPERATION_MUTATION_ROLES), async (req, res) => {
  try {
    const { driverId } = req.params;
    const { reason, duration } = req.body;
    const result = await updateUserOperationalStatus(
      driverId,
      {
        status: 'suspended',
        reason,
        durationDays: duration
      },
      {
        operator: {
          id: req.user?.id || req.user?.userId || null,
          email: req.user?.email || null,
          role: req.user?.role || null
        }
      }
    );

    logger.info(`✅ Motorista ${driverId} suspenso: ${reason}`);

    return res.json({
      ...result,
      message: 'Motorista suspenso com sucesso',
      driverId: result.userId || driverId
    });

  } catch (error) {
    logger.error(`❌ Erro ao suspender motorista ${req.params.driverId}:`, error);
    return res.status(error instanceof DashboardUserManagementError ? error.statusCode || 400 : 500).json({
      success: false,
      code: error instanceof DashboardUserManagementError ? error.code : undefined,
      error: error instanceof DashboardUserManagementError ? error.message : 'Erro interno do servidor'
    });
  }
});

/**
 * Reativar motorista suspenso
 * POST /api/drivers/:driverId/unsuspend
 */
router.post('/api/drivers/:driverId/unsuspend', authenticateJWT, requireRole(DASHBOARD_OPERATION_MUTATION_ROLES), async (req, res) => {
  try {
    const { driverId } = req.params;
    const result = await updateUserOperationalStatus(
      driverId,
      {
        status: 'active',
        reason: req.body?.reason
      },
      {
        operator: {
          id: req.user?.id || req.user?.userId || null,
          email: req.user?.email || null,
          role: req.user?.role || null
        }
      }
    );

    logger.info(`✅ Motorista ${driverId} reativado`);

    return res.json({
      ...result,
      message: 'Motorista reativado com sucesso',
      driverId: result.userId || driverId
    });

  } catch (error) {
    logger.error(`❌ Erro ao reativar motorista ${req.params.driverId}:`, error);
    return res.status(error instanceof DashboardUserManagementError ? error.statusCode || 400 : 500).json({
      success: false,
      code: error instanceof DashboardUserManagementError ? error.code : undefined,
      error: error instanceof DashboardUserManagementError ? error.message : 'Erro interno do servidor'
    });
  }
});
