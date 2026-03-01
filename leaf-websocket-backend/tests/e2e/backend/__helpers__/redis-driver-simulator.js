/**
 * Redis Driver Simulator
 * 
 * Simula motorista online no Redis exatamente como o servidor faz
 * Replica o comportamento da função saveDriverLocation do server.js
 */

const redisPool = require('../../../../utils/redis-pool');

class RedisDriverSimulator {
  constructor() {
    this.redis = null;
  }
  
  /**
   * Obter conexão Redis
   */
  async getRedis() {
    if (!this.redis) {
      this.redis = redisPool.getConnection();
      
      // Garantir conexão
      if (this.redis.status !== 'ready' && this.redis.status !== 'connect') {
        try {
          await this.redis.connect();
        } catch (connectError) {
          if (!connectError.message.includes('already connecting') && 
              !connectError.message.includes('already connected')) {
            throw connectError;
          }
        }
      }
    }
    return this.redis;
  }
  
  /**
   * Simular motorista online no Redis
   * Replica exatamente o comportamento de saveDriverLocation do server.js
   * 
   * @param {string} driverId - ID do motorista
   * @param {number} lat - Latitude
   * @param {number} lng - Longitude
   * @param {number} heading - Direção (opcional, padrão: 0)
   * @param {number} speed - Velocidade (opcional, padrão: 0)
   * @param {boolean} isOnline - Se está online (opcional, padrão: true)
   * @param {boolean} isInTrip - Se está em viagem (opcional, padrão: false)
   */
  async setDriverOnline(driverId, lat, lng, heading = 0, speed = 0, isOnline = true, isInTrip = false) {
    try {
      const redis = await this.getRedis();
      const timestamp = Date.now();
      
      // 1. Salvar status completo do motorista em driver:${driverId}
      // (Exatamente como o servidor faz)
      const driverStatus = {
        id: driverId,
        isOnline: isOnline ? 'true' : 'false',
        status: isOnline ? 'AVAILABLE' : 'OFFLINE',
        lat: lat.toString(),
        lng: lng.toString(),
        heading: heading.toString(),
        speed: speed.toString(),
        lastUpdate: timestamp.toString(),
        timestamp: timestamp.toString(),
        lastSeen: new Date().toISOString(),
        // Dados adicionais que o sistema pode precisar
        rating: '5.0',
        acceptanceRate: '50.0',
        avgResponseTime: '5.0',
        totalTrips: '0'
      };
      
      await redis.hset(`driver:${driverId}`, driverStatus);
      
      if (isOnline) {
        // 2. Motorista ONLINE: adicionar/atualizar no GEO ativo (para match rápido)
        await redis.geoadd('driver_locations', lng, lat, driverId);
        
        // 3. Remover do GEO offline (se estava offline antes)
        await redis.zrem('driver_offline_locations', driverId);
        
        // 4. TTL diferenciado por estado
        const ttl = isInTrip ? 60 : 120;
        await redis.expire(`driver:${driverId}`, ttl);
        
        console.log(`✅ [RedisDriverSimulator] Motorista ${driverId} ${isInTrip ? 'EM VIAGEM' : 'ONLINE'} salvo no Redis (GEO ativo): ${lat}, ${lng}, TTL: ${ttl}s`);
      } else {
        // 2. Motorista OFFLINE: adicionar no GEO offline
        await redis.geoadd('driver_offline_locations', lng, lat, driverId);
        
        // 3. Remover do GEO ativo
        await redis.zrem('driver_locations', driverId);
        
        // 4. TTL longo para offline (24 horas)
        await redis.expire(`driver:${driverId}`, 86400);
        
        console.log(`✅ [RedisDriverSimulator] Motorista ${driverId} OFFLINE salvo no Redis (GEO offline): ${lat}, ${lng}`);
      }
      
      return { success: true, driverId, lat, lng, isOnline };
    } catch (error) {
      console.error(`❌ [RedisDriverSimulator] Erro ao salvar motorista ${driverId}:`, error);
      throw error;
    }
  }
  
  /**
   * Verificar se motorista está online no Redis
   */
  async isDriverOnline(driverId) {
    try {
      const redis = await this.getRedis();
      
      // Verificar se está no GEO ativo
      const score = await redis.zscore('driver_locations', driverId);
      const exists = score !== null;
      
      // Verificar dados do hash
      const driverData = await redis.hgetall(`driver:${driverId}`);
      const isOnline = driverData.isOnline === 'true';
      
      return { exists, isOnline, driverData };
    } catch (error) {
      console.error(`❌ [RedisDriverSimulator] Erro ao verificar motorista ${driverId}:`, error);
      return { exists: false, isOnline: false, driverData: null };
    }
  }
  
  /**
   * Remover motorista do Redis (cleanup)
   */
  async removeDriver(driverId) {
    try {
      const redis = await this.getRedis();
      
      await redis.zrem('driver_locations', driverId);
      await redis.zrem('driver_offline_locations', driverId);
      await redis.del(`driver:${driverId}`);
      
      console.log(`✅ [RedisDriverSimulator] Motorista ${driverId} removido do Redis`);
      return { success: true };
    } catch (error) {
      console.error(`❌ [RedisDriverSimulator] Erro ao remover motorista ${driverId}:`, error);
      throw error;
    }
  }
  
  /**
   * Buscar motoristas próximos (para debug)
   */
  async findNearbyDrivers(lat, lng, radius = 5) {
    try {
      const redis = await this.getRedis();
      
      const nearbyDrivers = await redis.georadius(
        'driver_locations',
        lng,
        lat,
        radius,
        'km',
        'WITHCOORD',
        'WITHDIST',
        'COUNT',
        10
      );
      
      return nearbyDrivers || [];
    } catch (error) {
      console.error(`❌ [RedisDriverSimulator] Erro ao buscar motoristas próximos:`, error);
      return [];
    }
  }
}

module.exports = RedisDriverSimulator;



