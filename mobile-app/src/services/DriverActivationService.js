import auth from '@react-native-firebase/auth';
import Logger from '../utils/Logger';
import { getSelfHostedApiUrl } from '../config/ApiConfig';
import { createAxiosInstance } from '../utils/axiosInterceptor';

function ensurePdfAsset(asset = {}) {
  const uri = String(asset?.uri || '').trim();
  const mimeType = String(asset?.mimeType || asset?.type || 'application/pdf').trim();
  const name = String(asset?.name || `document-${Date.now()}.pdf`).trim();

  if (!uri) {
    throw new Error('Arquivo PDF inválido');
  }

  if (mimeType !== 'application/pdf') {
    throw new Error('Somente arquivos PDF são aceitos');
  }

  return {
    uri,
    type: mimeType,
    name,
    size: Number(asset?.size || 0)
  };
}

const DRIVER_ACTIVATION_PUBLIC_ERRORS = Object.freeze({
  DRIVER_ACTIVATION_DOCUMENT_CONFLICT:
    'Outro envio está sendo finalizado. Aguarde alguns instantes e tente novamente.',
  DRIVER_ACTIVATION_STORAGE_UPLOAD_FAILED:
    'Não foi possível armazenar o documento agora. Tente novamente.',
  DRIVER_ACTIVATION_PDF_REQUIRED:
    'Envie um arquivo PDF válido de até 20 MB.',
  KYC_IDENTITY_FRAUD_PERMANENT_BLOCK:
    'Esta conta não pode substituir a CNH. Fale com o suporte se precisar de ajuda.',
  KYC_IDENTITY_REVIEW_HOLD:
    'Sua identidade já está em análise. Aguarde a conclusão antes de enviar outra CNH.',
  KYC_VERIFICATION_IN_PROGRESS:
    'Outra validação de identidade está em andamento. Tente novamente depois.',
  BACKGROUND_CHECK_CONSENT_BOOLEAN_REQUIRED:
    'Confirme sua autorização para continuar.'
});

function normalizeErrorMessage(error, fallback = 'Não foi possível concluir esta ação agora.') {
  const code = String(error?.response?.data?.code || error?.code || '').trim();
  if (DRIVER_ACTIVATION_PUBLIC_ERRORS[code]) return DRIVER_ACTIVATION_PUBLIC_ERRORS[code];
  const status = Number(error?.response?.status || error?.status || 0);
  if (status === 401 || status === 403) {
    return 'Sua sessão expirou. Entre novamente para continuar.';
  }
  return String(fallback || 'Não foi possível concluir esta ação agora.');
}

class DriverActivationService {
  constructor() {
    const apiBaseUrl = getSelfHostedApiUrl('');
    this.api = createAxiosInstance({
      baseURL: apiBaseUrl,
      timeout: 60000
    });
  }

  async getAuthHeaders(forceRefresh = false) {
    const user = auth().currentUser;
    if (!user) {
      throw new Error('Usuário não autenticado');
    }

    const token = await user.getIdToken(Boolean(forceRefresh));
    if (!token) {
      throw new Error('Token de autenticação indisponível');
    }

    return {
      Authorization: `Bearer ${token}`
    };
  }

  async withPublicError(operation, fallback) {
    try {
      return await operation();
    } catch (error) {
      const publicError = new Error(normalizeErrorMessage(error, fallback));
      publicError.code = String(error?.response?.data?.code || error?.code || 'DRIVER_ACTIVATION_UNAVAILABLE');
      throw publicError;
    }
  }

  async submitDocument(type, pdfAsset) {
    return this.withPublicError(async () => {
      const normalizedType = String(type || '').trim().toLowerCase();
      const file = ensurePdfAsset(pdfAsset);

      const formData = new FormData();
      formData.append('pdf', {
        uri: file.uri,
        type: file.type,
        name: file.name
      });

      const headers = await this.getAuthHeaders(false);
      const response = await this.api.post(`/api/drivers/me/activation/documents/${normalizedType}`, formData, {
        headers: {
          ...headers,
          Accept: 'application/json',
          'Content-Type': 'multipart/form-data'
        }
      });

      return response?.data || null;
    }, 'Não foi possível enviar o documento agora. Tente novamente.');
  }

  async getActivationStatus() {
    return this.withPublicError(async () => {
      const headers = await this.getAuthHeaders(false);
      const response = await this.api.get('/api/drivers/me/activation/status', {
        headers: {
          ...headers,
          Accept: 'application/json'
        }
      });

      return response?.data || null;
    }, 'Não foi possível atualizar o status do cadastro agora.');
  }

  async getActivationDocuments() {
    return this.withPublicError(async () => {
      const headers = await this.getAuthHeaders(false);
      const response = await this.api.get('/api/drivers/me/activation/documents', {
        headers: {
          ...headers,
          Accept: 'application/json'
        }
      });

      return response?.data || null;
    }, 'Não foi possível carregar seus documentos agora.');
  }

  async submitBackgroundCheckConsent(accepted = true) {
    return this.withPublicError(async () => {
      const headers = await this.getAuthHeaders(false);
      const response = await this.api.post(
        '/api/drivers/me/activation/consent/background-check',
        { accepted: Boolean(accepted) },
        {
          headers: {
            ...headers,
            Accept: 'application/json'
          }
        }
      );

      return response?.data || null;
    }, 'Não foi possível atualizar sua autorização agora. Tente novamente.');
  }

  async pollActivationStatus({ maxAttempts = 20, intervalMs = 3000 } = {}) {
    const safeAttempts = Math.max(1, Number(maxAttempts) || 20);
    const safeIntervalMs = Math.max(800, Number(intervalMs) || 3000);

    let lastError = null;
    for (let attempt = 1; attempt <= safeAttempts; attempt += 1) {
      try {
        const statusPayload = await this.getActivationStatus();
        return statusPayload;
      } catch (error) {
        lastError = error;
        if (attempt < safeAttempts) {
          await new Promise(resolve => setTimeout(resolve, safeIntervalMs));
        }
      }
    }

    const message = normalizeErrorMessage(lastError, 'Não foi possível sincronizar status de ativação.');
    Logger.warn('⚠️ [DriverActivationService] Poll status failed:', message);
    throw new Error(message);
  }
}

const driverActivationService = new DriverActivationService();
export default driverActivationService;

export { ensurePdfAsset, normalizeErrorMessage, DRIVER_ACTIVATION_PUBLIC_ERRORS };
