import Logger from '../../utils/Logger';
import AsyncStorage from '@react-native-async-storage/async-storage';
import store from '../store';
import { firebase } from '../config/configureFirebase';


// Constantes para as chaves do AsyncStorage
export const AUTH_UID_KEY = '@auth_uid';
export const USER_DATA_KEY = '@user_data';

/**
 * Obtém o UID do usuário seguindo a ordem de prioridade:
 * 1. AsyncStorage
 * 2. Redux State
 * 3. Firebase Auth
 */
export const getUserId = async () => {
    try {
        // 1. Tenta AsyncStorage
        const storedUid = await AsyncStorage.getItem(AUTH_UID_KEY);
        if (storedUid) {
            Logger.log('[getUserId] UID encontrado no AsyncStorage:', storedUid);
            return storedUid;
        }

        // 2. Tenta Redux
        const reduxState = store.getState();
        if (reduxState.auth && reduxState.auth.uid) {
            Logger.log('[getUserId] UID encontrado no Redux:', reduxState.auth.uid);
            return reduxState.auth.uid;
        }

        // 3. Tenta Firebase
        const { auth } = firebase;
        if (auth && auth.currentUser) {
            Logger.log('[getUserId] UID encontrado no Firebase:', auth.currentUser.uid);
            return auth.currentUser.uid;
        }

        Logger.log('[getUserId] Nenhum UID encontrado');
        return null;
    } catch (error) {
        Logger.error('[getUserId] Erro ao obter UID:', error);
        return null;
    }
};

/**
 * Obtém os dados do usuário seguindo a ordem de prioridade:
 * 1. AsyncStorage
 * 2. Redux State
 */
export const getUserData = async () => {
    try {
        // 1. Tenta AsyncStorage
        const storedData = await AsyncStorage.getItem(USER_DATA_KEY);
        if (storedData) {
            Logger.log('[getUserData] Dados encontrados no AsyncStorage');
            return JSON.parse(storedData);
        }

        // 2. Tenta Redux
        const reduxState = store.getState();
        if (reduxState.auth && reduxState.auth.profile) {
            Logger.log('[getUserData] Dados encontrados no Redux');
            return reduxState.auth.profile;
        }

        Logger.log('[getUserData] Nenhum dado encontrado');
        return null;
    } catch (error) {
        Logger.error('[getUserData] Erro ao obter dados do usuário:', error);
        return null;
    }
};

/**
 * Verifica se o usuário está autenticado
 */
export const isUserAuthenticated = async () => {
    const uid = await getUserId();
    return !!uid;
};

/**
 * Salva o UID no AsyncStorage
 */
export const saveUserId = async (uid) => {
    try {
        if (!uid) {
            Logger.error('[saveUserId] Tentativa de salvar UID inválido');
            return false;
        }

        await AsyncStorage.setItem(AUTH_UID_KEY, uid);
        Logger.log('[saveUserId] UID salvo com sucesso:', uid);
        return true;
    } catch (error) {
        Logger.error('[saveUserId] Erro ao salvar UID:', error);
        return false;
    }
};

/**
 * Salva os dados do usuário no AsyncStorage
 */
export const saveUserData = async (userData) => {
    try {
        if (!userData) {
            Logger.error('[saveUserData] Tentativa de salvar dados inválidos');
            return false;
        }

        await AsyncStorage.setItem(USER_DATA_KEY, JSON.stringify(userData));
        Logger.log('[saveUserData] Dados salvos com sucesso');
        return true;
    } catch (error) {
        Logger.error('[saveUserData] Erro ao salvar dados:', error);
        return false;
    }
};

/**
 * Limpa os dados de autenticação do AsyncStorage
 */
export const clearAuthData = async () => {
    try {
        await AsyncStorage.multiRemove([AUTH_UID_KEY, USER_DATA_KEY]);
        Logger.log('[clearAuthData] Dados de autenticação limpos com sucesso');
        return true;
    } catch (error) {
        Logger.error('[clearAuthData] Erro ao limpar dados:', error);
        return false;
    }
}; 