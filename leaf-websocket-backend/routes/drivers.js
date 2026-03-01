const express = require('express');
const router = express.Router();
const redisPool = require('../utils/redis-pool');
const driverLockManager = require('../services/driver-lock-manager');
const { logger } = require('../utils/logger');

// Firebase integration
let firebaseConfig = null;
try {
  firebaseConfig = require('../firebase-config');
} catch (e) {
  logStructured('warn', '⚠️ Firebase config não encontrado', { service: 'drivers-routes' });
}

// Middleware para verificar se Firebase está configurado
const requireFirebase = (req, res, next) => {
  if (!firebaseConfig) {
    return res.status(500).json({
      error: 'Firebase não configurado',
      message: 'Sistema de aprovação indisponível'
    });
  }
  next();
};

// 🚗 DRIVER APPROVAL APIs

// GET /api/drivers/applications - Listar aplicações de motoristas
router.get('/api/drivers/applications', requireFirebase, async (req, res) => {
  try {
    const { page = 1, limit = 20, status = 'all', search = '' } = req.query;

    logStructured('info', '📋 Buscando aplicações de motoristas:', { page, limit, status, search }, { service: 'drivers-routes' });

    const db = firebaseConfig.getRealtimeDB();
    const storage = firebaseConfig.getStorage();

    // Buscar usuários do Firebase
    const usersSnapshot = await db.ref('users').once('value');
    const users = usersSnapshot.val() || {};

    // Filtrar apenas motoristas
    let driverApplications = Object.keys(users)
      .map(uid => ({ uid, ...users[uid] }))
      .filter(user => user.usertype === 'driver' || user.profileSelection?.userType === 'driver');

    // Aplicar filtros
    if (status !== 'all') {
      driverApplications = driverApplications.filter(driver => {
        if (status === 'pending') return !driver.isApproved && !driver.isRejected;
        if (status === 'approved') return driver.isApproved === true;
        if (status === 'rejected') return driver.isRejected === true;
        if (status === 'analyzing') return driver.documents && Object.values(driver.documents).some(doc => doc.status === 'analyzing');
        return true;
      });
    }

    // Aplicar busca
    if (search) {
      const searchLower = search.toLowerCase();
      driverApplications = driverApplications.filter(driver =>
        (driver.name && driver.name.toLowerCase().includes(searchLower)) ||
        (driver.email && driver.email.toLowerCase().includes(searchLower)) ||
        (driver.phone && driver.phone.toLowerCase().includes(searchLower)) ||
        (driver.cpf && driver.cpf.includes(search))
      );
    }

    // Paginação
    const total = driverApplications.length;
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + parseInt(limit);
    const paginatedApplications = driverApplications.slice(startIndex, endIndex);

    // Enriquecer com dados de documentos
    const enrichedApplications = await Promise.all(
      paginatedApplications.map(async (driver) => {
        try {
          // Buscar documentos do usuário
          const documentsSnapshot = await db.ref(`users/${driver.uid}/documents`).once('value');
          const documents = documentsSnapshot.val() || {};

          // Buscar dados do veículo
          const vehicleSnapshot = await db.ref(`users/${driver.uid}/vehicles/current`).once('value');
          const vehicle = vehicleSnapshot.val() || {};

          // Determinar status da aplicação
          let applicationStatus = 'pending';
          if (driver.isApproved === true) applicationStatus = 'approved';
          else if (driver.isRejected === true) applicationStatus = 'rejected';
          else if (Object.values(documents).some(doc => doc.status === 'analyzing')) applicationStatus = 'in_review';

          // Calcular score baseado na completude dos dados
          let score = 0;
          if (driver.name) score += 20;
          if (driver.email) score += 15;
          if (driver.phone) score += 15;
          if (driver.cpf) score += 20;
          if (documents.cnh) score += 15;
          if (documents.residence) score += 15;

          return {
            id: driver.uid,
            driver: {
              id: driver.uid,
              name: driver.name || driver.displayName || 'Nome não informado',
              email: driver.email || 'Email não informado',
              phone: driver.phone || 'Telefone não informado',
              cpf: driver.cpf || 'CPF não informado',
              birthDate: driver.dateOfBirth || '1990-01-01',
              address: {
                street: driver.address?.street || 'Endereço não informado',
                city: driver.city || 'Cidade não informada',
                state: driver.state || 'Estado não informado',
                zipCode: driver.zipCode || 'CEP não informado'
              },
              profilePhoto: driver.profilePhoto || undefined
            },
            vehicle: {
              id: vehicle.id || 'vehicle_1',
              brand: vehicle.brand || 'Marca não informada',
              model: vehicle.model || 'Modelo não informado',
              year: parseInt(vehicle.year) || 2020,
              color: vehicle.color || 'Cor não informada',
              plate: vehicle.plate || 'Placa não informada',
              category: vehicle.category || 'economy',
              features: {
                airConditioning: vehicle.features?.airConditioning || false,
                doors: vehicle.features?.doors || 4,
                capacity: vehicle.features?.capacity || 5
              },
              documents: vehicle.documents || []
            },
            documents: Object.keys(documents).map(docType => ({
              id: `${driver.uid}_${docType}`,
              type: docType,
              name: `${docType.toUpperCase()} - ${driver.name || 'Motorista'}`,
              url: documents[docType].fileUrl || documents[docType].url || '',
              uploadDate: documents[docType].uploadedAt || documents[docType].uploadDate || new Date().toISOString().split('T')[0],
              status: documents[docType].status || 'pending',
              rejectionReason: documents[docType].rejectionReason
            })),
            status: applicationStatus,
            applicationDate: driver.createdAt || new Date().toISOString().split('T')[0],
            reviewDate: driver.reviewDate,
            reviewedBy: driver.reviewedBy,
            notes: driver.adminNotes,
            rejectionReasons: driver.rejectionReasons || [],
            score: score,
            previousRejections: parseInt(driver.previousRejections) || 0
          };
        } catch (error) {
          logError(error, `❌ Erro ao processar motorista ${driver.uid}:`, { service: 'drivers-routes' });
          return null;
        }
      })
    );

    // Filtrar aplicações válidas
    const validApplications = enrichedApplications.filter(app => app !== null);

    // Calcular estatísticas
    const stats = {
      pending: validApplications.filter(app => app.status === 'pending').length,
      inReview: validApplications.filter(app => app.status === 'in_review').length,
      approved: validApplications.filter(app => app.status === 'approved').length,
      rejected: validApplications.filter(app => app.status === 'rejected').length,
      total: total,
      approvalRate: total > 0 ? ((validApplications.filter(app => app.status === 'approved').length / total) * 100).toFixed(1) : 0
    };

    logStructured('info', `✅ Aplicações encontradas: ${validApplications.length}/${total}`, { service: 'drivers-routes' });

    res.json({
      applications: validApplications,
      summary: stats,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    logError(error, '❌ Erro ao buscar aplicações de motoristas:', { service: 'drivers-routes' });
    res.status(500).json({
      error: 'Erro interno do servidor',
      message: error.message
    });
  }
});

// POST /api/drivers/applications/:id/approve - Aprovar motorista
router.post('/api/drivers/applications/:id/approve', requireFirebase, async (req, res) => {
  try {
    const { id } = req.params;
    const { notes, adminNotes } = req.body;

    logStructured('info', `✅ Aprovando motorista ${id}:`, { notes, adminNotes }, { service: 'drivers-routes' });

    const db = firebaseConfig.getRealtimeDB();

    // Atualizar status do motorista
    await db.ref(`users/${id}`).update({
      isApproved: true,
      isRejected: false,
      reviewDate: new Date().toISOString(),
      reviewedBy: 'admin', // Em produção seria o ID do admin logado
      adminNotes: adminNotes || notes,
      status: 'approved'
    });

    // Atualizar status dos documentos para aprovados
    const documentsSnapshot = await db.ref(`users/${id}/documents`).once('value');
    const documents = documentsSnapshot.val() || {};

    const documentUpdates = {};
    Object.keys(documents).forEach(docType => {
      documentUpdates[`users/${id}/documents/${docType}/status`] = 'approved';
      documentUpdates[`users/${id}/documents/${docType}/reviewedAt`] = new Date().toISOString();
      documentUpdates[`users/${id}/documents/${docType}/reviewedBy`] = 'admin';
    });

    if (Object.keys(documentUpdates).length > 0) {
      await db.ref().update(documentUpdates);
    }

    // Atualizar status do veículo se existir
    const vehicleSnapshot = await db.ref(`users/${id}/vehicles/current`).once('value');
    if (vehicleSnapshot.exists()) {
      await db.ref(`users/${id}/vehicles/current`).update({
        status: 'approved',
        reviewedAt: new Date().toISOString(),
        reviewedBy: 'admin'
      });
    }

    logStructured('info', `✅ Motorista ${id} aprovado com sucesso`, { service: 'drivers-routes' });

    // Emitir evento WebSocket para notificar motorista
    if (req.app.locals.io) {
      req.app.locals.io.emit('driver_status_updated', {
        uid: id,
        status: 'approved',
        message: 'Seus documentos foram aprovados! Você já pode começar a dirigir.',
        timestamp: new Date().toISOString()
      });
    }

    res.json({
      success: true,
      message: 'Motorista aprovado com sucesso',
      driverId: id,
      status: 'approved'
    });

  } catch (error) {
    logError(error, `❌ Erro ao aprovar motorista ${req.params.id}:`, { service: 'drivers-routes' });
    res.status(500).json({
      error: 'Erro interno do servidor',
      message: error.message
    });
  }
});

// POST /api/drivers/applications/:id/reject - Rejeitar motorista
router.post('/api/drivers/applications/:id/reject', requireFirebase, async (req, res) => {
  try {
    const { id } = req.params;
    const { notes, rejectionReasons, adminNotes } = req.body;

    logStructured('info', `❌ Rejeitando motorista ${id}:`, { notes, rejectionReasons, adminNotes }, { service: 'drivers-routes' });

    const db = firebaseConfig.getRealtimeDB();

    // Atualizar status do motorista
    await db.ref(`users/${id}`).update({
      isApproved: false,
      isRejected: true,
      reviewDate: new Date().toISOString(),
      reviewedBy: 'admin', // Em produção seria o ID do admin logado
      adminNotes: adminNotes || notes,
      rejectionReasons: rejectionReasons || [],
      status: 'rejected'
    });

    // Atualizar status dos documentos para rejeitados
    const documentsSnapshot = await db.ref(`users/${id}/documents`).once('value');
    const documents = documentsSnapshot.val() || {};

    const documentUpdates = {};
    Object.keys(documents).forEach(docType => {
      documentUpdates[`users/${id}/documents/${docType}/status`] = 'rejected';
      documentUpdates[`users/${id}/documents/${docType}/reviewedAt`] = new Date().toISOString();
      documentUpdates[`users/${id}/documents/${docType}/reviewedBy`] = 'admin';
      documentUpdates[`users/${id}/documents/${docType}/rejectionReason`] = rejectionReasons?.join(', ') || 'Documento rejeitado';
    });

    if (Object.keys(documentUpdates).length > 0) {
      await db.ref().update(documentUpdates);
    }

    // Atualizar status do veículo se existir
    const vehicleSnapshot = await db.ref(`users/${id}/vehicles/current`).once('value');
    if (vehicleSnapshot.exists()) {
      await db.ref(`users/${id}/vehicles/current`).update({
        status: 'rejected',
        reviewedAt: new Date().toISOString(),
        reviewedBy: 'admin',
        rejectionReason: rejectionReasons?.join(', ') || 'Veículo rejeitado'
      });
    }

    logStructured('info', `✅ Motorista ${id} rejeitado com sucesso`, { service: 'drivers-routes' });

    // Emitir evento WebSocket para notificar motorista
    if (req.app.locals.io) {
      req.app.locals.io.emit('driver_status_updated', {
        uid: id,
        status: 'rejected',
        message: `Seus documentos foram rejeitados. Motivos: ${rejectionReasons?.join(', ') || 'Documentos não atendem aos requisitos'}`,
        timestamp: new Date().toISOString()
      });
    }

    res.json({
      success: true,
      message: 'Motorista rejeitado com sucesso',
      driverId: id,
      status: 'rejected',
      rejectionReasons
    });

  } catch (error) {
    logError(error, `❌ Erro ao rejeitar motorista ${req.params.id}:`, { service: 'drivers-routes' });
    res.status(500).json({
      error: 'Erro interno do servidor',
      message: error.message
    });
  }
});

// GET /api/drivers/applications/:id - Buscar aplicação específica
router.get('/api/drivers/applications/:id', requireFirebase, async (req, res) => {
  try {
    const { id } = req.params;

    logStructured('info', `📋 Buscando aplicação do motorista ${id}`, { service: 'drivers-routes' });

    const db = firebaseConfig.getRealtimeDB();

    // Buscar dados do motorista
    const userSnapshot = await db.ref(`users/${id}`).once('value');
    if (!userSnapshot.exists()) {
      return res.status(404).json({
        error: 'Motorista não encontrado',
        message: 'ID do motorista inválido'
      });
    }

    const user = userSnapshot.val();

    // Buscar documentos
    const documentsSnapshot = await db.ref(`users/${id}/documents`).once('value');
    const documents = documentsSnapshot.val() || {};

    // Buscar veículo
    const vehicleSnapshot = await db.ref(`users/${id}/vehicles/current`).once('value');
    const vehicle = vehicleSnapshot.val() || {};

    // Determinar status
    let applicationStatus = 'pending';
    if (user.isApproved === true) applicationStatus = 'approved';
    else if (user.isRejected === true) applicationStatus = 'rejected';
    else if (Object.values(documents).some(doc => doc.status === 'analyzing')) applicationStatus = 'in_review';

    const application = {
      id: id,
      driver: {
        id: id,
        name: user.name || user.displayName || 'Nome não informado',
        email: user.email || 'Email não informado',
        phone: user.phone || 'Telefone não informado',
        cpf: user.cpf || 'CPF não informado',
        birthDate: user.dateOfBirth || '1990-01-01',
        address: {
          street: user.address?.street || 'Endereço não informado',
          city: user.city || 'Cidade não informada',
          state: user.state || 'Estado não informado',
          zipCode: user.zipCode || 'CEP não informado'
        },
        profilePhoto: user.profilePhoto || undefined
      },
      vehicle: {
        id: vehicle.id || 'vehicle_1',
        brand: vehicle.brand || 'Marca não informada',
        model: vehicle.model || 'Modelo não informado',
        year: parseInt(vehicle.year) || 2020,
        color: vehicle.color || 'Cor não informada',
        plate: vehicle.plate || 'Placa não informada',
        category: vehicle.category || 'economy',
        features: {
          airConditioning: vehicle.features?.airConditioning || false,
          doors: vehicle.features?.doors || 4,
          capacity: vehicle.features?.capacity || 5
        },
        documents: vehicle.documents || []
      },
      documents: Object.keys(documents).map(docType => ({
        id: `${id}_${docType}`,
        type: docType,
        name: `${docType.toUpperCase()} - ${user.name || 'Motorista'}`,
        url: documents[docType].fileUrl || documents[docType].url || '',
        uploadDate: documents[docType].uploadedAt || documents[docType].uploadDate || new Date().toISOString().split('T')[0],
        status: documents[docType].status || 'pending',
        rejectionReason: documents[docType].rejectionReason
      })),
      status: applicationStatus,
      applicationDate: user.createdAt || new Date().toISOString().split('T')[0],
      reviewDate: user.reviewDate,
      reviewedBy: user.reviewedBy,
      notes: user.adminNotes,
      rejectionReasons: user.rejectionReasons || [],
      score: 0, // Será calculado
      previousRejections: parseInt(user.previousRejections) || 0
    };

    logStructured('info', `✅ Aplicação do motorista ${id} encontrada`, { service: 'drivers-routes' });

    res.json(application);

  } catch (error) {
    logError(error, `❌ Erro ao buscar aplicação do motorista ${req.params.id}:`, { service: 'drivers-routes' });
    res.status(500).json({
      error: 'Erro interno do servidor',
      message: error.message
    });
  }
});

// ✅ NOVO: GET /api/drivers/nearby - Buscar motoristas próximos usando Redis GEO + status + lock
router.get('/api/drivers/nearby', async (req, res) => {
  try {
    logger.info(`🔍 [DriversRoute] Requisição recebida: ${req.method} ${req.path}`, {
      query: req.query,
      headers: req.headers
    });

    const { lat, lng, radius = 5, limit = 10 } = req.query;

    // Validar parâmetros
    if (!lat || !lng) {
      logger.warn('⚠️ [DriversRoute] Parâmetros inválidos: lat ou lng ausentes');
      return res.status(400).json({
        error: 'Parâmetros inválidos',
        message: 'lat e lng são obrigatórios'
      });
    }

    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);
    const radiusKm = parseFloat(radius);
    const limitNum = parseInt(limit);

    if (isNaN(latitude) || isNaN(longitude) || isNaN(radiusKm) || isNaN(limitNum)) {
      return res.status(400).json({
        error: 'Parâmetros inválidos',
        message: 'lat, lng, radius e limit devem ser números válidos'
      });
    }

    logger.info(`🔍 [DriversRoute] Buscando motoristas próximos: lat=${latitude}, lng=${longitude}, radius=${radiusKm}km, limit=${limitNum}`);

    const redis = redisPool.getConnection();

    // ✅ Garantir que Redis está conectado
    if (redis.status !== 'ready' && redis.status !== 'connect') {
      logger.warn('⚠️ [DriversRoute] Redis não está conectado, tentando conectar...');
      await redis.connect();
    }

    // ✅ Verificar total de motoristas no GEO antes da busca
    const totalDriversBefore = await redis.zcard('driver_locations');
    logger.info(`📊 [DriversRoute] Total de motoristas no Redis GEO antes da busca: ${totalDriversBefore}`);

    // 1. Buscar motoristas próximos usando Redis GEO
    const nearbyDrivers = await redis.georadius(
      'driver_locations',
      longitude,
      latitude,
      radiusKm,
      'km',
      'WITHCOORD',
      'WITHDIST',
      'COUNT',
      limitNum * 2 // Buscar mais para filtrar por status e lock
    );

    logger.info(`🔍 [DriversRoute] Redis GEO encontrou ${nearbyDrivers?.length || 0} motoristas em ${radiusKm}km`);
    logger.debug(`🔍 [DriversRoute] Resultado do georadius:`, {
      type: typeof nearbyDrivers,
      isArray: Array.isArray(nearbyDrivers),
      length: nearbyDrivers?.length,
      firstItem: nearbyDrivers?.[0]
    });

    if (!nearbyDrivers || nearbyDrivers.length === 0) {
      logger.warn(`⚠️ [DriversRoute] Nenhum motorista encontrado em ${radiusKm}km`);
      // ✅ Verificar se há motoristas no Redis GEO (debug)
      const totalDrivers = await redis.zcard('driver_locations');
      logger.info(`📊 [DriversRoute] Total de motoristas no Redis GEO: ${totalDrivers}`);

      // ✅ Testar georadius sem COUNT para ver se retorna algo
      const testResult = await redis.georadius(
        'driver_locations',
        longitude,
        latitude,
        radiusKm,
        'km',
        'WITHCOORD',
        'WITHDIST'
      );
      logger.info(`🧪 [DriversRoute] Teste sem COUNT retornou: ${testResult?.length || 0} motoristas`);

      return res.json({
        drivers: [],
        count: 0,
        source: 'redis_geo',
        debug: {
          totalDriversInRedis: totalDrivers,
          searchRadius: radiusKm,
          testWithoutCount: testResult?.length || 0
        }
      });
    }

    // 2. Filtrar motoristas disponíveis (status + lock)
    const availableDrivers = [];

    for (const driver of nearbyDrivers) {
      const driverId = driver[0];
      const distance = parseFloat(driver[1]);
      const coordinates = {
        lng: parseFloat(driver[2][0]),
        lat: parseFloat(driver[2][1])
      };

      // Verificar se motorista está disponível (lock)
      const lockStatus = await driverLockManager.isDriverLocked(driverId);
      if (lockStatus.isLocked) {
        logger.debug(`🔒 [DriversRoute] Driver ${driverId} está ocupado (lock)`);
        continue; // Motorista ocupado
      }

      // Buscar dados do motorista (status, rating, etc)
      // Usar hash do Redis se disponível, senão buscar do Firebase
      const driverDataKey = `driver:${driverId}`;
      const driverData = await redis.hgetall(driverDataKey);

      logger.debug(`🔍 [DriversRoute] Driver ${driverId} - Redis data:`, {
        hasRedisData: !!driverData && Object.keys(driverData).length > 0,
        redisKeys: driverData ? Object.keys(driverData) : [],
        redisStatus: driverData?.status,
        redisIsOnline: driverData?.isOnline
      });

      // Se não tiver dados no Redis, buscar do Firebase (fallback)
      let driverInfo = null;
      if (!driverData || Object.keys(driverData).length === 0) {
        logger.debug(`⚠️ [DriversRoute] Driver ${driverId} não tem dados no Redis, buscando Firebase...`);
        if (firebaseConfig) {
          try {
            const db = firebaseConfig.getRealtimeDB();
            const userSnapshot = await db.ref(`users/${driverId}`).once('value');
            if (userSnapshot.exists()) {
              const user = userSnapshot.val();
              driverInfo = {
                id: driverId,
                firstName: user.firstName || user.name || '',
                lastName: user.lastName || '',
                isOnline: user.isOnline || false,
                status: user.status || 'OFFLINE',
                rating: parseFloat(user.driverRating || user.rating || 5.0),
                carType: user.carType || null,
                vehicleNumber: user.vehicleNumber || null
              };
              logger.debug(`✅ [DriversRoute] Driver ${driverId} encontrado no Firebase:`, {
                isOnline: driverInfo.isOnline,
                status: driverInfo.status
              });
            } else {
              logger.warn(`⚠️ [DriversRoute] Driver ${driverId} não encontrado no Firebase`);
            }
          } catch (firebaseError) {
            logger.warn(`⚠️ [DriversRoute] Erro ao buscar dados do Firebase para ${driverId}:`, firebaseError.message);
          }
        }
      } else {
        // Usar dados do Redis
        driverInfo = {
          id: driverId,
          firstName: driverData.firstName || '',
          lastName: driverData.lastName || '',
          isOnline: driverData.isOnline === 'true' || driverData.isOnline === true,
          status: driverData.status || 'OFFLINE',
          rating: parseFloat(driverData.rating || 5.0),
          carType: driverData.carType || null,
          vehicleNumber: driverData.vehicleNumber || null
        };
        logger.debug(`✅ [DriversRoute] Driver ${driverId} usando dados do Redis:`, {
          isOnline: driverInfo.isOnline,
          status: driverInfo.status,
          rawIsOnline: driverData.isOnline
        });
      }

      // Verificar se motorista está online e disponível
      if (!driverInfo) {
        logger.warn(`⚠️ [DriversRoute] Driver ${driverId} não tem informações (nem Redis nem Firebase)`);
        continue;
      }

      // ✅ Verificação mais flexível de status
      const isOnline = driverInfo.isOnline === true || driverInfo.isOnline === 'true';
      const isAvailable = driverInfo.status === 'AVAILABLE' || driverInfo.status === 'available' || driverInfo.status === 'ONLINE';

      if (!isOnline || !isAvailable) {
        logger.debug(`⚠️ [DriversRoute] Driver ${driverId} não está disponível:`, {
          isOnline: driverInfo.isOnline,
          status: driverInfo.status,
          isOnlineCheck: isOnline,
          isAvailableCheck: isAvailable
        });
        continue;
      }

      availableDrivers.push({
        id: driverId,
        location: coordinates,
        distance: parseFloat((distance * 1000).toFixed(2)), // Converter km para metros
        firstName: driverInfo.firstName,
        lastName: driverInfo.lastName,
        rating: driverInfo.rating,
        carType: driverInfo.carType,
        vehicleNumber: driverInfo.vehicleNumber,
        source: 'redis_geo'
      });

      // Limitar ao número solicitado
      if (availableDrivers.length >= limitNum) {
        break;
      }
    }

    // 3. Ordenar por distância
    availableDrivers.sort((a, b) => a.distance - b.distance);

    logger.info(`✅ [DriversRoute] ${availableDrivers.length} motoristas disponíveis encontrados`);

    res.json({
      drivers: availableDrivers,
      count: availableDrivers.length,
      source: 'redis_geo',
      query: {
        lat: latitude,
        lng: longitude,
        radius: radiusKm,
        limit: limitNum
      }
    });

  } catch (error) {
    logger.error('❌ [DriversRoute] Erro ao buscar motoristas próximos:', error);
    res.status(500).json({
      error: 'Erro interno do servidor',
      message: error.message
    });
  }
});

// ✅ NOVO: GET /api/drivers/:id/earnings - Relatório de Ganhos para o Mobile
router.get('/api/drivers/:id/earnings', requireFirebase, async (req, res) => {
  try {
    const { id } = req.params;
    const db = firebaseConfig.getRealtimeDB();

    // 1. Buscar usuário
    const userSnapshot = await db.ref(`users/${id}`).once('value');
    if (!userSnapshot.exists()) {
      return res.status(404).json({ success: false, message: 'Motorista não encontrado' });
    }
    const user = userSnapshot.val();

    // 2. Buscar carro ativo
    const carsSnapshot = await db.ref('cars').once('value');
    const cars = carsSnapshot.val() || {};
    const driverCar = Object.values(cars).find(car => car.driver === id);

    // 3. Buscar viagens
    const bookingsSnapshot = await db.ref('bookings').orderByChild('driver').equalTo(id).once('value');
    const bookings = bookingsSnapshot.val() || {};
    const driverBookings = Object.values(bookings).filter(b => b.status === 'COMPLETED');

    // Mapeamentos de datas locais (usando UTC/Timezone do servidor como base)
    const now = new Date();

    // Zera horas de hoje
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // Corridas de Hoje
    let tripsTodayCount = 0;

    // Ganhos diários dos últimos 7 dias
    const dailyEarningsMap = {};
    for (let i = 6; i >= 0; i--) {
      const targetDate = new Date(startOfToday);
      targetDate.setDate(targetDate.getDate() - i);
      const dayStr = String(targetDate.getDate()).padStart(2, '0');
      dailyEarningsMap[dayStr] = {
        day: dayStr,
        amount: 0,
        color: '#A5D6A7'
      };
    }

    driverBookings.forEach(booking => {
      const tripDate = booking.tripdate ? new Date(booking.tripdate) : null;
      if (!tripDate) return;

      const tripAmount = parseFloat(booking.driver_share || booking.estimate * 0.85 || booking.fare || 0);

      // É de hoje?
      if (tripDate >= startOfToday) {
        tripsTodayCount++;
      }

      // Adicionar no mapa dos 7 dias, se cair no range
      const dayStr = String(tripDate.getDate()).padStart(2, '0');
      if (dailyEarningsMap[dayStr]) {
        dailyEarningsMap[dayStr].amount += tripAmount;
      }
    });

    const dailyEarningsArray = Object.values(dailyEarningsMap);

    const report = {
      balance: parseFloat(user.walletBalance || 0),
      rating: parseFloat(user.driverRating || user.rating || 5.0).toFixed(1),
      tripsToday: tripsTodayCount,
      hoursOnline: parseFloat(user.hoursOnline || 0).toFixed(1),
      activeCar: driverCar ? {
        brand: driverCar.carMake || '',
        model: driverCar.carModel || '',
        year: driverCar.carYear || '',
        engine: driverCar.carType || ''
      } : null,
      dailyEarnings: dailyEarningsArray
    };

    res.json({ success: true, report });

  } catch (error) {
    logger.error(`❌ [DriversRoute] Erro ao buscar ganhos do motorista ${req.params.id}:`, error);
    res.status(500).json({ success: false, message: 'Erro interno do servidor', error: error.message });
  }
});

module.exports = router;
