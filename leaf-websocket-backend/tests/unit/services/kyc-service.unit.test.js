/**
 * Unit Tests for KYC Service
 */

const KYCService = require('../../../services/kyc-service');

// Mock do sharp
jest.mock('sharp', () => {
  return jest.fn().mockImplementation(() => ({
    resize: jest.fn().mockReturnThis(),
    jpeg: jest.fn().mockReturnThis(),
    toBuffer: jest.fn().mockResolvedValue(Buffer.from('mock-image')),
    metadata: jest.fn().mockResolvedValue({ width: 100, height: 100 })
  }));
});

// Mock do tesseract.js
jest.mock('tesseract.js', () => ({
  createWorker: jest.fn()
}));

// Mock do ml-matrix
jest.mock('ml-matrix', () => ({
  Matrix: jest.fn().mockImplementation((data) => ({
    data,
    rows: data.length,
    columns: data[0]?.length || 0,
    transpose: jest.fn(),
    mmul: jest.fn(),
    norm: jest.fn(() => 1.0)
  }))
}));

// Mock do firebase-admin
jest.mock('firebase-admin', () => ({
  storage: jest.fn(() => ({
    bucket: jest.fn(() => ({
      file: jest.fn(() => ({
        save: jest.fn().mockResolvedValue([{}]),
        download: jest.fn().mockResolvedValue([Buffer.from('mock-file')]),
        delete: jest.fn().mockResolvedValue({}),
        exists: jest.fn().mockResolvedValue([true])
      }))
    }))
  }))
}));

// Mock do fs
jest.mock('fs', () => ({
  promises: {
    readFile: jest.fn(),
    writeFile: jest.fn(),
    unlink: jest.fn(),
    mkdir: jest.fn()
  }
}));

// Mock do path
jest.mock('path', () => ({
  join: jest.fn((...args) => args.join('/')),
  extname: jest.fn((file) => '.' + file.split('.').pop()),
  basename: jest.fn((file) => file.split('/').pop().split('.')[0])
}));

// Mock do os
jest.mock('os', () => ({
  tmpdir: jest.fn(() => '/tmp')
}));

// Mock do logger
jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn(),
  logError: jest.fn()
}));

const mockTesseract = require('tesseract.js');
const mockSharp = require('sharp');
const mockLogger = require('../../../utils/logger');

describe('KYCService', () => {
  let kycService;
  let mockWorker;

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset singleton
    delete require.cache[require.resolve('../../../services/kyc-service')];

    // Mock worker do Tesseract
    mockWorker = {
      recognize: jest.fn(),
      terminate: jest.fn()
    };
    mockTesseract.createWorker.mockResolvedValue(mockWorker);

    // Criar nova instância
    kycService = new KYCService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Initialization', () => {
    test('should create KYCService instance', () => {
      expect(kycService).toBeDefined();
      expect(kycService.worker).toBeNull();
      expect(kycService.faceApi).toBeNull();
      expect(kycService.initialized).toBe(false);
    });

    test('should initialize Tesseract worker', async () => {
      await kycService.initialize();

      expect(mockTesseract.createWorker).toHaveBeenCalledWith('por');
      expect(kycService.worker).toBe(mockWorker);
      expect(kycService.initialized).toBe(true);
      expect(mockLogger.logStructured).toHaveBeenCalledWith(
        'info',
        'Tesseract OCR inicializado',
        { service: 'kyc-service' }
      );
    });

    test('should not reinitialize if already initialized', async () => {
      kycService.initialized = true;

      await kycService.initialize();

      expect(mockTesseract.createWorker).not.toHaveBeenCalled();
    });

    test('should handle initialization error', async () => {
      const error = new Error('Tesseract init failed');
      mockTesseract.createWorker.mockRejectedValue(error);

      await expect(kycService.initialize()).rejects.toThrow('Tesseract init failed');

      expect(mockLogger.logError).toHaveBeenCalledWith(
        error,
        'Erro ao inicializar KYC Service',
        { service: 'kyc-service' }
      );
    });
  });

  describe('Image Processing', () => {
    beforeEach(async () => {
      await kycService.initialize();
    });

    test('should preprocess image for OCR', async () => {
      const mockImageBuffer = Buffer.from('mock-image-data');

      const result = await kycService.preprocessImageForOCR(mockImageBuffer);

      expect(mockSharp).toHaveBeenCalledWith(mockImageBuffer);
      expect(result).toBeInstanceOf(Buffer);
    });

    test('should handle image preprocessing error', async () => {
      const mockImageBuffer = Buffer.from('mock-image-data');
      mockSharp.mockImplementationOnce(() => {
        throw new Error('Sharp processing failed');
      });

      await expect(kycService.preprocessImageForOCR(mockImageBuffer))
        .rejects.toThrow('Sharp processing failed');
    });

    test('should extract text from image', async () => {
      const mockImageBuffer = Buffer.from('mock-cnh-image');
      const mockOCRResult = {
        data: {
          text: 'REPÚBLICA FEDERATIVA DO BRASIL\nCARTEIRA NACIONAL DE HABILITAÇÃO\nNOME: JOÃO SILVA\nCPF: 123.456.789-00'
        }
      };

      mockWorker.recognize.mockResolvedValue(mockOCRResult);

      const result = await kycService.extractTextFromImage(mockImageBuffer);

      expect(mockWorker.recognize).toHaveBeenCalledWith(mockImageBuffer);
      expect(result).toBe(mockOCRResult.data.text);
    });

    test('should handle OCR error', async () => {
      const mockImageBuffer = Buffer.from('mock-image');
      const error = new Error('OCR failed');

      mockWorker.recognize.mockRejectedValue(error);

      await expect(kycService.extractTextFromImage(mockImageBuffer))
        .rejects.toThrow('OCR failed');
    });
  });

  describe('CNH Data Extraction', () => {
    beforeEach(async () => {
      await kycService.initialize();
    });

    test('should extract CNH data from text', () => {
      const cnhText = `
        REPÚBLICA FEDERATIVA DO BRASIL
        CARTEIRA NACIONAL DE HABILITAÇÃO
        NOME: JOÃO DA SILVA SANTOS
        CPF: 123.456.789-00
        DATA DE NASCIMENTO: 15/08/1985
        RG: 12.345.678-9
        CATEGORIA: AB
        VALIDADE: 15/08/2030
        LOCAL: SÃO PAULO/SP
      `;

      const result = kycService.extractCNHData(cnhText);

      expect(result).toEqual({
        nome: 'JOÃO DA SILVA SANTOS',
        cpf: '123.456.789-00',
        dataNascimento: '15/08/1985',
        rg: '12.345.678-9',
        categoria: 'AB',
        validade: '15/08/2030',
        local: 'SÃO PAULO/SP'
      });
    });

    test('should handle missing data gracefully', () => {
      const cnhText = 'REPÚBLICA FEDERATIVA DO BRASIL';

      const result = kycService.extractCNHData(cnhText);

      expect(result).toEqual({
        nome: '',
        cpf: '',
        dataNascimento: '',
        rg: '',
        categoria: '',
        validade: '',
        local: ''
      });
    });

    test('should validate CNH data', () => {
      const validData = {
        nome: 'JOÃO SILVA',
        cpf: '123.456.789-00',
        dataNascimento: '15/08/1985',
        rg: '12.345.678-9',
        categoria: 'B',
        validade: '15/08/2030'
      };

      const invalidData = {
        nome: '',
        cpf: 'invalid',
        dataNascimento: 'invalid',
        rg: '',
        categoria: 'X',
        validade: '01/01/2000' // Expirada
      };

      expect(kycService.validateCNHData(validData)).toBe(true);
      expect(kycService.validateCNHData(invalidData)).toBe(false);
    });

    test('should check CNH validity', () => {
      const validCNH = { validade: '31/12/2030' }; // Futura
      const expiredCNH = { validade: '01/01/2020' }; // Passada
      const invalidFormat = { validade: 'invalid' };

      expect(kycService.isCNHValid(validCNH)).toBe(true);
      expect(kycService.isCNHValid(expiredCNH)).toBe(false);
      expect(kycService.isCNHValid(invalidFormat)).toBe(false);
    });
  });

  describe('Face Comparison', () => {
    test('should calculate cosine similarity', () => {
      const embedding1 = [1, 2, 3, 4, 5];
      const embedding2 = [1, 2, 3, 4, 5]; // Mesmo vetor

      const similarity = kycService.calculateCosineSimilarity(embedding1, embedding2);

      expect(similarity).toBe(1.0); // Mesmo vetor = similaridade máxima
    });

    test('should calculate similarity for different vectors', () => {
      const embedding1 = [1, 0, 0, 0, 0];
      const embedding2 = [0, 1, 0, 0, 0]; // Vetores perpendiculares

      const similarity = kycService.calculateCosineSimilarity(embedding1, embedding2);

      expect(similarity).toBe(0.0); // Perpendiculares = sem similaridade
    });

    test('should compare faces with embeddings', () => {
      const cnhEmbedding = [1, 2, 3, 4, 5];
      const selfieEmbedding = [1.1, 2.1, 3.1, 4.1, 5.1]; // Ligeiramente diferente

      const result = kycService.compareFaces(cnhEmbedding, selfieEmbedding);

      expect(result).toHaveProperty('similarity');
      expect(result).toHaveProperty('isMatch');
      expect(result).toHaveProperty('confidence');
      expect(result.similarity).toBeGreaterThan(0.95); // Muito similar
      expect(result.isMatch).toBe(true);
    });

    test('should reject dissimilar faces', () => {
      const cnhEmbedding = [1, 0, 0, 0, 0];
      const selfieEmbedding = [0, 1, 0, 0, 0]; // Completamente diferente

      const result = kycService.compareFaces(cnhEmbedding, selfieEmbedding);

      expect(result.similarity).toBe(0.0);
      expect(result.isMatch).toBe(false);
    });
  });

  describe('File Operations', () => {
    test('should save image to temp file', async () => {
      const mockImageBuffer = Buffer.from('mock-image-data');
      const filename = 'test-image.jpg';

      const fs = require('fs').promises;
      fs.writeFile.mockResolvedValue();

      const tempPath = await kycService.saveToTempFile(mockImageBuffer, filename);

      expect(fs.writeFile).toHaveBeenCalled();
      expect(tempPath).toContain('/tmp');
      expect(tempPath).toContain('test-image.jpg');
    });

    test('should clean up temp files', async () => {
      const tempPath = '/tmp/test-file.jpg';

      const fs = require('fs').promises;
      fs.unlink.mockResolvedValue();

      await kycService.cleanupTempFile(tempPath);

      expect(fs.unlink).toHaveBeenCalledWith(tempPath);
    });

    test('should handle cleanup error gracefully', async () => {
      const tempPath = '/tmp/test-file.jpg';

      const fs = require('fs').promises;
      fs.unlink.mockRejectedValue(new Error('File not found'));

      // Should not throw
      await expect(kycService.cleanupTempFile(tempPath)).resolves.not.toThrow();
    });
  });

  describe('KYC Processing', () => {
    beforeEach(async () => {
      await kycService.initialize();
    });

    test('should process KYC successfully', async () => {
      const cnhImage = Buffer.from('cnh-image');
      const selfieImage = Buffer.from('selfie-image');

      // Mock all dependencies
      const mockCNHData = {
        nome: 'JOÃO SILVA',
        cpf: '123.456.789-00',
        validade: '31/12/2030'
      };

      const mockCNHEmbedding = [1, 2, 3, 4, 5];
      const mockSelfieEmbedding = [1.1, 2.1, 3.1, 4.1, 5.1];

      // Mock methods
      kycService.extractCNHData = jest.fn().mockReturnValue(mockCNHData);
      kycService.validateCNHData = jest.fn().mockReturnValue(true);
      kycService.generateFaceEmbedding = jest.fn().mockResolvedValue(mockCNHEmbedding);
      kycService.generateFaceEmbedding = jest.fn()
        .mockResolvedValueOnce(mockCNHEmbedding)
        .mockResolvedValueOnce(mockSelfieEmbedding);
      kycService.compareFaces = jest.fn().mockReturnValue({
        similarity: 0.95,
        isMatch: true,
        confidence: 'high'
      });

      const result = await kycService.processKYC(cnhImage, selfieImage);

      expect(result).toEqual({
        success: true,
        cnhData: mockCNHData,
        faceMatch: {
          similarity: 0.95,
          isMatch: true,
          confidence: 'high'
        },
        confidence: 'high'
      });
    });

    test('should handle KYC processing failure', async () => {
      const cnhImage = Buffer.from('cnh-image');
      const selfieImage = Buffer.from('selfie-image');

      // Mock OCR failure
      mockWorker.recognize.mockRejectedValue(new Error('OCR failed'));

      const result = await kycService.processKYC(cnhImage, selfieImage);

      expect(result.success).toBe(false);
      expect(result.error).toContain('OCR failed');
    });

    test('should reject invalid CNH data', async () => {
      const cnhImage = Buffer.from('cnh-image');
      const selfieImage = Buffer.from('selfie-image');

      // Mock invalid CNH data
      kycService.extractCNHData = jest.fn().mockReturnValue({ nome: '', cpf: '' });
      kycService.validateCNHData = jest.fn().mockReturnValue(false);

      const result = await kycService.processKYC(cnhImage, selfieImage);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Dados da CNH inválidos');
    });

    test('should reject face mismatch', async () => {
      const cnhImage = Buffer.from('cnh-image');
      const selfieImage = Buffer.from('selfie-image');

      // Mock valid CNH data
      const mockCNHData = {
        nome: 'JOÃO SILVA',
        cpf: '123.456.789-00',
        validade: '31/12/2030'
      };

      kycService.extractCNHData = jest.fn().mockReturnValue(mockCNHData);
      kycService.validateCNHData = jest.fn().mockReturnValue(true);

      // Mock face mismatch
      kycService.compareFaces = jest.fn().mockReturnValue({
        similarity: 0.3,
        isMatch: false,
        confidence: 'low'
      });

      const result = await kycService.processKYC(cnhImage, selfieImage);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Rosto da selfie não corresponde');
    });
  });

  describe('Service Lifecycle', () => {
    test('should cleanup resources', async () => {
      await kycService.initialize();

      await kycService.cleanup();

      expect(mockWorker.terminate).toHaveBeenCalled();
      expect(kycService.initialized).toBe(false);
    });

    test('should handle cleanup without worker', async () => {
      await kycService.cleanup();

      expect(kycService.initialized).toBe(false);
    });

    test('should get service status', () => {
      kycService.initialized = true;

      const status = kycService.getStatus();

      expect(status).toEqual({
        initialized: true,
        ocrAvailable: true,
        faceComparisonAvailable: false // Sem insightface
      });
    });
  });
});

