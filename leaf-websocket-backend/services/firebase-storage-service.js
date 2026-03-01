/**
 * 🔥 Serviço para acessar Firebase Storage
 * 
 * Responsável por:
 * - Buscar URLs de documentos no Firestore/Realtime DB
 * - Baixar arquivos do Firebase Storage
 * - Converter para Buffer para processamento
 */

const admin = require('firebase-admin');
const https = require('https');
const http = require('http');
const { getFirestore, getRealtimeDB } = require('../firebase-config');
const { logStructured, logError } = require('../utils/logger');

class FirebaseStorageService {
  constructor() {
    this.storage = null;
    this.initializeStorage();
  }

  initializeStorage() {
    try {
      // Inicializar Firebase Admin SDK se ainda não foi
      if (!admin.apps.length) {
        const firebaseConfig = require('../firebase-config');
        firebaseConfig.initializeFirebase();
      }

      // Obter instância do Storage usando getStorage do firebase-config
      const firebaseConfig = require('../firebase-config');
      this.storage = firebaseConfig.getStorage();
      logStructured('info', 'Firebase Storage Service inicializado', { service: 'firebase-storage-service' });
    } catch (error) {
      logError(error, 'Erro ao inicializar Firebase Storage', { service: 'firebase-storage-service' });
    }
  }

  /**
   * Busca URL da foto âncora (anchor image) no Firestore
   * Foto âncora é a selfie aprovada no onboarding KYC
   * @param {string} userId - ID do usuário
   * @returns {Promise<{url: string, embedding: number[]}|null>} Dados da foto âncora ou null
   */
  async getAnchorImage(userId) {
    try {
      const firestore = getFirestore();
      if (!firestore) {
        logStructured('warn', 'Firestore não disponível', { service: 'firebase-storage-service', userId });
        return null;
      }

      // Buscar no Firestore: drivers/{userId}.kycAnchorImage
      const driverDoc = await firestore.collection('drivers').doc(userId).get();
      
      if (driverDoc.exists) {
        const driverData = driverDoc.data();
        if (driverData.kycAnchorImage && driverData.kycEmbedding) {
          logStructured('info', 'Foto âncora encontrada no Firestore', { service: 'firebase-storage-service', userId });
          return {
            url: driverData.kycAnchorImage,
            embedding: driverData.kycEmbedding,
            verifiedAt: driverData.kycVerifiedAt
          };
        }
      }

      // Tentar também em users/{userId} (caso esteja na estrutura de usuários)
      const userDoc = await firestore.collection('users').doc(userId).get();
      if (userDoc.exists) {
        const userData = userDoc.data();
        if (userData.kycAnchorImage && userData.kycEmbedding) {
          logStructured('info', 'Foto âncora encontrada no Firestore (estrutura users)', { service: 'firebase-storage-service', userId });
          return {
            url: userData.kycAnchorImage,
            embedding: userData.kycEmbedding,
            verifiedAt: userData.kycVerifiedAt
          };
        }
      }

      logStructured('info', 'Foto âncora não encontrada', { service: 'firebase-storage-service', userId });
      return null;
    } catch (error) {
      logError(error, 'Erro ao buscar foto âncora', { service: 'firebase-storage-service', userId });
      return null;
    }
  }

  /**
   * Busca URL da CNH no Firestore ou Realtime Database
   * @param {string} userId - ID do usuário
   * @returns {Promise<string|null>} URL da CNH ou null
   */
  async getCNHUrl(userId) {
    try {
      // Tentar Firestore primeiro
      const firestore = getFirestore();
      if (firestore) {
        try {
          // Estrutura nova: users/{userId}/documents/cnh
          const docRef = firestore.collection('users').doc(userId)
            .collection('documents').doc('cnh');
          const doc = await docRef.get();
          
          if (doc.exists) {
            const data = doc.data();
            if (data.fileUrl) {
              logStructured('info', 'URL da CNH encontrada no Firestore (estrutura nova)', { service: 'firebase-storage-service', userId });
              return data.fileUrl;
            }
          }
          
          // Estrutura antiga: users/{userId}.licenseImage
          const userDoc = await firestore.collection('users').doc(userId).get();
          if (userDoc.exists) {
            const userData = userDoc.data();
            if (userData.licenseImage) {
              logStructured('info', 'URL da CNH encontrada no Firestore (estrutura antiga)', { service: 'firebase-storage-service', userId });
              return userData.licenseImage;
            }
          }
        } catch (firestoreError) {
          logStructured('warn', 'Erro ao buscar no Firestore, tentando Realtime DB', { service: 'firebase-storage-service', error: firestoreError.message, userId });
        }
      }

      // Fallback: Realtime Database
      const db = getRealtimeDB();
      if (db) {
        try {
          // Estrutura nova: users/{userId}/documents/cnh
          const snapshot = await db.ref(`users/${userId}/documents/cnh`).once('value');
          const cnhData = snapshot.val();
          
          if (cnhData && cnhData.fileUrl) {
            logStructured('info', 'URL da CNH encontrada no Realtime DB (estrutura nova)', { service: 'firebase-storage-service', userId });
            return cnhData.fileUrl;
          }
          
          // Estrutura antiga: users/{userId}.licenseImage
          const userSnapshot = await db.ref(`users/${userId}`).once('value');
          const userData = userSnapshot.val();
          
          if (userData && userData.licenseImage) {
            logStructured('info', 'URL da CNH encontrada no Realtime DB (estrutura antiga)', { service: 'firebase-storage-service', userId });
            return userData.licenseImage;
          }
        } catch (dbError) {
          logStructured('warn', 'Erro ao buscar no Realtime DB', { service: 'firebase-storage-service', error: dbError.message, userId });
        }
      }

      logStructured('warn', 'CNH não encontrada para usuário', { service: 'firebase-storage-service', userId });
      return null;

    } catch (error) {
      logError(error, 'Erro ao buscar URL da CNH', { service: 'firebase-storage-service', userId });
      return null;
    }
  }

  /**
   * Baixa arquivo do Firebase Storage por URL
   * @param {string} fileUrl - URL completa do arquivo
   * @returns {Promise<Buffer>} Buffer do arquivo
   */
  async downloadFile(fileUrl) {
    try {
      if (!fileUrl) {
        throw new Error('URL do arquivo não fornecida');
      }

      // Se URL é do Firebase Storage, usar Admin SDK (mais eficiente)
      if (fileUrl.includes('firebase.googleapis.com') || 
          fileUrl.includes('storage.googleapis.com') ||
          fileUrl.includes('firebasestorage.googleapis.com')) {
        
        try {
          return await this.downloadFromFirebaseStorage(fileUrl);
        } catch (firebaseError) {
          logStructured('warn', 'Erro ao baixar via Admin SDK, tentando HTTP direto', { service: 'firebase-storage-service', error: firebaseError.message, filePath });
          // Fallback para HTTP direto
        }
      }
      
      // Fallback: download HTTP direto
      return await this.downloadFromUrl(fileUrl);
      
    } catch (error) {
      logError(error, 'Erro ao baixar arquivo', { service: 'firebase-storage-service', filePath });
      throw error;
    }
  }

  /**
   * Baixa arquivo usando Firebase Admin SDK
   * @param {string} fileUrl - URL do Firebase Storage
   * @returns {Promise<Buffer>} Buffer do arquivo
   */
  async downloadFromFirebaseStorage(fileUrl) {
    try {
      if (!this.storage) {
        throw new Error('Firebase Storage não inicializado');
      }

      // Extrair bucket e path da URL
      // Exemplo: https://firebasestorage.googleapis.com/v0/b/BUCKET_NAME/o/PATH%2FTO%2FFILE?alt=media&token=TOKEN
      const urlObj = new URL(fileUrl);
      
      // Tentar extrair bucket name e file path
      let bucketName = null;
      let filePath = null;

      // Formato 1: firebasestorage.googleapis.com/v0/b/BUCKET/o/PATH
      if (urlObj.pathname.includes('/b/')) {
        const parts = urlObj.pathname.split('/b/')[1].split('/o/');
        if (parts.length === 2) {
          bucketName = parts[0];
          filePath = decodeURIComponent(parts[1].split('?')[0]);
        }
      }
      // Formato 2: storage.googleapis.com/BUCKET/PATH
      else if (urlObj.hostname.includes('storage.googleapis.com')) {
        const pathParts = urlObj.pathname.split('/').filter(p => p);
        if (pathParts.length >= 2) {
          bucketName = pathParts[0];
          filePath = pathParts.slice(1).join('/');
        }
      }

      if (!bucketName || !filePath) {
        throw new Error('Não foi possível extrair bucket e path da URL');
      }

      logStructured('info', 'Baixando do Firebase Storage', { service: 'firebase-storage-service', bucketName, filePath });

      const bucket = this.storage.bucket(bucketName);
      const file = bucket.file(filePath);
      
      const [buffer] = await file.download();
      logStructured('info', 'Arquivo baixado', { service: 'firebase-storage-service', size: buffer.length, bucketName, filePath });
      
      return buffer;
      
    } catch (error) {
      logError(error, 'Erro ao baixar do Firebase Storage', { service: 'firebase-storage-service', bucketName, filePath });
      throw error;
    }
  }

  /**
   * Download HTTP direto (fallback)
   * @param {string} url - URL do arquivo
   * @returns {Promise<Buffer>} Buffer do arquivo
   */
  async downloadFromUrl(url) {
    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https') ? https : http;
      
      logStructured('info', 'Baixando via HTTP', { service: 'firebase-storage-service', url: url.substring(0, 100) });
      
      protocol.get(url, (response) => {
        if (response.statusCode === 301 || response.statusCode === 302) {
          // Seguir redirect
          return this.downloadFromUrl(response.headers.location)
            .then(resolve)
            .catch(reject);
        }
        
        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
          return;
        }
        
        const chunks = [];
        let totalSize = 0;
        
        response.on('data', (chunk) => {
          chunks.push(chunk);
          totalSize += chunk.length;
        });
        
        response.on('end', () => {
          const buffer = Buffer.concat(chunks);
          logStructured('info', 'Arquivo baixado via HTTP', { service: 'firebase-storage-service', size: buffer.length, url: url.substring(0, 100) });
          resolve(buffer);
        });
        
        response.on('error', reject);
      }).on('error', reject);
    });
  }

  /**
   * Busca e baixa CNH completa (URL + download)
   * @param {string} userId - ID do usuário
   * @returns {Promise<Buffer|null>} Buffer da CNH ou null
   */
  async getCNHBuffer(userId) {
    try {
      const cnhUrl = await this.getCNHUrl(userId);
      
      if (!cnhUrl) {
        return null;
      }

      const buffer = await this.downloadFile(cnhUrl);
      return buffer;
      
    } catch (error) {
      logError(error, 'Erro ao obter buffer da CNH', { service: 'firebase-storage-service', userId });
      return null;
    }
  }
}

module.exports = FirebaseStorageService;

