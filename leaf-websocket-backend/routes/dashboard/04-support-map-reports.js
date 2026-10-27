// Gerado a partir de routes/dashboard.js (divisão mecânica, mesma ordem de registro).
// Suporte, mapa e relatórios

const {
  DASHBOARD_FINANCIAL_ROLES,
  DASHBOARD_MONITORING_ROLES,
  DASHBOARD_SUPPORT_ROLES,
  auditService,
  authenticateJWT,
  authenticateLegacyDashboardSupportJWTOrSkip,
  authenticateMapH3Access,
  calculateAverageTripTime,
  calculateAverageWaitTime,
  convertToCSV,
  firebaseConfig,
  getAverageDistance,
  getAverageRating,
  getCityAnalysis,
  getDashboardLiveData,
  getGeographicDistribution,
  getHourlyTripDistribution,
  getPaymentMethodsBreakdown,
  getPeakHours,
  getRouteAnalysis,
  getTopDriversByEarnings,
  getTopReferrers,
  getTripAnalysis,
  getUserGrowthTrend,
  getVehicleTypeAnalysis,
  h3MapService,
  h3VisualPolicyService,
  isRideRevenuePendingFinalSnapshot,
  logError,
  logStructured,
  normalizeSupportDashboardTicket,
  redisPool,
  requireAdminMutationsEnabled,
  requireRole,
  resolveRideDriverNetAmount,
  resolveRideOperationalFee,
  resolveRideRevenue,
  router,
  supportTicketService
} = require('./shared');

// 🗺️ Real-Time Map - SISTEMA DE MAPA EM TEMPO REAL
router.get('/api/map/locations', async (req, res) => {
  try {
    const {
      type, // 'all', 'drivers', 'passengers'
      status, // 'online', 'available', 'busy'
      bounds // 'lat1,lng1,lat2,lng2' para filtrar por área
    } = req.query;

    const liveData = await getDashboardLiveData(redisPool.getConnection());
    let locations = {
      drivers: Array.isArray(liveData.drivers) ? [...liveData.drivers] : [],
      passengers: [],
      activeBookings: Array.isArray(liveData.trips) ? [...liveData.trips] : []
    };

    if (status && status !== 'all') {
      locations.drivers = locations.drivers.filter((driver) => driver.status === status);
    }

    if (type === 'drivers') {
      locations.passengers = [];
      locations.activeBookings = [];
    } else if (type === 'passengers') {
      locations.drivers = [];
    }

    if (bounds) {
      const [lat1, lng1, lat2, lng2] = String(bounds).split(',').map(parseFloat);
      const minLat = Math.min(lat1, lat2);
      const maxLat = Math.max(lat1, lat2);
      const minLng = Math.min(lng1, lng2);
      const maxLng = Math.max(lng1, lng2);

      const inBounds = (point) => {
        const lat = Number(point?.location?.lat);
        const lng = Number(point?.location?.lng);
        return Number.isFinite(lat)
          && Number.isFinite(lng)
          && lat >= minLat
          && lat <= maxLat
          && lng >= minLng
          && lng <= maxLng;
      };

      locations.drivers = locations.drivers.filter(inBounds);
      locations.passengers = locations.passengers.filter(inBounds);
    }

    const driverCoordinates = locations.drivers
      .map((driver) => ({
        lat: Number(driver?.location?.lat),
        lng: Number(driver?.location?.lng)
      }))
      .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));

    let driverDensityPerKm2 = null;
    if (driverCoordinates.length >= 2) {
      const lats = driverCoordinates.map((point) => point.lat);
      const lngs = driverCoordinates.map((point) => point.lng);
      const minLat = Math.min(...lats);
      const maxLat = Math.max(...lats);
      const minLng = Math.min(...lngs);
      const maxLng = Math.max(...lngs);
      const avgLat = (minLat + maxLat) / 2;

      const latKm = Math.max((maxLat - minLat) * 111.32, 0.001);
      const lngKm = Math.max((maxLng - minLng) * 111.32 * Math.cos((avgLat * Math.PI) / 180), 0.001);
      const areaKm2 = latKm * lngKm;
      if (Number.isFinite(areaKm2) && areaKm2 > 0) {
        driverDensityPerKm2 = locations.drivers.length / areaKm2;
      }
    }

    const passengerDriverRatio = locations.drivers.length > 0
      ? locations.passengers.length / locations.drivers.length
      : null;

    res.json({
      locations,
      summary: {
        totalDrivers: locations.drivers.length,
        availableDrivers: locations.drivers.filter(d => d.status === 'available').length,
        busyDrivers: locations.drivers.filter(d => d.status === 'busy').length,
        activePassengers: locations.passengers.length,
        activeBookings: locations.activeBookings.length,
        passengerDriverRatio,
        driverDensityPerKm2
      },
      lastUpdate: new Date().toISOString()
    });
  } catch (error) {
    logError(error, 'Erro ao buscar localizações:', { service: 'dashboard-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

router.get('/api/map/h3-cells', authenticateMapH3Access, async (req, res) => {
  try {
    const redis = redisPool.getConnection();
    const surface = String(req.query.surface || 'dashboard').trim().toLowerCase();
    const visualPolicy = surface === 'driver'
      ? await h3VisualPolicyService.getPolicy()
      : h3VisualPolicyService.getDefaultPolicy();
    const includeEmpty = h3MapService.helpers.parseBoolean(req.query.includeEmpty, false);
    const includeBoundary = h3MapService.helpers.parseBoolean(req.query.includeBoundary, true);
    const payload = await h3MapService.getCells({
      redis,
      bbox: req.query.bbox,
      zoom: req.query.zoom,
      surface,
      mode: String(req.query.mode || 'supply_demand').trim().toLowerCase(),
      includeEmpty,
      includeBoundary,
      visualPolicy
    });

    res.json(payload);
  } catch (error) {
    const statusCode = Number(error?.statusCode || 500);
    logError(error, 'Erro ao montar mapa H3', {
      service: 'dashboard-routes',
      operation: 'getMapH3Cells',
      statusCode
    });

    res.status(statusCode).json({
      error: error?.message || 'Erro interno ao montar mapa H3',
      ...(error?.details ? { details: error.details } : {})
    });
  }
});

router.get(
  '/api/map/h3-visual-policy',
  authenticateJWT,
  requireRole(DASHBOARD_MONITORING_ROLES),
  async (_req, res) => {
    try {
      const policy = await h3VisualPolicyService.getPolicy({ forceRefresh: true });
      return res.json({ success: true, policy });
    } catch (error) {
      logError(error, 'Erro ao carregar política visual H3', {
        service: 'dashboard-routes',
        operation: 'getH3VisualPolicy'
      });
      return res.status(503).json({ success: false, error: 'Política visual indisponível' });
    }
  }
);

router.put(
  '/api/map/h3-visual-policy',
  authenticateJWT,
  requireRole(DASHBOARD_MONITORING_ROLES),
  requireAdminMutationsEnabled,
  async (req, res) => {
    try {
      const previous = await h3VisualPolicyService.getPolicy({ forceRefresh: true });
      const policy = await h3VisualPolicyService.updatePolicy(req.body || {}, req.user || {});

      await auditService.logEvent({
        userId: req.user?.id || 'dashboard',
        action: 'dashboard.map.h3_visual_policy.update',
        resource: 'runtime_config',
        severity: 'INFO',
        details: {
          previous,
          next: policy,
          operatorEmail: req.user?.email || null,
          operatorRole: req.user?.role || null
        },
        success: true
      });

      return res.json({ success: true, policy });
    } catch (error) {
      logError(error, 'Erro ao salvar política visual H3', {
        service: 'dashboard-routes',
        operation: 'updateH3VisualPolicy'
      });
      return res.status(400).json({ success: false, error: error.message || 'Política visual inválida' });
    }
  }
);

// 📊 Advanced Reports - SISTEMA DE RELATÓRIOS AVANÇADOS
router.get('/api/reports/comprehensive', authenticateJWT, requireRole(DASHBOARD_FINANCIAL_ROLES), async (req, res) => {
  try {
    const {
      reportType = 'financial', // 'financial', 'operational', 'users', 'trips'
      period = '30d', // '7d', '30d', '90d', '1y'
      format = 'json', // 'json', 'csv'
      filters = {} // filtros específicos
    } = req.query;

    let reportData = {};

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
          case '1y':
            startDate.setFullYear(now.getFullYear() - 1);
            break;
        }

        // Buscar dados base
        const [bookingsSnapshot, usersSnapshot, carsSnapshot] = await Promise.all([
          db.ref('bookings').once('value'),
          db.ref('users').once('value'),
          db.ref('cars').once('value')
        ]);

        const bookings = bookingsSnapshot.val() || {};
        const users = usersSnapshot.val() || {};
        const cars = carsSnapshot.val() || {};

        // Filtrar bookings por período
        const periodBookings = Object.keys(bookings).filter(bookingId => {
          const booking = bookings[bookingId];
          const tripDate = new Date(booking.tripdate);
          return tripDate >= startDate && tripDate <= now;
        }).map(id => ({ id, ...bookings[id] }));

        // Relatório Financeiro
        if (reportType === 'financial') {
          const completedBookings = periodBookings.filter(b =>
            b.status === 'COMPLETE' || b.status === 'PAID'
          );
          const reconciledCompletedBookings = completedBookings.filter(
            (booking) => !isRideRevenuePendingFinalSnapshot(booking)
          );

          const totalFares = completedBookings.reduce((sum, b) =>
            sum + resolveRideRevenue(b), 0
          );

          const convenienceFees = completedBookings.reduce((sum, b) =>
            sum + resolveRideOperationalFee(b), 0
          );

          const driverEarnings = completedBookings.reduce((sum, b) =>
            sum + resolveRideDriverNetAmount(b), 0
          );

          // Agrupar por dia
          const dailyRevenue = {};
          completedBookings.forEach(booking => {
            const date = new Date(booking.tripdate).toISOString().split('T')[0];
            if (!dailyRevenue[date]) {
              dailyRevenue[date] = {
                totalFares: 0,
                convenienceFees: 0,
                trips: 0
              };
            }
            dailyRevenue[date].totalFares += resolveRideRevenue(booking);
            dailyRevenue[date].convenienceFees += resolveRideOperationalFee(booking);
            dailyRevenue[date].trips += 1;
            dailyRevenue[date].reconciledTrips = (dailyRevenue[date].reconciledTrips || 0)
              + (isRideRevenuePendingFinalSnapshot(booking) ? 0 : 1);
          });

          reportData = {
            summary: {
              period: `${startDate.toISOString().split('T')[0]} to ${now.toISOString().split('T')[0]}`,
              totalBookings: periodBookings.length,
              completedBookings: completedBookings.length,
              totalRevenue: totalFares.toFixed(2),
              convenienceFees: convenienceFees.toFixed(2),
              driverEarnings: driverEarnings.toFixed(2),
              reconciledCompletedBookings: reconciledCompletedBookings.length,
              pendingReconciliationBookings: completedBookings.length - reconciledCompletedBookings.length,
              averageOrderValue: completedBookings.length > 0 ?
                (totalFares / Math.max(reconciledCompletedBookings.length, 1)).toFixed(2) : '0.00'
            },
            dailyBreakdown: Object.keys(dailyRevenue).map(date => ({
              date,
              ...dailyRevenue[date],
              totalFares: dailyRevenue[date].totalFares.toFixed(2),
              convenienceFees: dailyRevenue[date].convenienceFees.toFixed(2)
            })).sort((a, b) => new Date(a.date) - new Date(b.date)),
            topDrivers: getTopDriversByEarnings(completedBookings, users, 10),
            paymentMethods: getPaymentMethodsBreakdown(completedBookings)
          };
        }

        // Relatório Operacional
        else if (reportType === 'operational') {
          const totalTrips = periodBookings.length;
          const completedBookings = periodBookings.filter(b =>
            b.status === 'COMPLETE' || b.status === 'PAID'
          );
          const completedTrips = completedBookings.length;
          const cancelledTrips = periodBookings.filter(b =>
            b.status === 'CANCELLED'
          ).length;

          // Análise de cancelamentos
          const cancellationReasons = {};
          periodBookings.filter(b => b.status === 'CANCELLED').forEach(booking => {
            const reason = booking.reason || 'Unknown';
            cancellationReasons[reason] = (cancellationReasons[reason] || 0) + 1;
          });

          // Análise de tempos
          const avgWaitTime = calculateAverageWaitTime(completedBookings);
          const avgTripTime = calculateAverageTripTime(completedBookings);

          reportData = {
            summary: {
              period: `${startDate.toISOString().split('T')[0]} to ${now.toISOString().split('T')[0]}`,
              totalTrips,
              completedTrips,
              cancelledTrips,
              completionRate: totalTrips > 0 ? ((completedTrips / totalTrips) * 100).toFixed(2) + '%' : '0%',
              cancellationRate: totalTrips > 0 ? ((cancelledTrips / totalTrips) * 100).toFixed(2) + '%' : '0%',
              avgWaitTime: avgWaitTime + ' min',
              avgTripTime: avgTripTime + ' min'
            },
            cancellationAnalysis: Object.keys(cancellationReasons).map(reason => ({
              reason,
              count: cancellationReasons[reason],
              percentage: ((cancellationReasons[reason] / cancelledTrips) * 100).toFixed(2) + '%'
            })).sort((a, b) => b.count - a.count),
            hourlyDistribution: getHourlyTripDistribution(periodBookings),
            cityAnalysis: getCityAnalysis(periodBookings, users)
          };
        }

        // Relatório de Usuários
        else if (reportType === 'users') {
          const periodUsers = Object.keys(users).filter(userId => {
            const user = users[userId];
            if (!user.createdAt) return false;
            const createdDate = new Date(user.createdAt);
            return createdDate >= startDate && createdDate <= now;
          }).map(id => ({ id, ...users[id] }));

          const newDrivers = periodUsers.filter(u => u.usertype === 'driver');
          const newCustomers = periodUsers.filter(u => u.usertype === 'customer');

          reportData = {
            summary: {
              period: `${startDate.toISOString().split('T')[0]} to ${now.toISOString().split('T')[0]}`,
              newUsers: periodUsers.length,
              newDrivers: newDrivers.length,
              newCustomers: newCustomers.length,
              approvedDrivers: newDrivers.filter(d => d.approved === true).length,
              pendingDrivers: newDrivers.filter(d => d.approved !== true && d.approved !== false).length
            },
            userGrowth: getUserGrowthTrend(periodUsers, startDate, now),
            topReferrers: getTopReferrers(periodUsers),
            geographicDistribution: getGeographicDistribution(periodUsers)
          };
        }

        // Relatório de Corridas
        else if (reportType === 'trips') {
          reportData = {
            summary: {
              period: `${startDate.toISOString().split('T')[0]} to ${now.toISOString().split('T')[0]}`,
              totalTrips: periodBookings.length,
              completedTrips: periodBookings.filter(b => b.status === 'COMPLETE' || b.status === 'PAID').length,
              averageDistance: getAverageDistance(periodBookings),
              averageRating: getAverageRating(periodBookings),
              peakHours: getPeakHours(periodBookings)
            },
            tripAnalysis: getTripAnalysis(periodBookings),
            routeAnalysis: getRouteAnalysis(periodBookings),
            vehicleTypeAnalysis: getVehicleTypeAnalysis(periodBookings, cars)
          };
        }
      }
    } catch (error) {
      logStructured('warn', '⚠️ Erro ao gerar relatório:', error.message, { service: 'dashboard-routes' });
    }

    // Se format for CSV, converter para CSV
    if (format === 'csv') {
      const csv = convertToCSV(reportData, reportType);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="report_${reportType}_${period}.csv"`);
      return res.send(csv);
    }

    res.json({
      reportType,
      period,
      generatedAt: new Date().toISOString(),
      data: reportData
    });
  } catch (error) {
    logError(error, 'Erro ao gerar relatório:', { service: 'dashboard-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 📊 Export Report Data
router.get('/api/reports/export/:reportId', authenticateJWT, requireRole(DASHBOARD_FINANCIAL_ROLES), async (req, res) => {
  try {
    const { reportId } = req.params;
    const { format = 'pdf' } = req.query; // 'pdf', 'excel', 'csv'

    // TODO: Implementar exportação para diferentes formatos
    // Por enquanto, retornar CSV básico

    res.json({
      message: 'Funcionalidade de exportação em desenvolvimento',
      reportId,
      format,
      availableFormats: ['csv', 'json']
    });
  } catch (error) {
    logError(error, 'Erro ao exportar relatório:', { service: 'dashboard-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});
