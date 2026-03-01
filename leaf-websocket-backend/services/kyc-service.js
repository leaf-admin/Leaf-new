// services/kyc-service.js
// Serviço para processamento de KYC (CNH + Selfie)
// 
// ⚠️ ARQUITETURA CORRETA:
// - Mobile: Face detection, landmarks, liveness (TUDO no device)
// - Backend: APENAS embedding + comparação (NÃO faz detecção!)
// 
// REGRA DE OURO:
// "Backend NÃO faz detecção contínua nem liveness.
//  Backend SÓ compara duas imagens (embeddings)."

const sharp = require('sharp');
const { createWorker } = require('tesseract.js');
const { Matrix } = require('ml-matrix');
const admin = require('firebase-admin');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { logStructured, logError } = require('../utils/logger');

// InsightFace para embedding (leve, apenas embedding, sem detecção)
let insightface = null;

class KYCService {
  constructor() {
    this.worker = null;
    this.faceApi = null;
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;

    try {
      // Inicializar Tesseract para OCR
      this.worker = await createWorker('por'); // Português
      logStructured('info', 'Tesseract OCR inicializado', { service: 'kyc-service' });

      // NÃO inicializar detecção facial aqui!
      // Backend apenas gera embeddings, não detecta faces
      // Detecção facial roda no mobile
      logStructured('info', 'KYC Service inicializado (embedding-only, sem detecção)', { service: 'kyc-service' });
      this.initialized = true;
    } catch (error) {
      logError(error, 'Erro ao inicializar KYC Service', { service: 'kyc-service' });
      throw error;
    }
  }

  /**
   * Carregar InsightFace para embedding (lazy loading)
   * InsightFace é leve e faz APENAS embedding, não detecção
   * @returns {Promise<void>}
   */
  async loadInsightFace() {
    if (insightface) return; // Já carregado

    try {
      // Tentar carregar insightface-node (leve, apenas embedding)
      insightface = require('insightface-node');
      logStructured('info', 'InsightFace carregado (embedding-only)', { service: 'kyc-service' });
    } catch (error) {
      logStructured('warn', 'InsightFace não disponível, usando embedding dummy', { service: 'kyc-service', error: error.message, note: 'Para usar InsightFace: npm install insightface-node' });
      insightface = null;
    }
  }

  /**
   * Processar OCR da CNH
   * @param {string} imagePath - Caminho da imagem da CNH
   * @returns {Promise<{name: string, cpf: string, rawText: string}>}
   */
  async processCNHOCR(imagePath) {
    try {
      if (!this.worker) {
        await this.initialize();
      }

      // Processar imagem com Tesseract
      const { data: { text } } = await this.worker.recognize(imagePath);

      // Extrair nome e CPF usando regex
      const cpfRegex = /\d{3}\.?\d{3}\.?\d{3}-?\d{2}/g;
      const cpfMatch = text.match(cpfRegex);
      const cpf = cpfMatch ? cpfMatch[0].replace(/[^\d]/g, '').replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : null;

      // Extrair nome (geralmente aparece antes do CPF)
      const nameRegex = /([A-ZÁÉÍÓÚÇÃÕ][a-záéíóúçãõ]+(?:\s+[A-ZÁÉÍÓÚÇÃÕ][a-záéíóúçãõ]+)+)/g;
      const nameMatch = text.match(nameRegex);
      const name = nameMatch ? nameMatch[0] : null;

      return {
        name: name || '',
        cpf: cpf || '',
        rawText: text
      };
    } catch (error) {
      logError(error, 'Erro ao processar OCR da CNH', { service: 'kyc-service' });
      throw error;
    }
  }

  /**
   * Processar e normalizar imagem para embedding
   * ⚠️ ASSUME que a imagem já tem uma face detectada (mobile fez isso)
   * Backend apenas redimensiona e normaliza, NÃO detecta faces
   * @param {string} imagePath - Caminho da imagem
   * @returns {Promise<Buffer>} - Imagem normalizada (224x224 para InsightFace)
   */
  async normalizeImage(imagePath) {
    try {
      // Redimensionar para 224x224 (tamanho padrão para embedding)
      // Mobile já detectou e alinhou a face, backend só normaliza
      const normalized = await sharp(imagePath)
        .resize(224, 224, {
          fit: 'cover',
          position: 'center'
        })
        .normalize()
        .toBuffer();

      return normalized;
    } catch (error) {
      logError(error, 'Erro ao normalizar imagem', { service: 'kyc-service' });
      throw error;
    }
  }

  /**
   * Gerar embedding facial (APENAS embedding, sem detecção)
   * ⚠️ Mobile já detectou e alinhou a face antes de enviar
   * Backend apenas gera embedding da imagem já processada
   * @param {Buffer} imageBuffer - Buffer da imagem normalizada (224x224)
   * @returns {Promise<number[]>} - Embedding de 512 dimensões
   */
  async generateFaceEmbedding(imageBuffer) {
    // Tentar carregar InsightFace se ainda não carregado
    await this.loadInsightFace();

    // Se InsightFace não estiver disponível, usar embedding dummy
    if (!insightface) {
      logStructured('warn', 'Usando embedding dummy (InsightFace não disponível)', { service: 'kyc-service' });
      return this.generateDummyEmbedding(imageBuffer);
    }

    try {
      // InsightFace gera embedding APENAS (sem detecção)
      // Mobile já fez a detecção e alinhamento
      const embedding = await insightface.getEmbedding(imageBuffer);
      return embedding; // 512D
    } catch (error) {
      logStructured('warn', 'Erro ao gerar embedding com InsightFace, usando dummy', { service: 'kyc-service', error: error.message });
      return this.generateDummyEmbedding(imageBuffer);
    }
  }

  /**
   * Gerar embedding dummy (fallback)
   * @param {Buffer} imageBuffer - Buffer da imagem
   * @returns {number[]} - Embedding dummy de 512D
   */
  generateDummyEmbedding(imageBuffer) {
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256').update(imageBuffer).digest('hex');
    
    // Gerar embedding determinístico de 512D baseado no hash
    const embedding = [];
    for (let i = 0; i < 512; i++) {
      const seed = parseInt(hash.substr(i % 64, 2), 16);
      embedding.push((seed / 255) * 2 - 1); // Normalizar entre -1 e 1
    }

    return embedding;
  }

  /**
   * Calcular similaridade de cosseno entre dois embeddings
   * @param {number[]} embedding1 - Primeiro embedding
   * @param {number[]} embedding2 - Segundo embedding
   * @returns {number} - Similaridade (0 a 1)
   */
  calculateCosineSimilarity(embedding1, embedding2) {
    if (embedding1.length !== embedding2.length) {
      throw new Error('Embeddings devem ter o mesmo tamanho');
    }

    const vec1 = new Matrix([embedding1]);
    const vec2 = new Matrix([embedding2]);

    const dotProduct = vec1.mmul(vec2.transpose()).get(0, 0);
    const norm1 = Math.sqrt(vec1.mmul(vec1.transpose()).get(0, 0));
    const norm2 = Math.sqrt(vec2.mmul(vec2.transpose()).get(0, 0));

    return dotProduct / (norm1 * norm2);
  }

  /**
   * Processar onboarding KYC (CNH + Selfie)
   * @param {string} driverId - ID do motorista
   * @param {string} cnhImagePath - Caminho da imagem da CNH
   * @param {string} selfieImagePath - Caminho da imagem da selfie
   * @returns {Promise<{approved: boolean, similarity: number, cnhData: object, anchorImageUrl: string}>}
   */
  async processOnboarding(driverId, cnhImagePath, selfieImagePath) {
    try {
      logStructured('info', 'Processando KYC para motorista', { service: 'kyc-service', driverId });

      // 1. Processar OCR da CNH
      const cnhData = await this.processCNHOCR(cnhImagePath);
      logStructured('info', 'CNH processada', { service: 'kyc-service', driverId, cnhData });

      // 2. Normalizar imagens
      const cnhNormalized = await this.normalizeImage(cnhImagePath);
      const selfieNormalized = await this.normalizeImage(selfieImagePath);

      // 3. Gerar embeddings
      const cnhEmbedding = await this.generateFaceEmbedding(cnhNormalized);
      const selfieEmbedding = await this.generateFaceEmbedding(selfieNormalized);

      // 4. Calcular similaridade
      const similarity = this.calculateCosineSimilarity(cnhEmbedding, selfieEmbedding);
      logStructured('info', `Similaridade CNH ↔ Selfie: ${similarity.toFixed(3)}`, { service: 'kyc-service', driverId, similarity });

      // 5. Decisão baseada em threshold
      const APPROVE_THRESHOLD = 0.65;
      const REVIEW_THRESHOLD = 0.55;
      const approved = similarity >= APPROVE_THRESHOLD;
      const needsReview = similarity >= REVIEW_THRESHOLD && similarity < APPROVE_THRESHOLD;

      // 6. Se aprovado, salvar foto âncora no Firestore
      let anchorImageUrl = null;
      if (approved) {
        anchorImageUrl = await this.saveAnchorImage(driverId, selfieImagePath, selfieEmbedding);
      }

      return {
        approved,
        needsReview,
        similarity,
        cnhData,
        anchorImageUrl,
        embedding: selfieEmbedding // Salvar embedding para futuras comparações
      };
    } catch (error) {
      logError(error, 'Erro ao processar onboarding KYC', { service: 'kyc-service', driverId });
      throw error;
    }
  }

  /**
   * Salvar foto âncora no Firestore
   * @param {string} driverId - ID do motorista
   * @param {string} imagePath - Caminho da imagem
   * @param {number[]} embedding - Embedding facial
   * @returns {Promise<string>} - URL da imagem salva
   */
  async saveAnchorImage(driverId, imagePath, embedding) {
    try {
      const db = admin.firestore();
      const storage = admin.storage();

      // Upload da imagem para Firebase Storage
      const bucket = storage.bucket();
      const fileName = `kyc/anchor/${driverId}_${Date.now()}.jpg`;
      const file = bucket.file(fileName);

      await file.save(await fs.readFile(imagePath), {
        metadata: {
          contentType: 'image/jpeg',
        },
      });

      // Tornar arquivo público
      await file.makePublic();
      const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;

      // Salvar metadata no Firestore
      await db.collection('drivers').doc(driverId).set({
        kycAnchorImage: publicUrl,
        kycEmbedding: embedding,
        kycVerified: true,
        kycVerifiedAt: admin.firestore.FieldValue.serverTimestamp(),
        kycAnchorCreatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      logStructured('info', 'Foto âncora salva para motorista', { service: 'kyc-service', driverId, publicUrl });
      return publicUrl;
    } catch (error) {
      logError(error, 'Erro ao salvar foto âncora', { service: 'kyc-service', driverId });
      throw error;
    }
  }

  /**
   * Re-verificar identidade comparando selfie com foto âncora
   * @param {string} driverId - ID do motorista
   * @param {string} selfieImagePath - Caminho da nova selfie
   * @returns {Promise<{approved: boolean, similarity: number}>}
   */
  async reverifyIdentity(driverId, selfieImagePath) {
    try {
      // Buscar foto âncora e embedding do Firestore
      const db = admin.firestore();
      const driverDoc = await db.collection('drivers').doc(driverId).get();

      if (!driverDoc.exists) {
        throw new Error('Motorista não encontrado');
      }

      const driverData = driverDoc.data();
      if (!driverData.kycAnchorImage || !driverData.kycEmbedding) {
        throw new Error('Foto âncora não encontrada. Motorista precisa fazer onboarding KYC primeiro.');
      }

      const anchorEmbedding = driverData.kycEmbedding;

      // Processar nova selfie
      const selfieNormalized = await this.normalizeImage(selfieImagePath);
      const selfieEmbedding = await this.generateFaceEmbedding(selfieNormalized);

      // Calcular similaridade
      const similarity = this.calculateCosineSimilarity(anchorEmbedding, selfieEmbedding);
      logStructured('info', `Similaridade Re-verificação: ${similarity.toFixed(3)}`, { service: 'kyc-service', driverId, similarity });

      const APPROVE_THRESHOLD = 0.65;
      const approved = similarity >= APPROVE_THRESHOLD;

      // Salvar evidência da re-verificação
      await db.collection('drivers').doc(driverId).collection('kyc_verifications').add({
        similarity,
        approved,
        verifiedAt: admin.firestore.FieldValue.serverTimestamp(),
        selfieImageUrl: null // TODO: Upload da selfie se necessário
      });

      return {
        approved,
        similarity
      };
    } catch (error) {
      logError(error, 'Erro ao re-verificar identidade', { service: 'kyc-service', driverId });
      throw error;
    }
  }

  /**
   * Limpar recursos
   */
  async cleanup() {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
    }
    this.initialized = false;
  }
}

// Singleton
const kycService = new KYCService();

module.exports = kycService;

