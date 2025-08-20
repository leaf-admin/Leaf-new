const Redis = require('ioredis');
const admin = require('firebase-admin');
const { logger } = require('../utils/logger');
const DriverNotificationService = require('./driver-notification-service');

const APPROVAL_CONFIG = {
  statuses: {
    PENDING: 'pending',
    UNDER_REVIEW: 'under_review', 
    APPROVED: 'approved',
    REJECTED: 'rejected',
    SUSPENDED: 'suspended',
    BLOCKED: 'blocked'
  },
  
  documentTypes: {
    DRIVER_LICENSE: 'driver_license',
    VEHICLE_REGISTRATION: 'vehicle_registration',
    INSURANCE: 'insurance',
    BACKGROUND_CHECK: 'background_check',
    VEHICLE_INSPECTION: 'vehicle_inspection',
    ID_DOCUMENT: 'id_document'
  },
  
  approvalCriteria: {
    MIN_AGE: 21,
    MIN_LICENSE_YEARS: 2,
    REQUIRED_DOCUMENTS: ['driver_license', 'vehicle_registration', 'insurance'],
    MAX_CRIMINAL_RECORDS: 0,
    MIN_VEHICLE_YEAR: 2010
  }
};

class DriverApprovalService {
  constructor() {
    this.redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
    this.isInitialized = false;
    this.notificationService = new DriverNotificationService();
  }

  async initialize() {
    try {
      await this.redis.ping();
      await this.notificationService.initialize();
      this.isInitialized = true;
      logger.info('✅ Driver Approval Service inicializado');
    } catch (error) {
      logger.error('❌ Erro ao inicializar Driver Approval Service:', error);
      throw error;
    }
  }

  async createApprovalRequest(driverData) {
    try {
      const approvalId = `approval_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      const approvalRequest = {
        id: approvalId,
        driverId: driverData.driverId,
        status: APPROVAL_CONFIG.statuses.PENDING,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        
        driver: {
          name: driverData.name,
          email: driverData.email,
          phone: driverData.phone,
          dateOfBirth: driverData.dateOfBirth,
          address: driverData.address
        },
        
        vehicle: {
          make: driverData.vehicle.make,
          model: driverData.vehicle.model,
          year: driverData.vehicle.year,
          color: driverData.vehicle.color,
          plate: driverData.vehicle.plate
        },
        
        documents: driverData.documents || [],
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
      
      await this.redis.setex(
        `driver_approval:${approvalId}`, 
        30 * 24 * 60 * 60,
        JSON.stringify(approvalRequest)
      );
      
      await this.redis.lpush('pending_approvals', approvalId);
      await this.redis.sadd(`approvals_by_status:${approvalRequest.status}`, approvalId);
      await this.redis.set(`driver_approval_index:${driverData.driverId}`, approvalId);
      
      logger.info(`✅ Solicitação de aprovação criada: ${approvalId}`);
      return approvalRequest;
      
    } catch (error) {
      logger.error('❌ Erro ao criar solicitação:', error);
      throw error;
    }
  }

  async getApprovalRequest(approvalId) {
    try {
      const data = await this.redis.get(`driver_approval:${approvalId}`);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      logger.error('❌ Erro ao buscar aprovação:', error);
      return null;
    }
  }

  async getApprovalsByStatus(status, page = 0, limit = 20) {
    try {
      const ids = await this.redis.smembers(`approvals_by_status:${status}`);
      const start = page * limit;
      const end = start + limit - 1;
      const paginatedIds = ids.slice(start, end + 1);
      
      const approvals = [];
      for (const id of paginatedIds) {
        const approval = await this.getApprovalRequest(id);
        if (approval) approvals.push(approval);
      }
      
      return {
        approvals,
        total: ids.length,
        page,
        limit,
        hasMore: end + 1 < ids.length
      };
    } catch (error) {
      logger.error('❌ Erro ao buscar aprovações:', error);
      return { approvals: [], total: 0, page, limit, hasMore: false };
    }
  }

  async updateApprovalStatus(approvalId, newStatus, adminId, reason = '') {
    try {
      const approval = await this.getApprovalRequest(approvalId);
      if (!approval) throw new Error('Aprovação não encontrada');
      
      const oldStatus = approval.status;
      approval.status = newStatus;
      approval.updatedAt = new Date().toISOString();
      
      approval.approvalHistory.push({
        action: 'status_change',
        fromStatus: oldStatus,
        toStatus: newStatus,
        adminId,
        reason,
        timestamp: new Date().toISOString()
      });
      
      await this.redis.srem(`approvals_by_status:${oldStatus}`, approvalId);
      await this.redis.sadd(`approvals_by_status:${newStatus}`, approvalId);
      
      if (newStatus === APPROVAL_CONFIG.statuses.APPROVED || 
          newStatus === APPROVAL_CONFIG.statuses.REJECTED) {
        await this.redis.lrem('pending_approvals', 0, approvalId);
      }
      
      await this.redis.setex(
        `driver_approval:${approvalId}`, 
        30 * 24 * 60 * 60,
        JSON.stringify(approval)
      );
      
      logger.info(`✅ Status alterado: ${oldStatus} → ${newStatus}`);
      return approval;
      
    } catch (error) {
      logger.error('❌ Erro ao atualizar status:', error);
      throw error;
    }
  }

  async approveDriver(approvalId, adminId, reason = '') {
    try {
      const approval = await this.getApprovalRequest(approvalId);
      if (!approval) throw new Error('Aprovação não encontrada');
      
      if (!this.canBeApproved(approval)) {
        throw new Error('Não atende aos critérios de aprovação');
      }
      
      // Atualizar no Redis
      await this.updateApprovalStatus(
        approvalId, 
        APPROVAL_CONFIG.statuses.APPROVED, 
        adminId, 
        reason
      );
      
      // Atualizar no Firebase
      await this.updateDriverStatusInFirebase(approval.driverId, 'approved', adminId, reason);
      
      // Enviar notificação
      await this.notificationService.sendApprovalNotification(approval.driverId, 'approved', reason);
      
      logger.info(`✅ Motorista ${approval.driverId} aprovado`);
      return true;
      
    } catch (error) {
      logger.error('❌ Erro ao aprovar motorista:', error);
      throw error;
    }
  }

  async rejectDriver(approvalId, adminId, reason) {
    try {
      if (!reason) throw new Error('Motivo da rejeição é obrigatório');
      
      const approval = await this.getApprovalRequest(approvalId);
      if (!approval) throw new Error('Aprovação não encontrada');
      
      // Atualizar no Redis
      await this.updateApprovalStatus(
        approvalId, 
        APPROVAL_CONFIG.statuses.REJECTED, 
        adminId, 
        reason
      );
      
      // Atualizar no Firebase
      await this.updateDriverStatusInFirebase(approval.driverId, 'rejected', adminId, reason);
      
      // Enviar notificação
      await this.notificationService.sendApprovalNotification(approval.driverId, 'rejected', reason);
      
      logger.info(`❌ Motorista rejeitado: ${reason}`);
      return true;
      
    } catch (error) {
      logger.error('❌ Erro ao rejeitar motorista:', error);
      throw error;
    }
  }

  // Métodos auxiliares
  checkAge(dateOfBirth) {
    const birthDate = new Date(dateOfBirth);
    const today = new Date();
    const age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    
    return {
      age,
      isValid: age >= APPROVAL_CONFIG.approvalCriteria.MIN_AGE,
      requirement: APPROVAL_CONFIG.approvalCriteria.MIN_AGE
    };
  }

  checkLicense(licenseData) {
    const issueDate = new Date(licenseData.issueDate);
    const today = new Date();
    const yearsHeld = today.getFullYear() - issueDate.getFullYear();
    
    return {
      yearsHeld,
      isValid: yearsHeld >= APPROVAL_CONFIG.approvalCriteria.MIN_LICENSE_YEARS,
      requirement: APPROVAL_CONFIG.approvalCriteria.MIN_LICENSE_YEARS,
      expiresAt: licenseData.expiryDate
    };
  }

  checkVehicle(vehicleData) {
    return {
      year: vehicleData.year,
      isValid: vehicleData.year >= APPROVAL_CONFIG.approvalCriteria.MIN_VEHICLE_YEAR,
      requirement: APPROVAL_CONFIG.approvalCriteria.MIN_VEHICLE_YEAR
    };
  }

  checkRequiredDocuments(documents) {
    const required = APPROVAL_CONFIG.approvalCriteria.REQUIRED_DOCUMENTS;
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

  canBeApproved(approval) {
    return (
      approval.approvalCriteria.ageCheck.isValid &&
      approval.approvalCriteria.licenseCheck.isValid &&
      approval.approvalCriteria.vehicleCheck.isValid &&
      approval.approvalCriteria.documentCheck.isComplete
    );
  }

  async getServiceStats() {
    try {
      const stats = {
        totalApprovals: 0,
        pendingApprovals: 0,
        approvedDrivers: 0,
        rejectedDrivers: 0,
        approvalRate: 0
      };
      
      for (const status of Object.values(APPROVAL_CONFIG.statuses)) {
        const count = await this.redis.scard(`approvals_by_status:${status}`);
        stats[`${status}Approvals`] = count;
        
        if (status === 'pending') stats.pendingApprovals = count;
        if (status === 'approved') stats.approvedDrivers = count;
        if (status === 'rejected') stats.rejectedDrivers = count;
      }
      
      stats.totalApprovals = stats.approvedDrivers + stats.rejectedDrivers + stats.pendingApprovals;
      
      if (stats.totalApprovals > 0) {
        stats.approvalRate = ((stats.approvedDrivers / stats.totalApprovals) * 100).toFixed(2);
      }
      
      return stats;
      
    } catch (error) {
      logger.error('❌ Erro ao obter estatísticas:', error);
      return {};
    }
  }

  // ===== MÉTODOS DE INTEGRAÇÃO FIREBASE =====

  // Buscar usuários motoristas do Firebase
  async fetchDriversFromFirebase() {
    try {
      const driversRef = admin.firestore().collection('users');
      const snapshot = await driversRef
        .where('userType', '==', 'driver')
        .where('status', '==', 'pending_approval')
        .get();

      const drivers = [];
      snapshot.forEach(doc => {
        drivers.push({
          id: doc.id,
          ...doc.data()
        });
      });

      return drivers;
    } catch (error) {
      logger.error('❌ Erro ao buscar motoristas do Firebase:', error);
      return [];
    }
  }

  // Buscar documentos do motorista do Firebase Storage
  async fetchDriverDocumentsFromFirebase(driverId) {
    try {
      const documentsRef = admin.firestore().collection('driverDocuments');
      const snapshot = await documentsRef
        .where('driverId', '==', driverId)
        .get();

      const documents = [];
      snapshot.forEach(doc => {
        documents.push({
          id: doc.id,
          ...doc.data()
        });
      });

      return documents;
    } catch (error) {
      logger.error('❌ Erro ao buscar documentos do motorista:', error);
      return [];
    }
  }

  // Buscar dados completos do motorista
  async fetchDriverDataFromFirebase(driverId) {
    try {
      const userRef = admin.firestore().collection('users').doc(driverId);
      const userDoc = await userRef.get();

      if (!userDoc.exists) {
        throw new Error('Motorista não encontrado');
      }

      const userData = userDoc.data();

      // Buscar documentos
      const documents = await this.fetchDriverDocumentsFromFirebase(driverId);

      // Buscar dados do veículo
      const vehicleRef = admin.firestore().collection('driverVehicles').doc(driverId);
      const vehicleDoc = await vehicleRef.get();
      const vehicleData = vehicleDoc.exists ? vehicleDoc.data() : {};

      return {
        ...userData,
        documents,
        vehicle: vehicleData
      };
    } catch (error) {
      logger.error('❌ Erro ao buscar dados do motorista:', error);
      return null;
    }
  }

  // Atualizar status do motorista no Firebase
  async updateDriverStatusInFirebase(driverId, status, adminId, reason = '') {
    try {
      const batch = admin.firestore().batch();

      // Atualizar status do usuário
      const userRef = admin.firestore().collection('users').doc(driverId);
      batch.update(userRef, {
        status: status,
        approvedAt: status === 'approved' ? admin.firestore.FieldValue.serverTimestamp() : null,
        rejectedAt: status === 'rejected' ? admin.firestore.FieldValue.serverTimestamp() : null,
        approvedBy: adminId,
        rejectionReason: status === 'rejected' ? reason : null,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
      });

      // Adicionar ao histórico de aprovações
      const approvalHistoryRef = admin.firestore().collection('approvalHistory').doc();
      batch.set(approvalHistoryRef, {
        driverId,
        adminId,
        status,
        reason,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        documents: await this.fetchDriverDocumentsFromFirebase(driverId)
      });

      // Se aprovado, ativar conta
      if (status === 'approved') {
        const authUser = await admin.auth().getUser(driverId);
        if (authUser) {
          await admin.auth().setCustomUserClaims(driverId, {
            approved: true,
            role: 'driver'
          });
        }
      }

      await batch.commit();
      logger.info(`✅ Status do motorista ${driverId} atualizado para ${status} no Firebase`);
      return true;
    } catch (error) {
      logger.error('❌ Erro ao atualizar status do motorista no Firebase:', error);
      throw error;
    }
  }

  // Buscar documentos do Firebase Storage
  async getDocumentDownloadURL(documentId) {
    try {
      const bucket = admin.storage().bucket();
      const file = bucket.file(`driver-documents/${documentId}`);
      
      const [url] = await file.getSignedUrl({
        action: 'read',
        expires: Date.now() + 15 * 60 * 1000 // 15 minutos
      });

      return url;
    } catch (error) {
      logger.error('❌ Erro ao gerar URL de download:', error);
      return null;
    }
  }

  // Verificar documento no Firebase
  async verifyDocumentInFirebase(documentId, verified, adminId, notes = '') {
    try {
      const docRef = admin.firestore().collection('driverDocuments').doc(documentId);
      await docRef.update({
        verified,
        verifiedBy: adminId,
        verifiedAt: admin.firestore.FieldValue.serverTimestamp(),
        verificationNotes: notes
      });

      logger.info(`✅ Documento ${documentId} verificado: ${verified}`);
      return true;
    } catch (error) {
      logger.error('❌ Erro ao verificar documento:', error);
      throw error;
    }
  }

  // Sincronizar dados do Firebase com Redis
  async syncFirebaseData() {
    try {
      logger.info('🔄 Iniciando sincronização com Firebase...');
      
      // Buscar motoristas pendentes do Firebase
      const firebaseDrivers = await this.fetchDriversFromFirebase();
      
      for (const driver of firebaseDrivers) {
        // Buscar dados completos
        const driverData = await this.fetchDriverDataFromFirebase(driver.id);
        if (!driverData) continue;
        
        // Verificar se já existe no Redis
        const existingApproval = await this.redis.get(`driver_approval_index:${driver.id}`);
        
        if (!existingApproval) {
          // Criar nova solicitação de aprovação
          await this.createApprovalRequest({
            driverId: driver.id,
            name: driverData.name || driverData.displayName,
            email: driverData.email,
            phone: driverData.phoneNumber,
            dateOfBirth: driverData.dateOfBirth,
            address: driverData.address,
            vehicle: driverData.vehicle || {},
            documents: driverData.documents || [],
            license: driverData.license || {}
          });
          
          logger.info(`✅ Motorista ${driver.id} sincronizado do Firebase`);
        }
      }
      
      logger.info(`✅ Sincronização concluída: ${firebaseDrivers.length} motoristas processados`);
      return firebaseDrivers.length;
      
    } catch (error) {
      logger.error('❌ Erro na sincronização com Firebase:', error);
      throw error;
    }
  }

  // Métodos simulados para Firebase (implementar conforme necessário)
  async fetchPromosFromFirebase(filters, page, limit) {
    // TODO: Implementar busca real no Firebase
    return [];
  }

  async fetchPromoByCodeFromFirebase(code) {
    // TODO: Implementar busca real no Firebase
    return null;
  }

  async fetchPromoByIdFromFirebase(promoId) {
    // TODO: Implementar busca real no Firebase
    return null;
  }

  destroy() {
    this.isInitialized = false;
    logger.info('🗑️ Driver Approval Service destruído');
  }
}

module.exports = DriverApprovalService;
