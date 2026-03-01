/**
 * 🎁 SERVIÇO DE GESTÃO DE PROMOÇÕES
 * 
 * Gerencia promoções para motoristas, incluindo:
 * - Criação e gestão de promoções via dashboard
 * - Verificação automática de elegibilidade
 * - Aplicação de benefícios (assinatura grátis, descontos, etc.)
 * - Rastreamento de uso e limites
 */

const firebaseConfig = require('../firebase-config');
const logger = require('../utils/logger');

class PromotionService {
  constructor() {
    this.promotionsRef = null;
    this.driverPromotionsRef = null;
    this._dbInitialized = false;
  }

  /**
   * Inicializar referências do Realtime Database (lazy initialization)
   */
  async _initializeDB() {
    if (this._dbInitialized) {
      return;
    }
    
    try {
      if (firebaseConfig && firebaseConfig.getRealtimeDB) {
        const db = await firebaseConfig.getRealtimeDB();
        if (db) {
          this.promotionsRef = db.ref('promotions');
          this.driverPromotionsRef = db.ref('driver_promotions');
          this._dbInitialized = true;
        }
      }
    } catch (error) {
      logger.error('Erro ao inicializar Realtime Database no PromotionService', error);
    }
  }

  /**
   * Criar nova promoção
   * @param {Object} promotionData - Dados da promoção
   * @returns {Promise<Object>} Promoção criada
   */
  async createPromotion(promotionData) {
    try {
      await this._initializeDB();
      
      const {
        name,
        description,
        type, // 'free_subscription', 'discount', 'trial_extension'
        benefit, // { type: 'free_subscription', duration: 30, unit: 'days' }
        eligibility, // { criteria: 'first_n_drivers', value: 500, endDate: '2025-12-31' }
        startDate,
        endDate,
        maxRedemptions, // null = ilimitado
        createdBy,
        status = 'active' // 'active', 'paused', 'expired', 'completed'
      } = promotionData;

      if (!this.promotionsRef) {
        throw new Error('Firebase não disponível');
      }

      // Validar dados obrigatórios
      if (!name || !type || !benefit || !eligibility) {
        throw new Error('Dados obrigatórios faltando');
      }

      const promotionId = `promo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      const promotion = {
        id: promotionId,
        name,
        description: description || '',
        type,
        benefit,
        eligibility,
        startDate: startDate || new Date().toISOString(),
        endDate: endDate || null,
        maxRedemptions: maxRedemptions || null,
        currentRedemptions: 0,
        status,
        createdBy: createdBy || 'admin',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      await this.promotionsRef.child(promotionId).set(promotion);

      logger.info(`✅ Promoção criada: ${promotionId} - ${name}`);
      
      return {
        success: true,
        promotion
      };

    } catch (error) {
      logger.error('❌ Erro ao criar promoção:', error);
      throw error;
    }
  }

  /**
   * Verificar se motorista é elegível para uma promoção
   * @param {string} driverId - ID do motorista
   * @param {string} promotionId - ID da promoção
   * @returns {Promise<Object>} Resultado da verificação
   */
  async checkEligibility(driverId, promotionId) {
    try {
      await this._initializeDB();
      if (!this.promotionsRef || !this.driverPromotionsRef) {
        throw new Error('Firebase não disponível');
      }

      // Buscar promoção
      const promotionSnapshot = await this.promotionsRef.child(promotionId).once('value');
      if (!promotionSnapshot.exists()) {
        return {
          eligible: false,
          reason: 'Promoção não encontrada'
        };
      }

      const promotion = promotionSnapshot.val();

      // Verificar se promoção está ativa
      if (promotion.status !== 'active') {
        return {
          eligible: false,
          reason: `Promoção ${promotion.status}`
        };
      }

      // Verificar datas
      const now = new Date();
      const startDate = new Date(promotion.startDate);
      if (now < startDate) {
        return {
          eligible: false,
          reason: 'Promoção ainda não iniciou'
        };
      }

      if (promotion.endDate) {
        const endDate = new Date(promotion.endDate);
        if (now > endDate) {
          return {
            eligible: false,
            reason: 'Promoção expirada'
          };
        }
      }

      // Verificar limite de resgates
      if (promotion.maxRedemptions && promotion.currentRedemptions >= promotion.maxRedemptions) {
        return {
          eligible: false,
          reason: 'Limite de resgates atingido'
        };
      }

      // Verificar se motorista já resgatou
      const driverPromoSnapshot = await this.driverPromotionsRef
        .child(driverId)
        .child(promotionId)
        .once('value');
      
      if (driverPromoSnapshot.exists()) {
        return {
          eligible: false,
          reason: 'Motorista já resgatou esta promoção'
        };
      }

      // Verificar critérios de elegibilidade
      const eligibilityCheck = await this.checkEligibilityCriteria(driverId, promotion.eligibility);
      
      if (!eligibilityCheck.eligible) {
        return eligibilityCheck;
      }

      return {
        eligible: true,
        promotion
      };

    } catch (error) {
      logger.error('❌ Erro ao verificar elegibilidade:', error);
      return {
        eligible: false,
        reason: 'Erro ao verificar elegibilidade'
      };
    }
  }

  /**
   * Verificar critérios específicos de elegibilidade
   * @param {string} driverId - ID do motorista
   * @param {Object} eligibility - Critérios de elegibilidade
   * @returns {Promise<Object>} Resultado da verificação
   */
  async checkEligibilityCriteria(driverId, eligibility) {
    try {
      const { criteria, value, endDate } = eligibility;

      switch (criteria) {
        case 'first_n_drivers':
          // Verificar se motorista está entre os primeiros N cadastrados
          return await this.checkFirstNDrivers(driverId, value, endDate);

        case 'registration_date_range':
          // Verificar se motorista se cadastrou em um período específico
          return await this.checkRegistrationDateRange(driverId, eligibility.startDate, endDate);

        case 'all_drivers':
          // Todos os motoristas são elegíveis
          return { eligible: true };

        case 'specific_drivers':
          // Lista específica de motoristas
          return await this.checkSpecificDrivers(driverId, eligibility.driverIds || []);

        default:
          return {
            eligible: false,
            reason: `Critério desconhecido: ${criteria}`
          };
      }
    } catch (error) {
      logger.error('❌ Erro ao verificar critérios:', error);
      return {
        eligible: false,
        reason: 'Erro ao verificar critérios'
      };
    }
  }

  /**
   * Verificar se motorista está entre os primeiros N cadastrados
   */
  async checkFirstNDrivers(driverId, maxDrivers, endDate) {
    try {
      const db = firebaseConfig.getRealtimeDB();
      
      // Buscar dados do motorista
      const driverSnapshot = await db.ref(`users/${driverId}`).once('value');
      if (!driverSnapshot.exists()) {
        return { eligible: false, reason: 'Motorista não encontrado' };
      }

      const driver = driverSnapshot.val();
      const driverCreatedAt = new Date(driver.createdAt || driver.created_at || Date.now());

      // Verificar se cadastro foi antes da data limite
      if (endDate) {
        const promoEndDate = new Date(endDate);
        if (driverCreatedAt > promoEndDate) {
          return { eligible: false, reason: 'Cadastro após data limite da promoção' };
        }
      }

      // Contar quantos motoristas se cadastraram antes deste
      const allDriversSnapshot = await db.ref('users')
        .orderByChild('usertype')
        .equalTo('driver')
        .once('value');

      const allDrivers = allDriversSnapshot.val() || {};
      const driversBefore = Object.values(allDrivers).filter(d => {
        const createdAt = new Date(d.createdAt || d.created_at || Date.now());
        return createdAt <= driverCreatedAt;
      });

      const position = driversBefore.length;

      if (position <= maxDrivers) {
        return {
          eligible: true,
          position,
          maxDrivers
        };
      }

      return {
        eligible: false,
        reason: `Motorista é o ${position}º cadastrado, limite é ${maxDrivers}`,
        position,
        maxDrivers
      };

    } catch (error) {
      logger.error('❌ Erro ao verificar primeiros N motoristas:', error);
      return { eligible: false, reason: 'Erro ao verificar posição' };
    }
  }

  /**
   * Verificar se motorista se cadastrou em um período específico
   */
  async checkRegistrationDateRange(driverId, startDate, endDate) {
    try {
      const db = firebaseConfig.getRealtimeDB();
      const driverSnapshot = await db.ref(`users/${driverId}`).once('value');
      
      if (!driverSnapshot.exists()) {
        return { eligible: false, reason: 'Motorista não encontrado' };
      }

      const driver = driverSnapshot.val();
      const driverCreatedAt = new Date(driver.createdAt || driver.created_at || Date.now());
      const promoStart = new Date(startDate);
      const promoEnd = new Date(endDate);

      if (driverCreatedAt >= promoStart && driverCreatedAt <= promoEnd) {
        return { eligible: true };
      }

      return {
        eligible: false,
        reason: 'Cadastro fora do período da promoção'
      };

    } catch (error) {
      logger.error('❌ Erro ao verificar período de cadastro:', error);
      return { eligible: false, reason: 'Erro ao verificar período' };
    }
  }

  /**
   * Verificar se motorista está na lista específica
   */
  async checkSpecificDrivers(driverId, driverIds) {
    if (driverIds.includes(driverId)) {
      return { eligible: true };
    }
    return { eligible: false, reason: 'Motorista não está na lista elegível' };
  }

  /**
   * Aplicar promoção a um motorista
   * @param {string} driverId - ID do motorista
   * @param {string} promotionId - ID da promoção
   * @returns {Promise<Object>} Resultado da aplicação
   */
  async applyPromotion(driverId, promotionId) {
    try {
      await this._initializeDB();
      if (!this.promotionsRef || !this.driverPromotionsRef) {
        throw new Error('Firebase não disponível');
      }

      // Verificar elegibilidade
      const eligibilityCheck = await this.checkEligibility(driverId, promotionId);
      
      if (!eligibilityCheck.eligible) {
        return {
          success: false,
          error: eligibilityCheck.reason
        };
      }

      const promotion = eligibilityCheck.promotion;

      // Aplicar benefício
      const benefitResult = await this.applyBenefit(driverId, promotion.benefit);

      if (!benefitResult.success) {
        return benefitResult;
      }

      // Registrar resgate
      const redemption = {
        driverId,
        promotionId,
        promotionName: promotion.name,
        benefit: promotion.benefit,
        redeemedAt: new Date().toISOString(),
        benefitApplied: benefitResult.data
      };

      await this.driverPromotionsRef
        .child(driverId)
        .child(promotionId)
        .set(redemption);

      // Atualizar contador de resgates
      await this.promotionsRef
        .child(promotionId)
        .child('currentRedemptions')
        .set((promotion.currentRedemptions || 0) + 1);

      // Verificar se promoção foi completada
      if (promotion.maxRedemptions && 
          (promotion.currentRedemptions + 1) >= promotion.maxRedemptions) {
        await this.promotionsRef
          .child(promotionId)
          .child('status')
          .set('completed');
      }

      logger.info(`✅ Promoção aplicada: ${promotionId} para motorista ${driverId}`);

      return {
        success: true,
        redemption,
        benefit: benefitResult.data
      };

    } catch (error) {
      logger.error('❌ Erro ao aplicar promoção:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Aplicar benefício ao motorista
   * @param {string} driverId - ID do motorista
   * @param {Object} benefit - Benefício a aplicar
   * @returns {Promise<Object>} Resultado da aplicação
   */
  async applyBenefit(driverId, benefit) {
    try {
      const db = firebaseConfig.getRealtimeDB();
      const driverRef = db.ref(`users/${driverId}`);

      switch (benefit.type) {
        case 'free_subscription':
          return await this.applyFreeSubscription(driverId, benefit);

        case 'discount':
          return await this.applyDiscount(driverId, benefit);

        case 'trial_extension':
          return await this.applyTrialExtension(driverId, benefit);

        default:
          return {
            success: false,
            error: `Tipo de benefício desconhecido: ${benefit.type}`
          };
      }
    } catch (error) {
      logger.error('❌ Erro ao aplicar benefício:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Aplicar assinatura grátis
   */
  async applyFreeSubscription(driverId, benefit) {
    try {
      const db = firebaseConfig.getRealtimeDB();
      const driverRef = db.ref(`users/${driverId}`);
      
      const driverSnapshot = await driverRef.once('value');
      if (!driverSnapshot.exists()) {
        return { success: false, error: 'Motorista não encontrado' };
      }

      const driver = driverSnapshot.val();
      const now = new Date();
      
      // Calcular data de término
      const duration = benefit.duration || 30; // dias
      const unit = benefit.unit || 'days';
      
      let endDate = new Date(now);
      if (unit === 'days') {
        endDate.setDate(endDate.getDate() + duration);
      } else if (unit === 'months') {
        endDate.setMonth(endDate.getMonth() + duration);
      } else if (unit === 'weeks') {
        endDate.setDate(endDate.getDate() + (duration * 7));
      }

      // Verificar se já existe período grátis ativo
      const existingFreeEnd = driver.promotion_free_end 
        ? new Date(driver.promotion_free_end) 
        : null;

      // Se já existe um período grátis e é maior, manter o existente
      if (existingFreeEnd && existingFreeEnd > endDate) {
        return {
          success: true,
          data: {
            type: 'free_subscription',
            startDate: driver.promotion_free_start || now.toISOString(),
            endDate: existingFreeEnd.toISOString(),
            message: 'Período grátis existente mantido (maior que o novo)'
          }
        };
      }

      // Aplicar novo período grátis
      const updates = {
        promotion_free_start: now.toISOString(),
        promotion_free_end: endDate.toISOString(),
        promotion_active: true,
        updatedAt: now.toISOString()
      };

      await driverRef.update(updates);

      // Atualizar assinatura se existir
      const subscriptionRef = db.ref(`subscriptions/${driverId}`);
      const subscriptionSnapshot = await subscriptionRef.once('value');
      
      if (subscriptionSnapshot.exists()) {
        await subscriptionRef.update({
          promotionFreeUntil: endDate.toISOString(),
          updatedAt: now.toISOString()
        });
      }

      logger.info(`✅ Assinatura grátis aplicada: ${driverId} até ${endDate.toISOString()}`);

      return {
        success: true,
        data: {
          type: 'free_subscription',
          startDate: now.toISOString(),
          endDate: endDate.toISOString(),
          duration,
          unit
        }
      };

    } catch (error) {
      logger.error('❌ Erro ao aplicar assinatura grátis:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Aplicar desconto
   */
  async applyDiscount(driverId, benefit) {
    // Implementar lógica de desconto se necessário
    return {
      success: true,
      data: {
        type: 'discount',
        discount: benefit.discount || 0
      }
    };
  }

  /**
   * Estender período de trial
   */
  async applyTrialExtension(driverId, benefit) {
    try {
      const db = firebaseConfig.getRealtimeDB();
      const driverRef = db.ref(`users/${driverId}`);
      
      const driverSnapshot = await driverRef.once('value');
      if (!driverSnapshot.exists()) {
        return { success: false, error: 'Motorista não encontrado' };
      }

      const driver = driverSnapshot.val();
      const now = new Date();
      
      // Calcular nova data de término do trial
      const duration = benefit.duration || 30;
      const unit = benefit.unit || 'days';
      
      let newEndDate = new Date(now);
      if (unit === 'days') {
        newEndDate.setDate(newEndDate.getDate() + duration);
      } else if (unit === 'months') {
        newEndDate.setMonth(newEndDate.getMonth() + duration);
      }

      // Se já existe trial_end, estender a partir dele
      const existingTrialEnd = driver.free_trial_end 
        ? new Date(driver.free_trial_end) 
        : null;

      if (existingTrialEnd && existingTrialEnd > now) {
        // Estender a partir do fim atual
        if (unit === 'days') {
          newEndDate = new Date(existingTrialEnd);
          newEndDate.setDate(newEndDate.getDate() + duration);
        } else if (unit === 'months') {
          newEndDate = new Date(existingTrialEnd);
          newEndDate.setMonth(newEndDate.getMonth() + duration);
        }
      }

      await driverRef.update({
        free_trial_end: newEndDate.toISOString(),
        updatedAt: now.toISOString()
      });

      return {
        success: true,
        data: {
          type: 'trial_extension',
          newEndDate: newEndDate.toISOString()
        }
      };

    } catch (error) {
      logger.error('❌ Erro ao estender trial:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Listar todas as promoções
   */
  async listPromotions(filters = {}) {
    try {
      await this._initializeDB();
      if (!this.promotionsRef) {
        throw new Error('Firebase não disponível');
      }

      const snapshot = await this.promotionsRef.once('value');
      const promotions = snapshot.val() || {};

      let result = Object.values(promotions);

      // Aplicar filtros
      if (filters.status) {
        result = result.filter(p => p.status === filters.status);
      }

      if (filters.type) {
        result = result.filter(p => p.type === filters.type);
      }

      // Ordenar por data de criação (mais recente primeiro)
      result.sort((a, b) => {
        return new Date(b.createdAt) - new Date(a.createdAt);
      });

      return {
        success: true,
        promotions: result,
        count: result.length
      };

    } catch (error) {
      logger.error('❌ Erro ao listar promoções:', error);
      throw error;
    }
  }

  /**
   * Verificar e aplicar promoções elegíveis automaticamente
   * (chamado quando motorista se cadastra ou quando promoção é criada)
   */
  async checkAndApplyEligiblePromotions(driverId) {
    try {
      await this._initializeDB();
      const { promotions } = await this.listPromotions({ status: 'active' });
      
      const results = [];
      
      for (const promotion of promotions) {
        const eligibility = await this.checkEligibility(driverId, promotion.id);
        
        if (eligibility.eligible) {
          const result = await this.applyPromotion(driverId, promotion.id);
          results.push({
            promotionId: promotion.id,
            promotionName: promotion.name,
            success: result.success,
            error: result.error
          });
        }
      }

      return {
        success: true,
        appliedPromotions: results,
        results, // Manter compatibilidade
        message: results.length > 0 
          ? `${results.length} promoção(ões) aplicada(s) com sucesso`
          : 'Nenhuma promoção elegível encontrada'
      };

    } catch (error) {
      logger.error('❌ Erro ao verificar promoções elegíveis:', error);
      return {
        success: false,
        appliedPromotions: [],
        results: [],
        message: `Erro ao verificar promoções: ${error.message}`,
        error: error.message
      };
    }
  }

  /**
   * Verificar se motorista está em período grátis (trial, meses grátis ou promoção)
   * @param {string} driverId - ID do motorista
   * @returns {Promise<Object>} Status do período grátis
   */
  async checkFreePeriod(driverId) {
    try {
      if (!firebaseConfig || !firebaseConfig.getRealtimeDB) {
        return {
          isFree: false,
          reason: 'Firebase não disponível'
        };
      }

      const db = firebaseConfig.getRealtimeDB();
      const driverSnapshot = await db.ref(`users/${driverId}`).once('value');
      
      if (!driverSnapshot.exists()) {
        return {
          isFree: false,
          reason: 'Motorista não encontrado'
        };
      }

      const driver = driverSnapshot.val();
      const now = new Date();

      // Verificar todos os tipos de período grátis
      const freeEnds = [];
      const freeTypes = [];

      // 1. Trial dos primeiros 500
      if (driver.free_trial_end) {
        const trialEnd = new Date(driver.free_trial_end);
        if (now < trialEnd) {
          freeEnds.push(trialEnd);
          freeTypes.push('trial');
        }
      }

      // 2. Meses grátis por convites
      if (driver.free_months_end) {
        const monthsEnd = new Date(driver.free_months_end);
        if (now < monthsEnd) {
          freeEnds.push(monthsEnd);
          freeTypes.push('referral');
        }
      }

      // 3. Promoções ativas
      if (driver.promotion_free_end) {
        const promoEnd = new Date(driver.promotion_free_end);
        if (now < promoEnd) {
          freeEnds.push(promoEnd);
          freeTypes.push('promotion');
        }
      }

      if (freeEnds.length === 0) {
        return {
          isFree: false,
          reason: 'Nenhum período grátis ativo'
        };
      }

      // Pegar a data mais distante (maior benefício)
      const latestFreeEnd = new Date(Math.max(...freeEnds.map(d => d.getTime())));
      const daysRemaining = Math.ceil((latestFreeEnd - now) / (1000 * 60 * 60 * 24));

      return {
        isFree: true,
        freeUntil: latestFreeEnd.toISOString(),
        daysRemaining: Math.max(0, daysRemaining),
        types: freeTypes,
        reason: `Período grátis ativo até ${latestFreeEnd.toLocaleDateString('pt-BR')}`
      };

    } catch (error) {
      logger.error('❌ Erro ao verificar período grátis:', error);
      return {
        isFree: false,
        reason: 'Erro ao verificar período grátis'
      };
    }
  }
}

module.exports = new PromotionService();

module.exports = new PromotionService();

