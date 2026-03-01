import Logger from '../utils/Logger';
/**
 * 📊 SISTEMA DE MONITORAMENTO E MÉTRICAS EM TEMPO REAL
 * Coleta, análise e visualização de métricas de performance e uso
 */

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import WebSocketManager from './WebSocketManager';
import IntelligentFallbackService from './IntelligentFallbackService';
import offlinePersistenceService from './OfflinePersistenceService';


class RealTimeMonitoringService {
    constructor() {
        this.wsManager = WebSocketManager.getInstance();
        this.fallbackService = IntelligentFallbackService;
        this.offlineService = offlinePersistenceService;
        
        // Configurações de monitoramento
        this.config = {
            collectionInterval: 10000, // 10 segundos
            retentionPeriod: 7 * 24 * 60 * 60 * 1000, // 7 dias
            maxMetricsPerType: 1000,
            alertThresholds: {
                responseTime: 5000, // 5 segundos
                errorRate: 0.05, // 5%
                memoryUsage: 0.8, // 80%
                cpuUsage: 0.9, // 90%
                queueSize: 100
            },
            storageKeys: {
                performanceMetrics: '@performance_metrics',
                userMetrics: '@user_metrics',
                systemMetrics: '@system_metrics',
                alertHistory: '@alert_history',
                dashboardData: '@dashboard_data'
            }
        };
        
        // Estados
        this.isInitialized = false;
        this.isCollecting = false;
        this.collectionInterval = null;
        
        // Métricas em tempo real
        this.metrics = {
            performance: {
                responseTime: [],
                throughput: [],
                errorRate: [],
                successRate: []
            },
            user: {
                activeUsers: 0,
                newUsers: 0,
                userActions: [],
                sessionDuration: [],
                userRetention: []
            },
            system: {
                memoryUsage: [],
                cpuUsage: [],
                networkLatency: [],
                connectionHealth: [],
                queueSize: []
            },
            business: {
                ridesCompleted: 0,
                ridesCancelled: 0,
                revenue: 0,
                driverEfficiency: [],
                customerSatisfaction: []
            }
        };
        
        // Alertas
        this.alerts = [];
        this.alertListeners = [];
        
        // Dashboard em tempo real
        this.dashboardData = {
            lastUpdated: null,
            summary: {},
            charts: {},
            alerts: []
        };
        
        Logger.log('📊 Sistema de monitoramento em tempo real inicializado');
    }

    /**
     * Inicializar o sistema de monitoramento
     */
    async initialize() {
        try {
            Logger.log('📊 Inicializando sistema de monitoramento...');
            
            // 1. Carregar métricas históricas
            await this.loadHistoricalMetrics();
            
            // 2. Configurar coleta automática
            this.setupAutomaticCollection();
            
            // 3. Configurar listeners de eventos
            this.setupEventListeners();
            
            // 4. Inicializar dashboard
            await this.initializeDashboard();
            
            this.isInitialized = true;
            Logger.log('✅ Sistema de monitoramento inicializado');
            
        } catch (error) {
            Logger.error('❌ Erro ao inicializar monitoramento:', error);
            throw error;
        }
    }

    /**
     * Carregar métricas históricas
     */
    async loadHistoricalMetrics() {
        try {
            // Carregar métricas de performance
            const performanceData = await AsyncStorage.getItem(this.config.storageKeys.performanceMetrics);
            if (performanceData) {
                this.metrics.performance = { ...this.metrics.performance, ...JSON.parse(performanceData) };
            }
            
            // Carregar métricas de usuário
            const userData = await AsyncStorage.getItem(this.config.storageKeys.userMetrics);
            if (userData) {
                this.metrics.user = { ...this.metrics.user, ...JSON.parse(userData) };
            }
            
            // Carregar métricas de sistema
            const systemData = await AsyncStorage.getItem(this.config.storageKeys.systemMetrics);
            if (systemData) {
                this.metrics.system = { ...this.metrics.system, ...JSON.parse(systemData) };
            }
            
            Logger.log('📊 Métricas históricas carregadas');
            
        } catch (error) {
            Logger.error('❌ Erro ao carregar métricas históricas:', error);
        }
    }

    /**
     * Configurar coleta automática
     */
    setupAutomaticCollection() {
        this.collectionInterval = setInterval(async () => {
            if (this.isCollecting) {
                await this.collectMetrics();
            }
        }, this.config.collectionInterval);
        
        Logger.log('📊 Coleta automática configurada');
    }

    /**
     * Configurar listeners de eventos
     */
    setupEventListeners() {
        // WebSocket listeners
        this.wsManager.on('connect', () => {
            this.recordEvent('websocket_connected', { timestamp: Date.now() });
        });
        
        this.wsManager.on('disconnect', () => {
            this.recordEvent('websocket_disconnected', { timestamp: Date.now() });
        });
        
        this.wsManager.on('connect_error', (error) => {
            this.recordEvent('websocket_error', { error: error.message, timestamp: Date.now() });
        });
        
        // Fallback service listeners
        this.fallbackService.addConnectivityListener((isOnline) => {
            this.recordEvent('connectivity_change', { isOnline, timestamp: Date.now() });
        });
        
        Logger.log('📊 Listeners de eventos configurados');
    }

    /**
     * Inicializar dashboard
     */
    async initializeDashboard() {
        try {
            const dashboardData = await AsyncStorage.getItem(this.config.storageKeys.dashboardData);
            if (dashboardData) {
                this.dashboardData = { ...this.dashboardData, ...JSON.parse(dashboardData) };
            }
            
            // Atualizar dashboard inicial
            await this.updateDashboard();
            
            Logger.log('📊 Dashboard inicializado');
            
        } catch (error) {
            Logger.error('❌ Erro ao inicializar dashboard:', error);
        }
    }

    /**
     * Iniciar coleta de métricas
     */
    startCollection() {
        if (!this.isCollecting) {
            this.isCollecting = true;
            Logger.log('📊 Coleta de métricas iniciada');
        }
    }

    /**
     * Parar coleta de métricas
     */
    stopCollection() {
        if (this.isCollecting) {
            this.isCollecting = false;
            Logger.log('📊 Coleta de métricas parada');
        }
    }

    /**
     * Coletar métricas
     */
    async collectMetrics() {
        try {
            const timestamp = Date.now();
            
            // Coletar métricas de performance
            await this.collectPerformanceMetrics(timestamp);
            
            // Coletar métricas de usuário
            await this.collectUserMetrics(timestamp);
            
            // Coletar métricas de sistema
            await this.collectSystemMetrics(timestamp);
            
            // Coletar métricas de negócio
            await this.collectBusinessMetrics(timestamp);
            
            // Verificar alertas
            await this.checkAlerts();
            
            // Atualizar dashboard
            await this.updateDashboard();
            
            // Salvar métricas
            await this.saveMetrics();
            
        } catch (error) {
            Logger.error('❌ Erro na coleta de métricas:', error);
        }
    }

    /**
     * Coletar métricas de performance
     */
    async collectPerformanceMetrics(timestamp) {
        try {
            // Métricas de WebSocket
            const wsConnected = this.wsManager.isConnected();
            const wsLatency = await this.measureWebSocketLatency();
            
            // Métricas de Fallback
            const fallbackMetrics = this.fallbackService.getMetrics();
            
            // Métricas de Offline
            const offlineMetrics = this.offlineService.getMetrics();
            
            const performanceData = {
                timestamp,
                websocket: {
                    connected: wsConnected,
                    latency: wsLatency
                },
                fallback: {
                    successRate: fallbackMetrics.successRate,
                    failureRate: fallbackMetrics.failureRate,
                    fallbackSwitches: fallbackMetrics.fallbackSwitches
                },
                offline: {
                    queueSize: offlineMetrics.queueSize,
                    isOnline: offlineMetrics.isOnline,
                    syncInProgress: offlineMetrics.syncInProgress
                }
            };
            
            this.metrics.performance.responseTime.push(performanceData);
            
            // Manter apenas as últimas métricas
            if (this.metrics.performance.responseTime.length > this.config.maxMetricsPerType) {
                this.metrics.performance.responseTime = this.metrics.performance.responseTime.slice(-this.config.maxMetricsPerType);
            }
            
        } catch (error) {
            Logger.error('❌ Erro ao coletar métricas de performance:', error);
        }
    }

    /**
     * Coletar métricas de usuário
     */
    async collectUserMetrics(timestamp) {
        try {
            // Simular coleta de métricas de usuário
            const userData = {
                timestamp,
                activeUsers: Math.floor(Math.random() * 100) + 50, // Simulado
                newUsers: Math.floor(Math.random() * 10) + 1,
                sessionDuration: Math.floor(Math.random() * 1800) + 300, // 5-30 min
                userActions: Math.floor(Math.random() * 50) + 10
            };
            
            this.metrics.user.activeUsers = userData.activeUsers;
            this.metrics.user.newUsers = userData.newUsers;
            this.metrics.user.sessionDuration.push(userData.sessionDuration);
            this.metrics.user.userActions.push(userData.userActions);
            
            // Manter apenas as últimas métricas
            if (this.metrics.user.sessionDuration.length > this.config.maxMetricsPerType) {
                this.metrics.user.sessionDuration = this.metrics.user.sessionDuration.slice(-this.config.maxMetricsPerType);
            }
            if (this.metrics.user.userActions.length > this.config.maxMetricsPerType) {
                this.metrics.user.userActions = this.metrics.user.userActions.slice(-this.config.maxMetricsPerType);
            }
            
        } catch (error) {
            Logger.error('❌ Erro ao coletar métricas de usuário:', error);
        }
    }

    /**
     * Coletar métricas de sistema
     */
    async collectSystemMetrics(timestamp) {
        try {
            // Simular coleta de métricas de sistema
            const systemData = {
                timestamp,
                memoryUsage: Math.random() * 0.8 + 0.1, // 10-90%
                cpuUsage: Math.random() * 0.7 + 0.1, // 10-80%
                networkLatency: Math.random() * 200 + 50, // 50-250ms
                connectionHealth: this.wsManager.isConnected() ? 1 : 0
            };
            
            this.metrics.system.memoryUsage.push(systemData);
            this.metrics.system.cpuUsage.push(systemData);
            this.metrics.system.networkLatency.push(systemData);
            this.metrics.system.connectionHealth.push(systemData);
            
            // Manter apenas as últimas métricas
            Object.keys(this.metrics.system).forEach(key => {
                if (Array.isArray(this.metrics.system[key]) && this.metrics.system[key].length > this.config.maxMetricsPerType) {
                    this.metrics.system[key] = this.metrics.system[key].slice(-this.config.maxMetricsPerType);
                }
            });
            
        } catch (error) {
            Logger.error('❌ Erro ao coletar métricas de sistema:', error);
        }
    }

    /**
     * Coletar métricas de negócio
     */
    async collectBusinessMetrics(timestamp) {
        try {
            // Simular coleta de métricas de negócio
            const businessData = {
                timestamp,
                ridesCompleted: Math.floor(Math.random() * 20) + 5,
                ridesCancelled: Math.floor(Math.random() * 5) + 1,
                revenue: Math.random() * 1000 + 100,
                driverEfficiency: Math.random() * 0.4 + 0.6, // 60-100%
                customerSatisfaction: Math.random() * 0.3 + 0.7 // 70-100%
            };
            
            this.metrics.business.ridesCompleted += businessData.ridesCompleted;
            this.metrics.business.ridesCancelled += businessData.ridesCancelled;
            this.metrics.business.revenue += businessData.revenue;
            this.metrics.business.driverEfficiency.push(businessData.driverEfficiency);
            this.metrics.business.customerSatisfaction.push(businessData.customerSatisfaction);
            
            // Manter apenas as últimas métricas
            if (this.metrics.business.driverEfficiency.length > this.config.maxMetricsPerType) {
                this.metrics.business.driverEfficiency = this.metrics.business.driverEfficiency.slice(-this.config.maxMetricsPerType);
            }
            if (this.metrics.business.customerSatisfaction.length > this.config.maxMetricsPerType) {
                this.metrics.business.customerSatisfaction = this.metrics.business.customerSatisfaction.slice(-this.config.maxMetricsPerType);
            }
            
        } catch (error) {
            Logger.error('❌ Erro ao coletar métricas de negócio:', error);
        }
    }

    /**
     * Medir latência do WebSocket
     */
    async measureWebSocketLatency() {
        try {
            const startTime = Date.now();
            
            // Enviar ping e aguardar pong
            return new Promise((resolve) => {
                const timeout = setTimeout(() => {
                    resolve(5000); // Timeout de 5 segundos
                }, 5000);
                
                this.wsManager.once('pong', () => {
                    clearTimeout(timeout);
                    resolve(Date.now() - startTime);
                });
                
                this.wsManager.emit('ping');
            });
            
        } catch (error) {
            return 5000; // Retornar valor alto em caso de erro
        }
    }

    /**
     * Registrar evento
     */
    recordEvent(eventType, data) {
        const event = {
            type: eventType,
            data,
            timestamp: Date.now()
        };
        
        Logger.log(`📊 Evento registrado: ${eventType}`, data);
        
        // Processar evento para métricas
        this.processEvent(event);
    }

    /**
     * Processar evento para métricas
     */
    processEvent(event) {
        try {
            switch (event.type) {
                case 'websocket_connected':
                    this.metrics.performance.successRate.push(1);
                    break;
                case 'websocket_disconnected':
                case 'websocket_error':
                    this.metrics.performance.errorRate.push(1);
                    break;
                case 'connectivity_change':
                    if (!event.data.isOnline) {
                        this.metrics.system.connectionHealth.push(0);
                    }
                    break;
                default:
                    // Evento não processado
                    break;
            }
            
        } catch (error) {
            Logger.error('❌ Erro ao processar evento:', error);
        }
    }

    /**
     * Verificar alertas
     */
    async checkAlerts() {
        try {
            const alerts = [];
            
            // Verificar alertas de performance
            if (this.metrics.performance.responseTime.length > 0) {
                const latestResponseTime = this.metrics.performance.responseTime[this.metrics.performance.responseTime.length - 1];
                if (latestResponseTime.websocket?.latency > this.config.alertThresholds.responseTime) {
                    alerts.push({
                        type: 'performance',
                        severity: 'warning',
                        message: `Latência alta detectada: ${latestResponseTime.websocket.latency}ms`,
                        timestamp: Date.now()
                    });
                }
            }
            
            // Verificar alertas de sistema
            if (this.metrics.system.memoryUsage.length > 0) {
                const latestMemoryUsage = this.metrics.system.memoryUsage[this.metrics.system.memoryUsage.length - 1];
                if (latestMemoryUsage.memoryUsage > this.config.alertThresholds.memoryUsage) {
                    alerts.push({
                        type: 'system',
                        severity: 'critical',
                        message: `Uso de memória alto: ${(latestMemoryUsage.memoryUsage * 100).toFixed(1)}%`,
                        timestamp: Date.now()
                    });
                }
            }
            
            // Verificar alertas de fila offline
            const offlineMetrics = this.offlineService.getMetrics();
            if (offlineMetrics.queueSize > this.config.alertThresholds.queueSize) {
                alerts.push({
                    type: 'offline',
                    severity: 'warning',
                    message: `Fila offline grande: ${offlineMetrics.queueSize} operações`,
                    timestamp: Date.now()
                });
            }
            
            // Processar alertas
            if (alerts.length > 0) {
                await this.processAlerts(alerts);
            }
            
        } catch (error) {
            Logger.error('❌ Erro ao verificar alertas:', error);
        }
    }

    /**
     * Processar alertas
     */
    async processAlerts(alerts) {
        try {
            for (const alert of alerts) {
                this.alerts.push(alert);
                
                // Notificar listeners
                this.alertListeners.forEach(listener => {
                    try {
                        listener(alert);
                    } catch (error) {
                        Logger.error('❌ Erro em listener de alerta:', error);
                    }
                });
                
                Logger.log(`🚨 Alerta ${alert.severity}: ${alert.message}`);
            }
            
            // Salvar histórico de alertas
            await this.saveAlertHistory();
            
        } catch (error) {
            Logger.error('❌ Erro ao processar alertas:', error);
        }
    }

    /**
     * Atualizar dashboard
     */
    async updateDashboard() {
        try {
            const timestamp = Date.now();
            
            // Calcular resumo
            const summary = {
                timestamp,
                performance: {
                    avgResponseTime: this.calculateAverage(this.metrics.performance.responseTime.map(m => m.websocket?.latency || 0)),
                    successRate: this.calculateAverage(this.metrics.performance.successRate),
                    errorRate: this.calculateAverage(this.metrics.performance.errorRate)
                },
                user: {
                    activeUsers: this.metrics.user.activeUsers,
                    newUsers: this.metrics.user.newUsers,
                    avgSessionDuration: this.calculateAverage(this.metrics.user.sessionDuration)
                },
                system: {
                    avgMemoryUsage: this.calculateAverage(this.metrics.system.memoryUsage.map(m => m.memoryUsage || 0)),
                    avgCpuUsage: this.calculateAverage(this.metrics.system.cpuUsage.map(m => m.cpuUsage || 0)),
                    avgNetworkLatency: this.calculateAverage(this.metrics.system.networkLatency.map(m => m.networkLatency || 0))
                },
                business: {
                    totalRides: this.metrics.business.ridesCompleted,
                    totalRevenue: this.metrics.business.revenue,
                    avgDriverEfficiency: this.calculateAverage(this.metrics.business.driverEfficiency),
                    avgCustomerSatisfaction: this.calculateAverage(this.metrics.business.customerSatisfaction)
                }
            };
            
            // Preparar dados de gráficos
            const charts = {
                performance: {
                    responseTime: this.metrics.performance.responseTime.slice(-20),
                    successRate: this.metrics.performance.successRate.slice(-20),
                    errorRate: this.metrics.performance.errorRate.slice(-20)
                },
                user: {
                    activeUsers: this.metrics.user.userActions.slice(-20),
                    sessionDuration: this.metrics.user.sessionDuration.slice(-20)
                },
                system: {
                    memoryUsage: this.metrics.system.memoryUsage.slice(-20),
                    cpuUsage: this.metrics.system.cpuUsage.slice(-20),
                    networkLatency: this.metrics.system.networkLatency.slice(-20)
                },
                business: {
                    driverEfficiency: this.metrics.business.driverEfficiency.slice(-20),
                    customerSatisfaction: this.metrics.business.customerSatisfaction.slice(-20)
                }
            };
            
            // Atualizar dados do dashboard
            this.dashboardData = {
                lastUpdated: timestamp,
                summary,
                charts,
                alerts: this.alerts.slice(-10) // Últimos 10 alertas
            };
            
            // Salvar dashboard
            await AsyncStorage.setItem(
                this.config.storageKeys.dashboardData,
                JSON.stringify(this.dashboardData)
            );
            
        } catch (error) {
            Logger.error('❌ Erro ao atualizar dashboard:', error);
        }
    }

    /**
     * Calcular média
     */
    calculateAverage(values) {
        if (values.length === 0) return 0;
        const sum = values.reduce((acc, val) => acc + val, 0);
        return sum / values.length;
    }

    /**
     * Salvar métricas
     */
    async saveMetrics() {
        try {
            await AsyncStorage.multiSet([
                [this.config.storageKeys.performanceMetrics, JSON.stringify(this.metrics.performance)],
                [this.config.storageKeys.userMetrics, JSON.stringify(this.metrics.user)],
                [this.config.storageKeys.systemMetrics, JSON.stringify(this.metrics.system)]
            ]);
        } catch (error) {
            Logger.error('❌ Erro ao salvar métricas:', error);
        }
    }

    /**
     * Salvar histórico de alertas
     */
    async saveAlertHistory() {
        try {
            await AsyncStorage.setItem(
                this.config.storageKeys.alertHistory,
                JSON.stringify(this.alerts.slice(-100)) // Últimos 100 alertas
            );
        } catch (error) {
            Logger.error('❌ Erro ao salvar histórico de alertas:', error);
        }
    }

    /**
     * Obter métricas
     */
    getMetrics() {
        return {
            ...this.metrics,
            isInitialized: this.isInitialized,
            isCollecting: this.isCollecting,
            alerts: this.alerts,
            dashboardData: this.dashboardData
        };
    }

    /**
     * Obter dashboard
     */
    getDashboard() {
        return this.dashboardData;
    }

    /**
     * Adicionar listener de alerta
     */
    addAlertListener(listener) {
        this.alertListeners.push(listener);
        
        // Retornar função para remover listener
        return () => {
            const index = this.alertListeners.indexOf(listener);
            if (index > -1) {
                this.alertListeners.splice(index, 1);
            }
        };
    }

    /**
     * Limpar métricas antigas
     */
    async cleanupOldMetrics() {
        try {
            const cutoffTime = Date.now() - this.config.retentionPeriod;
            
            // Limpar métricas antigas
            Object.keys(this.metrics).forEach(category => {
                Object.keys(this.metrics[category]).forEach(metric => {
                    if (Array.isArray(this.metrics[category][metric])) {
                        this.metrics[category][metric] = this.metrics[category][metric].filter(item => {
                            return item.timestamp > cutoffTime;
                        });
                    }
                });
            });
            
            // Limpar alertas antigos
            this.alerts = this.alerts.filter(alert => alert.timestamp > cutoffTime);
            
            Logger.log('📊 Métricas antigas limpas');
            
        } catch (error) {
            Logger.error('❌ Erro ao limpar métricas antigas:', error);
        }
    }

    /**
     * Limpar recursos
     */
    async cleanup() {
        try {
            // Parar coleta
            this.stopCollection();
            
            // Limpar interval
            if (this.collectionInterval) {
                clearInterval(this.collectionInterval);
            }
            
            // Salvar estado final
            await this.saveMetrics();
            
            this.isInitialized = false;
            this.alertListeners = [];
            
            Logger.log('✅ Sistema de monitoramento limpo');
            
        } catch (error) {
            Logger.error('❌ Erro ao limpar sistema de monitoramento:', error);
        }
    }
}

// Singleton
const realTimeMonitoringService = new RealTimeMonitoringService();
export default realTimeMonitoringService;






