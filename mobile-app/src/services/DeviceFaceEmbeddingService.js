import { NativeModules, Platform } from 'react-native';
import Logger from '../utils/Logger';

const nativeModule = NativeModules.LeafFaceEmbedding || null;

const DEFAULT_MODE = 'mobile_arcface_w600k_r50_v1';
const DEFAULT_FORMAT = 'float32-l2-normalized-512';
const DEFAULT_DIMENSION = 512;

function normalizeEmbedding(rawEmbedding) {
  if (!Array.isArray(rawEmbedding)) {
    throw new Error('Embedding facial nativo retornou formato inválido.');
  }

  if (rawEmbedding.length !== DEFAULT_DIMENSION) {
    throw new Error(`Embedding facial nativo deve ter ${DEFAULT_DIMENSION} dimensões.`);
  }

  return rawEmbedding.map((item, index) => {
    const numeric = Number(item);
    if (!Number.isFinite(numeric)) {
      throw new Error(`Embedding facial nativo inválido no índice ${index}.`);
    }
    return numeric;
  });
}

class DeviceFaceEmbeddingService {
  constructor() {
    this.statusCache = null;
  }

  isAvailable() {
    return Boolean(
      nativeModule
      && typeof nativeModule.generateEmbedding === 'function'
      && typeof nativeModule.getStatus === 'function'
      && (Platform.OS === 'ios' || Platform.OS === 'android')
    );
  }

  async getStatus({ forceRefresh = false } = {}) {
    if (!this.isAvailable()) {
      return {
        available: false,
        modelBundled: false,
        runtimeConfigured: false,
        platform: Platform.OS,
        reason: 'native_module_unavailable',
      };
    }

    if (this.statusCache && !forceRefresh) {
      return this.statusCache;
    }

    try {
      this.statusCache = await nativeModule.getStatus();
      return this.statusCache;
    } catch (error) {
      Logger.warn('⚠️ [DeviceFaceEmbedding] Falha ao consultar status nativo:', error);
      this.statusCache = {
        available: false,
        modelBundled: false,
        runtimeConfigured: false,
        platform: Platform.OS,
        reason: error?.code || error?.message || 'status_error',
      };
      return this.statusCache;
    }
  }

  async generateEmbeddingPayload(imageUri, options = {}) {
    const status = await this.getStatus();
    if (!status?.available) {
      return null;
    }

    if (!imageUri || typeof imageUri !== 'string') {
      throw new Error('URI da selfie é obrigatória para gerar embedding facial.');
    }

    const startedAt = Date.now();
    const result = await nativeModule.generateEmbedding({
      imageUri,
      mode: options.mode || status.mode || DEFAULT_MODE,
      embeddingFormat: options.embeddingFormat || status.embeddingFormat || DEFAULT_FORMAT,
      normalize: true,
    });

    const embedding = normalizeEmbedding(result?.embedding);
    const mode = String(result?.mode || options.mode || DEFAULT_MODE);
    const embeddingFormat = String(result?.embeddingFormat || options.embeddingFormat || DEFAULT_FORMAT);

    Logger.log('✅ [DeviceFaceEmbedding] Embedding facial gerado no dispositivo', {
      mode,
      dimension: embedding.length,
      durationMs: Date.now() - startedAt,
    });

    return {
      mode,
      provider: 'mobile_face_embedding',
      embedding,
      embeddingFormat,
      embeddingModel: result?.embeddingModel || 'arcface-w600k-r50',
      modelVersion: result?.modelVersion || mode,
      processingTime: Number(result?.processingTime || Date.now() - startedAt),
    };
  }
}

export const deviceFaceEmbeddingService = new DeviceFaceEmbeddingService();

export default deviceFaceEmbeddingService;
