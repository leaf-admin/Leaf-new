// graphql/resolvers/UserResolver.js
// User Resolver com DataLoader - Resolve N+1 problem

const firebaseConfig = require('../../firebase-config');
const redisPool = require('../../utils/redis-pool');
const graphqlAuth = require('../../middleware/graphql-auth');
const OptimizedDataLoader = require('../../utils/optimized-dataloader');
const { logStructured, logError } = require('../../utils/logger');

class UserResolver {
  constructor() {
    this.db = null;
    this.redis = null;
    this.userLoader = null;
    this.bookingLoader = null;
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
    if (!this.userLoader) {
      this.userLoader = OptimizedDataLoader.createUserLoader(this.db);
    }

    if (!this.bookingLoader) {
      this.bookingLoader = OptimizedDataLoader.createUserBookingsLoader(this.db);
    }
  }

  // Query para buscar usuário por ID
  async user(parent, { id }, context) {
    await this.initialize();

    const cacheKey = `user:${id}`;
    if (this.cache.has(cacheKey)) {
      logStructured('info', `📊 Cache hit para user:${id}`);
      return this.cache.get(cacheKey);
    }

    const user = await this.userLoader.load(id);

    if (user) {
      // Cache por 5 minutos
      this.cache.set(cacheKey, user);
      setTimeout(() => this.cache.delete(cacheKey), 5 * 60 * 1000);
    }

    return user;
  }

  // Query para listar usuários com filtros
  async users(parent, {
    first = 50,
    after,
    userType,
    status,
    searchTerm,
    sortBy = 'createdAt',
    sortOrder = 'DESC'
  }, context) {
    // Verificar autenticação e permissões
    if (!context.isAuthenticated) {
      throw new Error('Usuário não autenticado');
    }

    if (!graphqlAuth.hasPermission(context.permissions, 'read:all_users')) {
      throw new Error('Permissão negada: leitura de usuários');
    }

    await this.initialize();

    const cacheKey = `users:${first}:${after}:${userType}:${status}:${searchTerm}:${sortBy}:${sortOrder}`;
    if (this.cache.has(cacheKey)) {
      logStructured('info', '📊 Cache hit para users');
      return this.cache.get(cacheKey);
    }

    logStructured('info', `📊 Buscando usuários: first=${first}, userType=${userType}, status=${status}`);

    try {
      // Query otimizada com filtros
      let usersRef = this.db.ref('users');

      if (userType) {
        usersRef = usersRef.orderByChild('userType').equalTo(userType);
      } else if (status) {
        usersRef = usersRef.orderByChild('status').equalTo(status);
      } else {
        // Se não houver filtro, forçar ordenação por data de criação para paginação
        usersRef = usersRef.orderByChild('createdAt');
      }

      // Aplicar limite de segurança (máximo 100 por requisição)
      const safeLimit = Math.min(first || 50, 100);
      usersRef = usersRef.limitToLast(safeLimit);

      const snapshot = await usersRef.once('value');
      const users = snapshot.val() || {};

      // Converter para array e aplicar filtros adicionais
      let userArray = Object.keys(users).map(key => ({
        id: key,
        ...users[key]
      }));

      // Filtro por termo de busca
      if (searchTerm) {
        const searchLower = searchTerm.toLowerCase();
        userArray = userArray.filter(user =>
          user.name?.toLowerCase().includes(searchLower) ||
          user.email?.toLowerCase().includes(searchLower) ||
          user.phone?.includes(searchTerm)
        );
      }

      // Ordenação
      userArray.sort((a, b) => {
        const aValue = a[sortBy] || '';
        const bValue = b[sortBy] || '';

        if (sortOrder === 'ASC') {
          return aValue > bValue ? 1 : -1;
        } else {
          return aValue < bValue ? 1 : -1;
        }
      });

      const result = {
        edges: userArray.map(user => ({
          node: {
            id: user.id,
            name: user.name || 'Usuário',
            email: user.email || '',
            phone: user.phone || '',
            userType: user.userType || 'CUSTOMER',
            status: user.status || 'ACTIVE',
            rating: parseFloat(user.rating || 0),
            totalTrips: parseInt(user.totalTrips || 0),
            createdAt: user.createdAt ? new Date(user.createdAt) : new Date(),
            updatedAt: user.updatedAt ? new Date(user.updatedAt) : new Date()
          },
          cursor: user.id
        })),
        pageInfo: {
          hasNextPage: userArray.length === first,
          hasPreviousPage: !!after,
          startCursor: userArray[0]?.id,
          endCursor: userArray[userArray.length - 1]?.id
        },
        totalCount: userArray.length
      };

      // Cache por 2 minutos
      this.cache.set(cacheKey, result);
      setTimeout(() => this.cache.delete(cacheKey), 2 * 60 * 1000);

      logStructured('info', `✅ ${userArray.length} usuários encontrados`);
      return result;

    } catch (error) {
      logError(error, '❌ Erro ao buscar usuários:', { service: 'UserResolver' });
      throw new Error('Erro ao buscar usuários');
    }
  }

  // Query para buscar usuários próximos
  async nearbyUsers(parent, { location, radius = 5000, userType, limit = 10 }, context) {
    await this.initialize();

    const cacheKey = `nearby_users:${location.latitude}:${location.longitude}:${radius}:${userType}:${limit}`;
    if (this.cache.has(cacheKey)) {
      logStructured('info', '📊 Cache hit para nearbyUsers');
      return this.cache.get(cacheKey);
    }

    logStructured('info', `📊 Buscando usuários próximos: lat=${location.latitude}, lng=${location.longitude}, radius=${radius}`);

    try {
      // Buscar localizações do Redis
      const locationsData = await this.redis.hgetall('user_locations');

      const nearbyUsers = [];
      const userLat = parseFloat(location.latitude);
      const userLng = parseFloat(location.longitude);
      const maxRadius = parseFloat(radius);

      for (const [userId, userDataStr] of Object.entries(locationsData)) {
        try {
          const userData = JSON.parse(userDataStr);

          // Filtrar por tipo de usuário se especificado
          if (userType && userData.userType !== userType) {
            continue;
          }

          // Calcular distância usando fórmula de Haversine (aproximada)
          const userLat2 = parseFloat(userData.latitude);
          const userLng2 = parseFloat(userData.longitude);

          const distance = this.getDistance(userLat, userLng, userLat2, userLng2);

          if (distance <= maxRadius) {
            nearbyUsers.push({
              id: userId,
              name: userData.name || 'Usuário',
              email: userData.email || '',
              phone: userData.phone || '',
              userType: userData.userType || 'CUSTOMER',
              status: userData.status || 'ACTIVE',
              rating: parseFloat(userData.rating || 0),
              totalTrips: parseInt(userData.totalTrips || 0),
              createdAt: userData.createdAt ? new Date(userData.createdAt) : new Date(),
              updatedAt: userData.updatedAt ? new Date(userData.updatedAt) : new Date(),
              location: {
                latitude: userLat2,
                longitude: userLng2,
                address: userData.address || '',
                accuracy: userData.accuracy || 0,
                timestamp: userData.timestamp ? new Date(userData.timestamp) : new Date()
              }
            });
          }
        } catch (parseError) {
          logStructured('warn', `⚠️ Erro ao parsear dados do usuário ${userId}:`, parseError.message);
        }
      }

      // Ordenar por distância e limitar resultados
      nearbyUsers.sort((a, b) => {
        const distA = this.getDistance(userLat, userLng, a.location.latitude, a.location.longitude);
        const distB = this.getDistance(userLat, userLng, b.location.latitude, b.location.longitude);
        return distA - distB;
      });

      const result = nearbyUsers.slice(0, limit);

      // Cache por 30 segundos (localizações mudam frequentemente)
      this.cache.set(cacheKey, result);
      setTimeout(() => this.cache.delete(cacheKey), 30 * 1000);

      logStructured('info', `✅ ${result.length} usuários próximos encontrados`);
      return result;

    } catch (error) {
      logError(error, '❌ Erro ao buscar usuários próximos:', { service: 'UserResolver' });
      throw new Error('Erro ao buscar usuários próximos');
    }
  }

  // Query para métricas de usuário específico
  async userMetrics(parent, { userId, period = '30d' }, context) {
    await this.initialize();

    const cacheKey = `user_metrics:${userId}:${period}`;
    if (this.cache.has(cacheKey)) {
      logStructured('info', `📊 Cache hit para userMetrics:${userId}`);
      return this.cache.get(cacheKey);
    }

    logStructured('info', `📊 Gerando métricas para usuário: ${userId}, período: ${period}`);

    try {
      // Buscar bookings do usuário
      const bookingsSnapshot = await this.db.ref('bookings').once('value');
      const bookings = bookingsSnapshot.val() || {};

      // Filtrar bookings do usuário
      const userBookings = Object.keys(bookings)
        .filter(key => bookings[key].passengerId === userId)
        .map(key => ({
          id: key,
          ...bookings[key]
        }));

      // Calcular métricas
      const totalTrips = userBookings.length;
      const completedTrips = userBookings.filter(b => b.status === 'COMPLETE' || b.status === 'PAID').length;
      const cancelledTrips = userBookings.filter(b => b.status === 'CANCELLED').length;

      const totalSpent = userBookings.reduce((sum, booking) =>
        sum + parseFloat(booking.estimate || 0), 0
      );

      const totalEarned = userBookings.reduce((sum, booking) => {
        if (booking.userType === 'DRIVER') {
          return sum + parseFloat(booking.driverEarnings || 0);
        }
        return sum;
      }, 0);

      const lastTripDate = userBookings.length > 0
        ? new Date(Math.max(...userBookings.map(b => new Date(b.tripdate).getTime())))
        : null;

      const result = {
        totalTrips,
        completedTrips,
        cancelledTrips,
        averageRating: 0, // Implementar cálculo de rating
        totalSpent,
        totalEarned,
        lastTripDate
      };

      // Cache por 5 minutos
      this.cache.set(cacheKey, result);
      setTimeout(() => this.cache.delete(cacheKey), 5 * 60 * 1000);

      logStructured('info', `✅ Métricas geradas para usuário ${userId}: ${totalTrips} corridas`);
      return result;

    } catch (error) {
      logError(error, '❌ Erro ao gerar métricas do usuário:', { service: 'UserResolver' });
      throw new Error('Erro ao gerar métricas do usuário');
    }
  }

  // Query para histórico de corridas do usuário
  async userBookings(parent, { userId, first = 20, after, status, dateRange }, context) {
    await this.initialize();

    const cacheKey = `user_bookings:${userId}:${first}:${after}:${status}:${JSON.stringify(dateRange)}`;
    if (this.cache.has(cacheKey)) {
      logStructured('info', `📊 Cache hit para userBookings:${userId}`);
      return this.cache.get(cacheKey);
    }

    logStructured('info', `📊 Buscando histórico de corridas para usuário: ${userId}`);

    try {
      // Buscar bookings do usuário
      const bookingsSnapshot = await this.db.ref('bookings').once('value');
      const bookings = bookingsSnapshot.val() || {};

      // Filtrar bookings do usuário
      let userBookings = Object.keys(bookings)
        .filter(key => bookings[key].passengerId === userId)
        .map(key => ({
          id: key,
          ...bookings[key]
        }));

      // Aplicar filtros
      if (status) {
        userBookings = userBookings.filter(b => b.status === status);
      }

      if (dateRange) {
        const startDate = new Date(dateRange.startDate);
        const endDate = new Date(dateRange.endDate);
        userBookings = userBookings.filter(b => {
          const tripDate = new Date(b.tripdate);
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

      logStructured('info', `✅ ${userBookings.length} corridas encontradas para usuário ${userId}`);
      return result;

    } catch (error) {
      logError(error, '❌ Erro ao buscar histórico de corridas:', { service: 'UserResolver' });
      throw new Error('Erro ao buscar histórico de corridas');
    }
  }

  // Resolver para relacionamentos
  async bookings(parent, { first = 20, after, status, dateRange }, context) {
    await this.initialize();
    return await this.bookingLoader.load(parent.id);
  }

  async vehicle(parent, args, context) {
    await this.initialize();

    if (parent.userType !== 'DRIVER') {
      return null;
    }

    // Buscar veículo do motorista
    const vehiclesSnapshot = await this.db.ref('cars').once('value');
    const vehicles = vehiclesSnapshot.val() || {};

    const userVehicle = Object.keys(vehicles).find(key =>
      vehicles[key].driverId === parent.id
    );

    if (!userVehicle) {
      return null;
    }

    const vehicleData = vehicles[userVehicle];
    return {
      id: userVehicle,
      model: vehicleData.model || '',
      brand: vehicleData.brand || '',
      year: parseInt(vehicleData.year || 0),
      color: vehicleData.color || '',
      plate: vehicleData.plate || '',
      capacity: parseInt(vehicleData.capacity || 4),
      vehicleType: vehicleData.vehicleType || 'SEDAN',
      isActive: vehicleData.isActive !== false
    };
  }

  async location(parent, args, context) {
    await this.initialize();

    // Buscar localização atual do usuário
    const locationData = await this.redis.hget('user_locations', parent.id);

    if (!locationData) {
      return null;
    }

    try {
      const location = JSON.parse(locationData);
      return {
        latitude: parseFloat(location.latitude || 0),
        longitude: parseFloat(location.longitude || 0),
        address: location.address || '',
        city: location.city || '',
        state: location.state || '',
        country: location.country || 'Brasil',
        postalCode: location.postalCode || '',
        accuracy: parseFloat(location.accuracy || 0),
        timestamp: location.timestamp ? new Date(location.timestamp) : new Date()
      };
    } catch (error) {
      logStructured('warn', `⚠️ Erro ao parsear localização do usuário ${parent.id}:`, error.message);
      return null;
    }
  }

  async metrics(parent, { period = '30d' }, context) {
    await this.initialize();
    return await this.userMetrics(parent, { userId: parent.id, period }, context);
  }

  // Método auxiliar para calcular distância
  getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Raio da Terra em km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c * 1000; // Retorna em metros
  }
}

module.exports = new UserResolver();
