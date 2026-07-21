const sharp = require('sharp');
const crypto = require('crypto');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const ocrService = require('./ocr-service');
const BiometricFaceClient = require('./biometric-face-client');
const { logStructured, logError } = require('../utils/logger');

const DEFAULT_CNH_PHOTO_CROP = Object.freeze({
  left: Number(process.env.CNH_DIGITAL_PHOTO_CROP_LEFT || 0.200044),
  top: Number(process.env.CNH_DIGITAL_PHOTO_CROP_TOP || 0.404421),
  width: Number(process.env.CNH_DIGITAL_PHOTO_CROP_WIDTH || 0.219841),
  height: Number(process.env.CNH_DIGITAL_PHOTO_CROP_HEIGHT || 0.396786)
});
const CNH_PORTRAIT_CROP_VERSION = 'cnh_digital_photo_crop_v1';
const execFileAsync = promisify(execFile);

async function convertPdfFirstPageToImage(pdfBuffer) {
  const embeddedImage = typeof ocrService.extractLargestEmbeddedImageFromPDF === 'function'
    ? ocrService.extractLargestEmbeddedImageFromPDF(pdfBuffer)
    : null;
  if (embeddedImage) return embeddedImage;

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'leaf-cnh-'));
  const pdfPath = path.join(tempDir, 'document.pdf');
  const outputPrefix = path.join(tempDir, 'page');
  const outputPath = `${outputPrefix}.jpg`;
  try {
    await fs.writeFile(pdfPath, pdfBuffer, { mode: 0o600 });
    await execFileAsync('pdftoppm', [
      '-jpeg',
      '-r', '300',
      '-f', '1',
      '-l', '1',
      '-singlefile',
      pdfPath,
      outputPrefix
    ], {
      timeout: 30000,
      maxBuffer: 1024 * 1024
    });
    return await fs.readFile(outputPath);
  } catch (cause) {
    const error = new Error('Falha ao converter a primeira pagina da CNH PDF');
    error.code = 'KYC_CNH_PDF_CONVERSION_FAILED';
    error.cause = cause;
    throw error;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => null);
  }
}

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
    this.pdfPageConverter = options.pdfPageConverter || convertPdfFirstPageToImage;
  }

  isConfigured() {
    return typeof this.client.isConfigured === 'function' && this.client.isConfigured();
  }

  /**
   * Extrai somente o retrato da CNH para comparacao facial server-side.
   * O caminho canonico deve manter allowFullPageFallback=false para nunca
   * enviar a pagina/documento inteiro ao provedor biometrico.
   */
  async extractCnhPortraitImage(documentBuffer, options = {}) {
    if (!Buffer.isBuffer(documentBuffer) || documentBuffer.length === 0) {
      const error = new Error('documentBuffer deve ser um Buffer nao vazio');
      error.code = 'KYC_CNH_DOCUMENT_BUFFER_REQUIRED';
      throw error;
    }

    const documentIsPdf = isPdfBuffer(documentBuffer);
    const pageImageBuffer = documentIsPdf
      ? await this.pdfPageConverter(documentBuffer)
      : documentBuffer;
    const crop = normalizeCrop(options.crop || this.crop);

    try {
      const imageBuffer = await this.#cropCnhPhoto(pageImageBuffer, crop);
      return {
        imageBuffer,
        source: documentIsPdf ? 'approved_cnh_pdf_crop_v1' : 'approved_cnh_image_crop_v1',
        crop,
        cropVersion: CNH_PORTRAIT_CROP_VERSION,
        imageSha256: crypto.createHash('sha256').update(imageBuffer).digest('hex')
      };
    } catch (cropError) {
      if (options.allowFullPageFallback !== true) {
        cropError.code = cropError.code || 'KYC_CNH_PORTRAIT_EXTRACTION_FAILED';
        throw cropError;
      }

      const imageBuffer = await sharp(pageImageBuffer)
        .jpeg({ quality: 95 })
        .toBuffer();
      return {
        imageBuffer,
        source: 'cnh_pdf_full_page_fallback',
        crop: null,
        cropVersion: null,
        imageSha256: crypto.createHash('sha256').update(imageBuffer).digest('hex')
      };
    }
  }

  async generateCnhFaceEmbeddingFromPdf(pdfBuffer, options = {}) {
    if (!Buffer.isBuffer(pdfBuffer) || pdfBuffer.length === 0) {
      throw new Error('pdfBuffer deve ser um Buffer nao vazio');
    }

    const startedAt = Date.now();
    try {
      const portrait = await this.extractCnhPortraitImage(pdfBuffer, {
        crop: options.crop || this.crop,
        allowFullPageFallback: options.disableFullPageFallback !== true
      });
      const embedding = await this.client.generateEmbedding(portrait.imageBuffer, {
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
        source: portrait.source === 'cnh_pdf_full_page_fallback'
          ? portrait.source
          : 'cnh_pdf_crop',
        crop: portrait.crop
      };
    } catch (error) {
      logError(error, 'Falha ao extrair ou processar foto da CNH Digital', {
        service: 'cnh-face-biometric-service',
        fullPageFallbackAllowed: options.disableFullPageFallback !== true
      });
      throw error;
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
