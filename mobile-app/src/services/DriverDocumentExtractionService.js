import Logger from '../utils/Logger';
import auth from '@react-native-firebase/auth';
import { getSelfHostedApiUrl } from '../config/ApiConfig';
import { postMultipartJson } from '../utils/multipartJsonRequest';

function ensurePdfAsset(asset = {}) {
  const uri = String(asset?.uri || '').trim();
  const mimeType = String(asset?.mimeType || asset?.type || 'application/pdf').trim();
  const name = String(asset?.name || `document-${Date.now()}.pdf`).trim();

  if (!uri) {
    throw new Error('Arquivo PDF inválido');
  }

  return {
    uri,
    type: mimeType || 'application/pdf',
    name
  };
}

function normalizeApiResult(payload = {}) {
  return {
    success: Boolean(payload?.success),
    source: payload?.source || 'unknown',
    model: payload?.model || null,
    usedFallback: Boolean(payload?.usedFallback),
    textLength: Number(payload?.textLength || 0),
    data: payload?.data || null,
    message: payload?.message || null
  };
}

class DriverDocumentExtractionService {
  constructor() {
    this.apiBaseUrl = String(getSelfHostedApiUrl('') || '').replace(/\/+$/, '');
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

  async extractCNHFromPDF({ pdfAsset, userId }) {
    const file = ensurePdfAsset(pdfAsset);
    const formData = new FormData();
    formData.append('pdf', file);
    if (userId) {
      formData.append('userId', String(userId));
    }

    Logger.log('📄 [DriverDocumentExtraction] Enviando CNH PDF para extração...');
    const authHeaders = await this.getAuthHeaders(false);
    const payload = await postMultipartJson(`${this.apiBaseUrl}/api/ocr/cnh/pdf`, formData, {
      headers: authHeaders,
      timeoutMs: 60000
    });
    return normalizeApiResult(payload || {});
  }

  async extractVehicleFromPDF({ pdfAsset, userId }) {
    const file = ensurePdfAsset(pdfAsset);
    const formData = new FormData();
    formData.append('pdf', file);
    if (userId) {
      formData.append('userId', String(userId));
    }

    Logger.log('📄 [DriverDocumentExtraction] Enviando documento do veículo PDF para extração...');
    const authHeaders = await this.getAuthHeaders(false);
    const payload = await postMultipartJson(`${this.apiBaseUrl}/api/ocr/vehicle/pdf`, formData, {
      headers: authHeaders,
      timeoutMs: 60000
    });
    return normalizeApiResult(payload || {});
  }
}

const driverDocumentExtractionService = new DriverDocumentExtractionService();
export default driverDocumentExtractionService;
