const crypto = require('crypto');
const sharp = require('sharp');

const CnhFaceBiometricService = require('../../../services/cnh-face-biometric-service');

describe('CnhFaceBiometricService canonical portrait extraction', () => {
  let pageImage;

  beforeAll(async () => {
    pageImage = await sharp({
      create: {
        width: 1000,
        height: 1000,
        channels: 3,
        background: { r: 40, g: 120, b: 80 }
      }
    }).jpeg().toBuffer();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('extracts only the configured portrait crop from a PDF page', async () => {
    const pdfPageConverter = jest.fn().mockResolvedValue(pageImage);
    const service = new CnhFaceBiometricService({
      client: { isConfigured: () => false },
      pdfPageConverter
    });

    const result = await service.extractCnhPortraitImage(
      Buffer.from('%PDF-1.4\nleaf-cnh-fixture'),
      { allowFullPageFallback: false }
    );
    const metadata = await sharp(result.imageBuffer).metadata();

    expect(pdfPageConverter).toHaveBeenCalledTimes(1);
    expect(result.source).toBe('approved_cnh_pdf_crop_v1');
    expect(result.cropVersion).toBe('cnh_digital_photo_crop_v1');
    expect(metadata.width).toBeGreaterThan(100);
    expect(metadata.width).toBeLessThan(300);
    expect(metadata.height).toBeGreaterThan(300);
    expect(metadata.height).toBeLessThan(500);
    expect(result.imageSha256).toBe(
      crypto.createHash('sha256').update(result.imageBuffer).digest('hex')
    );
  });

  test('fails closed when the canonical crop cannot be extracted', async () => {
    const pdfPageConverter = jest.fn().mockResolvedValue(Buffer.from('not-an-image'));
    const service = new CnhFaceBiometricService({
      client: { isConfigured: () => false },
      pdfPageConverter
    });

    await expect(service.extractCnhPortraitImage(
      Buffer.from('%PDF-1.4\ninvalid-image'),
      { allowFullPageFallback: false }
    )).rejects.toMatchObject({
      code: 'KYC_CNH_PORTRAIT_EXTRACTION_FAILED'
    });
  });
});
