/**
 * 🎁 SERVIÇO DE GESTÃO DE PROMOÇÕES
 *
 * Runtime moderno:
 * - Firestore = source of truth
 * - RTDB = import legada sob demanda + espelho de compatibilidade
 */

const admin = require('firebase-admin');
const firebaseConfig = require('../firebase-config');
const { logger } = require('../utils/logger');
const subscriptionStateService = require('./subscription-state-service');

const PROMOTIONS_COLLECTION = 'promotions';
const PROMOTION_REDEMPTIONS_COLLECTION = 'promotion_redemptions';
const LEGACY_PROMOTIONS_PATH = 'promotions';
const LEGACY_DRIVER_PROMOTIONS_PATH = 'driver_promotions';
const LEGACY_IMPORT_ENABLED = process.env.PROMOTIONS_ENABLE_LEGACY_IMPORT !== 'false';
const LEGACY_MIRROR_ENABLED = process.env.PROMOTIONS_ENABLE_LEGACY_RTDB_MIRROR !== 'false';

function nowIso() {
  return new Date().toISOString();
}

function normalizeId(value) {
  return String(value || '').trim();
}

function toIso(value, fallback = null) {
  if (!value) return fallback;
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number') {
    const normalized = value > 1e12 ? value : value * 1000;
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
  }
  if (typeof value === 'object') {
    if (typeof value.toDate === 'function') {
      const parsed = value.toDate();
      return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
    }
    if (typeof value._seconds === 'number') {
      return new Date((value._seconds * 1000) + Math.round((value._nanoseconds || 0) / 1e6)).toISOString();
    }
  }
  return fallback;
}

function toPositiveInt(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function promotionDocId(promotionId) {
  return normalizeId(promotionId);
}

function redemptionDocId(driverId, promotionId) {
  return `${normalizeId(driverId)}__${normalizeId(promotionId)}`;
}

function sortPromotions(rows = []) {
  return rows.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
}

function normalizePromotionRecord(record = {}, fallbackId = '') {
  const id = normalizeId(record.id || fallbackId);
  return {
    id,
    name: String(record.name || '').trim(),
    description: String(record.description || '').trim(),
    type: String(record.type || '').trim() || 'free_subscription',
    benefit: record.benefit && typeof record.benefit === 'object' ? record.benefit : {},
    eligibility: record.eligibility && typeof record.eligibility === 'object' ? record.eligibility : {},
    startDate: toIso(record.startDate, nowIso()),
    endDate: toIso(record.endDate, null),
    maxRedemptions: toPositiveInt(record.maxRedemptions, null),
    currentRedemptions: toPositiveInt(record.currentRedemptions, 0) || 0,
    status: String(record.status || '').trim() || 'active',
    createdBy: String(record.createdBy || 'admin').trim(),
    createdAt: toIso(record.createdAt, nowIso()),
    updatedAt: toIso(record.updatedAt, toIso(record.createdAt, nowIso())),
    source: String(record.source || '').trim() || 'firestore'
  };
}

function normalizeRedemptionRecord(record = {}, fallback = {}) {
  const driverId = normalizeId(record.driverId || fallback.driverId);
  const promotionId = normalizeId(record.promotionId || fallback.promotionId);
  return {
    id: normalizeId(record.id || fallback.id || redemptionDocId(driverId, promotionId)),
    driverId,
    promotionId,
    promotionName: String(record.promotionName || '').trim(),
    benefit: record.benefit && typeof record.benefit === 'object' ? record.benefit : {},
    benefitApplied: record.benefitApplied && typeof record.benefitApplied === 'object' ? record.benefitApplied : {},
    redeemedAt: toIso(record.redeemedAt, nowIso()),
    createdAt: toIso(record.createdAt, toIso(record.redeemedAt, nowIso())),
    updatedAt: toIso(record.updatedAt, toIso(record.redeemedAt, nowIso())),
    source: String(record.source || '').trim() || 'firestore'
  };
}

class PromotionService {
  constructor() {
    this.firestore = null;
    this.legacyDb = null;
  }

  getFirestore() {
    if (!this.firestore && firebaseConfig?.getFirestore) {
      this.firestore = firebaseConfig.getFirestore();
    }
    return this.firestore;
  }

  getLegacyDb() {
    if (!this.legacyDb && firebaseConfig?.getRealtimeDB) {
      this.legacyDb = firebaseConfig.getRealtimeDB();
    }
    return this.legacyDb;
  }

  promotionsCollection() {
    const firestore = this.getFirestore();
    if (!firestore) throw new Error('Firestore não disponível');
    return firestore.collection(PROMOTIONS_COLLECTION);
  }

  redemptionsCollection() {
    const firestore = this.getFirestore();
    if (!firestore) throw new Error('Firestore não disponível');
    return firestore.collection(PROMOTION_REDEMPTIONS_COLLECTION);
  }

  async mirrorPromotionToLegacy(promotion) {
    if (!LEGACY_MIRROR_ENABLED) return;
    const db = this.getLegacyDb();
    if (!db) return;
    await db.ref(`${LEGACY_PROMOTIONS_PATH}/${promotion.id}`).set({
      ...promotion,
      source: 'firestore_mirror'
    });
  }

  async mirrorRedemptionToLegacy(redemption) {
    if (!LEGACY_MIRROR_ENABLED) return;
    const db = this.getLegacyDb();
    if (!db) return;
    await db.ref(`${LEGACY_DRIVER_PROMOTIONS_PATH}/${redemption.driverId}/${redemption.promotionId}`).set({
      ...redemption,
      source: 'firestore_mirror'
    });
  }

  async mergeUserProfile(driverId, patch = {}, { legacyDb = null } = {}) {
    const safeDriverId = normalizeId(driverId);
    if (!safeDriverId) return;

    const firestore = this.getFirestore();
    if (firestore) {
      await firestore.collection('users').doc(safeDriverId).set({
        ...patch,
        updatedAt: patch.updatedAt || nowIso()
      }, { merge: true });
    }

    if (LEGACY_MIRROR_ENABLED) {
      const db = legacyDb || this.getLegacyDb();
      if (db) {
        await db.ref(`users/${safeDriverId}`).update({
          ...patch,
          updatedAt: patch.updatedAt || nowIso()
        });
      }
    }
  }

  async getDriverProfile(driverId) {
    const safeDriverId = normalizeId(driverId);
    if (!safeDriverId) return null;

    const firestore = this.getFirestore();
    if (firestore) {
      const doc = await firestore.collection('users').doc(safeDriverId).get();
      if (doc.exists) {
        return { id: doc.id, ...doc.data() };
      }
    }

    const db = this.getLegacyDb();
    if (!db) return null;
    const snapshot = await db.ref(`users/${safeDriverId}`).once('value');
    if (!snapshot.exists()) return null;
    return { id: safeDriverId, ...(snapshot.val() || {}) };
  }

  async loadAllDriverProfiles() {
    const firestore = this.getFirestore();
    if (firestore) {
      const snapshot = await firestore.collection('users').get();
      const drivers = snapshot.docs
        .map((doc) => ({ id: doc.id, ...doc.data() }))
        .filter((user) => {
          const type = String(user.usertype || user.userType || user.role || '').trim().toLowerCase();
          return type === 'driver';
        });
      if (drivers.length > 0) {
        return drivers;
      }
    }

    const db = this.getLegacyDb();
    if (!db) return [];
    const snapshot = await db.ref('users').orderByChild('usertype').equalTo('driver').once('value');
    const raw = snapshot.val() || {};
    return Object.entries(raw).map(([id, value]) => ({ id, ...(value || {}) }));
  }

  async importPromotionFromLegacy(promotionId) {
    if (!LEGACY_IMPORT_ENABLED) return null;
    const db = this.getLegacyDb();
    if (!db) return null;

    const safePromotionId = promotionDocId(promotionId);
    const snapshot = await db.ref(`${LEGACY_PROMOTIONS_PATH}/${safePromotionId}`).once('value');
    if (!snapshot.exists()) return null;

    const normalized = normalizePromotionRecord({
      ...(snapshot.val() || {}),
      source: 'rtdb_import'
    }, safePromotionId);

    await this.promotionsCollection().doc(safePromotionId).set(normalized, { merge: true });
    return normalized;
  }

  async importAllPromotionsFromLegacy() {
    if (!LEGACY_IMPORT_ENABLED) return [];
    const db = this.getLegacyDb();
    if (!db) return [];

    const snapshot = await db.ref(LEGACY_PROMOTIONS_PATH).once('value');
    const raw = snapshot.val() || {};
    const rows = Object.entries(raw).map(([id, value]) => normalizePromotionRecord({
      ...(value || {}),
      source: 'rtdb_import'
    }, id));

    if (rows.length === 0) return [];

    for (let index = 0; index < rows.length; index += 400) {
      const batch = this.getFirestore().batch();
      rows.slice(index, index + 400).forEach((promotion) => {
        batch.set(this.promotionsCollection().doc(promotion.id), promotion, { merge: true });
      });
      await batch.commit();
    }

    return rows;
  }

  async importRedemptionFromLegacy(driverId, promotionId) {
    if (!LEGACY_IMPORT_ENABLED) return null;
    const db = this.getLegacyDb();
    if (!db) return null;

    const safeDriverId = normalizeId(driverId);
    const safePromotionId = normalizeId(promotionId);
    const snapshot = await db.ref(`${LEGACY_DRIVER_PROMOTIONS_PATH}/${safeDriverId}/${safePromotionId}`).once('value');
    if (!snapshot.exists()) return null;

    const normalized = normalizeRedemptionRecord({
      ...(snapshot.val() || {}),
      source: 'rtdb_import'
    }, {
      id: redemptionDocId(safeDriverId, safePromotionId),
      driverId: safeDriverId,
      promotionId: safePromotionId
    });

    await this.redemptionsCollection().doc(normalized.id).set(normalized, { merge: true });
    return normalized;
  }

  async importAllRedemptionsFromLegacy() {
    if (!LEGACY_IMPORT_ENABLED) return [];
    const db = this.getLegacyDb();
    if (!db) return [];

    const snapshot = await db.ref(LEGACY_DRIVER_PROMOTIONS_PATH).once('value');
    const raw = snapshot.val() || {};
    const rows = [];

    Object.entries(raw).forEach(([driverId, promotions]) => {
      Object.entries(promotions || {}).forEach(([promotionId, value]) => {
        rows.push(normalizeRedemptionRecord({
          ...(value || {}),
          source: 'rtdb_import'
        }, {
          id: redemptionDocId(driverId, promotionId),
          driverId,
          promotionId
        }));
      });
    });

    if (rows.length === 0) return [];

    for (let index = 0; index < rows.length; index += 400) {
      const batch = this.getFirestore().batch();
      rows.slice(index, index + 400).forEach((redemption) => {
        batch.set(this.redemptionsCollection().doc(redemption.id), redemption, { merge: true });
      });
      await batch.commit();
    }

    return rows;
  }

  async fetchPromotion(promotionId) {
    const safePromotionId = promotionDocId(promotionId);
    if (!safePromotionId) return null;

    const doc = await this.promotionsCollection().doc(safePromotionId).get();
    if (doc.exists) {
      return normalizePromotionRecord(doc.data(), doc.id);
    }

    return this.importPromotionFromLegacy(safePromotionId);
  }

  async fetchRedemption(driverId, promotionId) {
    const safeDriverId = normalizeId(driverId);
    const safePromotionId = normalizeId(promotionId);
    if (!safeDriverId || !safePromotionId) return null;

    const docId = redemptionDocId(safeDriverId, safePromotionId);
    const doc = await this.redemptionsCollection().doc(docId).get();
    if (doc.exists) {
      return normalizeRedemptionRecord(doc.data(), {
        id: doc.id,
        driverId: safeDriverId,
        promotionId: safePromotionId
      });
    }

    return this.importRedemptionFromLegacy(safeDriverId, safePromotionId);
  }

  async listRedemptionsByPromotion(promotionId) {
    const safePromotionId = normalizeId(promotionId);
    const snapshot = await this.redemptionsCollection()
      .where('promotionId', '==', safePromotionId)
      .get();

    let rows = snapshot.docs.map((doc) => normalizeRedemptionRecord(doc.data(), { id: doc.id, promotionId: safePromotionId }));
    if (rows.length === 0) {
      await this.importAllRedemptionsFromLegacy();
      const imported = await this.redemptionsCollection()
        .where('promotionId', '==', safePromotionId)
        .get();
      rows = imported.docs.map((doc) => normalizeRedemptionRecord(doc.data(), { id: doc.id, promotionId: safePromotionId }));
    }
    return rows;
  }

  async listAllRedemptions() {
    let snapshot = await this.redemptionsCollection().get();
    let rows = snapshot.docs.map((doc) => normalizeRedemptionRecord(doc.data(), { id: doc.id }));
    if (rows.length === 0) {
      rows = await this.importAllRedemptionsFromLegacy();
    }
    return rows;
  }

  async createPromotion(promotionData) {
    try {
      const {
        name,
        description,
        type,
        benefit,
        eligibility,
        startDate,
        endDate,
        maxRedemptions,
        createdBy,
        status = 'active'
      } = promotionData || {};

      if (!name || !type || !benefit || !eligibility) {
        throw new Error('Dados obrigatórios faltando');
      }

      const promotionId = `promo_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
      const promotion = normalizePromotionRecord({
        id: promotionId,
        name,
        description,
        type,
        benefit,
        eligibility,
        startDate: startDate || nowIso(),
        endDate: endDate || null,
        maxRedemptions: maxRedemptions || null,
        currentRedemptions: 0,
        status,
        createdBy: createdBy || 'admin',
        createdAt: nowIso(),
        updatedAt: nowIso(),
        source: 'firestore'
      }, promotionId);

      await this.promotionsCollection().doc(promotionId).set(promotion, { merge: true });
      await this.mirrorPromotionToLegacy(promotion);

      logger.info(`✅ Promoção criada: ${promotionId} - ${promotion.name}`);
      return { success: true, promotion };
    } catch (error) {
      logger.error('❌ Erro ao criar promoção:', error);
      throw error;
    }
  }

  async getPromotionById(promotionId) {
    const promotion = await this.fetchPromotion(promotionId);
    if (!promotion) {
      return {
        success: false,
        error: 'Promoção não encontrada'
      };
    }

    const redemptions = await this.listRedemptionsByPromotion(promotion.id);
    return {
      success: true,
      promotion: {
        ...promotion,
        actualRedemptions: redemptions.length
      }
    };
  }

  async updatePromotion(promotionId, incomingUpdates = {}) {
    const current = await this.fetchPromotion(promotionId);
    if (!current) {
      return {
        success: false,
        error: 'Promoção não encontrada'
      };
    }

    const allowedUpdates = ['name', 'description', 'status', 'endDate', 'maxRedemptions', 'benefit', 'eligibility', 'startDate', 'type'];
    const next = {
      ...current,
      updatedAt: nowIso(),
      source: 'firestore'
    };

    allowedUpdates.forEach((field) => {
      if (incomingUpdates[field] !== undefined) {
        next[field] = incomingUpdates[field];
      }
    });

    const normalized = normalizePromotionRecord(next, current.id);
    await this.promotionsCollection().doc(normalized.id).set(normalized, { merge: true });
    await this.mirrorPromotionToLegacy(normalized);

    return {
      success: true,
      promotion: normalized,
      message: 'Promoção atualizada com sucesso'
    };
  }

  async listPromotions(filters = {}) {
    try {
      let snapshot = await this.promotionsCollection().get();
      let promotions = snapshot.docs.map((doc) => normalizePromotionRecord(doc.data(), doc.id));
      if (promotions.length === 0) {
        promotions = await this.importAllPromotionsFromLegacy();
      }

      let result = promotions.slice();
      if (filters.status) {
        result = result.filter((promotion) => promotion.status === filters.status);
      }
      if (filters.type) {
        result = result.filter((promotion) => promotion.type === filters.type);
      }

      return {
        success: true,
        promotions: sortPromotions(result),
        count: result.length
      };
    } catch (error) {
      logger.error('❌ Erro ao listar promoções:', error);
      throw error;
    }
  }

  async getStats() {
    const { promotions } = await this.listPromotions();
    const redemptions = await this.listAllRedemptions();

    const stats = {
      total: promotions.length,
      active: 0,
      paused: 0,
      completed: 0,
      expired: 0,
      totalRedemptions: redemptions.length,
      byType: {}
    };

    promotions.forEach((promotion) => {
      const statusKey = String(promotion.status || '').trim();
      stats[statusKey] = (stats[statusKey] || 0) + 1;
      if (!stats.byType[promotion.type]) {
        stats.byType[promotion.type] = 0;
      }
      stats.byType[promotion.type] += 1;
    });

    return {
      success: true,
      stats
    };
  }

  async checkEligibility(driverId, promotionId) {
    try {
      const promotion = await this.fetchPromotion(promotionId);
      if (!promotion) {
        return { eligible: false, reason: 'Promoção não encontrada' };
      }

      if (promotion.status !== 'active') {
        return { eligible: false, reason: `Promoção ${promotion.status}` };
      }

      const now = new Date();
      const startDate = new Date(promotion.startDate);
      if (Number.isFinite(startDate.getTime()) && now < startDate) {
        return { eligible: false, reason: 'Promoção ainda não iniciou' };
      }

      if (promotion.endDate) {
        const endDate = new Date(promotion.endDate);
        if (Number.isFinite(endDate.getTime()) && now > endDate) {
          return { eligible: false, reason: 'Promoção expirada' };
        }
      }

      if (promotion.maxRedemptions && promotion.currentRedemptions >= promotion.maxRedemptions) {
        return { eligible: false, reason: 'Limite de resgates atingido' };
      }

      const existingRedemption = await this.fetchRedemption(driverId, promotion.id);
      if (existingRedemption) {
        return { eligible: false, reason: 'Motorista já resgatou esta promoção' };
      }

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

  async checkEligibilityCriteria(driverId, eligibility = {}) {
    try {
      const { criteria, value, endDate } = eligibility || {};
      switch (criteria) {
        case 'first_n_drivers':
          return this.checkFirstNDrivers(driverId, value, endDate);
        case 'registration_date_range':
          return this.checkRegistrationDateRange(driverId, eligibility.startDate, endDate);
        case 'all_drivers':
          return { eligible: true };
        case 'specific_drivers':
          return this.checkSpecificDrivers(driverId, eligibility.driverIds || []);
        default:
          return { eligible: false, reason: `Critério desconhecido: ${criteria}` };
      }
    } catch (error) {
      logger.error('❌ Erro ao verificar critérios:', error);
      return {
        eligible: false,
        reason: 'Erro ao verificar critérios'
      };
    }
  }

  async checkFirstNDrivers(driverId, maxDrivers, endDate) {
    try {
      const driver = await this.getDriverProfile(driverId);
      if (!driver) {
        return { eligible: false, reason: 'Motorista não encontrado' };
      }

      const driverCreatedAt = new Date(driver.createdAt || driver.created_at || Date.now());
      if (endDate) {
        const promoEndDate = new Date(endDate);
        if (Number.isFinite(promoEndDate.getTime()) && driverCreatedAt > promoEndDate) {
          return { eligible: false, reason: 'Cadastro após data limite da promoção' };
        }
      }

      const allDrivers = await this.loadAllDriverProfiles();
      const driversBefore = allDrivers.filter((candidate) => {
        const createdAt = new Date(candidate.createdAt || candidate.created_at || Date.now());
        return createdAt <= driverCreatedAt;
      });

      const position = driversBefore.length;
      if (position <= Number(maxDrivers)) {
        return { eligible: true, position, maxDrivers: Number(maxDrivers) };
      }

      return {
        eligible: false,
        reason: `Motorista é o ${position}º cadastrado, limite é ${maxDrivers}`,
        position,
        maxDrivers: Number(maxDrivers)
      };
    } catch (error) {
      logger.error('❌ Erro ao verificar primeiros N motoristas:', error);
      return { eligible: false, reason: 'Erro ao verificar posição' };
    }
  }

  async checkRegistrationDateRange(driverId, startDate, endDate) {
    try {
      const driver = await this.getDriverProfile(driverId);
      if (!driver) {
        return { eligible: false, reason: 'Motorista não encontrado' };
      }

      const driverCreatedAt = new Date(driver.createdAt || driver.created_at || Date.now());
      const promoStart = new Date(startDate);
      const promoEnd = new Date(endDate);
      if (driverCreatedAt >= promoStart && driverCreatedAt <= promoEnd) {
        return { eligible: true };
      }

      return { eligible: false, reason: 'Cadastro fora do período da promoção' };
    } catch (error) {
      logger.error('❌ Erro ao verificar período de cadastro:', error);
      return { eligible: false, reason: 'Erro ao verificar período' };
    }
  }

  async checkSpecificDrivers(driverId, driverIds) {
    if ((driverIds || []).map((value) => normalizeId(value)).includes(normalizeId(driverId))) {
      return { eligible: true };
    }
    return { eligible: false, reason: 'Motorista não está na lista elegível' };
  }

  async applyPromotion(driverId, promotionId) {
    try {
      const eligibilityCheck = await this.checkEligibility(driverId, promotionId);
      if (!eligibilityCheck.eligible) {
        return { success: false, error: eligibilityCheck.reason };
      }

      const promotion = eligibilityCheck.promotion;
      const benefitResult = await this.applyBenefit(driverId, promotion.benefit);
      if (!benefitResult.success) {
        return benefitResult;
      }

      const redemption = normalizeRedemptionRecord({
        id: redemptionDocId(driverId, promotion.id),
        driverId,
        promotionId: promotion.id,
        promotionName: promotion.name,
        benefit: promotion.benefit,
        redeemedAt: nowIso(),
        benefitApplied: benefitResult.data,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        source: 'firestore'
      }, {
        driverId,
        promotionId: promotion.id
      });

      await this.redemptionsCollection().doc(redemption.id).set(redemption, { merge: true });
      await this.mirrorRedemptionToLegacy(redemption);

      const nextRedemptions = (promotion.currentRedemptions || 0) + 1;
      const nextStatus = promotion.maxRedemptions && nextRedemptions >= promotion.maxRedemptions
        ? 'completed'
        : promotion.status;

      const updatedPromotion = normalizePromotionRecord({
        ...promotion,
        currentRedemptions: nextRedemptions,
        status: nextStatus,
        updatedAt: nowIso(),
        source: 'firestore'
      }, promotion.id);

      await this.promotionsCollection().doc(updatedPromotion.id).set(updatedPromotion, { merge: true });
      await this.mirrorPromotionToLegacy(updatedPromotion);

      logger.info(`✅ Promoção aplicada: ${promotion.id} para motorista ${driverId}`);
      return {
        success: true,
        redemption,
        benefit: benefitResult.data
      };
    } catch (error) {
      logger.error('❌ Erro ao aplicar promoção:', error);
      return { success: false, error: error.message };
    }
  }

  async applyBenefit(driverId, benefit = {}) {
    try {
      switch (benefit.type) {
        case 'free_subscription':
          return this.applyFreeSubscription(driverId, benefit);
        case 'discount':
          return this.applyDiscount(driverId, benefit);
        case 'trial_extension':
          return this.applyTrialExtension(driverId, benefit);
        default:
          return { success: false, error: `Tipo de benefício desconhecido: ${benefit.type}` };
      }
    } catch (error) {
      logger.error('❌ Erro ao aplicar benefício:', error);
      return { success: false, error: error.message };
    }
  }

  async applyFreeSubscription(driverId, benefit = {}) {
    try {
      const db = this.getLegacyDb();
      const driver = await this.getDriverProfile(driverId);
      if (!driver) {
        return { success: false, error: 'Motorista não encontrado' };
      }

      const now = new Date();
      const duration = benefit.duration || 30;
      const unit = benefit.unit || 'days';
      let endDate = new Date(now);
      if (unit === 'days') endDate.setDate(endDate.getDate() + duration);
      else if (unit === 'months') endDate.setMonth(endDate.getMonth() + duration);
      else if (unit === 'weeks') endDate.setDate(endDate.getDate() + (duration * 7));

      const existingFreeEnd = driver.promotion_free_end ? new Date(driver.promotion_free_end) : null;
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

      const updates = {
        promotion_free_start: now.toISOString(),
        promotion_free_end: endDate.toISOString(),
        promotion_active: true,
        updatedAt: now.toISOString()
      };

      await this.mergeUserProfile(driverId, updates, { legacyDb: db });

      const subscriptionState = await subscriptionStateService.getState(driverId, {
        db,
        syncIfMissing: false
      });
      if (subscriptionState.exists) {
        await subscriptionStateService.runTransaction(driverId, (state) => ({
          ...state,
          promotionFreeUntil: endDate.toISOString(),
          updatedAt: now.toISOString()
        }), { db });
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
      return { success: false, error: error.message };
    }
  }

  async applyDiscount(_driverId, benefit = {}) {
    return {
      success: true,
      data: {
        type: 'discount',
        discount: benefit.discount || 0
      }
    };
  }

  async applyTrialExtension(driverId, benefit = {}) {
    try {
      const db = this.getLegacyDb();
      const driver = await this.getDriverProfile(driverId);
      if (!driver) {
        return { success: false, error: 'Motorista não encontrado' };
      }

      const now = new Date();
      const duration = benefit.duration || 30;
      const unit = benefit.unit || 'days';
      let newEndDate = new Date(now);
      if (unit === 'days') newEndDate.setDate(newEndDate.getDate() + duration);
      else if (unit === 'months') newEndDate.setMonth(newEndDate.getMonth() + duration);

      const existingTrialEnd = driver.free_trial_end ? new Date(driver.free_trial_end) : null;
      if (existingTrialEnd && existingTrialEnd > now) {
        newEndDate = new Date(existingTrialEnd);
        if (unit === 'days') newEndDate.setDate(newEndDate.getDate() + duration);
        else if (unit === 'months') newEndDate.setMonth(newEndDate.getMonth() + duration);
      }

      await this.mergeUserProfile(driverId, {
        free_trial_end: newEndDate.toISOString(),
        updatedAt: now.toISOString()
      }, { legacyDb: db });

      return {
        success: true,
        data: {
          type: 'trial_extension',
          newEndDate: newEndDate.toISOString()
        }
      };
    } catch (error) {
      logger.error('❌ Erro ao estender trial:', error);
      return { success: false, error: error.message };
    }
  }

  async checkAndApplyEligiblePromotions(driverId) {
    try {
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
        results,
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

  async checkFreePeriod(driverId) {
    try {
      const driver = await this.getDriverProfile(driverId);
      if (!driver) {
        return { isFree: false, reason: 'Motorista não encontrado' };
      }

      const now = new Date();
      const freeEnds = [];
      const freeTypes = [];

      if (driver.free_trial_end) {
        const trialEnd = new Date(driver.free_trial_end);
        if (now < trialEnd) {
          freeEnds.push(trialEnd);
          freeTypes.push('trial');
        }
      }

      if (driver.free_months_end) {
        const monthsEnd = new Date(driver.free_months_end);
        if (now < monthsEnd) {
          freeEnds.push(monthsEnd);
          freeTypes.push('referral');
        }
      }

      if (driver.promotion_free_end) {
        const promoEnd = new Date(driver.promotion_free_end);
        if (now < promoEnd) {
          freeEnds.push(promoEnd);
          freeTypes.push('promotion');
        }
      }

      if (freeEnds.length === 0) {
        return { isFree: false, reason: 'Nenhum período grátis ativo' };
      }

      const latestFreeEnd = new Date(Math.max(...freeEnds.map((date) => date.getTime())));
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
      return { isFree: false, reason: 'Erro ao verificar período grátis' };
    }
  }
}

module.exports = new PromotionService();
