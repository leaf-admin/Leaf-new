// graphql/resolvers/BookingResolver.js
// Booking Resolver - Otimizado para corridas

const firebaseConfig = require('../../firebase-config');
const redisPool = require('../../utils/redis-pool');
const OptimizedDataLoader = require('../../utils/optimized-dataloader');
const { logStructured, logError } = require('../../utils/logger');

class BookingResolver {
  constructor() {
    this.db = null;
    this.redis = null;
    this.bookingLoader = null;
    this.userLoader = null;
    this.cache = new Map();
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

    // Atualizado para usar o OptimizedDataLoader
    if (!this.bookingLoader) {
      this.bookingLoader = OptimizedDataLoader.createBookingLoader(this.db);
    }

    if (!this.userLoader) {
      this.userLoader = OptimizedDataLoader.createUserLoader(this.db);
    }
  }

  // Query para buscar corrida por ID
  async booking(parent, { id }, context) {
    await this.initialize();

    const cacheKey = `booking:${id}`;
    if (this.cache.has(cacheKey)) {
      logStructured('info', `📊 Cache hit para booking:${id}`);
      return this.cache.get(cacheKey);
    }

    const booking = await this.bookingLoader.load(id);

    if (booking) {
      // Cache por 2 minutos
      this.cache.set(cacheKey, booking);
      setTimeout(() => this.cache.delete(cacheKey), 2 * 60 * 1000);
    }

    return booking;
  }

  // Query para listar corridas com filtros
  async bookings(parent, {
    first = 50,
    after,
    status,
    passengerId,
    driverId,
    dateRange,
    sortBy = 'tripdate',
    sortOrder = 'DESC'
  }, context) {
    await this.initialize();

    const cacheKey = `bookings:${first}:${after}:${status}:${passengerId}:${driverId}:${JSON.stringify(dateRange)}:${sortBy}:${sortOrder}`;
    if (this.cache.has(cacheKey)) {
      logStructured('info', '📊 Cache hit para bookings');
      return this.cache.get(cacheKey);
    }

    logStructured('info', `📊 Buscando corridas: first=${first}, status=${status}, passengerId=${passengerId}, driverId=${driverId}`);

    try {
      // Query otimizada com filtros
      let bookingsRef = this.db.ref('bookings');

      if (passengerId) {
        bookingsRef = bookingsRef.orderByChild('passengerId').equalTo(passengerId);
      } else if (driverId) {
        bookingsRef = bookingsRef.orderByChild('driverId').equalTo(driverId);
      } else if (status) {
        bookingsRef = bookingsRef.orderByChild('status').equalTo(status);
      } else {
        // OBRIGATÓRIO: Sem filtro, ordenar por data para poder paginar e evitar scan completo
        bookingsRef = bookingsRef.orderByChild('tripdate');
      }

      // Aplicar limite de segurança (máximo 100 por requisição)
      const safeLimit = Math.min(first || 50, 100);
      bookingsRef = bookingsRef.limitToLast(safeLimit);

      const snapshot = await bookingsRef.once('value');
      const bookings = snapshot.val() || {};

      // Converter para array e aplicar filtros adicionais
      let bookingArray = Object.keys(bookings).map(key => ({
        id: key,
        ...bookings[key]
      }));

      // Filtro por status
      if (status) {
        bookingArray = bookingArray.filter(booking => booking.status === status);
      }

      // Filtro por período
      if (dateRange) {
        const startDate = new Date(dateRange.startDate);
        const endDate = new Date(dateRange.endDate);
        bookingArray = bookingArray.filter(booking => {
          const tripDate = new Date(booking.tripdate);
          return tripDate >= startDate && tripDate <= endDate;
        });
      }

      // Ordenação
      bookingArray.sort((a, b) => {
        const aValue = a[sortBy] || '';
        const bValue = b[sortBy] || '';

        if (sortOrder === 'ASC') {
          return aValue > bValue ? 1 : -1;
        } else {
          return aValue < bValue ? 1 : -1;
        }
      });

      const result = {
        edges: bookingArray.map(booking => ({
          node: {
            id: booking.id,
            passenger: { id: booking.passengerId },
            driver: booking.driverId ? { id: booking.driverId } : null,
            pickup: {
              latitude: parseFloat(booking.pickup?.latitude || 0),
              longitude: parseFloat(booking.pickup?.longitude || 0),
              address: booking.pickup?.address || ''
            },
            destination: {
              latitude: parseFloat(booking.destination?.latitude || 0),
              longitude: parseFloat(booking.destination?.longitude || 0),
              address: booking.destination?.address || ''
            },
            status: booking.status || 'PENDING',
            fare: parseFloat(booking.estimate || 0),
            distance: parseFloat(booking.distance || 0),
            duration: parseInt(booking.duration || 0),
            createdAt: new Date(booking.tripdate),
            updatedAt: booking.updatedAt ? new Date(booking.updatedAt) : new Date()
          },
          cursor: booking.id
        })),
        pageInfo: {
          hasNextPage: bookingArray.length === first,
          hasPreviousPage: !!after,
          startCursor: bookingArray[0]?.id,
          endCursor: bookingArray[bookingArray.length - 1]?.id
        },
        totalCount: bookingArray.length
      };

      // Cache por 1 minuto
      this.cache.set(cacheKey, result);
      setTimeout(() => this.cache.delete(cacheKey), 1 * 60 * 1000);

      logStructured('info', `✅ ${bookingArray.length} corridas encontradas`);
      return result;

    } catch (error) {
      logError(error, '❌ Erro ao buscar corridas:', { service: 'BookingResolver' });
      throw new Error('Erro ao buscar corridas');
    }
  }

  // Query para corridas em andamento
  async activeBookings(parent, { passengerId, driverId }, context) {
    await this.initialize();

    const cacheKey = `active_bookings:${passengerId}:${driverId}`;
    if (this.cache.has(cacheKey)) {
      logStructured('info', '📊 Cache hit para activeBookings');
      return this.cache.get(cacheKey);
    }

    logStructured('info', `📊 Buscando corridas ativas: passengerId=${passengerId}, driverId=${driverId}`);

    try {
      // Buscar corridas ativas
      const activeStatuses = ['PENDING', 'ACCEPTED', 'IN_PROGRESS'];
      const bookingsSnapshot = await this.db.ref('bookings').once('value');
      const bookings = bookingsSnapshot.val() || {};

      let activeBookings = Object.keys(bookings)
        .filter(key => activeStatuses.includes(bookings[key].status))
        .map(key => ({
          id: key,
          ...bookings[key]
        }));

      // Filtrar por usuário se especificado
      if (passengerId) {
        activeBookings = activeBookings.filter(booking => booking.passengerId === passengerId);
      }

      if (driverId) {
        activeBookings = activeBookings.filter(booking => booking.driverId === driverId);
      }

      const result = activeBookings.map(booking => ({
        id: booking.id,
        passenger: { id: booking.passengerId },
        driver: booking.driverId ? { id: booking.driverId } : null,
        pickup: {
          latitude: parseFloat(booking.pickup?.latitude || 0),
          longitude: parseFloat(booking.pickup?.longitude || 0),
          address: booking.pickup?.address || ''
        },
        destination: {
          latitude: parseFloat(booking.destination?.latitude || 0),
          longitude: parseFloat(booking.destination?.longitude || 0),
          address: booking.destination?.address || ''
        },
        status: booking.status || 'PENDING',
        fare: parseFloat(booking.estimate || 0),
        distance: parseFloat(booking.distance || 0),
        duration: parseInt(booking.duration || 0),
        createdAt: new Date(booking.tripdate),
        updatedAt: booking.updatedAt ? new Date(booking.updatedAt) : new Date()
      }));

      // Cache por 30 segundos
      this.cache.set(cacheKey, result);
      setTimeout(() => this.cache.delete(cacheKey), 30 * 1000);

      logStructured('info', `✅ ${result.length} corridas ativas encontradas`);
      return result;

    } catch (error) {
      logError(error, '❌ Erro ao buscar corridas ativas:', { service: 'BookingResolver' });
      throw new Error('Erro ao buscar corridas ativas');
    }
  }

  // Query para histórico de corridas
  async bookingHistory(parent, { userId, userType, first = 20, after, dateRange }, context) {
    await this.initialize();

    const cacheKey = `booking_history:${userId}:${userType}:${first}:${after}:${JSON.stringify(dateRange)}`;
    if (this.cache.has(cacheKey)) {
      logStructured('info', `📊 Cache hit para bookingHistory:${userId}`);
      return this.cache.get(cacheKey);
    }

    logStructured('info', `📊 Buscando histórico de corridas: userId=${userId}, userType=${userType}`);

    try {
      // Buscar corridas do usuário
      const bookingsSnapshot = await this.db.ref('bookings').once('value');
      const bookings = bookingsSnapshot.val() || {};

      // Filtrar corridas do usuário
      let userBookings = Object.keys(bookings)
        .filter(key => {
          const booking = bookings[key];
          if (userType === 'CUSTOMER') {
            return booking.passengerId === userId;
          } else if (userType === 'DRIVER') {
            return booking.driverId === userId;
          }
          return false;
        })
        .map(key => ({
          id: key,
          ...bookings[key]
        }));

      // Filtro por período
      if (dateRange) {
        const startDate = new Date(dateRange.startDate);
        const endDate = new Date(dateRange.endDate);
        userBookings = userBookings.filter(booking => {
          const tripDate = new Date(booking.tripdate);
          return tripDate >= startDate && tripDate <= endDate;
        });
      }

      // Ordenar por data (mais recente primeiro)
      userBookings.sort((a, b) => new Date(b.tripdate) - new Date(a.tripdate));

      // Aplicar paginação
      if (after) {
        const afterIndex = userBookings.findIndex(b => b.id === after);
        if (afterIndex !== -1) {
          userBookings = userBookings.slice(afterIndex + 1);
        }
      }

      userBookings = userBookings.slice(0, first);

      const result = {
        edges: userBookings.map(booking => ({
          node: {
            id: booking.id,
            passenger: { id: booking.passengerId },
            driver: booking.driverId ? { id: booking.driverId } : null,
            pickup: {
              latitude: parseFloat(booking.pickup?.latitude || 0),
              longitude: parseFloat(booking.pickup?.longitude || 0),
              address: booking.pickup?.address || ''
            },
            destination: {
              latitude: parseFloat(booking.destination?.latitude || 0),
              longitude: parseFloat(booking.destination?.longitude || 0),
              address: booking.destination?.address || ''
            },
            status: booking.status || 'PENDING',
            fare: parseFloat(booking.estimate || 0),
            distance: parseFloat(booking.distance || 0),
            duration: parseInt(booking.duration || 0),
            createdAt: new Date(booking.tripdate),
            updatedAt: booking.updatedAt ? new Date(booking.updatedAt) : new Date()
          },
          cursor: booking.id
        })),
        pageInfo: {
          hasNextPage: userBookings.length === first,
          hasPreviousPage: !!after,
          startCursor: userBookings[0]?.id,
          endCursor: userBookings[userBookings.length - 1]?.id
        },
        totalCount: userBookings.length
      };

      // Cache por 2 minutos
      this.cache.set(cacheKey, result);
      setTimeout(() => this.cache.delete(cacheKey), 2 * 60 * 1000);

      logStructured('info', `✅ ${userBookings.length} corridas encontradas no histórico`);
      return result;

    } catch (error) {
      logError(error, '❌ Erro ao buscar histórico de corridas:', { service: 'BookingResolver' });
      throw new Error('Erro ao buscar histórico de corridas');
    }
  }

  // Query para métricas de corrida específica
  async bookingMetrics(parent, { bookingId }, context) {
    await this.initialize();

    const cacheKey = `booking_metrics:${bookingId}`;
    if (this.cache.has(cacheKey)) {
      logStructured('info', `📊 Cache hit para bookingMetrics:${bookingId}`);
      return this.cache.get(cacheKey);
    }

    logStructured('info', `📊 Gerando métricas para corrida: ${bookingId}`);

    try {
      const booking = await this.bookingLoader.load(bookingId);

      if (!booking) {
        return null;
      }

      const result = {
        estimatedArrival: booking.estimatedArrival || null,
        actualArrival: booking.actualArrival || null,
        waitTime: booking.waitTime || 0,
        travelTime: booking.duration || 0,
        costBreakdown: {
          baseFare: booking.estimate * 0.3 || 0,
          distanceFare: booking.estimate * 0.5 || 0,
          timeFare: booking.estimate * 0.2 || 0,
          surgeMultiplier: booking.surgeMultiplier || 1.0,
          totalFare: booking.estimate || 0,
          commission: booking.estimate * 0.15 || 0,
          driverEarnings: booking.driverEarnings || booking.estimate * 0.85 || 0
        }
      };

      // Cache por 5 minutos
      this.cache.set(cacheKey, result);
      setTimeout(() => this.cache.delete(cacheKey), 5 * 60 * 1000);

      logStructured('info', `✅ Métricas geradas para corrida ${bookingId}`);
      return result;

    } catch (error) {
      logError(error, '❌ Erro ao gerar métricas da corrida:', { service: 'BookingResolver' });
      throw new Error('Erro ao gerar métricas da corrida');
    }
  }

  // Query para análise de custos da corrida
  async bookingCostAnalysis(parent, { bookingId }, context) {
    await this.initialize();

    const cacheKey = `booking_cost_analysis:${bookingId}`;
    if (this.cache.has(cacheKey)) {
      logStructured('info', `📊 Cache hit para bookingCostAnalysis:${bookingId}`);
      return this.cache.get(cacheKey);
    }

    logStructured('info', `📊 Gerando análise de custos para corrida: ${bookingId}`);

    try {
      const booking = await this.bookingLoader.load(bookingId);

      if (!booking) {
        return null;
      }

      const fare = booking.estimate || 0;
      const distance = booking.distance || 0;
      const duration = booking.duration || 0;

      // Calcular custos operacionais
      const costs = {
        mapsApi: 0.0020 * 2, // 2 chamadas por corrida
        geocoding: 0.0050 * 2, // origem e destino
        directionsApi: 0.0050 * 1, // 1 rota
        placesApi: 0.0017 * 1, // busca de lugares
        serverCosts: 0.0030,
        firebaseCosts: 0.0015 * 3, // 3 operações médias
        redisCosts: 0.0005 * 2, // 2 operações cache
        paymentProcessing: fare > 0 ? (fare * 0.039) + 0.39 : 0,
        fcmNotifications: 0, // FCM é gratuito até certo limite
        smsNotifications: booking.smsUsed ? 0.10 : 0,
        totalOperationalCosts: 0
      };

      costs.totalOperationalCosts =
        costs.mapsApi + costs.geocoding + costs.directionsApi + costs.placesApi +
        costs.serverCosts + costs.firebaseCosts + costs.redisCosts +
        costs.paymentProcessing + costs.fcmNotifications + costs.smsNotifications;

      const result = {
        totalCosts: costs.totalOperationalCosts,
        costBreakdown: costs,
        profitMargin: fare > 0 ? ((fare - costs.totalOperationalCosts) / fare) * 100 : 0,
        recommendations: this.generateCostRecommendations(costs, fare)
      };

      // Cache por 10 minutos
      this.cache.set(cacheKey, result);
      setTimeout(() => this.cache.delete(cacheKey), 10 * 60 * 1000);

      logStructured('info', `✅ Análise de custos gerada para corrida ${bookingId}: R$ ${costs.totalOperationalCosts.toFixed(2)}`);
      return result;

    } catch (error) {
      logError(error, '❌ Erro ao gerar análise de custos:', { service: 'BookingResolver' });
      throw new Error('Erro ao gerar análise de custos');
    }
  }

  // Query para rotas populares
  async popularRoutes(parent, { period = '30d', limit = 10, city }, context) {
    await this.initialize();

    const cacheKey = `popular_routes:${period}:${limit}:${city}`;
    if (this.cache.has(cacheKey)) {
      logStructured('info', '📊 Cache hit para popularRoutes');
      return this.cache.get(cacheKey);
    }

    logStructured('info', `📊 Buscando rotas populares: period=${period}, limit=${limit}, city=${city}`);

    try {
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

      // Buscar bookings do período
      const bookingsSnapshot = await this.db.ref('bookings')
        .orderByChild('tripdate')
        .startAt(startDate.toISOString())
        .endAt(now.toISOString())
        .once('value');

      const bookings = bookingsSnapshot.val() || {};
      const bookingArray = Object.keys(bookings).map(key => ({
        id: key,
        ...bookings[key]
      }));

      // Filtrar por cidade se especificado
      let filteredBookings = bookingArray;
      if (city) {
        filteredBookings = bookingArray.filter(booking =>
          booking.pickup?.address?.toLowerCase().includes(city.toLowerCase()) ||
          booking.destination?.address?.toLowerCase().includes(city.toLowerCase())
        );
      }

      // Calcular rotas populares
      const routeMap = new Map();

      filteredBookings.forEach(booking => {
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

      const result = Array.from(routeMap.values())
        .sort((a, b) => b.frequency - a.frequency)
        .slice(0, limit)
        .map(route => ({
          route: route.route,
          frequency: route.frequency,
          revenue: route.revenue,
          averageFare: route.revenue / route.frequency,
          distance: route.distance / route.frequency
        }));

      // Cache por 10 minutos
      this.cache.set(cacheKey, result);
      setTimeout(() => this.cache.delete(cacheKey), 10 * 60 * 1000);

      logStructured('info', `✅ ${result.length} rotas populares encontradas`);
      return result;

    } catch (error) {
      logError(error, '❌ Erro ao buscar rotas populares:', { service: 'BookingResolver' });
      throw new Error('Erro ao buscar rotas populares');
    }
  }

  // Resolver para relacionamentos
  async passenger(parent, args, context) {
    await this.initialize();

    const passenger = await this.userLoader.load(parent.passengerId);
    return passenger;
  }

  async driver(parent, args, context) {
    await this.initialize();

    if (!parent.driverId) return null;

    const driver = await this.userLoader.load(parent.driverId);
    return driver;
  }

  async route(parent, args, context) {
    await this.initialize();

    // Implementar busca de rota se necessário
    return {
      id: `route_${parent.id}`,
      pickup: parent.pickup,
      destination: parent.destination,
      distance: parent.distance,
      duration: parent.duration,
      polyline: null,
      waypoints: [],
      trafficInfo: {
        isHeavyTraffic: false,
        estimatedDelay: 0,
        alternativeRoutes: []
      }
    };
  }

  async payment(parent, args, context) {
    await this.initialize();

    // Implementar busca de pagamento se necessário
    return {
      id: `payment_${parent.id}`,
      amount: parent.fare,
      method: 'CREDIT_CARD',
      status: parent.status === 'PAID' ? 'COMPLETED' : 'PENDING',
      processedAt: parent.status === 'PAID' ? new Date() : null
    };
  }

  async reviews(parent, args, context) {
    await this.initialize();

    // Implementar busca de avaliações se necessário
    return [];
  }

  async metrics(parent, args, context) {
    await this.initialize();
    return await this.bookingMetrics(parent, { bookingId: parent.id }, context);
  }

  // Método auxiliar para gerar recomendações de custos
  generateCostRecommendations(costs, fare) {
    const recommendations = [];

    if (costs.paymentProcessing > fare * 0.05) {
      recommendations.push('Considere negociar taxas de processamento de pagamento');
    }

    if (costs.mapsApi > fare * 0.02) {
      recommendations.push('Otimize uso de APIs de mapas para reduzir custos');
    }

    if (costs.firebaseCosts > fare * 0.01) {
      recommendations.push('Implemente cache local para reduzir operações no Firebase');
    }

    if (costs.totalOperationalCosts > fare * 0.15) {
      recommendations.push('Custos operacionais altos - considere otimizações gerais');
    }

    return recommendations;
  }
}

module.exports = new BookingResolver();
