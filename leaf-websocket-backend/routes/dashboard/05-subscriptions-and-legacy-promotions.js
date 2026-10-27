// Gerado a partir de routes/dashboard.js (divisão mecânica, mesma ordem de registro).
// Assinaturas de motoristas e promoções legadas

const {
  DASHBOARD_FINANCIAL_ROLES,
  authenticateJWT,
  calculateGrowthRate,
  calculatePaymentFrequency,
  calculatePromoRetentionRate,
  driverSubscriptionService,
  firebaseConfig,
  getDailyUsageBreakdown,
  getPeakUsageDays,
  getWeekStart,
  legacyPromotionsRoutesEnabled,
  logError,
  logStructured,
  requireAdminMutationsEnabled,
  requireRole,
  router,
  subscriptionStateService,
  getDocumentFirestore,
  userStore
} = require('./shared');

// 💳 Subscription Management - MODELO DIÁRIO (cobrança no saque)
router.get('/api/subscriptions/drivers', authenticateJWT, requireRole(DASHBOARD_FINANCIAL_ROLES), async (req, res) => {
  try {
    const {
      status, // 'active', 'pending', 'blocked', ...
      paymentStatus, // 'paid', 'overdue', 'blocked'
      page = 1,
      limit = 20
    } = req.query;

    try {
      const data = await driverSubscriptionService.listDriverSubscriptions({
        status,
        paymentStatus,
        page,
        limit
      });
      return res.json(data);
    } catch (modernError) {
      logStructured('warn', 'Fallback de varredura em /api/subscriptions/drivers', {
        service: 'dashboard-routes',
        reason: modernError.message
      });
    }

    if (!firebaseConfig || !firebaseConfig.getFirestore) {
      return res.status(503).json({ error: 'Firebase não disponível' });
    }

    const firestore = firebaseConfig.getFirestore();
    const [users, subscriptionsData] = await Promise.all([
      userStore.queryUsers(firestore, 'usertype', 'driver'),
      subscriptionStateService.listSubscriptions({ firestore })
    ]);

    const now = new Date();

    const plusDefaultDailyCents = Number.parseInt(process.env.SUBSCRIPTION_PLUS_DAILY_CENTS || '1490', 10);
    const eliteDefaultDailyCents = Number.parseInt(process.env.SUBSCRIPTION_ELITE_DAILY_CENTS || '0', 10);
    const dailyBillingEnabled = String(process.env.SUBSCRIPTION_DAILY_BILLING_ENABLED || 'false').toLowerCase() === 'true';

    let rows = Object.keys(users).map((driverId) => {
      const driver = users[driverId] || {};
      const subscription = subscriptionsData[driverId] || {};

      const planType = String(subscription.planType || driver.planType || 'plus').toLowerCase() === 'elite'
        ? 'elite'
        : 'plus';
      const fallbackDailyCents = planType === 'elite' ? eliteDefaultDailyCents : plusDefaultDailyCents;
      const dailyFeeCents = Math.max(
        0,
        Number(subscription.dailyFeeCents ?? subscription.dailyFeeOverrideCents ?? fallbackDailyCents) || 0
      );
      const weeklyFeeCents = Math.max(
        0,
        Number(subscription.weeklyFeeCents || dailyFeeCents * 7) || 0
      );
      const pendingFeeCents = Math.max(
        0,
        Number(subscription.pendingFeeCents || driver.subscription_pending_fee_cents || 0) || 0
      );

      const subscriptionStatus = String(
        subscription.status ||
        driver.subscriptionStatus ||
        (driver.approved ? 'active' : 'pending')
      ).toLowerCase();

      const billingStatus = String(
        subscription.billingStatus ||
        driver.billing_status ||
        (pendingFeeCents > 0 ? 'overdue' : 'active')
      ).toLowerCase();

      const hardBlocked = ['blocked', 'cancelled', 'suspended'].includes(subscriptionStatus) || billingStatus === 'suspended';
      const isOverdue = pendingFeeCents > 0 && !hardBlocked;
      const currentPaymentStatus = hardBlocked ? 'blocked' : (isOverdue ? 'overdue' : 'paid');

      const freeTrialEnd = driver.free_trial_end ? new Date(driver.free_trial_end) : null;
      const freeMonthsEnd = driver.free_months_end ? new Date(driver.free_months_end) : null;
      const promotionFreeEnd = driver.promotion_free_end ? new Date(driver.promotion_free_end) : null;
      const feeExemptUntil = subscription.feeExemptUntil ? new Date(subscription.feeExemptUntil) : null;
      const freeEnds = [freeTrialEnd, freeMonthsEnd, promotionFreeEnd, feeExemptUntil].filter(
        (date) => date && !Number.isNaN(date.getTime()) && date > now
      );
      const latestFreeEnd = freeEnds.length > 0
        ? new Date(Math.max(...freeEnds.map((date) => date.getTime())))
        : null;
      const isFree = subscription.isFeeExempt === true || latestFreeEnd !== null || !dailyBillingEnabled;

      const appliedDailyFeeCents = isFree ? 0 : dailyFeeCents;

      return {
        driverId,
        driver: {
          id: driverId,
          name: `${driver.firstName || ''} ${driver.lastName || ''}`.trim(),
          email: driver.email || '',
          phone: driver.mobile || '',
          approved: driver.approved || false,
          joinDate: driver.createdAt ? new Date(driver.createdAt).toISOString() : null
        },
        subscription: {
          planType,
          status: subscriptionStatus,
          billingStatus,
          waveId: subscription.waveId || driver.subscription_wave_id || null,
          collectionMode: String(subscription.collectionMode || driver.subscription_collection_mode || 'withdrawal').toLowerCase(),
          dailyFeeCents: appliedDailyFeeCents,
          dailyFee: Number((appliedDailyFeeCents / 100).toFixed(2)),
          nominalDailyFeeCents: dailyFeeCents,
          nominalDailyFee: Number((dailyFeeCents / 100).toFixed(2)),
          dailyBillingEnabled,
          dailyBillingSuspended: !dailyBillingEnabled,
          weeklyFeeCents,
          weeklyFee: Number((weeklyFeeCents / 100).toFixed(2)),
          pendingFeeCents,
          pendingFee: Number((pendingFeeCents / 100).toFixed(2)),
          isFree,
          freeUntil: latestFreeEnd ? latestFreeEnd.toISOString() : null
        },
        currentPeriod: {
          paymentStatus: currentPaymentStatus,
          amount: Number((appliedDailyFeeCents / 100).toFixed(2)),
          amountCents: appliedDailyFeeCents,
          dueDate: null,
          daysOverdue: 0
        },
        financials: {
          totalPaid: '0.00',
          totalDue: Number((pendingFeeCents / 100).toFixed(2)).toFixed(2),
          outstandingBalance: Number((pendingFeeCents / 100).toFixed(2)).toFixed(2),
          paymentsCount: 0
        },
        lastPayment: null
      };
    });

    if (status && status !== 'all') {
      rows = rows.filter((row) => row.subscription.status === String(status).toLowerCase());
    }

    if (paymentStatus && paymentStatus !== 'all') {
      rows = rows.filter((row) => row.currentPeriod.paymentStatus === String(paymentStatus).toLowerCase());
    }

    rows.sort((a, b) => {
      const order = { blocked: 0, overdue: 1, pending: 2, paid: 3 };
      return (order[a.currentPeriod.paymentStatus] ?? 99) - (order[b.currentPeriod.paymentStatus] ?? 99);
    });

    const totalCount = rows.length;
    const safePage = Math.max(1, Number.parseInt(page, 10) || 1);
    const safeLimit = Math.max(1, Math.min(Number.parseInt(limit, 10) || 20, 500));
    const startIndex = (safePage - 1) * safeLimit;
    const endIndex = startIndex + safeLimit;
    const paginated = rows.slice(startIndex, endIndex);

    return res.json({
      subscriptions: paginated,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total: totalCount,
        pages: Math.ceil(totalCount / safeLimit)
      },
      summary: {
        total: totalCount,
        active: rows.filter((row) => row.subscription.status === 'active').length,
        pending: rows.filter((row) => row.subscription.status === 'pending').length,
        overdue: rows.filter((row) => row.currentPeriod.paymentStatus === 'overdue').length,
        totalRevenue: rows.reduce((sum, row) => sum + parseFloat(row.financials.totalPaid || 0), 0).toFixed(2),
        outstandingAmount: rows.reduce((sum, row) => sum + parseFloat(row.financials.outstandingBalance || 0), 0).toFixed(2)
      }
    });
  } catch (error) {
    logError(error, 'Erro ao buscar assinaturas:', { service: 'dashboard-routes' });
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 💳 Update Subscription Settings
router.patch('/api/subscriptions/:driverId', authenticateJWT, requireRole(DASHBOARD_FINANCIAL_ROLES), requireAdminMutationsEnabled, async (req, res) => {
  try {
    const { driverId } = req.params;
    const { weeklyFee, status, notes, adminId = 'admin1' } = req.body;

    try {
      if (firebaseConfig && firebaseConfig.getFirestore) {
        // Verificar se o motorista existe
        const driver = await userStore.readUser(getDocumentFirestore(), driverId);
        if (!driver) {
          return res.status(404).json({ error: 'Motorista não encontrado' });
        }

        if (driver.usertype !== 'driver') {
          return res.status(400).json({ error: 'Usuário não é um motorista' });
        }

        // Preparar atualizações
        const updates = {
          updatedAt: new Date().toISOString(),
          updatedBy: adminId
        };

        if (weeklyFee !== undefined) updates.weeklyFee = parseFloat(weeklyFee);
        if (status) updates.status = status;
        if (notes) updates.adminNotes = notes;

        const subscriptionWrite = await subscriptionStateService.runTransaction(driverId, (state) => ({
          ...state,
          driverId,
          weeklyFee: weeklyFee !== undefined ? parseFloat(weeklyFee || 0) : state.weeklyFee,
          startDate: state.startDate || driver.createdAt || new Date().toISOString(),
          status: status || state.status || 'active',
          adminNotes: notes !== undefined ? notes : state.adminNotes,
          createdBy: state.createdBy || adminId,
          createdAt: state.createdAt || new Date().toISOString(),
          ...updates
        }));
        if (!subscriptionWrite.success) {
          throw new Error(subscriptionWrite.error || 'Falha ao atualizar assinatura');
        }

        logStructured('info', `💳 Assinatura atualizada: ${driverId} por ${adminId}`, { service: 'dashboard-routes' });

        res.json({
          success: true,
          message: 'Assinatura atualizada com sucesso',
          data: {
            driverId,
            updatedAt: updates.updatedAt
          }
        });
      } else {
        res.status(503).json({ error: 'Firebase não disponível' });
      }
    } catch (firebaseError) {
      logStructured('error', 'Erro ao atualizar assinatura no Firebase:', firebaseError, { service: 'dashboard-routes' });
      res.status(500).json({ error: 'Erro ao salvar atualização' });
    }
  } catch (error) {
    logError(error, 'Erro ao atualizar assinatura:', { service: 'dashboard-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

if (legacyPromotionsRoutesEnabled) {
}
