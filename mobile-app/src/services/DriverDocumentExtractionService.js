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
    const apiBaseUrl = getSelfHostedApiUrl('');
    this.api = createAxiosInstance({
      baseURL: apiBaseUrl,
      timeout: 60000
    });
  }

  async extractCNHFromPDF({ pdfAsset, userId }) {
    const file = ensurePdfAsset(pdfAsset);
    const formData = new FormData();
    formData.append('pdf', file);
    if (userId) {
      formData.append('userId', String(userId));
    }

    Logger.log('📄 [DriverDocumentExtraction] Enviando CNH PDF para extração...');
    const response = await this.api.post('/api/ocr/cnh/pdf', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
        Accept: 'application/json'
      }
    });
    return normalizeApiResult(response?.data || {});
  }

  async extractVehicleFromPDF({ pdfAsset, userId }) {
    const file = ensurePdfAsset(pdfAsset);
    const formData = new FormData();
    formData.append('pdf', file);
    if (userId) {
      formData.append('userId', String(userId));
    }

    Logger.log('📄 [DriverDocumentExtraction] Enviando documento do veículo PDF para extração...');
    const response = await this.api.post('/api/ocr/vehicle/pdf', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
        Accept: 'application/json'
      }
    });
    return normalizeApiResult(response?.data || {});
  }
}

const driverDocumentExtractionService = new DriverDocumentExtractionService();
export default driverDocumentExtractionService;
