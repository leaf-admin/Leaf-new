import Logger from '../utils/Logger';
/**
 * 🎣 HOOK DE MONITORAMENTO EM TEMPO REAL
 * Hook personalizado para facilitar o uso do sistema de monitoramento
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Alert } from 'react-native';
import realTimeMonitoringService from '../services/RealTimeMonitoringService';


const useRealTimeMonitoring = (options = {}) => {
    const {
        autoInitialize = true,
        autoStartCollection = true,
        showAlerts = true,
        updateInterval = 5000 // 5 segundos
    } = options;
    
    const [isInitialized, setIsInitialized] = useState(false);
    const [isCollecting, setIsCollecting] = useState(false);
    const [metrics, setMetrics] = useState(null);
    const [dashboard, setDashboard] = useState(null);
    const [alerts, setAlerts] = useState([]);
    
    const alertListenerRef = useRef(null);
    const updateIntervalRef = useRef(null);
    
    /**
     * Inicializar o serviço de monitoramento
     */
    const initialize = useCallback(async () => {
        try {
            if (!isInitialized) {
                await realTimeMonitoringService.initialize();
                setIsInitialized(true);
                
                // Configurar listener de alertas
                alertListenerRef.current = realTimeMonitoringService.addAlertListener((alert) => {
                    setAlerts(prev => [...prev, alert]);
                    
                    if (showAlerts) {
                        const alertTitle = alert.severity === 'critical' ? '🚨 Alerta Crítico' : 
                                          alert.severity === 'warning' ? '⚠️ Alerta' : 'ℹ️ Informação';
                        
                        Alert.alert(
                            alertTitle,
                            alert.message,
                            [{ text: 'OK' }]
                        );
                    }
                });
                
                // Atualizar dados periodicamente
                updateIntervalRef.current = setInterval(() => {
                    updateData();
                }, updateInterval);
                
                // Iniciar coleta automaticamente se solicitado
                if (autoStartCollection) {
                    startCollection();
                }
            }
        } catch (error) {
            Logger.error('❌ Erro ao inicializar hook de monitoramento:', error);
        }
    }, [isInitialized, showAlerts, updateInterval, autoStartCollection]);
    
    /**
     * Iniciar coleta de métricas
     */
    const startCollection = useCallback(() => {
        try {
            realTimeMonitoringService.startCollection();
            setIsCollecting(true);
        } catch (error) {
            Logger.error('❌ Erro ao iniciar coleta:', error);
        }
    }, []);
    
    /**
     * Parar coleta de métricas
     */
    const stopCollection = useCallback(() => {
        try {
            realTimeMonitoringService.stopCollection();
            setIsCollecting(false);
        } catch (error) {
            Logger.error('❌ Erro ao parar coleta:', error);
        }
    }, []);
    
    /**
     * Registrar evento
     */
    const recordEvent = useCallback((eventType, data) => {
        try {
            realTimeMonitoringService.recordEvent(eventType, data);
        } catch (error) {
            Logger.error('❌ Erro ao registrar evento:', error);
        }
    }, []);
    
    /**
     * Atualizar dados
     */
    const updateData = useCallback(() => {
        try {
            const currentMetrics = realTimeMonitoringService.getMetrics();
            const currentDashboard = realTimeMonitoringService.getDashboard();
            
            setMetrics(currentMetrics);
            setDashboard(currentDashboard);
            setIsCollecting(currentMetrics.isCollecting);
            
        } catch (error) {
            Logger.error('❌ Erro ao atualizar dados:', error);
        }
    }, []);
    
    /**
     * Obter métricas específicas
     */
    const getPerformanceMetrics = useCallback(() => {
        return metrics?.performance || null;
    }, [metrics]);
    
    const getUserMetrics = useCallback(() => {
        return metrics?.user || null;
    }, [metrics]);
    
    const getSystemMetrics = useCallback(() => {
        return metrics?.system || null;
    }, [metrics]);
    
    const getBusinessMetrics = useCallback(() => {
        return metrics?.business || null;
    }, [metrics]);
    
    /**
     * Obter resumo do dashboard
     */
    const getDashboardSummary = useCallback(() => {
        return dashboard?.summary || null;
    }, [dashboard]);
    
    /**
     * Obter dados de gráficos
     */
    const getChartData = useCallback((category, metric) => {
        return dashboard?.charts?.[category]?.[metric] || [];
    }, [dashboard]);
    
    /**
     * Obter alertas ativos
     */
    const getActiveAlerts = useCallback(() => {
        return alerts.filter(alert => {
            const timeDiff = Date.now() - alert.timestamp;
            return timeDiff < 300000; // Últimos 5 minutos
        });
    }, [alerts]);
    
    /**
     * Limpar alertas
     */
    const clearAlerts = useCallback(() => {
        setAlerts([]);
    }, []);
    
    /**
     * Limpar métricas antigas
     */
    const cleanupOldMetrics = useCallback(async () => {
        try {
            await realTimeMonitoringService.cleanupOldMetrics();
            updateData();
        } catch (error) {
            Logger.error('❌ Erro ao limpar métricas antigas:', error);
        }
    }, [updateData]);
    
    /**
     * Exportar métricas
     */
    const exportMetrics = useCallback(() => {
        try {
            const exportData = {
                timestamp: Date.now(),
                metrics,
                dashboard,
                alerts
            };
            
            return JSON.stringify(exportData, null, 2);
        } catch (error) {
            Logger.error('❌ Erro ao exportar métricas:', error);
            return null;
        }
    }, [metrics, dashboard, alerts]);
    
    /**
     * Verificar saúde do sistema
     */
    const getSystemHealth = useCallback(() => {
        if (!metrics) return null;
        
        const health = {
            status: 'healthy',
            score: 100,
            issues: []
        };
        
        // Verificar métricas de performance
        if (metrics.performance?.responseTime?.length > 0) {
            const latestResponseTime = metrics.performance.responseTime[metrics.performance.responseTime.length - 1];
            if (latestResponseTime.websocket?.latency > 5000) {
                health.status = 'warning';
                health.score -= 20;
                health.issues.push('Latência alta detectada');
            }
        }
        
        // Verificar métricas de sistema
        if (metrics.system?.memoryUsage?.length > 0) {
            const latestMemoryUsage = metrics.system.memoryUsage[metrics.system.memoryUsage.length - 1];
            if (latestMemoryUsage.memoryUsage > 0.8) {
                health.status = 'critical';
                health.score -= 30;
                health.issues.push('Uso de memória alto');
            }
        }
        
        // Verificar conectividade
        if (!metrics.offline?.isOnline) {
            health.status = 'warning';
            health.score -= 15;
            health.issues.push('Sistema offline');
        }
        
        return health;
    }, [metrics]);
    
    // Inicializar automaticamente se solicitado
    useEffect(() => {
        if (autoInitialize && !isInitialized) {
            initialize();
        }
        
        return () => {
            // Cleanup
            if (alertListenerRef.current) {
                alertListenerRef.current();
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
        isCollecting,
        metrics,
        dashboard,
        alerts,
        
        // Métodos principais
        initialize,
        startCollection,
        stopCollection,
        recordEvent,
        updateData,
        
        // Métodos de métricas
        getPerformanceMetrics,
        getUserMetrics,
        getSystemMetrics,
        getBusinessMetrics,
        
        // Métodos de dashboard
        getDashboardSummary,
        getChartData,
        
        // Métodos de alertas
        getActiveAlerts,
        clearAlerts,
        
        // Métodos utilitários
        cleanupOldMetrics,
        exportMetrics,
        getSystemHealth
    };
};

export default useRealTimeMonitoring;






