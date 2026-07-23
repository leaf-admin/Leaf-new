/**
 * 🔐 KYC Service
 * 
 * Serviço para integração com backend de KYC
 * Envia imagens processadas (com face detectada) para o backend
 */

import Logger from '../utils/Logger';
import faceDetectionService from './FaceDetectionService';
import deviceFaceEmbeddingService from './DeviceFaceEmbeddingService';
import { getSelfHostedApiUrl } from '../config/ApiConfig';
import AsyncStorage from '@react-native-async-storage/async-storage';
import auth from '@react-native-firebase/auth';
import * as ImageManipulator from 'expo-image-manipulator';
import {
  allowTestUserTools,
  isE2ETestBuild,
  isSimulatorBuild,
} from '../config/runtimeAccessPolicy';

const TEST_MODE_STORAGE_KEY = '@test_mode';
const QA_SOCKET_ID_TOKEN_STORAGE_KEY = '@qa_socket_id_token';
const QA_AUTH_TOKEN_MIN_TTL_MS = 60000;
const EXPECTED_CANONICAL_VERIFICATION_FAILURE_CODES = new Set([
  'AWS_COMPARE_FACES_INVALID_PARAMETER',
  'AWS_COMPARE_FACES_CNH_FACE_NOT_DETECTED',
  'AWS_COMPARE_FACES_LIVENESS_FACE_BOUNDS_REQUIRED',
  'KYC_AWS_REFERENCE_IMAGE_REQUIRED',
  'KYC_CNH_PORTRAIT_LAYOUT_UNSUPPORTED',
  'KYC_CNH_PORTRAIT_EXTRACTION_FAILED',
  'KYC_CHALLENGE_NOT_PASSED',
]);

const SAFE_KYC_OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const SAFE_KYC_REQUIREMENT_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;

function normalizeSafeKycOpaqueId(value) {
  const normalized = String(value || '').trim();
  return SAFE_KYC_OPAQUE_ID_PATTERN.test(normalized) ? normalized : null;
}

function normalizeSafeKycRequirement(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return SAFE_KYC_REQUIREMENT_PATTERN.test(normalized) ? normalized : null;
}

function createKycApiError(result = {}, response = {}, fallbackMessage) {
  const error = new Error(
    result?.error ||
    result?.message ||
    fallbackMessage ||
    'Nao foi possivel concluir a solicitacao de validacao.'
  );
  error.code = String(result?.code || '').trim();
  error.status = Number(response?.status) || null;
  error.retryAt = result?.retryAt || result?.attemptState?.retryAt || null;
  error.evidenceId = normalizeSafeKycOpaqueId(result?.evidenceId);
  error.reviewCaseId = normalizeSafeKycOpaqueId(result?.reviewCaseId);
  error.challengeId = normalizeSafeKycOpaqueId(result?.challengeId);
  error.requirement = normalizeSafeKycRequirement(result?.requirement);
  error.reviewAvailable = typeof result?.reviewAvailable === 'boolean'
    ? result.reviewAvailable
    : null;
  return error;
}

function serializeKycFailure(error) {
  const evidenceId = normalizeSafeKycOpaqueId(error?.evidenceId);
  const reviewCaseId = normalizeSafeKycOpaqueId(error?.reviewCaseId);
  const challengeId = normalizeSafeKycOpaqueId(error?.challengeId);
  const requirement = normalizeSafeKycRequirement(error?.requirement);

  return {
    success: false,
    error: error?.message || 'Nao foi possivel concluir a solicitacao de validacao.',
    code: String(error?.code || '').trim() || null,
    status: Number(error?.status || error?.response?.status) || null,
    retryAt: error?.retryAt || null,
    ...(evidenceId ? { evidenceId } : {}),
    ...(reviewCaseId ? { reviewCaseId } : {}),
    ...(challengeId ? { challengeId } : {}),
    ...(requirement ? { requirement } : {}),
    ...(typeof error?.reviewAvailable === 'boolean'
      ? { reviewAvailable: error.reviewAvailable }
      : {}),
  };
}

function decodeBase64UrlJson(segment) {
  const normalized = String(segment || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    '=',
  );

  if (typeof globalThis?.atob === 'function') {
    return JSON.parse(globalThis.atob(padded));
  }

  if (typeof Buffer !== 'undefined') {
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
  }

  return null;
}

function isJwtExpiredOrNearExpiry(token, nowMs = Date.now()) {
  const parts = String(token || '').split('.');
  if (parts.length < 2) {
    return false;
  }

  try {
    const payload = decodeBase64UrlJson(parts[1]);
    const expSeconds = Number(payload?.exp);
    if (!Number.isFinite(expSeconds) || expSeconds <= 0) {
      return false;
    }
    return expSeconds * 1000 <= nowMs + QA_AUTH_TOKEN_MIN_TTL_MS;
  } catch (_error) {
    return false;
  }
}

async function resolveKycAuthToken({ forceRefresh = false } = {}) {
  try {
    const currentUser = auth().currentUser;
    if (currentUser) {
      return await currentUser.getIdToken(Boolean(forceRefresh));
    }
  } catch (tokenError) {
    Logger.warn('⚠️ [KYC] Falha ao obter token Firebase:', tokenError);
  }

  if (!(allowTestUserTools() && isSimulatorBuild() && isE2ETestBuild())) {
    return null;
  }

  try {
    const [testModeRaw, qaSocketIdTokenRaw] = await Promise.all([
      AsyncStorage.getItem(TEST_MODE_STORAGE_KEY),
      AsyncStorage.getItem(QA_SOCKET_ID_TOKEN_STORAGE_KEY)
    ]);
    const qaModeEnabled = String(testModeRaw || '').trim().toLowerCase() === 'true';
    const qaSocketIdToken = String(qaSocketIdTokenRaw || '').trim();
    if (qaModeEnabled && qaSocketIdToken) {
      if (isJwtExpiredOrNearExpiry(qaSocketIdToken)) {
        Logger.warn('⚠️ [KYC] Token QA persistido expirado; autenticação KYC indisponível até restaurar sessão.');
        return null;
      }
      return qaSocketIdToken;
    }
  } catch (qaTokenError) {
    Logger.warn('⚠️ [KYC] Falha ao recuperar token QA persistido:', qaTokenError);
  }

  return null;
}

async function buildKycAuthHeaders({ json = true } = {}) {
  const headers = {
    Accept: 'application/json'
  };
  if (json) {
    headers['Content-Type'] = 'application/json';
  }

  const token = await resolveKycAuthToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

class KYCService {
  getAwsProviderName() {
    return 'aws_rekognition_face_liveness';
  }

  async getLivenessProvider() {
    try {
      const backendUrl = getSelfHostedApiUrl('/api/kyc/liveness/provider');
      const response = await fetch(backendUrl, {
        method: 'GET',
        headers: await buildKycAuthHeaders({ json: false })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw createKycApiError(
          result,
          response,
          `Erro ${response.status}: ${response.statusText}`
        );
      }
      return {
        success: true,
        data: result
      };
    } catch (error) {
      Logger.error('❌ Erro ao consultar provider de liveness:', error);
      return serializeKycFailure(error);
    }
  }

  async getPreferredLivenessMode() {
    const providerResult = await this.getLivenessProvider();
    if (!providerResult?.success) {
      return {
        success: false,
        mode: 'local',
        provider: null,
        config: null,
        error: providerResult?.error || 'Falha ao consultar provider de liveness',
        code: providerResult?.code || null,
        status: providerResult?.status || null,
        retryAt: providerResult?.retryAt || null,
      };
    }

    const provider = providerResult?.data?.provider || null;
    const config = providerResult?.data?.config || {};
    const awsReady = (
      config.enabled === true
      && config.credentialsEnabled === true
      && config.hasAssumeRoleArn === true
    );

    return {
      success: true,
      mode: awsReady ? 'aws' : 'local',
      provider,
      config
    };
  }

  async createAwsLivenessSession(driverId, options = {}) {
    try {
      const backendUrl = getSelfHostedApiUrl('/api/kyc/liveness/aws/session');
      const response = await fetch(backendUrl, {
        method: 'POST',
        headers: await buildKycAuthHeaders(),
        body: JSON.stringify({
          userId: driverId,
          challengeId: options?.challengeId || null,
          requirement: options?.requirement || null
        }),
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw createKycApiError(
          result,
          response,
          `Erro ${response.status}: ${response.statusText}`
        );
      }

      return {
        success: true,
        data: result
      };
    } catch (error) {
      Logger.error('❌ Erro ao criar sessão AWS liveness:', error);
      return serializeKycFailure(error);
    }
  }

  async getAwsLivenessCredentials(driverId, sessionId) {
    try {
      const normalizedSessionId = String(sessionId || '').trim();
      if (!normalizedSessionId) {
        const error = new Error('A sessão criada não foi vinculada à emissão de credenciais.');
        error.code = 'KYC_AWS_LIVENESS_SESSION_REQUIRED';
        error.status = 400;
        throw error;
      }

      const backendUrl = getSelfHostedApiUrl(
        `/api/kyc/liveness/aws/credentials?userId=${encodeURIComponent(driverId)}&sessionId=${encodeURIComponent(normalizedSessionId)}`
      );
      const response = await fetch(backendUrl, {
        method: 'GET',
        headers: await buildKycAuthHeaders({ json: false })
      });
      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw createKycApiError(
          result,
          response,
          `Erro ${response.status}: ${response.statusText}`
        );
      }

      return {
        success: true,
        data: result
      };
    } catch (error) {
      Logger.error('❌ Erro ao buscar credenciais AWS liveness:', error);
      return serializeKycFailure(error);
    }
  }

  async getAwsLivenessSessionResult(driverId, sessionId) {
    try {
      const backendUrl = getSelfHostedApiUrl(
        `/api/kyc/liveness/aws/session/${sessionId}?userId=${encodeURIComponent(driverId)}`
      );
      const response = await fetch(backendUrl, {
        method: 'GET',
        headers: await buildKycAuthHeaders({ json: false })
      });
      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw createKycApiError(
          result,
          response,
          `Erro ${response.status}: ${response.statusText}`
        );
      }

      return {
        success: true,
        data: result
      };
    } catch (error) {
      Logger.error('❌ Erro ao buscar resultado AWS liveness:', error);
      return serializeKycFailure(error);
    }
  }

  async abandonAwsLivenessSession(driverId, sessionId) {
    try {
      const normalizedSessionId = String(sessionId || '').trim();
      if (!normalizedSessionId) {
        const error = new Error('A sessão de validação não foi informada.');
        error.code = 'KYC_AWS_LIVENESS_SESSION_REQUIRED';
        error.status = 400;
        throw error;
      }

      const backendUrl = getSelfHostedApiUrl(
        `/api/kyc/liveness/aws/session/${encodeURIComponent(normalizedSessionId)}/abandon`
      );
      const response = await fetch(backendUrl, {
        method: 'POST',
        headers: await buildKycAuthHeaders(),
        body: JSON.stringify({ userId: driverId })
      });
      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw createKycApiError(
          result,
          response,
          `Erro ${response.status}: ${response.statusText}`
        );
      }

      return {
        success: true,
        data: result
      };
    } catch (error) {
      Logger.error('❌ Erro ao encerrar sessão AWS liveness:', error);
      return serializeKycFailure(error);
    }
  }

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
      const response = await fetch(backendUrl, {
        method: 'GET',
        headers: await buildKycAuthHeaders({ json: false })
      });
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
        headers: await buildKycAuthHeaders(),
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
   * @param {Object} options - Opções adicionais de verificação
   * @returns {Promise<Object>} Resultado da verificação
   */
  async verifyDriver(driverId, selfieImageUri, options = {}) {
    try {
      Logger.log('🔐 Verificando identidade do motorista:', driverId);
      const challengeId = options?.challengeId || null;
      const requirement = options?.requirement || null;
      const livenessPassed = options?.livenessPassed === true;
      const awsSessionId = options?.awsSessionId || null;
      const verificationMode = options?.mode
        || (awsSessionId ? this.getAwsProviderName() : 'device_signature_v1');
      const useAwsSessionOnly = Boolean(awsSessionId) && !selfieImageUri;
      const allowRawSelfieFallback = options?.allowRawSelfieFallback === true;
      const serverSideFallbackOnDeviceEmbeddingUnavailable =
        options?.serverSideFallbackOnDeviceEmbeddingUnavailable === true;
      const preferServerSideSelfieVerification =
        options?.preferServerSideSelfieVerification === true;

      let similarity = null;
      let threshold = null;
      let isMatch = null;
      let currentSignatureHash = null;
      let anchorSignatureHash = null;
      let deviceEmbeddingPayload = null;
      let effectiveVerificationMode = verificationMode;

      if (awsSessionId && selfieImageUri && preferServerSideSelfieVerification) {
        return this.verifyDriverServerSideSelfie(driverId, selfieImageUri, {
          ...options,
          awsSessionId,
          challengeId,
          requirement,
        });
      }

      if (!useAwsSessionOnly) {
        let signatureSourceUri = selfieImageUri;

        // Processar selfie quando houver metadados de face disponíveis.
        const selfieProcessed = await faceDetectionService.processImage(selfieImageUri);
        if (selfieProcessed.success && selfieProcessed.detection?.hasFace) {
          signatureSourceUri = selfieProcessed.alignedUri || selfieImageUri;
        } else if (allowRawSelfieFallback && selfieImageUri) {
          Logger.warn(
            '⚠️ [KYC] Detecção facial local indisponível; usando selfie bruta como assinatura de verificação diária.',
            selfieProcessed?.error
          );
        } else {
          throw new Error('Nenhuma face detectada na selfie. Por favor, tire outra foto.');
        }

        try {
          deviceEmbeddingPayload = await deviceFaceEmbeddingService.generateEmbeddingPayload(signatureSourceUri, {
            challengeId,
            livenessSessionId: awsSessionId,
          });
        } catch (embeddingError) {
          Logger.warn(
            '⚠️ [KYC] Embedding facial no dispositivo indisponível; usando assinatura local legada.',
            embeddingError
          );
          deviceEmbeddingPayload = null;
        }

        if (deviceEmbeddingPayload?.embedding) {
          effectiveVerificationMode = deviceEmbeddingPayload.mode || 'mobile_arcface_w600k_r50_v1';
        } else if (serverSideFallbackOnDeviceEmbeddingUnavailable && awsSessionId) {
          Logger.warn(
            '⚠️ [KYC] Embedding facial no dispositivo indisponível; usando fallback server-side pós-liveness.'
          );
          return this.verifyDriverServerSideSelfie(driverId, selfieImageUri, {
            ...options,
            awsSessionId,
            challengeId,
            requirement,
          });
        } else {
          // Device-first legado: gerar assinatura da selfie atual
          const currentSig = await this.buildSignature(signatureSourceUri);
          let anchorSignature = await AsyncStorage.getItem(this.getAnchorStorageKey(driverId));

          if (!anchorSignature) {
            const anchorUrl = getSelfHostedApiUrl(`/api/kyc/device-anchor/${driverId}`);
            const anchorResp = await fetch(anchorUrl, {
              method: 'GET',
              headers: await buildKycAuthHeaders({ json: false })
            });
            const anchorData = await anchorResp.json().catch(() => ({}));
            if (anchorResp.ok && anchorData?.anchorSignature) {
              anchorSignature = anchorData.anchorSignature;
              await AsyncStorage.setItem(this.getAnchorStorageKey(driverId), anchorSignature);
            }
          }

          if (!anchorSignature) {
            throw new Error('Assinatura âncora não encontrada. Faça onboarding KYC novamente.');
          }

          similarity = this.similarityFromSignatures(anchorSignature, currentSig.signature);
          threshold = 0.5;
          isMatch = similarity >= threshold;
          currentSignatureHash = currentSig.signature.slice(0, 12);
          anchorSignatureHash = anchorSignature.slice(0, 12);
        }
      }

      // Enviar resultado leve para backend
      const backendUrl = getSelfHostedApiUrl('/api/kyc/verify-driver/device');
      const deviceKycPayload = {
        ...(deviceEmbeddingPayload || {}),
        mode: effectiveVerificationMode,
        provider: deviceEmbeddingPayload?.provider || effectiveVerificationMode,
        recoverBlocked: true,
        isMatch: typeof isMatch === 'boolean' ? isMatch : undefined,
        similarityScore: typeof similarity === 'number' ? similarity : undefined,
        confidence: typeof similarity === 'number' ? similarity : undefined,
        threshold: typeof threshold === 'number' ? threshold : undefined,
        processingTime: Number(deviceEmbeddingPayload?.processingTime || 0),
        livenessPassed,
        awsSessionId: awsSessionId || undefined,
        aws: awsSessionId
          ? {
            sessionId: awsSessionId,
            provider: this.getAwsProviderName()
          }
          : undefined,
        currentSignatureHash: currentSignatureHash || undefined,
        anchorSignatureHash: anchorSignatureHash || undefined
      };

      const response = await fetch(backendUrl, {
        method: 'POST',
        headers: await buildKycAuthHeaders(),
        body: JSON.stringify({
          userId: driverId,
          challengeId,
          requirement,
          deviceKyc: deviceKycPayload
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

  async verifyDriverServerSideSelfie(driverId, selfieImageUri, options = {}) {
    try {
      Logger.log('🔐 Verificando identidade do motorista no backend:', driverId);
      const awsSessionId = options?.awsSessionId || null;
      if (!awsSessionId) {
        throw new Error('Sessão AWS de liveness é obrigatória para validar a selfie.');
      }

      const formData = new FormData();
      formData.append('userId', driverId);
      formData.append('awsSessionId', awsSessionId);
      if (options?.challengeId) {
        formData.append('challengeId', options.challengeId);
      }
      if (options?.requirement) {
        formData.append('requirement', options.requirement);
      }
      if (options?.forceRecheck === true) {
        formData.append('forceRecheck', 'true');
      }
      if (selfieImageUri) {
        formData.append('currentImage', {
          uri: selfieImageUri,
          name: 'driver-selfie.jpg',
          type: 'image/jpeg'
        });
      }

      const backendUrl = getSelfHostedApiUrl('/api/kyc/verify-driver/server-side-selfie');
      const response = await fetch(backendUrl, {
        method: 'POST',
        headers: await buildKycAuthHeaders({ json: false }),
        body: formData
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw createKycApiError(
          result,
          response,
          `Erro ${response.status}: ${response.statusText}`
        );
      }

      Logger.log('✅ Verificação server-side concluída:', result);
      return {
        success: true,
        data: result
      };
    } catch (error) {
      const logMetadata = {
        code: error?.code || null,
        status: error?.status || null,
      };
      if (EXPECTED_CANONICAL_VERIFICATION_FAILURE_CODES.has(error?.code)) {
        Logger.warn('⚠️ Não foi possível concluir a verificação de identidade:', logMetadata);
      } else {
        Logger.error('❌ Erro inesperado ao verificar identidade no backend:', logMetadata);
      }
      return serializeKycFailure(error);
    }
  }
}

// Singleton
const kycService = new KYCService();

export default kycService;
