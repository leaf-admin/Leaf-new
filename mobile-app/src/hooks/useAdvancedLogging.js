import Logger from '../utils/Logger';
/**
 * 🎣 HOOK DE LOGS E DEBUGGING AVANÇADO
 * Hook personalizado para facilitar o uso do sistema de logs e debugging
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import advancedLoggingService from '../services/AdvancedLoggingService';


const useAdvancedLogging = (options = {}) => {
    const {
        autoInitialize = true,
        enablePerformance = true,
        enableDebugging = true,
        enableAnalytics = true,
        updateInterval = 5000 // 5 segundos
    } = options;
    
    const [isInitialized, setIsInitialized] = useState(false);
    const [isEnabled, setIsEnabled] = useState(true);
    const [currentLevel, setCurrentLevel] = useState('INFO');
    const [logSummary, setLogSummary] = useState(null);
    const [analytics, setAnalytics] = useState(null);
    const [recentLogs, setRecentLogs] = useState([]);
    const [performanceLogs, setPerformanceLogs] = useState([]);
    const [debuggingLogs, setDebuggingLogs] = useState([]);
    
    const logListenerRef = useRef(null);
    const performanceListenerRef = useRef(null);
    const debuggingListenerRef = useRef(null);
    const updateIntervalRef = useRef(null);
    
    /**
     * Inicializar o serviço de logs
     */
    const initialize = useCallback(async () => {
        try {
            if (!isInitialized) {
                await advancedLoggingService.initialize();
                setIsInitialized(true);
                
                // Configurar listeners
                logListenerRef.current = advancedLoggingService.addLogListener((logEntry) => {
                    setRecentLogs(prev => [logEntry, ...prev.slice(0, 99)]); // Manter últimos 100 logs
                });
                
                if (enablePerformance) {
                    performanceListenerRef.current = advancedLoggingService.addPerformanceListener((performanceEntry) => {
                        setPerformanceLogs(prev => [performanceEntry, ...prev.slice(0, 99)]); // Manter últimos 100 logs
                    });
                }
                
                if (enableDebugging) {
                    debuggingListenerRef.current = advancedLoggingService.addDebuggingListener((debuggingEntry) => {
                        setDebuggingLogs(prev => [debuggingEntry, ...prev.slice(0, 99)]); // Manter últimos 100 logs
                    });
                }
                
                // Atualizar dados periodicamente
                updateIntervalRef.current = setInterval(() => {
                    updateData();
                }, updateInterval);
            }
        } catch (error) {
            Logger.error('❌ Erro ao inicializar hook de logs:', error);
        }
    }, [isInitialized, enablePerformance, enableDebugging, updateInterval]);
    
    /**
     * Registrar log
     */
    const log = useCallback((level, message, data = {}, context = {}) => {
        try {
            advancedLoggingService.log(level, message, data, context);
        } catch (error) {
            Logger.error('❌ Erro ao registrar log:', error);
        }
    }, []);
    
    /**
     * Registrar log de erro
     */
    const logError = useCallback((message, error, data = {}, context = {}) => {
        try {
            const errorData = {
                ...data,
                error: error.message || error,
                stack: error.stack || null
            };
            
            advancedLoggingService.log('ERROR', message, errorData, context);
        } catch (err) {
            Logger.error('❌ Erro ao registrar log de erro:', err);
        }
    }, []);
    
    /**
     * Registrar log de aviso
     */
    const logWarning = useCallback((message, data = {}, context = {}) => {
        try {
            advancedLoggingService.log('WARN', message, data, context);
        } catch (error) {
            Logger.error('❌ Erro ao registrar log de aviso:', error);
        }
    }, []);
    
    /**
     * Registrar log de informação
     */
    const logInfo = useCallback((message, data = {}, context = {}) => {
        try {
            advancedLoggingService.log('INFO', message, data, context);
        } catch (error) {
            Logger.error('❌ Erro ao registrar log de informação:', error);
        }
    }, []);
    
    /**
     * Registrar log de debug
     */
    const logDebug = useCallback((message, data = {}, context = {}) => {
        try {
            advancedLoggingService.log('DEBUG', message, data, context);
        } catch (error) {
            Logger.error('❌ Erro ao registrar log de debug:', error);
        }
    }, []);
    
    /**
     * Registrar log de trace
     */
    const logTrace = useCallback((message, data = {}, context = {}) => {
        try {
            advancedLoggingService.log('TRACE', message, data, context);
        } catch (error) {
            Logger.error('❌ Erro ao registrar log de trace:', error);
        }
    }, []);
    
    /**
     * Registrar log de performance
     */
    const logPerformance = useCallback((operation, duration, data = {}) => {
        try {
            advancedLoggingService.logPerformance(operation, duration, data);
        } catch (error) {
            Logger.error('❌ Erro ao registrar log de performance:', error);
        }
    }, []);
    
    /**
     * Registrar log de debugging
     */
    const logDebugging = useCallback((action, data = {}, context = {}) => {
        try {
            advancedLoggingService.logDebugging(action, data, context);
        } catch (error) {
            Logger.error('❌ Erro ao registrar log de debugging:', error);
        }
    }, []);
    
    /**
     * Medir performance de operação
     */
    const measurePerformance = useCallback(async (operation, operationFunction, data = {}) => {
        try {
            return await advancedLoggingService.measurePerformance(operation, operationFunction, data);
        } catch (error) {
            Logger.error('❌ Erro ao medir performance:', error);
            throw error;
        }
    }, []);
    
    /**
     * Obter logs filtrados
     */
    const getLogs = useCallback((filter = {}) => {
        try {
            return advancedLoggingService.getLogs(filter);
        } catch (error) {
            Logger.error('❌ Erro ao obter logs:', error);
            return [];
        }
    }, []);
    
    /**
     * Obter logs de performance
     */
    const getPerformanceLogs = useCallback((filter = {}) => {
        try {
            return advancedLoggingService.getPerformanceLogs(filter);
        } catch (error) {
            Logger.error('❌ Erro ao obter logs de performance:', error);
            return [];
        }
    }, []);
    
    /**
     * Obter logs de debugging
     */
    const getDebuggingLogs = useCallback((filter = {}) => {
        try {
            return advancedLoggingService.getDebuggingLogs(filter);
        } catch (error) {
            Logger.error('❌ Erro ao obter logs de debugging:', error);
            return [];
        }
    }, []);
    
    /**
     * Obter analytics
     */
    const getAnalytics = useCallback(() => {
        try {
            return advancedLoggingService.getAnalytics();
        } catch (error) {
            Logger.error('❌ Erro ao obter analytics:', error);
            return null;
        }
    }, []);
    
    /**
     * Obter resumo de logs
     */
    const getLogSummary = useCallback(() => {
        try {
            return advancedLoggingService.getLogSummary();
        } catch (error) {
            Logger.error('❌ Erro ao obter resumo de logs:', error);
            return null;
        }
    }, []);
    
    /**
     * Configurar nível de log
     */
    const setLogLevel = useCallback((level) => {
        try {
            advancedLoggingService.setLogLevel(level);
            setCurrentLevel(level);
        } catch (error) {
            Logger.error('❌ Erro ao configurar nível de log:', error);
        }
    }, []);
    
    /**
     * Habilitar/desabilitar logging
     */
    const setLoggingEnabled = useCallback((enabled) => {
        try {
            advancedLoggingService.setEnabled(enabled);
            setIsEnabled(enabled);
        } catch (error) {
            Logger.error('❌ Erro ao configurar logging:', error);
        }
    }, []);
    
    /**
     * Limpar logs
     */
    const clearLogs = useCallback(async () => {
        try {
            await advancedLoggingService.clearLogs();
            setRecentLogs([]);
            setPerformanceLogs([]);
            setDebuggingLogs([]);
            setLogSummary(null);
            setAnalytics(null);
        } catch (error) {
            Logger.error('❌ Erro ao limpar logs:', error);
        }
    }, []);
    
    /**
     * Atualizar dados
     */
    const updateData = useCallback(() => {
        try {
            if (isInitialized) {
                const summary = advancedLoggingService.getLogSummary();
                setLogSummary(summary);
                
                if (enableAnalytics) {
                    const analyticsData = advancedLoggingService.getAnalytics();
                    setAnalytics(analyticsData);
                }
            }
        } catch (error) {
            Logger.error('❌ Erro ao atualizar dados:', error);
        }
    }, [isInitialized, enableAnalytics]);
    
    /**
     * Obter estatísticas de logs
     */
    const getLogStats = useCallback(() => {
        try {
            if (!logSummary) return null;
            
            return {
                totalLogs: logSummary.totalLogs,
                errorCount: logSummary.analytics.errorCount,
                warningCount: logSummary.analytics.warningCount,
                infoCount: logSummary.analytics.infoCount,
                debugCount: logSummary.analytics.debugCount,
                traceCount: logSummary.analytics.traceCount,
                errorRate: logSummary.totalLogs > 0 ? (logSummary.analytics.errorCount / logSummary.totalLogs) * 100 : 0,
                warningRate: logSummary.totalLogs > 0 ? (logSummary.analytics.warningCount / logSummary.totalLogs) * 100 : 0
            };
        } catch (error) {
            Logger.error('❌ Erro ao obter estatísticas de logs:', error);
            return null;
        }
    }, [logSummary]);
    
    /**
     * Obter estatísticas de performance
     */
    const getPerformanceStats = useCallback(() => {
        try {
            if (performanceLogs.length === 0) return null;
            
            const totalDuration = performanceLogs.reduce((sum, log) => sum + log.duration, 0);
            const averageDuration = totalDuration / performanceLogs.length;
            const slowOperations = performanceLogs.filter(log => log.isSlow).length;
            const slowOperationRate = (slowOperations / performanceLogs.length) * 100;
            
            return {
                totalOperations: performanceLogs.length,
                averageDuration,
                slowOperations,
                slowOperationRate,
                maxDuration: Math.max(...performanceLogs.map(log => log.duration)),
                minDuration: Math.min(...performanceLogs.map(log => log.duration))
            };
        } catch (error) {
            Logger.error('❌ Erro ao obter estatísticas de performance:', error);
            return null;
        }
    }, [performanceLogs]);
    
    /**
     * Obter estatísticas de debugging
     */
    const getDebuggingStats = useCallback(() => {
        try {
            if (debuggingLogs.length === 0) return null;
            
            const actionCounts = {};
            debuggingLogs.forEach(log => {
                actionCounts[log.action] = (actionCounts[log.action] || 0) + 1;
            });
            
            const screenCounts = {};
            debuggingLogs.forEach(log => {
                const screen = log.context.screen || 'unknown';
                screenCounts[screen] = (screenCounts[screen] || 0) + 1;
            });
            
            return {
                totalActions: debuggingLogs.length,
                actionCounts,
                screenCounts,
                mostUsedAction: Object.keys(actionCounts).reduce((a, b) => actionCounts[a] > actionCounts[b] ? a : b),
                mostUsedScreen: Object.keys(screenCounts).reduce((a, b) => screenCounts[a] > screenCounts[b] ? a : b)
            };
        } catch (error) {
            Logger.error('❌ Erro ao obter estatísticas de debugging:', error);
            return null;
        }
    }, [debuggingLogs]);
    
    /**
     * Obter padrões detectados
     */
    const getDetectedPatterns = useCallback(() => {
        try {
            if (!analytics) return null;
            
            return {
                patterns: analytics.patterns,
                anomalies: analytics.anomalies,
                trends: analytics.trends,
                lastPatternAnalysis: analytics.patterns.length > 0 ? analytics.patterns[analytics.patterns.length - 1].timestamp : null,
                lastAnomalyDetection: analytics.anomalies.length > 0 ? analytics.anomalies[analytics.anomalies.length - 1].timestamp : null,
                lastTrendAnalysis: analytics.trends.length > 0 ? analytics.trends[analytics.trends.length - 1].timestamp : null
            };
        } catch (error) {
            Logger.error('❌ Erro ao obter padrões detectados:', error);
            return null;
        }
    }, [analytics]);
    
    /**
     * Exportar logs
     */
    const exportLogs = useCallback((format = 'json') => {
        try {
            const exportData = {
                logs: recentLogs,
                performanceLogs: performanceLogs,
                debuggingLogs: debuggingLogs,
                analytics: analytics,
                summary: logSummary,
                exportTime: Date.now(),
                format: format
            };
            
            if (format === 'json') {
                return JSON.stringify(exportData, null, 2);
            } else if (format === 'csv') {
                // Implementar exportação CSV se necessário
                return 'CSV export not implemented';
            }
            
            return exportData;
        } catch (error) {
            Logger.error('❌ Erro ao exportar logs:', error);
            return null;
        }
    }, [recentLogs, performanceLogs, debuggingLogs, analytics, logSummary]);
    
    // Inicializar automaticamente se solicitado
    useEffect(() => {
        if (autoInitialize && !isInitialized) {
            initialize();
        }
        
        return () => {
            // Cleanup
            if (logListenerRef.current) {
                logListenerRef.current();
            }
            if (performanceListenerRef.current) {
                performanceListenerRef.current();
            }
            if (debuggingListenerRef.current) {
                debuggingListenerRef.current();
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
        isEnabled,
        currentLevel,
        logSummary,
        analytics,
        recentLogs,
        performanceLogs,
        debuggingLogs,
        
        // Métodos principais
        initialize,
        log,
        logError,
        logWarning,
        logInfo,
        logDebug,
        logTrace,
        logPerformance,
        logDebugging,
        measurePerformance,
        
        // Métodos de consulta
        getLogs,
        getPerformanceLogs,
        getDebuggingLogs,
        getAnalytics,
        getLogSummary,
        
        // Métodos de configuração
        setLogLevel,
        setLoggingEnabled,
        clearLogs,
        
        // Métodos de análise
        getLogStats,
        getPerformanceStats,
        getDebuggingStats,
        getDetectedPatterns,
        exportLogs
    };
};

export default useAdvancedLogging;






