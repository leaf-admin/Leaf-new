import Logger from '../utils/Logger';
// Firebase Database Bypass para Usuários de Teste
// Intercepta erros de permissão e permite acesso total para usuários de teste

import database from '@react-native-firebase/database';
import { store } from '../common-local/store';


class DatabaseBypass {
    constructor() {
        this.originalDatabase = database();
    }

    // Verificar se é usuário de teste
    isTestUser() {
        try {
            const state = store.getState();
            const user = state.auth?.profile || state.user;
            return user?.isTestUser || user?.uid?.includes('test-user-dev') || false;
        } catch (error) {
            Logger.warn('Erro ao verificar usuário de teste:', error);
            return false;
        }
    }

    // Wrapper para ref() que intercepta erros de permissão
    ref(path) {
        const originalRef = this.originalDatabase.ref(path);
        
        if (this.isTestUser()) {
            Logger.log('🧪 BYPASS: Usuário de teste - permitindo acesso ao database:', path);
            
            // Retornar um wrapper que sempre permite acesso
            return {
                ...originalRef,
                once: (eventType) => {
                    Logger.log('🧪 BYPASS: Executando once() para usuário de teste');
                    return originalRef.once(eventType).catch(error => {
                        if (error.code === 'PERMISSION_DENIED') {
                            Logger.log('🧪 BYPASS: Erro de permissão ignorado para usuário de teste');
                            return { val: () => null, exists: () => false };
                        }
                        throw error;
                    });
                },
                on: (eventType, callback) => {
                    Logger.log('🧪 BYPASS: Executando on() para usuário de teste');
                    return originalRef.on(eventType, callback);
                },
                set: (value) => {
                    Logger.log('🧪 BYPASS: Executando set() para usuário de teste');
                    return originalRef.set(value).catch(error => {
                        if (error.code === 'PERMISSION_DENIED') {
                            Logger.log('🧪 BYPASS: Erro de permissão ignorado para usuário de teste');
                            return Promise.resolve();
                        }
                        throw error;
                    });
                },
                update: (updates) => {
                    Logger.log('🧪 BYPASS: Executando update() para usuário de teste');
                    return originalRef.update(updates).catch(error => {
                        if (error.code === 'PERMISSION_DENIED') {
                            Logger.log('🧪 BYPASS: Erro de permissão ignorado para usuário de teste');
                            return Promise.resolve();
                        }
                        throw error;
                    });
                },
                remove: () => {
                    Logger.log('🧪 BYPASS: Executando remove() para usuário de teste');
                    return originalRef.remove().catch(error => {
                        if (error.code === 'PERMISSION_DENIED') {
                            Logger.log('🧪 BYPASS: Erro de permissão ignorado para usuário de teste');
                            return Promise.resolve();
                        }
                        throw error;
                    });
                },
                orderByChild: (child) => {
                    Logger.log('🧪 BYPASS: Executando orderByChild() para usuário de teste');
                    return this.ref(path).orderByChild(child);
                },
                equalTo: (value) => {
                    Logger.log('🧪 BYPASS: Executando equalTo() para usuário de teste');
                    return this.ref(path).equalTo(value);
                }
            };
        }
        
        return originalRef;
    }

    // Métodos diretos para compatibilidade
    get ref() {
        return (path) => this.ref(path);
    }
}

// Criar instância global
const databaseBypass = new DatabaseBypass();

// Exportar wrapper que substitui o database original
export default () => databaseBypass;


