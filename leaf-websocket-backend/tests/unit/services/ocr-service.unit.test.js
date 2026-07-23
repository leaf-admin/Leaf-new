function buildPdfWithJpegImages(images) {
  const objects = images.map(
    ({ width, height, data }, index) =>
      `${index + 1} 0 obj\n` +
      `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode ` +
      `/Length ${data.length} >>\n` +
      `stream\n${data}\nendstream\nendobj\n`,
  );

  return Buffer.from(`%PDF-1.4\n${objects.join('')}%%EOF`, 'latin1');
}

describe('ocr-service embedded PDF image selection', () => {
  let ocrService;

  beforeEach(() => {
    jest.resetModules();
    ocrService = require('../../../services/ocr-service');
  });

  it('ignores a portrait thumbnail so the caller renders the complete page', () => {
    const pdf = buildPdfWithJpegImages([
      { width: 113, height: 120, data: 'tiny-portrait-image' },
    ]);

    expect(ocrService.extractLargestEmbeddedImageFromPDF(pdf)).toBeNull();
  });

  it('keeps a document-sized embedded image as the fast path', () => {
    const pdf = buildPdfWithJpegImages([
      { width: 113, height: 120, data: 'tiny-portrait-image' },
      { width: 963, height: 680, data: 'full-document-image'.repeat(80) },
    ]);

    expect(
      ocrService.extractLargestEmbeddedImageFromPDF(pdf).toString('latin1'),
    ).toBe('full-document-image'.repeat(80));
  });
});
