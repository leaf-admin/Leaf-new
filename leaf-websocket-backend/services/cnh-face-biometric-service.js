const sharp = require('sharp');
const ocrService = require('./ocr-service');
const BiometricFaceClient = require('./biometric-face-client');
const { logStructured, logError } = require('../utils/logger');

const DEFAULT_CNH_PHOTO_CROP = Object.freeze({
  left: Number(process.env.CNH_DIGITAL_PHOTO_CROP_LEFT || 0.200044),
  top: Number(process.env.CNH_DIGITAL_PHOTO_CROP_TOP || 0.404421),
  width: Number(process.env.CNH_DIGITAL_PHOTO_CROP_WIDTH || 0.219841),
  height: Number(process.env.CNH_DIGITAL_PHOTO_CROP_HEIGHT || 0.396786)
});

function clampRatio(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(1, numeric));
}

function normalizeCrop(crop = DEFAULT_CNH_PHOTO_CROP) {
  const left = clampRatio(crop.left, DEFAULT_CNH_PHOTO_CROP.left);
  const top = clampRatio(crop.top, DEFAULT_CNH_PHOTO_CROP.top);
  const width = clampRatio(crop.width, DEFAULT_CNH_PHOTO_CROP.width);
  const height = clampRatio(crop.height, DEFAULT_CNH_PHOTO_CROP.height);
  return {
    left,
    top,
    width: Math.min(width, 1 - left),
    height: Math.min(height, 1 - top)
  };
}

function isPdfBuffer(buffer) {
  return Buffer.isBuffer(buffer) && buffer.slice(0, 4).toString('utf8') === '%PDF';
}

class CnhFaceBiometricService {
  constructor(options = {}) {
    this.client = options.client || new BiometricFaceClient(options.clientOptions || {});
    this.crop = normalizeCrop(options.crop);
  }

  isConfigured() {
    return typeof this.client.isConfigured === 'function' && this.client.isConfigured();
  }

  async generateCnhFaceEmbeddingFromPdf(pdfBuffer, options = {}) {
    if (!Buffer.isBuffer(pdfBuffer) || pdfBuffer.length === 0) {
      throw new Error('pdfBuffer deve ser um Buffer nao vazio');
    }

    const startedAt = Date.now();
    const pageImageBuffer = isPdfBuffer(pdfBuffer)
      ? await ocrService.convertPDFToImage(pdfBuffer)
      : pdfBuffer;

    try {
      const cnhPhotoBuffer = await this.#cropCnhPhoto(pageImageBuffer, options.crop || this.crop);
      const embedding = await this.client.generateEmbedding(cnhPhotoBuffer, {
        filename: options.filename || 'cnh-face.jpg',
        contentType: 'image/jpeg'
      });

      logStructured('info', 'Embedding da foto da CNH Digital gerado', {
        service: 'cnh-face-biometric-service',
        durationMs: Date.now() - startedAt,
        source: 'cnh_pdf_crop',
        detScore: embedding?.selected_face?.detection_score || null
      });

      return {
        ...embedding,
        source: 'cnh_pdf_crop',
        crop: normalizeCrop(options.crop || this.crop)
      };
    } catch (cropError) {
      if (options.disableFullPageFallback === true) {
        throw cropError;
      }

      logStructured('warn', 'Crop da foto da CNH falhou; tentando pagina inteira', {
        service: 'cnh-face-biometric-service',
        error: cropError.message
      });

      const fallbackEmbedding = await this.client.generateEmbedding(pageImageBuffer, {
        filename: options.filename || 'cnh-page.jpg',
        contentType: 'image/jpeg'
      });

      return {
        ...fallbackEmbedding,
        source: 'cnh_pdf_full_page_fallback',
        crop: null
      };
    }
  }

  async compareCnhAndSelfieEmbeddings(cnhEmbedding, selfieEmbedding, options = {}) {
    return this.client.compareEmbeddings(cnhEmbedding, selfieEmbedding, {
      approveThreshold: options.approveThreshold,
      reviewThreshold: options.reviewThreshold
    });
  }

  async #cropCnhPhoto(pageImageBuffer, cropConfig) {
    const image = sharp(pageImageBuffer);
    const metadata = await image.metadata();
    const width = Number(metadata.width || 0);
    const height = Number(metadata.height || 0);

    if (!width || !height) {
      throw new Error('Nao foi possivel ler dimensoes da pagina da CNH');
    }

    const crop = normalizeCrop(cropConfig);
    const left = Math.floor(width * crop.left);
    const top = Math.floor(height * crop.top);
    const cropWidth = Math.max(1, Math.floor(width * crop.width));
    const cropHeight = Math.max(1, Math.floor(height * crop.height));

    try {
      return await image
        .extract({
          left,
          top,
          width: Math.min(cropWidth, width - left),
          height: Math.min(cropHeight, height - top)
        })
        .jpeg({ quality: 95 })
        .toBuffer();
    } catch (error) {
      logError(error, 'Falha ao recortar foto da CNH Digital', {
        service: 'cnh-face-biometric-service',
        pageWidth: width,
        pageHeight: height,
        crop
      });
      throw error;
    }
  }
}

module.exports = CnhFaceBiometricService;
