import Logger from '../utils/Logger';
/**
 * 🎣 HOOK DE CACHE INTELIGENTE
 * Hook personalizado para facilitar o uso do sistema de cache inteligente
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import intelligentCacheService from '../services/IntelligentCacheService';


const useIntelligentCache = (options = {}) => {
    const {
        autoInitialize = true,
        enablePredictive = true,
        enableAdaptive = true,
        enableWebSocket = true,
        enableFallback = true,
        updateInterval = 10000 // 10 segundos
    } = options;
    
    const [isInitialized, setIsInitialized] = useState(false);
    const [isPredictiveEnabled, setIsPredictiveEnabled] = useState(false);
    const [isAdaptiveEnabled, setIsAdaptiveEnabled] = useState(false);
    const [analytics, setAnalytics] = useState(null);
    const [cacheStatus, setCacheStatus] = useState({
        predictive: 0,
        adaptive: 0,
        websocket: 0,
        fallback: 0
    });
    
    const eventListenerRef = useRef(null);
    const updateIntervalRef = useRef(null);
    
    /**
     * Inicializar o serviço de cache inteligente
     */
    const initialize = useCallback(async () => {
        try {
            if (!isInitialized) {
                await intelligentCacheService.initialize();
                setIsInitialized(true);
                
                // Configurar listener de eventos
                eventListenerRef.current = intelligentCacheService.addEventListener((event) => {
                    Logger.log(`🧠 Cache Event: ${event.type}`, event.data);
                });
                
                // Atualizar dados periodicamente
                updateIntervalRef.current = setInterval(() => {
                    updateData();
                }, updateInterval);
                
                // Configurar funcionalidades
                if (enablePredictive) {
                    setIsPredictiveEnabled(true);
                }
                if (enableAdaptive) {
                    setIsAdaptiveEnabled(true);
                }
            }
        } catch (error) {
            Logger.error('❌ Erro ao inicializar hook de cache inteligente:', error);
        }
    }, [isInitialized, enablePredictive, enableAdaptive, updateInterval]);
    
    /**
     * Obter dados do cache
     */
    const getCacheData = useCallback((key, type = 'predictive') => {
        try {
            return intelligentCacheService.getCacheData(key, type);
        } catch (error) {
            Logger.error('❌ Erro ao obter dados do cache:', error);
            return null;
        }
    }, []);
    
    /**
     * Salvar dados no cache
     */
    const setCacheData = useCallback((key, data, type = 'predictive', ttl = null) => {
        try {
            return intelligentCacheService.setCacheData(key, data, type, ttl);
        } catch (error) {
            Logger.error('❌ Erro ao salvar dados no cache:', error);
            return false;
        }
    }, []);
    
    /**
     * Obter dados predictivos
     */
    const getPredictiveData = useCallback((location = null, time = null) => {
        try {
            if (location) {
                const key = `predictive_location_${location.lat}_${location.lng}`;
                return getCacheData(key, 'predictive');
            }
            
            if (time) {
                const key = `predictive_time_${time}`;
                return getCacheData(key, 'predictive');
            }
            
            return null;
        } catch (error) {
            Logger.error('❌ Erro ao obter dados predictivos:', error);
            return null;
        }
    }, [getCacheData]);
    
    /**
     * Obter dados adaptativos
     */
    const getAdaptiveData = useCallback((key) => {
        try {
            return getCacheData(key, 'adaptive');
        } catch (error) {
            Logger.error('❌ Erro ao obter dados adaptativos:', error);
            return null;
        }
    }, [getCacheData]);
    
    /**
     * Obter dados de WebSocket
     */
    const getWebSocketData = useCallback((eventType) => {
        try {
            const key = `websocket_${eventType}`;
            return getCacheData(key, 'websocket');
        } catch (error) {
            Logger.error('❌ Erro ao obter dados de WebSocket:', error);
            return null;
        }
    }, [getCacheData]);
    
    /**
     * Obter dados de fallback
     */
    const getFallbackData = useCallback((dataType) => {
        try {
            const key = `fallback_${dataType}`;
            return getCacheData(key, 'fallback');
        } catch (error) {
            Logger.error('❌ Erro ao obter dados de fallback:', error);
            return null;
        }
    }, [getCacheData]);
    
    /**
     * Pre-carregar dados predictivos
     */
    const preloadPredictiveData = useCallback(async (location, time = null) => {
        try {
            if (location) {
                const key = `predictive_location_${location.lat}_${location.lng}`;
                const data = {
                    type: 'location',
                    location,
                    nearbyDrivers: await getNearbyDrivers(location),
                    commonRoutes: await getCommonRoutes(location)
                };
                return setCacheData(key, data, 'predictive');
            }
            
            if (time) {
                const key = `predictive_time_${time}`;
                const data = {
                    type: 'time',
                    time,
                    commonDestinations: await getCommonDestinationsForTime(time),
                    expectedDemand: await getExpectedDemandForTime(time)
                };
                return setCacheData(key, data, 'predictive');
            }
            
            return false;
        } catch (error) {
            Logger.error('❌ Erro ao pre-carregar dados predictivos:', error);
            return false;
        }
    }, [setCacheData]);
    
    /**
     * Simular busca de motoristas próximos
     */
    const getNearbyDrivers = useCallback(async (location) => {
        try {
            // Simular busca de motoristas próximos
            return [
                { id: 'driver_1', lat: location.lat + 0.001, lng: location.lng + 0.001, distance: 100 },
                { id: 'driver_2', lat: location.lat - 0.001, lng: location.lng - 0.001, distance: 200 },
                { id: 'driver_3', lat: location.lat + 0.002, lng: location.lng - 0.001, distance: 300 }
            ];
        } catch (error) {
            Logger.error('❌ Erro ao buscar motoristas próximos:', error);
            return [];
        }
    }, []);
    
    /**
     * Simular busca de rotas comuns
     */
    const getCommonRoutes = useCallback(async (location) => {
        try {
            // Simular rotas comuns
            return [
                { destination: { lat: location.lat + 0.01, lng: location.lng + 0.01 }, frequency: 0.8 },
                { destination: { lat: location.lat - 0.01, lng: location.lng - 0.01 }, frequency: 0.6 },
                { destination: { lat: location.lat + 0.02, lng: location.lng - 0.01 }, frequency: 0.4 }
            ];
        } catch (error) {
            Logger.error('❌ Erro ao buscar rotas comuns:', error);
            return [];
        }
    }, []);
    
    /**
     * Simular destinos comuns para horário
     */
    const getCommonDestinationsForTime = useCallback(async (time) => {
        try {
            // Simular destinos comuns baseados no horário
            const destinations = {
                8: [{ lat: -23.5505, lng: -46.6333, name: 'Centro', frequency: 0.9 }],
                12: [{ lat: -23.5615, lng: -46.6553, name: 'Shopping', frequency: 0.7 }],
                18: [{ lat: -23.5700, lng: -46.6400, name: 'Casa', frequency: 0.8 }]
            };
            
            return destinations[time] || [];
        } catch (error) {
            Logger.error('❌ Erro ao buscar destinos comuns:', error);
            return [];
        }
    }, []);
    
    /**
     * Simular demanda esperada para horário
     */
    const getExpectedDemandForTime = useCallback(async (time) => {
        try {
            // Simular demanda esperada baseada no horário
            const demand = {
                8: { level: 'high', multiplier: 1.5, description: 'Pico da manhã' },
                12: { level: 'medium', multiplier: 1.2, description: 'Horário de almoço' },
                18: { level: 'high', multiplier: 1.8, description: 'Pico da tarde' }
            };
            
            return demand[time] || { level: 'low', multiplier: 1.0, description: 'Horário normal' };
        } catch (error) {
            Logger.error('❌ Erro ao buscar demanda esperada:', error);
            return { level: 'low', multiplier: 1.0, description: 'Horário normal' };
        }
    }, []);
    
    /**
     * Atualizar dados
     */
    const updateData = useCallback(() => {
        try {
            const currentAnalytics = intelligentCacheService.getCacheAnalytics();
            setAnalytics(currentAnalytics);
            
            setCacheStatus({
                predictive: currentAnalytics.predictiveSize,
                adaptive: currentAnalytics.adaptiveSize,
                websocket: currentAnalytics.websocketSize,
                fallback: currentAnalytics.fallbackSize
            });
            
        } catch (error) {
            Logger.error('❌ Erro ao atualizar dados:', error);
        }
    }, []);
    
    /**
     * Obter estatísticas do cache
     */
    const getCacheStats = useCallback(() => {
        try {
            return {
                hitRate: analytics?.hitRate || 0,
                totalHits: analytics?.hits || 0,
                totalMisses: analytics?.misses || 0,
                predictions: analytics?.predictions || 0,
                adaptations: analytics?.adaptations || 0,
                cacheStatus
            };
        } catch (error) {
            Logger.error('❌ Erro ao obter estatísticas:', error);
            return null;
        }
    }, [analytics, cacheStatus]);
    
    /**
     * Limpar cache específico
     */
    const clearCache = useCallback((type = 'all') => {
        try {
            if (type === 'all') {
                // Limpar todos os caches
                intelligentCacheService.cacheData.predictive.clear();
                intelligentCacheService.cacheData.adaptive.clear();
                intelligentCacheService.cacheData.websocket.clear();
                intelligentCacheService.cacheData.fallback.clear();
            } else if (intelligentCacheService.cacheData[type]) {
                intelligentCacheService.cacheData[type].clear();
            }
            
            updateData();
            Logger.log(`🧠 Cache ${type} limpo`);
            
        } catch (error) {
            Logger.error('❌ Erro ao limpar cache:', error);
        }
    }, [updateData]);
    
    /**
     * Forçar análise adaptativa
     */
    const forceAdaptiveAnalysis = useCallback(async () => {
        try {
            await intelligentCacheService.performAdaptiveAnalysis();
            updateData();
        } catch (error) {
            Logger.error('❌ Erro na análise adaptativa:', error);
        }
    }, [updateData]);
    
    /**
     * Forçar pre-carregamento predictivo
     */
    const forcePredictivePreload = useCallback(async () => {
        try {
            await intelligentCacheService.performPredictivePreload();
            updateData();
        } catch (error) {
            Logger.error('❌ Erro no pre-carregamento predictivo:', error);
        }
    }, [updateData]);
    
    // Inicializar automaticamente se solicitado
    useEffect(() => {
        if (autoInitialize && !isInitialized) {
            initialize();
        }
        
        return () => {
            // Cleanup
            if (eventListenerRef.current) {
                eventListenerRef.current();
            }
            if (updateIntervalRef.current) {
                clearInterval(updateIntervalRef.current);
            }
        };
    }, [autoInitialize, isInitialized, initialize]);
    
    // Atualizar dados quando o componente monta
    useEffect(() => {
        if (isInitialized) {
            updateData();
        }
    }, [isInitialized, updateData]);
    
    return {
        // Estados
        isInitialized,
        isPredictiveEnabled,
        isAdaptiveEnabled,
        analytics,
        cacheStatus,
        
        // Métodos principais
        initialize,
        getCacheData,
        setCacheData,
        
        // Métodos específicos
        getPredictiveData,
        getAdaptiveData,
        getWebSocketData,
        getFallbackData,
        
        // Métodos de pre-carregamento
        preloadPredictiveData,
        
        // Métodos utilitários
        updateData,
        getCacheStats,
        clearCache,
        forceAdaptiveAnalysis,
        forcePredictivePreload
    };
};

export default useIntelligentCache;






