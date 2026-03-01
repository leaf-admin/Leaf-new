import Logger from '../utils/Logger';
/**
 * 🎣 HOOK DE PERSISTÊNCIA OFFLINE
 * Hook personalizado para facilitar o uso do sistema offline
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Alert } from 'react-native';
import offlinePersistenceService from '../services/OfflinePersistenceService';


const useOfflinePersistence = (options = {}) => {
    const {
        autoInitialize = true,
        showOfflineAlert = true,
        syncOnConnect = true
    } = options;
    
    const [isOnline, setIsOnline] = useState(true);
    const [isInitialized, setIsInitialized] = useState(false);
    const [queueSize, setQueueSize] = useState(0);
    const [syncInProgress, setSyncInProgress] = useState(false);
    const [metrics, setMetrics] = useState(null);
    
    const connectivityListenerRef = useRef(null);
    const syncIntervalRef = useRef(null);
    
    /**
     * Inicializar o serviço offline
     */
    const initialize = useCallback(async () => {
        try {
            if (!isInitialized) {
                await offlinePersistenceService.initialize();
                setIsInitialized(true);
                
                // Configurar listener de conectividade
                connectivityListenerRef.current = offlinePersistenceService.addConnectivityListener((online) => {
                    setIsOnline(online);
                    
                    if (showOfflineAlert && !online) {
                        Alert.alert(
                            '📱 Modo Offline',
                            'Você está offline. Suas ações serão sincronizadas quando a conexão for restaurada.',
                            [{ text: 'OK' }]
                        );
                    }
                });
                
                // Atualizar métricas periodicamente
                syncIntervalRef.current = setInterval(() => {
                    updateMetrics();
                }, 5000);
                
                // Sincronizar ao conectar
                if (syncOnConnect && isOnline) {
                    await syncOfflineOperations();
                }
            }
        } catch (error) {
            Logger.error('❌ Erro ao inicializar hook offline:', error);
        }
    }, [isInitialized, showOfflineAlert, syncOnConnect, isOnline]);
    
    /**
     * Executar operação offline
     */
    const executeOperation = useCallback(async (operation, data, operationOptions = {}) => {
        try {
            if (!isInitialized) {
                await initialize();
            }
            
            const result = await offlinePersistenceService.executeOfflineOperation(
                operation,
                data,
                operationOptions
            );
            
            // Atualizar métricas
            updateMetrics();
            
            return result;
            
        } catch (error) {
            Logger.error('❌ Erro ao executar operação offline:', error);
            throw error;
        }
    }, [isInitialized, initialize]);
    
    /**
     * Sincronizar operações offline
     */
    const syncOfflineOperations = useCallback(async () => {
        try {
            if (!isOnline) {
                throw new Error('Não é possível sincronizar offline');
            }
            
            setSyncInProgress(true);
            await offlinePersistenceService.forceSync();
            updateMetrics();
            
        } catch (error) {
            Logger.error('❌ Erro na sincronização:', error);
            throw error;
        } finally {
            setSyncInProgress(false);
        }
    }, [isOnline]);
    
    /**
     * Salvar estado do usuário
     */
    const saveUserState = useCallback(async (userState) => {
        try {
            await offlinePersistenceService.saveUserState(userState);
        } catch (error) {
            Logger.error('❌ Erro ao salvar estado do usuário:', error);
        }
    }, []);
    
    /**
     * Carregar estado do usuário
     */
    const loadUserState = useCallback(async () => {
        try {
            return await offlinePersistenceService.loadUserState();
        } catch (error) {
            Logger.error('❌ Erro ao carregar estado do usuário:', error);
            return null;
        }
    }, []);
    
    /**
     * Salvar estado da corrida
     */
    const saveRideState = useCallback(async (rideState) => {
        try {
            await offlinePersistenceService.saveRideState(rideState);
        } catch (error) {
            Logger.error('❌ Erro ao salvar estado da corrida:', error);
        }
    }, []);
    
    /**
     * Carregar estado da corrida
     */
    const loadRideState = useCallback(async () => {
        try {
            return await offlinePersistenceService.loadRideState();
        } catch (error) {
            Logger.error('❌ Erro ao carregar estado da corrida:', error);
            return null;
        }
    }, []);
    
    /**
     * Atualizar métricas
     */
    const updateMetrics = useCallback(() => {
        try {
            const currentMetrics = offlinePersistenceService.getMetrics();
            setMetrics(currentMetrics);
            setQueueSize(currentMetrics.queueSize);
        } catch (error) {
            Logger.error('❌ Erro ao atualizar métricas:', error);
        }
    }, []);
    
    /**
     * Limpar dados offline
     */
    const clearOfflineData = useCallback(async () => {
        try {
            await offlinePersistenceService.clearOfflineData();
            updateMetrics();
        } catch (error) {
            Logger.error('❌ Erro ao limpar dados offline:', error);
        }
    }, [updateMetrics]);
    
    /**
     * Verificar se está online
     */
    const checkConnection = useCallback(() => {
        return offlinePersistenceService.isConnected();
    }, []);
    
    /**
     * Obter tamanho da fila
     */
    const getQueueSize = useCallback(() => {
        return offlinePersistenceService.getQueueSize();
    }, []);
    
    // Inicializar automaticamente se solicitado
    useEffect(() => {
        if (autoInitialize && !isInitialized) {
            initialize();
        }
        
        return () => {
            // Cleanup
            if (connectivityListenerRef.current) {
                connectivityListenerRef.current();
            }
            if (syncIntervalRef.current) {
                clearInterval(syncIntervalRef.current);
            }
        };
    }, [autoInitialize, isInitialized, initialize]);
    
    // Atualizar métricas quando o componente monta
    useEffect(() => {
        if (isInitialized) {
            updateMetrics();
        }
    }, [isInitialized, updateMetrics]);
    
    return {
        // Estados
        isOnline,
        isInitialized,
        queueSize,
        syncInProgress,
        metrics,
        
        // Métodos
        initialize,
        executeOperation,
        syncOfflineOperations,
        saveUserState,
        loadUserState,
        saveRideState,
        loadRideState,
        clearOfflineData,
        checkConnection,
        getQueueSize,
        updateMetrics
    };
};

export default useOfflinePersistence;






