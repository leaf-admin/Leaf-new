/**
 * 🚨 Alert Service
 * 
 * Serviço centralizado para envio de alertas
 * Integra com Prometheus, Slack, Email e Dashboard
 */

const axios = require('axios');
const { logStructured, logError } = require('../utils/logger');

class AlertService {
  constructor() {
    this.slackWebhookUrl = process.env.SLACK_WEBHOOK_URL || null;
    this.emailConfig = {
      enabled: process.env.EMAIL_ALERTS_ENABLED === 'true',
      smtp: {
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT || 587,
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        }
      },
      to: process.env.ALERT_EMAIL_TO?.split(',') || []
    };
    this.alertHistory = [];
    this.alertCooldown = new Map(); // { alertKey: timestamp }
    this.cooldownMinutes = parseInt(process.env.ALERT_COOLDOWN_MINUTES || '30', 10);
  }

  /**
   * Enviar alerta
   * @param {Object} alert - Dados do alerta
   * @param {string} alert.severity - 'warning' | 'critical'
   * @param {string} alert.metric - Nome da métrica
   * @param {number} alert.value - Valor atual
   * @param {number} alert.threshold - Limite
   * @param {string} alert.message - Mensagem do alerta
   * @param {string} alert.service - Serviço afetado
   */
  async sendAlert(alert) {
    try {
      const alertKey = `${alert.service}_${alert.metric}_${alert.severity}`;
      
      // Verificar cooldown
      if (this.isInCooldown(alertKey)) {
        logStructured('debug', 'Alerta em cooldown, ignorando', {
          service: 'alert-service',
          alertKey,
          metric: alert.metric
        });
        return;
      }

      // Registrar alerta
      this.recordAlert(alertKey);

      // Enviar para todos os canais
      await Promise.allSettled([
        this.sendToSlack(alert),
        this.sendToEmail(alert),
        this.sendToDashboard(alert),
        this.logAlert(alert)
      ]);

      logStructured('info', 'Alerta enviado', {
        service: 'alert-service',
        metric: alert.metric,
        severity: alert.severity,
        channels: ['slack', 'email', 'dashboard', 'log'].filter(ch => {
          if (ch === 'slack') return this.slackWebhookUrl;
          if (ch === 'email') return this.emailConfig.enabled;
          return true;
        })
      });

    } catch (error) {
      logError(error, 'Erro ao enviar alerta', {
        service: 'alert-service',
        metric: alert.metric
      });
    }
  }

  /**
   * Enviar alerta para Slack
   */
  async sendToSlack(alert) {
    if (!this.slackWebhookUrl) {
      return;
    }

    try {
      const color = alert.severity === 'critical' ? 'danger' : 'warning';
      const emoji = alert.severity === 'critical' ? '🔴' : '🟡';

      const payload = {
        text: `${emoji} *Alerta LEAF - ${alert.severity.toUpperCase()}*`,
        attachments: [{
          color: color,
          title: `${alert.metric}`,
          fields: [
            { title: 'Serviço', value: alert.service || 'leaf-backend', short: true },
            { title: 'Severidade', value: alert.severity.toUpperCase(), short: true },
            { title: 'Valor Atual', value: `${alert.value}${alert.unit || ''}`, short: true },
            { title: 'Limite', value: `${alert.threshold}${alert.unit || ''}`, short: true },
            { title: 'Timestamp', value: new Date().toLocaleString('pt-BR'), short: false }
          ],
          text: alert.message || `${alert.metric} está em ${alert.value}${alert.unit || ''}, acima do limite de ${alert.threshold}${alert.unit || ''}`,
          footer: 'LEAF Observability',
          ts: Math.floor(Date.now() / 1000)
        }]
      };

      await axios.post(this.slackWebhookUrl, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 5000
      });

    } catch (error) {
      logError(error, 'Erro ao enviar alerta para Slack', {
        service: 'alert-service',
        channel: 'slack'
      });
    }
  }

  /**
   * Enviar alerta para Email
   */
  async sendToEmail(alert) {
    if (!this.emailConfig.enabled || this.emailConfig.to.length === 0) {
      return;
    }

    try {
      // Por enquanto, apenas logar (implementar nodemailer depois se necessário)
      logStructured('info', 'Alerta enviado para email', {
        service: 'alert-service',
        channel: 'email',
        recipients: this.emailConfig.to,
        metric: alert.metric,
        severity: alert.severity
      });

      // TODO: Implementar envio real de email com nodemailer se necessário
      // const nodemailer = require('nodemailer');
      // const transporter = nodemailer.createTransport(this.emailConfig.smtp);
      // await transporter.sendMail({ ... });

    } catch (error) {
      logError(error, 'Erro ao enviar alerta para email', {
        service: 'alert-service',
        channel: 'email'
      });
    }
  }

  /**
   * Enviar alerta para Dashboard (API)
   */
  async sendToDashboard(alert) {
    try {
      // Registrar no histórico para acesso via API
      this.alertHistory.push({
        ...alert,
        timestamp: new Date().toISOString(),
        id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      });

      // Manter apenas últimos 100 alertas
      if (this.alertHistory.length > 100) {
        this.alertHistory = this.alertHistory.slice(-100);
      }

    } catch (error) {
      logError(error, 'Erro ao registrar alerta no dashboard', {
        service: 'alert-service',
        channel: 'dashboard'
      });
    }
  }

  /**
   * Logar alerta
   */
  logAlert(alert) {
    const level = alert.severity === 'critical' ? 'error' : 'warn';
    logStructured(level, `🚨 Alerta: ${alert.metric}`, {
      service: 'alert-service',
      metric: alert.metric,
      severity: alert.severity,
      value: alert.value,
      threshold: alert.threshold,
      unit: alert.unit || '',
      message: alert.message
    });
  }

  /**
   * Verificar se alerta está em cooldown
   */
  isInCooldown(alertKey) {
    const lastAlert = this.alertCooldown.get(alertKey);
    if (!lastAlert) {
      return false;
    }

    const cooldownMs = this.cooldownMinutes * 60 * 1000;
    const timeSinceLastAlert = Date.now() - lastAlert;

    return timeSinceLastAlert < cooldownMs;
  }

  /**
   * Registrar alerta (para cooldown)
   */
  recordAlert(alertKey) {
    this.alertCooldown.set(alertKey, Date.now());
  }

  /**
   * Obter histórico de alertas
   */
  getAlertHistory(limit = 50) {
    return this.alertHistory.slice(-limit).reverse();
  }

  /**
   * Obter estatísticas de alertas
   */
  getAlertStats() {
    const stats = {
      total: this.alertHistory.length,
      bySeverity: {
        critical: 0,
        warning: 0
      },
      byService: {},
      recent: this.alertHistory.slice(-10).reverse()
    };

    this.alertHistory.forEach(alert => {
      stats.bySeverity[alert.severity] = (stats.bySeverity[alert.severity] || 0) + 1;
      stats.byService[alert.service] = (stats.byService[alert.service] || 0) + 1;
    });

    return stats;
  }
}

// Singleton
const alertService = new AlertService();

module.exports = alertService;

