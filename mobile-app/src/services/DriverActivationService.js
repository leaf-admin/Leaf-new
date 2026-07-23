import auth from '@react-native-firebase/auth';
import Logger from '../utils/Logger';
import { getSelfHostedApiUrl } from '../config/ApiConfig';
import { createAxiosInstance } from '../utils/axiosInterceptor';
import { postMultipartJson } from '../utils/multipartJsonRequest';

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

function normalizeErrorMessage(error, fallback) {
  const apiMessage =
    error?.response?.data?.message ||
    error?.response?.data?.error ||
    error?.message ||
    fallback;

  return String(apiMessage || fallback);
}

class DriverActivationService {
  constructor() {
    const apiBaseUrl = getSelfHostedApiUrl('');
    this.apiBaseUrl = String(apiBaseUrl || '').replace(/\/+$/, '');
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

  async submitDocument(type, pdfAsset) {
    const normalizedType = String(type || '').trim().toLowerCase();
    const file = ensurePdfAsset(pdfAsset);

    const formData = new FormData();
    formData.append('pdf', {
      uri: file.uri,
      type: file.type,
      name: file.name
    });

    const headers = await this.getAuthHeaders(false);
    return postMultipartJson(
      `${this.apiBaseUrl}/api/drivers/me/activation/documents/${normalizedType}`,
      formData,
      {
        headers,
        timeoutMs: 60000
      }
    );
  }

  async getActivationStatus() {
    const headers = await this.getAuthHeaders(false);
    const response = await this.api.get('/api/drivers/me/activation/status', {
      headers: {
        ...headers,
        Accept: 'application/json'
      }
    });

    return response?.data || null;
  }

  async getActivationDocuments() {
    const headers = await this.getAuthHeaders(false);
    const response = await this.api.get('/api/drivers/me/activation/documents', {
      headers: {
        ...headers,
        Accept: 'application/json'
      }
    });

    return response?.data || null;
  }

  async submitBackgroundCheckConsent(accepted = true) {
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

export { ensurePdfAsset, normalizeErrorMessage };
