// Configuração para o sistema de veículos
// Estrutura recomendada: Firestore como principal, com validações e regras de negócio

import { firebase } from './configureFirebase';

// Estrutura da coleção de veículos no Firestore
export const VEHICLE_COLLECTION = 'vehicles';

// Status possíveis para um veículo
export const VEHICLE_STATUS = {
    PENDING: 'pending',           // Em análise
    APPROVED: 'approved',         // Aprovado
    REJECTED: 'rejected',         // Rejeitado
    NEEDS_INFO: 'needs_info',     // Precisa de informações adicionais
    INACTIVE: 'inactive',         // Inativo
};

// Status de uso do veículo
export const VEHICLE_USAGE_STATUS = {
    AVAILABLE: 'available',       // Disponível para uso
    IN_USE: 'in_use',            // Em uso por um motorista
    MAINTENANCE: 'maintenance',   // Em manutenção
    OFF_DUTY: 'off_duty',        // Fora de serviço
};

// Estrutura de dados do veículo
export const VEHICLE_SCHEMA = {
    // Identificação
    id: 'string',                 // ID único do veículo
    driverId: 'string',           // ID do motorista proprietário
    
    // Informações básicas
    brand: 'string',              // Marca (ex: Toyota)
    model: 'string',              // Modelo (ex: Corolla)
    year: 'string',               // Ano (ex: 2020)
    plate: 'string',              // Placa (ex: ABC-1234)
    
    // Documentação
    crlvImage: 'string',          // URL da imagem do CRLV
    crlvVerified: 'boolean',      // CRLV verificado pela equipe
    
    // Status
    status: 'string',             // Status de aprovação (VEHICLE_STATUS)
    usageStatus: 'string',        // Status de uso (VEHICLE_USAGE_STATUS)
    isActive: 'boolean',          // Se está ativo para o motorista
    
    // Metadados
    createdAt: 'timestamp',       // Data de criação
    updatedAt: 'timestamp',       // Data da última atualização
    approvedAt: 'timestamp',      // Data de aprovação
    approvedBy: 'string',         // ID do admin que aprovou
    rejectionReason: 'string',    // Motivo da rejeição (se aplicável)
    
    // Informações adicionais
    notes: 'string',              // Observações da equipe
    lastMaintenance: 'timestamp', // Última manutenção
    nextMaintenance: 'timestamp', // Próxima manutenção prevista
};

// Funções de acesso ao Firestore
export const vehicleFirestore = {
    // Referência para a coleção de veículos
    collection: () => firebase.firestore?.collection(VEHICLE_COLLECTION),
    
    // Referência para um veículo específico
    doc: (vehicleId) => firebase.firestore?.collection(VEHICLE_COLLECTION).doc(vehicleId),
    
    // Referência para veículos de um motorista
    driverVehicles: (driverId) => firebase.firestore?.collection(VEHICLE_COLLECTION)
        .where('driverId', '==', driverId)
        .orderBy('createdAt', 'desc'),
    
    // Referência para veículos por status
    byStatus: (status) => firebase.firestore?.collection(VEHICLE_COLLECTION)
        .where('status', '==', status),
    
    // Referência para veículos por placa (para verificação de duplicação)
    byPlate: (plate) => firebase.firestore?.collection(VEHICLE_COLLECTION)
        .where('plate', '==', plate.toUpperCase()),
    
    // Referência para veículos ativos
    activeVehicles: () => firebase.firestore?.collection(VEHICLE_COLLECTION)
        .where('isActive', '==', true)
        .where('status', '==', VEHICLE_STATUS.APPROVED),
};

// Funções de validação
export const vehicleValidation = {
    // Validar formato de placa brasileira
    validatePlate: (plate) => {
        const plateRegex = /^[A-Z]{3}[0-9][0-9A-Z][0-9]{2}$/;
        return plateRegex.test(plate.replace(/[^A-Z0-9]/g, ''));
    },
    
    // Validar ano do veículo
    validateYear: (year) => {
        const currentYear = new Date().getFullYear();
        const yearNum = parseInt(year);
        return yearNum >= 1990 && yearNum <= currentYear + 1;
    },
    
    // Validar dados obrigatórios
    validateVehicleData: (vehicleData) => {
        const errors = {};
        
        if (!vehicleData.brand?.trim()) {
            errors.brand = 'Marca é obrigatória';
        }
        
        if (!vehicleData.model?.trim()) {
            errors.model = 'Modelo é obrigatório';
        }
        
        if (!vehicleData.year?.trim()) {
            errors.year = 'Ano é obrigatório';
        } else if (!vehicleValidation.validateYear(vehicleData.year)) {
            errors.year = 'Ano inválido';
        }
        
        if (!vehicleData.plate?.trim()) {
            errors.plate = 'Placa é obrigatória';
        } else if (!vehicleValidation.validatePlate(vehicleData.plate)) {
            errors.plate = 'Formato de placa inválido';
        }
        
        if (!vehicleData.crlvImage?.trim()) {
            errors.crlvImage = 'Foto do CRLV é obrigatória';
        }
        
        return {
            isValid: Object.keys(errors).length === 0,
            errors
        };
    },
};

// Funções de negócio
export const vehicleBusinessLogic = {
    // Verificar se a placa já está em uso
    checkPlateAvailability: async (plate, excludeVehicleId = null) => {
        try {
            let query = vehicleFirestore.byPlate(plate);
            
            if (excludeVehicleId) {
                query = query.where('id', '!=', excludeVehicleId);
            }
            
            const snapshot = await query.get();
            return snapshot.empty; // true se a placa estiver disponível
        } catch (error) {
            console.error('Erro ao verificar disponibilidade da placa:', error);
            return false;
        }
    },
    
    // Verificar limite de veículos por motorista
    checkVehicleLimit: async (driverId, limit = 5) => {
        try {
            const snapshot = await vehicleFirestore.driverVehicles(driverId).get();
            return snapshot.size < limit;
        } catch (error) {
            console.error('Erro ao verificar limite de veículos:', error);
            return false;
        }
    },
    
    // Atualizar status de uso do veículo
    updateUsageStatus: async (vehicleId, usageStatus, driverId = null) => {
        try {
            const updateData = {
                usageStatus,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            };
            
            // Se o veículo está em uso, registrar o motorista
            if (usageStatus === VEHICLE_USAGE_STATUS.IN_USE && driverId) {
                updateData.currentDriverId = driverId;
            } else if (usageStatus !== VEHICLE_USAGE_STATUS.IN_USE) {
                updateData.currentDriverId = null;
            }
            
            await vehicleFirestore.doc(vehicleId).update(updateData);
            return true;
        } catch (error) {
            console.error('Erro ao atualizar status de uso:', error);
            return false;
        }
    },
    
    // Aprovar veículo
    approveVehicle: async (vehicleId, approvedBy) => {
        try {
            await vehicleFirestore.doc(vehicleId).update({
                status: VEHICLE_STATUS.APPROVED,
                approvedAt: firebase.firestore.FieldValue.serverTimestamp(),
                approvedBy,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            });
            return true;
        } catch (error) {
            console.error('Erro ao aprovar veículo:', error);
            return false;
        }
    },
    
    // Rejeitar veículo
    rejectVehicle: async (vehicleId, reason, rejectedBy) => {
        try {
            await vehicleFirestore.doc(vehicleId).update({
                status: VEHICLE_STATUS.REJECTED,
                rejectionReason: reason,
                rejectedAt: firebase.firestore.FieldValue.serverTimestamp(),
                rejectedBy,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            });
            return true;
        } catch (error) {
            console.error('Erro ao rejeitar veículo:', error);
            return false;
        }
    },
    
    // Solicitar informações adicionais
    requestMoreInfo: async (vehicleId, notes, requestedBy) => {
        try {
            await vehicleFirestore.doc(vehicleId).update({
                status: VEHICLE_STATUS.NEEDS_INFO,
                notes,
                requestedAt: firebase.firestore.FieldValue.serverTimestamp(),
                requestedBy,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            });
            return true;
        } catch (error) {
            console.error('Erro ao solicitar informações:', error);
            return false;
        }
    },
};

// Funções de consulta
export const vehicleQueries = {
    // Buscar veículos de um motorista
    getDriverVehicles: async (driverId) => {
        try {
            const snapshot = await vehicleFirestore.driverVehicles(driverId).get();
            return snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
        } catch (error) {
            console.error('Erro ao buscar veículos do motorista:', error);
            return [];
        }
    },
    
    // Buscar veículo por ID
    getVehicleById: async (vehicleId) => {
        try {
            const doc = await vehicleFirestore.doc(vehicleId).get();
            if (doc.exists) {
                return {
                    id: doc.id,
                    ...doc.data()
                };
            }
            return null;
        } catch (error) {
            console.error('Erro ao buscar veículo:', error);
            return null;
        }
    },
    
    // Buscar veículos por status
    getVehiclesByStatus: async (status) => {
        try {
            const snapshot = await vehicleFirestore.byStatus(status).get();
            return snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
        } catch (error) {
            console.error('Erro ao buscar veículos por status:', error);
            return [];
        }
    },
    
    // Buscar veículos pendentes de aprovação
    getPendingVehicles: async () => {
        return vehicleQueries.getVehiclesByStatus(VEHICLE_STATUS.PENDING);
    },
    
    // Buscar veículos aprovados
    getApprovedVehicles: async () => {
        return vehicleQueries.getVehiclesByStatus(VEHICLE_STATUS.APPROVED);
    },
};

export default {
    VEHICLE_COLLECTION,
    VEHICLE_STATUS,
    VEHICLE_USAGE_STATUS,
    VEHICLE_SCHEMA,
    vehicleFirestore,
    vehicleValidation,
    vehicleBusinessLogic,
    vehicleQueries,
}; 