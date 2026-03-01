/**
 * Audit Service
 * 
 * Serviço centralizado para logs de auditoria
 * Registra todas as ações críticas do sistema
 */

const firebaseConfig = require('../firebase-config');
const { logStructured, logError } = require('../utils/logger');

class AuditService {
  constructor() {
    this.collectionName = 'audit_logs';
    this.severityLevels = {
      INFO: 1,
      WARNING: 2,
      ERROR: 3,
      CRITICAL: 4
    };
  }

  /**
   * Registrar evento de auditoria
   * @param {Object} eventData - Dados do evento
   * @param {string} eventData.userId - ID do usuário
   * @param {string} eventData.action - Ação realizada (ex: 'createBooking', 'confirmPayment')
   * @param {string} eventData.resource - Recurso afetado (ex: 'booking', 'payment')
   * @param {string} eventData.severity - Severidade (INFO, WARNING, ERROR, CRITICAL)
   * @param {Object} eventData.details - Detalhes adicionais
   * @param {string} eventData.ip - IP do usuário
   * @param {string} eventData.userAgent - User agent
   * @param {string} eventData.socketId - ID do socket WebSocket
   * @param {boolean} eventData.success - Se a ação foi bem-sucedida
   * @param {string} eventData.error - Mensagem de erro (se houver)
   * @returns {Promise<{success: boolean, logId?: string, error?: string}>}
   */
  async logEvent(eventData) {
    try {
      const {
        userId,
        action,
        resource,
        severity = 'INFO',
        details = {},
        ip = 'unknown',
        userAgent = 'unknown',
        socketId = null,
        success = true,
        error = null
      } = eventData;

      if (!userId || !action) {
        logStructured('warn', 'Evento de auditoria sem userId ou action', { service: 'audit-service', eventData });
        return { success: false, error: 'userId e action são obrigatórios' };
      }

      const firestore = firebaseConfig.getFirestore();
      if (!firestore) {
        logStructured('warn', 'Firestore não disponível, logando apenas no console', { service: 'audit-service' });
        this.logToConsole(eventData);
        return { success: false, error: 'Firestore não disponível' };
      }

      // Criar documento de log
      const logDocument = {
        userId: userId,
        action: action,
        resource: resource || action,
        severity: severity,
        severityLevel: this.severityLevels[severity] || 1,
        details: details,
        ip: ip,
        userAgent: userAgent,
        socketId: socketId,
        success: success,
        error: error,
        timestamp: new Date(),
        createdAt: new Date(),
        // Índices para consultas rápidas
        date: new Date().toISOString().split('T')[0], // YYYY-MM-DD
        hour: new Date().getHours(),
        dayOfWeek: new Date().getDay()
      };

      // Salvar no Firestore
      const auditRef = firestore.collection(this.collectionName);
      const docRef = await auditRef.add(logDocument);

      // Log no console para desenvolvimento
      if (process.env.NODE_ENV !== 'production') {
        this.logToConsole({
          ...eventData,
          logId: docRef.id
        });
      }

      // Log de auditoria crítica no console sempre
      if (severity === 'CRITICAL' || severity === 'ERROR') {
        const emoji = severity === 'CRITICAL' ? '🔴' : '⚠️';
        logStructured('error', `AUDITORIA ${severity}: ${action} por ${userId}`, {
          service: 'audit-service',
          severity,
          action,
          userId,
          resource,
          success,
          error,
          logId: docRef.id
        });
      }

      return {
        success: true,
        logId: docRef.id
      };

    } catch (error) {
      logError(error, 'Erro ao registrar evento de auditoria', { service: 'audit-service' });
      // Logar no console mesmo se Firestore falhar
      this.logToConsole(eventData);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Logar no console (fallback)
   * @param {Object} eventData - Dados do evento
   */
  logToConsole(eventData) {
    const {
      userId,
      action,
      resource,
      severity = 'INFO',
      success = true,
      error = null,
      logId = null
    } = eventData;

    const emoji = {
      INFO: '📋',
      WARNING: '⚠️',
      ERROR: '❌',
      CRITICAL: '🔴'
    }[severity] || '📋';

    const status = success ? '✅' : '❌';
    const message = `${emoji} [AUDITORIA] ${status} ${action} | User: ${userId} | Resource: ${resource || action} | Severity: ${severity}`;

    if (error) {
      logStructured('info', message, { service: 'audit-service', error, logId });
    } else {
      logStructured('info', message, { service: 'audit-service', logId });
    }
  }

  /**
   * Registrar ação de corrida
   * @param {string} userId - ID do usuário
   * @param {string} action - Ação (createBooking, acceptRide, startTrip, finishTrip, cancelRide)
   * @param {string} bookingId - ID da corrida
   * @param {Object} details - Detalhes adicionais
   * @param {boolean} success - Se foi bem-sucedida
   * @param {string} error - Erro (se houver)
   * @param {Object} metadata - Metadados (ip, userAgent, socketId)
   * @returns {Promise<{success: boolean, logId?: string}>}
   */
  async logRideAction(userId, action, bookingId, details = {}, success = true, error = null, metadata = {}) {
    const severity = this.getSeverityForRideAction(action, success);

    return await this.logEvent({
      userId,
      action,
      resource: 'ride',
      resourceId: bookingId,
      severity,
      details: {
        bookingId,
        ...details
      },
      success,
      error,
      ...metadata
    });
  }

  /**
   * Registrar ação de pagamento
   * @param {string} userId - ID do usuário
   * @param {string} action - Ação (confirmPayment, releasePayment, refundPayment)
   * @param {string} bookingId - ID da corrida
   * @param {string} chargeId - ID da cobrança
   * @param {Object} details - Detalhes adicionais
   * @param {boolean} success - Se foi bem-sucedida
   * @param {string} error - Erro (se houver)
   * @param {Object} metadata - Metadados (ip, userAgent, socketId)
   * @returns {Promise<{success: boolean, logId?: string}>}
   */
  async logPaymentAction(userId, action, bookingId, chargeId, details = {}, success = true, error = null, metadata = {}) {
    const severity = this.getSeverityForPaymentAction(action, success);

    return await this.logEvent({
      userId,
      action,
      resource: 'payment',
      resourceId: chargeId || bookingId,
      severity,
      details: {
        bookingId,
        chargeId,
        ...details
      },
      success,
      error,
      ...metadata
    });
  }

  /**
   * Registrar ação de segurança
   * @param {string} userId - ID do usuário
   * @param {string} action - Ação (rateLimitExceeded, unauthorizedAccess, validationFailed)
   * @param {string} resource - Recurso afetado
   * @param {Object} details - Detalhes adicionais
   * @param {Object} metadata - Metadados (ip, userAgent, socketId)
   * @returns {Promise<{success: boolean, logId?: string}>}
   */
  async logSecurityAction(userId, action, resource, details = {}, metadata = {}) {
    return await this.logEvent({
      userId,
      action,
      resource,
      severity: 'WARNING',
      details,
      success: false,
      ...metadata
    });
  }

  /**
   * Obter severidade para ação de corrida
   * @param {string} action - Ação
   * @param {boolean} success - Se foi bem-sucedida
   * @returns {string} Severidade
   */
  getSeverityForRideAction(action, success) {
    if (!success) {
      return 'ERROR';
    }

    const criticalActions = ['finishTrip', 'cancelRide'];
    if (criticalActions.includes(action)) {
      return 'WARNING';
    }

    return 'INFO';
  }

  /**
   * Obter severidade para ação de pagamento
   * @param {string} action - Ação
   * @param {boolean} success - Se foi bem-sucedida
   * @returns {string} Severidade
   */
  getSeverityForPaymentAction(action, success) {
    if (!success) {
      return 'CRITICAL';
    }

    const criticalActions = ['confirmPayment', 'releasePayment', 'refundPayment'];
    if (criticalActions.includes(action)) {
      return 'WARNING';
    }

    return 'INFO';
  }

  /**
   * Buscar logs de auditoria
   * @param {Object} filters - Filtros
   * @param {string} filters.userId - Filtrar por usuário
   * @param {string} filters.action - Filtrar por ação
   * @param {string} filters.resource - Filtrar por recurso
   * @param {string} filters.severity - Filtrar por severidade
   * @param {Date} filters.startDate - Data inicial
   * @param {Date} filters.endDate - Data final
   * @param {number} limit - Limite de resultados
   * @returns {Promise<{success: boolean, logs?: Array, error?: string}>}
   */
  async getAuditLogs(filters = {}, limit = 100) {
    try {
      const firestore = firebaseConfig.getFirestore();
      if (!firestore) {
        return { success: false, error: 'Firestore não disponível' };
      }

      let query = firestore.collection(this.collectionName);

      // Aplicar filtros
      if (filters.userId) {
        query = query.where('userId', '==', filters.userId);
      }

      if (filters.action) {
        query = query.where('action', '==', filters.action);
      }

      if (filters.resource) {
        query = query.where('resource', '==', filters.resource);
      }

      if (filters.severity) {
        query = query.where('severity', '==', filters.severity);
      }

      if (filters.startDate) {
        query = query.where('timestamp', '>=', filters.startDate);
      }

      if (filters.endDate) {
        query = query.where('timestamp', '<=', filters.endDate);
      }

      // Ordenar por timestamp (mais recentes primeiro)
      // Se houver filtros, tentar ordenar (pode precisar de índice composto)
      // Se falhar, ordenar em memória
      let snapshot;
      let needsInMemorySort = false;

      try {
        query = query.orderBy('timestamp', 'desc').limit(limit);
        snapshot = await query.get();
      } catch (indexError) {
        // Se precisar de índice composto, buscar sem ordenação e ordenar em memória
        logStructured('warn', 'Índice composto não disponível, ordenando em memória', { service: 'audit-service' });
        needsInMemorySort = true;
        // Remover orderBy e buscar mais documentos
        query = firestore.collection(this.collectionName);

        // Reaplicar filtros
        if (filters.userId) query = query.where('userId', '==', filters.userId);
        if (filters.action) query = query.where('action', '==', filters.action);
        if (filters.resource) query = query.where('resource', '==', filters.resource);
        if (filters.severity) query = query.where('severity', '==', filters.severity);
        if (filters.startDate) query = query.where('timestamp', '>=', filters.startDate);
        if (filters.endDate) query = query.where('timestamp', '<=', filters.endDate);

        query = query.limit(limit * 2); // Buscar mais para garantir que temos os mais recentes
        snapshot = await query.get();
      }

      const logs = [];

      snapshot.forEach((doc) => {
        const data = doc.data();
        logs.push({
          id: doc.id,
          ...data,
          timestamp: data.timestamp?.toDate?.()?.toISOString() || null,
          createdAt: data.createdAt?.toDate?.()?.toISOString() || null
        });
      });

      // Ordenar em memória se necessário
      if (needsInMemorySort && logs.length > 0) {
        logs.sort((a, b) => {
          const timeA = new Date(a.timestamp || a.createdAt || 0).getTime();
          const timeB = new Date(b.timestamp || b.createdAt || 0).getTime();
          return timeB - timeA; // Mais recentes primeiro
        });
      }

      // Limitar após ordenação
      const limitedLogs = logs.slice(0, limit);

      return {
        success: true,
        logs: limitedLogs,
        total: limitedLogs.length
      };

    } catch (error) {
      logError(error, 'Erro ao buscar logs de auditoria', { service: 'audit-service' });
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Obter estatísticas de auditoria
   * @param {Date} startDate - Data inicial
   * @param {Date} endDate - Data final
   * @returns {Promise<{success: boolean, stats?: Object, error?: string}>}
   */
  async getAuditStats(startDate = null, endDate = null) {
    try {
      const firestore = firebaseConfig.getFirestore();
      if (!firestore) {
        return { success: false, error: 'Firestore não disponível' };
      }

      let query = firestore.collection(this.collectionName);

      if (startDate) {
        query = query.where('timestamp', '>=', startDate);
      }

      if (endDate) {
        query = query.where('timestamp', '<=', endDate);
      }

      const snapshot = await query.get();

      const stats = {
        total: 0,
        bySeverity: {},
        byAction: {},
        byResource: {},
        successRate: 0,
        errorRate: 0
      };

      let successCount = 0;
      let errorCount = 0;

      snapshot.forEach((doc) => {
        const data = doc.data();
        stats.total++;

        // Por severidade
        stats.bySeverity[data.severity] = (stats.bySeverity[data.severity] || 0) + 1;

        // Por ação
        stats.byAction[data.action] = (stats.byAction[data.action] || 0) + 1;

        // Por recurso
        stats.byResource[data.resource] = (stats.byResource[data.resource] || 0) + 1;

        // Taxa de sucesso
        if (data.success) {
          successCount++;
        } else {
          errorCount++;
        }
      });

      if (stats.total > 0) {
        stats.successRate = (successCount / stats.total) * 100;
        stats.errorRate = (errorCount / stats.total) * 100;
      }

      return {
        success: true,
        stats
      };

    } catch (error) {
      logError(error, 'Erro ao obter estatísticas', { service: 'audit-service' });
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = new AuditService();

