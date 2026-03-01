// graphql/resolvers/DashboardResolver.js
// Dashboard Resolver - Otimizado para relatórios Leaf App

const firebaseConfig = require('../../firebase-config');
const redisPool = require('../../utils/redis-pool');
const advancedCache = require('../../utils/advanced-cache');
const graphqlAuth = require('../../middleware/graphql-auth');
const { logStructured, logError } = require('../../utils/logger');

class DashboardResolver {
  constructor() {
    this.db = null;
    this.redis = null;
    this.cache = new Map(); // Cache simples para desenvolvimento
  }

  async initialize() {
    if (firebaseConfig && firebaseConfig.getRealtimeDB) {
      this.db = firebaseConfig.getRealtimeDB();
    } else {
      // Inicializar Firebase se não estiver inicializado
      firebaseConfig.initializeFirebase();
      this.db = firebaseConfig.getRealtimeDB();
    }
    this.redis = redisPool.pool;
  }

  // Query otimizada para relatório financeiro com cache avançado
  async financialReport(parent, { period = '30d', input = {} }, context) {
    // Verificar autenticação e permissões
    if (!context.isAuthenticated) {
      throw new Error('Usuário não autenticado');
    }

    if (!graphqlAuth.hasPermission(context.permissions, 'read:financial_reports')) {
      throw new Error('Permissão negada: leitura de relatórios financeiros');
    }

    await this.initialize();

    try {
      logStructured('info', `📊 Gerando relatório financeiro para período: ${period}`);

      // Usar cache avançado
      const data = await advancedCache.getOrSet(
        'financialReport',
        async () => {
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
            default:
              startDate.setDate(now.getDate() - 30);
          }

          // Query otimizada - apenas bookings do período
          const bookingsRef = this.db.ref('bookings');
          const snapshot = await bookingsRef
            .orderByChild('tripdate')
            .startAt(startDate.toISOString())
            .endAt(now.toISOString())
            .once('value');

          const bookings = snapshot.val() || {};
          const bookingArray = Object.keys(bookings).map(key => ({
            id: key,
            ...bookings[key]
          }));

          // Calcular métricas financeiras
          const completedBookings = bookingArray.filter(b =>
            b.status === 'COMPLETE' || b.status === 'PAID'
          );

          const totalRevenue = completedBookings.reduce((sum, booking) =>
            sum + parseFloat(booking.estimate || 0), 0
          );

          const totalCosts = completedBookings.reduce((sum, booking) => {
            const distance = parseFloat(booking.distance || 0);
            const duration = parseFloat(booking.duration || 0);
            const costs = this.calculateTripCosts(booking, distance, duration);
            return sum + costs.totalOperationalCosts;
          }, 0);

          return {
            period,
            totalRevenue,
            totalCosts,
            profitMargin: totalRevenue > 0 ? ((totalRevenue - totalCosts) / totalRevenue) * 100 : 0,
            totalTrips: completedBookings.length,
            averageFare: completedBookings.length > 0 ? totalRevenue / completedBookings.length : 0,
            costBreakdown: this.calculateCostBreakdown(completedBookings),
            revenueBreakdown: this.calculateRevenueBreakdown(completedBookings),
            topRoutes: this.calculateTopRoutes(completedBookings),
            dailyMetrics: this.calculateDailyMetrics(completedBookings, startDate, now),
            previousPeriod: await this.calculatePreviousPeriod(period, totalRevenue, totalCosts, completedBookings.length)
          };
        },
        { period, ...input },
        context
      );

      logStructured('info', `✅ Relatório financeiro gerado: R$ ${data.totalRevenue.toFixed(2)} receita, ${data.totalTrips} corridas`);
      return data;

    } catch (error) {
      logStructured('error', `❌ Erro ao gerar relatório financeiro: ${error.message}`);
      throw new Error('Erro ao gerar relatório financeiro');
    }
  }

  // Query otimizada para métricas operacionais com cache avançado
  async operationalMetrics(parent, { period = '30d', input = {} }, context) {
    // Verificar autenticação e permissões
    if (!context.isAuthenticated) {
      throw new Error('Usuário não autenticado');
    }

    if (!graphqlAuth.hasPermission(context.permissions, 'read:analytics')) {
      throw new Error('Permissão negada: leitura de métricas operacionais');
    }

    await this.initialize();

    try {
      logStructured('info', `📊 Gerando métricas operacionais para período: ${period}`);

      // Usar cache avançado
      const data = await advancedCache.getOrSet(
        'operationalMetrics',
        async () => {
          return await this._getOperationalMetricsInternal(period);
        },
        { period, ...input },
        context
      );

      logStructured('info', `✅ Métricas operacionais geradas: ${data.totalTrips} corridas totais`);
      return data;

    } catch (error) {
      logStructured('error', `❌ Erro ao gerar métricas operacionais: ${error.message}`);
      throw new Error('Erro ao gerar métricas operacionais');
    }
  }

  // Query otimizada para métricas gerais com cache avançado
  async metrics(parent, { period = '30d', input = {} }, context) {
    await this.initialize();

    try {
      logStructured('info', `📊 Gerando métricas gerais para período: ${period}`);

      // Usar cache avançado
      const data = await advancedCache.getOrSet(
        'metrics',
        async () => {
          // Buscar métricas operacionais e financeiras em paralelo usando métodos internos
          const [operational, financial, user, driver, system] = await Promise.all([
            this._getOperationalMetricsInternal(period),
            this._getFinancialReportInternal(period),
            this.getUserMetrics(period),
            this.getDriverMetrics(period),
            this.getSystemMetrics()
          ]);

          return {
            operational,
            financial,
            user,
            driver,
            system
          };
        },
        { period, ...input },
        context
      );

      logStructured('info', `✅ Métricas gerais geradas com sucesso`);
      return data;

    } catch (error) {
      logStructured('error', `❌ Erro ao gerar métricas gerais: ${error.message}`);
      throw new Error('Erro ao gerar métricas gerais');
    }
  }

  // Método interno para métricas operacionais (sem cache)
  async _getOperationalMetricsInternal(period) {
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
      default:
        startDate.setDate(now.getDate() - 30);
    }

    // Buscar dados do Firebase
    const bookingsRef = this.db.ref('bookings');
    const snapshot = await bookingsRef
      .orderByChild('tripdate')
      .startAt(startDate.toISOString())
      .endAt(now.toISOString())
      .once('value');

    const bookings = snapshot.val() || {};
    const bookingArray = Object.keys(bookings).map(key => ({
      id: key,
      ...bookings[key]
    }));

    // Calcular métricas operacionais
    const totalTrips = bookingArray.length;
    const completedTrips = bookingArray.filter(b =>
      b.status === 'COMPLETE' || b.status === 'PAID'
    ).length;
    const cancelledTrips = bookingArray.filter(b =>
      b.status === 'CANCELLED'
    ).length;

    const averageTripDuration = bookingArray.reduce((sum, booking) =>
      sum + parseFloat(booking.duration || 0), 0
    ) / totalTrips || 0;

    const averageTripDistance = bookingArray.reduce((sum, booking) =>
      sum + parseFloat(booking.distance || 0), 0
    ) / totalTrips || 0;

    return {
      totalTrips,
      completedTrips,
      cancelledTrips,
      averageTripDuration: Math.round(averageTripDuration),
      averageTripDistance: Math.round(averageTripDistance * 100) / 100,
      peakHours: this.calculatePeakHours(bookingArray),
      busyAreas: this.calculateBusyAreas(bookingArray)
    };
  }

  // Método interno para relatório financeiro (sem cache)
  async _getFinancialReportInternal(period) {
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
      default:
        startDate.setDate(now.getDate() - 30);
    }

    // Query otimizada - apenas bookings do período
    const bookingsRef = this.db.ref('bookings');
    const snapshot = await bookingsRef
      .orderByChild('tripdate')
      .startAt(startDate.toISOString())
      .endAt(now.toISOString())
      .once('value');

    const bookings = snapshot.val() || {};
    const bookingArray = Object.keys(bookings).map(key => ({
      id: key,
      ...bookings[key]
    }));

    // Calcular métricas financeiras
    const completedBookings = bookingArray.filter(b =>
      b.status === 'COMPLETE' || b.status === 'PAID'
    );

    const totalRevenue = completedBookings.reduce((sum, booking) =>
      sum + parseFloat(booking.estimate || 0), 0
    );

    const totalCosts = completedBookings.reduce((sum, booking) => {
      const distance = parseFloat(booking.distance || 0);
      const duration = parseFloat(booking.duration || 0);
      const costs = this.calculateTripCosts(booking, distance, duration);
      return sum + costs.totalOperationalCosts;
    }, 0);

    return {
      period,
      totalRevenue,
      totalCosts,
      profitMargin: totalRevenue > 0 ? ((totalRevenue - totalCosts) / totalRevenue) * 100 : 0,
      totalTrips: completedBookings.length,
      averageFare: completedBookings.length > 0 ? totalRevenue / completedBookings.length : 0,
      costBreakdown: this.calculateCostBreakdown(completedBookings),
      revenueBreakdown: this.calculateRevenueBreakdown(completedBookings),
      topRoutes: this.calculateTopRoutes(completedBookings),
      dailyMetrics: this.calculateDailyMetrics(completedBookings, startDate, now),
      previousPeriod: await this.calculatePreviousPeriod(period, totalRevenue, totalCosts, completedBookings.length)
    };
  }

  // Métodos auxiliares para cálculos
  calculateTripCosts(booking, distance, duration) {
    // Custos baseados em tarifas reais do mercado (valores em reais)
    const mapsApiCost = 0.0020; // R$ 0.002 por request
    const geocodingCost = 0.0050; // R$ 0.005 por geocoding
    const directionsCost = 0.0050; // R$ 0.005 por direction
    const placesCost = 0.0017; // R$ 0.0017 por place search
    const serverCost = 0.0030; // R$ 0.003 por processamento
    const firebaseCost = 0.0015; // R$ 0.0015 por operações DB
    const redisCost = 0.0005; // R$ 0.0005 por cache operations

    const fare = parseFloat(booking.estimate || 0);
    const paymentCost = fare > 0 ? (fare * 0.039) + 0.39 : 0;

    const costs = {
      mapsApi: mapsApiCost * 2, // 2 chamadas por corrida
      geocoding: geocodingCost * 2, // origem e destino
      directionsApi: directionsCost * 1, // 1 rota
      placesApi: placesCost * 1, // busca de lugares
      serverCosts: serverCost,
      firebaseCosts: firebaseCost * 3, // 3 operações médias
      redisCosts: redisCost * 2, // 2 operações cache
      paymentProcessing: paymentCost,
      fcmNotifications: 0, // FCM é gratuito até certo limite
      smsNotifications: booking.smsUsed ? 0.10 : 0,
      totalOperationalCosts: 0 // Calculado abaixo
    };

    // Totais por categoria
    costs.totalOperationalCosts =
      costs.mapsApi + costs.geocoding + costs.directionsApi + costs.placesApi +
      costs.serverCosts + costs.firebaseCosts + costs.redisCosts +
      costs.paymentProcessing + costs.fcmNotifications + costs.smsNotifications;

    return costs;
  }

  calculateCostBreakdown(bookings) {
    const breakdown = {
      mapsApi: 0,
      infrastructure: 0,
      paymentProcessing: 0,
      serverCosts: 0,
      firebaseCosts: 0,
      redisCosts: 0,
      totalOperationalCosts: 0
    };

    bookings.forEach(booking => {
      const distance = parseFloat(booking.distance || 0);
      const duration = parseFloat(booking.duration || 0);
      const costs = this.calculateTripCosts(booking, distance, duration);

      breakdown.mapsApi += costs.mapsApi + costs.geocoding + costs.directionsApi + costs.placesApi;
      breakdown.infrastructure += costs.serverCosts + costs.firebaseCosts + costs.redisCosts;
      breakdown.paymentProcessing += costs.paymentProcessing;
      breakdown.serverCosts += costs.serverCosts;
      breakdown.firebaseCosts += costs.firebaseCosts;
      breakdown.redisCosts += costs.redisCosts;
      breakdown.totalOperationalCosts += costs.totalOperationalCosts;
    });

    return breakdown;
  }

  calculateRevenueBreakdown(bookings) {
    const breakdown = {
      rideFares: 0,
      commissions: 0,
      subscriptions: 0,
      marketing: 0,
      other: 0
    };

    bookings.forEach(booking => {
      const fare = parseFloat(booking.estimate || 0);
      breakdown.rideFares += fare;
      breakdown.commissions += fare * 0.15; // 15% de comissão estimada
    });

    return breakdown;
  }

  calculateTopRoutes(bookings) {
    const routeMap = new Map();

    bookings.forEach(booking => {
      const route = `${booking.pickup?.address || 'Origem'} → ${booking.destination?.address || 'Destino'}`;
      const fare = parseFloat(booking.estimate || 0);

      if (routeMap.has(route)) {
        const existing = routeMap.get(route);
        existing.frequency += 1;
        existing.revenue += fare;
        existing.distance += parseFloat(booking.distance || 0);
      } else {
        routeMap.set(route, {
          route,
          frequency: 1,
          revenue: fare,
          distance: parseFloat(booking.distance || 0)
        });
      }
    });

    return Array.from(routeMap.values())
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, 10)
      .map(route => ({
        route: route.route,
        frequency: route.frequency,
        revenue: route.revenue,
        averageFare: route.revenue / route.frequency,
        distance: route.distance / route.frequency
      }));
  }

  calculateDailyMetrics(bookings, startDate, endDate) {
    const dailyMap = new Map();

    // Inicializar todos os dias do período
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const dateKey = d.toISOString().split('T')[0];
      dailyMap.set(dateKey, {
        date: new Date(d),
        trips: 0,
        revenue: 0,
        costs: 0,
        profit: 0
      });
    }

    // Preencher com dados reais
    bookings.forEach(booking => {
      const dateKey = new Date(booking.tripdate).toISOString().split('T')[0];
      if (dailyMap.has(dateKey)) {
        const day = dailyMap.get(dateKey);
        day.trips += 1;
        day.revenue += parseFloat(booking.estimate || 0);

        const distance = parseFloat(booking.distance || 0);
        const duration = parseFloat(booking.duration || 0);
        const costs = this.calculateTripCosts(booking, distance, duration);
        day.costs += costs.totalOperationalCosts;
        day.profit = day.revenue - day.costs;
      }
    });

    return Array.from(dailyMap.values()).sort((a, b) => a.date - b.date);
  }

  calculateAverageDuration(bookings) {
    if (bookings.length === 0) return 0;
    const totalDuration = bookings.reduce((sum, booking) =>
      sum + parseFloat(booking.duration || 0), 0
    );
    return Math.round(totalDuration / bookings.length);
  }

  calculateAverageDistance(bookings) {
    if (bookings.length === 0) return 0;
    const totalDistance = bookings.reduce((sum, booking) =>
      sum + parseFloat(booking.distance || 0), 0
    );
    return Math.round((totalDistance / bookings.length) * 100) / 100;
  }

  calculatePeakHours(bookings) {
    const hourMap = new Map();

    bookings.forEach(booking => {
      const hour = new Date(booking.tripdate).getHours();
      hourMap.set(hour, (hourMap.get(hour) || 0) + 1);
    });

    return Array.from(hourMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([hour, count]) => `${hour}:00`);
  }

  calculateBusyAreas(bookings) {
    const areaMap = new Map();

    bookings.forEach(booking => {
      const area = booking.pickup?.address?.split(',')[0] || 'Área Desconhecida';
      const fare = parseFloat(booking.estimate || 0);

      if (areaMap.has(area)) {
        const existing = areaMap.get(area);
        existing.tripCount += 1;
        existing.revenue += fare;
      } else {
        areaMap.set(area, {
          area,
          tripCount: 1,
          revenue: fare
        });
      }
    });

    return Array.from(areaMap.values())
      .sort((a, b) => b.tripCount - a.tripCount)
      .slice(0, 10)
      .map(area => ({
        area: area.area,
        tripCount: area.tripCount,
        revenue: area.revenue,
        averageFare: area.revenue / area.tripCount
      }));
  }

  async calculatePreviousPeriod(period, currentRevenue, currentCosts, currentTrips) {
    // Implementação simplificada - pode ser expandida
    return {
      revenueChange: 0,
      costChange: 0,
      profitChange: 0,
      tripChange: 0,
      percentageChange: 0
    };
  }

  async getFinancialMetrics(period) {
    // Implementação simplificada
    return {
      totalRevenue: 0,
      totalCosts: 0,
      netProfit: 0,
      profitMargin: 0,
      averageFare: 0,
      commissionRate: 0.15
    };
  }

  async getUserMetrics(period) {
    // Implementação simplificada
    return {
      totalUsers: 0,
      activeUsers: 0,
      newUsers: 0,
      userRetention: 0,
      averageRating: 0
    };
  }

  async getDriverMetrics(period) {
    // Implementação simplificada
    return {
      totalDrivers: 0,
      activeDrivers: 0,
      onlineDrivers: 0,
      averageDriverRating: 0,
      driverSatisfaction: 0
    };
  }

  async getSystemMetrics() {
    // Implementação simplificada
    return {
      uptime: 99.9,
      responseTime: 200,
      errorRate: 0.1,
      throughput: 1000,
      cacheHitRate: 85.5
    };
  }
}

module.exports = new DashboardResolver();
