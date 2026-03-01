import Logger from '../utils/Logger';
import { firebase } from '../common-local/configureFirebase';
import auth from '@react-native-firebase/auth';


class AuthService {
    constructor() {
        this.baseURL = 'https://api.leaf.app.br/api';
        this.currentUser = null;
        this.idToken = null;
    }

    /**
     * Obter token de autenticação Firebase
     * @returns {Promise<string|null>} Token JWT do Firebase
     */
    async getFirebaseToken() {
        try {
            // ✅ Usar @react-native-firebase/auth diretamente
            const user = auth().currentUser;
            if (!user) {
                Logger.log('❌ Usuário não autenticado no Firebase Auth');
                return null;
            }

            const token = await user.getIdToken(true); // Force refresh
            this.idToken = token;
            this.currentUser = user;
            
            Logger.log('✅ Token Firebase obtido para:', user.uid);
            return token;

        } catch (error) {
            Logger.error('❌ Erro ao obter token Firebase:', error);
            return null;
        }
    }

    /**
     * Verificar se usuário está autenticado
     * @returns {Promise<boolean>} Status de autenticação
     */
    async isAuthenticated() {
        try {
            // ✅ Usar @react-native-firebase/auth diretamente
            const user = auth().currentUser;
            if (!user) {
                Logger.log('❌ Nenhum usuário autenticado');
                return false;
            }

            // Verificar se token é válido
            const token = await this.getFirebaseToken();
            return !!token;

        } catch (error) {
            Logger.error('❌ Erro ao verificar autenticação:', error);
            return false;
        }
    }

    /**
     * Obter dados do usuário atual
     * @returns {Promise<Object|null>} Dados do usuário
     */
    async getCurrentUser() {
        try {
            // ✅ Usar @react-native-firebase/auth diretamente
            const user = auth().currentUser;
            if (!user) {
                Logger.log('❌ Nenhum usuário autenticado');
                return null;
            }

            return {
                uid: user.uid,
                email: user.email,
                displayName: user.displayName,
                photoURL: user.photoURL,
                phoneNumber: user.phoneNumber,
                emailVerified: user.emailVerified,
                userType: user.userType || 'passenger' // Campo customizado
            };

        } catch (error) {
            Logger.error('❌ Erro ao obter usuário atual:', error);
            return null;
        }
    }

    /**
     * Fazer logout
     * @returns {Promise<boolean>} Sucesso do logout
     */
    async logout() {
        try {
            await auth().signOut();
            this.currentUser = null;
            this.idToken = null;
            Logger.log('✅ Logout realizado');
            return true;

        } catch (error) {
            Logger.error('❌ Erro ao fazer logout:', error);
            return false;
        }
    }

    /**
     * Fazer requisição autenticada para APIs
     * @param {string} endpoint - Endpoint da API
     * @param {Object} options - Opções da requisição
     * @returns {Promise<Response>} Resposta da API
     */
    async authenticatedRequest(endpoint, options = {}) {
        try {
            const token = await this.getFirebaseToken();
            if (!token) {
                throw new Error('Usuário não autenticado');
            }

            // ✅ Importar headers padrão compatíveis com CORS
            const { getAuthenticatedHeaders } = require('../utils/RequestHeaders');
            
            const url = `${this.baseURL}${endpoint}`;
            const headers = getAuthenticatedHeaders(token, options.headers);

            // ✅ Adicionar timeout de 30 segundos
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 segundos

            try {
                const response = await fetch(url, {
                    ...options,
                    headers,
                    signal: controller.signal
                });

                clearTimeout(timeoutId);

                // Se token expirou, tentar renovar
                if (response.status === 401) {
                    Logger.log('🔄 Token expirado, renovando...');
                    const newToken = await this.getFirebaseToken();
                    if (newToken) {
                        headers.Authorization = `Bearer ${newToken}`;
                        
                        // Nova requisição com timeout
                        const retryController = new AbortController();
                        const retryTimeoutId = setTimeout(() => retryController.abort(), 30000);
                        
                        try {
                            const retryResponse = await fetch(url, {
                                ...options,
                                headers,
                                signal: retryController.signal
                            });
                            clearTimeout(retryTimeoutId);
                            return retryResponse;
                        } catch (retryError) {
                            clearTimeout(retryTimeoutId);
                            if (retryError.name === 'AbortError') {
                                throw new Error('Send message timeout');
                            }
                            throw retryError;
                        }
                    }
                }

                return response;
            } catch (fetchError) {
                clearTimeout(timeoutId);
                if (fetchError.name === 'AbortError') {
                    throw new Error('Send message timeout');
                }
                throw fetchError;
            }

        } catch (error) {
            Logger.error('❌ Erro na requisição autenticada:', error);
            throw error;
        }
    }

    /**
     * Fazer requisição para APIs de suporte
     * @param {string} endpoint - Endpoint da API
     * @param {Object} options - Opções da requisição
     * @returns {Promise<Response>} Resposta da API
     */
    async supportRequest(endpoint, options = {}) {
        return this.authenticatedRequest(`/support${endpoint}`, options);
    }

    /**
     * Fazer requisição para APIs de admin (dashboard)
     * @param {string} endpoint - Endpoint da API
     * @param {Object} options - Opções da requisição
     * @returns {Promise<Response>} Resposta da API
     */
    async adminRequest(endpoint, options = {}) {
        return this.authenticatedRequest(`/admin${endpoint}`, options);
    }

    /**
     * Tratar resposta da API
     * @param {Response} response - Resposta da API
     * @returns {Promise<Object>} Dados da resposta
     */
    async handleApiResponse(response) {
        try {
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || `Erro ${response.status}: ${response.statusText}`);
            }

            return data;

        } catch (error) {
            Logger.error('❌ Erro ao processar resposta da API:', error);
            throw error;
        }
    }

    /**
     * Configurar listener de mudanças de autenticação
     * @param {Function} callback - Callback para mudanças
     * @returns {Function} Função para remover listener
     */
    onAuthStateChanged(callback) {
        return auth().onAuthStateChanged(async (user) => {
            if (user) {
                this.currentUser = user;
                this.idToken = await user.getIdToken();
            } else {
                this.currentUser = null;
                this.idToken = null;
            }
            callback(user);
        });
    }

    /**
     * Obter informações do dispositivo
     * @returns {Object} Informações do dispositivo
     */
    getDeviceInfo() {
        return {
            platform: Platform.OS,
            version: Platform.Version,
            isDevice: Platform.isDevice,
            timestamp: new Date().toISOString()
        };
    }
}

export default new AuthService();




