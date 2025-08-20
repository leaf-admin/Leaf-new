const Redis = require('ioredis');
const admin = require('firebase-admin');
const { logger } = require('../utils/logger');

class SyncService {
  constructor() {
    this.redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
    this.isInitialized = false;
    this.syncInterval = null;
    this.syncConfig = {
      interval: 5 * 60 * 1000, // 5 minutos
      maxRetries: 3,
      retryDelay: 30 * 1000, // 30 segundos
      batchSize: 100
    };
  }

  async initialize() {
    try {
      await this.redis.ping();
      this.isInitialized = true;
      this.startAutoSync();
      logger.info('✅ Sync Service inicializado');
    } catch (error) {
      logger.error('❌ Erro ao inicializar Sync Service:', error);
      throw error;
    }
  }

  // Iniciar sincronização automática
  startAutoSync() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }

    this.syncInterval = setInterval(async () => {
      try {
        await this.performFullSync();
      } catch (error) {
        logger.error('❌ Erro na sincronização automática:', error);
      }
    }, this.syncConfig.interval);

    logger.info(`🔄 Sincronização automática iniciada a cada ${this.syncConfig.interval / 1000} segundos`);
  }

  // Parar sincronização automática
  stopAutoSync() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
      logger.info('⏹️ Sincronização automática parada');
    }
  }

  // Sincronização completa
  async performFullSync() {
    try {
      logger.info('🔄 Iniciando sincronização completa...');
      
      const startTime = Date.now();
      
      // Sincronizar motoristas
      const driversSynced = await this.syncDrivers();
      
      // Sincronizar documentos
      const documentsSynced = await this.syncDocuments();
      
      // Sincronizar status
      const statusSynced = await this.syncStatuses();
      
      // Sincronizar notificações
      const notificationsSynced = await this.syncNotifications();
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      logger.info(`✅ Sincronização completa concluída em ${duration}ms:`);
      logger.info(`   - Motoristas: ${driversSynced}`);
      logger.info(`   - Documentos: ${documentsSynced}`);
      logger.info(`   - Status: ${statusSynced}`);
      logger.info(`   - Notificações: ${notificationsSynced}`);
      
      return {
        drivers: driversSynced,
        documents: documentsSynced,
        statuses: statusSynced,
        notifications: notificationsSynced,
        duration
      };
      
    } catch (error) {
      logger.error('❌ Erro na sincronização completa:', error);
      throw error;
    }
  }

  // Sincronizar motoristas
  async syncDrivers() {
    try {
      const driversRef = admin.firestore().collection('users');
      const snapshot = await driversRef
        .where('userType', '==', 'driver')
        .get();

      let syncedCount = 0;
      
      for (const doc of snapshot.docs) {
        const driverData = doc.data();
        const driverId = doc.id;
        
        try {
          // Verificar se já existe no Redis
          const existingApproval = await this.redis.get(`driver_approval_index:${driverId}`);
          
          if (!existingApproval) {
            // Buscar dados completos
            const completeData = await this.getCompleteDriverData(driverId);
            
            if (completeData) {
              // Criar solicitação de aprovação
              await this.createApprovalRequest(completeData);
              syncedCount++;
            }
          } else {
            // Atualizar dados existentes
            await this.updateExistingApproval(driverId, driverData);
            syncedCount++;
          }
        } catch (error) {
          logger.error(`❌ Erro ao sincronizar motorista ${driverId}:`, error);
        }
      }
      
      logger.info(`✅ ${syncedCount} motoristas sincronizados`);
      return syncedCount;
      
    } catch (error) {
      logger.error('❌ Erro ao sincronizar motoristas:', error);
      return 0;
    }
  }

  // Sincronizar documentos
  async syncDocuments() {
    try {
      const documentsRef = admin.firestore().collection('driverDocuments');
      const snapshot = await documentsRef.get();

      let syncedCount = 0;
      
      for (const doc of snapshot.docs) {
        const documentData = doc.data();
        const documentId = doc.id;
        
        try {
          // Verificar se documento existe no Redis
          const approvalId = await this.redis.get(`driver_approval_index:${documentData.driverId}`);
          
          if (approvalId) {
            // Atualizar documento na aprovação
            await this.updateDocumentInApproval(approvalId, documentData);
            syncedCount++;
          }
        } catch (error) {
          logger.error(`❌ Erro ao sincronizar documento ${documentId}:`, error);
        }
      }
      
      logger.info(`✅ ${syncedCount} documentos sincronizados`);
      return syncedCount;
      
    } catch (error) {
      logger.error('❌ Erro ao sincronizar documentos:', error);
      return 0;
    }
  }

  // Sincronizar status
  async syncStatuses() {
    try {
      const usersRef = admin.firestore().collection('users');
      const snapshot = await usersRef
        .where('userType', '==', 'driver')
        .get();

      let syncedCount = 0;
      
      for (const doc of snapshot.docs) {
        const userData = doc.data();
        const userId = doc.id;
        
        try {
          const approvalId = await this.redis.get(`driver_approval_index:${userId}`);
          
          if (approvalId) {
            // Atualizar status na aprovação
            await this.updateStatusInApproval(approvalId, userData.status);
            syncedCount++;
          }
        } catch (error) {
          logger.error(`❌ Erro ao sincronizar status do usuário ${userId}:`, error);
        }
      }
      
      logger.info(`✅ ${syncedCount} status sincronizados`);
      return syncedCount;
      
    } catch (error) {
      logger.error('❌ Erro ao sincronizar status:', error);
      return 0;
    }
  }

  // Sincronizar notificações
  async syncNotifications() {
    try {
      const notificationsRef = admin.firestore().collection('notificationHistory');
      const snapshot = await notificationsRef
        .orderBy('timestamp', 'desc')
        .limit(1000) // Limitar a 1000 notificações mais recentes
        .get();

      let syncedCount = 0;
      
      for (const doc of snapshot.docs) {
        const notificationData = doc.data();
        
        try {
          // Salvar no Redis para cache rápido
          const cacheKey = `notification:${doc.id}`;
          await this.redis.setex(cacheKey, 24 * 60 * 60, JSON.stringify(notificationData)); // 24 horas
          syncedCount++;
        } catch (error) {
          logger.error(`❌ Erro ao sincronizar notificação ${doc.id}:`, error);
        }
      }
      
      logger.info(`✅ ${syncedCount} notificações sincronizadas`);
      return syncedCount;
      
    } catch (error) {
      logger.error('❌ Erro ao sincronizar notificações:', error);
      return 0;
    }
  }

  // Buscar dados completos do motorista
  async getCompleteDriverData(driverId) {
    try {
      const userRef = admin.firestore().collection('users').doc(driverId);
      const userDoc = await userRef.get();

      if (!userDoc.exists) {
        return null;
      }

      const userData = userDoc.data();

      // Buscar documentos
      const documentsRef = admin.firestore().collection('driverDocuments');
      const documentsSnapshot = await documentsRef
        .where('driverId', '==', driverId)
        .get();

      const documents = [];
      documentsSnapshot.forEach(doc => {
        documents.push({
          id: doc.id,
          ...doc.data()
        });
      });

      // Buscar dados do veículo
      const vehicleRef = admin.firestore().collection('driverVehicles').doc(driverId);
      const vehicleDoc = await vehicleRef.get();
      const vehicleData = vehicleDoc.exists ? vehicleDoc.data() : {};

      return {
        driverId,
        name: userData.name || userData.displayName,
        email: userData.email,
        phone: userData.phoneNumber,
        dateOfBirth: userData.dateOfBirth,
        address: userData.address,
        vehicle: vehicleData,
        documents: documents,
        license: userData.license || {}
      };
      
    } catch (error) {
      logger.error(`❌ Erro ao buscar dados completos do motorista ${driverId}:`, error);
      return null;
    }
  }

  // Criar solicitação de aprovação
  async createApprovalRequest(driverData) {
    try {
      const approvalId = `approval_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      const approvalRequest = {
        id: approvalId,
        driverId: driverData.driverId,
        status: 'pending',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        driver: {
          name: driverData.name,
          email: driverData.email,
          phone: driverData.phone,
          dateOfBirth: driverData.dateOfBirth,
          address: driverData.address
        },
        vehicle: driverData.vehicle,
        documents: driverData.documents,
        approvalHistory: [],
        notes: [],
        approvalCriteria: {
          ageCheck: this.checkAge(driverData.dateOfBirth),
          licenseCheck: this.checkLicense(driverData.license),
          vehicleCheck: this.checkVehicle(driverData.vehicle),
          documentCheck: this.checkRequiredDocuments(driverData.documents)
        },
        approvalScore: 0,
        validationFlags: {
          documentsComplete: false,
          ageRequirement: false,
          licenseValid: false,
          vehicleSuitable: false
        }
      };

      // Salvar no Redis
      await this.redis.setex(
        `driver_approval:${approvalId}`, 
        30 * 24 * 60 * 60, // 30 dias
        JSON.stringify(approvalRequest)
      );

      // Adicionar índices
      await this.redis.lpush('pending_approvals', approvalId);
      await this.redis.sadd('approvals_by_status:pending', approvalId);
      await this.redis.set(`driver_approval_index:${driverData.driverId}`, approvalId);

      logger.info(`✅ Solicitação de aprovação criada para ${driverData.driverId}`);
      return approvalId;
      
    } catch (error) {
      logger.error('❌ Erro ao criar solicitação de aprovação:', error);
      throw error;
    }
  }

  // Atualizar aprovação existente
  async updateExistingApproval(driverId, userData) {
    try {
      const approvalId = await this.redis.get(`driver_approval_index:${driverId}`);
      if (!approvalId) return;

      const approvalData = await this.redis.get(`driver_approval:${approvalId}`);
      if (!approvalData) return;

      const approval = JSON.parse(approvalData);
      
      // Atualizar dados do motorista
      approval.driver = {
        ...approval.driver,
        name: userData.name || userData.displayName,
        email: userData.email,
        phone: userData.phoneNumber
      };

      approval.updatedAt = new Date().toISOString();

      // Salvar atualização
      await this.redis.setex(
        `driver_approval:${approvalId}`, 
        30 * 24 * 60 * 60,
        JSON.stringify(approval)
      );

      logger.info(`✅ Aprovação existente atualizada para ${driverId}`);
      
    } catch (error) {
      logger.error(`❌ Erro ao atualizar aprovação existente para ${driverId}:`, error);
    }
  }

  // Atualizar documento na aprovação
  async updateDocumentInApproval(approvalId, documentData) {
    try {
      const approvalData = await this.redis.get(`driver_approval:${approvalId}`);
      if (!approvalData) return;

      const approval = JSON.parse(approvalData);
      
      // Verificar se documento já existe
      const existingDocIndex = approval.documents.findIndex(d => d.id === documentData.id);
      
      if (existingDocIndex >= 0) {
        // Atualizar documento existente
        approval.documents[existingDocIndex] = {
          ...approval.documents[existingDocIndex],
          ...documentData
        };
      } else {
        // Adicionar novo documento
        approval.documents.push(documentData);
      }

      // Recalcular critérios
      approval.approvalCriteria.documentCheck = this.checkRequiredDocuments(approval.documents);
      approval.validationFlags.documentsComplete = this.areDocumentsComplete(approval.documents);

      approval.updatedAt = new Date().toISOString();

      // Salvar atualização
      await this.redis.setex(
        `driver_approval:${approvalId}`, 
        30 * 24 * 60 * 60,
        JSON.stringify(approval)
      );

      logger.info(`✅ Documento ${documentData.id} atualizado na aprovação ${approvalId}`);
      
    } catch (error) {
      logger.error(`❌ Erro ao atualizar documento na aprovação ${approvalId}:`, error);
    }
  }

  // Atualizar status na aprovação
  async updateStatusInApproval(approvalId, newStatus) {
    try {
      const approvalData = await this.redis.get(`driver_approval:${approvalId}`);
      if (!approvalData) return;

      const approval = JSON.parse(approvalData);
      const oldStatus = approval.status;
      
      if (oldStatus === newStatus) return;

      // Atualizar status
      approval.status = newStatus;
      approval.updatedAt = new Date().toISOString();

      // Atualizar índices
      await this.redis.srem(`approvals_by_status:${oldStatus}`, approvalId);
      await this.redis.sadd(`approvals_by_status:${newStatus}`, approvalId);

      // Remover da lista de pendentes se aprovado/rejeitado
      if (newStatus === 'approved' || newStatus === 'rejected') {
        await this.redis.lrem('pending_approvals', 0, approvalId);
      }

      // Salvar atualização
      await this.redis.setex(
        `driver_approval:${approvalId}`, 
        30 * 24 * 60 * 60,
        JSON.stringify(approval)
      );

      logger.info(`✅ Status da aprovação ${approvalId} atualizado: ${oldStatus} → ${newStatus}`);
      
    } catch (error) {
      logger.error(`❌ Erro ao atualizar status da aprovação ${approvalId}:`, error);
    }
  }

  // Métodos auxiliares (copiados do DriverApprovalService)
  checkAge(dateOfBirth) {
    if (!dateOfBirth) return { age: 0, isValid: false, requirement: 21 };
    
    const birthDate = new Date(dateOfBirth);
    const today = new Date();
    const age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    
    return {
      age,
      isValid: age >= 21,
      requirement: 21
    };
  }

  checkLicense(licenseData) {
    if (!licenseData || !licenseData.issueDate) {
      return { yearsHeld: 0, isValid: false, requirement: 2 };
    }
    
    const issueDate = new Date(licenseData.issueDate);
    const today = new Date();
    const yearsHeld = today.getFullYear() - issueDate.getFullYear();
    
    return {
      yearsHeld,
      isValid: yearsHeld >= 2,
      requirement: 2,
      expiresAt: licenseData.expiryDate
    };
  }

  checkVehicle(vehicleData) {
    if (!vehicleData || !vehicleData.year) {
      return { year: 0, isValid: false, requirement: 2010 };
    }
    
    return {
      year: vehicleData.year,
      isValid: vehicleData.year >= 2010,
      requirement: 2010
    };
  }

  checkRequiredDocuments(documents) {
    const required = ['driver_license', 'vehicle_registration', 'insurance'];
    const uploaded = documents.map(d => d.type);
    
    const missing = required.filter(doc => !uploaded.includes(doc));
    const uploadedDocs = required.filter(doc => uploaded.includes(doc));
    
    return {
      required,
      uploaded: uploadedDocs,
      missing,
      isComplete: missing.length === 0
    };
  }

  areDocumentsComplete(documents) {
    const required = ['driver_license', 'vehicle_registration', 'insurance'];
    const uploaded = documents.map(d => d.type);
    
    return required.every(doc => uploaded.includes(doc));
  }

  // Obter estatísticas de sincronização
  async getSyncStats() {
    try {
      const stats = {
        lastSync: null,
        totalSyncs: 0,
        averageDuration: 0,
        lastError: null,
        isRunning: !!this.syncInterval
      };

      // Buscar estatísticas do Redis
      const lastSyncData = await this.redis.get('sync:last_sync');
      if (lastSyncData) {
        stats.lastSync = JSON.parse(lastSyncData);
      }

      const totalSyncs = await this.redis.get('sync:total_syncs');
      if (totalSyncs) {
        stats.totalSyncs = parseInt(totalSyncs);
      }

      const avgDuration = await this.redis.get('sync:average_duration');
      if (avgDuration) {
        stats.averageDuration = parseFloat(avgDuration);
      }

      const lastError = await this.redis.get('sync:last_error');
      if (lastError) {
        stats.lastError = JSON.parse(lastError);
      }

      return stats;
      
    } catch (error) {
      logger.error('❌ Erro ao obter estatísticas de sincronização:', error);
      return {};
    }
  }

  // Forçar sincronização manual
  async forceSync() {
    try {
      logger.info('🔄 Sincronização manual forçada...');
      const result = await this.performFullSync();
      
      // Salvar estatísticas
      const now = new Date();
      await this.redis.set('sync:last_sync', JSON.stringify({
        timestamp: now.toISOString(),
        result: result
      }));
      
      const totalSyncs = await this.redis.get('sync:total_syncs') || 0;
      await this.redis.set('sync:total_syncs', parseInt(totalSyncs) + 1);
      
      return result;
      
    } catch (error) {
      logger.error('❌ Erro na sincronização manual:', error);
      
      // Salvar erro
      await this.redis.set('sync:last_error', JSON.stringify({
        timestamp: new Date().toISOString(),
        error: error.message
      }));
      
      throw error;
    }
  }

  destroy() {
    this.stopAutoSync();
    this.isInitialized = false;
    logger.info('🗑️ Sync Service destruído');
  }
}

module.exports = SyncService;
