import Logger from './Logger';
import axios from 'axios';
import { Platform } from 'react-native';
import auth from '@react-native-firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';


/**
 * Cria uma instância do axios com configurações padrão
 * @param {Object} config - Configurações do axios
 * @returns {Object} Instância do axios configurada
 */
export function createAxiosInstance(config = {}) {
    const instance = axios.create({
        timeout: config.timeout || 30000,
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            ...config.headers
        },
        ...config
    });

    // Interceptor de requisição - adiciona headers padrão
    instance.interceptors.request.use(
        (requestConfig) => {
            // Log apenas em desenvolvimento
            if (__DEV__) {
                Logger.log(`🌐 [Axios] ${requestConfig.method?.toUpperCase()} ${requestConfig.url}`);
            }
            return requestConfig;
        },
        (error) => {
            Logger.error('❌ [Axios] Erro na requisição:', error);
            return Promise.reject(error);
        }
    );

    // Interceptor de resposta - trata erros comuns e implementa Token Refresh
    instance.interceptors.response.use(
        (response) => {
            return response;
        },
        async (error) => {
            const originalRequest = error.config;

            // Tratamento de erros de rede
            if (error.code === 'ECONNABORTED') {
                Logger.error('⏱️ [Axios] Timeout na requisição');
                error.message = 'Tempo de espera esgotado. Tente novamente.';
            } else if (error.message === 'Network Error') {
                Logger.error('🌐 [Axios] Erro de rede');
                error.message = 'Erro de conexão. Verifique sua internet.';
            } else if (error.response) {
                // Erro com resposta do servidor
                const status = error.response.status;
                if (status === 401 && !originalRequest._retry) {
                    originalRequest._retry = true;
                    Logger.warn('🔒 [Axios] Não autorizado (401), tentando atualizar token Firebase...');

                    try {
                        const currentUser = auth().currentUser;
                        if (currentUser) {
                            // Força a atualização do token (true = force refresh session)
                            const newToken = await currentUser.getIdToken(true);
                            Logger.log('✅ [Axios] Novo Token gerado. Refazendo requisição original...');

                            // Atualiza os headers da requisição falha
                            originalRequest.headers = originalRequest.headers || {};
                            originalRequest.headers.Authorization = `Bearer ${newToken}`;

                            // Retorna uma nova chamada do Axios usando a mesma instância configurada original
                            return instance(originalRequest);
                        }
                    } catch (refreshError) {
                        Logger.error('❌ [Axios] Falha ao renovar Token do Firebase:', refreshError);
                        error.message = 'Sessão expirada permanentemente. Faça login novamente.';
                        // Pode despachar evento de logout aqui
                    }
                } else if (status >= 500) {
                    Logger.error('🔥 [Axios] Erro do servidor');
                    error.message = 'Erro no servidor. Tente novamente mais tarde.';
                }
            }

            return Promise.reject(error);
        }
    );

    return instance;
}

/**
 * Configura interceptors globais do axios
 * Pode ser usado para adicionar tokens de autenticação automaticamente
 */
export function setupAxiosInterceptor() {
    // Interceptor global de requisição
    axios.interceptors.request.use(
        (config) => {
            // Aqui você pode adicionar lógica global, como tokens de autenticação
            // Por exemplo:
            // const token = await AsyncStorage.getItem('authToken');
            // if (token) {
            //     config.headers.Authorization = `Bearer ${token}`;
            // }

            if (__DEV__) {
                Logger.log(`🌐 [Axios Global] ${config.method?.toUpperCase()} ${config.url}`);
            }

            return config;
        },
        (error) => {
            Logger.error('❌ [Axios Global] Erro na requisição:', error);
            return Promise.reject(error);
        }
    );

    // Interceptor global de resposta
    axios.interceptors.response.use(
        (response) => {
            return response;
        },
        async (error) => {
            const originalRequest = error.config;

            // Tratamento global de erros para tokens expirados (Sessão Infinita)
            if (error.response?.status === 401 && !originalRequest._retry) {
                originalRequest._retry = true;
                Logger.warn('⚠️ [Axios Global] Token expirado (401), tentando renovação infinita...');

                try {
                    const currentUser = auth().currentUser;
                    if (currentUser) {
                        const newToken = await currentUser.getIdToken(true); // forceRefresh
                        if (originalRequest.headers) {
                            originalRequest.headers.Authorization = `Bearer ${newToken}`;
                        }
                        return axios(originalRequest);
                    }
                } catch (refreshError) {
                    Logger.error('❌ [Axios Global] Não foi possível renovar a sessão:', refreshError);
                }
            }
            return Promise.reject(error);
        }
    );

    Logger.log('✅ Axios interceptors configurados');
}

