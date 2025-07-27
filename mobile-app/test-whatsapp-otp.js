/**
 * Teste do WhatsApp OTP - Leaf App
 * 
 * Este script testa a implementação do WhatsApp OTP sem usar APIs reais
 * Útil para validar a lógica antes de configurar as credenciais
 */

// Simular AsyncStorage
const mockAsyncStorage = {
  data: {},
  async getItem(key) {
    return this.data[key] || null;
  },
  async setItem(key, value) {
    this.data[key] = value;
  },
  async removeItem(key) {
    delete this.data[key];
  }
};

// Simular Firebase Auth
const mockFirebaseAuth = {
  async verifyPhoneNumber(phoneNumber) {
    console.log(`📱 Mock Firebase - Enviando SMS para: ${phoneNumber}`);
    
    // Simular delay
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Simular sucesso 90% das vezes
    if (Math.random() > 0.1) {
      return {
        verificationId: `mock_verification_${Date.now()}`,
        confirm: async (code) => {
          console.log(`✅ Mock Firebase - Código verificado: ${code}`);
          return { user: { uid: `mock_user_${Date.now()}` } };
        }
      };
    } else {
      throw new Error('auth/quota-exceeded');
    }
  }
};

// Mock WhatsApp Service
class MockWhatsAppOTPService {
  constructor() {
    this.config = {
      accessToken: 'mock_token',
      phoneNumberId: 'mock_phone_id',
      templateName: 'leaf_otp_verification',
      templateLanguage: 'pt_BR',
    };
    this.isInitialized = true;
  }

  async initialize() {
    console.log('🔧 Mock WhatsApp - Inicializando...');
    await new Promise(resolve => setTimeout(resolve, 500));
    console.log('✅ Mock WhatsApp - Inicializado');
  }

  async sendOTP(phoneNumber, otpCode = null) {
    console.log(`📱 Mock WhatsApp - Enviando OTP para: ${phoneNumber}`);
    
    const otp = otpCode || this.generateOTP();
    
    // Simular delay
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Simular sucesso 95% das vezes
    if (Math.random() > 0.05) {
      console.log(`✅ Mock WhatsApp - OTP enviado: ${otp}`);
      return {
        success: true,
        otp: otp,
        messageId: `mock_message_${Date.now()}`,
        timestamp: new Date().toISOString(),
        provider: 'whatsapp'
      };
    } else {
      console.log('❌ Mock WhatsApp - Falha no envio');
      return {
        success: false,
        error: 'Template não encontrado',
        timestamp: new Date().toISOString(),
        provider: 'whatsapp'
      };
    }
  }

  generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

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
}

// Mock Hybrid Service
class MockHybridOTPService {
  constructor() {
    this.config = {
      strategy: 'sms_first',
      firebasePlan: 'blaze',
      smsFreeLimit: 10000,
      smsCost: 0.01,
      whatsappCost: 0.0139,
      maxRetries: 2,
      retryDelay: 1000,
    };
    
    this.stats = {
      smsSent: 0,
      whatsappSent: 0,
      smsSuccess: 0,
      whatsappSuccess: 0,
      totalFailures: 0,
      lastReset: new Date().toISOString(),
    };
    
    this.isInitialized = false;
    this.whatsappService = new MockWhatsAppOTPService();
  }

  async initialize() {
    console.log('🔧 Mock Hybrid - Inicializando...');
    
    try {
      await this.whatsappService.initialize();
      await this.determineStrategy();
      this.isInitialized = true;
      console.log('✅ Mock Hybrid - Inicializado com sucesso');
    } catch (error) {
      console.error('❌ Mock Hybrid - Erro na inicialização:', error);
      throw error;
    }
  }

  async determineStrategy() {
    if (this.config.firebasePlan === 'spark' && this.stats.smsSent < this.config.smsFreeLimit) {
      this.config.strategy = 'sms_first';
      console.log('📊 Mock Hybrid - Estratégia: SMS primeiro (gratuito)');
    } else {
      if (this.config.whatsappCost < this.config.smsCost) {
        this.config.strategy = 'whatsapp_first';
        console.log('📊 Mock Hybrid - Estratégia: WhatsApp primeiro (mais barato)');
      } else {
        this.config.strategy = 'sms_first';
        console.log('📊 Mock Hybrid - Estratégia: SMS primeiro (mais barato)');
      }
    }
  }

  async sendOTP(phoneNumber, otpCode = null) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const otp = otpCode || this.generateOTP();
    const formattedPhone = this.formatPhoneNumber(phoneNumber);

    console.log('📱 Mock Hybrid - Enviando OTP:', {
      phone: formattedPhone,
      strategy: this.config.strategy,
      otp: otp
    });

    let result;

    switch (this.config.strategy) {
      case 'sms_first':
        result = await this.sendSMSFirst(formattedPhone, otp);
        break;
      case 'whatsapp_first':
        result = await this.sendWhatsAppFirst(formattedPhone, otp);
        break;
      default:
        result = await this.sendSMSFirst(formattedPhone, otp);
    }

    this.updateStats(result);
    console.log('✅ Mock Hybrid - OTP enviado:', result);

    return result;
  }

  async sendSMSFirst(phoneNumber, otp) {
    console.log('📤 Mock Hybrid - Tentando SMS primeiro...');
    
    const smsResult = await this.sendSMS(phoneNumber, otp);
    
    if (smsResult.success) {
      this.stats.smsSent++;
      this.stats.smsSuccess++;
      return smsResult;
    }
    
    console.log('⚠️ Mock Hybrid - SMS falhou, tentando WhatsApp...');
    
    const whatsappResult = await this.sendWhatsApp(phoneNumber, otp);
    
    if (whatsappResult.success) {
      this.stats.whatsappSent++;
      this.stats.whatsappSuccess++;
      return whatsappResult;
    }
    
    throw new Error('SMS e WhatsApp falharam');
  }

  async sendWhatsAppFirst(phoneNumber, otp) {
    console.log('📤 Mock Hybrid - Tentando WhatsApp primeiro...');
    
    const whatsappResult = await this.sendWhatsApp(phoneNumber, otp);
    
    if (whatsappResult.success) {
      this.stats.whatsappSent++;
      this.stats.whatsappSuccess++;
      return whatsappResult;
    }
    
    console.log('⚠️ Mock Hybrid - WhatsApp falhou, tentando SMS...');
    
    const smsResult = await this.sendSMS(phoneNumber, otp);
    
    if (smsResult.success) {
      this.stats.smsSent++;
      this.stats.smsSuccess++;
      return smsResult;
    }
    
    throw new Error('WhatsApp e SMS falharam');
  }

  async sendSMS(phoneNumber, otp) {
    try {
      console.log('📱 Mock Hybrid - Enviando SMS via Firebase...');
      
      const confirmation = await mockFirebaseAuth.verifyPhoneNumber(phoneNumber);
      
      return {
        success: true,
        otp: otp,
        verificationId: confirmation.verificationId,
        timestamp: new Date().toISOString(),
        provider: 'sms',
        cost: this.getSMSCost()
      };
    } catch (error) {
      console.error('❌ Mock Hybrid - Erro no SMS:', error.message);
      
      return {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString(),
        provider: 'sms'
      };
    }
  }

  async sendWhatsApp(phoneNumber, otp) {
    try {
      console.log('📱 Mock Hybrid - Enviando WhatsApp...');
      
      const result = await this.whatsappService.sendOTP(phoneNumber, otp);
      
      if (result.success) {
        return {
          ...result,
          cost: this.config.whatsappCost
        };
      }
      
      return result;
    } catch (error) {
      console.error('❌ Mock Hybrid - Erro no WhatsApp:', error.message);
      
      return {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString(),
        provider: 'whatsapp'
      };
    }
  }

  generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

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

  getSMSCost() {
    if (this.config.firebasePlan === 'spark' && this.stats.smsSent < this.config.smsFreeLimit) {
      return 0;
    }
    return this.config.smsCost;
  }

  updateStats(result) {
    if (result.success) {
      if (result.provider === 'sms') {
        this.stats.smsSent++;
        this.stats.smsSuccess++;
      } else if (result.provider === 'whatsapp') {
        this.stats.whatsappSent++;
        this.stats.whatsappSuccess++;
      }
    } else {
      this.stats.totalFailures++;
    }
  }

  getStats() {
    const totalSent = this.stats.smsSent + this.stats.whatsappSent;
    const totalSuccess = this.stats.smsSuccess + this.stats.whatsappSuccess;
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

  calculateEstimatedCost() {
    const smsCost = this.stats.smsSent * this.getSMSCost();
    const whatsappCost = this.stats.whatsappSent * this.config.whatsappCost;
    return (smsCost + whatsappCost).toFixed(4);
  }
}

// Função de teste principal
async function testWhatsAppOTP() {
  console.log('🧪 Iniciando teste do WhatsApp OTP...\n');

  const hybridService = new MockHybridOTPService();

  try {
    // Teste 1: Inicialização
    console.log('📋 Teste 1: Inicialização');
    await hybridService.initialize();
    console.log('✅ Inicialização bem-sucedida\n');

    // Teste 2: Envio de OTP (SMS primeiro)
    console.log('📋 Teste 2: Envio de OTP - Estratégia SMS primeiro');
    const result1 = await hybridService.sendOTP('+5521999999999');
    console.log('Resultado:', result1);
    console.log('✅ Teste 2 concluído\n');

    // Teste 3: Envio de OTP (WhatsApp primeiro)
    console.log('📋 Teste 3: Envio de OTP - Estratégia WhatsApp primeiro');
    hybridService.config.strategy = 'whatsapp_first';
    const result2 = await hybridService.sendOTP('+5521888888888');
    console.log('Resultado:', result2);
    console.log('✅ Teste 3 concluído\n');

    // Teste 4: Múltiplos envios para testar estatísticas
    console.log('📋 Teste 4: Múltiplos envios');
    for (let i = 0; i < 5; i++) {
      const phone = `+5521${String(i).padStart(8, '0')}`;
      await hybridService.sendOTP(phone);
    }
    console.log('✅ Teste 4 concluído\n');

    // Teste 5: Estatísticas
    console.log('📋 Teste 5: Estatísticas');
    const stats = hybridService.getStats();
    console.log('Estatísticas:', JSON.stringify(stats, null, 2));
    console.log('✅ Teste 5 concluído\n');

    // Teste 6: Simulação de falhas
    console.log('📋 Teste 6: Simulação de falhas');
    try {
      // Forçar falha no SMS
      mockFirebaseAuth.verifyPhoneNumber = async () => {
        throw new Error('auth/quota-exceeded');
      };
      
      const result3 = await hybridService.sendOTP('+5521777777777');
      console.log('Resultado com falha SMS:', result3);
    } catch (error) {
      console.log('Erro esperado:', error.message);
    }
    console.log('✅ Teste 6 concluído\n');

    console.log('🎉 Todos os testes concluídos com sucesso!');
    console.log('\n📊 Resumo final:');
    console.log(JSON.stringify(hybridService.getStats(), null, 2));

  } catch (error) {
    console.error('❌ Erro durante os testes:', error);
  }
}

// Executar teste se chamado diretamente
if (require.main === module) {
  testWhatsAppOTP();
}

module.exports = {
  MockWhatsAppOTPService,
  MockHybridOTPService,
  testWhatsAppOTP
}; 