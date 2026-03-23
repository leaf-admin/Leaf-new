/**
 * Redis Driver Simulator
 * 
 * Simula motorista online no Redis exatamente como o servidor faz
 * Replica o comportamento da função saveDriverLocation do server.js
 */

const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const { execFile } = require('child_process');
const redisPool = require('../../../../utils/redis-pool');
const execFileAsync = promisify(execFile);

class RedisDriverSimulator {
  constructor() {
    this.redis = null;

    this.remoteSsh = {
      host: process.env.E2E_REMOTE_SSH_HOST || '147.182.204.181',
      user: process.env.E2E_REMOTE_SSH_USER || 'root',
      keyPath: process.env.E2E_REMOTE_SSH_KEY_PATH ||
        path.join(__dirname, '../../../../../digitaloceankey')
    };
    this.remoteRedis = {
      container: process.env.E2E_REMOTE_REDIS_CONTAINER || 'leaf-redis',
      password: process.env.E2E_REMOTE_REDIS_PASSWORD || 'leaf_redis_2024'
    };
    this.remoteSshOptions = [
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'BatchMode=yes',
      '-o', 'ConnectionAttempts=3',
      '-o', 'ConnectTimeout=8',
      '-o', 'ServerAliveInterval=5',
      '-o', 'ServerAliveCountMax=3'
    ];
    this.remoteCommandRetries = Number.parseInt(process.env.E2E_REMOTE_CMD_RETRIES || '3', 10);
    this.remoteCommandRetryDelayMs = Number.parseInt(process.env.E2E_REMOTE_CMD_RETRY_DELAY_MS || '250', 10);
    this.useRemoteRedis = this.shouldUseRemoteRedis();
  }

  shouldUseRemoteRedis() {
    const explicitMode = String(process.env.E2E_DRIVER_SIM_MODE || '').trim().toLowerCase();
    if (explicitMode === 'local') return false;
    if (explicitMode === 'remote_ssh') return this.hasRemoteSshKey();

    const wsUrl = String(process.env.WS_URL || '').trim().toLowerCase();
    const isClearlyRemote =
      wsUrl.includes('sslip.io') ||
      wsUrl.startsWith('https://') ||
      (wsUrl.startsWith('http://') && !wsUrl.includes('localhost') && !wsUrl.includes('127.0.0.1'));

    return isClearlyRemote && this.hasRemoteSshKey();
  }

  hasRemoteSshKey() {
    try {
      return fs.existsSync(this.remoteSsh.keyPath);
    } catch (_error) {
      return false;
    }
  }

  sanitizeDriverId(driverId) {
    const normalized = String(driverId || '').trim();
    if (!/^[a-zA-Z0-9._:-]+$/.test(normalized)) {
      throw new Error(`driverId inválido para execução remota: ${driverId}`);
    }
    return normalized;
  }

  sanitizeNumber(value, fieldName) {
    const num = Number(value);
    if (!Number.isFinite(num)) {
      throw new Error(`${fieldName} inválido para execução remota: ${value}`);
    }
    return num;
  }

  sanitizeRedisKey(value, fieldName = 'redisKey') {
    const normalized = String(value || '').trim();
    if (!/^[a-zA-Z0-9._:-]+$/.test(normalized)) {
      throw new Error(`${fieldName} inválido para execução remota: ${value}`);
    }
    return normalized;
  }

  sanitizeRedisPattern(value, fieldName = 'redisPattern') {
    const normalized = String(value || '').trim();
    if (!/^[a-zA-Z0-9._:*?-]+$/.test(normalized)) {
      throw new Error(`${fieldName} inválido para execução remota: ${value}`);
    }
    return normalized;
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  parseRedisLines(rawOutput) {
    return String(rawOutput || '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('Warning:'));
  }

  parseRedisScalar(rawOutput) {
    const tokens = this.parseRedisLines(rawOutput);
    if (!tokens.length) return null;
    const value = tokens[tokens.length - 1];
    if (value === '(nil)') return null;
    return value;
  }

  async runRemoteShell(script) {
    const sshTarget = `${this.remoteSsh.user}@${this.remoteSsh.host}`;
    const shellQuote = (value) => `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
    const remoteCommand = `bash -lc ${shellQuote(script)}`;
    const args = ['-i', this.remoteSsh.keyPath, ...this.remoteSshOptions, sshTarget, remoteCommand];
    const maxAttempts = Number.isFinite(this.remoteCommandRetries) && this.remoteCommandRetries > 0
      ? this.remoteCommandRetries
      : 1;

    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const { stdout, stderr } = await execFileAsync('ssh', args, {
          maxBuffer: 1024 * 1024 * 8
        });

        // Algumas versões do redis-cli em docker imprimem saída útil em stderr.
        // Para parsing robusto em E2E remoto, unificamos ambos os canais.
        return `${String(stdout || '')}${String(stderr || '')}`;
      } catch (error) {
        lastError = error;

        const stderr = String(error?.stderr || '');
        const isTransient =
          stderr.includes('Connection reset by') ||
          stderr.includes('kex_exchange_identification') ||
          stderr.includes('Connection timed out') ||
          stderr.includes('Broken pipe') ||
          error?.code === 255;

        if (!isTransient || attempt >= maxAttempts) break;

        const delay = this.remoteCommandRetryDelayMs * Math.pow(2, attempt - 1);
        await this.sleep(delay);
      }
    }

    throw lastError;
  }

  buildRemoteRedisCli() {
    const { container, password } = this.remoteRedis;
    const escapedPassword = String(password).replace(/'/g, `'\"'\"'`);
    return `REDISCLI_AUTH='${escapedPassword}' docker exec ${container} redis-cli`;
  }

  async hget(key, field) {
    if (this.useRemoteRedis) {
      const safeKey = this.sanitizeRedisKey(key, 'key');
      const safeField = this.sanitizeRedisKey(field, 'field');
      const redisCli = this.buildRemoteRedisCli();
      const raw = await this.runRemoteShell(`${redisCli} --raw HGET ${safeKey} ${safeField} || true`);
      return this.parseRedisScalar(raw);
    }

    const redis = await this.getRedis();
    return redis.hget(key, field);
  }

  async hgetall(key) {
    if (this.useRemoteRedis) {
      const safeKey = this.sanitizeRedisKey(key, 'key');
      const redisCli = this.buildRemoteRedisCli();
      const raw = await this.runRemoteShell(`${redisCli} --raw HGETALL ${safeKey} || true`);
      const tokens = this.parseRedisLines(raw);
      const data = {};
      for (let i = 0; i < tokens.length; i += 2) {
        const k = tokens[i];
        const v = tokens[i + 1];
        if (k && v !== undefined) data[k] = v;
      }
      return data;
    }

    const redis = await this.getRedis();
    return redis.hgetall(key);
  }

  async keys(pattern) {
    if (this.useRemoteRedis) {
      const safePattern = this.sanitizeRedisPattern(pattern, 'pattern');
      const redisCli = this.buildRemoteRedisCli();
      const raw = await this.runRemoteShell(`${redisCli} --raw KEYS '${safePattern}' || true`);
      return this.parseRedisLines(raw).filter((line) => line !== '(empty array)');
    }

    const redis = await this.getRedis();
    return redis.keys(pattern);
  }

  async del(...keys) {
    const validKeys = keys.filter(Boolean);
    if (!validKeys.length) return 0;

    if (this.useRemoteRedis) {
      const safeKeys = validKeys.map((key) => this.sanitizeRedisKey(key, 'key'));
      const redisCli = this.buildRemoteRedisCli();
      const raw = await this.runRemoteShell(`${redisCli} DEL ${safeKeys.join(' ')} || true`);
      const scalar = this.parseRedisScalar(raw);
      return scalar ? Number(scalar) : 0;
    }

    const redis = await this.getRedis();
    return redis.del(...validKeys);
  }

  async zrem(key, member) {
    if (this.useRemoteRedis) {
      const safeKey = this.sanitizeRedisKey(key, 'key');
      const safeMember = this.sanitizeRedisKey(member, 'member');
      const redisCli = this.buildRemoteRedisCli();
      const raw = await this.runRemoteShell(`${redisCli} ZREM ${safeKey} ${safeMember} || true`);
      const scalar = this.parseRedisScalar(raw);
      return scalar ? Number(scalar) : 0;
    }

    const redis = await this.getRedis();
    return redis.zrem(key, member);
  }

  async hdel(key, field) {
    if (this.useRemoteRedis) {
      const safeKey = this.sanitizeRedisKey(key, 'key');
      const safeField = this.sanitizeRedisKey(field, 'field');
      const redisCli = this.buildRemoteRedisCli();
      const raw = await this.runRemoteShell(`${redisCli} HDEL ${safeKey} ${safeField} || true`);
      const scalar = this.parseRedisScalar(raw);
      return scalar ? Number(scalar) : 0;
    }

    const redis = await this.getRedis();
    return redis.hdel(key, field);
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
      if (this.useRemoteRedis) {
        const safeDriverId = this.sanitizeDriverId(driverId);
        const latNum = this.sanitizeNumber(lat, 'lat');
        const lngNum = this.sanitizeNumber(lng, 'lng');
        const headingNum = this.sanitizeNumber(heading, 'heading');
        const speedNum = this.sanitizeNumber(speed, 'speed');
        const timestamp = Date.now();
        const ttl = isOnline ? (isInTrip ? 60 : 120) : 86400;
        const status = isOnline ? 'AVAILABLE' : 'OFFLINE';
        const redisCli = this.buildRemoteRedisCli();
        const key = `driver:${safeDriverId}`;
        const clearLocksCmd = `${redisCli} DEL driver_lock:${safeDriverId} driver_active_notification:${safeDriverId} active_trip_by_driver:${safeDriverId} active_trip_customer_by_driver:${safeDriverId} >/dev/null`;

        const setHashCmd = `${redisCli} HSET ${key} id ${safeDriverId} isOnline ${isOnline ? 'true' : 'false'} status ${status} lat ${latNum} lng ${lngNum} heading ${headingNum} speed ${speedNum} lastUpdate ${timestamp} timestamp ${timestamp} lastSeen ${new Date().toISOString()} rating 5.0 acceptanceRate 50.0 avgResponseTime 5.0 totalTrips 0 >/dev/null`;
        const clearActiveTripFieldsCmd = `${redisCli} HDEL ${key} activeTripId activeTripUpdatedAt >/dev/null`;
        const onlineGeoCmd = `${redisCli} GEOADD driver_locations ${lngNum} ${latNum} ${safeDriverId} >/dev/null && ${redisCli} ZREM driver_offline_locations ${safeDriverId} >/dev/null`;
        const offlineGeoCmd = `${redisCli} GEOADD driver_offline_locations ${lngNum} ${latNum} ${safeDriverId} >/dev/null && ${redisCli} ZREM driver_locations ${safeDriverId} >/dev/null`;
        const expireCmd = `${redisCli} EXPIRE ${key} ${ttl} >/dev/null`;

        const script = isOnline
          ? `${clearLocksCmd} && ${setHashCmd} && ${clearActiveTripFieldsCmd} && ${onlineGeoCmd} && ${expireCmd}`
          : `${clearLocksCmd} && ${setHashCmd} && ${clearActiveTripFieldsCmd} && ${offlineGeoCmd} && ${expireCmd}`;

        await this.runRemoteShell(script);

        console.log(`✅ [RedisDriverSimulator] Motorista ${safeDriverId} ${isInTrip ? 'EM VIAGEM' : (isOnline ? 'ONLINE' : 'OFFLINE')} salvo no Redis remoto da VPS: ${latNum}, ${lngNum}, TTL: ${ttl}s`);
        return { success: true, driverId: safeDriverId, lat: latNum, lng: lngNum, isOnline };
      }

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
      await redis.del(`driver_lock:${driverId}`, `driver_active_notification:${driverId}`);
      await redis.del(`active_trip_by_driver:${driverId}`, `active_trip_customer_by_driver:${driverId}`);
      await redis.hdel(`driver:${driverId}`, 'activeTripId', 'activeTripUpdatedAt');
      
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
      if (this.useRemoteRedis) {
        const safeDriverId = this.sanitizeDriverId(driverId);
        const redisCli = this.buildRemoteRedisCli();
        const scoreRaw = await this.runRemoteShell(
          `${redisCli} --raw ZSCORE driver_locations ${safeDriverId} || true`
        );
        const score = this.parseRedisScalar(scoreRaw) || '';
        const exists = score.length > 0 && score !== '(nil)';
        const driverData = await this.hgetall(`driver:${safeDriverId}`);

        return {
          exists,
          isOnline: driverData.isOnline === 'true',
          driverData
        };
      }

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
      if (this.useRemoteRedis) {
        const safeDriverId = this.sanitizeDriverId(driverId);
        const redisCli = this.buildRemoteRedisCli();
        const script = [
          `${redisCli} ZREM driver_locations ${safeDriverId} >/dev/null`,
          `${redisCli} ZREM driver_offline_locations ${safeDriverId} >/dev/null`,
          `${redisCli} DEL driver_lock:${safeDriverId} driver_active_notification:${safeDriverId} >/dev/null`,
          `${redisCli} DEL active_trip_by_driver:${safeDriverId} active_trip_customer_by_driver:${safeDriverId} >/dev/null`,
          `${redisCli} HDEL driver:${safeDriverId} activeTripId activeTripUpdatedAt >/dev/null`,
          `${redisCli} DEL driver:${safeDriverId} >/dev/null`
        ].join(' && ');

        await this.runRemoteShell(script);
        console.log(`✅ [RedisDriverSimulator] Motorista ${safeDriverId} removido do Redis remoto da VPS`);
        return { success: true };
      }

      const redis = await this.getRedis();
      
      await redis.zrem('driver_locations', driverId);
      await redis.zrem('driver_offline_locations', driverId);
      await redis.del(`driver_lock:${driverId}`, `driver_active_notification:${driverId}`);
      await redis.del(`active_trip_by_driver:${driverId}`, `active_trip_customer_by_driver:${driverId}`);
      await redis.hdel(`driver:${driverId}`, 'activeTripId', 'activeTripUpdatedAt');
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
