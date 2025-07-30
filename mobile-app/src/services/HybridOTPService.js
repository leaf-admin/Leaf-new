import auth from '@react-native-firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Serviço OTP Simplificado - Usa apenas SMS Firebase
 * 
 * Estratégia:
 * 1. Envia SMS via Firebase Auth
 * 2. Retorna verificationId para verificação
 * 
 * Configuração automática baseada em:
 * - Plano Firebase (Spark vs Blaze)
 * - Limite de SMS gratuito
 * - Custo por verificação
 */

class HybridOTPService {
  constructor() {
    this.config = {
      // Estratégia de envio
      strategy: 'sms_only', // Simplificado para apenas SMS
      
      // Configurações Firebase
      firebasePlan: 'blaze', // 'spark' ou 'blaze'
      smsFreeLimit: 10000, // Limite gratuito do plano Spark
      smsCost: 0.01, // Custo por SMS no plano Blaze
      
      // Configurações de retry
      maxRetries: 2,
      retryDelay: 2000,
      
      // Cache de tentativas
      attemptCache: new Map(),
      cacheExpiry: 5 * 60 * 1000, // 5 minutos
    };
    
    this.isInitialized = false;
    this.stats = {
      smsSent: 0,
      smsSuccess: 0,
      totalFailures: 0,
      lastReset: new Date().toISOString(),
    };
  }

  /**
   * Inicializa o serviço híbrido
   */
  async initialize() {
    try {
      console.log('🔧 HybridOTPService - Inicializando...');
      
      // Carregar configurações
      await this.loadConfig();
      
      // Determinar estratégia baseada no plano Firebase
      await this.determineStrategy();
      
      this.isInitialized = true;
      console.log('✅ HybridOTPService - Inicializado com sucesso');
      
    } catch (error) {
      console.error('❌ HybridOTPService - Erro na inicialização:', error);
      throw error;
    }
  }

  /**
   * Carrega configurações do storage
   */
  async loadConfig() {
    try {
      const storedConfig = await AsyncStorage.getItem('@hybrid_otp_config');
      if (storedConfig) {
        const parsedConfig = JSON.parse(storedConfig);
        // Garantir que attemptCache seja sempre um Map válido
        this.config = { 
          ...this.config, 
          ...parsedConfig,
          attemptCache: new Map() // Sempre recriar o Map
        };
      }
      
      const storedStats = await AsyncStorage.getItem('@hybrid_otp_stats');
      if (storedStats) {
        this.stats = { ...this.stats, ...JSON.parse(storedStats) };
      }
      
    } catch (error) {
      console.warn('⚠️ HybridOTPService - Erro ao carregar configurações:', error);
    }
  }

  /**
   * Salva configurações no storage
   */
  async saveConfig() {
    try {
      // Criar uma cópia do config sem o Map (que não é serializável)
      const configToSave = { ...this.config };
      delete configToSave.attemptCache; // Remover o Map antes de salvar
      
      await AsyncStorage.setItem('@hybrid_otp_config', JSON.stringify(configToSave));
      await AsyncStorage.setItem('@hybrid_otp_stats', JSON.stringify(this.stats));
    } catch (error) {
      console.warn('⚠️ HybridOTPService - Erro ao salvar configurações:', error);
    }
  }

  /**
   * Determina a melhor estratégia baseada no plano e custos
   */
  async determineStrategy() {
    try {
      // Se for plano Spark e ainda não atingiu o limite gratuito
      if (this.config.firebasePlan === 'spark' && this.stats.smsSent < this.config.smsFreeLimit) {
        this.config.strategy = 'sms_only';
        console.log('📊 HybridOTPService - Estratégia: SMS apenas (gratuito)');
      }
      // Se for plano Blaze ou atingiu limite gratuito
      else if (this.config.firebasePlan === 'blaze' || this.stats.smsSent >= this.config.smsFreeLimit) {
        this.config.strategy = 'sms_only';
        console.log('📊 HybridOTPService - Estratégia: SMS apenas (mais barato)');
      }
      
      await this.saveConfig();
      
    } catch (error) {
      console.warn('⚠️ HybridOTPService - Erro ao determinar estratégia:', error);
      this.config.strategy = 'sms_only'; // Fallback
    }
  }

  /**
   * Envia OTP usando estratégia híbrida
   */
  async sendOTP(phoneNumber, otpCode = null) {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }
      
      const formattedPhone = this.formatPhoneNumber(phoneNumber);
      
      console.log('📱 HybridOTPService - Enviando OTP:', {
        phone: formattedPhone,
        strategy: this.config.strategy
      });
      
      // Verificar cache de tentativas
      if (this.isRateLimited(formattedPhone)) {
        throw new Error('Muitas tentativas. Tente novamente em alguns minutos.');
      }
      
      // Usar apenas Firebase SMS por enquanto
      const result = await this.sendSMS(formattedPhone);
      
      // Registrar tentativa
      this.recordAttempt(formattedPhone);
      
      // Atualizar estatísticas
      this.updateStats(result);
      
      console.log('✅ HybridOTPService - OTP enviado:', result);
      
      return result;
      
    } catch (error) {
      console.error('❌ HybridOTPService - Erro ao enviar OTP:', error);
      
      this.stats.totalFailures++;
      await this.saveConfig();
      
      return {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString(),
        provider: 'sms'
      };
    }
  }

  /**
   * Envia SMS via Firebase
   */
  async sendSMS(phoneNumber) {
    try {
      console.log('📱 HybridOTPService - Enviando SMS via Firebase...');
      
      const confirmation = await auth().verifyPhoneNumber(phoneNumber);
      
      return {
        success: true,
        verificationId: confirmation.verificationId,
        timestamp: new Date().toISOString(),
        provider: 'sms',
        cost: this.getSMSCost()
      };
      
    } catch (error) {
      console.error('❌ HybridOTPService - Erro no SMS:', error);
      
      return {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString(),
        provider: 'sms'
      };
    }
  }

  /**
   * Calcula custo do SMS baseado no plano
   */
  getSMSCost() {
    if (this.config.firebasePlan === 'spark' && this.stats.smsSent < this.config.smsFreeLimit) {
      return 0; // Gratuito
    }
    return this.config.smsCost;
  }

  /**
   * Gera código OTP
   */
  generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  /**
   * Formata número de telefone
   */
  formatPhoneNumber(phone) {
    let cleanPhone = phone.replace(/\D/g, '');
    
    if (cleanPhone.startsWith('55')) {
      cleanPhone = cleanPhone.substring(2);
    }
    
    if (!cleanPhone.startsWith('55')) {
      cleanPhone = '55' + cleanPhone;
    }
    
    return cleanPhone;
  }

  /**
   * Rate limiting
   */
  isRateLimited(phoneNumber) {
    const now = Date.now();
    const attempts = this.config.attemptCache.get(phoneNumber) || [];
    
    // Remover tentativas antigas
    const recentAttempts = attempts.filter(timestamp => now - timestamp < this.config.cacheExpiry);
    
    // Verificar se excedeu limite (5 tentativas em 5 minutos)
    if (recentAttempts.length >= 5) {
      return true;
    }
    
    // Adicionar nova tentativa
    recentAttempts.push(now);
    this.config.attemptCache.set(phoneNumber, recentAttempts);
    
    return false;
  }

  /**
   * Registra tentativa
   */
  recordAttempt(phoneNumber) {
    const now = Date.now();
    const attempts = this.config.attemptCache.get(phoneNumber) || [];
    attempts.push(now);
    this.config.attemptCache.set(phoneNumber, attempts);
  }

  /**
   * Atualiza estatísticas
   */
  updateStats(result) {
    if (result.success) {
      if (result.provider === 'sms') {
        this.stats.smsSent++;
        this.stats.smsSuccess++;
      }
    } else {
      this.stats.totalFailures++;
    }
    
    this.saveConfig();
  }

  /**
   * Obtém estatísticas do serviço
   */
  getStats() {
    const totalSent = this.stats.smsSent;
    const totalSuccess = this.stats.smsSuccess;
    const successRate = totalSent > 0 ? (totalSuccess / totalSent) * 100 : 0;
    
    return {
      ...this.stats,
      totalSent,
      totalSuccess,
      successRate: successRate.toFixed(2) + '%',
      strategy: this.config.strategy,
      firebasePlan: this.config.firebasePlan,
      smsRemaining: Math.max(0, this.config.smsFreeLimit - this.stats.smsSent),
      estimatedCost: this.calculateEstimatedCost(),
    };
  }

  /**
   * Calcula custo estimado
   */
  calculateEstimatedCost() {
    const smsCost = this.stats.smsSent * this.getSMSCost();
    return smsCost.toFixed(4);
  }

  /**
   * Configura o serviço
   */
  async configure(newConfig) {
    try {
      console.log('⚙️ HybridOTPService - Configurando...');
      
      this.config = { ...this.config, ...newConfig };
      
      // Determinar nova estratégia
      await this.determineStrategy();
      
      // Salvar configurações
      await this.saveConfig();
      
      console.log('✅ HybridOTPService - Configurado com sucesso');
      
    } catch (error) {
      console.error('❌ HybridOTPService - Erro na configuração:', error);
      throw error;
    }
  }

  /**
   * Reseta estatísticas
   */
  async resetStats() {
    this.stats = {
      smsSent: 0,
      smsSuccess: 0,
      totalFailures: 0,
      lastReset: new Date().toISOString(),
    };
    
    this.config.attemptCache.clear();
    
    await this.saveConfig();
    console.log('🔄 HybridOTPService - Estatísticas resetadas');
  }
}

// Instância singleton
const hybridOTPService = new HybridOTPService();

export default hybridOTPService; 