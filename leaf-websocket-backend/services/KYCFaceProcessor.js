const cv = require('opencv4nodejs');
const faceapi = require('face-api.js');
const { Canvas, Image, ImageData } = require('canvas');
const redis = require('redis');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { logStructured, logError } = require('../utils/logger');

// Configurar face-api.js para Node.js
faceapi.env.monkeyPatch({ Canvas, Image, ImageData });

class KYCFaceProcessor {
  constructor() {
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
  }

  async initialize() {
    try {
      // Carregar modelos do face-api.js
      const modelsPath = path.join(__dirname, 'models');
      await faceapi.nets.ssdMobilenetv1.loadFromDisk(modelsPath);
      await faceapi.nets.faceLandmark68Net.loadFromDisk(modelsPath);
      await faceapi.nets.faceRecognitionNet.loadFromDisk(modelsPath);
      
      this.modelsLoaded = true;
      logStructured('info', '✅ Modelos de reconhecimento facial carregados');
      
      // Conectar Redis
      await this.redisClient.connect();
      logStructured('info', '✅ Redis conectado');
      
    } catch (error) {
      logError(error, '❌ Erro ao inicializar KYC:', { service: 'KYCFaceProcessor' });
      throw error;
    }
  }

  async preprocessProfileImage(userId, imageBuffer) {
    try {
      if (!this.modelsLoaded) {
        throw new Error('Modelos não carregados');
      }

      // Validar UUID
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

      // Usar primeira face detectada
      const face = detections[0];
      
      // Extrair características faciais
      const faceDescriptor = face.descriptor;
      const landmarks = face.landmarks;
      
      // Calcular características específicas
      const features = this.extractFacialFeatures(landmarks);
      
      // Criar encoding completo
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

      // Salvar no Redis com TTL de 24 horas
      const redisKey = `face_encoding:${userId}`;
      await this.redisClient.setEx(redisKey, 86400, JSON.stringify(encoding));

      // Salvar metadados
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
      logError(error, 'Erro ao processar imagem de perfil:', { service: 'KYCFaceProcessor' });
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

      // Validar UUID
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

      // Calcular características atuais
      const currentFeatures = this.extractFacialFeatures(currentLandmarks);
      const featureSimilarity = this.calculateFeatureSimilarity(
        storedEncoding.features,
        currentFeatures
      );

      // Similaridade combinada
      const combinedSimilarity = (similarity * 0.7) + (featureSimilarity * 0.3);
      const isMatch = combinedSimilarity >= this.similarityThreshold;

      return {
        success: true,
        userId: userId,
        isMatch: isMatch,
        similarityScore: combinedSimilarity,
        threshold: this.similarityThreshold,
        confidence: this.getConfidenceLevel(combinedSimilarity),
        processingTime: Date.now(),
        details: {
          descriptorSimilarity: similarity,
          featureSimilarity: featureSimilarity,
          currentFeatures: currentFeatures,
          storedFeatures: storedEncoding.features
        }
      };

    } catch (error) {
      logError(error, 'Erro na verificação:', { service: 'KYCFaceProcessor' });
      return {
        success: false,
        error: error.message,
        userId: userId
      };
    }
  }

  extractFacialFeatures(landmarks) {
    const positions = landmarks.positions;
    
    // Calcular características específicas
    const features = {
      eyeDistance: this.calculateDistance(positions[36], positions[45]), // Olhos
      noseWidth: this.calculateDistance(positions[31], positions[35]), // Nariz
      mouthWidth: this.calculateDistance(positions[48], positions[54]), // Boca
      faceWidth: this.calculateDistance(positions[0], positions[16]), // Largura do rosto
      faceHeight: this.calculateDistance(positions[8], positions[27]), // Altura do rosto
      jawAngle: this.calculateAngle(positions[8], positions[0], positions[16]), // Ângulo da mandíbula
      eyebrowAngle: this.calculateAngle(positions[17], positions[21], positions[22]) // Ângulo das sobrancelhas
    };

    return features;
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
      logError(error, 'Erro ao recuperar encoding:', { service: 'KYCFaceProcessor' });
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
      logError(error, 'Erro ao deletar encoding:', { service: 'KYCFaceProcessor' });
      return false;
    }
  }

  async getStats() {
    try {
      const encodingKeys = await this.redisClient.keys('face_encoding:*');
      const metadataKeys = await this.redisClient.keys('face_metadata:*');
      
      return {
        totalEncodings: encodingKeys.length,
        totalMetadata: metadataKeys.length,
        modelsLoaded: this.modelsLoaded,
        similarityThreshold: this.similarityThreshold
      };
    } catch (error) {
      logError(error, 'Erro ao obter estatísticas:', { service: 'KYCFaceProcessor' });
      return {
        totalEncodings: 0,
        totalMetadata: 0,
        modelsLoaded: false,
        error: error.message
      };
    }
  }

  async cleanup() {
    try {
      await this.redisClient.quit();
      logStructured('info', '✅ KYC Face Processor limpo');
    } catch (error) {
      logError(error, 'Erro durante limpeza:', { service: 'KYCFaceProcessor' });
    }
  }
}

module.exports = KYCFaceProcessor;

