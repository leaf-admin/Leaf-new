import Logger from '../utils/Logger';
import AsyncStorage from '@react-native-async-storage/async-storage';


/**
 * WhatsApp OTP Service usando Meta Business API
 * 
 * Documentação: https://developers.facebook.com/docs/whatsapp/cloud-api
 * 
 * ⚠️ IMPORTANTE: A documentação da Meta é conhecida por ser confusa
 * Vamos implementar com múltiplos fallbacks e logs detalhados
 */

class WhatsAppOTPService {
  constructor() {
    // Configurações da Meta Business API
    this.config = {
      // ⚠️ SUBSTITUIR PELAS SUAS CREDENCIAIS REAIS
      accessToken: 'YOUR_META_ACCESS_TOKEN',
      phoneNumberId: 'YOUR_PHONE_NUMBER_ID',
      businessAccountId: 'YOUR_BUSINESS_ACCOUNT_ID',
      appId: 'YOUR_APP_ID',
      appSecret: 'YOUR_APP_SECRET',
      
      // URLs da API
      baseUrl: 'https://graph.facebook.com/v18.0',
      messagesUrl: 'https://graph.facebook.com/v18.0/YOUR_PHONE_NUMBER_ID/messages',
      
      // Template de mensagem (deve ser aprovado pela Meta)
      templateName: 'leaf_otp_verification',
      templateLanguage: 'pt_BR',
      
      // Configurações de retry
      maxRetries: 3,
      retryDelay: 1000,
      
      // Timeout
      timeout: 10000,
    };
    
    this.isInitialized = false;
    this.lastError = null;
  }

  /**
   * Inicializa o serviço e valida as configurações
   */
  async initialize() {
    try {
      Logger.log('🔧 WhatsAppOTPService - Inicializando...');
      
      // Carregar configurações do AsyncStorage (se existirem)
      await this.loadConfigFromStorage();
      
      // Validar configurações mínimas
      if (!this.config.accessToken || this.config.accessToken === 'YOUR_META_ACCESS_TOKEN') {
        throw new Error('❌ Access Token não configurado');
      }
      
      if (!this.config.phoneNumberId || this.config.phoneNumberId === 'YOUR_PHONE_NUMBER_ID') {
        throw new Error('❌ Phone Number ID não configurado');
      }
      
      // Testar conexão com a API
      await this.testConnection();
      
      this.isInitialized = true;
      Logger.log('✅ WhatsAppOTPService - Inicializado com sucesso');
      
    } catch (error) {
      Logger.error('❌ WhatsAppOTPService - Erro na inicialização:', error);
      this.lastError = error;
      this.isInitialized = false;
      throw error;
    }
  }

  /**
   * Carrega configurações do AsyncStorage
   */
  async loadConfigFromStorage() {
    try {
      const storedConfig = await AsyncStorage.getItem('@whatsapp_otp_config');
      if (storedConfig) {
        const parsedConfig = JSON.parse(storedConfig);
        this.config = { ...this.config, ...parsedConfig };
        Logger.log('📱 WhatsAppOTPService - Configurações carregadas do storage');
      }
    } catch (error) {
      Logger.warn('⚠️ WhatsAppOTPService - Erro ao carregar configurações:', error);
    }
  }

  /**
   * Salva configurações no AsyncStorage
   */
  async saveConfigToStorage() {
    try {
      const configToSave = {
        accessToken: this.config.accessToken,
        phoneNumberId: this.config.phoneNumberId,
        businessAccountId: this.config.businessAccountId,
        templateName: this.config.templateName,
      };
      await AsyncStorage.setItem('@whatsapp_otp_config', JSON.stringify(configToSave));
      Logger.log('💾 WhatsAppOTPService - Configurações salvas no storage');
    } catch (error) {
      Logger.warn('⚠️ WhatsAppOTPService - Erro ao salvar configurações:', error);
    }
  }

  /**
   * Testa a conexão com a Meta API
   */
  async testConnection() {
    try {
      Logger.log('🔍 WhatsAppOTPService - Testando conexão...');
      
      const response = await fetch(`${this.config.baseUrl}/${this.config.phoneNumberId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.config.accessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: this.config.timeout,
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`API Error: ${response.status} - ${JSON.stringify(errorData)}`);
      }
      
      const data = await response.json();
      Logger.log('✅ WhatsAppOTPService - Conexão testada com sucesso:', data);
      
    } catch (error) {
      Logger.error('❌ WhatsAppOTPService - Erro no teste de conexão:', error);
      throw error;
    }
  }

  /**
   * Gera um código OTP de 6 dígitos
   */
  generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  /**
   * Envia OTP via WhatsApp
   */
  async sendOTP(phoneNumber, otpCode = null) {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }
      
      const otp = otpCode || this.generateOTP();
      const formattedPhone = this.formatPhoneNumber(phoneNumber);
      
      Logger.log('📱 WhatsAppOTPService - Enviando OTP:', {
        phone: formattedPhone,
        otp: otp,
        template: this.config.templateName
      });
      
      // Preparar payload da mensagem
      const messagePayload = {
        messaging_product: 'whatsapp',
        to: formattedPhone,
        type: 'template',
        template: {
          name: this.config.templateName,
          language: {
            code: this.config.templateLanguage
          },
          components: [
            {
              type: 'body',
              parameters: [
                {
                  type: 'text',
                  text: otp
                }
              ]
            }
          ]
        }
      };
      
      Logger.log('📤 WhatsAppOTPService - Payload:', JSON.stringify(messagePayload, null, 2));
      
      // Enviar mensagem com retry
      const response = await this.sendMessageWithRetry(messagePayload);
      
      Logger.log('✅ WhatsAppOTPService - OTP enviado com sucesso:', response);
      
      return {
        success: true,
        otp: otp,
        messageId: response.messages?.[0]?.id,
        timestamp: new Date().toISOString(),
        provider: 'whatsapp'
      };
      
    } catch (error) {
      Logger.error('❌ WhatsAppOTPService - Erro ao enviar OTP:', error);
      
      return {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString(),
        provider: 'whatsapp'
      };
    }
  }

  /**
   * Envia mensagem com retry automático
   */
  async sendMessageWithRetry(payload, attempt = 1) {
    try {
      Logger.log(`🔄 WhatsAppOTPService - Tentativa ${attempt}/${this.config.maxRetries}`);
      
      const response = await fetch(this.config.messagesUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        timeout: this.config.timeout,
      });
      
      const responseData = await response.json();
      
      if (!response.ok) {
        Logger.error('❌ WhatsAppOTPService - Erro na API:', {
          status: response.status,
          data: responseData
        });
        
        // Verificar se é um erro que pode ser retryado
        if (this.isRetryableError(response.status, responseData) && attempt < this.config.maxRetries) {
          Logger.log(`⏳ WhatsAppOTPService - Aguardando ${this.config.retryDelay}ms antes do retry...`);
          await this.delay(this.config.retryDelay);
          return this.sendMessageWithRetry(payload, attempt + 1);
        }
        
        throw new Error(`API Error: ${response.status} - ${JSON.stringify(responseData)}`);
      }
      
      return responseData;
      
    } catch (error) {
      Logger.error(`❌ WhatsAppOTPService - Erro na tentativa ${attempt}:`, error);
      
      if (attempt < this.config.maxRetries) {
        Logger.log(`⏳ WhatsAppOTPService - Aguardando ${this.config.retryDelay}ms antes do retry...`);
        await this.delay(this.config.retryDelay);
        return this.sendMessageWithRetry(payload, attempt + 1);
      }
      
      throw error;
    }
  }

  /**
   * Verifica se um erro pode ser retryado
   */
  isRetryableError(status, data) {
    // Erros que podem ser retryados
    const retryableStatuses = [408, 429, 500, 502, 503, 504];
    const retryableCodes = ['rate_limit_exceeded', 'temporary_failure', 'service_unavailable'];
    
    if (retryableStatuses.includes(status)) {
      return true;
    }
    
    if (data.error?.code && retryableCodes.includes(data.error.code)) {
      return true;
    }
    
    return false;
  }

  /**
   * Formata número de telefone para o padrão WhatsApp
   */
  formatPhoneNumber(phone) {
    // Remove todos os caracteres não numéricos
    let cleanPhone = phone.replace(/\D/g, '');
    
    // Remove código do país se já estiver presente
    if (cleanPhone.startsWith('55')) {
      cleanPhone = cleanPhone.substring(2);
    }
    
    // Adiciona código do Brasil se não estiver presente
    if (!cleanPhone.startsWith('55')) {
      cleanPhone = '55' + cleanPhone;
    }
    
    return cleanPhone;
  }

  /**
   * Delay helper
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Verifica o status de uma mensagem
   */
  async checkMessageStatus(messageId) {
    try {
      const response = await fetch(`${this.config.baseUrl}/${messageId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.config.accessToken}`,
          'Content-Type': 'application/json',
        },
      });
      
      const data = await response.json();
      Logger.log('📊 WhatsAppOTPService - Status da mensagem:', data);
      
      return data;
      
    } catch (error) {
      Logger.error('❌ WhatsAppOTPService - Erro ao verificar status:', error);
      throw error;
    }
  }

  /**
   * Configura o serviço com novas credenciais
   */
  async configure(newConfig) {
    try {
      Logger.log('⚙️ WhatsAppOTPService - Configurando...');
      
      this.config = { ...this.config, ...newConfig };
      
      // Salvar no storage
      await this.saveConfigToStorage();
      
      // Reinicializar
      await this.initialize();
      
      Logger.log('✅ WhatsAppOTPService - Configurado com sucesso');
      
    } catch (error) {
      Logger.error('❌ WhatsAppOTPService - Erro na configuração:', error);
      throw error;
    }
  }

  /**
   * Obtém informações do serviço
   */
  getServiceInfo() {
    return {
      isInitialized: this.isInitialized,
      lastError: this.lastError?.message,
      config: {
        phoneNumberId: this.config.phoneNumberId,
        templateName: this.config.templateName,
        templateLanguage: this.config.templateLanguage,
      },
      timestamp: new Date().toISOString(),
    };
  }
}

// Instância singleton
const whatsAppOTPService = new WhatsAppOTPService();

export default whatsAppOTPService; 