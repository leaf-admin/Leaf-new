/**
 * 🔐 KYC Service
 * 
 * Serviço para integração com backend de KYC
 * Envia imagens processadas (com face detectada) para o backend
 */

import Logger from '../utils/Logger';
import faceDetectionService from './FaceDetectionService';
import { getSelfHostedApiUrl } from '../config/ApiConfig';

class KYCService {
  /**
   * Verificar se motorista já possui validação KYC diária válida
   * @param {string} driverId
   * @param {number} maxAgeHours
   * @returns {Promise<Object>}
   */
  async getVerificationStatus(driverId, maxAgeHours = 24) {
    try {
      const backendUrl = getSelfHostedApiUrl(`/api/kyc/verification-status/${driverId}?maxAgeHours=${maxAgeHours}`);
      const response = await fetch(backendUrl, { method: 'GET' });
      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(result.error || `Erro ${response.status}: ${response.statusText}`);
      }

      return result;
    } catch (error) {
      Logger.error('❌ Erro ao consultar status de verificação KYC:', error);
      return {
        success: false,
        hasValid: false,
        reason: error.message,
      };
    }
  }

  /**
   * Processar onboarding KYC (CNH + Selfie)
   * @param {string} driverId - ID do motorista
   * @param {string} cnhImageUri - URI da imagem da CNH
   * @param {string} selfieImageUri - URI da imagem da selfie
   * @returns {Promise<Object>} Resultado do processamento
   */
  async processOnboarding(driverId, cnhImageUri, selfieImageUri) {
    try {
      Logger.log('🔐 Processando KYC onboarding para:', driverId);

      // 1. Processar CNH (detectar face se houver)
      const cnhProcessed = await faceDetectionService.processImage(cnhImageUri);
      if (!cnhProcessed.success) {
        Logger.warn('⚠️ CNH não processada, usando original');
      }

      // 2. Processar Selfie (sempre deve ter face)
      const selfieProcessed = await faceDetectionService.processImage(selfieImageUri);
      if (!selfieProcessed.success || !selfieProcessed.detection.hasFace) {
        throw new Error('Nenhuma face detectada na selfie. Por favor, tire outra foto.');
      }

      // 3. Preparar dados para envio
      const formData = new FormData();
      
      // Adicionar CNH
      formData.append('cnh', {
        uri: cnhProcessed.alignedUri || cnhImageUri,
        type: 'image/jpeg',
        name: 'cnh.jpg',
      });

      // Adicionar Selfie
      formData.append('selfie', {
        uri: selfieProcessed.alignedUri || selfieImageUri,
        type: 'image/jpeg',
        name: 'selfie.jpg',
      });

      // Adicionar driverId
      formData.append('driverId', driverId);

      // 4. Enviar para backend
      const backendUrl = getSelfHostedApiUrl('/api/drivers/kyc/onboarding');
      
      const response = await fetch(backendUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Erro ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      Logger.log('✅ KYC onboarding processado:', result);

      return {
        success: true,
        data: result.data,
      };
    } catch (error) {
      Logger.error('❌ Erro ao processar KYC onboarding:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Verificar identidade do motorista (re-verificação)
   * @param {string} driverId - ID do motorista
   * @param {string} selfieImageUri - URI da imagem da selfie atual
   * @returns {Promise<Object>} Resultado da verificação
   */
  async verifyDriver(driverId, selfieImageUri) {
    try {
      Logger.log('🔐 Verificando identidade do motorista:', driverId);

      // Processar selfie (deve ter face)
      const selfieProcessed = await faceDetectionService.processImage(selfieImageUri);
      if (!selfieProcessed.success || !selfieProcessed.detection.hasFace) {
        throw new Error('Nenhuma face detectada na selfie. Por favor, tire outra foto.');
      }

      // Preparar dados para envio
      const formData = new FormData();
      
      formData.append('currentImage', {
        uri: selfieProcessed.alignedUri || selfieImageUri,
        type: 'image/jpeg',
        name: 'selfie.jpg',
      });

      formData.append('userId', driverId);

      // Enviar para backend
      const backendUrl = getSelfHostedApiUrl('/api/kyc/verify-driver');
      
      const response = await fetch(backendUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Erro ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      Logger.log('✅ Verificação de identidade concluída:', result);

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      Logger.error('❌ Erro ao verificar identidade:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }
}

// Singleton
const kycService = new KYCService();

export default kycService;
