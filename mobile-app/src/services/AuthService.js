import Logger from '../utils/Logger';
import auth from '@react-native-firebase/auth';
import { Platform } from 'react-native';
import { toUserFriendlyError } from '../utils/friendlyErrorMessages';
import { buildBackendUrl } from '../config/backendBaseUrl';
import { resolveRequestAuthToken } from '../utils/axiosInterceptor';


class AuthService {
    constructor() {
        this.baseURL = buildBackendUrl('/api');
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
            const initialAuth = await resolveRequestAuthToken({ forceRefresh: false });
            const token = initialAuth?.token || null;
            if (!token) {
                throw new Error('Usuário não autenticado');
            }

            // ✅ Importar headers padrão compatíveis com CORS
            const { getAuthenticatedHeaders } = require('../utils/RequestHeaders');
            
            const url = `${this.baseURL}${endpoint}`;
            const { timeoutMs, ...fetchOptions } = options || {};
            const requestTimeoutMs = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0
                ? Number(timeoutMs)
                : 30000;
            const headers = getAuthenticatedHeaders(token, fetchOptions.headers);

            // ✅ Adicionar timeout para impedir bootstrap global preso em rede/backend.
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), requestTimeoutMs);

            try {
                const response = await fetch(url, {
                    ...fetchOptions,
                    headers,
                    signal: controller.signal
                });

                clearTimeout(timeoutId);

                // Se token expirou, tentar renovar
                if (response.status === 401) {
                    Logger.log('🔄 Token expirado, renovando...');
                    const refreshedAuth = await resolveRequestAuthToken({ forceRefresh: true });
                    const newToken = refreshedAuth?.token || null;
                    if (newToken) {
                        headers.Authorization = `Bearer ${newToken}`;
                        
                        // Nova requisição com timeout
                        const retryController = new AbortController();
                        const retryTimeoutId = setTimeout(() => retryController.abort(), requestTimeoutMs);
                        
                        try {
                            const retryResponse = await fetch(url, {
                                ...fetchOptions,
                                headers,
                                signal: retryController.signal
                            });
                            clearTimeout(retryTimeoutId);
                            return retryResponse;
                        } catch (retryError) {
                            clearTimeout(retryTimeoutId);
                            if (retryError.name === 'AbortError') {
                                throw toUserFriendlyError(
                                    { code: 'ECONNABORTED', message: 'Send message timeout' },
                                    { context: 'auth', fallbackMessage: 'A solicitacao demorou mais que o esperado. Tente novamente.' }
                                );
                            }
                            throw retryError;
                        }
                    }
                }

                return response;
            } catch (fetchError) {
                clearTimeout(timeoutId);
                if (fetchError.name === 'AbortError') {
                    throw toUserFriendlyError(
                        { code: 'ECONNABORTED', message: 'Send message timeout' },
                        { context: 'auth', fallbackMessage: 'A solicitacao demorou mais que o esperado. Tente novamente.' }
                    );
                }
                throw fetchError;
            }

        } catch (error) {
            Logger.error('❌ Erro na requisição autenticada:', error);
            throw toUserFriendlyError(error, {
                context: 'auth',
                fallbackMessage: 'Nao foi possivel concluir a autenticacao agora. Tente novamente.'
            });
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
                throw toUserFriendlyError(
                    {
                        message: data?.error || `Erro ${response.status}: ${response.statusText}`,
                        status: response.status,
                        code: data?.code
                    },
                    {
                        context: 'api',
                        fallbackMessage: 'Nao foi possivel concluir esta solicitacao agora.'
                    }
                );
            }

            return data;

        } catch (error) {
            Logger.error('❌ Erro ao processar resposta da API:', error);
            throw toUserFriendlyError(error, {
                context: 'api',
                fallbackMessage: 'Nao foi possivel processar a resposta agora.'
            });
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
