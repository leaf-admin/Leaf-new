import Logger from '../utils/Logger';
import apiClient from './httpClient';

/**
 * Compatibilidade para consumidores antigos do serviço híbrido.
 *
 * O transporte ativo é o endpoint Leaf de OTP WhatsApp. A Meta e o Firebase
 * Admin permanecem no backend; este módulo não guarda credenciais nem chama
 * Firebase Phone Auth diretamente.
 */
class HybridOTPService {
  constructor() {
    this.config = {
      strategy: 'whatsapp_backend',
      maxRetries: 2,
      retryDelay: 2000,
      attemptCache: new Map(),
      cacheExpiry: 5 * 60 * 1000
    };
    this.isInitialized = false;
    this.stats = {
      whatsappSent: 0,
      whatsappSuccess: 0,
      totalFailures: 0,
      lastReset: new Date().toISOString()
    };
  }

  async initialize() {
    this.isInitialized = true;
    return this.getServiceInfo();
  }

  async sendOTP(phoneNumber) {
    if (!this.isInitialized) await this.initialize();
    const formattedPhone = this.formatPhoneNumber(phoneNumber);

    try {
      if (this.isRateLimited(formattedPhone)) {
        throw new Error('Muitas tentativas. Tente novamente em alguns minutos.');
      }

      const response = await apiClient.post('/api/custom-otp/request-otp', {
        phone: formattedPhone
      });
      const result = response?.data || response || {};
      this.updateStats(result);
      return {
        ...result,
        provider: result.channel === 'whatsapp' ? 'whatsapp' : 'leaf-backend',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      this.stats.totalFailures += 1;
      Logger.error('Erro ao solicitar OTP WhatsApp pelo backend:', error);
      return {
        success: false,
        error: error?.message || 'Não foi possível enviar o código.',
        provider: 'whatsapp',
        timestamp: new Date().toISOString()
      };
    }
  }

  async sendSMS(phoneNumber) {
    // Compatibilidade de API: o método antigo agora usa o mesmo transporte.
    return this.sendOTP(phoneNumber);
  }

  async verifyOTP(phoneNumber, verificationId, otp) {
    try {
      const response = await apiClient.post('/api/custom-otp/verify-otp', {
        phone: this.formatPhoneNumber(phoneNumber),
        verificationId,
        otp
      });
      const result = response?.data || response || {};
      if (result.success) this.stats.whatsappSuccess += 1;
      return result;
    } catch (error) {
      Logger.error('Erro ao verificar OTP WhatsApp pelo backend:', error);
      return {
        success: false,
        error: error?.message || 'Não foi possível confirmar o código.',
        provider: 'whatsapp'
      };
    }
  }

  generateOTP() {
    const error = new Error('A geração de OTP é exclusiva do backend Leaf.');
    error.code = 'OTP_GENERATION_BACKEND_ONLY';
    throw error;
  }

  formatPhoneNumber(phone) {
    const digits = String(phone || '').replace(/\D/g, '');
    if (digits.startsWith('55')) return digits;
    return `55${digits}`;
  }

  isRateLimited(phoneNumber) {
    const now = Date.now();
    const attempts = (this.config.attemptCache.get(phoneNumber) || [])
      .filter((timestamp) => now - timestamp < this.config.cacheExpiry);
    if (attempts.length >= 5) return true;
    attempts.push(now);
    this.config.attemptCache.set(phoneNumber, attempts);
    return false;
  }

  recordAttempt(phoneNumber) {
    const attempts = this.config.attemptCache.get(phoneNumber) || [];
    attempts.push(Date.now());
    this.config.attemptCache.set(phoneNumber, attempts);
  }

  updateStats(result) {
    if (result?.success) {
      this.stats.whatsappSent += 1;
      this.stats.whatsappSuccess += 1;
    }
  }

  getStats() {
    const totalSent = this.stats.whatsappSent;
    return {
      ...this.stats,
      totalSent,
      totalSuccess: this.stats.whatsappSuccess,
      successRate: totalSent ? `${((this.stats.whatsappSuccess / totalSent) * 100).toFixed(2)}%` : '0.00%',
      strategy: this.config.strategy,
      provider: 'whatsapp-cloud-api'
    };
  }

  getServiceInfo() {
    return {
      provider: 'whatsapp-cloud-api',
      transport: 'leaf-backend',
      credentialsInMobileBundle: false
    };
  }

  async configure(newConfig = {}) {
    this.config = { ...this.config, ...newConfig, strategy: 'whatsapp_backend' };
    return this.getServiceInfo();
  }

  async resetStats() {
    this.stats = {
      whatsappSent: 0,
      whatsappSuccess: 0,
      totalFailures: 0,
      lastReset: new Date().toISOString()
    };
    this.config.attemptCache.clear();
  }
}

export default new HybridOTPService();
