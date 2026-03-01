/**
 * KYC Analytics Routes - Rotas para analytics de verificação KYC
 * 
 * Este arquivo define as rotas REST para acessar analytics e métricas
 * do sistema de verificação facial KYC.
 */

const express = require('express');
const IntegratedKYCService = require('../services/IntegratedKYCService');
const { logStructured, logError } = require('../utils/logger');

class KYCAnalyticsRoutes {
  constructor() {
    this.router = express.Router();
    this.kycService = new IntegratedKYCService();
    this.initializeRoutes();
  }

  initializeRoutes() {
    // Middleware para verificar se o serviço está inicializado
    this.router.use(async (req, res, next) => {
      if (!this.kycService.initialized) {
        return res.status(503).json({
          success: false,
          error: 'KYC Service ainda não inicializado',
          retryAfter: 5
        });
      }
      next();
    });

    // GET /api/kyc/analytics - Obter analytics globais
    this.router.get('/analytics', async (req, res) => {
      try {
        const { days = 7 } = req.query;
        const analytics = await this.kycService.getAnalytics(null, parseInt(days));
        
        res.json({
          success: true,
          data: analytics,
          period: `${days} days`,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        logError(error, '❌ [KYCAnalytics] Erro ao obter analytics globais:', { service: 'kyc-analytics-routes-routes' });
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // GET /api/kyc/analytics/driver/:driverId - Obter analytics de um driver específico
    this.router.get('/analytics/driver/:driverId', async (req, res) => {
      try {
        const { driverId } = req.params;
        const { days = 7 } = req.query;
        
        const analytics = await this.kycService.getAnalytics(driverId, parseInt(days));
        
        if (!analytics) {
          return res.status(404).json({
            success: false,
            error: 'Analytics não encontrados para este driver'
          });
        }
        
        res.json({
          success: true,
          data: analytics,
          driverId,
          period: `${days} days`,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        logError(error, '❌ [KYCAnalytics] Erro ao obter analytics do driver:', { service: 'kyc-analytics-routes-routes' });
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // GET /api/kyc/analytics/daily - Obter analytics diários
    this.router.get('/analytics/daily', async (req, res) => {
      try {
        const { days = 7 } = req.query;
        const analytics = await this.kycService.getDailyAnalytics(parseInt(days));
        
        res.json({
          success: true,
          data: analytics,
          period: `${days} days`,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        logError(error, '❌ [KYCAnalytics] Erro ao obter analytics diários:', { service: 'kyc-analytics-routes-routes' });
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // GET /api/kyc/analytics/realtime - Obter analytics em tempo real
    this.router.get('/analytics/realtime', async (req, res) => {
      try {
        const { hours = 1 } = req.query;
        const analytics = await this.kycService.getRealtimeAnalytics(parseInt(hours));
        
        res.json({
          success: true,
          data: analytics,
          period: `${hours} hours`,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        logError(error, '❌ [KYCAnalytics] Erro ao obter analytics em tempo real:', { service: 'kyc-analytics-routes-routes' });
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // GET /api/kyc/analytics/report - Gerar relatório completo
    this.router.get('/analytics/report', async (req, res) => {
      try {
        const {
          driverId = null,
          days = 7,
          includeRealtime = true,
          includeDaily = true,
          includeGlobal = true
        } = req.query;
        
        const report = await this.kycService.generateAnalyticsReport({
          driverId,
          days: parseInt(days),
          includeRealtime: includeRealtime === 'true',
          includeDaily: includeDaily === 'true',
          includeGlobal: includeGlobal === 'true'
        });
        
        res.json({
          success: true,
          data: report,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        logError(error, '❌ [KYCAnalytics] Erro ao gerar relatório:', { service: 'kyc-analytics-routes-routes' });
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // GET /api/kyc/retry/stats - Obter estatísticas de retry
    this.router.get('/retry/stats', async (req, res) => {
      try {
        const { driverId = null } = req.query;
        const stats = await this.kycService.getRetryStats(driverId);
        
        res.json({
          success: true,
          data: stats,
          driverId,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        logError(error, '❌ [KYCAnalytics] Erro ao obter stats de retry:', { service: 'kyc-analytics-routes-routes' });
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // POST /api/kyc/retry/configure - Configurar parâmetros de retry
    this.router.post('/retry/configure', async (req, res) => {
      try {
        const { maxRetries, retryDelays } = req.body;
        
        await this.kycService.configureRetry({
          maxRetries,
          retryDelays
        });
        
        res.json({
          success: true,
          message: 'Configurações de retry atualizadas',
          config: { maxRetries, retryDelays },
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        logError(error, '❌ [KYCAnalytics] Erro ao configurar retry:', { service: 'kyc-analytics-routes-routes' });
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // POST /api/kyc/notifications/liveness - Enviar notificação de liveness
    this.router.post('/notifications/liveness', async (req, res) => {
      try {
        const { driverId, data = {} } = req.body;
        
        if (!driverId) {
          return res.status(400).json({
            success: false,
            error: 'driverId é obrigatório'
          });
        }
        
        await this.kycService.sendLivenessCheckNotification(driverId, data);
        
        res.json({
          success: true,
          message: 'Notificação de liveness enviada',
          driverId,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        logError(error, '❌ [KYCAnalytics] Erro ao enviar notificação de liveness:', { service: 'kyc-analytics-routes-routes' });
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // POST /api/kyc/notifications/retry - Enviar notificação de retry
    this.router.post('/notifications/retry', async (req, res) => {
      try {
        const { driverId, data = {} } = req.body;
        
        if (!driverId) {
          return res.status(400).json({
            success: false,
            error: 'driverId é obrigatório'
          });
        }
        
        await this.kycService.sendRetryNotification(driverId, data);
        
        res.json({
          success: true,
          message: 'Notificação de retry enviada',
          driverId,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        logError(error, '❌ [KYCAnalytics] Erro ao enviar notificação de retry:', { service: 'kyc-analytics-routes-routes' });
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // POST /api/kyc/notifications/completion - Enviar notificação de conclusão
    this.router.post('/notifications/completion', async (req, res) => {
      try {
        const { driverId, data = {} } = req.body;
        
        if (!driverId) {
          return res.status(400).json({
            success: false,
            error: 'driverId é obrigatório'
          });
        }
        
        await this.kycService.sendCompletionNotification(driverId, data);
        
        res.json({
          success: true,
          message: 'Notificação de conclusão enviada',
          driverId,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        logError(error, '❌ [KYCAnalytics] Erro ao enviar notificação de conclusão:', { service: 'kyc-analytics-routes-routes' });
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // POST /api/kyc/cleanup - Limpar dados antigos
    this.router.post('/cleanup', async (req, res) => {
      try {
        await this.kycService.cleanupOldData();
        
        res.json({
          success: true,
          message: 'Limpeza de dados antigos concluída',
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        logError(error, '❌ [KYCAnalytics] Erro na limpeza de dados:', { service: 'kyc-analytics-routes-routes' });
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // GET /api/kyc/analytics/health - Health check para analytics
    this.router.get('/analytics/health', async (req, res) => {
      try {
        const health = await this.kycService.getHealthStatus();
        
        res.json({
          success: true,
          data: health,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        logError(error, '❌ [KYCAnalytics] Erro no health check:', { service: 'kyc-analytics-routes-routes' });
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });
  }

  getRouter() {
    return this.router;
  }
}

module.exports = new KYCAnalyticsRoutes();
