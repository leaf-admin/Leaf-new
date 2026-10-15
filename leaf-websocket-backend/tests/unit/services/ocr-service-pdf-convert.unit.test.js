const fs = require('fs');
const path = require('path');

jest.mock('child_process', () => ({
  execFile: jest.fn(),
  execSync: jest.fn(() => {
    throw new Error('execSync must not be used: it blocks the gateway event loop');
  })
}));

jest.mock('pdf-poppler', () => ({
  convert: jest.fn().mockRejectedValue(new Error('pdf-poppler unavailable'))
}), { virtual: true });

describe('ocr-service PDF to image conversion', () => {
  let ocrService;
  let childProcess;

  beforeEach(() => {
    jest.resetModules();
    childProcess = require('child_process');
    ocrService = require('../../../services/ocr-service');
    jest.spyOn(ocrService, 'extractLargestEmbeddedImageFromPDF').mockReturnValue(null);
  });

  it('renders the page with an async pdftoppm call and cleans temp files', async () => {
    let outputPrefix;
    childProcess.execFile.mockImplementation((command, args, options, callback) => {
      outputPrefix = args[args.length - 1];
      fs.writeFileSync(`${outputPrefix}-1.png`, 'rendered-page');
      callback(null, '', '');
    });

    const image = await ocrService.convertPDFToImage(Buffer.from('%PDF-1.4'));

    expect(image.toString()).toBe('rendered-page');
    expect(childProcess.execFile).toHaveBeenCalledWith(
      'pdftoppm',
      expect.arrayContaining(['-png', '-r', '600']),
      expect.objectContaining({ timeout: 30000 }),
      expect.any(Function)
    );
    expect(childProcess.execSync).not.toHaveBeenCalled();
    expect(fs.existsSync(`${outputPrefix}-1.png`)).toBe(false);
    expect(fs.existsSync(`${outputPrefix}.pdf`)).toBe(false);
  });

  it('fails without leaving temp files when no converter works', async () => {
    let outputPrefix;
    childProcess.execFile.mockImplementation((command, args, options, callback) => {
      outputPrefix = args[args.length - 1];
      callback(new Error('pdftoppm missing'));
    });

    await expect(ocrService.convertPDFToImage(Buffer.from('%PDF-1.4'))).rejects.toThrow(
      'Falha ao converter PDF'
    );
    expect(fs.existsSync(`${outputPrefix}.pdf`)).toBe(false);
    expect(path.isAbsolute(outputPrefix)).toBe(true);
  });
});
