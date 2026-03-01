const express = require('express');
const multer = require('multer');
const cv = require('opencv4nodejs');
const faceapi = require('face-api.js');
const { Canvas, Image, ImageData } = require('canvas');
const redis = require('redis');
const path = require('path');
const cluster = require('cluster');
const os = require('os');

// Configurar face-api.js para Node.js
faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

class KYCMicroservice {
  constructor() {
    this.app = express();
    this.redisClient = redis.createClient({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      db: process.env.REDIS_DB || 0,
      password: process.env.REDIS_PASSWORD || null
    });
    
    this.modelsLoaded = false;
    this.similarityThreshold = 0.85;
    this.faceDetectionOptions = new faceapi.SsdMobilenetv1Options({ 
      minConfidence: 0.7 
    });
    
    this.initializeApp();
  }

  async initializeApp() {
    try {
      // Middleware
      this.app.use(express.json());
      this.app.use(express.urlencoded({ extended: true }));
      
      // CORS
      this.app.use((req, res, next) => {
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
        if (req.method === 'OPTIONS') {
          res.sendStatus(200);
        } else {
          next();
        }
      });

      // Configurar multer
      this.upload = multer({
        storage: multer.memoryStorage(),
        limits: {
          fileSize: 5 * 1024 * 1024, // 5MB
          files: 1
        },
        fileFilter: (req, file, cb) => {
          if (file.mimetype.startsWith('image/')) {
            cb(null, true);
          } else {
            cb(new Error('Arquivo deve ser uma imagem'), false);
          }
        }
      });

      // Carregar modelos
      await this.loadModels();
      
      // Conectar Redis
      await this.redisClient.connect();
      
      // Configurar rotas
      this.setupRoutes();
      
      // Middleware de erro
      this.app.use(this.errorHandler);
      
      console.log('✅ KYC Microservice inicializado');
      
    } catch (error) {
      console.error('❌ Erro ao inicializar KYC Microservice:', error);
      process.exit(1);
    }
  }

  async loadModels() {
    try {
      const modelsPath = path.join(__dirname, 'models');
      
      // Verificar se modelos existem
      const fs = require('fs');
      if (!fs.existsSync(modelsPath)) {
        console.log('📥 Baixando modelos do face-api.js...');
        await this.downloadModels(modelsPath);
      }
      
      // Carregar modelos
      await faceapi.nets.ssdMobilenetv1.loadFromDisk(modelsPath);
      await faceapi.nets.faceLandmark68Net.loadFromDisk(modelsPath);
      await faceapi.nets.faceRecognitionNet.loadFromDisk(modelsPath);
      
      this.modelsLoaded = true;
      console.log('✅ Modelos de reconhecimento facial carregados');
      
    } catch (error) {
      console.error('❌ Erro ao carregar modelos:', error);
      throw error;
    }
  }

  async downloadModels(modelsPath) {
    // Implementar download dos modelos
    // Por enquanto, criar diretório vazio
    const fs = require('fs');
    fs.mkdirSync(modelsPath, { recursive: true });
    console.log('⚠️ Modelos não encontrados. Execute o script de download.');
  }

  setupRoutes() {
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        timestamp: Date.now(),
        modelsLoaded: this.modelsLoaded,
        workers: process.env.WORKER_COUNT || 1
      });
    });

    // Estatísticas
    this.app.get('/stats', async (req, res) => {
      try {
        const encodingKeys = await this.redisClient.keys('face_encoding:*');
        const metadataKeys = await this.redisClient.keys('face_metadata:*');
        
        res.json({
          service: 'KYC Microservice',
          version: '1.0.0',
          timestamp: Date.now(),
          stats: {
            totalEncodings: encodingKeys.length,
            totalMetadata: metadataKeys.length,
            modelsLoaded: this.modelsLoaded,
            similarityThreshold: this.similarityThreshold,
            memoryUsage: process.memoryUsage(),
            uptime: process.uptime()
          }
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error.message
        });
      }
    });

    // Upload de imagem de perfil
    this.app.post('/upload-profile', this.upload.single('image'), async (req, res) => {
      try {
        const { userId } = req.body;
        
        if (!userId) {
          return res.status(400).json({
            success: false,
            error: 'userId é obrigatório'
          });
        }

        if (!req.file) {
          return res.status(400).json({
            success: false,
            error: 'Imagem é obrigatória'
          });
        }

        const result = await this.preprocessProfileImage(userId, req.file.buffer);
        
        if (result.success) {
          res.json({
            success: true,
            userId: userId,
            message: 'Imagem de perfil processada com sucesso',
            encodingSaved: true,
            confidence: result.confidence
          });
        } else {
          res.status(400).json(result);
        }

      } catch (error) {
        console.error('Erro no upload de perfil:', error);
        res.status(500).json({
          success: false,
          error: 'Erro interno do servidor',
          details: error.message
        });
      }
    });

    // Verificação facial
    this.app.post('/verify-driver', this.upload.single('currentImage'), async (req, res) => {
      try {
        const { userId } = req.body;
        
        if (!userId) {
          return res.status(400).json({
            success: false,
            error: 'userId é obrigatório'
          });
        }

        if (!req.file) {
          return res.status(400).json({
            success: false,
            error: 'Imagem atual é obrigatória'
          });
        }

        const result = await this.verifyDriver(userId, req.file.buffer);
        
        if (result.success) {
          res.json({
            success: true,
            userId: userId,
            isMatch: result.isMatch,
            similarityScore: result.similarityScore,
            confidence: result.confidence,
            threshold: result.threshold,
            processingTime: result.processingTime
          });
        } else {
          res.status(400).json(result);
        }

      } catch (error) {
        console.error('Erro na verificação:', error);
        res.status(500).json({
          success: false,
          error: 'Erro interno do servidor',
          details: error.message
        });
      }
    });

    // Obter encoding facial
    this.app.get('/encoding/:userId', async (req, res) => {
      try {
        const { userId } = req.params;
        
        if (!this.isValidUUID(userId)) {
          return res.status(400).json({
            success: false,
            error: 'userId deve ser um UUID válido'
          });
        }

        const encoding = await this.getFaceEncoding(userId);
        
        if (encoding) {
          res.json({
            success: true,
            userId: userId,
            encoding: {
              features: encoding.features,
              metadata: encoding.metadata
            }
          });
        } else {
          res.status(404).json({
            success: false,
            error: 'Encoding não encontrado'
          });
        }

      } catch (error) {
        console.error('Erro ao obter encoding:', error);
        res.status(500).json({
          success: false,
          error: 'Erro interno do servidor',
          details: error.message
        });
      }
    });

    // Deletar encoding facial
    this.app.delete('/encoding/:userId', async (req, res) => {
      try {
        const { userId } = req.params;
        
        if (!this.isValidUUID(userId)) {
          return res.status(400).json({
            success: false,
            error: 'userId deve ser um UUID válido'
          });
        }

        const success = await this.deleteFaceEncoding(userId);
        
        if (success) {
          res.json({
            success: true,
            userId: userId,
            message: 'Encoding removido com sucesso'
          });
        } else {
          res.status(500).json({
            success: false,
            error: 'Erro ao remover encoding'
          });
        }

      } catch (error) {
        console.error('Erro ao deletar encoding:', error);
        res.status(500).json({
          success: false,
          error: 'Erro interno do servidor',
          details: error.message
        });
      }
    });
  }

  async preprocessProfileImage(userId, imageBuffer) {
    try {
      if (!this.modelsLoaded) {
        throw new Error('Modelos não carregados');
      }

      if (!this.isValidUUID(userId)) {
        throw new Error('userId deve ser um UUID válido');
      }

      // Converter buffer para imagem
      const image = new Image();
      image.src = imageBuffer;

      // Detectar faces
      const detections = await faceapi.detectAllFaces(image)
        .withFaceLandmarks()
        .withFaceDescriptors();

      if (detections.length === 0) {
        throw new Error('Nenhuma face detectada na imagem');
      }

      const face = detections[0];
      const faceDescriptor = face.descriptor;
      const landmarks = face.landmarks;
      
      const features = this.extractFacialFeatures(landmarks);
      
      const encoding = {
        descriptor: Array.from(faceDescriptor),
        features: features,
        metadata: {
          userId: userId,
          processedAt: Date.now(),
          confidence: face.detection.score,
          landmarks: landmarks.positions.map(p => ({ x: p.x, y: p.y }))
        }
      };

      // Salvar no Redis
      const redisKey = `face_encoding:${userId}`;
      await this.redisClient.setEx(redisKey, 86400, JSON.stringify(encoding));

      const metadataKey = `face_metadata:${userId}`;
      const metadata = {
        userId: userId,
        processedAt: Date.now(),
        encodingCount: encoding.descriptor.length,
        featuresCount: Object.keys(features).length
      };
      
      await this.redisClient.setEx(metadataKey, 86400, JSON.stringify(metadata));

      return {
        success: true,
        userId: userId,
        encodingSaved: true,
        features: features,
        confidence: face.detection.score
      };

    } catch (error) {
      console.error('Erro ao processar imagem de perfil:', error);
      return {
        success: false,
        error: error.message,
        userId: userId
      };
    }
  }

  async verifyDriver(userId, currentImageBuffer) {
    try {
      if (!this.modelsLoaded) {
        throw new Error('Modelos não carregados');
      }

      if (!this.isValidUUID(userId)) {
        throw new Error('userId deve ser um UUID válido');
      }

      // Buscar encoding armazenado
      const redisKey = `face_encoding:${userId}`;
      const storedEncodingData = await this.redisClient.get(redisKey);
      
      if (!storedEncodingData) {
        throw new Error('Encoding facial não encontrado. Faça upload da imagem de perfil primeiro.');
      }

      const storedEncoding = JSON.parse(storedEncodingData);

      // Processar imagem atual
      const image = new Image();
      image.src = currentImageBuffer;

      const detections = await faceapi.detectAllFaces(image)
        .withFaceLandmarks()
        .withFaceDescriptors();

      if (detections.length === 0) {
        throw new Error('Nenhuma face detectada na imagem atual');
      }

      const currentFace = detections[0];
      const currentDescriptor = currentFace.descriptor;
      const currentLandmarks = currentFace.landmarks;

      // Calcular similaridade
      const similarity = this.calculateSimilarity(
        storedEncoding.descriptor,
        Array.from(currentDescriptor)
      );

      const currentFeatures = this.extractFacialFeatures(currentLandmarks);
      const featureSimilarity = this.calculateFeatureSimilarity(
        storedEncoding.features,
        currentFeatures
      );

      const combinedSimilarity = (similarity * 0.7) + (featureSimilarity * 0.3);
      const isMatch = combinedSimilarity >= this.similarityThreshold;

      return {
        success: true,
        userId: userId,
        isMatch: isMatch,
        similarityScore: combinedSimilarity,
        threshold: this.similarityThreshold,
        confidence: this.getConfidenceLevel(combinedSimilarity),
        processingTime: Date.now()
      };

    } catch (error) {
      console.error('Erro na verificação:', error);
      return {
        success: false,
        error: error.message,
        userId: userId
      };
    }
  }

  extractFacialFeatures(landmarks) {
    const positions = landmarks.positions;
    
    return {
      eyeDistance: this.calculateDistance(positions[36], positions[45]),
      noseWidth: this.calculateDistance(positions[31], positions[35]),
      mouthWidth: this.calculateDistance(positions[48], positions[54]),
      faceWidth: this.calculateDistance(positions[0], positions[16]),
      faceHeight: this.calculateDistance(positions[8], positions[27]),
      jawAngle: this.calculateAngle(positions[8], positions[0], positions[16]),
      eyebrowAngle: this.calculateAngle(positions[17], positions[21], positions[22])
    };
  }

  calculateDistance(point1, point2) {
    const dx = point1.x - point2.x;
    const dy = point1.y - point2.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  calculateAngle(point1, point2, point3) {
    const v1 = { x: point1.x - point2.x, y: point1.y - point2.y };
    const v2 = { x: point3.x - point2.x, y: point3.y - point2.y };
    
    const dot = v1.x * v2.x + v1.y * v2.y;
    const mag1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y);
    const mag2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y);
    
    const angle = Math.acos(dot / (mag1 * mag2));
    return (angle * 180) / Math.PI;
  }

  calculateSimilarity(descriptor1, descriptor2) {
    if (descriptor1.length !== descriptor2.length) {
      return 0;
    }

    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (let i = 0; i < descriptor1.length; i++) {
      dotProduct += descriptor1[i] * descriptor2[i];
      norm1 += descriptor1[i] * descriptor1[i];
      norm2 += descriptor2[i] * descriptor2[i];
    }

    const similarity = dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
    return Math.max(0, similarity);
  }

  calculateFeatureSimilarity(features1, features2) {
    const weights = {
      eyeDistance: 0.25,
      noseWidth: 0.20,
      mouthWidth: 0.20,
      faceWidth: 0.15,
      faceHeight: 0.10,
      jawAngle: 0.05,
      eyebrowAngle: 0.05
    };

    let totalSimilarity = 0;
    let totalWeight = 0;

    for (const [feature, weight] of Object.entries(weights)) {
      if (features1[feature] !== undefined && features2[feature] !== undefined) {
        const diff = Math.abs(features1[feature] - features2[feature]);
        const avg = (features1[feature] + features2[feature]) / 2;
        const similarity = Math.max(0, 1 - (diff / avg));
        
        totalSimilarity += similarity * weight;
        totalWeight += weight;
      }
    }

    return totalWeight > 0 ? totalSimilarity / totalWeight : 0;
  }

  getConfidenceLevel(similarity) {
    if (similarity >= 0.95) return 'Muito Alta';
    if (similarity >= 0.90) return 'Alta';
    if (similarity >= 0.85) return 'Média';
    if (similarity >= 0.75) return 'Baixa';
    return 'Muito Baixa';
  }

  isValidUUID(uuid) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
  }

  async getFaceEncoding(userId) {
    try {
      const redisKey = `face_encoding:${userId}`;
      const encodingData = await this.redisClient.get(redisKey);
      
      if (encodingData) {
        return JSON.parse(encodingData);
      }
      return null;
    } catch (error) {
      console.error('Erro ao recuperar encoding:', error);
      return null;
    }
  }

  async deleteFaceEncoding(userId) {
    try {
      const redisKey = `face_encoding:${userId}`;
      const metadataKey = `face_metadata:${userId}`;
      
      await this.redisClient.del(redisKey);
      await this.redisClient.del(metadataKey);
      
      return true;
    } catch (error) {
      console.error('Erro ao deletar encoding:', error);
      return false;
    }
  }

  errorHandler(error, req, res, next) {
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          success: false,
          error: 'Arquivo muito grande. Máximo 5MB.'
        });
      }
    }
    
    console.error('Erro não tratado:', error);
    res.status(500).json({
      success: false,
      error: 'Erro interno do servidor',
      details: error.message
    });
  }

  start(port = 3001) {
    this.app.listen(port, () => {
      console.log(`🚀 KYC Microservice rodando na porta ${port}`);
      console.log(`📊 Health check: http://localhost:${port}/health`);
      console.log(`📈 Stats: http://localhost:${port}/stats`);
    });
  }
}

// Cluster mode para máxima performance
if (cluster.isMaster) {
  const numWorkers = process.env.WORKER_COUNT || os.cpus().length;
  console.log(`🚀 Iniciando ${numWorkers} workers do KYC Microservice`);
  
  for (let i = 0; i < numWorkers; i++) {
    cluster.fork();
  }
  
  cluster.on('exit', (worker, code, signal) => {
    console.log(`Worker ${worker.process.pid} morreu. Reiniciando...`);
    cluster.fork();
  });
  
  cluster.on('online', (worker) => {
    console.log(`✅ Worker ${worker.process.pid} online`);
  });
} else {
  // Worker process
  const kycService = new KYCMicroservice();
  kycService.start(process.env.PORT || 3001);
}

module.exports = KYCMicroservice;

