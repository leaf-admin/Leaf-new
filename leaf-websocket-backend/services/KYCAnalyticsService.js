/**
 * KYCAnalyticsService - Serviço de analytics para verificação KYC
 * 
 * Este serviço coleta e analisa métricas de verificação facial,
 * incluindo taxas de sucesso, tempos de processamento e padrões de uso.
 */

const Redis = require('ioredis');
const { logStructured, logError } = require('../utils/logger');

class KYCAnalyticsService {
  constructor() {
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      db: process.env.REDIS_DB || 0,
      password: process.env.REDIS_PASSWORD || null
    });
    
    this.metricsPrefix = 'kyc:analytics:';
    this.realtimePrefix = 'kyc:realtime:';
    
    // Configurações de retenção de dados
    this.retentionDays = 30;
    this.realtimeRetentionHours = 24;
  }

  /**
   * Registrar tentativa de verificação
   */
  async trackVerificationAttempt(driverId, attemptData) {
    const timestamp = Date.now();
    const dateKey = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    
    try {
      // Dados da tentativa
      const attemptRecord = {
        driverId,
        timestamp,
        attempt: attemptData.attempt || 1,
        confidence: attemptData.confidence || 0,
        duration: attemptData.duration || 0,
        success: attemptData.success || false,
        retryReason: attemptData.retryReason || null,
        errorMessage: attemptData.errorMessage || null,
        imageQuality: attemptData.imageQuality || 'unknown',
        deviceInfo: attemptData.deviceInfo || {},
        location: attemptData.location || null
      };

      // 1. Armazenar tentativa individual
      await this.redis.hset(
        `${this.metricsPrefix}attempts:${driverId}`,
        `${timestamp}`,
        JSON.stringify(attemptRecord)
      );

      // 2. Atualizar métricas diárias
      await this.updateDailyMetrics(dateKey, attemptRecord);

      // 3. Atualizar métricas do driver
      await this.updateDriverMetrics(driverId, attemptRecord);

      // 4. Atualizar métricas globais
      await this.updateGlobalMetrics(attemptRecord);

      // 5. Atualizar métricas em tempo real
      await this.updateRealtimeMetrics(attemptRecord);

      logStructured('info', `📊 [KYCAnalytics] Tentativa registrada para driver ${driverId}`);
      
      return { success: true, timestamp };
      
    } catch (error) {
      logError(error, '❌ [KYCAnalytics] Erro ao registrar tentativa:', { service: 'KYCAnalyticsService' });
      throw error;
    }
  }

  /**
   * Atualizar métricas diárias
   */
  async updateDailyMetrics(dateKey, attemptRecord) {
    const dailyKey = `${this.metricsPrefix}daily:${dateKey}`;
    
    await this.redis.hincrby(dailyKey, 'totalAttempts', 1);
    
    if (attemptRecord.success) {
      await this.redis.hincrby(dailyKey, 'successfulAttempts', 1);
    } else {
      await this.redis.hincrby(dailyKey, 'failedAttempts', 1);
    }
    
    // Atualizar confiança média
    await this.redis.hincrbyfloat(dailyKey, 'totalConfidence', attemptRecord.confidence);
    await this.redis.hincrbyfloat(dailyKey, 'totalDuration', attemptRecord.duration);
    
    // Definir TTL para 30 dias
    await this.redis.expire(dailyKey, this.retentionDays * 24 * 3600);
  }

  /**
   * Atualizar métricas do driver
   */
  async updateDriverMetrics(driverId, attemptRecord) {
    const driverKey = `${this.metricsPrefix}driver:${driverId}`;
    
    await this.redis.hincrby(driverKey, 'totalAttempts', 1);
    
    if (attemptRecord.success) {
      await this.redis.hincrby(driverKey, 'successfulAttempts', 1);
    } else {
      await this.redis.hincrby(driverKey, 'failedAttempts', 1);
    }
    
    // Atualizar confiança média
    await this.redis.hincrbyfloat(driverKey, 'totalConfidence', attemptRecord.confidence);
    await this.redis.hincrbyfloat(driverKey, 'totalDuration', attemptRecord.duration);
    
    // Atualizar última tentativa
    await this.redis.hset(driverKey, 'lastAttempt', JSON.stringify({
      timestamp: attemptRecord.timestamp,
      success: attemptRecord.success,
      confidence: attemptRecord.confidence,
      duration: attemptRecord.duration
    }));
    
    // Definir TTL para 30 dias
    await this.redis.expire(driverKey, this.retentionDays * 24 * 3600);
  }

  /**
   * Atualizar métricas globais
   */
  async updateGlobalMetrics(attemptRecord) {
    const globalKey = `${this.metricsPrefix}global`;
    
    await this.redis.hincrby(globalKey, 'totalAttempts', 1);
    
    if (attemptRecord.success) {
      await this.redis.hincrby(globalKey, 'successfulAttempts', 1);
    } else {
      await this.redis.hincrby(globalKey, 'failedAttempts', 1);
    }
    
    // Atualizar confiança média
    await this.redis.hincrbyfloat(globalKey, 'totalConfidence', attemptRecord.confidence);
    await this.redis.hincrbyfloat(globalKey, 'totalDuration', attemptRecord.duration);
    
    // Atualizar contadores por razão de retry
    if (attemptRecord.retryReason) {
      await this.redis.hincrby(globalKey, `retryReason:${attemptRecord.retryReason}`, 1);
    }
  }

  /**
   * Atualizar métricas em tempo real
   */
  async updateRealtimeMetrics(attemptRecord) {
    const realtimeKey = `${this.realtimePrefix}${Date.now()}`;
    
    await this.redis.hset(realtimeKey, 'data', JSON.stringify(attemptRecord));
    await this.redis.expire(realtimeKey, this.realtimeRetentionHours * 3600);
  }

  /**
   * Obter métricas de um driver
   */
  async getDriverMetrics(driverId, days = 7) {
    try {
      const driverKey = `${this.metricsPrefix}driver:${driverId}`;
      const driverData = await this.redis.hgetall(driverKey);
      
      if (!driverData || Object.keys(driverData).length === 0) {
        return null;
      }
      
      const totalAttempts = parseInt(driverData.totalAttempts) || 0;
      const successfulAttempts = parseInt(driverData.successfulAttempts) || 0;
      const failedAttempts = parseInt(driverData.failedAttempts) || 0;
      const totalConfidence = parseFloat(driverData.totalConfidence) || 0;
      const totalDuration = parseFloat(driverData.totalDuration) || 0;
      
      return {
        driverId,
        totalAttempts,
        successfulAttempts,
        failedAttempts,
        successRate: totalAttempts > 0 ? (successfulAttempts / totalAttempts) * 100 : 0,
        averageConfidence: totalAttempts > 0 ? totalConfidence / totalAttempts : 0,
        averageDuration: totalAttempts > 0 ? totalDuration / totalAttempts : 0,
        lastAttempt: driverData.lastAttempt ? JSON.parse(driverData.lastAttempt) : null
      };
      
    } catch (error) {
      logError(error, '❌ [KYCAnalytics] Erro ao obter métricas do driver:', { service: 'KYCAnalyticsService' });
      throw error;
    }
  }

  /**
   * Obter métricas globais
   */
  async getGlobalMetrics(days = 7) {
    try {
      const globalKey = `${this.metricsPrefix}global`;
      const globalData = await this.redis.hgetall(globalKey);
      
      if (!globalData || Object.keys(globalData).length === 0) {
        return this.getEmptyGlobalMetrics();
      }
      
      const totalAttempts = parseInt(globalData.totalAttempts) || 0;
      const successfulAttempts = parseInt(globalData.successfulAttempts) || 0;
      const failedAttempts = parseInt(globalData.failedAttempts) || 0;
      const totalConfidence = parseFloat(globalData.totalConfidence) || 0;
      const totalDuration = parseFloat(globalData.totalDuration) || 0;
      
      // Extrair razões de retry
      const retryReasons = {};
      for (const [key, value] of Object.entries(globalData)) {
        if (key.startsWith('retryReason:')) {
          const reason = key.replace('retryReason:', '');
          retryReasons[reason] = parseInt(value);
        }
      }
      
      return {
        totalAttempts,
        successfulAttempts,
        failedAttempts,
        successRate: totalAttempts > 0 ? (successfulAttempts / totalAttempts) * 100 : 0,
        averageConfidence: totalAttempts > 0 ? totalConfidence / totalAttempts : 0,
        averageDuration: totalAttempts > 0 ? totalDuration / totalAttempts : 0,
        retryReasons,
        lastUpdated: new Date().toISOString()
      };
      
    } catch (error) {
      logError(error, '❌ [KYCAnalytics] Erro ao obter métricas globais:', { service: 'KYCAnalyticsService' });
      throw error;
    }
  }

  /**
   * Obter métricas diárias
   */
  async getDailyMetrics(days = 7) {
    try {
      const metrics = [];
      const today = new Date();
      
      for (let i = 0; i < days; i++) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        const dateKey = date.toISOString().split('T')[0];
        
        const dailyKey = `${this.metricsPrefix}daily:${dateKey}`;
        const dailyData = await this.redis.hgetall(dailyKey);
        
        if (dailyData && Object.keys(dailyData).length > 0) {
          const totalAttempts = parseInt(dailyData.totalAttempts) || 0;
          const successfulAttempts = parseInt(dailyData.successfulAttempts) || 0;
          const failedAttempts = parseInt(dailyData.failedAttempts) || 0;
          const totalConfidence = parseFloat(dailyData.totalConfidence) || 0;
          const totalDuration = parseFloat(dailyData.totalDuration) || 0;
          
          metrics.push({
            date: dateKey,
            totalAttempts,
            successfulAttempts,
            failedAttempts,
            successRate: totalAttempts > 0 ? (successfulAttempts / totalAttempts) * 100 : 0,
            averageConfidence: totalAttempts > 0 ? totalConfidence / totalAttempts : 0,
            averageDuration: totalAttempts > 0 ? totalDuration / totalAttempts : 0
          });
        } else {
          metrics.push({
            date: dateKey,
            totalAttempts: 0,
            successfulAttempts: 0,
            failedAttempts: 0,
            successRate: 0,
            averageConfidence: 0,
            averageDuration: 0
          });
        }
      }
      
      return metrics.reverse(); // Mais recente primeiro
      
    } catch (error) {
      logError(error, '❌ [KYCAnalytics] Erro ao obter métricas diárias:', { service: 'KYCAnalyticsService' });
      throw error;
    }
  }

  /**
   * Obter métricas em tempo real
   */
  async getRealtimeMetrics(hours = 1) {
    try {
      const now = Date.now();
      const cutoffTime = now - (hours * 3600 * 1000);
      
      const keys = await this.redis.keys(`${this.realtimePrefix}*`);
      const recentKeys = keys.filter(key => {
        const timestamp = parseInt(key.replace(this.realtimePrefix, ''));
        return timestamp > cutoffTime;
      });
      
      const metrics = [];
      for (const key of recentKeys) {
        const data = await this.redis.hget(key, 'data');
        if (data) {
          metrics.push(JSON.parse(data));
        }
      }
      
      return metrics.sort((a, b) => b.timestamp - a.timestamp);
      
    } catch (error) {
      logError(error, '❌ [KYCAnalytics] Erro ao obter métricas em tempo real:', { service: 'KYCAnalyticsService' });
      throw error;
    }
  }

  /**
   * Gerar relatório de analytics
   */
  async generateAnalyticsReport(options = {}) {
    try {
      const {
        driverId = null,
        days = 7,
        includeRealtime = true,
        includeDaily = true,
        includeGlobal = true
      } = options;
      
      const report = {
        generatedAt: new Date().toISOString(),
        period: `${days} days`,
        driverId
      };
      
      if (includeGlobal) {
        report.global = await this.getGlobalMetrics(days);
      }
      
      if (includeDaily) {
        report.daily = await this.getDailyMetrics(days);
      }
      
      if (includeRealtime) {
        report.realtime = await this.getRealtimeMetrics(1);
      }
      
      if (driverId) {
        report.driver = await this.getDriverMetrics(driverId, days);
      }
      
      return report;
      
    } catch (error) {
      logError(error, '❌ [KYCAnalytics] Erro ao gerar relatório:', { service: 'KYCAnalyticsService' });
      throw error;
    }
  }

  /**
   * Obter métricas vazias para casos sem dados
   */
  getEmptyGlobalMetrics() {
    return {
      totalAttempts: 0,
      successfulAttempts: 0,
      failedAttempts: 0,
      successRate: 0,
      averageConfidence: 0,
      averageDuration: 0,
      retryReasons: {},
      lastUpdated: new Date().toISOString()
    };
  }

  /**
   * Limpar dados antigos
   */
  async cleanupOldData() {
    try {
      const cutoffTime = Date.now() - (this.retentionDays * 24 * 3600 * 1000);
      
      // Limpar dados em tempo real antigos
      const realtimeKeys = await this.redis.keys(`${this.realtimePrefix}*`);
      for (const key of realtimeKeys) {
        const timestamp = parseInt(key.replace(this.realtimePrefix, ''));
        if (timestamp < cutoffTime) {
          await this.redis.del(key);
        }
      }
      
      logStructured('info', `🧹 [KYCAnalytics] Limpeza de dados antigos concluída`);
      
    } catch (error) {
      logError(error, '❌ [KYCAnalytics] Erro na limpeza de dados:', { service: 'KYCAnalyticsService' });
    }
  }
}

module.exports = KYCAnalyticsService;
