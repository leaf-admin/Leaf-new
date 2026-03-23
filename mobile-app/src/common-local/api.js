import Logger from '../utils/Logger';
import { firebase } from './config/configureFirebase';
import { createAxiosInstance } from '../utils/axiosInterceptor';
import { API_URLS } from '../config/ApiConfig';

const normalizeBaseUrl = (url) => {
    const raw = String(url || '').trim();
    if (!raw) return 'https://api.147.182.204.181.sslip.io';

    const withoutTrailingSlash = raw.replace(/\/+$/, '');
    // Evita duplicação de rota quando EXPO_PUBLIC_API_URL vier como ".../api"
    return withoutTrailingSlash.replace(/\/api$/i, '');
};

const API_BASE_URL =
    normalizeBaseUrl(
        process.env.EXPO_PUBLIC_API_URL ||
        process.env.EXPO_PUBLIC_BACKEND_URL ||
        API_URLS?.selfHostedApi ||
        'https://api.147.182.204.181.sslip.io'
    );

const httpClient = createAxiosInstance({
    baseURL: API_BASE_URL,
    timeout: 30000
});

const normalizeUrl = (url) => {
    if (!url) return '/';
    if (/^https?:\/\//i.test(url)) return url;
    return `/${String(url).replace(/^\/+/, '')}`;
};

const request = (method, url, dataOrConfig, maybeConfig) => {
    if (method === 'get' || method === 'delete') {
        return httpClient.request({
            method,
            url: normalizeUrl(url),
            ...(dataOrConfig || {})
        });
    }

    return httpClient.request({
        method,
        url: normalizeUrl(url),
        data: dataOrConfig,
        ...(maybeConfig || {})
    });
};


export const api = {
    // HTTP client (usado por services/*)
    request: (config) => httpClient.request(config),
    get: (url, config = {}) => request('get', url, config),
    post: (url, data = {}, config = {}) => request('post', url, data, config),
    put: (url, data = {}, config = {}) => request('put', url, data, config),
    patch: (url, data = {}, config = {}) => request('patch', url, data, config),
    delete: (url, config = {}) => request('delete', url, config),

    // Funções existentes
    fetchBookings: () => async (dispatch) => {
        const { database } = firebase;
        const bookingsRef = database.ref('bookings');
        
        bookingsRef.on('value', (snapshot) => {
            const bookings = [];
            snapshot.forEach((child) => {
                bookings.push({
                    id: child.key,
                    ...child.val()
                });
            });
            
            dispatch({
                type: 'SET_BOOKINGS',
                payload: bookings
            });
        });

        return () => bookingsRef.off();
    },

    fetchUserCancelReasons: () => async (dispatch) => {
        const { database } = firebase;
        const reasonsRef = database.ref('cancel_reason');
        
        reasonsRef.on('value', (snapshot) => {
            const reasons = [];
            snapshot.forEach((child) => {
                reasons.push({
                    id: child.key,
                    ...child.val()
                });
            });
            
            dispatch({
                type: 'SET_CANCEL_REASONS',
                payload: reasons
            });
        });

        return () => reasonsRef.off();
    },

    fetchUserPromos: () => async (dispatch) => {
        const { database } = firebase;
        const promosRef = database.ref('promos');
        
        promosRef.on('value', (snapshot) => {
            const promos = [];
            snapshot.forEach((child) => {
                promos.push({
                    id: child.key,
                    ...child.val()
                });
            });
            
            dispatch({
                type: 'SET_PROMOS',
                payload: promos
            });
        });

        return () => promosRef.off();
    },

    // Funções necessárias para o PassengerUI
    getEstimate: () => async (dispatch) => {
        // TODO: Implementar lógica de estimativa
        Logger.log('getEstimate chamado');
    },

    addBooking: () => async (dispatch) => {
        // TODO: Implementar lógica de adicionar booking
        Logger.log('addBooking chamado');
    },

    clearBooking: () => async (dispatch) => {
        // TODO: Implementar lógica de limpar booking
        Logger.log('clearBooking chamado');
    },

    clearEstimate: () => async (dispatch) => {
        // TODO: Implementar lógica de limpar estimativa
        Logger.log('clearEstimate chamado');
    },

    // Função para buscar notificações do usuário
    getNotifications: async (uid) => {
        try {
            const { database } = firebase;
            
            if (!uid) {
                Logger.warn('getNotifications: UID não fornecido');
                return [];
            }

            // Buscar notificações do Firebase Realtime Database
            const notificationsRef = database.ref(`notifications/${uid}`);
            
            return new Promise((resolve, reject) => {
                notificationsRef.once('value', (snapshot) => {
                    if (snapshot.exists()) {
                        const notifications = [];
                        snapshot.forEach((child) => {
                            notifications.push({
                                id: child.key,
                                ...child.val()
                            });
                        });
                        // Ordenar por data (mais recentes primeiro)
                        notifications.sort((a, b) => {
                            const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                            const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                            return dateB - dateA;
                        });
                        resolve(notifications);
                    } else {
                        resolve([]);
                    }
                }, (error) => {
                    Logger.error('Erro ao buscar notificações:', error);
                    reject(error);
                });
            });
        } catch (error) {
            Logger.error('Erro ao buscar notificações:', error);
            return [];
        }
    }
};

export default api;
