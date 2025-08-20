const Redis = require('ioredis');
const { logger } = require('../utils/logger');

// Configurações do sistema de promoções
const PROMO_CONFIG = {
  cacheTTL: 30 * 60, // 30 minutos em segundos
  maxPromosPerUser: 100, // Máximo de promoções por usuário
  batchSize: 20, // Tamanho do lote para carregamento
  cleanupInterval: 60 * 60 * 1000, // 1 hora para limpeza automática
  promoTypes: ['flat', 'percentage', 'free_delivery', 'cashback'],
  statuses: ['active', 'inactive', 'expired', 'scheduled']
};

class PromoService {
  constructor() {
    this.redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
    this.isInitialized = false;
    this.cleanupInterval = null;
  }

  // Inicializar o serviço
  async initialize() {
    try {
      // Testar conexão Redis
      await this.redis.ping();
      
      // Configurar limpeza automática
      this.setupAutoCleanup();
      
      this.isInitialized = true;
      logger.info('✅ Promo Service inicializado com sucesso');
      
    } catch (error) {
      logger.error('❌ Erro ao inicializar Promo Service:', error);
      throw error;
    }
  }

  // Buscar promoções com cache inteligente
  async getPromos(filters = {}, page = 0, limit = PROMO_CONFIG.batchSize) {
    try {
      const cacheKey = this.generateCacheKey(filters, page, limit);
      
      // Verificar cache primeiro
      const cachedPromos = await this.redis.get(cacheKey);
      if (cachedPromos) {
        logger.info(`✅ Promoções carregadas do cache: ${cacheKey}`);
        return JSON.parse(cachedPromos);
      }
      
      // Buscar do Firebase (simulado por enquanto)
      const promos = await this.fetchPromosFromFirebase(filters, page, limit);
      
      // Aplicar filtros e validações
      const filteredPromos = this.applyFilters(promos, filters);
      
      // Salvar no cache
      await this.redis.setex(cacheKey, PROMO_CONFIG.cacheTTL, JSON.stringify(filteredPromos));
      
      logger.info(`✅ Promoções carregadas e cacheadas: ${filteredPromos.length}`);
      return filteredPromos;
      
    } catch (error) {
      logger.error('❌ Erro ao buscar promoções:', error);
      return [];
    }
  }

  // Buscar promoções por usuário com cache
  async getUserPromos(userId, filters = {}) {
    try {
      const cacheKey = `user_promos:${userId}:${JSON.stringify(filters)}`;
      
      // Verificar cache primeiro
      const cachedUserPromos = await this.redis.get(cacheKey);
      if (cachedUserPromos) {
        return JSON.parse(cachedUserPromos);
      }
      
      // Buscar promoções disponíveis para o usuário
      const allPromos = await this.getPromos({ ...filters, status: 'active' });
      const userPromos = this.filterPromosForUser(allPromos, userId);
      
      // Salvar no cache
      await this.redis.setex(cacheKey, PROMO_CONFIG.cacheTTL, JSON.stringify(userPromos));
      
      return userPromos;
      
    } catch (error) {
      logger.error('❌ Erro ao buscar promoções do usuário:', error);
      return [];
    }
  }

  // Validar código promocional
  async validatePromoCode(code, userId, orderValue = 0) {
    try {
      const cacheKey = `promo_validation:${code}:${userId}`;
      
      // Verificar cache de validação
      const cachedValidation = await this.redis.get(cacheKey);
      if (cachedValidation) {
        const validation = JSON.parse(cachedValidation);
        if (validation.timestamp > Date.now() - 60000) { // 1 minuto
          return validation.result;
        }
      }
      
      // Buscar promoção pelo código
      const promo = await this.getPromoByCode(code);
      if (!promo) {
        return { valid: false, error: 'Código promocional inválido' };
      }
      
      // Validar promoção
      const validation = this.validatePromo(promo, userId, orderValue);
      
      // Salvar validação no cache
      await this.redis.setex(cacheKey, 60, JSON.stringify({
        result: validation,
        timestamp: Date.now()
      }));
      
      return validation;
      
    } catch (error) {
      logger.error('❌ Erro ao validar código promocional:', error);
      return { valid: false, error: 'Erro interno do servidor' };
    }
  }

  // Aplicar promoção
  async applyPromo(promoId, userId, orderData) {
    try {
      // Verificar se promoção ainda é válida
      const promo = await this.getPromoById(promoId);
      if (!promo) {
        throw new Error('Promoção não encontrada');
      }
      
      const validation = this.validatePromo(promo, userId, orderData.total);
      if (!validation.valid) {
        throw new Error(validation.error);
      }
      
      // Calcular desconto
      const discount = this.calculateDiscount(promo, orderData.total);
      
      // Registrar uso da promoção
      await this.recordPromoUsage(promoId, userId, orderData.orderId, discount);
      
      // Invalidar caches relacionados
      await this.invalidateUserPromoCache(userId);
      
      logger.info(`✅ Promoção ${promoId} aplicada com sucesso para usuário ${userId}`);
      
      return {
        success: true,
        promo,
        discount,
        finalTotal: orderData.total - discount,
        savings: discount
      };
      
    } catch (error) {
      logger.error('❌ Erro ao aplicar promoção:', error);
      throw error;
    }
  }

  // Buscar promoção por código
  async getPromoByCode(code) {
    try {
      const cacheKey = `promo_code:${code.toUpperCase()}`;
      
      // Verificar cache primeiro
      const cachedPromo = await this.redis.get(cacheKey);
      if (cachedPromo) {
        return JSON.parse(cachedPromo);
      }
      
      // Buscar do Firebase (simulado)
      const promo = await this.fetchPromoByCodeFromFirebase(code);
      
      if (promo) {
        // Salvar no cache
        await this.redis.setex(cacheKey, PROMO_CONFIG.cacheTTL, JSON.stringify(promo));
      }
      
      return promo;
      
    } catch (error) {
      logger.error('❌ Erro ao buscar promoção por código:', error);
      return null;
    }
  }

  // Buscar promoção por ID
  async getPromoById(promoId) {
    try {
      const cacheKey = `promo_id:${promoId}`;
      
      // Verificar cache primeiro
      const cachedPromo = await this.redis.get(cacheKey);
      if (cachedPromo) {
        return JSON.parse(cachedPromo);
      }
      
      // Buscar do Firebase (simulado)
      const promo = await this.fetchPromoByIdFromFirebase(promoId);
      
      if (promo) {
        // Salvar no cache
        await this.redis.setex(cacheKey, PROMO_CONFIG.cacheTTL, JSON.stringify(promo));
      }
      
      return promo;
      
    } catch (error) {
      logger.error('❌ Erro ao buscar promoção por ID:', error);
      return null;
    }
  }

  // Métodos auxiliares
  generateCacheKey(filters, page, limit) {
    const filterString = JSON.stringify(filters);
    return `promos:${filterString}:${page}:${limit}`;
  }

  applyFilters(promos, filters) {
    let filteredPromos = promos;
    
    // Filtrar por status
    if (filters.status) {
      filteredPromos = filteredPromos.filter(p => p.status === filters.status);
    }
    
    // Filtrar por tipo
    if (filters.type) {
      filteredPromos = filteredPromos.filter(p => p.promo_discount_type === filters.type);
    }
    
    // Filtrar por região
    if (filters.region) {
      filteredPromos = filteredPromos.filter(p => 
        !p.regions || p.regions.includes(filters.region)
      );
    }
    
    // Filtrar por categoria
    if (filters.category) {
      filteredPromos = filteredPromos.filter(p => 
        !p.categories || p.categories.includes(filters.category)
      );
    }
    
    // Filtrar por valor mínimo
    if (filters.minOrderValue) {
      filteredPromos = filteredPromos.filter(p => 
        p.min_order <= filters.minOrderValue
      );
    }
    
    // Ordenar por relevância
    filteredPromos.sort((a, b) => {
      // Promoções ativas primeiro
      if (a.status === 'active' && b.status !== 'active') return -1;
      if (a.status !== 'active' && b.status === 'active') return 1;
      
      // Maior desconto primeiro
      if (a.promo_discount_value !== b.promo_discount_value) {
        return b.promo_discount_value - a.promo_discount_value;
      }
      
      // Mais recentes primeiro
      return new Date(b.created_at) - new Date(a.created_at);
    });
    
    return filteredPromos;
  }

  filterPromosForUser(promos, userId) {
    return promos.filter(promo => {
      // Verificar se usuário já usou esta promoção
      if (promo.user_avail && promo.user_avail.includes(userId)) {
        return false;
      }
      
      // Verificar se promoção está ativa
      if (promo.status !== 'active') {
        return false;
      }
      
      // Verificar se não expirou
      if (promo.promo_validity && new Date(promo.promo_validity) < new Date()) {
        return false;
      }
      
      // Verificar se não atingiu limite de uso
      if (promo.promo_usage_limit && promo.promo_usage_limit <= 0) {
        return false;
      }
      
      return true;
    });
  }

  validatePromo(promo, userId, orderValue) {
    // Verificar se promoção está ativa
    if (promo.status !== 'active') {
      return { valid: false, error: 'Promoção não está ativa' };
    }
    
    // Verificar se não expirou
    if (promo.promo_validity && new Date(promo.promo_validity) < new Date()) {
      return { valid: false, error: 'Promoção expirada' };
    }
    
    // Verificar se usuário já usou
    if (promo.user_avail && promo.user_avail.includes(userId)) {
      return { valid: false, error: 'Você já usou esta promoção' };
    }
    
    // Verificar valor mínimo do pedido
    if (promo.min_order && orderValue < promo.min_order) {
      return { 
        valid: false, 
        error: `Valor mínimo do pedido: ${promo.min_order}` 
      };
    }
    
    // Verificar se não atingiu limite de uso
    if (promo.promo_usage_limit && promo.promo_usage_limit <= 0) {
      return { valid: false, error: 'Promoção esgotada' };
    }
    
    return { valid: true, promo };
  }

  calculateDiscount(promo, orderValue) {
    let discount = 0;
    
    switch (promo.promo_discount_type) {
      case 'flat':
        discount = Math.min(promo.promo_discount_value, orderValue);
        break;
        
      case 'percentage':
        discount = (orderValue * promo.promo_discount_value) / 100;
        if (promo.max_promo_discount_value) {
          discount = Math.min(discount, promo.max_promo_discount_value);
        }
        break;
        
      case 'free_delivery':
        discount = orderValue.deliveryFee || 0;
        break;
        
      case 'cashback':
        discount = 0; // Cashback é aplicado após o pagamento
        break;
        
      default:
        discount = 0;
    }
    
    return Math.round(discount * 100) / 100; // Arredondar para 2 casas decimais
  }

  async recordPromoUsage(promoId, userId, orderId, discount) {
    try {
      const usageKey = `promo_usage:${promoId}`;
      const userUsageKey = `user_promo_usage:${userId}`;
      
      // Registrar uso da promoção
      const usage = {
        promoId,
        userId,
        orderId,
        discount,
        usedAt: new Date().toISOString(),
        timestamp: Date.now()
      };
      
      // Adicionar ao histórico de uso da promoção
      await this.redis.lpush(usageKey, JSON.stringify(usage));
      
      // Adicionar ao histórico do usuário
      await this.redis.lpush(userUsageKey, JSON.stringify(usage));
      
      // Manter apenas os últimos 100 usos
      await this.redis.ltrim(usageKey, 0, 99);
      await this.redis.ltrim(userUsageKey, 0, 99);
      
      // Definir TTL
      await this.redis.expire(usageKey, 30 * 24 * 60 * 60); // 30 dias
      await this.redis.expire(userUsageKey, 30 * 24 * 60 * 60); // 30 dias
      
      logger.info(`✅ Uso da promoção ${promoId} registrado para usuário ${userId}`);
      
    } catch (error) {
      logger.error('❌ Erro ao registrar uso da promoção:', error);
    }
  }

  async invalidateUserPromoCache(userId) {
    try {
      // Buscar e invalidar todas as chaves de cache do usuário
      const keys = await this.redis.keys(`user_promos:${userId}:*`);
      if (keys.length > 0) {
        await this.redis.del(...keys);
        logger.info(`🗑️ Cache de promoções do usuário ${userId} invalidado`);
      }
    } catch (error) {
      logger.error('❌ Erro ao invalidar cache do usuário:', error);
    }
  }

  // Métodos simulados para Firebase (implementar conforme necessário)
  async fetchPromosFromFirebase(filters, page, limit) {
    // TODO: Implementar busca real no Firebase
    return [];
  }

  async fetchPromoByCodeFromFirebase(code) {
    // TODO: Implementar busca real no Firebase
    return null;
  }

  async fetchPromoByIdFromFirebase(promoId) {
    // TODO: Implementar busca real no Firebase
    return null;
  }

  // Configurar limpeza automática
  setupAutoCleanup() {
    this.cleanupInterval = setInterval(async () => {
      try {
        await this.cleanupOldData();
      } catch (error) {
        logger.error('❌ Erro na limpeza automática:', error);
      }
    }, PROMO_CONFIG.cleanupInterval);
  }

  // Limpar dados antigos
  async cleanupOldData() {
    try {
      const now = Date.now();
      
      // Limpar promoções expiradas do cache
      const promoKeys = await this.redis.keys('promo_*');
      
      for (const key of promoKeys) {
        const ttl = await this.redis.ttl(key);
        if (ttl === -1) { // Sem TTL definido
          await this.redis.expire(key, PROMO_CONFIG.cacheTTL);
        }
      }
      
      logger.info('🧹 Limpeza automática de promoções concluída');
      
    } catch (error) {
      logger.error('❌ Erro na limpeza de dados antigos:', error);
    }
  }

  // Obter estatísticas do serviço
  async getServiceStats() {
    try {
      const stats = {
        totalCachedPromos: 0,
        totalUserPromos: 0,
        totalPromoUsage: 0,
        uptime: process.uptime()
      };
      
      // Contar promoções em cache
      const promoKeys = await this.redis.keys('promo_*');
      stats.totalCachedPromos = promoKeys.length;
      
      // Contar promoções de usuários
      const userPromoKeys = await this.redis.keys('user_promos:*');
      stats.totalUserPromos = userPromoKeys.length;
      
      // Contar usos de promoções
      const usageKeys = await this.redis.keys('promo_usage:*');
      for (const key of usageKeys) {
        stats.totalPromoUsage += await this.redis.llen(key);
      }
      
      return stats;
      
    } catch (error) {
      logger.error('❌ Erro ao obter estatísticas:', error);
      return {};
    }
  }

  // Destruir serviço
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    
    this.isInitialized = false;
    logger.info('🗑️ Promo Service destruído');
  }
}

module.exports = PromoService;
