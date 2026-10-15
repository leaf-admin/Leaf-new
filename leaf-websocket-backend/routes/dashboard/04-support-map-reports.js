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

// 🆘 Support Tickets - SISTEMA DE GESTÃO DE SUPORTE
router.get('/api/support/tickets', authenticateLegacyDashboardSupportJWTOrSkip, requireRole(DASHBOARD_SUPPORT_ROLES), async (req, res) => {
  try {
    const {
      type, // 'sos' ou 'complain'
      status,
      priority,
      dateRange,
      assignedTo,
      page = 1,
      limit = 20
    } = req.query;

    let tickets = [];
    let totalCount = 0;

    try {
      const modernCategory =
        type && !['all', 'sos', 'complain'].includes(String(type).toLowerCase())
          ? String(type).toLowerCase()
          : null;
      const modernResult = await supportTicketService.listTickets({
        status: status && status !== 'all' ? status : null,
        priority: priority && priority !== 'all' ? priority : null,
        category: modernCategory,
        agent: assignedTo || null,
        limit: 10000,
        offset: 0,
        isAgent: true
      });

      tickets = modernResult.tickets.map((ticket) => normalizeSupportDashboardTicket(ticket));
    } catch (error) {
      logStructured('warn', '⚠️ Erro ao buscar support tickets modernos:', error.message, {
        service: 'dashboard-routes'
      });
    }

    try {
      if (firebaseConfig && firebaseConfig.getRealtimeDB) {
        const db = firebaseConfig.getRealtimeDB();

        // Buscar tickets SOS
        let sosTickets = [];
        if (!type || type === 'sos') {
          const sosSnapshot = await db.ref('sos').once('value');
          const sosData = sosSnapshot.val() || {};

          sosTickets = Object.keys(sosData).map(sosId => ({
            id: sosId,
            type: 'sos',
            title: 'Chamada de Emergência',
            description: sosData[sosId].description || 'Chamada SOS realizada',
            userId: sosData[sosId].uid || '',
            userType: sosData[sosId].userType || 'customer',
            status: sosData[sosId].status || 'open',
            priority: 'high', // SOS sempre alta prioridade
            location: {
              lat: sosData[sosId].lat || 0,
              lng: sosData[sosId].lng || 0,
              address: sosData[sosId].location || 'Localização não disponível'
            },
            createdAt: sosData[sosId].timestamp ? new Date(sosData[sosId].timestamp).toISOString() : new Date().toISOString(),
            updatedAt: sosData[sosId].updatedAt || sosData[sosId].timestamp,
            assignedTo: sosData[sosId].assignedTo || null,
            resolution: sosData[sosId].resolution || null,
            bookingId: sosData[sosId].bookingId || null
          }));
        }

        // Buscar tickets de reclamação
        let complainTickets = [];
        if (!type || type === 'complain') {
          const complainSnapshot = await db.ref('complain').once('value');
          const complainData = complainSnapshot.val() || {};

          complainTickets = Object.keys(complainData).map(complainId => ({
            id: complainId,
            type: 'complain',
            title: complainData[complainId].subject || 'Reclamação',
            description: complainData[complainId].description || '',
            userId: complainData[complainId].uid || '',
            userType: complainData[complainId].userType || 'customer',
            status: complainData[complainId].status || 'open',
            priority: complainData[complainId].priority || 'medium',
            category: complainData[complainId].category || 'general',
            createdAt: complainData[complainId].timestamp ? new Date(complainData[complainId].timestamp).toISOString() : new Date().toISOString(),
            updatedAt: complainData[complainId].updatedAt || complainData[complainId].timestamp,
            assignedTo: complainData[complainId].assignedTo || null,
            resolution: complainData[complainId].resolution || null,
            bookingId: complainData[complainId].bookingId || null,
            rating: complainData[complainId].rating || null
          }));
        }

        // Combinar tickets
        tickets = [...tickets, ...sosTickets, ...complainTickets];

        // Buscar informações dos usuários para enriquecer os dados legados que ainda não têm user preenchido
        if (tickets.length > 0) {
          const usersSnapshot = await db.ref('users').once('value');
          const users = usersSnapshot.val() || {};

          tickets = tickets.map(ticket => {
            if (ticket.user) {
              return ticket;
            }
            const user = users[ticket.userId];
            return {
              ...ticket,
              user: user ? {
                name: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
                email: user.email || '',
                phone: user.mobile || ''
              } : null
            };
          });
        }

        // Aplicar filtros
        if (status && status !== 'all') {
          tickets = tickets.filter(ticket => ticket.status === status);
        }

        if (priority && priority !== 'all') {
          tickets = tickets.filter(ticket => ticket.priority === priority);
        }

        if (assignedTo) {
          tickets = tickets.filter(ticket => ticket.assignedTo === assignedTo);
        }

        if (dateRange) {
          const [startDate, endDate] = dateRange.split(',');
          if (startDate && endDate) {
            tickets = tickets.filter(ticket => {
              const createdDate = new Date(ticket.createdAt);
              return createdDate >= new Date(startDate) && createdDate <= new Date(endDate);
            });
          }
        }

        // Ordenar por data (mais recentes primeiro)
        tickets.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        totalCount = tickets.length;

        // Aplicar paginação
        const startIndex = (parseInt(page) - 1) * parseInt(limit);
        const endIndex = startIndex + parseInt(limit);
        tickets = tickets.slice(startIndex, endIndex);
      }
    } catch (error) {
      logStructured('warn', '⚠️ Erro ao buscar tickets do Firebase:', error.message, { service: 'dashboard-routes' });
    }

    if (status && status !== 'all') {
      tickets = tickets.filter(ticket => ticket.status === status);
    }

    if (priority && priority !== 'all') {
      tickets = tickets.filter(ticket => ticket.priority === priority);
    }

    if (assignedTo) {
      tickets = tickets.filter(ticket => ticket.assignedTo === assignedTo);
    }

    if (dateRange) {
      const [startDate, endDate] = dateRange.split(',');
      if (startDate && endDate) {
        tickets = tickets.filter(ticket => {
          const createdDate = new Date(ticket.createdAt);
          return createdDate >= new Date(startDate) && createdDate <= new Date(endDate);
        });
      }
    }

    tickets.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    totalCount = tickets.length;

    const startIndex = (parseInt(page) - 1) * parseInt(limit);
    const endIndex = startIndex + parseInt(limit);
    const paginatedTickets = tickets.slice(startIndex, endIndex);

    res.json({
      tickets: paginatedTickets,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount,
        pages: Math.ceil(totalCount / parseInt(limit))
      },
      summary: {
        total: totalCount,
        open: tickets.filter(t => t.status === 'open').length,
        in_progress: tickets.filter(t => t.status === 'in_progress').length,
        resolved: tickets.filter(t => t.status === 'resolved').length,
        closed: tickets.filter(t => t.status === 'closed').length,
        sos: tickets.filter(t => t.type === 'sos').length,
        complain: tickets.filter(t => t.type === 'complain').length
      }
    });
  } catch (error) {
    logError(error, 'Erro ao buscar tickets:', { service: 'dashboard-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 🆘 Atualizar Status do Ticket
router.patch('/api/support/tickets/:id', authenticateJWT, requireRole(DASHBOARD_SUPPORT_ROLES), async (req, res) => {
  try {
    const { id } = req.params;
    const { status, assignedTo, resolution, notes, adminId = 'admin1' } = req.body;

    try {
      if (firebaseConfig && firebaseConfig.getRealtimeDB) {
        const db = firebaseConfig.getRealtimeDB();

        // Verificar se é SOS ou Complain
        let ticketRef = null;
        let ticketType = null;

        // Tentar encontrar em SOS
        const sosSnapshot = await db.ref(`sos/${id}`).once('value');
        if (sosSnapshot.exists()) {
          ticketRef = db.ref(`sos/${id}`);
          ticketType = 'sos';
        } else {
          // Tentar encontrar em Complain
          const complainSnapshot = await db.ref(`complain/${id}`).once('value');
          if (complainSnapshot.exists()) {
            ticketRef = db.ref(`complain/${id}`);
            ticketType = 'complain';
          }
        }

        if (!ticketRef) {
          return res.status(404).json({ error: 'Ticket não encontrado' });
        }

        // Preparar atualizações
        const updates = {
          updatedAt: new Date().toISOString(),
          updatedBy: adminId
        };

        if (status) updates.status = status;
        if (assignedTo) updates.assignedTo = assignedTo;
        if (resolution) updates.resolution = resolution;
        if (notes) updates.adminNotes = notes;

        // Atualizar no Firebase
        await ticketRef.update(updates);

        logStructured('info', `📞 Ticket ${ticketType.toUpperCase()} atualizado: ${id} por ${adminId}`, { service: 'dashboard-routes' });

        res.json({
          success: true,
          message: 'Ticket atualizado com sucesso',
          data: {
            ticketId: id,
            type: ticketType,
            updatedAt: updates.updatedAt
          }
        });
      } else {
        res.status(503).json({ error: 'Firebase não disponível' });
      }
    } catch (firebaseError) {
      logStructured('error', 'Erro ao atualizar ticket no Firebase:', firebaseError, { service: 'dashboard-routes' });
      res.status(500).json({ error: 'Erro ao salvar atualização' });
    }
  } catch (error) {
    logError(error, 'Erro ao atualizar ticket:', { service: 'dashboard-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 🆘 Obter Detalhes de Ticket Específico
router.get('/api/support/tickets/:id', authenticateLegacyDashboardSupportJWTOrSkip, requireRole(DASHBOARD_SUPPORT_ROLES), async (req, res) => {
  try {
    const { id } = req.params;

    try {
      const modernTicket = await supportTicketService.getTicket(id);
      if (modernTicket) {
        return res.json(normalizeSupportDashboardTicket(modernTicket));
      }

      if (firebaseConfig && firebaseConfig.getRealtimeDB) {
        const db = firebaseConfig.getRealtimeDB();

        let ticket = null;
        let ticketType = null;

        // Tentar encontrar em SOS
        const sosSnapshot = await db.ref(`sos/${id}`).once('value');
        if (sosSnapshot.exists()) {
          const sosData = sosSnapshot.val();
          ticketType = 'sos';
          ticket = {
            id,
            type: 'sos',
            title: 'Chamada de Emergência',
            description: sosData.description || 'Chamada SOS realizada',
            userId: sosData.uid || '',
            userType: sosData.userType || 'customer',
            status: sosData.status || 'open',
            priority: 'high',
            location: {
              lat: sosData.lat || 0,
              lng: sosData.lng || 0,
              address: sosData.location || 'Localização não disponível'
            },
            createdAt: sosData.timestamp ? new Date(sosData.timestamp).toISOString() : null,
            updatedAt: sosData.updatedAt || sosData.timestamp,
            assignedTo: sosData.assignedTo || null,
            resolution: sosData.resolution || null,
            bookingId: sosData.bookingId || null,
            adminNotes: sosData.adminNotes || '',
            emergencyContact: sosData.emergencyContact || null
          };
        } else {
          // Tentar encontrar em Complain
          const complainSnapshot = await db.ref(`complain/${id}`).once('value');
          if (complainSnapshot.exists()) {
            const complainData = complainSnapshot.val();
            ticketType = 'complain';
            ticket = {
              id,
              type: 'complain',
              title: complainData.subject || 'Reclamação',
              description: complainData.description || '',
              userId: complainData.uid || '',
              userType: complainData.userType || 'customer',
              status: complainData.status || 'open',
              priority: complainData.priority || 'medium',
              category: complainData.category || 'general',
              createdAt: complainData.timestamp ? new Date(complainData.timestamp).toISOString() : null,
              updatedAt: complainData.updatedAt || complainData.timestamp,
              assignedTo: complainData.assignedTo || null,
              resolution: complainData.resolution || null,
              bookingId: complainData.bookingId || null,
              rating: complainData.rating || null,
              adminNotes: complainData.adminNotes || '',
              attachments: complainData.attachments || []
            };
          }
        }

        if (!ticket) {
          return res.status(404).json({ error: 'Ticket não encontrado' });
        }

        // Buscar informações do usuário
        if (ticket.userId) {
          const userSnapshot = await db.ref(`users/${ticket.userId}`).once('value');
          if (userSnapshot.exists()) {
            const user = userSnapshot.val();
            ticket.user = {
              name: `${user.firstName || ''} ${user.lastName || ''}`.trim(),
              email: user.email || '',
              phone: user.mobile || '',
              profileImage: user.profileImage || ''
            };
          }
        }

        // Buscar informações da corrida se houver
        if (ticket.bookingId) {
          const bookingSnapshot = await db.ref(`bookings/${ticket.bookingId}`).once('value');
          if (bookingSnapshot.exists()) {
            const booking = bookingSnapshot.val();
            ticket.booking = {
              id: ticket.bookingId,
              status: booking.status,
              pickup: booking.pickup,
              drop: booking.drop,
              tripdate: booking.tripdate,
              driver: booking.driver,
              customer: booking.customer
            };
          }
        }

        res.json(ticket);
      } else {
        res.status(503).json({ error: 'Firebase não disponível' });
      }
    } catch (firebaseError) {
      logStructured('error', 'Erro ao buscar ticket no Firebase:', firebaseError, { service: 'dashboard-routes' });
      res.status(500).json({ error: 'Erro ao buscar dados' });
    }
  } catch (error) {
    logError(error, 'Erro ao buscar detalhes do ticket:', { service: 'dashboard-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

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

// 🗺️ Heat Map Data - Dados para Mapa de Calor
router.get('/api/map/heatmap', async (req, res) => {
  try {
    const {
      type = 'trips', // 'trips', 'pickups', 'drops'
      period = '24h' // '1h', '24h', '7d', '30d'
    } = req.query;

    let heatmapData = [];

    try {
      if (firebaseConfig && firebaseConfig.getRealtimeDB) {
        const db = firebaseConfig.getRealtimeDB();

        // Calcular período
        const now = new Date();
        let startDate = new Date();

        switch (period) {
          case '1h':
            startDate.setHours(now.getHours() - 1);
            break;
          case '24h':
            startDate.setDate(now.getDate() - 1);
            break;
          case '7d':
            startDate.setDate(now.getDate() - 7);
            break;
          case '30d':
            startDate.setDate(now.getDate() - 30);
            break;
        }

        // Buscar bookings do período
        const bookingsSnapshot = await db.ref('bookings').once('value');
        const bookings = bookingsSnapshot.val() || {};

        Object.keys(bookings).forEach(bookingId => {
          const booking = bookings[bookingId];
          const tripDate = new Date(booking.tripdate);

          // Filtrar por período
          if (tripDate < startDate) return;

          // Apenas corridas completadas para heatmap
          if (booking.status !== 'COMPLETE' && booking.status !== 'PAID') return;

          if (type === 'trips' || type === 'pickups') {
            // Pontos de pickup
            if (booking.pickup?.lat && booking.pickup?.lng) {
              heatmapData.push({
                lat: parseFloat(booking.pickup.lat),
                lng: parseFloat(booking.pickup.lng),
                weight: 1,
                type: 'pickup',
                address: booking.pickup.add || '',
                timestamp: booking.tripdate
              });
            }
          }

          if (type === 'trips' || type === 'drops') {
            // Pontos de drop
            if (booking.drop?.lat && booking.drop?.lng) {
              heatmapData.push({
                lat: parseFloat(booking.drop.lat),
                lng: parseFloat(booking.drop.lng),
                weight: 1,
                type: 'drop',
                address: booking.drop.add || '',
                timestamp: booking.tripdate
              });
            }
          }
        });

        // Agrupar pontos próximos para melhor visualização
        const groupedData = [];
        const tolerance = 0.001; // ~100m

        heatmapData.forEach(point => {
          const existing = groupedData.find(group =>
            Math.abs(group.lat - point.lat) < tolerance &&
            Math.abs(group.lng - point.lng) < tolerance &&
            group.type === point.type
          );

          if (existing) {
            existing.weight += 1;
            existing.count += 1;
          } else {
            groupedData.push({
              ...point,
              count: 1
            });
          }
        });

        heatmapData = groupedData;
      }
    } catch (error) {
      logStructured('warn', '⚠️ Erro ao buscar dados do heatmap:', error.message, { service: 'dashboard-routes' });
    }

    res.json({
      heatmapData,
      summary: {
        totalPoints: heatmapData.length,
        period,
        type,
        generatedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    logError(error, 'Erro ao gerar heatmap:', { service: 'dashboard-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// 🗺️ Trip Route Tracking - Rastreamento de Rota da Corrida
router.get('/api/map/trip/:bookingId/route', async (req, res) => {
  try {
    const { bookingId } = req.params;

    let routeData = null;

    try {
      if (firebaseConfig && firebaseConfig.getRealtimeDB) {
        const db = firebaseConfig.getRealtimeDB();

        // Buscar dados da corrida
        const bookingSnapshot = await db.ref(`bookings/${bookingId}`).once('value');
        if (!bookingSnapshot.exists()) {
          return res.status(404).json({ error: 'Corrida não encontrada' });
        }

        const booking = bookingSnapshot.val();

        // Buscar tracking da rota se disponível
        const trackingSnapshot = await db.ref(`tracking/${bookingId}`).once('value');
        const trackingData = trackingSnapshot.val() || {};

        // Buscar localização atual do motorista
        const driverLocationSnapshot = await db.ref(`locations/${booking.driver}`).once('value');
        const driverLocation = driverLocationSnapshot.val();

        routeData = {
          bookingId,
          status: booking.status,
          pickup: {
            address: booking.pickup?.add || '',
            lat: parseFloat(booking.pickup?.lat || 0),
            lng: parseFloat(booking.pickup?.lng || 0)
          },
          destination: {
            address: booking.drop?.add || '',
            lat: parseFloat(booking.drop?.lat || 0),
            lng: parseFloat(booking.drop?.lng || 0)
          },
          currentLocation: driverLocation ? {
            lat: parseFloat(driverLocation.lat),
            lng: parseFloat(driverLocation.lng),
            heading: parseFloat(driverLocation.heading || 0),
            speed: parseFloat(driverLocation.speed || 0),
            lastUpdate: driverLocation.timestamp ? new Date(driverLocation.timestamp).toISOString() : null
          } : null,
          route: Object.keys(trackingData).map(timestamp => ({
            lat: parseFloat(trackingData[timestamp].lat),
            lng: parseFloat(trackingData[timestamp].lng),
            timestamp: new Date(parseInt(timestamp)).toISOString(),
            speed: parseFloat(trackingData[timestamp].speed || 0)
          })).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)),
          estimatedFare: parseFloat(booking.estimate || 0),
          distance: booking.distance || '',
          duration: booking.duration || '',
          startTime: booking.trip_start_time ? new Date(booking.trip_start_time).toISOString() : null,
          endTime: booking.trip_end_time ? new Date(booking.trip_end_time).toISOString() : null
        };
      }
    } catch (error) {
      logStructured('warn', '⚠️ Erro ao buscar rota da corrida:', error.message, { service: 'dashboard-routes' });
    }

    if (!routeData) {
      return res.status(404).json({ error: 'Dados da rota não encontrados' });
    }

    res.json(routeData);
  } catch (error) {
    logError(error, 'Erro ao buscar rota da corrida:', { service: 'dashboard-routes' });
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

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
