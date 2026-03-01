// graphql/resolvers/DriverResolver.js
// Driver Resolver com Redis GEO - Otimizado para busca de motoristas

const firebaseConfig = require('../../firebase-config');
const redisPool = require('../../utils/redis-pool');
const advancedCache = require('../../utils/advanced-cache');
const OptimizedDataLoader = require('../../utils/optimized-dataloader');
const { logStructured, logError } = require('../../utils/logger');

class DriverResolver {
  constructor() {
    this.db = null;
    this.redis = null;
    this.driverLoader = null;
    this.vehicleLoader = null;
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
    if (!this.driverLoader) {
      this.driverLoader = OptimizedDataLoader.createDriverLoader(this.db);
    }

    if (!this.vehicleLoader) {
      this.vehicleLoader = OptimizedDataLoader.createVehicleLoader(this.db);
    }
  }

  // Query para buscar motorista por ID
  async driver(parent, { id }, context) {
    await this.initialize();

    const cacheKey = `driver:${id}`;
    if (this.cache.has(cacheKey)) {
      logStructured('info', `📊 Cache hit para driver:${id}`);
      return this.cache.get(cacheKey);
    }

    const driver = await this.driverLoader.load(id);

    if (driver) {
      // Cache por 2 minutos
      this.cache.set(cacheKey, driver);
      setTimeout(() => this.cache.delete(cacheKey), 2 * 60 * 1000);
    }

    return driver;
  }

  // Query para listar motoristas com filtros
  async drivers(parent, {
    first = 50,
    after,
    status,
    isOnline,
    sortBy = 'rating',
    sortOrder = 'DESC'
  }, context) {
    await this.initialize();

    const cacheKey = `drivers:${first}:${after}:${status}:${isOnline}:${sortBy}:${sortOrder}`;
    if (this.cache.has(cacheKey)) {
      logStructured('info', '📊 Cache hit para drivers');
      return this.cache.get(cacheKey);
    }

    logStructured('info', `📊 Buscando motoristas: first=${first}, status=${status}, isOnline=${isOnline}`);

    try {
      // Query otimizada com filtros
      let driversRef = this.db.ref('users');

      // Filtrar apenas motoristas
      driversRef = driversRef.orderByChild('userType').equalTo('DRIVER');

      // Aplicar limite de segurança (máximo 100 por requisição)
      const safeLimit = Math.min(first || 50, 100);
      driversRef = driversRef.limitToLast(safeLimit);

      if (status) {
        // Fallback: se houver status, o Firebase Database realtime de RTDB não aceita múltiplos `.orderByChild()`.
        // A filtragem será em memória, mas o limitToLast garante tamanho seguro.
        // O ideal é usar isOnline (boolean) via Redis/geo.
      }

      // Aplicar limite
      // driversRef = driversRef.limitToFirst(first); // This line is removed as per instruction

      const snapshot = await driversRef.once('value');
      const drivers = snapshot.val() || {};

      // Converter para array e aplicar filtros adicionais
      let driverArray = Object.keys(drivers).map(key => ({
        id: key,
        ...drivers[key]
      }));

      // Filtro por status online
      if (isOnline !== undefined) {
        driverArray = driverArray.filter(driver => driver.isOnline === isOnline);
      }

      // Ordenação
      driverArray.sort((a, b) => {
        const aValue = a[sortBy] || 0;
        const bValue = b[sortBy] || 0;

        if (sortOrder === 'ASC') {
          return aValue > bValue ? 1 : -1;
        } else {
          return aValue < bValue ? 1 : -1;
        }
      });

      const result = {
        edges: driverArray.map(driver => ({
          node: {
            id: driver.id,
            name: driver.name || 'Motorista',
            email: driver.email || '',
            phone: driver.phone || '',
            status: driver.status || 'OFFLINE',
            rating: parseFloat(driver.rating || 0),
            totalTrips: parseInt(driver.totalTrips || 0),
            isOnline: driver.isOnline || false,
            createdAt: driver.createdAt ? new Date(driver.createdAt) : new Date(),
            updatedAt: driver.updatedAt ? new Date(driver.updatedAt) : new Date()
          },
          cursor: driver.id
        })),
        pageInfo: {
          hasNextPage: driverArray.length === first,
          hasPreviousPage: !!after,
          startCursor: driverArray[0]?.id,
          endCursor: driverArray[driverArray.length - 1]?.id
        },
        totalCount: driverArray.length
      };

      // Cache por 1 minuto
      this.cache.set(cacheKey, result);
      setTimeout(() => this.cache.delete(cacheKey), 1 * 60 * 1000);

      logStructured('info', `✅ ${driverArray.length} motoristas encontrados`);
      return result;

    } catch (error) {
      logError(error, '❌ Erro ao buscar motoristas:', { service: 'DriverResolver' });
      throw new Error('Erro ao buscar motoristas');
    }
  }

  // Query OTIMIZADA para buscar motoristas próximos usando Redis GEO com cache espacial
  async nearbyDrivers(parent, { location, radius = 5000, limit = 10, vehicleType }, context) {
    await this.initialize();

    try {
      logStructured('info', `📊 Buscando motoristas próximos: lat=${location.latitude}, lng=${location.longitude}, radius=${radius}m`);

      // Usar cache espacial avançado
      const cachedData = await advancedCache.getSpatialCache('nearbyDrivers', location, radius);

      if (cachedData) {
        logStructured('info', `✅ ${cachedData.length} motoristas próximos encontrados (cache)`);
        return cachedData.slice(0, limit);
      }

      // Usar Redis GEO para busca otimizada
      const nearbyDriverIds = await this.redis.georadius(
        'driver_locations',
        parseFloat(location.longitude),
        parseFloat(location.latitude),
        parseFloat(radius) / 1000, // Converter metros para km
        'km',
        'WITHCOORD',
        'COUNT',
        limit * 2 // Buscar mais para filtrar por tipo de veículo
      );

      if (!nearbyDriverIds || nearbyDriverIds.length === 0) {
        logStructured('info', '✅ 0 motoristas próximos encontrados');
        await advancedCache.setSpatialCache('nearbyDrivers', location, radius, []);
        return [];
      }

      // Buscar dados dos motoristas
      const driverIds = nearbyDriverIds.map(item => item[0]);
      const drivers = await this.driverLoader.loadMany(driverIds);

      // Filtrar motoristas válidos e online
      const validDrivers = drivers.filter(driver =>
        driver && driver.isOnline && driver.status === 'AVAILABLE'
      );

      // Buscar veículos dos motoristas
      const vehicles = await this.vehicleLoader.loadMany(validDrivers.map(d => d.id));

      // Filtrar por tipo de veículo se especificado
      let filteredDrivers = validDrivers;
      if (vehicleType) {
        filteredDrivers = validDrivers.filter((driver, index) => {
          const vehicle = vehicles[index];
          return vehicle && vehicle.vehicleType === vehicleType;
        });
      }

      // Combinar dados do motorista com localização e veículo
      const result = filteredDrivers.slice(0, limit).map((driver, index) => {
        const vehicle = vehicles[index];
        const locationData = nearbyDriverIds.find(item => item[0] === driver.id);

        return {
          id: driver.id,
          name: driver.name,
          email: driver.email,
          phone: driver.phone,
          status: driver.status,
          rating: driver.rating,
          totalTrips: driver.totalTrips,
          isOnline: driver.isOnline,
          createdAt: driver.createdAt,
          updatedAt: driver.updatedAt,
          vehicle: vehicle ? {
            id: vehicle.id,
            model: vehicle.model,
            brand: vehicle.brand,
            year: vehicle.year,
            color: vehicle.color,
            plate: vehicle.plate,
            capacity: vehicle.capacity,
            vehicleType: vehicle.vehicleType,
            isActive: vehicle.isActive
          } : null,
          location: {
            latitude: parseFloat(locationData[1][1]),
            longitude: parseFloat(locationData[1][0]),
            address: '', // Implementar busca de endereço se necessário
            accuracy: 0,
            timestamp: new Date()
          }
        };
      });

      // Armazenar no cache espacial
      await advancedCache.setSpatialCache('nearbyDrivers', location, radius, result);

      logStructured('info', `✅ ${result.length} motoristas próximos encontrados`);
      return result;

    } catch (error) {
      logStructured('error', `❌ Erro ao buscar motoristas próximos: ${error.message}`);
      throw new Error('Erro ao buscar motoristas próximos');
    }
  }

  // Query para motoristas ativos no mapa
  async activeDrivers(parent, { bounds, status = 'AVAILABLE' }, context) {
    await this.initialize();

    const cacheKey = `active_drivers:${JSON.stringify(bounds)}:${status}`;
    if (this.cache.has(cacheKey)) {
      logStructured('info', '📊 Cache hit para activeDrivers');
      return this.cache.get(cacheKey);
    }

    logStructured('info', `📊 Buscando motoristas ativos no mapa: status=${status}`);

    try {
      // Buscar motoristas online
      const onlineDriversSnapshot = await this.db.ref('users')
        .orderByChild('isOnline')
        .equalTo(true)
        .once('value');

      const onlineDrivers = onlineDriversSnapshot.val() || {};
      const driverIds = Object.keys(onlineDrivers).filter(id =>
        onlineDrivers[id].userType === 'DRIVER' &&
        onlineDrivers[id].status === status
      );

      if (driverIds.length === 0) {
        return [];
      }

      // Buscar localizações dos motoristas
      const drivers = await this.driverLoader.loadMany(driverIds);
      const vehicles = await this.vehicleLoader.loadMany(driverIds);

      const result = drivers.filter(driver => driver).map((driver, index) => {
        const vehicle = vehicles[index];

        return {
          id: driver.id,
          name: driver.name,
          email: driver.email,
          phone: driver.phone,
          status: driver.status,
          rating: driver.rating,
          totalTrips: driver.totalTrips,
          isOnline: driver.isOnline,
          createdAt: driver.createdAt,
          updatedAt: driver.updatedAt,
          vehicle: vehicle ? {
            id: vehicle.id,
            model: vehicle.model,
            brand: vehicle.brand,
            year: vehicle.year,
            color: vehicle.color,
            plate: vehicle.plate,
            capacity: vehicle.capacity,
            vehicleType: vehicle.vehicleType,
            isActive: vehicle.isActive
          } : null
        };
      });

      // Cache por 15 segundos
      this.cache.set(cacheKey, result);
      setTimeout(() => this.cache.delete(cacheKey), 15 * 1000);

      logStructured('info', `✅ ${result.length} motoristas ativos encontrados`);
      return result;

    } catch (error) {
      logError(error, '❌ Erro ao buscar motoristas ativos:', { service: 'DriverResolver' });
      throw new Error('Erro ao buscar motoristas ativos');
    }
  }

  // Query para métricas de motorista específico
  async driverMetrics(parent, { driverId, period = '30d' }, context) {
    await this.initialize();

    const cacheKey = `driver_metrics:${driverId}:${period}`;
    if (this.cache.has(cacheKey)) {
      logStructured('info', `📊 Cache hit para driverMetrics:${driverId}`);
      return this.cache.get(cacheKey);
    }

    logStructured('info', `📊 Gerando métricas para motorista: ${driverId}, período: ${period}`);

    try {
      // Buscar bookings do motorista
      const bookingsSnapshot = await this.db.ref('bookings').once('value');
      const bookings = bookingsSnapshot.val() || {};

      // Filtrar bookings do motorista
      const driverBookings = Object.keys(bookings)
        .filter(key => bookings[key].driverId === driverId)
        .map(key => ({
          id: key,
          ...bookings[key]
        }));

      // Calcular métricas
      const totalTrips = driverBookings.length;
      const completedTrips = driverBookings.filter(b => b.status === 'COMPLETE' || b.status === 'PAID').length;
      const cancelledTrips = driverBookings.filter(b => b.status === 'CANCELLED').length;

      const totalEarnings = driverBookings.reduce((sum, booking) =>
        sum + parseFloat(booking.driverEarnings || booking.estimate || 0), 0
      );

      const todayEarnings = driverBookings
        .filter(b => {
          const today = new Date();
          const tripDate = new Date(b.tripdate);
          return tripDate.toDateString() === today.toDateString();
        })
        .reduce((sum, booking) => sum + parseFloat(booking.driverEarnings || booking.estimate || 0), 0);

      const weeklyEarnings = driverBookings
        .filter(b => {
          const weekAgo = new Date();
          weekAgo.setDate(weekAgo.getDate() - 7);
          return new Date(b.tripdate) >= weekAgo;
        })
        .reduce((sum, booking) => sum + parseFloat(booking.driverEarnings || booking.estimate || 0), 0);

      const monthlyEarnings = driverBookings
        .filter(b => {
          const monthAgo = new Date();
          monthAgo.setMonth(monthAgo.getMonth() - 1);
          return new Date(b.tripdate) >= monthAgo;
        })
        .reduce((sum, booking) => sum + parseFloat(booking.driverEarnings || booking.estimate || 0), 0);

      const acceptanceRate = totalTrips > 0 ? (completedTrips / totalTrips) * 100 : 0;
      const completionRate = totalTrips > 0 ? (completedTrips / totalTrips) * 100 : 0;

      const lastTripDate = driverBookings.length > 0
        ? new Date(Math.max(...driverBookings.map(b => new Date(b.tripdate).getTime())))
        : null;

      const result = {
        totalTrips,
        completedTrips,
        cancelledTrips,
        averageRating: 0, // Implementar cálculo de rating
        totalEarnings,
        todayEarnings,
        weeklyEarnings,
        monthlyEarnings,
        acceptanceRate,
        completionRate,
        lastTripDate
      };

      // Cache por 5 minutos
      this.cache.set(cacheKey, result);
      setTimeout(() => this.cache.delete(cacheKey), 5 * 60 * 1000);

      logStructured('info', `✅ Métricas geradas para motorista ${driverId}: ${totalTrips} corridas, R$ ${totalEarnings.toFixed(2)}`);
      return result;

    } catch (error) {
      logError(error, '❌ Erro ao gerar métricas do motorista:', { service: 'DriverResolver' });
      throw new Error('Erro ao gerar métricas do motorista');
    }
  }

  // Query para histórico de corridas do motorista
  async driverBookings(parent, { driverId, first = 20, after, status, dateRange }, context) {
    await this.initialize();

    const cacheKey = `driver_bookings:${driverId}:${first}:${after}:${status}:${JSON.stringify(dateRange)}`;
    if (this.cache.has(cacheKey)) {
      logStructured('info', `📊 Cache hit para driverBookings:${driverId}`);
      return this.cache.get(cacheKey);
    }

    logStructured('info', `📊 Buscando histórico de corridas para motorista: ${driverId}`);

    try {
      // Buscar bookings do motorista
      const bookingsSnapshot = await this.db.ref('bookings').once('value');
      const bookings = bookingsSnapshot.val() || {};

      // Filtrar bookings do motorista
      let driverBookings = Object.keys(bookings)
        .filter(key => bookings[key].driverId === driverId)
        .map(key => ({
          id: key,
          ...bookings[key]
        }));

      // Aplicar filtros
      if (status) {
        driverBookings = driverBookings.filter(b => b.status === status);
      }

      if (dateRange) {
        const startDate = new Date(dateRange.startDate);
        const endDate = new Date(dateRange.endDate);
        driverBookings = driverBookings.filter(b => {
          const tripDate = new Date(b.tripdate);
          return tripDate >= startDate && tripDate <= endDate;
        });
      }

      // Ordenar por data (mais recente primeiro)
      driverBookings.sort((a, b) => new Date(b.tripdate) - new Date(a.tripdate));

      // Aplicar paginação
      if (after) {
        const afterIndex = driverBookings.findIndex(b => b.id === after);
        if (afterIndex !== -1) {
          driverBookings = driverBookings.slice(afterIndex + 1);
        }
      }

      driverBookings = driverBookings.slice(0, first);

      const result = {
        edges: driverBookings.map(booking => ({
          node: {
            id: booking.id,
            passenger: { id: booking.passengerId },
            driver: { id: booking.driverId },
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
          hasNextPage: driverBookings.length === first,
          hasPreviousPage: !!after,
          startCursor: driverBookings[0]?.id,
          endCursor: driverBookings[driverBookings.length - 1]?.id
        },
        totalCount: driverBookings.length
      };

      // Cache por 2 minutos
      this.cache.set(cacheKey, result);
      setTimeout(() => this.cache.delete(cacheKey), 2 * 60 * 1000);

      logStructured('info', `✅ ${driverBookings.length} corridas encontradas para motorista ${driverId}`);
      return result;

    } catch (error) {
      logError(error, '❌ Erro ao buscar histórico de corridas:', { service: 'DriverResolver' });
      throw new Error('Erro ao buscar histórico de corridas');
    }
  }

  // Query para status do motorista em tempo real
  async driverStatus(parent, { driverId }, context) {
    await this.initialize();

    const cacheKey = `driver_status:${driverId}`;
    if (this.cache.has(cacheKey)) {
      logStructured('info', `📊 Cache hit para driverStatus:${driverId}`);
      return this.cache.get(cacheKey);
    }

    logStructured('info', `📊 Buscando status do motorista: ${driverId}`);

    try {
      const driverSnapshot = await this.db.ref(`users/${driverId}`).once('value');
      const driverData = driverSnapshot.val();

      if (!driverData || driverData.userType !== 'DRIVER') {
        return null;
      }

      const status = driverData.status || 'OFFLINE';

      // Cache por 30 segundos
      this.cache.set(cacheKey, status);
      setTimeout(() => this.cache.delete(cacheKey), 30 * 1000);

      logStructured('info', `✅ Status do motorista ${driverId}: ${status}`);
      return status;

    } catch (error) {
      logError(error, '❌ Erro ao buscar status do motorista:', { service: 'DriverResolver' });
      throw new Error('Erro ao buscar status do motorista');
    }
  }

  // Resolver para relacionamentos
  async vehicle(parent, args, context) {
    await this.initialize();

    const vehicle = await this.vehicleLoader.load(parent.id);
    return vehicle;
  }

  async location(parent, args, context) {
    await this.initialize();

    // Buscar localização atual do motorista
    const locationData = await this.redis.hget('driver_locations', parent.id);

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
      logStructured('warn', `⚠️ Erro ao parsear localização do motorista ${parent.id}:`, error.message);
      return null;
    }
  }

  async bookings(parent, { first = 20, after, status, dateRange }, context) {
    await this.initialize();
    return await this.driverBookings(parent, { driverId: parent.id, first, after, status, dateRange }, context);
  }

  async metrics(parent, { period = '30d' }, context) {
    await this.initialize();
    return await this.driverMetrics(parent, { driverId: parent.id, period }, context);
  }
}

module.exports = new DriverResolver();
