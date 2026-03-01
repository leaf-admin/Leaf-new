import Logger from '../utils/Logger';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { firebase } from './config/configureFirebase';
import { api } from '../api';
import { store } from '../store/store';
import { getAuth } from '@react-native-firebase/auth';
import { signInWithCustomToken, setPersistence, browserLocalPersistence, inMemoryPersistence } from '@react-native-firebase/auth';


const AUTH_UID_KEY = '@auth_uid';

// Função para configurar a persistência do Firebase Auth
export const configureAuthPersistence = async () => {
    try {
        Logger.log('Configurando persistência do Firebase Auth...');
        const { auth } = firebase;

        if (typeof document !== 'undefined') {
            // Web: usar browserLocalPersistence
            await setPersistence(auth, browserLocalPersistence);
            Logger.log('Persistência configurada para web: browserLocalPersistence');
        } else {
            // Mobile: usar inMemoryPersistence (já que estamos usando AsyncStorage)
            await setPersistence(auth, inMemoryPersistence);
            Logger.log('Persistência configurada para mobile: inMemoryPersistence');
        }

        // Verificar configuração
        Logger.log('Estado da persistência:', {
            persistenceType: auth._persistenceType,
            currentUser: auth.currentUser ? {
                uid: auth.currentUser.uid,
                email: auth.currentUser.email
            } : null
        });

        return true;
    } catch (error) {
        Logger.error('Erro ao configurar persistência:', error);
        return false;
    }
};

// Função para verificar se existe uma sessão salva
export const checkPersistedAuth = async () => {
    try {
        Logger.log('Verificando sessão persistida...');
        const uid = await AsyncStorage.getItem(AUTH_UID_KEY);
        Logger.log('Valor recuperado do AsyncStorage:', uid);
        
        if (uid) {
            Logger.log('Sessão encontrada para o UID:', uid);
            return uid;
        }
        Logger.log('Nenhuma sessão encontrada');
        return null;
    } catch (error) {
        Logger.error('Erro ao verificar sessão persistida:', error);
        return null;
    }
};

// Função para salvar a sessão
export const saveAuthSession = async (uid) => {
    try {
        Logger.log('Salvando sessão para UID:', uid);
        await AsyncStorage.setItem(AUTH_UID_KEY, uid);
        Logger.log('Sessão salva com sucesso');
        return true;
    } catch (error) {
        Logger.error('Erro ao salvar sessão:', error);
        return false;
    }
};

// Função para limpar a sessão
export const clearAuthSession = async () => {
    try {
        Logger.log('Limpando sessão...');
        await AsyncStorage.removeItem(AUTH_UID_KEY);
        Logger.log('Sessão limpa com sucesso');
        return true;
    } catch (error) {
        Logger.error('Erro ao limpar sessão:', error);
        return false;
    }
}; 