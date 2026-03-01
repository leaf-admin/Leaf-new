import Logger from '../utils/Logger';
/**
 * 📝 SISTEMA DE LOGS E DEBUGGING AVANÇADO
 * Sistema completo de logs, debugging e análise de performance
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import WebSocketManager from './WebSocketManager';
import IntelligentFallbackService from './IntelligentFallbackService';
import offlinePersistenceService from './OfflinePersistenceService';
import realTimeMonitoringService from './RealTimeMonitoringService';
import intelligentCacheService from './IntelligentCacheService';


class AdvancedLoggingService {
    constructor() {
        this.wsManager = WebSocketManager.getInstance();
        this.fallbackService = IntelligentFallbackService;
        this.offlineService = offlinePersistenceService;
        this.monitoringService = realTimeMonitoringService;
        this.cacheService = intelligentCacheService;
        
        // Configurações de logging
        this.config = {
            // Níveis de log
            levels: {
                ERROR: 0,
                WARN: 1,
                INFO: 2,
                DEBUG: 3,
                TRACE: 4
            },
            
            // Configurações de armazenamento
            storage: {
                maxLogs: 10000,
                maxFileSize: 50 * 1024 * 1024, // 50MB
                compressionEnabled: true,
                encryptionEnabled: false
            },
            
            // Configurações de performance
            performance: {
                enabled: true,
                slowOperationThreshold: 1000, // 1 segundo
                memoryThreshold: 100 * 1024 * 1024, // 100MB
                cpuThreshold: 80 // 80%
            },
            
            // Configurações de debugging
            debugging: {
                enabled: true,
                stackTraceEnabled: true,
                contextEnabled: true,
                userActionsEnabled: true,
                networkEnabled: true
            },
            
            // Configurações de análise
            analytics: {
                enabled: true,
                patternsEnabled: true,
                anomaliesEnabled: true,
                trendsEnabled: true
            },
            
            // Storage keys
            storageKeys: {
                logs: '@advanced_logs',
                performance: '@performance_logs',
                debugging: '@debugging_logs',
                analytics: '@analytics_logs',
                config: '@logging_config'
            }
        };
        
        // Estados
        this.isInitialized = false;
        this.currentLevel = this.config.levels.INFO;
        this.isEnabled = true;
        
        // Dados de log
        this.logs = [];
        this.performanceLogs = [];
        this.debuggingLogs = [];
        this.analyticsData = {
            patterns: [],
            anomalies: [],
            trends: [],
            summary: {
                totalLogs: 0,
                errorCount: 0,
                warningCount: 0,
                infoCount: 0,
                debugCount: 0,
                traceCount: 0
            }
        };
        
        // Listeners
        this.logListeners = [];
        this.performanceListeners = [];
        this.debuggingListeners = [];
        
        // Métricas de performance
        this.performanceMetrics = {
            startTime: Date.now(),
            operationCount: 0,
            slowOperations: [],
            memoryUsage: [],
            cpuUsage: []
        };
        
        Logger.log('📝 Sistema de logs e debugging avançado inicializado');
    }

    /**
     * Inicializar o sistema de logs
     */
    async initialize() {
        try {
            Logger.log('📝 Inicializando sistema de logs e debugging...');
            
            // 1. Carregar configurações existentes
            await this.loadConfiguration();
            
            // 2. Carregar logs existentes
            await this.loadExistingLogs();
            
            // 3. Configurar listeners de sistema
            this.setupSystemListeners();
            
            // 4. Configurar monitoramento de performance
            this.setupPerformanceMonitoring();
            
            // 5. Configurar análise de padrões
            this.setupPatternAnalysis();
            
            this.isInitialized = true;
            Logger.log('✅ Sistema de logs e debugging inicializado');
            
        } catch (error) {
            Logger.error('❌ Erro ao inicializar sistema de logs:', error);
            throw error;
        }
    }

    /**
     * Carregar configurações existentes
     */
    async loadConfiguration() {
        try {
            const config = await AsyncStorage.getItem(this.config.storageKeys.config);
            if (config) {
                const savedConfig = JSON.parse(config);
                this.currentLevel = savedConfig.currentLevel || this.config.levels.INFO;
                this.isEnabled = savedConfig.isEnabled !== undefined ? savedConfig.isEnabled : true;
            }
            
            Logger.log('📝 Configurações de logging carregadas');
            
        } catch (error) {
            Logger.error('❌ Erro ao carregar configurações:', error);
        }
    }

    /**
     * Carregar logs existentes
     */
    async loadExistingLogs() {
        try {
            // Carregar logs principais
            const logs = await AsyncStorage.getItem(this.config.storageKeys.logs);
            if (logs) {
                this.logs = JSON.parse(logs);
            }
            
            // Carregar logs de performance
            const performanceLogs = await AsyncStorage.getItem(this.config.storageKeys.performance);
            if (performanceLogs) {
                this.performanceLogs = JSON.parse(performanceLogs);
            }
            
            // Carregar logs de debugging
            const debuggingLogs = await AsyncStorage.getItem(this.config.storageKeys.debugging);
            if (debuggingLogs) {
                this.debuggingLogs = JSON.parse(debuggingLogs);
            }
            
            // Carregar dados de analytics
            const analytics = await AsyncStorage.getItem(this.config.storageKeys.analytics);
            if (analytics) {
                this.analyticsData = { ...this.analyticsData, ...JSON.parse(analytics) };
            }
            
            Logger.log('📝 Logs existentes carregados');
            
        } catch (error) {
            Logger.error('❌ Erro ao carregar logs existentes:', error);
        }
    }

    /**
     * Configurar listeners de sistema
     */
    setupSystemListeners() {
        // WebSocket listeners
        this.wsManager.on('connect', () => {
            this.log('INFO', 'WebSocket conectado', { timestamp: Date.now() });
        });
        
        this.wsManager.on('disconnect', (reason) => {
            this.log('WARN', 'WebSocket desconectado', { reason, timestamp: Date.now() });
        });
        
        this.wsManager.on('connect_error', (error) => {
            this.log('ERROR', 'Erro de conexão WebSocket', { error: error.message, timestamp: Date.now() });
        });
        
        // Fallback listeners
        this.fallbackService.addConnectivityListener((isOnline) => {
            this.log('INFO', 'Mudança de conectividade', { isOnline, timestamp: Date.now() });
        });
        
        // Offline listeners
        if (this.offlineService.addEventListener) {
            this.offlineService.addEventListener((event) => {
                this.log('DEBUG', 'Evento offline', { event, timestamp: Date.now() });
            });
        }
        
        // Monitoring listeners
        if (this.monitoringService.addEventListener) {
            this.monitoringService.addEventListener((event) => {
                this.log('DEBUG', 'Evento de monitoramento', { event, timestamp: Date.now() });
            });
        }
        
        // Cache listeners
        if (this.cacheService.addEventListener) {
            this.cacheService.addEventListener((event) => {
                this.log('DEBUG', 'Evento de cache', { event, timestamp: Date.now() });
            });
        }
        
        Logger.log('📝 Listeners de sistema configurados');
    }

    /**
     * Configurar monitoramento de performance
     */
    setupPerformanceMonitoring() {
        if (!this.config.performance.enabled) return;
        
        // Monitorar operações lentas
        setInterval(() => {
            this.checkSlowOperations();
        }, 5000);
        
        // Monitorar uso de memória
        setInterval(() => {
            this.checkMemoryUsage();
        }, 10000);
        
        // Monitorar uso de CPU
        setInterval(() => {
            this.checkCpuUsage();
        }, 15000);
        
        Logger.log('📝 Monitoramento de performance configurado');
    }

    /**
     * Configurar análise de padrões
     */
    setupPatternAnalysis() {
        if (!this.config.analytics.enabled) return;
        
        // Análise de padrões
        setInterval(() => {
            this.analyzePatterns();
        }, 30000);
        
        // Detecção de anomalias
        setInterval(() => {
            this.detectAnomalies();
        }, 60000);
        
        // Análise de tendências
        setInterval(() => {
            this.analyzeTrends();
        }, 300000); // 5 minutos
        
        Logger.log('📝 Análise de padrões configurada');
    }

    /**
     * Registrar log
     */
    log(level, message, data = {}, context = {}) {
        try {
            if (!this.isEnabled || this.config.levels[level] > this.currentLevel) {
                return;
            }
            
            const logEntry = {
                id: this.generateLogId(),
                level,
                message,
                data,
                context: {
                    ...context,
                    timestamp: Date.now(),
                    userAgent: this.getUserAgent(),
                    sessionId: this.getSessionId(),
                    userId: this.getUserId(),
                    screen: this.getCurrentScreen(),
                    action: this.getCurrentAction()
                },
                stackTrace: this.config.debugging.stackTraceEnabled ? this.getStackTrace() : null,
                performance: this.config.performance.enabled ? this.getPerformanceData() : null
            };
            
            // Adicionar ao array de logs
            this.logs.push(logEntry);
            
            // Manter limite de logs
            if (this.logs.length > this.config.storage.maxLogs) {
                this.logs.shift();
            }
            
            // Atualizar analytics
            this.updateAnalytics(level);
            
            // Notificar listeners
            this.notifyLogListeners(logEntry);
            
            // Salvar logs periodicamente
            this.saveLogs();
            
            // Log no console se necessário
            this.logToConsole(logEntry);
            
        } catch (error) {
            Logger.error('❌ Erro ao registrar log:', error);
        }
    }

    /**
     * Registrar log de performance
     */
    logPerformance(operation, duration, data = {}) {
        try {
            if (!this.config.performance.enabled) return;
            
            const performanceEntry = {
                id: this.generateLogId(),
                operation,
                duration,
                data,
                timestamp: Date.now(),
                memoryUsage: this.getMemoryUsage(),
                cpuUsage: this.getCpuUsage(),
                isSlow: duration > this.config.performance.slowOperationThreshold
            };
            
            this.performanceLogs.push(performanceEntry);
            
            // Manter limite de logs de performance
            if (this.performanceLogs.length > this.config.storage.maxLogs) {
                this.performanceLogs.shift();
            }
            
            // Notificar listeners de performance
            this.notifyPerformanceListeners(performanceEntry);
            
            // Log se for operação lenta
            if (performanceEntry.isSlow) {
                this.log('WARN', `Operação lenta detectada: ${operation}`, {
                    duration,
                    threshold: this.config.performance.slowOperationThreshold
                });
            }
            
        } catch (error) {
            Logger.error('❌ Erro ao registrar log de performance:', error);
        }
    }

    /**
     * Registrar log de debugging
     */
    logDebugging(action, data = {}, context = {}) {
        try {
            if (!this.config.debugging.enabled) return;
            
            const debuggingEntry = {
                id: this.generateLogId(),
                action,
                data,
                context: {
                    ...context,
                    timestamp: Date.now(),
                    userAgent: this.getUserAgent(),
                    sessionId: this.getSessionId(),
                    userId: this.getUserId(),
                    screen: this.getCurrentScreen(),
                    networkStatus: this.getNetworkStatus(),
                    batteryLevel: this.getBatteryLevel()
                },
                stackTrace: this.config.debugging.stackTraceEnabled ? this.getStackTrace() : null
            };
            
            this.debuggingLogs.push(debuggingEntry);
            
            // Manter limite de logs de debugging
            if (this.debuggingLogs.length > this.config.storage.maxLogs) {
                this.debuggingLogs.shift();
            }
            
            // Notificar listeners de debugging
            this.notifyDebuggingListeners(debuggingEntry);
            
        } catch (error) {
            Logger.error('❌ Erro ao registrar log de debugging:', error);
        }
    }

    /**
     * Medir performance de operação
     */
    async measurePerformance(operation, operationFunction, data = {}) {
        const startTime = Date.now();
        const startMemory = this.getMemoryUsage();
        
        try {
            const result = await operationFunction();
            const duration = Date.now() - startTime;
            
            this.logPerformance(operation, duration, {
                ...data,
                success: true,
                result: typeof result === 'object' ? 'object' : typeof result
            });
            
            return result;
            
        } catch (error) {
            const duration = Date.now() - startTime;
            
            this.logPerformance(operation, duration, {
                ...data,
                success: false,
                error: error.message
            });
            
            throw error;
        }
    }

    /**
     * Verificar operações lentas
     */
    checkSlowOperations() {
        try {
            const recentLogs = this.performanceLogs.filter(log => 
                Date.now() - log.timestamp < 60000 // Últimos 60 segundos
            );
            
            const slowOperations = recentLogs.filter(log => log.isSlow);
            
            if (slowOperations.length > 5) {
                this.log('WARN', 'Muitas operações lentas detectadas', {
                    count: slowOperations.length,
                    threshold: 5
                });
            }
            
        } catch (error) {
            Logger.error('❌ Erro ao verificar operações lentas:', error);
        }
    }

    /**
     * Verificar uso de memória
     */
    checkMemoryUsage() {
        try {
            const memoryUsage = this.getMemoryUsage();
            
            if (memoryUsage > this.config.performance.memoryThreshold) {
                this.log('WARN', 'Uso de memória alto detectado', {
                    usage: memoryUsage,
                    threshold: this.config.performance.memoryThreshold
                });
            }
            
        } catch (error) {
            Logger.error('❌ Erro ao verificar uso de memória:', error);
        }
    }

    /**
     * Verificar uso de CPU
     */
    checkCpuUsage() {
        try {
            const cpuUsage = this.getCpuUsage();
            
            if (cpuUsage > this.config.performance.cpuThreshold) {
                this.log('WARN', 'Uso de CPU alto detectado', {
                    usage: cpuUsage,
                    threshold: this.config.performance.cpuThreshold
                });
            }
            
        } catch (error) {
            Logger.error('❌ Erro ao verificar uso de CPU:', error);
        }
    }

    /**
     * Analisar padrões
     */
    analyzePatterns() {
        try {
            const recentLogs = this.logs.filter(log => 
                Date.now() - log.context.timestamp < 300000 // Últimos 5 minutos
            );
            
            // Analisar padrões de erro
            const errorPatterns = this.analyzeErrorPatterns(recentLogs);
            
            // Analisar padrões de performance
            const performancePatterns = this.analyzePerformancePatterns(recentLogs);
            
            // Analisar padrões de uso
            const usagePatterns = this.analyzeUsagePatterns(recentLogs);
            
            const patterns = {
                errors: errorPatterns,
                performance: performancePatterns,
                usage: usagePatterns,
                timestamp: Date.now()
            };
            
            this.analyticsData.patterns.push(patterns);
            
            // Manter limite de padrões
            if (this.analyticsData.patterns.length > 100) {
                this.analyticsData.patterns.shift();
            }
            
        } catch (error) {
            Logger.error('❌ Erro ao analisar padrões:', error);
        }
    }

    /**
     * Detectar anomalias
     */
    detectAnomalies() {
        try {
            const recentLogs = this.logs.filter(log => 
                Date.now() - log.context.timestamp < 600000 // Últimos 10 minutos
            );
            
            // Detectar anomalias de erro
            const errorAnomalies = this.detectErrorAnomalies(recentLogs);
            
            // Detectar anomalias de performance
            const performanceAnomalies = this.detectPerformanceAnomalies(recentLogs);
            
            // Detectar anomalias de uso
            const usageAnomalies = this.detectUsageAnomalies(recentLogs);
            
            const anomalies = {
                errors: errorAnomalies,
                performance: performanceAnomalies,
                usage: usageAnomalies,
                timestamp: Date.now()
            };
            
            this.analyticsData.anomalies.push(anomalies);
            
            // Manter limite de anomalias
            if (this.analyticsData.anomalies.length > 50) {
                this.analyticsData.anomalies.shift();
            }
            
        } catch (error) {
            Logger.error('❌ Erro ao detectar anomalias:', error);
        }
    }

    /**
     * Analisar tendências
     */
    analyzeTrends() {
        try {
            const recentLogs = this.logs.filter(log => 
                Date.now() - log.context.timestamp < 3600000 // Última hora
            );
            
            // Analisar tendências de erro
            const errorTrends = this.analyzeErrorTrends(recentLogs);
            
            // Analisar tendências de performance
            const performanceTrends = this.analyzePerformanceTrends(recentLogs);
            
            // Analisar tendências de uso
            const usageTrends = this.analyzeUsageTrends(recentLogs);
            
            const trends = {
                errors: errorTrends,
                performance: performanceTrends,
                usage: usageTrends,
                timestamp: Date.now()
            };
            
            this.analyticsData.trends.push(trends);
            
            // Manter limite de tendências
            if (this.analyticsData.trends.length > 24) { // 24 horas
                this.analyticsData.trends.shift();
            }
            
        } catch (error) {
            Logger.error('❌ Erro ao analisar tendências:', error);
        }
    }

    /**
     * Analisar padrões de erro
     */
    analyzeErrorPatterns(logs) {
        try {
            const errorLogs = logs.filter(log => log.level === 'ERROR');
            
            const patterns = {
                commonErrors: {},
                errorFrequency: {},
                errorContexts: {}
            };
            
            errorLogs.forEach(log => {
                // Padrões de erro comuns
                const errorKey = log.message;
                patterns.commonErrors[errorKey] = (patterns.commonErrors[errorKey] || 0) + 1;
                
                // Frequência de erros
                const hour = new Date(log.context.timestamp).getHours();
                patterns.errorFrequency[hour] = (patterns.errorFrequency[hour] || 0) + 1;
                
                // Contextos de erro
                const contextKey = log.context.screen || 'unknown';
                patterns.errorContexts[contextKey] = (patterns.errorContexts[contextKey] || 0) + 1;
            });
            
            return patterns;
            
        } catch (error) {
            Logger.error('❌ Erro ao analisar padrões de erro:', error);
            return {};
        }
    }

    /**
     * Analisar padrões de performance
     */
    analyzePerformancePatterns(logs) {
        try {
            const performanceLogs = this.performanceLogs.filter(log => 
                Date.now() - log.timestamp < 300000 // Últimos 5 minutos
            );
            
            const patterns = {
                slowOperations: {},
                operationFrequency: {},
                performanceTrends: {}
            };
            
            performanceLogs.forEach(log => {
                // Operações lentas
                if (log.isSlow) {
                    patterns.slowOperations[log.operation] = (patterns.slowOperations[log.operation] || 0) + 1;
                }
                
                // Frequência de operações
                patterns.operationFrequency[log.operation] = (patterns.operationFrequency[log.operation] || 0) + 1;
                
                // Tendências de performance
                const hour = new Date(log.timestamp).getHours();
                if (!patterns.performanceTrends[hour]) {
                    patterns.performanceTrends[hour] = { total: 0, count: 0 };
                }
                patterns.performanceTrends[hour].total += log.duration;
                patterns.performanceTrends[hour].count += 1;
            });
            
            return patterns;
            
        } catch (error) {
            Logger.error('❌ Erro ao analisar padrões de performance:', error);
            return {};
        }
    }

    /**
     * Analisar padrões de uso
     */
    analyzeUsagePatterns(logs) {
        try {
            const patterns = {
                screenUsage: {},
                actionFrequency: {},
                userBehavior: {}
            };
            
            logs.forEach(log => {
                // Uso de telas
                const screen = log.context.screen || 'unknown';
                patterns.screenUsage[screen] = (patterns.screenUsage[screen] || 0) + 1;
                
                // Frequência de ações
                const action = log.context.action || 'unknown';
                patterns.actionFrequency[action] = (patterns.actionFrequency[action] || 0) + 1;
                
                // Comportamento do usuário
                const hour = new Date(log.context.timestamp).getHours();
                patterns.userBehavior[hour] = (patterns.userBehavior[hour] || 0) + 1;
            });
            
            return patterns;
            
        } catch (error) {
            Logger.error('❌ Erro ao analisar padrões de uso:', error);
            return {};
        }
    }

    /**
     * Detectar anomalias de erro
     */
    detectErrorAnomalies(logs) {
        try {
            const errorLogs = logs.filter(log => log.level === 'ERROR');
            const errorCount = errorLogs.length;
            
            // Calcular média histórica de erros
            const historicalErrors = this.logs.filter(log => 
                log.level === 'ERROR' && 
                Date.now() - log.context.timestamp < 3600000 // Última hora
            );
            const historicalAverage = historicalErrors.length / 6; // 6 períodos de 10 minutos
            
            const anomalies = [];
            
            // Detectar pico de erros
            if (errorCount > historicalAverage * 2) {
                anomalies.push({
                    type: 'error_spike',
                    severity: 'high',
                    message: 'Pico de erros detectado',
                    current: errorCount,
                    average: historicalAverage
                });
            }
            
            return anomalies;
            
        } catch (error) {
            Logger.error('❌ Erro ao detectar anomalias de erro:', error);
            return [];
        }
    }

    /**
     * Detectar anomalias de performance
     */
    detectPerformanceAnomalies(logs) {
        try {
            const performanceLogs = this.performanceLogs.filter(log => 
                Date.now() - log.timestamp < 600000 // Últimos 10 minutos
            );
            
            const anomalies = [];
            
            // Detectar operações muito lentas
            const verySlowOperations = performanceLogs.filter(log => 
                log.duration > this.config.performance.slowOperationThreshold * 2
            );
            
            if (verySlowOperations.length > 0) {
                anomalies.push({
                    type: 'performance_degradation',
                    severity: 'high',
                    message: 'Operações muito lentas detectadas',
                    count: verySlowOperations.length,
                    operations: verySlowOperations.map(op => op.operation)
                });
            }
            
            return anomalies;
            
        } catch (error) {
            Logger.error('❌ Erro ao detectar anomalias de performance:', error);
            return [];
        }
    }

    /**
     * Detectar anomalias de uso
     */
    detectUsageAnomalies(logs) {
        try {
            const anomalies = [];
            
            // Detectar uso anômalo de telas
            const screenUsage = {};
            logs.forEach(log => {
                const screen = log.context.screen || 'unknown';
                screenUsage[screen] = (screenUsage[screen] || 0) + 1;
            });
            
            const maxUsage = Math.max(...Object.values(screenUsage));
            const totalUsage = Object.values(screenUsage).reduce((sum, usage) => sum + usage, 0);
            
            if (maxUsage > totalUsage * 0.8) {
                anomalies.push({
                    type: 'usage_anomaly',
                    severity: 'medium',
                    message: 'Uso concentrado em uma tela',
                    screen: Object.keys(screenUsage).find(screen => screenUsage[screen] === maxUsage),
                    percentage: (maxUsage / totalUsage) * 100
                });
            }
            
            return anomalies;
            
        } catch (error) {
            Logger.error('❌ Erro ao detectar anomalias de uso:', error);
            return [];
        }
    }

    /**
     * Analisar tendências de erro
     */
    analyzeErrorTrends(logs) {
        try {
            const errorLogs = logs.filter(log => log.level === 'ERROR');
            
            const trends = {
                increasing: false,
                decreasing: false,
                stable: false,
                trend: 'stable'
            };
            
            // Analisar tendência dos últimos 6 períodos de 10 minutos
            const periods = [];
            for (let i = 0; i < 6; i++) {
                const periodStart = Date.now() - (i + 1) * 600000;
                const periodEnd = Date.now() - i * 600000;
                
                const periodErrors = errorLogs.filter(log => 
                    log.context.timestamp >= periodStart && log.context.timestamp < periodEnd
                );
                
                periods.push(periodErrors.length);
            }
            
            // Calcular tendência
            const firstHalf = periods.slice(0, 3).reduce((sum, count) => sum + count, 0);
            const secondHalf = periods.slice(3, 6).reduce((sum, count) => sum + count, 0);
            
            if (secondHalf > firstHalf * 1.2) {
                trends.increasing = true;
                trends.trend = 'increasing';
            } else if (secondHalf < firstHalf * 0.8) {
                trends.decreasing = true;
                trends.trend = 'decreasing';
            } else {
                trends.stable = true;
                trends.trend = 'stable';
            }
            
            return trends;
            
        } catch (error) {
            Logger.error('❌ Erro ao analisar tendências de erro:', error);
            return { trend: 'unknown' };
        }
    }

    /**
     * Analisar tendências de performance
     */
    analyzePerformanceTrends(logs) {
        try {
            const performanceLogs = this.performanceLogs.filter(log => 
                Date.now() - log.timestamp < 3600000 // Última hora
            );
            
            const trends = {
                averageResponseTime: 0,
                trend: 'stable'
            };
            
            if (performanceLogs.length > 0) {
                const totalDuration = performanceLogs.reduce((sum, log) => sum + log.duration, 0);
                trends.averageResponseTime = totalDuration / performanceLogs.length;
                
                // Analisar tendência de performance
                const recentLogs = performanceLogs.filter(log => 
                    Date.now() - log.timestamp < 1800000 // Últimos 30 minutos
                );
                const olderLogs = performanceLogs.filter(log => 
                    log.timestamp >= Date.now() - 3600000 && log.timestamp < Date.now() - 1800000
                );
                
                if (recentLogs.length > 0 && olderLogs.length > 0) {
                    const recentAverage = recentLogs.reduce((sum, log) => sum + log.duration, 0) / recentLogs.length;
                    const olderAverage = olderLogs.reduce((sum, log) => sum + log.duration, 0) / olderLogs.length;
                    
                    if (recentAverage > olderAverage * 1.1) {
                        trends.trend = 'degrading';
                    } else if (recentAverage < olderAverage * 0.9) {
                        trends.trend = 'improving';
                    }
                }
            }
            
            return trends;
            
        } catch (error) {
            Logger.error('❌ Erro ao analisar tendências de performance:', error);
            return { trend: 'unknown' };
        }
    }

    /**
     * Analisar tendências de uso
     */
    analyzeUsageTrends(logs) {
        try {
            const trends = {
                peakHours: [],
                usagePattern: 'normal'
            };
            
            // Analisar horas de pico
            const hourlyUsage = {};
            logs.forEach(log => {
                const hour = new Date(log.context.timestamp).getHours();
                hourlyUsage[hour] = (hourlyUsage[hour] || 0) + 1;
            });
            
            const maxUsage = Math.max(...Object.values(hourlyUsage));
            trends.peakHours = Object.keys(hourlyUsage).filter(hour => 
                hourlyUsage[hour] >= maxUsage * 0.8
            ).map(hour => parseInt(hour));
            
            return trends;
            
        } catch (error) {
            Logger.error('❌ Erro ao analisar tendências de uso:', error);
            return { usagePattern: 'unknown' };
        }
    }

    /**
     * Atualizar analytics
     */
    updateAnalytics(level) {
        try {
            this.analyticsData.summary.totalLogs++;
            
            switch (level) {
                case 'ERROR':
                    this.analyticsData.summary.errorCount++;
                    break;
                case 'WARN':
                    this.analyticsData.summary.warningCount++;
                    break;
                case 'INFO':
                    this.analyticsData.summary.infoCount++;
                    break;
                case 'DEBUG':
                    this.analyticsData.summary.debugCount++;
                    break;
                case 'TRACE':
                    this.analyticsData.summary.traceCount++;
                    break;
            }
            
        } catch (error) {
            Logger.error('❌ Erro ao atualizar analytics:', error);
        }
    }

    /**
     * Notificar listeners de log
     */
    notifyLogListeners(logEntry) {
        this.logListeners.forEach(listener => {
            try {
                listener(logEntry);
            } catch (error) {
                Logger.error('❌ Erro em listener de log:', error);
            }
        });
    }

    /**
     * Notificar listeners de performance
     */
    notifyPerformanceListeners(performanceEntry) {
        this.performanceListeners.forEach(listener => {
            try {
                listener(performanceEntry);
            } catch (error) {
                Logger.error('❌ Erro em listener de performance:', error);
            }
        });
    }

    /**
     * Notificar listeners de debugging
     */
    notifyDebuggingListeners(debuggingEntry) {
        this.debuggingListeners.forEach(listener => {
            try {
                listener(debuggingEntry);
            } catch (error) {
                Logger.error('❌ Erro em listener de debugging:', error);
            }
        });
    }

    /**
     * Salvar logs
     */
    async saveLogs() {
        try {
            await AsyncStorage.multiSet([
                [this.config.storageKeys.logs, JSON.stringify(this.logs)],
                [this.config.storageKeys.performance, JSON.stringify(this.performanceLogs)],
                [this.config.storageKeys.debugging, JSON.stringify(this.debuggingLogs)],
                [this.config.storageKeys.analytics, JSON.stringify(this.analyticsData)]
            ]);
            
        } catch (error) {
            Logger.error('❌ Erro ao salvar logs:', error);
        }
    }

    /**
     * Log no console
     */
    logToConsole(logEntry) {
        try {
            const timestamp = new Date(logEntry.context.timestamp).toISOString();
            const level = logEntry.level.padEnd(5);
            const message = logEntry.message;
            
            Logger.log(`[${timestamp}] ${level} ${message}`, logEntry.data);
            
        } catch (error) {
            Logger.error('❌ Erro ao logar no console:', error);
        }
    }

    /**
     * Gerar ID único para log
     */
    generateLogId() {
        return `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Obter User Agent
     */
    getUserAgent() {
        return 'React Native App';
    }

    /**
     * Obter Session ID
     */
    getSessionId() {
        return 'session_' + Date.now();
    }

    /**
     * Obter User ID
     */
    getUserId() {
        return 'user_' + Date.now();
    }

    /**
     * Obter tela atual
     */
    getCurrentScreen() {
        return 'current_screen';
    }

    /**
     * Obter ação atual
     */
    getCurrentAction() {
        return 'current_action';
    }

    /**
     * Obter stack trace
     */
    getStackTrace() {
        try {
            const stack = new Error().stack;
            return stack ? stack.split('\n').slice(2, 10) : null;
        } catch (error) {
            return null;
        }
    }

    /**
     * Obter dados de performance
     */
    getPerformanceData() {
        return {
            memoryUsage: this.getMemoryUsage(),
            cpuUsage: this.getCpuUsage(),
            timestamp: Date.now()
        };
    }

    /**
     * Obter uso de memória
     */
    getMemoryUsage() {
        try {
            // Simular uso de memória
            return Math.floor(Math.random() * 200 * 1024 * 1024); // 0-200MB
        } catch (error) {
            return 0;
        }
    }

    /**
     * Obter uso de CPU
     */
    getCpuUsage() {
        try {
            // Simular uso de CPU
            return Math.floor(Math.random() * 100); // 0-100%
        } catch (error) {
            return 0;
        }
    }

    /**
     * Obter status da rede
     */
    getNetworkStatus() {
        return 'online';
    }

    /**
     * Obter nível da bateria
     */
    getBatteryLevel() {
        return 85; // 85%
    }

    /**
     * Obter logs filtrados
     */
    getLogs(filter = {}) {
        try {
            let filteredLogs = [...this.logs];
            
            if (filter.level) {
                filteredLogs = filteredLogs.filter(log => log.level === filter.level);
            }
            
            if (filter.startTime) {
                filteredLogs = filteredLogs.filter(log => log.context.timestamp >= filter.startTime);
            }
            
            if (filter.endTime) {
                filteredLogs = filteredLogs.filter(log => log.context.timestamp <= filter.endTime);
            }
            
            if (filter.screen) {
                filteredLogs = filteredLogs.filter(log => log.context.screen === filter.screen);
            }
            
            if (filter.userId) {
                filteredLogs = filteredLogs.filter(log => log.context.userId === filter.userId);
            }
            
            return filteredLogs;
            
        } catch (error) {
            Logger.error('❌ Erro ao obter logs filtrados:', error);
            return [];
        }
    }

    /**
     * Obter logs de performance
     */
    getPerformanceLogs(filter = {}) {
        try {
            let filteredLogs = [...this.performanceLogs];
            
            if (filter.operation) {
                filteredLogs = filteredLogs.filter(log => log.operation === filter.operation);
            }
            
            if (filter.startTime) {
                filteredLogs = filteredLogs.filter(log => log.timestamp >= filter.startTime);
            }
            
            if (filter.endTime) {
                filteredLogs = filteredLogs.filter(log => log.timestamp <= filter.endTime);
            }
            
            if (filter.slowOnly) {
                filteredLogs = filteredLogs.filter(log => log.isSlow);
            }
            
            return filteredLogs;
            
        } catch (error) {
            Logger.error('❌ Erro ao obter logs de performance:', error);
            return [];
        }
    }

    /**
     * Obter logs de debugging
     */
    getDebuggingLogs(filter = {}) {
        try {
            let filteredLogs = [...this.debuggingLogs];
            
            if (filter.action) {
                filteredLogs = filteredLogs.filter(log => log.action === filter.action);
            }
            
            if (filter.startTime) {
                filteredLogs = filteredLogs.filter(log => log.context.timestamp >= filter.startTime);
            }
            
            if (filter.endTime) {
                filteredLogs = filteredLogs.filter(log => log.context.timestamp <= filter.endTime);
            }
            
            if (filter.screen) {
                filteredLogs = filteredLogs.filter(log => log.context.screen === filter.screen);
            }
            
            return filteredLogs;
            
        } catch (error) {
            Logger.error('❌ Erro ao obter logs de debugging:', error);
            return [];
        }
    }

    /**
     * Obter analytics
     */
    getAnalytics() {
        return this.analyticsData;
    }

    /**
     * Obter resumo de logs
     */
    getLogSummary() {
        return {
            totalLogs: this.logs.length,
            performanceLogs: this.performanceLogs.length,
            debuggingLogs: this.debuggingLogs.length,
            analytics: this.analyticsData.summary,
            patterns: this.analyticsData.patterns.length,
            anomalies: this.analyticsData.anomalies.length,
            trends: this.analyticsData.trends.length
        };
    }

    /**
     * Adicionar listener de log
     */
    addLogListener(listener) {
        this.logListeners.push(listener);
        
        return () => {
            const index = this.logListeners.indexOf(listener);
            if (index > -1) {
                this.logListeners.splice(index, 1);
            }
        };
    }

    /**
     * Adicionar listener de performance
     */
    addPerformanceListener(listener) {
        this.performanceListeners.push(listener);
        
        return () => {
            const index = this.performanceListeners.indexOf(listener);
            if (index > -1) {
                this.performanceListeners.splice(index, 1);
            }
        };
    }

    /**
     * Adicionar listener de debugging
     */
    addDebuggingListener(listener) {
        this.debuggingListeners.push(listener);
        
        return () => {
            const index = this.debuggingListeners.indexOf(listener);
            if (index > -1) {
                this.debuggingListeners.splice(index, 1);
            }
        };
    }

    /**
     * Configurar nível de log
     */
    setLogLevel(level) {
        if (this.config.levels[level] !== undefined) {
            this.currentLevel = this.config.levels[level];
            this.saveConfiguration();
        }
    }

    /**
     * Habilitar/desabilitar logging
     */
    setEnabled(enabled) {
        this.isEnabled = enabled;
        this.saveConfiguration();
    }

    /**
     * Salvar configuração
     */
    async saveConfiguration() {
        try {
            const config = {
                currentLevel: this.currentLevel,
                isEnabled: this.isEnabled
            };
            
            await AsyncStorage.setItem(this.config.storageKeys.config, JSON.stringify(config));
            
        } catch (error) {
            Logger.error('❌ Erro ao salvar configuração:', error);
        }
    }

    /**
     * Limpar logs
     */
    async clearLogs() {
        try {
            this.logs = [];
            this.performanceLogs = [];
            this.debuggingLogs = [];
            this.analyticsData = {
                patterns: [],
                anomalies: [],
                trends: [],
                summary: {
                    totalLogs: 0,
                    errorCount: 0,
                    warningCount: 0,
                    infoCount: 0,
                    debugCount: 0,
                    traceCount: 0
                }
            };
            
            await this.saveLogs();
            
            Logger.log('✅ Logs limpos');
            
        } catch (error) {
            Logger.error('❌ Erro ao limpar logs:', error);
        }
    }

    /**
     * Limpar recursos
     */
    async cleanup() {
        try {
            await this.saveLogs();
            
            this.logListeners = [];
            this.performanceListeners = [];
            this.debuggingListeners = [];
            
            this.isInitialized = false;
            
            Logger.log('✅ Sistema de logs e debugging limpo');
            
        } catch (error) {
            Logger.error('❌ Erro ao limpar sistema de logs:', error);
        }
    }
}

// Singleton
const advancedLoggingService = new AdvancedLoggingService();
export default advancedLoggingService;






