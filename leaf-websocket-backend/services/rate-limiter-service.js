/**
 * Rate Limiting Service
 * 
 * Implementa rate limiting por usuário usando Redis
 * Protege endpoints críticos contra abuso e ataques
 */

const redisPool = require('../utils/redis-pool');
const { logStructured, logError } = require('../utils/logger');

class RateLimiterService {
  constructor() {
    // Limites por endpoint (requisições por minuto)
    this.limits = {
      // 🔴 CRÍTICO - Operações Financeiras
      'confirmPayment': { limit: 5, window: 60 },      // 5/min
      'finishTrip': { limit: 5, window: 60 },          // 5/min
      
      // 🔴 ALTO - Operações que Geram Custos
      'createBooking': { limit: 10, window: 60 },      // 10/min
      'startTrip': { limit: 5, window: 60 },           // 5/min
      
      // 🟡 MÉDIO - Operações que Afetam Experiência
      'acceptRide': { limit: 20, window: 60 },         // 20/min
      'cancelRide': { limit: 3, window: 60 },          // 3/min
      'rejectRide': { limit: 30, window: 60 },          // 30/min
      
      // 🟡 MÉDIO - Operações de Alto Volume
      'updateLocation': { limit: 200, window: 60 },     // 200/min
      'updateDriverLocation': { limit: 200, window: 60 }, // 200/min
      'searchDrivers': { limit: 120, window: 60 },       // 120/min
      
      // 🟢 BAIXO - Operações Leves
      'sendMessage': { limit: 30, window: 60 },         // 30/min
    };
    
    // Fallback: permitir se Redis não estiver disponível (fail-open)
    this.failOpen = true;
  }
  
  /**
   * Verifica se requisição está dentro do limite
   * @param {string} userId - ID do usuário (passageiro ou motorista)
   * @param {string} endpoint - Nome do endpoint (ex: 'createBooking')
   * @returns {Promise<{allowed: boolean, remaining?: number, resetAt?: number, error?: string}>}
   */
  async checkRateLimit(userId, endpoint) {
    try {
      // Se não há limite configurado para este endpoint, permitir
      if (!this.limits[endpoint]) {
        return {
          allowed: true,
          remaining: Infinity
        };
      }
      
      const config = this.limits[endpoint];
      const key = `rate_limit:${endpoint}:${userId}`;
      
      // Obter conexão Redis
      const redis = redisPool.getConnection();
      
      // Verificar se Redis está disponível
      if (!redis) {
        if (this.failOpen) {
          logStructured('warn', 'Redis não disponível, permitindo requisição (fail-open)', { service: 'rate-limiter', endpoint, userId });
          return {
            allowed: true,
            remaining: config.limit,
            warning: 'Redis não disponível, rate limiting desabilitado'
          };
        } else {
          return {
            allowed: false,
            error: 'Serviço de rate limiting temporariamente indisponível'
          };
        }
      }
      
      // Tentar conectar se não estiver conectado
      try {
        if (!redis.isOpen && redis.status !== 'ready' && redis.status !== 'connect') {
          await redis.connect();
        }
        // Testar conexão com ping
        await redis.ping();
      } catch (connectError) {
        if (this.failOpen) {
          logStructured('warn', 'Erro ao conectar Redis, permitindo requisição (fail-open)', { service: 'rate-limiter', endpoint, userId });
          return {
            allowed: true,
            remaining: config.limit,
            warning: 'Redis não disponível, rate limiting desabilitado'
          };
        } else {
          return {
            allowed: false,
            error: 'Serviço de rate limiting temporariamente indisponível'
          };
        }
      }
      
      // Buscar contador atual
      let current = await redis.get(key);
      
      if (!current) {
        // Primeira requisição: criar contador
        await redis.setex(key, config.window, 1);
        return {
          allowed: true,
          remaining: config.limit - 1,
          resetAt: Date.now() + (config.window * 1000)
        };
      }
      
      const count = parseInt(current, 10);
      
      // Verificar se excedeu o limite (ANTES de incrementar)
      if (count >= config.limit) {
        // Buscar TTL para calcular resetAt
        const ttl = await redis.ttl(key);
        const resetAt = Date.now() + (ttl * 1000);
        
        logStructured('warn', 'Rate limit excedido [AUDITORIA]', { service: 'rate-limiter', endpoint, userId, count, limit: config.limit });
        
        return {
          allowed: false,
          remaining: 0,
          resetAt: resetAt,
          limit: config.limit,
          window: config.window
        };
      }
      
      // Incrementar contador
      const newCount = await redis.incr(key);
      
      // Se TTL não foi definido (primeira vez após criação), definir TTL
      const ttl = await redis.ttl(key);
      if (ttl === -1) {
        await redis.expire(key, config.window);
      }
      
      return {
        allowed: true,
        remaining: config.limit - newCount,
        resetAt: Date.now() + (config.window * 1000)
      };
      
    } catch (error) {
      logError(error, 'Erro ao verificar rate limit', { service: 'rate-limiter', endpoint, userId });
      
      // Fail-open: permitir se houver erro
      if (this.failOpen) {
        logStructured('warn', 'Erro na verificação, permitindo requisição (fail-open)', { service: 'rate-limiter', endpoint, userId });
        return {
          allowed: true,
          remaining: this.limits[endpoint]?.limit || Infinity,
          warning: 'Erro na verificação de rate limit'
        };
      } else {
        // Fail-closed: bloquear se houver erro
        return {
          allowed: false,
          error: 'Erro ao verificar rate limit'
        };
      }
    }
  }
  
  /**
   * Reseta o contador de rate limit para um usuário/endpoint
   * Útil para testes ou casos especiais
   * @param {string} userId - ID do usuário
   * @param {string} endpoint - Nome do endpoint
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async resetRateLimit(userId, endpoint) {
    try {
      const key = `rate_limit:${endpoint}:${userId}`;
      const redis = redisPool.getConnection();
      
      if (!redis) {
        return {
          success: false,
          error: 'Redis não disponível'
        };
      }
      
      // Tentar conectar se não estiver conectado
      try {
        if (!redis.isOpen && redis.status !== 'ready' && redis.status !== 'connect') {
          await redis.connect();
        }
        await redis.ping();
      } catch (connectError) {
        return {
          success: false,
          error: 'Redis não disponível'
        };
      }
      
      await redis.del(key);
      
      logStructured('info', 'Rate limit resetado', { service: 'rate-limiter', endpoint, userId });
      
      return {
        success: true
      };
      
    } catch (error) {
      logError(error, 'Erro ao resetar rate limit', { service: 'rate-limiter', endpoint, userId });
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * Obtém informações sobre o rate limit atual
   * @param {string} userId - ID do usuário
   * @param {string} endpoint - Nome do endpoint
   * @returns {Promise<{count?: number, limit?: number, remaining?: number, resetAt?: number, error?: string}>}
   */
  async getRateLimitInfo(userId, endpoint) {
    try {
      if (!this.limits[endpoint]) {
        return {
          error: 'Endpoint não tem rate limiting configurado'
        };
      }
      
      const config = this.limits[endpoint];
      const key = `rate_limit:${endpoint}:${userId}`;
      const redis = redisPool.getConnection();
      
      if (!redis) {
        return {
          error: 'Redis não disponível'
        };
      }
      
      // Tentar conectar se não estiver conectado
      try {
        if (!redis.isOpen && redis.status !== 'ready' && redis.status !== 'connect') {
          await redis.connect();
        }
        await redis.ping();
      } catch (connectError) {
        return {
          error: 'Redis não disponível'
        };
      }
      
      const current = await redis.get(key);
      const count = current ? parseInt(current, 10) : 0;
      const ttl = await redis.ttl(key);
      const resetAt = ttl > 0 ? Date.now() + (ttl * 1000) : null;
      
      return {
        count: count,
        limit: config.limit,
        remaining: Math.max(0, config.limit - count),
        resetAt: resetAt,
        window: config.window
      };
      
    } catch (error) {
      logError(error, 'Erro ao obter info de rate limit', { service: 'rate-limiter', endpoint, userId });
      return {
        error: error.message
      };
    }
  }
  
  /**
   * Middleware para WebSocket events
   * @param {string} endpoint - Nome do endpoint
   * @param {Function} handler - Handler original do evento
   * @returns {Function} - Handler com rate limiting
   */
  middleware(endpoint, handler) {
    return async (data, socket) => {
      // Obter userId do socket
      const userId = socket.userId || socket.id;
      
      // Verificar rate limit
      const rateLimitResult = await this.checkRateLimit(userId, endpoint);
      
      if (!rateLimitResult.allowed) {
        // Emitir erro de rate limit
        const errorEvent = this.getErrorEventName(endpoint);
        socket.emit(errorEvent, {
          error: 'Muitas requisições',
          message: `Você excedeu o limite de ${rateLimitResult.limit} requisições por minuto para ${endpoint}. Tente novamente em ${Math.ceil((rateLimitResult.resetAt - Date.now()) / 1000)} segundos.`,
          code: 'RATE_LIMIT_EXCEEDED',
          limit: rateLimitResult.limit,
          remaining: rateLimitResult.remaining,
          resetAt: rateLimitResult.resetAt
        });
        
        // Log de auditoria
        logStructured('warn', 'Requisição bloqueada [AUDITORIA]', { service: 'rate-limiter', endpoint, userId, limit: rateLimitResult.limit, resetAt: new Date(rateLimitResult.resetAt).toISOString() });
        
        return;
      }
      
      // Se permitido, executar handler original
      return handler(data, socket);
    };
  }
  
  /**
   * Obtém nome do evento de erro baseado no endpoint
   * @param {string} endpoint - Nome do endpoint
   * @returns {string} - Nome do evento de erro
   */
  getErrorEventName(endpoint) {
    const errorEvents = {
      'createBooking': 'bookingError',
      'confirmPayment': 'paymentError',
      'acceptRide': 'acceptRideError',
      'startTrip': 'tripStartError',
      'finishTrip': 'tripCompleteError',
      'cancelRide': 'rideCancellationError',
      'rejectRide': 'rejectRideError',
      'updateLocation': 'locationUpdateError',
      'updateDriverLocation': 'locationUpdateError',
      'searchDrivers': 'searchDriversError',
      'sendMessage': 'messageError'
    };
    
    return errorEvents[endpoint] || 'rateLimitError';
  }
}

module.exports = new RateLimiterService();

