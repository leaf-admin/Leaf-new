/**
 * DataLoader Otimizado - Busca apenas dados necessários
 * 
 * Problema original: DataLoaders buscavam TODOS os dados e filtravam depois
 * Solução: Buscar apenas os IDs necessários usando Redis quando possível
 * 
 * Arquitetura:
 * - Redis: dados voláteis (localização, status online)
 * - Firestore: dados persistentes (perfil, histórico)
 */

const DataLoader = require('dataloader');
const redisPool = require('./redis-pool');
const { logger } = require('./logger');
const { getTTL } = require('../config/redis-ttl-config');

class OptimizedDataLoader {
    /**
     * Criar DataLoader otimizado para usuários
     * Busca do Redis primeiro (dados voláteis), depois Firestore (dados persistentes)
     */
    static createUserLoader(db) {
        return new DataLoader(async (userIds) => {
            logger.debug(`📊 [OptimizedDataLoader] Buscando ${userIds.length} usuários`);
            
            const redis = redisPool.getConnection();
            const results = [];
            
            // Buscar do Redis primeiro (dados voláteis - status, localização)
            const redisPromises = userIds.map(async (userId) => {
                try {
                    const userData = await redis.hgetall(`user:${userId}`);
                    return userData && Object.keys(userData).length > 0 ? userData : null;
                } catch (error) {
                    logger.warn(`⚠️ [OptimizedDataLoader] Erro ao buscar user:${userId} do Redis:`, error.message);
                    return null;
                }
            });
            
            const redisData = await Promise.all(redisPromises);
            
            // Buscar do Firestore apenas para IDs que não estão no Redis ou precisam de dados completos
            const missingIds = userIds.filter((id, index) => !redisData[index]);
            
            let firestoreData = {};
            if (missingIds.length > 0) {
                try {
                    // ✅ OTIMIZAÇÃO: Buscar apenas IDs necessários, não todos
                    const promises = missingIds.map(async (userId) => {
                        const snapshot = await db.ref(`users/${userId}`).once('value');
                        return snapshot.val();
                    });
                    
                    const firestoreResults = await Promise.all(promises);
                    missingIds.forEach((userId, index) => {
                        if (firestoreResults[index]) {
                            firestoreData[userId] = firestoreResults[index];
                        }
                    });
                } catch (error) {
                    logger.error(`❌ [OptimizedDataLoader] Erro ao buscar usuários do Firestore:`, error);
                }
            }
            
            // Combinar dados do Redis e Firestore
            return userIds.map((userId, index) => {
                const redisUser = redisData[index];
                const firestoreUser = firestoreData[userId];
                
                if (!redisUser && !firestoreUser) {
                    return null;
                }
                
                // Combinar dados (Redis tem prioridade para dados voláteis)
                const userData = {
                    ...firestoreUser,
                    ...redisUser, // Sobrescreve com dados do Redis (mais atualizados)
                    id: userId
                };
                
                return {
                    id: userId,
                    name: userData.name || userData.firstName || 'Usuário',
                    email: userData.email || '',
                    phone: userData.phone || userData.mobile || '',
                    userType: userData.userType || userData.usertype || 'CUSTOMER',
                    status: userData.status || 'ACTIVE',
                    rating: parseFloat(userData.rating || 0),
                    totalTrips: parseInt(userData.totalTrips || 0),
                    isOnline: userData.isOnline === 'true' || userData.isOnline === true,
                    createdAt: userData.createdAt ? new Date(userData.createdAt) : new Date(),
                    updatedAt: userData.updatedAt ? new Date(userData.updatedAt) : new Date()
                };
            });
        }, {
            // Cache por 1 minuto (dados podem mudar)
            cache: true,
            maxBatchSize: 100 // Processar até 100 IDs por vez
        });
    }

    /**
     * Criar DataLoader otimizado para motoristas
     * Busca do Redis primeiro (localização, status), depois Firestore (perfil)
     */
    static createDriverLoader(db) {
        return new DataLoader(async (driverIds) => {
            logger.debug(`📊 [OptimizedDataLoader] Buscando ${driverIds.length} motoristas`);
            
            const redis = redisPool.getConnection();
            
            // Buscar do Redis primeiro (dados voláteis)
            const redisPromises = driverIds.map(async (driverId) => {
                try {
                    const driverData = await redis.hgetall(`driver:${driverId}`);
                    return driverData && Object.keys(driverData).length > 0 ? driverData : null;
                } catch (error) {
                    logger.warn(`⚠️ [OptimizedDataLoader] Erro ao buscar driver:${driverId} do Redis:`, error.message);
                    return null;
                }
            });
            
            const redisData = await Promise.all(redisPromises);
            
            // Buscar do Firestore apenas para IDs que não estão no Redis
            const missingIds = driverIds.filter((id, index) => !redisData[index]);
            
            let firestoreData = {};
            if (missingIds.length > 0) {
                try {
                    // ✅ OTIMIZAÇÃO: Buscar apenas IDs necessários
                    const promises = missingIds.map(async (driverId) => {
                        const snapshot = await db.ref(`users/${driverId}`).once('value');
                        return snapshot.val();
                    });
                    
                    const firestoreResults = await Promise.all(promises);
                    missingIds.forEach((driverId, index) => {
                        if (firestoreResults[index] && firestoreResults[index].userType === 'DRIVER') {
                            firestoreData[driverId] = firestoreResults[index];
                        }
                    });
                } catch (error) {
                    logger.error(`❌ [OptimizedDataLoader] Erro ao buscar motoristas do Firestore:`, error);
                }
            }
            
            // Combinar dados
            return driverIds.map((driverId, index) => {
                const redisDriver = redisData[index];
                const firestoreDriver = firestoreData[driverId];
                
                if (!redisDriver && !firestoreDriver) {
                    return null;
                }
                
                // Verificar se é motorista
                const userType = redisDriver?.userType || firestoreDriver?.userType || firestoreDriver?.usertype;
                if (userType !== 'DRIVER' && userType !== 'driver') {
                    return null;
                }
                
                const driverData = {
                    ...firestoreDriver,
                    ...redisDriver,
                    id: driverId
                };
                
                return {
                    id: driverId,
                    name: driverData.name || driverData.firstName || 'Motorista',
                    email: driverData.email || '',
                    phone: driverData.phone || driverData.mobile || '',
                    status: driverData.status || 'OFFLINE',
                    rating: parseFloat(driverData.rating || 0),
                    totalTrips: parseInt(driverData.totalTrips || 0),
                    isOnline: driverData.isOnline === 'true' || driverData.isOnline === true,
                    createdAt: driverData.createdAt ? new Date(driverData.createdAt) : new Date(),
                    updatedAt: driverData.updatedAt ? new Date(driverData.updatedAt) : new Date()
                };
            });
        }, {
            cache: true,
            maxBatchSize: 100
        });
    }

    /**
     * Criar DataLoader otimizado para bookings
     * Busca apenas bookings dos IDs necessários
     */
    static createBookingLoader(db) {
        return new DataLoader(async (bookingIds) => {
            logger.debug(`📊 [OptimizedDataLoader] Buscando ${bookingIds.length} corridas`);
            
            // ✅ OTIMIZAÇÃO: Buscar apenas IDs necessários, não todos
            const promises = bookingIds.map(async (bookingId) => {
                try {
                    const snapshot = await db.ref(`bookings/${bookingId}`).once('value');
                    return snapshot.val();
                } catch (error) {
                    logger.warn(`⚠️ [OptimizedDataLoader] Erro ao buscar booking:${bookingId}:`, error.message);
                    return null;
                }
            });
            
            const bookings = await Promise.all(promises);
            
            return bookings.map((bookingData, index) => {
                if (!bookingData) return null;
                
                return {
                    id: bookingIds[index],
                    passengerId: bookingData.passengerId || bookingData.customer,
                    driverId: bookingData.driverId || bookingData.driver,
                    pickup: bookingData.pickup,
                    destination: bookingData.destination || bookingData.drop,
                    status: bookingData.status || 'PENDING',
                    estimate: parseFloat(bookingData.estimate || 0),
                    distance: parseFloat(bookingData.distance || 0),
                    duration: parseInt(bookingData.duration || 0),
                    tripdate: bookingData.tripdate,
                    updatedAt: bookingData.updatedAt,
                    driverEarnings: parseFloat(bookingData.driverEarnings || bookingData.driver_share || 0)
                };
            });
        }, {
            cache: true,
            maxBatchSize: 100
        });
    }

    /**
     * Criar DataLoader otimizado para bookings por usuário
     * Busca apenas bookings do usuário específico
     */
    static createUserBookingsLoader(db) {
        return new DataLoader(async (userIds) => {
            logger.debug(`📊 [OptimizedDataLoader] Buscando bookings para ${userIds.length} usuários`);
            
            // ✅ OTIMIZAÇÃO: Buscar apenas bookings dos usuários necessários
            const promises = userIds.map(async (userId) => {
                try {
                    // Buscar bookings onde passengerId ou driverId = userId
                    const passengerBookings = await db.ref('bookings')
                        .orderByChild('passengerId')
                        .equalTo(userId)
                        .once('value');
                    
                    const driverBookings = await db.ref('bookings')
                        .orderByChild('driverId')
                        .equalTo(userId)
                        .once('value');
                    
                    const passenger = passengerBookings.val() || {};
                    const driver = driverBookings.val() || {};
                    
                    // Combinar e converter para array
                    const allBookings = { ...passenger, ...driver };
                    return Object.keys(allBookings).map(key => ({
                        id: key,
                        ...allBookings[key]
                    }));
                } catch (error) {
                    logger.warn(`⚠️ [OptimizedDataLoader] Erro ao buscar bookings para user:${userId}:`, error.message);
                    return [];
                }
            });
            
            return await Promise.all(promises);
        }, {
            cache: true,
            maxBatchSize: 50 // Menor batch size para queries mais complexas
        });
    }

    /**
     * Criar DataLoader otimizado para veículos
     * Busca apenas veículos dos motoristas necessários
     */
    static createVehicleLoader(db) {
        return new DataLoader(async (driverIds) => {
            logger.debug(`📊 [OptimizedDataLoader] Buscando veículos para ${driverIds.length} motoristas`);
            
            // ✅ OTIMIZAÇÃO: Buscar apenas veículos dos motoristas necessários
            const promises = driverIds.map(async (driverId) => {
                try {
                    const snapshot = await db.ref('cars')
                        .orderByChild('driverId')
                        .equalTo(driverId)
                        .limitToFirst(1)
                        .once('value');
                    
                    const vehicles = snapshot.val() || {};
                    const vehicleKey = Object.keys(vehicles)[0];
                    
                    if (!vehicleKey) return null;
                    
                    const vehicleData = vehicles[vehicleKey];
                    return {
                        id: vehicleKey,
                        model: vehicleData.model || '',
                        brand: vehicleData.brand || '',
                        year: parseInt(vehicleData.year || 0),
                        color: vehicleData.color || '',
                        plate: vehicleData.plate || '',
                        capacity: parseInt(vehicleData.capacity || 4),
                        vehicleType: vehicleData.vehicleType || 'SEDAN',
                        isActive: vehicleData.isActive !== false
                    };
                } catch (error) {
                    logger.warn(`⚠️ [OptimizedDataLoader] Erro ao buscar veículo para driver:${driverId}:`, error.message);
                    return null;
                }
            });
            
            return await Promise.all(promises);
        }, {
            cache: true,
            maxBatchSize: 100
        });
    }
}

module.exports = OptimizedDataLoader;

