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
  subscriptionStateService
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
      logStructured('warn', 'Fallback RTDB em /api/subscriptions/drivers', {
        service: 'dashboard-routes',
        reason: modernError.message
      });
    }

    if (!firebaseConfig || !firebaseConfig.getRealtimeDB) {
      return res.status(503).json({ error: 'Firebase não disponível' });
    }

    const db = firebaseConfig.getRealtimeDB();
    const [usersSnapshot, subscriptionsSnapshot] = await Promise.all([
      db.ref('users').orderByChild('usertype').equalTo('driver').once('value'),
      db.ref('subscriptions').once('value')
    ]);

    const users = usersSnapshot.val() || {};
    const subscriptionsData = subscriptionsSnapshot.val() || {};
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

// 💳 Process Subscription Payment
router.post('/api/subscriptions/payments', authenticateJWT, requireRole(DASHBOARD_FINANCIAL_ROLES), requireAdminMutationsEnabled, async (req, res) => {
  try {
    const { driverId, amount, paymentMethod, weekStart, adminId = 'admin1' } = req.body;

    if (!driverId || !amount) {
      return res.status(400).json({ error: 'Driver ID e amount são obrigatórios' });
    }

    try {
      if (firebaseConfig && firebaseConfig.getRealtimeDB) {
        const db = firebaseConfig.getRealtimeDB();

        // Verificar se o motorista existe
        const driverSnapshot = await db.ref(`users/${driverId}`).once('value');
        if (!driverSnapshot.exists()) {
          return res.status(404).json({ error: 'Motorista não encontrado' });
        }

        const driver = driverSnapshot.val();
        if (driver.usertype !== 'driver') {
          return res.status(400).json({ error: 'Usuário não é um motorista' });
        }

        // Criar registro de pagamento
        const paymentId = Date.now().toString();
        const weekStartDate = weekStart ? new Date(weekStart) : getWeekStart(new Date());

        const payment = {
          paymentId,
          driverId,
          type: 'subscription',
          amount: parseFloat(amount),
          paymentMethod: paymentMethod || 'manual',
          weekStart: weekStartDate.toISOString(),
          weekEnd: new Date(weekStartDate.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          status: 'paid',
          processedBy: adminId,
          timestamp: new Date().toISOString(),
          driverName: `${driver.firstName || ''} ${driver.lastName || ''}`.trim()
        };

        // Salvar pagamento
        await db.ref(`payments/${paymentId}`).set(payment);

        const subscriptionWrite = await subscriptionStateService.runTransaction(driverId, (state) => ({
          ...state,
          driverId,
          weeklyFee: parseFloat(amount),
          startDate: state.startDate || driver.createdAt || new Date().toISOString(),
          status: 'active',
          billingStatus: 'active',
          lastPayment: payment.timestamp,
          updatedBy: adminId,
          updatedAt: payment.timestamp
        }), { db });
        if (!subscriptionWrite.success) {
          throw new Error(subscriptionWrite.error || 'Falha ao atualizar assinatura após pagamento');
        }

        logStructured('info', `💳 Pagamento de assinatura processado: ${driverId} - R$ ${amount}`, { service: 'dashboard-routes' });

        res.json({
          success: true,
          message: 'Pagamento processado com sucesso',
          data: {
            paymentId,
            driverId,
            amount: parseFloat(amount),
            weekStart: weekStartDate.toISOString(),
            processedAt: payment.timestamp
          }
        });
      } else {
        res.status(503).json({ error: 'Firebase não disponível' });
      }
    } catch (firebaseError) {
      logStructured('error', 'Erro ao processar pagamento no Firebase:', firebaseError, { service: 'dashboard-routes' });
      res.status(500).json({ error: 'Erro ao salvar pagamento' });
    }
  } catch (error) {
    logError(error, 'Erro ao processar pagamento:', { service: 'dashboard-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 💳 Update Subscription Settings
router.patch('/api/subscriptions/:driverId', authenticateJWT, requireRole(DASHBOARD_FINANCIAL_ROLES), requireAdminMutationsEnabled, async (req, res) => {
  try {
    const { driverId } = req.params;
    const { weeklyFee, status, notes, adminId = 'admin1' } = req.body;

    try {
      if (firebaseConfig && firebaseConfig.getRealtimeDB) {
        const db = firebaseConfig.getRealtimeDB();

        // Verificar se o motorista existe
        const driverSnapshot = await db.ref(`users/${driverId}`).once('value');
        if (!driverSnapshot.exists()) {
          return res.status(404).json({ error: 'Motorista não encontrado' });
        }

        const driver = driverSnapshot.val();
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
        }), { db });
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

// 💳 Subscription Analytics
router.get('/api/subscriptions/analytics', async (req, res) => {
  try {
    const { period = '30d' } = req.query;

    let analytics = {
      revenue: {},
      subscribers: {},
      trends: {}
    };

    try {
      if (firebaseConfig && firebaseConfig.getRealtimeDB) {
        const db = firebaseConfig.getRealtimeDB();

        // Calcular período
        const now = new Date();
        let startDate = new Date();

        switch (period) {
          case '7d':
            startDate.setDate(now.getDate() - 7);
            break;
          case '30d':
            startDate.setDate(now.getDate() - 30);
            break;
          case '90d':
            startDate.setDate(now.getDate() - 90);
            break;
        }

        // Buscar pagamentos do período
        const paymentsSnapshot = await db.ref('payments').once('value');
        const payments = paymentsSnapshot.val() || {};

        const subscriptionPayments = Object.values(payments).filter(payment =>
          payment.type === 'subscription' &&
          new Date(payment.timestamp) >= startDate &&
          payment.status === 'paid'
        );

        // Análise de receita
        const totalRevenue = subscriptionPayments.reduce((sum, payment) =>
          sum + parseFloat(payment.amount || 0), 0
        );

        const weeklyBreakdown = {};
        subscriptionPayments.forEach(payment => {
          const weekStart = getWeekStart(new Date(payment.weekStart)).toISOString().split('T')[0];
          if (!weeklyBreakdown[weekStart]) {
            weeklyBreakdown[weekStart] = { amount: 0, count: 0 };
          }
          weeklyBreakdown[weekStart].amount += parseFloat(payment.amount || 0);
          weeklyBreakdown[weekStart].count += 1;
        });

        // Buscar motoristas ativos
        const usersSnapshot = await db.ref('users').orderByChild('usertype').equalTo('driver').once('value');
        const drivers = usersSnapshot.val() || {};

        const activeDrivers = Object.values(drivers).filter(driver => driver.approved === true);
        const totalDrivers = Object.values(drivers).length;

        analytics = {
          revenue: {
            total: totalRevenue.toFixed(2),
            average: subscriptionPayments.length > 0 ?
              (totalRevenue / subscriptionPayments.length).toFixed(2) : '0.00',
            weeklyBreakdown: Object.keys(weeklyBreakdown).sort().map(week => ({
              week,
              amount: weeklyBreakdown[week].amount.toFixed(2),
              subscribers: weeklyBreakdown[week].count
            }))
          },
          subscribers: {
            total: totalDrivers,
            active: activeDrivers.length,
            paying: subscriptionPayments.length,
            conversionRate: totalDrivers > 0 ?
              ((subscriptionPayments.length / totalDrivers) * 100).toFixed(2) + '%' : '0%'
          },
          trends: {
            period,
            growthRate: calculateGrowthRate(weeklyBreakdown),
            averageRevenuePerUser: activeDrivers.length > 0 ?
              (totalRevenue / activeDrivers.length).toFixed(2) : '0.00',
            paymentFrequency: calculatePaymentFrequency(subscriptionPayments)
          }
        };
      }
    } catch (error) {
      logStructured('warn', '⚠️ Erro ao gerar analytics de assinaturas:', error.message, { service: 'dashboard-routes' });
    }

    res.json({
      period,
      generatedAt: new Date().toISOString(),
      analytics
    });
  } catch (error) {
    logError(error, 'Erro ao gerar analytics de assinaturas:', { service: 'dashboard-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

if (legacyPromotionsRoutesEnabled) {
// 🎁 Promotion Management - SISTEMA DE PROMOÇÕES POR PERFIL
router.get('/api/legacy/promotions', async (req, res) => {
  if (!legacyPromotionsRoutesEnabled) {
    return res.status(410).json({
      error: 'Rotas legadas de promoções desativadas',
      code: 'LEGACY_PROMOTIONS_DISABLED'
    });
  }

  try {
    const {
      status, // 'active', 'expired', 'scheduled', 'paused'
      target, // 'drivers', 'customers', 'all'
      type, // 'percentage', 'fixed', 'free_rides', 'subscription_discount'
      page = 1,
      limit = 20
    } = req.query;

    let promotions = [];
    let totalCount = 0;

    try {
      if (firebaseConfig && firebaseConfig.getRealtimeDB) {
        const db = firebaseConfig.getRealtimeDB();

        // Buscar promoções
        const promosSnapshot = await db.ref('promos').once('value');
        const promosData = promosSnapshot.val() || {};

        // Buscar usos das promoções
        const promoUsageSnapshot = await db.ref('promoUsage').once('value');
        const promoUsage = promoUsageSnapshot.val() || {};

        const now = new Date();

        promotions = Object.keys(promosData).map(promoId => {
          const promo = promosData[promoId];

          // Determinar status baseado nas datas
          let currentStatus = 'active';
          const startDate = new Date(promo.startDate || promo.createdAt);
          const endDate = new Date(promo.endDate);

          if (now < startDate) {
            currentStatus = 'scheduled';
          } else if (now > endDate) {
            currentStatus = 'expired';
          } else if (promo.status === 'paused' || promo.active === false) {
            currentStatus = 'paused';
          }

          // Calcular usos da promoção
          const usages = Object.values(promoUsage).filter(usage =>
            usage.promoId === promoId || usage.promoCode === promo.promoCode
          );

          const totalUses = usages.length;
          const uniqueUsers = new Set(usages.map(u => u.userId)).size;
          const totalSavings = usages.reduce((sum, usage) =>
            sum + parseFloat(usage.discountAmount || 0), 0
          );

          // Analisar target de usuários
          let targetAudience = promo.target || 'all';
          if (promo.userType) {
            targetAudience = promo.userType === 'driver' ? 'drivers' : 'customers';
          }

          const promotion = {
            id: promoId,
            name: promo.promoName || promo.title || 'Promoção sem nome',
            code: promo.promoCode || promo.code,
            description: promo.description || '',
            type: promo.type || (promo.percentage ? 'percentage' : 'fixed'),
            target: targetAudience,
            status: currentStatus,
            details: {
              discountType: promo.type || 'percentage',
              discountValue: parseFloat(promo.discount || promo.percentage || promo.value || 0),
              minimumAmount: parseFloat(promo.minAmount || 0),
              maximumDiscount: parseFloat(promo.maxDiscount || 0),
              freeRides: parseInt(promo.freeRides || 0),
              subscriptionMonths: parseInt(promo.subscriptionMonths || 0)
            },
            dates: {
              startDate: promo.startDate || promo.createdAt,
              endDate: promo.endDate,
              createdAt: promo.createdAt || new Date().toISOString()
            },
            limits: {
              maxUses: parseInt(promo.maxUses || promo.usageLimit || 0),
              maxUsesPerUser: parseInt(promo.maxUsesPerUser || promo.userLimit || 1),
              currentUses: totalUses,
              remainingUses: Math.max(0, (parseInt(promo.maxUses || 0) - totalUses))
            },
            targeting: {
              cities: promo.cities ? promo.cities.split(',').map(c => c.trim()) : [],
              newUsersOnly: promo.newUsersOnly || false,
              firstRideOnly: promo.firstRideOnly || false,
              specificUsers: promo.specificUsers || [],
              minTripCount: parseInt(promo.minTripCount || 0)
            },
            analytics: {
              totalUses,
              uniqueUsers,
              totalSavings: totalSavings.toFixed(2),
              conversionRate: promo.maxUses > 0 ?
                ((totalUses / promo.maxUses) * 100).toFixed(2) + '%' : '0%',
              avgSavingsPerUse: totalUses > 0 ?
                (totalSavings / totalUses).toFixed(2) : '0.00'
            },
            creator: {
              createdBy: promo.createdBy || 'admin',
              lastModified: promo.lastModified || promo.createdAt,
              modifiedBy: promo.modifiedBy || promo.createdBy
            }
          };

          return promotion;
        });

        // Aplicar filtros
        if (status && status !== 'all') {
          promotions = promotions.filter(promo => promo.status === status);
        }

        if (target && target !== 'all') {
          promotions = promotions.filter(promo => promo.target === target);
        }

        if (type && type !== 'all') {
          promotions = promotions.filter(promo => promo.type === type);
        }

        // Ordenar por data de criação (mais recentes primeiro)
        promotions.sort((a, b) => new Date(b.dates.createdAt) - new Date(a.dates.createdAt));

        totalCount = promotions.length;

        // Aplicar paginação
        const startIndex = (parseInt(page) - 1) * parseInt(limit);
        const endIndex = startIndex + parseInt(limit);
        promotions = promotions.slice(startIndex, endIndex);
      }
    } catch (error) {
      logStructured('warn', '⚠️ Erro ao buscar promoções do Firebase:', error.message, { service: 'dashboard-routes' });
    }

    res.json({
      promotions,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount,
        pages: Math.ceil(totalCount / parseInt(limit))
      },
      summary: {
        total: totalCount,
        active: promotions.filter(p => p.status === 'active').length,
        scheduled: promotions.filter(p => p.status === 'scheduled').length,
        expired: promotions.filter(p => p.status === 'expired').length,
        paused: promotions.filter(p => p.status === 'paused').length,
        totalSavings: promotions.reduce((sum, p) =>
          sum + parseFloat(p.analytics.totalSavings), 0
        ).toFixed(2),
        totalUses: promotions.reduce((sum, p) => sum + p.analytics.totalUses, 0)
      }
    });
  } catch (error) {
    logError(error, 'Erro ao buscar promoções:', { service: 'dashboard-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 🎁 Create New Promotion
router.post('/api/legacy/promotions', async (req, res) => {
  if (!legacyPromotionsRoutesEnabled) {
    return res.status(410).json({
      error: 'Rotas legadas de promoções desativadas',
      code: 'LEGACY_PROMOTIONS_DISABLED'
    });
  }

  try {
    const {
      name,
      code,
      description,
      type, // 'percentage', 'fixed', 'free_rides', 'subscription_discount'
      target, // 'drivers', 'customers', 'all'
      discountValue,
      minimumAmount,
      maximumDiscount,
      startDate,
      endDate,
      maxUses,
      maxUsesPerUser,
      targetingRules,
      adminId = 'admin1'
    } = req.body;

    if (!name || !code || !type || !discountValue || !endDate) {
      return res.status(400).json({
        error: 'Nome, código, tipo, valor do desconto e data final são obrigatórios'
      });
    }

    try {
      if (firebaseConfig && firebaseConfig.getRealtimeDB) {
        const db = firebaseConfig.getRealtimeDB();

        // Verificar se o código já existe
        const existingPromoSnapshot = await db.ref('promos')
          .orderByChild('promoCode')
          .equalTo(code)
          .once('value');

        if (existingPromoSnapshot.exists()) {
          return res.status(400).json({ error: 'Código promocional já existe' });
        }

        // Criar nova promoção
        const promoId = Date.now().toString();
        const now = new Date().toISOString();

        const promotion = {
          promoId,
          promoName: name,
          promoCode: code.toUpperCase(),
          description,
          type,
          target,
          discount: parseFloat(discountValue),
          percentage: type === 'percentage' ? parseFloat(discountValue) : null,
          value: type === 'fixed' ? parseFloat(discountValue) : null,
          freeRides: type === 'free_rides' ? parseInt(discountValue) : null,
          subscriptionMonths: type === 'subscription_discount' ? parseInt(discountValue) : null,
          minAmount: parseFloat(minimumAmount || 0),
          maxDiscount: parseFloat(maximumDiscount || 0),
          startDate: startDate || now,
          endDate,
          maxUses: parseInt(maxUses || 0),
          maxUsesPerUser: parseInt(maxUsesPerUser || 1),
          userType: target === 'drivers' ? 'driver' : (target === 'customers' ? 'customer' : null),
          status: 'active',
          active: true,
          createdAt: now,
          createdBy: adminId,
          lastModified: now,
          modifiedBy: adminId,
          // Regras de targeting
          ...(targetingRules?.cities && { cities: targetingRules.cities.join(',') }),
          ...(targetingRules?.newUsersOnly && { newUsersOnly: true }),
          ...(targetingRules?.firstRideOnly && { firstRideOnly: true }),
          ...(targetingRules?.minTripCount && { minTripCount: parseInt(targetingRules.minTripCount) })
        };

        // Salvar promoção
        await db.ref(`promos/${promoId}`).set(promotion);

        logStructured('info', `🎁 Nova promoção criada: ${code} por ${adminId}`, { service: 'dashboard-routes' });

        res.json({
          success: true,
          message: 'Promoção criada com sucesso',
          data: {
            promoId,
            code: promotion.promoCode,
            name: promotion.promoName,
            createdAt: promotion.createdAt
          }
        });
      } else {
        res.status(503).json({ error: 'Firebase não disponível' });
      }
    } catch (firebaseError) {
      logStructured('error', 'Erro ao criar promoção no Firebase:', firebaseError, { service: 'dashboard-routes' });
      res.status(500).json({ error: 'Erro ao salvar promoção' });
    }
  } catch (error) {
    logError(error, 'Erro ao criar promoção:', { service: 'dashboard-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 🎁 Update Promotion
router.patch('/api/legacy/promotions/:promoId', async (req, res) => {
  if (!legacyPromotionsRoutesEnabled) {
    return res.status(410).json({
      error: 'Rotas legadas de promoções desativadas',
      code: 'LEGACY_PROMOTIONS_DISABLED'
    });
  }

  try {
    const { promoId } = req.params;
    const {
      status,
      endDate,
      maxUses,
      description,
      adminId = 'admin1'
    } = req.body;

    try {
      if (firebaseConfig && firebaseConfig.getRealtimeDB) {
        const db = firebaseConfig.getRealtimeDB();

        // Verificar se a promoção existe
        const promoSnapshot = await db.ref(`promos/${promoId}`).once('value');
        if (!promoSnapshot.exists()) {
          return res.status(404).json({ error: 'Promoção não encontrada' });
        }

        // Preparar atualizações
        const updates = {
          lastModified: new Date().toISOString(),
          modifiedBy: adminId
        };

        if (status) {
          updates.status = status;
          updates.active = status === 'active';
        }
        if (endDate) updates.endDate = endDate;
        if (maxUses !== undefined) updates.maxUses = parseInt(maxUses);
        if (description) updates.description = description;

        // Atualizar promoção
        await db.ref(`promos/${promoId}`).update(updates);

        logStructured('info', `🎁 Promoção atualizada: ${promoId} por ${adminId}`, { service: 'dashboard-routes' });

        res.json({
          success: true,
          message: 'Promoção atualizada com sucesso',
          data: {
            promoId,
            updatedAt: updates.lastModified
          }
        });
      } else {
        res.status(503).json({ error: 'Firebase não disponível' });
      }
    } catch (firebaseError) {
      logStructured('error', 'Erro ao atualizar promoção no Firebase:', firebaseError, { service: 'dashboard-routes' });
      res.status(500).json({ error: 'Erro ao salvar atualização' });
    }
  } catch (error) {
    logError(error, 'Erro ao atualizar promoção:', { service: 'dashboard-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 🎁 Promotion Analytics
router.get('/api/legacy/promotions/analytics', async (req, res) => {
  if (!legacyPromotionsRoutesEnabled) {
    return res.status(410).json({
      error: 'Rotas legadas de promoções desativadas',
      code: 'LEGACY_PROMOTIONS_DISABLED'
    });
  }

  try {
    const { period = '30d', promoId } = req.query;

    let analytics = {
      overview: {},
      performance: {},
      usage: {}
    };

    try {
      if (firebaseConfig && firebaseConfig.getRealtimeDB) {
        const db = firebaseConfig.getRealtimeDB();

        // Calcular período
        const now = new Date();
        let startDate = new Date();

        switch (period) {
          case '7d':
            startDate.setDate(now.getDate() - 7);
            break;
          case '30d':
            startDate.setDate(now.getDate() - 30);
            break;
          case '90d':
            startDate.setDate(now.getDate() - 90);
            break;
        }

        // Buscar usos das promoções
        const promoUsageSnapshot = await db.ref('promoUsage').once('value');
        const allUsage = promoUsageSnapshot.val() || {};

        // Filtrar por período e promoção específica se fornecida
        const periodUsage = Object.values(allUsage).filter(usage => {
          const usageDate = new Date(usage.timestamp || usage.usedAt);
          const inPeriod = usageDate >= startDate && usageDate <= now;
          const matchesPromo = !promoId || usage.promoId === promoId;
          return inPeriod && matchesPromo;
        });

        // Buscar promoções ativas
        const promosSnapshot = await db.ref('promos').once('value');
        const promos = promosSnapshot.val() || {};

        const activePromos = Object.values(promos).filter(promo => {
          const endDate = new Date(promo.endDate);
          return endDate > now && promo.active !== false;
        });

        // Calcular métricas gerais
        const totalSavings = periodUsage.reduce((sum, usage) =>
          sum + parseFloat(usage.discountAmount || 0), 0
        );

        const uniqueUsers = new Set(periodUsage.map(u => u.userId)).size;
        const totalUses = periodUsage.length;

        // Analisar por tipo de usuário
        const driverUsage = periodUsage.filter(u => u.userType === 'driver');
        const customerUsage = periodUsage.filter(u => u.userType === 'customer');

        // Analisar por tipo de promoção
        const promoTypeAnalysis = {};
        periodUsage.forEach(usage => {
          const promo = promos[usage.promoId];
          const type = promo?.type || 'unknown';

          if (!promoTypeAnalysis[type]) {
            promoTypeAnalysis[type] = { uses: 0, savings: 0, users: new Set() };
          }

          promoTypeAnalysis[type].uses += 1;
          promoTypeAnalysis[type].savings += parseFloat(usage.discountAmount || 0);
          promoTypeAnalysis[type].users.add(usage.userId);
        });

        // Top promoções por uso
        const promoPerformance = {};
        periodUsage.forEach(usage => {
          const promoId = usage.promoId;
          if (!promoPerformance[promoId]) {
            const promo = promos[promoId];
            promoPerformance[promoId] = {
              promoId,
              name: promo?.promoName || 'Unknown',
              code: promo?.promoCode || 'Unknown',
              uses: 0,
              savings: 0,
              users: new Set()
            };
          }

          promoPerformance[promoId].uses += 1;
          promoPerformance[promoId].savings += parseFloat(usage.discountAmount || 0);
          promoPerformance[promoId].users.add(usage.userId);
        });

        const topPromos = Object.values(promoPerformance)
          .map(promo => ({
            ...promo,
            uniqueUsers: promo.users.size,
            avgSavingsPerUse: promo.uses > 0 ? (promo.savings / promo.uses).toFixed(2) : '0.00',
            savings: promo.savings.toFixed(2)
          }))
          .sort((a, b) => b.uses - a.uses)
          .slice(0, 10);

        analytics = {
          overview: {
            period,
            totalActivePromos: activePromos.length,
            totalUses,
            uniqueUsers,
            totalSavings: totalSavings.toFixed(2),
            avgSavingsPerUse: totalUses > 0 ? (totalSavings / totalUses).toFixed(2) : '0.00',
            conversionRate: uniqueUsers > 0 ? ((totalUses / uniqueUsers)).toFixed(2) : '0.00'
          },
          performance: {
            topPromos,
            byUserType: {
              drivers: {
                uses: driverUsage.length,
                savings: driverUsage.reduce((sum, u) => sum + parseFloat(u.discountAmount || 0), 0).toFixed(2),
                uniqueUsers: new Set(driverUsage.map(u => u.userId)).size
              },
              customers: {
                uses: customerUsage.length,
                savings: customerUsage.reduce((sum, u) => sum + parseFloat(u.discountAmount || 0), 0).toFixed(2),
                uniqueUsers: new Set(customerUsage.map(u => u.userId)).size
              }
            },
            byType: Object.keys(promoTypeAnalysis).map(type => ({
              type,
              uses: promoTypeAnalysis[type].uses,
              savings: promoTypeAnalysis[type].savings.toFixed(2),
              uniqueUsers: promoTypeAnalysis[type].users.size
            }))
          },
          usage: {
            dailyUsage: getDailyUsageBreakdown(periodUsage, startDate, now),
            peakUsageDays: getPeakUsageDays(periodUsage),
            retentionRate: calculatePromoRetentionRate(periodUsage)
          }
        };
      }
    } catch (error) {
      logStructured('warn', '⚠️ Erro ao gerar analytics de promoções:', error.message, { service: 'dashboard-routes' });
    }

    res.json({
      period,
      promoId: promoId || 'all',
      generatedAt: new Date().toISOString(),
      analytics
    });
  } catch (error) {
    logError(error, 'Erro ao gerar analytics de promoções:', { service: 'dashboard-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});
}
