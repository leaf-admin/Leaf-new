import AsyncStorage from '@react-native-async-storage/async-storage';
import { firebase } from '../config/configureFirebase';
import { signInWithCustomToken, setPersistence, browserLocalPersistence, inMemoryPersistence } from 'firebase/auth';
import store from '../store/store';

const AUTH_UID_KEY = '@auth_uid';

// Função para configurar a persistência do Firebase Auth
export const configureAuthPersistence = async () => {
    try {
        console.log('Configurando persistência do Firebase Auth...');
        const { auth } = firebase;

        if (typeof document !== 'undefined') {
            // Web: usar browserLocalPersistence
            await setPersistence(auth, browserLocalPersistence);
            console.log('Persistência configurada para web: browserLocalPersistence');
        } else {
            // Mobile: usar inMemoryPersistence (já que estamos usando AsyncStorage)
            await setPersistence(auth, inMemoryPersistence);
            console.log('Persistência configurada para mobile: inMemoryPersistence');
        }

        // Verificar configuração
        console.log('Estado da persistência:', {
            persistenceType: auth._persistenceType,
            currentUser: auth.currentUser ? {
                uid: auth.currentUser.uid,
                email: auth.currentUser.email
            } : null
        });

        return true;
    } catch (error) {
        console.error('Erro ao configurar persistência:', error);
        return false;
    }
};

// Função para verificar se existe uma sessão salva
export const checkPersistedAuth = async () => {
    try {
        console.log('Verificando sessão persistida...');
        const uid = await AsyncStorage.getItem(AUTH_UID_KEY);
        console.log('Valor recuperado do AsyncStorage:', uid);
        
        if (uid) {
            console.log('Sessão encontrada para o UID:', uid);
            return uid;
        }
        console.log('Nenhuma sessão encontrada');
        return null;
    } catch (error) {
        console.error('Erro ao verificar sessão persistida:', error);
        return null;
    }
};

// Função para salvar a sessão
export const saveAuthSession = async (uid) => {
    try {
        console.log('Salvando sessão para UID:', uid);
        await AsyncStorage.setItem(AUTH_UID_KEY, uid);
        console.log('Sessão salva com sucesso');
        return true;
    } catch (error) {
        console.error('Erro ao salvar sessão:', error);
        return false;
    }
};

// Função para limpar a sessão
export const clearAuthSession = async () => {
    try {
        console.log('Limpando sessão...');
        await AsyncStorage.removeItem(AUTH_UID_KEY);
        console.log('Sessão limpa com sucesso');
        return true;
    } catch (error) {
        console.error('Erro ao limpar sessão:', error);
        return false;
    }
}; 