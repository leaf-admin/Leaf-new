const crypto = require('crypto');
const sharp = require('sharp');

const CnhFaceBiometricService = require('../../../services/cnh-face-biometric-service');

async function createSyntheticPage(width, height, background) {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background
    }
  }).jpeg().toBuffer();
}

describe('CnhFaceBiometricService canonical portrait extraction', () => {
  let legacyFrontImage;
  let a4PortraitImage;
  let unsupportedSquareImage;
  let embeddedThumbnailImage;

  beforeAll(async () => {
    [
      legacyFrontImage,
      a4PortraitImage,
      unsupportedSquareImage,
      embeddedThumbnailImage
    ] = await Promise.all([
      createSyntheticPage(1400, 1000, { r: 40, g: 120, b: 80 }),
      createSyntheticPage(1000, 1414, { r: 220, g: 225, b: 230 }),
      createSyntheticPage(1000, 1000, { r: 120, g: 120, b: 120 }),
      createSyntheticPage(113, 120, { r: 20, g: 20, b: 20 })
    ]);
  });

  test('preserves the configurable legacy crop for a supported front layout', async () => {
    const pdfPageConverter = jest.fn().mockResolvedValue(legacyFrontImage);
    const customCrop = { left: 0.15, top: 0.2, width: 0.25, height: 0.3 };
    const service = new CnhFaceBiometricService({
      client: { isConfigured: () => false },
      crop: customCrop,
      pdfPageConverter
    });

    const result = await service.extractCnhPortraitImage(
      Buffer.from('%PDF-1.4\nsynthetic-legacy-front'),
      { allowFullPageFallback: false }
    );
    const metadata = await sharp(result.imageBuffer).metadata();

    expect(pdfPageConverter).toHaveBeenCalledTimes(1);
    expect(result.source).toBe('approved_cnh_pdf_crop_v1');
    expect(result.crop).toEqual(customCrop);
    expect(result.cropVersion).toBe('cnh_digital_photo_crop_v1');
    expect(metadata.width).toBe(350);
    expect(metadata.height).toBe(300);
    expect(result.imageSha256).toBe(
      crypto.createHash('sha256').update(result.imageBuffer).digest('hex')
    );
  });

  test('selects the dedicated A4 portrait crop instead of the legacy lower-page crop', async () => {
    const pdfPageConverter = jest.fn().mockResolvedValue(a4PortraitImage);
    const service = new CnhFaceBiometricService({
      client: { isConfigured: () => false },
      pdfPageConverter
    });

    const result = await service.extractCnhPortraitImage(
      Buffer.from('%PDF-1.4\nsynthetic-a4-page'),
      { allowFullPageFallback: false }
    );
    const metadata = await sharp(result.imageBuffer).metadata();

    expect(result.source).toBe('approved_cnh_pdf_crop_v1');
    expect(result.crop).toEqual({ left: 0.115, top: 0.142, width: 0.12, height: 0.12 });
    expect(result.cropVersion).toBe('cnh_digital_a4_photo_crop_v1');
    expect(metadata.width).toBe(120);
    expect(metadata.height).toBe(169);
  });

  test('fails closed for an unsupported PDF aspect ratio even when fallback is requested', async () => {
    const service = new CnhFaceBiometricService({
      client: { isConfigured: () => false },
      pdfPageConverter: jest.fn().mockResolvedValue(unsupportedSquareImage)
    });

    await expect(service.extractCnhPortraitImage(
      Buffer.from('%PDF-1.4\nsynthetic-unsupported-layout'),
      { allowFullPageFallback: true }
    )).rejects.toMatchObject({
      code: 'KYC_CNH_PORTRAIT_LAYOUT_UNSUPPORTED'
    });
  });

  test('never accepts a small embedded thumbnail as the canonical portrait page', async () => {
    const service = new CnhFaceBiometricService({
      client: { isConfigured: () => false },
      pdfPageConverter: jest.fn().mockResolvedValue(embeddedThumbnailImage)
    });

    await expect(service.extractCnhPortraitImage(
      Buffer.from('%PDF-1.4\nsynthetic-thumbnail'),
      { allowFullPageFallback: false }
    )).rejects.toMatchObject({
      code: 'KYC_CNH_PORTRAIT_LAYOUT_UNSUPPORTED'
    });
  });

  test('fails closed when the canonical page image cannot be decoded', async () => {
    const service = new CnhFaceBiometricService({
      client: { isConfigured: () => false },
      pdfPageConverter: jest.fn().mockResolvedValue(Buffer.from('not-an-image'))
    });

    await expect(service.extractCnhPortraitImage(
      Buffer.from('%PDF-1.4\nsynthetic-invalid-image'),
      { allowFullPageFallback: false }
    )).rejects.toMatchObject({
      code: 'KYC_CNH_PORTRAIT_EXTRACTION_FAILED'
    });
  });
});
