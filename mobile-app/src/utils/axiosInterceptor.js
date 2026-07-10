import Logger from './Logger';
import axios from 'axios';
import { Platform } from 'react-native';
import auth from '@react-native-firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { toUserFriendlyError } from './friendlyErrorMessages';

const TEST_MODE_STORAGE_KEY = '@test_mode';
const AUTH_UID_STORAGE_KEY = '@auth_uid';
const USER_DATA_STORAGE_KEY = '@user_data';
const QA_SOCKET_ID_TOKEN_STORAGE_KEY = '@qa_socket_id_token';
const QA_AUTH_TOKEN_MIN_TTL_MS = 60000;

function decodeBase64UrlJson(segment) {
    const normalized = String(segment || '').replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(
        normalized.length + ((4 - (normalized.length % 4)) % 4),
        '=',
    );

    if (typeof globalThis?.atob === 'function') {
        return JSON.parse(globalThis.atob(padded));
    }

    if (typeof Buffer !== 'undefined') {
        return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
    }

    return null;
}

function isJwtExpiredOrNearExpiry(token, nowMs = Date.now()) {
    const parts = String(token || '').split('.');
    if (parts.length < 2) {
        return false;
    }

    try {
        const payload = decodeBase64UrlJson(parts[1]);
        const expSeconds = Number(payload?.exp);
        if (!Number.isFinite(expSeconds) || expSeconds <= 0) {
            return false;
        }
        return expSeconds * 1000 <= nowMs + QA_AUTH_TOKEN_MIN_TTL_MS;
    } catch (_error) {
        return false;
    }
}

function getJwtSubject(token) {
    const parts = String(token || '').split('.');
    if (parts.length < 2) {
        return '';
    }

    try {
        const payload = decodeBase64UrlJson(parts[1]);
        return String(payload?.user_id || payload?.sub || '').trim();
    } catch (_error) {
        return '';
    }
}

function parseRequestData(data) {
    if (!data) return null;
    if (typeof data === 'string') {
        try {
            return JSON.parse(data);
        } catch (_error) {
            return null;
        }
    }
    if (typeof data === 'object') {
        return data;
    }
    return null;
}

function isPaymentAdvanceRequest(requestConfig = {}) {
    const url = String(requestConfig.url || '');
    const baseURL = String(requestConfig.baseURL || '');
    return `${baseURL}${url}`.includes('/api/payment/advance');
}

function getPaymentAdvancePassengerId(requestConfig = {}) {
    if (!isPaymentAdvanceRequest(requestConfig)) return '';
    const data = parseRequestData(requestConfig.data);
    return String(data?.passengerId || '').trim();
}

function buildPassengerScopeMismatchError({ passengerId, tokenSubject, source }) {
    const error = new Error('Não foi possível validar sua sessão para este pagamento.');
    error.name = 'PaymentPassengerScopeMismatchError';
    error.code = 'PAYMENT_PASSENGER_SCOPE_MISMATCH';
    error.response = {
        status: 403,
        data: {
            success: false,
            code: 'PAYMENT_PASSENGER_SCOPE_MISMATCH',
            error: 'Passageiro não autorizado para esta operação',
            message: 'Não foi possível validar sua sessão para este pagamento.',
            passengerId,
            authenticatedPassengerId: tokenSubject,
            tokenSource: source || null,
        },
    };
    return error;
}

function buildQaSessionExpiredError({ passengerId, tokenSubject }) {
    const error = new Error('Sessão QA expirada. Reabra o app ou resemeie a autenticação.');
    error.name = 'QaSessionExpiredError';
    error.code = 'TOKEN_INVALID_OR_EXPIRED';
    error.response = {
        status: 401,
        data: {
            success: false,
            code: 'TOKEN_INVALID_OR_EXPIRED',
            error: 'Sessão QA expirada',
            message: error.message,
            passengerId: passengerId || null,
            authenticatedPassengerId: tokenSubject || null,
            tokenSource: 'qa_storage_expired',
        },
    };
    return error;
}

function isCanceledAxiosError(error) {
    return axios.isCancel?.(error)
        || error?.code === 'ERR_CANCELED'
        || error?.name === 'CanceledError'
        || error?.message === 'canceled';
}

async function resolveRequestAuthToken({ forceRefresh = false, expectedSubject = '' } = {}) {
    try {
        const [testModeRaw, qaSocketIdTokenRaw, persistedUidRaw, storedUserDataRaw] = await Promise.all([
            AsyncStorage.getItem(TEST_MODE_STORAGE_KEY),
            AsyncStorage.getItem(QA_SOCKET_ID_TOKEN_STORAGE_KEY),
            AsyncStorage.getItem(AUTH_UID_STORAGE_KEY),
            AsyncStorage.getItem(USER_DATA_STORAGE_KEY)
        ]);

        let storedUserData = null;
        if (storedUserDataRaw) {
            try {
                storedUserData = JSON.parse(storedUserDataRaw);
            } catch (_error) {
                storedUserData = null;
            }
        }

        const qaModeEnabled = String(testModeRaw || '').trim().toLowerCase() === 'true';
        const qaSocketIdToken = String(qaSocketIdTokenRaw || '').trim();
        const tokenSubject = getJwtSubject(qaSocketIdToken);
        const persistedUid = String(
            storedUserData?.uid ||
            storedUserData?.id ||
            persistedUidRaw ||
            '',
        ).trim();
        const isPersistedTestUser =
            storedUserData?.isTestUser === true ||
            storedUserData?.qaUser === true ||
            storedUserData?.testUser === true;
        const canUsePersistedTestUserToken =
            Boolean(qaSocketIdToken) &&
            isPersistedTestUser &&
            Boolean(tokenSubject) &&
            Boolean(persistedUid) &&
            tokenSubject === persistedUid;

        if (!forceRefresh && (qaModeEnabled || canUsePersistedTestUserToken) && qaSocketIdToken) {
            if (isJwtExpiredOrNearExpiry(qaSocketIdToken)) {
                Logger.warn('⚠️ [Axios] Token QA persistido expirado; usando autenticação alternativa.');
                if (expectedSubject && tokenSubject === expectedSubject) {
                    return {
                        token: null,
                        source: 'qa_storage_expired',
                        tokenSubject,
                    };
                }
            } else {
                return {
                    token: qaSocketIdToken,
                    source: 'qa_storage',
                    tokenSubject,
                };
            }
        }
    } catch (qaTokenError) {
        Logger.warn('⚠️ [Axios] Falha ao recuperar token QA persistido:', qaTokenError);
    }

    try {
        const currentUser = auth().currentUser;
        if (currentUser) {
            return {
                token: await currentUser.getIdToken(Boolean(forceRefresh)),
                source: 'firebase'
            };
        }
    } catch (tokenError) {
        Logger.warn('⚠️ [Axios] Falha ao obter token do Firebase:', tokenError);
    }

    return {
        token: null,
        source: null
    };
}

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
        async (requestConfig) => {
            const paymentPassengerId = getPaymentAdvancePassengerId(requestConfig);
            let { token, source, tokenSubject: storedTokenSubject } = await resolveRequestAuthToken({
                forceRefresh: false,
                expectedSubject: paymentPassengerId,
            });

            if (paymentPassengerId && source === 'qa_storage_expired') {
                throw buildQaSessionExpiredError({
                    passengerId: paymentPassengerId,
                    tokenSubject: storedTokenSubject,
                });
            }

            if (token && paymentPassengerId) {
                let tokenSubject = getJwtSubject(token);
                if (tokenSubject && tokenSubject !== paymentPassengerId) {
                    Logger.warn('⚠️ [Axios] Token HTTP não corresponde ao passageiro do pagamento; tentando renovar.');
                    const refreshed = await resolveRequestAuthToken({ forceRefresh: true });
                    if (refreshed?.token) {
                        token = refreshed.token;
                        source = refreshed.source;
                        tokenSubject = getJwtSubject(token);
                    }
                }

                if (tokenSubject && tokenSubject !== paymentPassengerId) {
                    Logger.warn('⚠️ [Axios] Bloqueando pagamento com identidade divergente.', {
                        tokenSource: source,
                    });
                    throw buildPassengerScopeMismatchError({
                        passengerId: paymentPassengerId,
                        tokenSubject,
                        source,
                    });
                }
            }

            if (token && !requestConfig.headers?.Authorization) {
                requestConfig.headers = requestConfig.headers || {};
                requestConfig.headers.Authorization = `Bearer ${token}`;
                requestConfig._authTokenSource = source;
            }

            // Log apenas em desenvolvimento
            if (__DEV__) {
                Logger.log(`🌐 [Axios] ${requestConfig.method?.toUpperCase()} ${requestConfig.url}`);
            }
            return requestConfig;
        },
        (error) => {
            Logger.error('❌ [Axios] Erro na requisição:', error);
            return Promise.reject(toUserFriendlyError(error, { context: 'api' }));
        }
    );

    // Interceptor de resposta - trata erros comuns e implementa Token Refresh
    instance.interceptors.response.use(
        (response) => {
            return response;
        },
        async (error) => {
            if (isCanceledAxiosError(error)) {
                return Promise.reject(error);
            }

            const originalRequest =
                error?.config && typeof error.config === 'object'
                    ? error.config
                    : null;

            // Tratamento de erros de rede
            if (error.code === 'ECONNABORTED') {
                Logger.warn('⏱️ [Axios] Timeout na requisição');
                error.code = error.code || 'ECONNABORTED';
                error.message = 'Tempo de espera esgotado. Tente novamente.';
            } else if (error.message === 'Network Error') {
                Logger.warn('🌐 [Axios] Erro de rede');
                error.code = error.code || 'NETWORK_ERROR';
                error.message = 'Erro de conexão. Verifique sua internet.';
            } else if (error.response) {
                // Erro com resposta do servidor
                const status = error.response.status;
                if (status === 401 && originalRequest && !originalRequest._retry) {
                    originalRequest._retry = true;
                    Logger.warn('🔒 [Axios] Não autorizado (401), tentando renovar credencial HTTP...');

                    try {
                        const { token: newToken, source } = await resolveRequestAuthToken({ forceRefresh: true });
                        if (newToken && source === 'firebase') {
                            Logger.log('✅ [Axios] Novo token Firebase gerado. Refazendo requisição original...');

                            // Atualiza os headers da requisição falha
                            originalRequest.headers = originalRequest.headers || {};
                            originalRequest.headers.Authorization = `Bearer ${newToken}`;
                            originalRequest._authTokenSource = source;

                            // Retorna uma nova chamada do Axios usando a mesma instância configurada original
                            return instance(originalRequest);
                        }

                        if (originalRequest?._authTokenSource === 'qa_storage') {
                            error.message = 'Sessão QA expirada. Reabra o app ou resemeie a autenticação.';
                            error.code = error.code || 'TOKEN_INVALID_OR_EXPIRED';
                        }
                    } catch (refreshError) {
                        Logger.error('❌ [Axios] Falha ao renovar Token do Firebase:', refreshError);
                        error.message = 'Sessão expirada permanentemente. Faça login novamente.';
                        error.code = error.code || 'TOKEN_EXPIRED';
                        // Pode despachar evento de logout aqui
                    }
                } else if (status >= 500) {
                    Logger.error('🔥 [Axios] Erro do servidor');
                    error.code = error.code || 'INTERNAL_SERVER_ERROR';
                    error.message = 'Erro no servidor. Tente novamente mais tarde.';
                }
            }

            return Promise.reject(toUserFriendlyError(error, { context: 'api' }));
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
            return Promise.reject(toUserFriendlyError(error, { context: 'api' }));
        }
    );

    // Interceptor global de resposta
    axios.interceptors.response.use(
        (response) => {
            return response;
        },
        async (error) => {
            if (isCanceledAxiosError(error)) {
                return Promise.reject(error);
            }

            const originalRequest =
                error?.config && typeof error.config === 'object'
                    ? error.config
                    : null;

            // Tratamento global de erros para tokens expirados (Sessão Infinita)
            if (error.response?.status === 401 && originalRequest && !originalRequest._retry) {
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
            return Promise.reject(toUserFriendlyError(error, { context: 'api' }));
        }
    );

    Logger.log('✅ Axios interceptors configurados');
}
