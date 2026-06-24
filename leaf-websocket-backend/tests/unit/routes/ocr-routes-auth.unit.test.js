jest.unmock('express');

const express = require('express');
const request = require('supertest');

const mockExtractCNHFromText = jest.fn();
const mockExtractVehicleFromText = jest.fn();
const mockExtractTextFromPDF = jest.fn();

jest.mock('../../../middleware/firebase-user-auth', () => ({
  requireFirebaseUser: jest.fn((req, res, next) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ success: false, error: 'Token de autenticação ausente.' });
    }
    req.firebaseUser = { uid: token };
    req.authenticatedUser = { uid: token, authSource: 'firebase' };
    return next();
  })
}));

jest.mock('../../../services/ocr-service', () => ({
  initialized: true,
  extractTextFromPDF: (...args) => mockExtractTextFromPDF(...args),
  convertPDFToImage: jest.fn(async () => Buffer.from('image')),
  extractCNHData: jest.fn(),
  extractCRLVData: jest.fn()
}));

jest.mock('../../../services/document-ai-extraction-service', () => ({
  enabled: true,
  extractCNHFromText: (...args) => mockExtractCNHFromText(...args),
  extractCNHFromImageBuffer: jest.fn(),
  extractVehicleFromText: (...args) => mockExtractVehicleFromText(...args),
  extractVehicleFromImageBuffer: jest.fn()
}));

jest.mock('../../../services/cnh-document-identity-validator', () => ({
  validateCnhDocumentIdentity: jest.fn(() => ({ valid: true }))
}));

jest.mock('../../../utils/logger', () => ({
  logger: {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn()
  }
}));

function createApp() {
  const routes = require('../../../routes/ocr-routes');
  const app = express();
  app.use('/ocr', routes);
  return app;
}

describe('OCR routes auth guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExtractTextFromPDF.mockResolvedValue(
      'PLACA ABC1D23 RENAVAM 123456789 CHASSI 9BWZZZ MARCA MODELO COR PRATA'.repeat(8)
    );
    mockExtractCNHFromText.mockResolvedValue({ nome: 'Motorista Leaf' });
    mockExtractVehicleFromText.mockResolvedValue({ plate: 'ABC1D23', color: 'Prata' });
  });

  it('rejects document AI OCR without Firebase auth before paid extraction can run', async () => {
    const response = await request(createApp())
      .post('/ocr/cnh/pdf')
      .attach('pdf', Buffer.from('%PDF-1.4'), {
        filename: 'cnh.pdf',
        contentType: 'application/pdf'
      });

    expect(response.status).toBe(401);
    expect(mockExtractCNHFromText).not.toHaveBeenCalled();
    expect(mockExtractVehicleFromText).not.toHaveBeenCalled();
  });

  it('rejects userId spoofing before CRLV document AI extraction can run', async () => {
    const response = await request(createApp())
      .post('/ocr/vehicle/pdf')
      .set('Authorization', 'Bearer user_1')
      .field('userId', 'user_2')
      .attach('pdf', Buffer.from('%PDF-1.4'), {
        filename: 'crlv.pdf',
        contentType: 'application/pdf'
      });

    expect(response.status).toBe(403);
    expect(mockExtractVehicleFromText).not.toHaveBeenCalled();
  });
});
