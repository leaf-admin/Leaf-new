import Logger from '../utils/Logger';
import database from '@react-native-firebase/database';
import storage from '@react-native-firebase/storage';
import auth from '@react-native-firebase/auth';
import { Platform, Alert } from 'react-native';
import VehicleNotificationService from './VehicleNotificationService';


class VehicleService {
    constructor() {
        this.VEHICLES_PATH = 'vehicles';
        this.USER_VEHICLES_PATH = 'user_vehicles';
        this.USERS_PATH = 'users';
    }

    /**
     * Registrar veículo para um usuário
     * @param {Object} vehicleData - Dados do veículo
     * @param {string} vehicleData.plate - Placa do veículo
     * @param {string} vehicleData.brand - Marca do veículo
     * @param {string} vehicleData.model - Modelo do veículo
     * @param {number} vehicleData.year - Ano do veículo
     * @param {string} vehicleData.color - Cor do veículo (ex: BRANCO, PRETO)
     * @param {string} vehicleData.vehicleType - Tipo do veículo (carro ou moto)
     * @param {string} vehicleData.vin - VIN do veículo (opcional)
     * @param {Object} documents - Documentos do veículo
     * @param {string} documents.crlv - URI da imagem do CRLV
     * @returns {Promise<Object>} Resultado da operação
     */
    async registerVehicleForUser(vehicleData, documents = {}, structuredData = null) {
        try {
            const user = auth().currentUser;
            if (!user) {
                throw new Error('Usuário não autenticado');
            }

            const userId = user.uid;

            // Limite operacional: máximo de 4 veículos por motorista.
            const currentUserVehicles = await this.getUserVehicles(userId);
            if (currentUserVehicles.length >= 4) {
                throw new Error('Limite de 4 veículos por perfil atingido');
            }

            // 1. Verificar se veículo já existe no sistema
            let vehicleId;
            let existingVehicle = await this.getVehicleByPlate(vehicleData.plate);
            
            if (existingVehicle) {
                // Veículo existe - usar o existente
                vehicleId = existingVehicle.id;
                Logger.log('ℹ️ Veículo existente encontrado:', vehicleId);
            } else {
                // Veículo não existe - criar novo
                const newVehicleId = await this.createVehicle(vehicleData);
                if (!newVehicleId) {
                    throw new Error('Erro ao criar veículo no sistema');
                }
                vehicleId = newVehicleId;
                Logger.log('✅ Novo veículo criado:', vehicleId);
            }

            // 2. Verificar se usuário já tem este veículo cadastrado
            const existingUserVehicle = await this.getUserVehicle(userId, vehicleId);
            if (existingUserVehicle) {
                throw new Error('Usuário já possui este veículo cadastrado');
            }

            // 3. Verificar se veículo já está ativo com outro motorista
            const activeUserVehicle = await this.getActiveUserVehicleByVehicle(vehicleId);
            if (activeUserVehicle) {
                throw new Error(`Veículo já está ativo com motorista ${activeUserVehicle.userId}`);
            }

            // 4. Upload dos documentos para Firebase Storage
            const uploadedDocuments = {};
            for (const [docType, uri] of Object.entries(documents)) {
                if (uri) {
                    try {
                        const downloadURL = await this.uploadDocument(vehicleId, userId, docType, uri);
                        uploadedDocuments[docType] = downloadURL;
                    } catch (error) {
                        Logger.error(`Erro ao fazer upload do documento ${docType}:`, error);
                        throw new Error(`Erro ao fazer upload do documento ${docType}`);
                    }
                }
            }

            // 5. Criar relacionamento usuário-veículo
            const userVehicleId = `${userId}_${vehicleId}_${Date.now()}`;
            const userVehicleRef = database().ref(`${this.USER_VEHICLES_PATH}/${userId}/${userVehicleId}`);
            
            const userVehicle = {
                id: userVehicleId,
                userId,
                vehicleId,
                status: 'pending',
                isActive: false, // Inativo até aprovação
                documents: uploadedDocuments,
                possessionDate: new Date().toISOString(),
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            await userVehicleRef.set(userVehicle);
            
            // 6. Se houver dados estruturados (OCR), enviar ao backend
            if (structuredData && structuredData.vehicleData) {
                try {
                    await this.sendStructuredDataToBackend(vehicleId, userId, structuredData);
                } catch (error) {
                    Logger.error('⚠️ Erro ao enviar dados estruturados ao backend:', error);
                    // Não falhar o registro se o envio ao backend falhar
                }
            }
            
            // Inicializar notificações de veículos se não estiver inicializado
            if (!VehicleNotificationService.isServiceInitialized()) {
                try {
                    // ✅ Verificar se usuário está autenticado antes de inicializar
                    const auth = require('@react-native-firebase/auth').default;
                    const currentUser = auth().currentUser;
                    if (currentUser) {
                        await VehicleNotificationService.initialize();
                    } else {
                        Logger.log('ℹ️ [VehicleService] Usuário não autenticado, pulando inicialização de notificações');
                    }
                } catch (error) {
                    // ✅ Não mostrar erro crítico, apenas log informativo
                    Logger.log('ℹ️ [VehicleService] Notificações de veículos não disponíveis:', error.message);
                }
            }
            
            Logger.log('✅ Veículo registrado para usuário:', userVehicleId);
            
            return {
                success: true,
                message: 'Veículo registrado com sucesso! Aguarde aprovação dos documentos.',
                vehicleId,
                userVehicleId
            };
        } catch (error) {
            Logger.error('❌ Erro ao registrar veículo para usuário:', error);
            return {
                success: false,
                message: `Erro: ${error.message}`
            };
        }
    }

    /**
     * Criar novo veículo no sistema
     * @param {Object} vehicleData - Dados do veículo
     * @returns {Promise<string|null>} ID do veículo criado
     */
    async createVehicle(vehicleData) {
        try {
            // Verificar se placa já existe
            const existingVehicle = await this.getVehicleByPlate(vehicleData.plate);
            if (existingVehicle) {
                throw new Error(`Veículo com placa ${vehicleData.plate} já existe no sistema`);
            }

            const vehicleId = `vehicle_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const vehicleRef = database().ref(`${this.VEHICLES_PATH}/${vehicleId}`);
            
            const vehicle = {
                ...vehicleData,
                id: vehicleId,
                vehicleType: vehicleData.vehicleType || 'carro', // Tipo: 'carro' ou 'moto'
                isActive: false, // Veículo inativo por padrão
                status: 'idle', // Status padrão
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            await vehicleRef.set(vehicle);
            Logger.log('✅ Veículo criado no sistema:', vehicleId);
            return vehicleId;
        } catch (error) {
            Logger.error('❌ Erro ao criar veículo:', error);
            return null;
        }
    }

    /**
     * Buscar veículo por placa
     * @param {string} plate - Placa do veículo
     * @returns {Promise<Object|null>} Dados do veículo
     */
    async getVehicleByPlate(plate) {
        try {
            const vehiclesRef = database().ref(this.VEHICLES_PATH);
            const snapshot = await vehiclesRef.once('value');
            
            if (snapshot.exists()) {
                let foundVehicle = null;
                
                snapshot.forEach((childSnapshot) => {
                    const vehicle = childSnapshot.val();
                    if (vehicle.plate === plate) {
                        foundVehicle = {
                            id: childSnapshot.key,
                            ...vehicle
                        };
                    }
                });
                
                return foundVehicle;
            }
            
            return null;
        } catch (error) {
            Logger.error('❌ Erro ao buscar veículo por placa:', error);
            return null;
        }
    }

    /**
     * Buscar veículo de um usuário específico
     * @param {string} userId - ID do usuário
     * @param {string} vehicleId - ID do veículo
     * @returns {Promise<Object|null>} Dados do relacionamento usuário-veículo
     */
    async getUserVehicle(userId, vehicleId) {
        try {
            const userVehicleRef = database().ref(`${this.USER_VEHICLES_PATH}/${userId}`);
            const snapshot = await userVehicleRef.once('value');
            
            if (snapshot.exists()) {
                let foundUserVehicle = null;
                
                snapshot.forEach((childSnapshot) => {
                    const userVehicle = childSnapshot.val();
                    if (userVehicle.vehicleId === vehicleId) {
                        foundUserVehicle = {
                            id: childSnapshot.key,
                            ...userVehicle
                        };
                    }
                });
                
                return foundUserVehicle;
            }
            
            return null;
        } catch (error) {
            Logger.error('❌ Erro ao buscar veículo do usuário:', error);
            return null;
        }
    }

    /**
     * Verificar se é usuário de teste
     */
    isTestUser(userId) {
        return userId && (userId.includes('test-user-dev') || userId.includes('test-customer-dev'));
    }

    /**
     * Buscar todos os veículos de um usuário
     * @param {string} userId - ID do usuário
     * @returns {Promise<Array>} Lista de veículos do usuário
     */
    async getUserVehicles(userId) {
        try {
            // Se for usuário de teste, retornar array vazio sem tentar acessar o database
            if (this.isTestUser(userId)) {
                Logger.log('🧪 Usuário de teste detectado - retornando lista vazia de veículos');
                return [];
            }

            const userVehiclesRef = database().ref(`${this.USER_VEHICLES_PATH}/${userId}`);
            const snapshot = await userVehiclesRef.once('value');
            
            if (snapshot.exists()) {
                const userVehicles = [];
                snapshot.forEach((childSnapshot) => {
                    userVehicles.push({
                        id: childSnapshot.key,
                        ...childSnapshot.val()
                    });
                });
                return userVehicles;
            }
            
            return [];
        } catch (error) {
            // Se for erro de permissão e for usuário de teste, apenas logar e retornar vazio
            if (error.code === 'database/permission-denied' && this.isTestUser(userId)) {
                Logger.log('🧪 Usuário de teste - ignorando erro de permissão de veículos');
                return [];
            }
            Logger.error('❌ Erro ao buscar veículos do usuário:', error);
            return [];
        }
    }

    /**
     * Buscar usuário ativo com um veículo específico
     * @param {string} vehicleId - ID do veículo
     * @returns {Promise<Object|null>} Dados do usuário ativo
     */
    async getActiveUserVehicleByVehicle(vehicleId) {
        try {
            const userVehiclesRef = database().ref(this.USER_VEHICLES_PATH);
            const snapshot = await userVehiclesRef.once('value');
            
            if (snapshot.exists()) {
                let activeUserVehicle = null;
                
                snapshot.forEach((userSnapshot) => {
                    userSnapshot.forEach((vehicleSnapshot) => {
                        const userVehicle = vehicleSnapshot.val();
                        if (userVehicle.vehicleId === vehicleId && 
                            userVehicle.isActive && 
                            userVehicle.status === 'active') {
                            activeUserVehicle = {
                                id: vehicleSnapshot.key,
                                ...userVehicle
                            };
                        }
                    });
                });
                
                return activeUserVehicle;
            }
            
            return null;
        } catch (error) {
            Logger.error('❌ Erro ao buscar usuário ativo com veículo:', error);
            return null;
        }
    }

    /**
     * Upload de documento para Firebase Storage
     * @param {string} vehicleId - ID do veículo
     * @param {string} userId - ID do usuário
     * @param {string} docType - Tipo do documento
     * @param {string} fileUri - URI do arquivo
     * @returns {Promise<string>} URL de download do arquivo
     */
    async uploadDocument(vehicleId, userId, docType, fileUri) {
        try {
            // Detectar extensão do arquivo baseado na URI ou tipo
            let extension = 'jpg'; // padrão para imagens
            if (fileUri.toLowerCase().endsWith('.pdf')) {
                extension = 'pdf';
            } else if (fileUri.toLowerCase().match(/\.(jpg|jpeg|png|gif)$/i)) {
                // Extrair extensão da URI
                const match = fileUri.toLowerCase().match(/\.(jpg|jpeg|png|gif)$/i);
                if (match) {
                    extension = match[1];
                }
            }
            
            // Criar referência no Storage
            const fileName = `${docType}_${userId}_${Date.now()}.${extension}`;
            const storagePath = `vehicles/${vehicleId}/${fileName}`;
            const reference = storage().ref(storagePath);

            // Upload do arquivo
            await reference.putFile(fileUri);
            
            // Obter URL de download
            const downloadURL = await reference.getDownloadURL();
            
            Logger.log('✅ Documento enviado:', fileName, `(tipo: ${extension})`);
            return downloadURL;
        } catch (error) {
            Logger.error('❌ Erro ao enviar documento:', error);
            throw error;
        }
    }

    /**
     * Buscar veículos completos do usuário (com dados do veículo)
     * @param {string} userId - ID do usuário
     * @returns {Promise<Array>} Lista de veículos completos
     */
    async getUserVehiclesComplete(userId) {
        try {
            const userVehicles = await this.getUserVehicles(userId);
            const completeVehicles = [];

            for (const userVehicle of userVehicles) {
                // Buscar dados do veículo
                const vehicleRef = database().ref(`${this.VEHICLES_PATH}/${userVehicle.vehicleId}`);
                const vehicleSnapshot = await vehicleRef.once('value');
                
                if (vehicleSnapshot.exists()) {
                    const vehicle = {
                        id: vehicleSnapshot.key,
                        ...vehicleSnapshot.val()
                    };
                    
                    completeVehicles.push({
                        userVehicle,
                        vehicle
                    });
                }
            }

            return completeVehicles;
        } catch (error) {
            Logger.error('❌ Erro ao buscar veículos completos:', error);
            return [];
        }
    }

    /**
     * Atualizar status de um veículo do usuário
     * @param {string} userId - ID do usuário
     * @param {string} vehicleId - ID do veículo
     * @param {Object} updates - Atualizações
     * @returns {Promise<boolean>} Sucesso da operação
     */
    async updateUserVehicle(userId, vehicleId, updates) {
        try {
            const userVehicle = await this.getUserVehicle(userId, vehicleId);
            if (!userVehicle) {
                throw new Error('Veículo não encontrado para este usuário');
            }

            const userVehicleRef = database().ref(`${this.USER_VEHICLES_PATH}/${userId}/${userVehicle.id}`);
            await userVehicleRef.update({
                ...updates,
                updatedAt: new Date().toISOString()
            });

            Logger.log('✅ Veículo do usuário atualizado:', userVehicle.id);
            return true;
        } catch (error) {
            Logger.error('❌ Erro ao atualizar veículo do usuário:', error);
            return false;
        }
    }

    /**
     * Buscar veículo ativo do usuário
     * @param {string} userId - ID do usuário
     * @returns {Promise<Object|null>} Dados do veículo ativo (com placa) ou null
     */
    async getActiveVehicle(userId) {
        try {
            const userVehicles = await this.getUserVehicles(userId);
            
            // Buscar veículo ativo
            const activeUserVehicle = userVehicles.find(v => v.isActive === true);
            
            if (!activeUserVehicle) {
                return null;
            }
            
            // Buscar dados completos do veículo
            const vehicleId = activeUserVehicle.vehicleId;
            const vehicleRef = database().ref(`${this.VEHICLES_PATH}/${vehicleId}`);
            const vehicleSnapshot = await vehicleRef.once('value');
            
            if (!vehicleSnapshot.exists()) {
                // Fallback: tentar buscar placa do perfil do usuário
                const userRef = database().ref(`${this.USERS_PATH}/${userId}`);
                const userSnapshot = await userRef.once('value');
                const userData = userSnapshot.val();
                
                if (userData && (userData.carPlate || userData.vehicleNumber || userData.vehiclePlate)) {
                    return {
                        vehicleId: vehicleId,
                        plate: userData.carPlate || userData.vehicleNumber || userData.vehiclePlate,
                        ...activeUserVehicle
                    };
                }
                
                return null;
            }
            
            const vehicleData = vehicleSnapshot.val();
            
            return {
                vehicleId: vehicleId,
                plate: vehicleData.plate || vehicleData.vehicleNumber || vehicleData.vehiclePlate,
                ...vehicleData,
                ...activeUserVehicle
            };
        } catch (error) {
            Logger.error('❌ Erro ao buscar veículo ativo:', error);
            return null;
        }
    }

    /**
     * Buscar veículo por ID
     * @param {string} vehicleId - ID do veículo
     * @returns {Promise<Object|null>} Dados do veículo
     */
    async getVehicleById(vehicleId) {
        try {
            const vehicleRef = database().ref(`${this.VEHICLES_PATH}/${vehicleId}`);
            const vehicleSnapshot = await vehicleRef.once('value');
            
            if (vehicleSnapshot.exists()) {
                return {
                    id: vehicleId,
                    ...vehicleSnapshot.val()
                };
            }
            
            return null;
        } catch (error) {
            Logger.error('❌ Erro ao buscar veículo por ID:', error);
            return null;
        }
    }

    /**
     * Definir veículo ativo do usuário
     * @param {string} userId - ID do usuário
     * @param {string} vehicleId - ID do veículo
     * @returns {Promise<boolean>} Sucesso da operação
     */
    async setActiveVehicle(userId, vehicleId) {
        try {
            // 1. Desativar todos os veículos do usuário
            const userVehicles = await this.getUserVehicles(userId);
            const updates = {};
            
            for (const userVehicle of userVehicles) {
                updates[`${this.USER_VEHICLES_PATH}/${userId}/${userVehicle.id}/isActive`] = false;
            }

            // 2. Ativar o veículo selecionado
            const targetUserVehicle = userVehicles.find(uv => uv.vehicleId === vehicleId);
            if (targetUserVehicle) {
                updates[`${this.USER_VEHICLES_PATH}/${userId}/${targetUserVehicle.id}/isActive`] = true;
                updates[`${this.USER_VEHICLES_PATH}/${userId}/${targetUserVehicle.id}/updatedAt`] = new Date().toISOString();
            }

            // 3. Aplicar todas as atualizações
            await database().ref().update(updates);

            Logger.log('✅ Veículo ativo definido:', vehicleId);
            return true;
        } catch (error) {
            Logger.error('❌ Erro ao definir veículo ativo:', error);
            return false;
        }
    }

    /**
     * Define se motorista elite também aceita corridas Plus.
     * @param {string} userId
     * @param {boolean} enabled
     */
    async setElitePlusPreference(userId, enabled) {
        try {
            await database().ref(`${this.USERS_PATH}/${userId}`).update({
                acceptPlusWithElite: !!enabled,
                updatedAt: new Date().toISOString()
            });
            return true;
        } catch (error) {
            Logger.error('❌ Erro ao atualizar preferência Elite/Plus:', error);
            return false;
        }
    }

    /**
     * Remover veículo do usuário
     * @param {string} userId - ID do usuário
     * @param {string} vehicleId - ID do veículo
     * @returns {Promise<boolean>} Sucesso da operação
     */
    async removeUserVehicle(userId, vehicleId) {
        try {
            const userVehicle = await this.getUserVehicle(userId, vehicleId);
            if (!userVehicle) {
                throw new Error('Veículo não encontrado para este usuário');
            }

            // Remover documentos do Storage
            for (const [docType, url] of Object.entries(userVehicle.documents)) {
                if (url) {
                    try {
                        const storagePath = url.split('/o/')[1]?.split('?')[0];
                        if (storagePath) {
                            const decodedPath = decodeURIComponent(storagePath);
                            const fileRef = storage().ref(decodedPath);
                            await fileRef.delete();
                        }
                    } catch (error) {
                        Logger.warn(`Aviso: Não foi possível remover documento ${docType}:`, error);
                    }
                }
            }

            // Remover relacionamento usuário-veículo
            const userVehicleRef = database().ref(`${this.USER_VEHICLES_PATH}/${userId}/${userVehicle.id}`);
            await userVehicleRef.remove();

            Logger.log('✅ Veículo removido do usuário:', userVehicle.id);
            return true;
        } catch (error) {
            Logger.error('❌ Erro ao remover veículo do usuário:', error);
            return false;
        }
    }

    /**
     * Validar dados do veículo
     * @param {Object} vehicleData - Dados do veículo
     * @returns {Object} Resultado da validação
     */
    validateVehicleData(vehicleData) {
        const errors = [];
        const warnings = [];

        // Validações obrigatórias
        if (!vehicleData.plate) {
            errors.push('Placa é obrigatória');
        } else if (!this.validatePlateFormat(vehicleData.plate)) {
            errors.push('Formato de placa inválido (use ABC-1234)');
        }

        if (!vehicleData.brand) {
            errors.push('Marca é obrigatória');
        }

        if (!vehicleData.model) {
            errors.push('Modelo é obrigatório');
        }

        if (!vehicleData.year) {
            errors.push('Ano é obrigatório');
        } else if (vehicleData.year < 1990 || vehicleData.year > new Date().getFullYear() + 1) {
            errors.push('Ano do veículo inválido');
        }

        // Validações de aviso
        if (vehicleData.year < 2010) {
            warnings.push('Veículos muito antigos podem ter restrições');
        }

        return {
            isValid: errors.length === 0,
            errors,
            warnings
        };
    }

    /**
     * Validar formato de placa brasileira
     * @param {string} plate - Placa do veículo
     * @returns {boolean} Placa válida
     */
    validatePlateFormat(plate) {
        // Formato: ABC-1234 ou ABC1D23
        const plateRegex = /^[A-Z]{3}-?\d{4}$|^[A-Z]{3}\d{1}[A-Z]{1}\d{2}$/;
        return plateRegex.test(plate.toUpperCase());
    }

    /**
     * Formatar placa brasileira
     * @param {string} text - Texto da placa
     * @returns {string} Placa formatada
     */
    formatPlate(text) {
        const cleaned = text.replace(/[^A-Z0-9]/g, '').toUpperCase();
        if (cleaned.length <= 3) {
            return cleaned;
        } else if (cleaned.length <= 5) {
            return `${cleaned.slice(0, 3)}-${cleaned.slice(3)}`;
        } else {
            return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 5)}-${cleaned.slice(5, 7)}`;
        }
    }

    /**
     * Obter status do veículo para exibição
     * @param {string} status - Status do veículo
     * @returns {Object} Informações do status
     */
    getVehicleStatusInfo(status) {
        switch (status) {
            case 'active':
                return { 
                    text: 'Pronto para dirigir', 
                    color: '#4CAF50', 
                    icon: 'checkmark-circle' 
                };
            case 'pending':
                return { 
                    text: 'Em análise', 
                    color: '#FF9800', 
                    icon: 'time' 
                };
            case 'rejected':
                return { 
                    text: 'Veículo recusado', 
                    color: '#F44336', 
                    icon: 'close-circle' 
                };
            case 'inactive':
                return { 
                    text: 'Inativo', 
                    color: '#9E9E9E', 
                    icon: 'pause-circle' 
                };
            default:
                return { 
                    text: 'Status desconhecido', 
                    color: '#9E9E9E', 
                    icon: 'help-circle' 
                };
        }
    }

    /**
     * Escutar mudanças nos veículos do usuário
     * @param {string} userId - ID do usuário
     * @param {Function} callback - Callback para mudanças
     * @returns {Function} Função para parar de escutar
     */
    subscribeToUserVehicles(userId, callback) {
        const userVehiclesRef = database().ref(`${this.USER_VEHICLES_PATH}/${userId}`);
        
        const onValueChange = userVehiclesRef.on('value', async (snapshot) => {
            if (snapshot.exists()) {
                const userVehicles = [];
                snapshot.forEach((childSnapshot) => {
                    userVehicles.push({
                        id: childSnapshot.key,
                        ...childSnapshot.val()
                    });
                });
                
                // Buscar dados completos dos veículos
                const completeVehicles = await this.getUserVehiclesComplete(userId);
                callback(completeVehicles);
            } else {
                callback([]);
            }
        });

        // Retornar função para parar de escutar
        return () => userVehiclesRef.off('value', onValueChange);
    }

    /**
     * Envia dados estruturados (JSON + imagem de auditoria) ao backend
     * 
     * @param {string} vehicleId - ID do veículo
     * @param {string} userId - ID do usuário
     * @param {Object} structuredData - Dados estruturados do OCR
     */
    async sendStructuredDataToBackend(vehicleId, userId, structuredData) {
        try {
            // Preparar payload para backend
            const payload = {
                vehicleId,
                userId,
                // Dados estruturados do veículo (JSON)
                vehicleData: structuredData.vehicleData,
                // Metadados
                metadata: structuredData.metadata || {},
            };

            // Converter imagem de auditoria para base64 se disponível
            if (structuredData.auditImage) {
                const FileSystem = require('expo-file-system').default;
                try {
                    const base64 = await FileSystem.readAsStringAsync(structuredData.auditImage, {
                        encoding: FileSystem.EncodingType.Base64,
                    });
                    payload.auditImage = `data:image/jpeg;base64,${base64}`;
                } catch (error) {
                    Logger.error('Erro ao converter imagem de auditoria:', error);
                }
            }

            // Enviar ao backend
            // Usar a mesma configuração de API que outros serviços
            const { getSelfHostedApiUrl } = require('../config/ApiConfig');
            const backendUrl = getSelfHostedApiUrl('/api/vehicles/ocr-data');
            
            const response = await fetch(backendUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                throw new Error(`Backend retornou erro: ${response.status}`);
            }

            const result = await response.json();
            Logger.log('✅ Dados estruturados enviados ao backend:', result);
            return result;
        } catch (error) {
            Logger.error('❌ Erro ao enviar dados ao backend:', error);
            throw error;
        }
    }
}

export default new VehicleService();
