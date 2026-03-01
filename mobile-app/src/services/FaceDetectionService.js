/**
 * 🔐 Face Detection Service
 * 
 * Serviço para detecção facial no dispositivo móvel
 * 
 * Arquitetura:
 * - Mobile: Face detection, landmarks, liveness (TUDO no device)
 * - Backend: APENAS embedding + comparação (NÃO faz detecção!)
 * 
 * Este serviço:
 * - Detecta faces em imagens
 * - Valida qualidade da imagem
 * - Valida liveness (piscar, sorrir, virar cabeça)
 * - Alinha face antes de enviar para backend
 */

import Logger from '../utils/Logger';
import * as FileSystem from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';

class FaceDetectionService {
  constructor() {
    this.initialized = false;
    this.faceDetector = null;
  }

  /**
   * Inicializar serviço de detecção facial
   * Usa detecção nativa do Expo Camera (MLKit no device)
   */
  async initialize() {
    if (this.initialized) {
      return true;
    }

    try {
      // Expo Camera usa MLKit nativo para detecção facial
      // Não precisa de biblioteca adicional - já está integrado
      this.initialized = true;
      Logger.log('✅ Face Detection Service inicializado (Expo Camera + MLKit)');
      Logger.log('ℹ️ Detecção facial nativa ativada');
      return true;
    } catch (error) {
      Logger.error('❌ Erro ao inicializar Face Detection Service:', error);
      this.initialized = true;
      return true;
    }
  }

  /**
   * Detectar face em uma imagem estática usando os dados recém capturados do live feed
   * @param {string} imageUri - URI da imagem
   * @param {Object} knownFace - Últimos dados rastreados do rosto antes de capturar a imagem
   * @returns {Promise<Object>} Resultado da detecção
   */
  async detectFace(imageUri, knownFace) {
    try {
      if (!this.initialized) {
        await this.initialize();
      }

      // Usar a detecção baseada nos dados do rastreamento de vídeo
      return await this.detectFaceBasic(imageUri, knownFace);
    } catch (error) {
      Logger.error('❌ Erro ao detectar face:', error);
      return {
        success: false,
        error: error.message || 'Erro ao detectar face',
        hasFace: false
      };
    }
  }

  /**
   * Processar dados de face do Expo Camera (MLKit)
   * @param {Object} faces - Array de faces detectadas pelo Expo Camera
   * @returns {Object} Resultado processado
   */
  processCameraFaces(faces) {
    try {
      if (!faces || faces.length === 0) {
        return {
          success: false,
          hasFace: false,
          error: 'Nenhuma face detectada'
        };
      }

      // Pegar a primeira face (mais próxima/central)
      const face = faces[0];

      // Extrair dados relevantes
      const faceData = {
        boundingBox: face.bounds,
        leftEyeOpenProbability: face.leftEyeOpenProbability || 0.5,
        rightEyeOpenProbability: face.rightEyeOpenProbability || 0.5,
        smilingProbability: face.smilingProbability || 0.5,
        headEulerAngleY: face.yawAngle || 0,
        headEulerAngleZ: face.rollAngle || 0,
        landmarks: face.landmarks || [],
        trackingId: face.trackingId || null
      };

      // Validar qualidade
      const quality = this.validateFaceQuality(faceData);

      return {
        success: true,
        hasFace: true,
        face: faceData,
        quality: quality,
        confidence: quality.score
      };
    } catch (error) {
      Logger.error('❌ Erro ao processar faces da câmera:', error);
      return {
        success: false,
        hasFace: false,
        error: error.message
      };
    }
  }

  /**
   * Detectar face em imagem estática utilizando os dados conhecidos do feed ao vivo
   * @param {string} imageUri
   * @param {Object} knownFace - Dados da face trackeada via onFacesDetected
   */
  async detectFaceBasic(imageUri, knownFace) {
    try {
      if (!knownFace) {
        return {
          success: false,
          hasFace: false,
          error: 'Nenhuma face pré-detectada foi fornecida para validação estática.'
        };
      }

      // Verificar se arquivo existe
      const fileInfo = await FileSystem.getInfoAsync(imageUri);
      if (!fileInfo.exists) {
        return {
          success: false,
          hasFace: false,
          error: 'Arquivo de imagem não encontrado'
        };
      }

      // A detecção real ocorreu no feed de vídeo com ML Kit via Expo Camera.
      // Retornamos os dados reais capturados um instante antes da foto (knownFace).
      Logger.log('ℹ️ Usando metadados reais de liveness do framework nativo (Expo MLKit).');

      const quality = this.validateFaceQuality(knownFace);

      return {
        success: true,
        hasFace: true,
        face: knownFace,
        quality: quality,
        confidence: quality.score
      };
    } catch (error) {
      Logger.error('❌ Erro na detecção de imagem estática:', error);
      return {
        success: false,
        hasFace: false,
        error: error.message
      };
    }
  }

  /**
   * Validar qualidade da face detectada
   */
  validateFaceQuality(face) {
    const warnings = [];
    const errors = [];

    // Validar tamanho da face (deve ocupar pelo menos 20% da imagem)
    const faceArea = face.boundingBox.width * face.boundingBox.height;
    // Assumir tamanho da imagem (será melhorado com informações reais)
    const minFaceArea = 0.2; // 20% da imagem
    if (faceArea < minFaceArea) {
      warnings.push('Face muito pequena na imagem');
    }

    // Validar olhos abertos
    if (face.leftEyeOpenProbability < 0.5 || face.rightEyeOpenProbability < 0.5) {
      warnings.push('Olhos podem estar fechados');
    }

    // Validar inclinação da cabeça
    if (Math.abs(face.headEulerAngleY) > 20 || Math.abs(face.headEulerAngleZ) > 20) {
      warnings.push('Cabeça muito inclinada - mantenha a cabeça reta');
    }

    // Validar iluminação (baseado em landmarks)
    if (face.landmarks && face.landmarks.length < 5) {
      warnings.push('Iluminação pode estar inadequada');
    }

    return {
      isValid: errors.length === 0,
      warnings: warnings,
      errors: errors,
      score: this.calculateQualityScore(face)
    };
  }

  /**
   * Calcular score de qualidade da face
   */
  calculateQualityScore(face) {
    let score = 1.0;

    // Penalizar olhos fechados
    if (face.leftEyeOpenProbability < 0.5) score -= 0.2;
    if (face.rightEyeOpenProbability < 0.5) score -= 0.2;

    // Penalizar inclinação
    if (Math.abs(face.headEulerAngleY) > 15) score -= 0.1;
    if (Math.abs(face.headEulerAngleZ) > 15) score -= 0.1;

    // Penalizar face pequena
    const faceArea = face.boundingBox.width * face.boundingBox.height;
    if (faceArea < 0.2) score -= 0.2;

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Validar liveness (piscar, sorrir, virar cabeça)
   * @param {Array} faceHistory - Histórico de faces detectadas
   * @returns {Promise<Object>} Resultado da validação de liveness
   */
  async validateLiveness(faceHistory) {
    try {
      if (!faceHistory || faceHistory.length < 3) {
        return {
          success: false,
          error: 'Histórico insuficiente para validação de liveness',
          checks: {
            blink: false,
            smile: false,
            headMovement: false
          }
        };
      }

      const checks = {
        blink: false,
        smile: false,
        headMovement: false
      };

      // Verificar piscar (mudança nos olhos ao longo do tempo)
      let blinkCount = 0;
      let lastEyeState = 'open'; // 'open' ou 'closed'

      for (let i = 1; i < faceHistory.length; i++) {
        const prev = faceHistory[i - 1];
        const curr = faceHistory[i];

        // Calcular estado dos olhos (média dos dois olhos)
        const prevEyeAvg = (prev.leftEyeOpenProbability + prev.rightEyeOpenProbability) / 2;
        const currEyeAvg = (curr.leftEyeOpenProbability + curr.rightEyeOpenProbability) / 2;

        // Detectar transição: aberto -> fechado -> aberto (piscar completo)
        if (prevEyeAvg > 0.6 && currEyeAvg < 0.4) {
          lastEyeState = 'closed';
        } else if (prevEyeAvg < 0.4 && currEyeAvg > 0.6 && lastEyeState === 'closed') {
          blinkCount++;
          lastEyeState = 'open';
        }
      }

      // Piscar válido se detectou pelo menos 1 piscar completo
      checks.blink = blinkCount >= 1;

      // Verificar sorriso (deve ter sorriso em pelo menos 30% dos frames)
      const smileFrames = faceHistory.filter(face => face.smilingProbability > 0.6);
      checks.smile = smileFrames.length >= Math.ceil(faceHistory.length * 0.3);

      // Verificar movimento de cabeça (variação nos ângulos)
      const headAngles = faceHistory.map(face => ({
        y: face.headEulerAngleY || 0,
        z: face.headEulerAngleZ || 0
      }));
      const headMovement = this.detectHeadMovement(headAngles);
      checks.headMovement = headMovement;

      const allChecksPassed = Object.values(checks).every(check => check === true);

      return {
        success: allChecksPassed,
        checks: checks,
        passed: Object.values(checks).filter(c => c).length,
        total: Object.keys(checks).length,
        blinkCount: blinkCount,
        smileFrames: smileFrames.length,
        totalFrames: faceHistory.length
      };
    } catch (error) {
      Logger.error('❌ Erro ao validar liveness:', error);
      return {
        success: false,
        error: error.message,
        checks: {
          blink: false,
          smile: false,
          headMovement: false
        }
      };
    }
  }

  /**
   * Detectar movimento de cabeça
   * @param {Array} headAngles - Array de ângulos da cabeça ao longo do tempo
   * @returns {boolean} True se movimento detectado
   */
  detectHeadMovement(headAngles) {
    if (headAngles.length < 3) return false;

    // Calcular variação nos ângulos Y (esquerda/direita) e Z (rotação)
    const yValues = headAngles.map(a => a.y);
    const zValues = headAngles.map(a => a.z);

    const yMin = Math.min(...yValues);
    const yMax = Math.max(...yValues);
    const zMin = Math.min(...zValues);
    const zMax = Math.max(...zValues);

    const yVariation = Math.abs(yMax - yMin);
    const zVariation = Math.abs(zMax - zMin);

    // Movimento detectado se houver variação significativa (>= 8 graus)
    // Isso garante que o usuário realmente moveu a cabeça, não apenas ruído
    const hasMovement = yVariation >= 8 || zVariation >= 8;

    Logger.log(`Movimento de cabeça: Y=${yVariation.toFixed(1)}°, Z=${zVariation.toFixed(1)}° - ${hasMovement ? '✅' : '❌'}`);

    return hasMovement;
  }

  /**
   * Alinhar face na imagem
   * @param {string} imageUri - URI da imagem original
   * @param {Object} face - Dados da face detectada
   * @returns {Promise<string>} URI da imagem alinhada
   */
  async alignFace(imageUri, face) {
    try {
      if (!face || !face.landmarks) {
        // Se não houver landmarks, apenas redimensionar
        return await this.resizeImage(imageUri);
      }

      // Calcular ângulo de rotação baseado nos olhos
      const leftEye = face.landmarks.find(l => l.type === 'leftEye');
      const rightEye = face.landmarks.find(l => l.type === 'rightEye');

      if (leftEye && rightEye) {
        // Calcular ângulo de inclinação
        const angle = Math.atan2(
          rightEye.position.y - leftEye.position.y,
          rightEye.position.x - leftEye.position.x
        ) * (180 / Math.PI);

        // Rotacionar imagem se necessário
        if (Math.abs(angle) > 2) {
          const rotated = await ImageManipulator.manipulateAsync(
            imageUri,
            [{ rotate: -angle }],
            { format: ImageManipulator.SaveFormat.JPEG, compress: 0.9 }
          );
          return rotated.uri;
        }
      }

      // Se não precisar rotacionar, apenas redimensionar
      return await this.resizeImage(imageUri);
    } catch (error) {
      Logger.error('❌ Erro ao alinhar face:', error);
      // Em caso de erro, retornar imagem original redimensionada
      return await this.resizeImage(imageUri);
    }
  }

  /**
   * Redimensionar imagem para tamanho padrão (224x224 para embedding)
   */
  async resizeImage(imageUri) {
    try {
      const resized = await ImageManipulator.manipulateAsync(
        imageUri,
        [{ resize: { width: 224, height: 224 } }],
        { format: ImageManipulator.SaveFormat.JPEG, compress: 0.9 }
      );
      return resized.uri;
    } catch (error) {
      Logger.error('❌ Erro ao redimensionar imagem:', error);
      return imageUri; // Retornar original em caso de erro
    }
  }

  /**
   * Processar imagem completa (detectar, validar, alinhar)
   * @param {string} imageUri - URI da imagem
   * @param {Object} knownFace - Rosto validado imediatamente antes da captura
   * @returns {Promise<Object>} Resultado completo do processamento
   */
  async processImage(imageUri, knownFace) {
    try {
      // 1. Detectar face (aproveita a detecção em tempo real)
      const detection = await this.detectFace(imageUri, knownFace);
      if (!detection.success || !detection.hasFace) {
        return {
          success: false,
          error: detection.error || 'Nenhuma face detectada',
          detection: detection
        };
      }

      // 2. Validar qualidade
      if (!detection.quality.isValid) {
        return {
          success: false,
          error: 'Qualidade da imagem insuficiente',
          quality: detection.quality,
          detection: detection
        };
      }

      // 3. Alinhar face
      const alignedUri = await this.alignFace(imageUri, detection.face);

      return {
        success: true,
        originalUri: imageUri,
        alignedUri: alignedUri,
        detection: detection,
        quality: detection.quality
      };
    } catch (error) {
      Logger.error('❌ Erro ao processar imagem:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

// Singleton
const faceDetectionService = new FaceDetectionService();

export default faceDetectionService;

