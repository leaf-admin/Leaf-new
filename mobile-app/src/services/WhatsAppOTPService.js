import apiClient from './httpClient';

/**
 * Cliente do fluxo OTP WhatsApp da Leaf.
 *
 * A API da Meta é chamada exclusivamente pelo backend. Este módulo existe
 * para manter compatibilidade com telas/experimentos antigos sem carregar
 * access token, phone number id ou configuração de provedor no bundle mobile.
 */
class WhatsAppOTPService {
  async requestOTP(phoneNumber) {
    const response = await apiClient.post('/api/custom-otp/request-otp', {
      phone: phoneNumber
    });
    return response?.data || response;
  }

  async sendOTP(phoneNumber) {
    return this.requestOTP(phoneNumber);
  }

  async verifyOTP(phoneNumber, verificationId, otp) {
    const response = await apiClient.post('/api/custom-otp/verify-otp', {
      phone: phoneNumber,
      verificationId,
      otp
    });
    return response?.data || response;
  }

  getServiceInfo() {
    return {
      provider: 'whatsapp-cloud-api',
      transport: 'leaf-backend',
      credentialsInMobileBundle: false
    };
  }
}

export default new WhatsAppOTPService();
