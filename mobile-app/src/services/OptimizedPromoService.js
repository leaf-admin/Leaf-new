import AsyncStorage from '@react-native-async-storage/async-storage';
import { store } from '../common-local/store';

// Configurações do serviço de promoções
const PROMO_CONFIG = {
  maxPromos: 100, // Máximo de promoções em cache
  cacheExpiry: 30 * 60 * 1000, // 30 minutos
  maxValidationCache: 60 * 1000, // 1 minuto para validação
  batchSize: 20, // Tamanho do lote para carregamento
  retryAttempts: 3, // Tentativas de reenvio
  retryDelay: 1000 // Delay entre tentativas
};

class OptimizedPromoService {
  constructor() {
    this.promoCache = new Map();
    this.validationCache = new Map();
    this.isInitialized = false;
    this.websocketManager = null;
    this.retryQueue = [];
  }

  // Inicializar o serviço
  async initialize(websocketManager) {
    try {
      this.websocketManager = websocketManager;
      
      // Carregar cache local
      await this.loadLocalCache();
      
      // Limpar cache expirado
      await this.cleanupExpiredCache();
      
      // Processar fila de retry
      this.processRetryQueue();
      
      this.isInitialized = true;
      console.log('✅ Promo Service inicializado com sucesso');
      
    } catch (error) {
      console.error('❌ Erro ao inicializar Promo Service:', error);
      throw error;
    }
  }

  // Buscar promoções com cache inteligente
  async getPromos(filters = {}, page = 0, limit = PROMO_CONFIG.batchSize) {
    try {
      const cacheKey = this.generateCacheKey(filters, page, limit);
      
      // Verificar cache local primeiro
      if (this.promoCache.has(cacheKey)) {
        const cached = this.promoCache.get(cacheKey);
        if (Date.now() - cached.timestamp < PROMO_CONFIG.cacheExpiry) {
          console.log('✅ Promoções carregadas do cache local');
          return cached.data;
        }
      }
      
      // Buscar via WebSocket
      const promos = await this.fetchPromosFromWebSocket(filters, page, limit);
      
      // Salvar no cache local
      this.promoCache.set(cacheKey, {
        data: promos,
        timestamp: Date.now()
      });
      
      // Salvar no AsyncStorage
      await this.savePromosToLocalStorage(cacheKey, promos);
      
      return promos;
      
    } catch (error) {
      console.error('❌ Erro ao buscar promoções:', error);
      
      // Tentar carregar do cache local
      try {
        return await this.loadPromosFromLocalStorage(filters, page, limit);
      } catch (localError) {
        console.error('❌ Erro ao carregar do cache local:', localError);
        return [];
      }
    }
  }

  // Buscar promoções do usuário
  async getUserPromos(filters = {}) {
    try {
      const cacheKey = `user_promos:${JSON.stringify(filters)}`;
      
      // Verificar cache local primeiro
      if (this.promoCache.has(cacheKey)) {
        const cached = this.promoCache.get(cacheKey);
        if (Date.now() - cached.timestamp < PROMO_CONFIG.cacheExpiry) {
          return cached.data;
        }
      }
      
      // Buscar via WebSocket
      const userPromos = await this.fetchUserPromosFromWebSocket(filters);
      
      // Salvar no cache local
      this.promoCache.set(cacheKey, {
        data: userPromos,
        timestamp: Date.now()
      });
      
      // Salvar no AsyncStorage
      await this.savePromosToLocalStorage(cacheKey, userPromos);
      
      return userPromos;
      
    } catch (error) {
      console.error('❌ Erro ao buscar promoções do usuário:', error);
      return [];
    }
  }

  // Validar código promocional
  async validatePromoCode(code, orderValue = 0) {
    try {
      const cacheKey = `validation:${code}:${orderValue}`;
      
      // Verificar cache de validação
      if (this.validationCache.has(cacheKey)) {
        const cached = this.validationCache.get(cacheKey);
        if (Date.now() - cached.timestamp < PROMO_CONFIG.maxValidationCache) {
          return cached.data;
        }
      }
      
      // Validar via WebSocket
      const validation = await this.validatePromoCodeViaWebSocket(code, orderValue);
      
      // Salvar no cache de validação
      this.validationCache.set(cacheKey, {
        data: validation,
        timestamp: Date.now()
      });
      
      return validation;
      
    } catch (error) {
      console.error('❌ Erro ao validar código promocional:', error);
      return { valid: false, error: 'Erro ao validar código' };
    }
  }

  // Aplicar promoção
  async applyPromo(promoId, orderData) {
    try {
      // Aplicar via WebSocket
      const result = await this.applyPromoViaWebSocket(promoId, orderData);
      
      // Invalidar caches relacionados
      await this.invalidatePromoCaches();
      
      return result;
      
    } catch (error) {
      console.error('❌ Erro ao aplicar promoção:', error);
      
      // Adicionar à fila de retry
      this.addToRetryQueue('apply_promo', { promoId, orderData });
      
      throw error;
    }
  }

  // Buscar promoção por código
  async getPromoByCode(code) {
    try {
      const cacheKey = `promo_code:${code.toUpperCase()}`;
      
      // Verificar cache local primeiro
      if (this.promoCache.has(cacheKey)) {
        const cached = this.promoCache.get(cacheKey);
        if (Date.now() - cached.timestamp < PROMO_CONFIG.cacheExpiry) {
          return cached.data;
        }
      }
      
      // Buscar via WebSocket
      const promo = await this.getPromoByCodeViaWebSocket(code);
      
      if (promo) {
        // Salvar no cache local
        this.promoCache.set(cacheKey, {
          data: promo,
          timestamp: Date.now()
        });
        
        // Salvar no AsyncStorage
        await this.savePromoToLocalStorage(cacheKey, promo);
      }
      
      return promo;
      
    } catch (error) {
      console.error('❌ Erro ao buscar promoção por código:', error);
      return null;
    }
  }

  // Métodos de comunicação com WebSocket
  async fetchPromosFromWebSocket(filters, page, limit) {
    if (!this.websocketManager) {
      throw new Error('WebSocket não disponível');
    }
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout ao buscar promoções'));
      }, 10000);
      
      this.websocketManager.socket.once('promos_loaded', (data) => {
        clearTimeout(timeout);
        if (data.success) {
          resolve(data.promos);
        } else {
          reject(new Error(data.error));
        }
      });
      
      this.websocketManager.socket.emit('get_promos', { filters, page, limit });
    });
  }

  async fetchUserPromosFromWebSocket(filters) {
    if (!this.websocketManager) {
      throw new Error('WebSocket não disponível');
    }
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout ao buscar promoções do usuário'));
      }, 10000);
      
      this.websocketManager.socket.once('user_promos_loaded', (data) => {
        clearTimeout(timeout);
        if (data.success) {
          resolve(data.promos);
        } else {
          reject(new Error(data.error));
        }
      });
      
      this.websocketManager.socket.emit('get_user_promos', { filters });
    });
  }

  async validatePromoCodeViaWebSocket(code, orderValue) {
    if (!this.websocketManager) {
      throw new Error('WebSocket não disponível');
    }
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout ao validar código promocional'));
      }, 10000);
      
      this.websocketManager.socket.once('promo_code_validated', (data) => {
        clearTimeout(timeout);
        if (data.success) {
          resolve(data.validation);
        } else {
          reject(new Error(data.error));
        }
      });
      
      this.websocketManager.socket.emit('validate_promo_code', { code, orderValue });
    });
  }

  async applyPromoViaWebSocket(promoId, orderData) {
    if (!this.websocketManager) {
      throw new Error('WebSocket não disponível');
    }
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout ao aplicar promoção'));
      }, 10000);
      
      this.websocketManager.socket.once('promo_applied', (data) => {
        clearTimeout(timeout);
        if (data.success) {
          resolve(data.result);
        } else {
          reject(new Error(data.error));
        }
      });
      
      this.websocketManager.socket.emit('apply_promo', { promoId, orderData });
    });
  }

  async getPromoByCodeViaWebSocket(code) {
    if (!this.websocketManager) {
      throw new Error('WebSocket não disponível');
    }
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout ao buscar promoção por código'));
      }, 10000);
      
      this.websocketManager.socket.once('promo_by_code_loaded', (data) => {
        clearTimeout(timeout);
        if (data.success) {
          resolve(data.promo);
        } else {
          reject(new Error(data.error));
        }
      });
      
      this.websocketManager.socket.emit('get_promo_by_code', { code });
    });
  }

  // Métodos auxiliares
  generateCacheKey(filters, page, limit) {
    const filterString = JSON.stringify(filters);
    return `promos:${filterString}:${page}:${limit}`;
  }

  async loadLocalCache() {
    try {
      const cacheData = await AsyncStorage.getItem('promo_cache');
      if (cacheData) {
        const parsed = JSON.parse(cacheData);
        for (const [key, value] of Object.entries(parsed)) {
          this.promoCache.set(key, value);
        }
        console.log('✅ Cache local de promoções carregado');
      }
    } catch (error) {
      console.error('❌ Erro ao carregar cache local:', error);
    }
  }

  async savePromosToLocalStorage(key, promos) {
    try {
      const cacheData = {};
      for (const [cacheKey, value] of this.promoCache.entries()) {
        cacheData[cacheKey] = value;
      }
      
      await AsyncStorage.setItem('promo_cache', JSON.stringify(cacheData));
    } catch (error) {
      console.error('❌ Erro ao salvar promoções no storage local:', error);
    }
  }

  async savePromoToLocalStorage(key, promo) {
    try {
      this.promoCache.set(key, {
        data: promo,
        timestamp: Date.now()
      });
      
      await this.savePromosToLocalStorage();
    } catch (error) {
      console.error('❌ Erro ao salvar promoção no storage local:', error);
    }
  }

  async loadPromosFromLocalStorage(filters, page, limit) {
    try {
      const cacheKey = this.generateCacheKey(filters, page, limit);
      const cached = this.promoCache.get(cacheKey);
      
      if (cached && Date.now() - cached.timestamp < PROMO_CONFIG.cacheExpiry) {
        return cached.data;
      }
      
      return [];
    } catch (error) {
      console.error('❌ Erro ao carregar promoções do storage local:', error);
      return [];
    }
  }

  async invalidatePromoCaches() {
    try {
      // Limpar cache local
      this.promoCache.clear();
      
      // Limpar AsyncStorage
      await AsyncStorage.removeItem('promo_cache');
      
      console.log('🗑️ Cache de promoções invalidado');
    } catch (error) {
      console.error('❌ Erro ao invalidar cache:', error);
    }
  }

  async cleanupExpiredCache() {
    try {
      const now = Date.now();
      const expiredKeys = [];
      
      // Verificar cache local
      for (const [key, value] of this.promoCache.entries()) {
        if (now - value.timestamp > PROMO_CONFIG.cacheExpiry) {
          expiredKeys.push(key);
        }
      }
      
      // Remover chaves expiradas
      expiredKeys.forEach(key => this.promoCache.delete(key));
      
      // Verificar cache de validação
      for (const [key, value] of this.validationCache.entries()) {
        if (now - value.timestamp > PROMO_CONFIG.maxValidationCache) {
          this.validationCache.delete(key);
        }
      }
      
      if (expiredKeys.length > 0) {
        console.log(`🧹 ${expiredKeys.length} itens expirados removidos do cache`);
      }
      
    } catch (error) {
      console.error('❌ Erro na limpeza de cache:', error);
    }
  }

  // Sistema de retry
  addToRetryQueue(action, data) {
    this.retryQueue.push({
      action,
      data,
      timestamp: Date.now(),
      attempts: 0
    });
    
    console.log(`📝 Ação ${action} adicionada à fila de retry`);
  }

  async processRetryQueue() {
    if (this.retryQueue.length === 0) {
      return;
    }
    
    console.log(`🔄 Processando ${this.retryQueue.length} ações na fila de retry`);
    
    for (const queuedAction of this.retryQueue) {
      try {
        if (queuedAction.attempts >= PROMO_CONFIG.retryAttempts) {
          console.log(`❌ Ação ${queuedAction.action} falhou após ${queuedAction.attempts} tentativas`);
          
          // Remover da fila
          const index = this.retryQueue.indexOf(queuedAction);
          if (index > -1) {
            this.retryQueue.splice(index, 1);
          }
          
          continue;
        }
        
        // Tentar executar ação
        let result;
        switch (queuedAction.action) {
          case 'apply_promo':
            result = await this.applyPromoViaWebSocket(
              queuedAction.data.promoId, 
              queuedAction.data.orderData
            );
            break;
          default:
            console.warn(`⚠️ Ação desconhecida: ${queuedAction.action}`);
            continue;
        }
        
        // Sucesso - remover da fila
        const index = this.retryQueue.indexOf(queuedAction);
        if (index > -1) {
          this.retryQueue.splice(index, 1);
        }
        
        console.log(`✅ Ação ${queuedAction.action} executada com sucesso na tentativa ${queuedAction.attempts + 1}`);
        
      } catch (error) {
        console.error(`❌ Erro ao executar ação ${queuedAction.action}:`, error);
        
        // Incrementar tentativas
        queuedAction.attempts++;
        
        // Aguardar antes da próxima tentativa
        await new Promise(resolve => setTimeout(resolve, PROMO_CONFIG.retryDelay));
      }
    }
  }

  // Obter estatísticas do serviço
  getServiceStats() {
    return {
      totalCachedPromos: this.promoCache.size,
      totalValidationCache: this.validationCache.size,
      retryQueueLength: this.retryQueue.length,
      isInitialized: this.isInitialized
    };
  }

  // Destruir serviço
  destroy() {
    this.promoCache.clear();
    this.validationCache.clear();
    this.retryQueue = [];
    this.isInitialized = false;
    
    console.log('🗑️ Promo Service destruído');
  }
}

export default new OptimizedPromoService();
