/**
 * 🔐 KYC Service
 * 
 * Serviço para integração com backend de KYC
 * Envia imagens processadas (com face detectada) para o backend
 */

import Logger from '../utils/Logger';
import faceDetectionService from './FaceDetectionService';
import { getSelfHostedApiUrl } from '../config/ApiConfig';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImageManipulator from 'expo-image-manipulator';

class KYCService {
  getAnchorStorageKey(driverId) {
    return `@kyc_anchor_signature_${driverId}`;
  }

  async buildSignature(imageUri) {
    const normalized = await ImageManipulator.manipulateAsync(
      imageUri,
      [{ resize: { width: 96, height: 96 } }],
      { compress: 0.6, format: ImageManipulator.SaveFormat.JPEG, base64: true }
    );

    const base64 = normalized.base64 || '';
    const signature = this.simHashBase64(base64);
    return {
      signature,
      normalizedUri: normalized.uri,
      algorithm: 'simhash-base64-v1'
    };
  }

  simHashBase64(base64String, bits = 128) {
    const weights = new Array(bits).fill(0);
    const input = String(base64String || '');

    for (let i = 0; i < input.length - 3; i += 2) {
      const token = input.slice(i, i + 4);
      const hash = this.fnv1a32(token);
      for (let bit = 0; bit < bits; bit += 1) {
        const on = ((hash >>> (bit % 32)) & 1) === 1;
        weights[bit] += on ? 1 : -1;
      }
    }

    let out = '';
    for (let i = 0; i < bits; i += 4) {
      let nibble = 0;
      for (let b = 0; b < 4; b += 1) {
        if (weights[i + b] >= 0) {
          nibble |= (1 << (3 - b));
        }
      }
      out += nibble.toString(16);
    }
    return out;
  }

  fnv1a32(str) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < str.length; i += 1) {
      hash ^= str.charCodeAt(i);
      hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
    }
    return hash >>> 0;
  }

  similarityFromSignatures(a, b) {
    if (!a || !b || a.length !== b.length) return 0;
    let diff = 0;
    for (let i = 0; i < a.length; i += 1) {
      const n1 = parseInt(a[i], 16);
      const n2 = parseInt(b[i], 16);
      const xor = n1 ^ n2;
      diff += (xor & 1) + ((xor >> 1) & 1) + ((xor >> 2) & 1) + ((xor >> 3) & 1);
    }
    const totalBits = a.length * 4;
    return Math.max(0, 1 - (diff / totalBits));
  }

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

      // 3. Device-first: gerar assinaturas e comparar localmente
      const cnhSig = await this.buildSignature(cnhProcessed.alignedUri || cnhImageUri);
      const selfieSig = await this.buildSignature(selfieProcessed.alignedUri || selfieImageUri);
      const similarity = this.similarityFromSignatures(cnhSig.signature, selfieSig.signature);
      const approveThreshold = 0.5;
      const reviewThreshold = 0.4;

      // Guardar âncora local para verificação diária sem recarregar backend
      await AsyncStorage.setItem(this.getAnchorStorageKey(driverId), selfieSig.signature);

      // 4. Enviar somente metadata leve para backend
      const backendUrl = getSelfHostedApiUrl('/api/drivers/kyc/onboarding');
      const response = await fetch(backendUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          onboardingMode: 'device_signature_v1',
          driverId,
          similarityScore: similarity,
          approveThreshold,
          reviewThreshold,
          cnhSignature: cnhSig.signature,
          selfieSignature: selfieSig.signature,
          signatureAlgorithm: selfieSig.algorithm
        }),
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

      // Device-first: gerar assinatura da selfie atual
      const currentSig = await this.buildSignature(selfieProcessed.alignedUri || selfieImageUri);
      let anchorSignature = await AsyncStorage.getItem(this.getAnchorStorageKey(driverId));

      if (!anchorSignature) {
        const anchorUrl = getSelfHostedApiUrl(`/api/kyc/device-anchor/${driverId}`);
        const anchorResp = await fetch(anchorUrl, { method: 'GET' });
        const anchorData = await anchorResp.json().catch(() => ({}));
        if (anchorResp.ok && anchorData?.anchorSignature) {
          anchorSignature = anchorData.anchorSignature;
          await AsyncStorage.setItem(this.getAnchorStorageKey(driverId), anchorSignature);
        }
      }

      if (!anchorSignature) {
        throw new Error('Assinatura âncora não encontrada. Faça onboarding KYC novamente.');
      }

      const similarity = this.similarityFromSignatures(anchorSignature, currentSig.signature);
      const threshold = 0.5;
      const isMatch = similarity >= threshold;

      // Enviar resultado leve para backend
      const backendUrl = getSelfHostedApiUrl('/api/kyc/verify-driver/device');
      const response = await fetch(backendUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: driverId,
          deviceKyc: {
            mode: 'device_signature_v1',
            recoverBlocked: true,
            isMatch,
            similarityScore: similarity,
            confidence: similarity,
            threshold,
            processingTime: 0,
            currentSignatureHash: currentSig.signature.slice(0, 12),
            anchorSignatureHash: anchorSignature.slice(0, 12)
          }
        }),
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
