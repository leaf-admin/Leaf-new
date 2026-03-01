import Logger from '../utils/Logger';
/**
 * 🧠 SISTEMA DE CACHE INTELIGENTE AVANÇADO
 * Complementa o sistema de cache existente com funcionalidades inteligentes
 */

import localCacheService from './LocalCacheService';
import WebSocketManager from './WebSocketManager';
import IntelligentFallbackService from './IntelligentFallbackService';
import realTimeMonitoringService from './RealTimeMonitoringService';


class IntelligentCacheService {
    constructor() {
        this.wsManager = WebSocketManager.getInstance();
        this.fallbackService = IntelligentFallbackService;
        this.monitoringService = realTimeMonitoringService;

        // Configurações do cache inteligente
        this.config = {
            // Cache predictivo
            predictiveCache: {
                enabled: true,
                preloadRadius: 5000, // 5km
                preloadTime: 30000, // 30 segundos
                userPatternWindow: 7 * 24 * 60 * 60 * 1000, // 7 dias
                maxPredictions: 10
            },

            // Cache adaptativo
            adaptiveCache: {
                enabled: true,
                minTTL: 60000, // 1 minuto
                maxTTL: 24 * 60 * 60 * 1000, // 24 horas
                accessThreshold: 3, // Mínimo de acessos para considerar popular
                decayFactor: 0.9 // Fator de decaimento para TTL
            },

            // Cache de WebSocket
            websocketCache: {
                enabled: true,
                maxEvents: 1000,
                eventTTL: 5 * 60 * 1000, // 5 minutos
                syncInterval: 10000 // 10 segundos
            },

            // Cache de fallback
            fallbackCache: {
                enabled: true,
                maxFallbackItems: 500,
                fallbackTTL: 60 * 60 * 1000, // 1 hora
                priorityThreshold: 0.8 // Prioridade mínima para cache de fallback
            },

            // Storage keys
            storageKeys: {
                predictiveData: '@predictive_cache',
                adaptiveMetrics: '@adaptive_metrics',
                websocketEvents: '@websocket_cache',
                fallbackData: '@fallback_cache',
                userPatterns: '@user_patterns',
                cacheAnalytics: '@cache_analytics'
            }
        };

        // Estados
        this.isInitialized = false;
        this.isPredictiveEnabled = false;
        this.isAdaptiveEnabled = false;

        // Dados do cache inteligente
        this.cacheData = {
            predictive: new Map(),
            adaptive: new Map(),
            websocket: new Map(),
            fallback: new Map(),
            userPatterns: new Map(),
            analytics: {
                hits: 0,
                misses: 0,
                predictions: 0,
                adaptations: 0,
                lastReset: Date.now()
            }
        };

        // Listeners
        this.eventListeners = [];

        Logger.log('🧠 Sistema de cache inteligente avançado inicializado');
    }

    /**
     * Inicializar o sistema de cache inteligente
     */
    async initialize() {
        try {
            Logger.log('🧠 Inicializando sistema de cache inteligente...');

            // 1. Carregar dados existentes
            await this.loadExistingData();

            // 2. Configurar cache predictivo
            if (this.config.predictiveCache.enabled) {
                await this.setupPredictiveCache();
            }

            // 3. Configurar cache adaptativo
            if (this.config.adaptiveCache.enabled) {
                await this.setupAdaptiveCache();
            }

            // 4. Configurar cache de WebSocket
            if (this.config.websocketCache.enabled) {
                await this.setupWebSocketCache();
            }

            // 5. Configurar cache de fallback
            if (this.config.fallbackCache.enabled) {
                await this.setupFallbackCache();
            }

            // 6. Configurar listeners
            this.setupEventListeners();

            this.isInitialized = true;
            Logger.log('✅ Sistema de cache inteligente inicializado');

        } catch (error) {
            Logger.error('❌ Erro ao inicializar cache inteligente:', error);
            throw error;
        }
    }

    /**
     * Carregar dados existentes
     */
    async loadExistingData() {
        try {
            // Carregar dados predictivos
            const predictiveData = await localCacheService.getItem(this.config.storageKeys.predictiveData);
            if (predictiveData) {
                this.cacheData.predictive = new Map(JSON.parse(predictiveData));
            }

            // Carregar métricas adaptativas
            const adaptiveData = await localCacheService.getItem(this.config.storageKeys.adaptiveMetrics);
            if (adaptiveData) {
                this.cacheData.adaptive = new Map(JSON.parse(adaptiveData));
            }

            // Carregar eventos WebSocket
            const websocketData = await localCacheService.getItem(this.config.storageKeys.websocketEvents);
            if (websocketData) {
                this.cacheData.websocket = new Map(JSON.parse(websocketData));
            }

            // Carregar dados de fallback
            const fallbackData = await localCacheService.getItem(this.config.storageKeys.fallbackData);
            if (fallbackData) {
                this.cacheData.fallback = new Map(JSON.parse(fallbackData));
            }

            // Carregar padrões de usuário
            const userPatterns = await localCacheService.getItem(this.config.storageKeys.userPatterns);
            if (userPatterns) {
                this.cacheData.userPatterns = new Map(JSON.parse(userPatterns));
            }

            // Carregar analytics
            const analytics = await localCacheService.getItem(this.config.storageKeys.cacheAnalytics);
            if (analytics) {
                this.cacheData.analytics = { ...this.cacheData.analytics, ...JSON.parse(analytics) };
            }

            Logger.log('🧠 Dados existentes carregados');

        } catch (error) {
            Logger.error('❌ Erro ao carregar dados existentes:', error);
        }
    }

    /**
     * Configurar cache predictivo
     */
    async setupPredictiveCache() {
        try {
            this.isPredictiveEnabled = true;

            // Configurar pre-carregamento baseado em padrões
            setInterval(async () => {
                await this.performPredictivePreload();
            }, this.config.predictiveCache.preloadTime);

            Logger.log('🧠 Cache predictivo configurado');

        } catch (error) {
            Logger.error('❌ Erro ao configurar cache predictivo:', error);
        }
    }

    /**
     * Configurar cache adaptativo
     */
    async setupAdaptiveCache() {
        try {
            this.isAdaptiveEnabled = true;

            // Configurar análise adaptativa
            setInterval(async () => {
                await this.performAdaptiveAnalysis();
            }, 60000); // A cada minuto

            Logger.log('🧠 Cache adaptativo configurado');

        } catch (error) {
            Logger.error('❌ Erro ao configurar cache adaptativo:', error);
        }
    }

    /**
     * Configurar cache de WebSocket
     */
    async setupWebSocketCache() {
        try {
            // Configurar sincronização de eventos
            setInterval(async () => {
                await this.syncWebSocketCache();
            }, this.config.websocketCache.syncInterval);

            Logger.log('🧠 Cache de WebSocket configurado');

        } catch (error) {
            Logger.error('❌ Erro ao configurar cache de WebSocket:', error);
        }
    }

    /**
     * Configurar cache de fallback
     */
    async setupFallbackCache() {
        try {
            // Configurar integração com fallback service
            this.fallbackService.addConnectivityListener(async (isOnline) => {
                if (!isOnline) {
                    await this.activateFallbackCache();
                } else {
                    await this.deactivateFallbackCache();
                }
            });

            Logger.log('🧠 Cache de fallback configurado');

        } catch (error) {
            Logger.error('❌ Erro ao configurar cache de fallback:', error);
        }
    }

    /**
     * Configurar listeners de eventos
     */
    setupEventListeners() {
        // WebSocket listeners
        this.wsManager.on('connect', () => {
            this.recordCacheEvent('websocket_connected', { timestamp: Date.now() });
        });

        this.wsManager.on('disconnect', () => {
            this.recordCacheEvent('websocket_disconnected', { timestamp: Date.now() });
        });

        // Fallback listeners
        this.fallbackService.addConnectivityListener((isOnline) => {
            this.recordCacheEvent('connectivity_change', { isOnline, timestamp: Date.now() });
        });

        Logger.log('🧠 Listeners de eventos configurados');
    }

    /**
     * Executar pre-carregamento predictivo
     */
    async performPredictivePreload() {
        try {
            if (!this.isPredictiveEnabled) return;

            // Analisar padrões de usuário
            const userPatterns = await this.analyzeUserPatterns();

            // Pre-carregar dados baseado nos padrões
            for (const pattern of userPatterns) {
                await this.preloadBasedOnPattern(pattern);
            }

            Logger.log(`🧠 Pre-carregamento predictivo executado: ${userPatterns.length} padrões`);

        } catch (error) {
            Logger.error('❌ Erro no pre-carregamento predictivo:', error);
        }
    }

    /**
     * Analisar padrões de usuário
     */
    async analyzeUserPatterns() {
        try {
            const patterns = [];
            const now = Date.now();
            const windowStart = now - this.config.predictiveCache.userPatternWindow;

            // Analisar padrões de localização
            const locationPatterns = await this.analyzeLocationPatterns(windowStart);
            patterns.push(...locationPatterns);

            // Analisar padrões de horário
            const timePatterns = await this.analyzeTimePatterns(windowStart);
            patterns.push(...timePatterns);

            // Analisar padrões de uso
            const usagePatterns = await this.analyzeUsagePatterns(windowStart);
            patterns.push(...usagePatterns);

            return patterns.slice(0, this.config.predictiveCache.maxPredictions);

        } catch (error) {
            Logger.error('❌ Erro ao analisar padrões de usuário:', error);
            return [];
        }
    }

    /**
     * Analisar padrões de localização
     */
    async analyzeLocationPatterns(windowStart) {
        try {
            const patterns = [];

            // Simular análise de padrões de localização
            const frequentLocations = [
                { lat: -23.5505, lng: -46.6333, frequency: 0.8, lastUsed: Date.now() - 3600000 },
                { lat: -23.5615, lng: -46.6553, frequency: 0.6, lastUsed: Date.now() - 7200000 },
                { lat: -23.5700, lng: -46.6400, frequency: 0.4, lastUsed: Date.now() - 10800000 }
            ];

            for (const location of frequentLocations) {
                if (location.frequency > 0.3) {
                    patterns.push({
                        type: 'location',
                        data: location,
                        priority: location.frequency,
                        prediction: 'frequent_location'
                    });
                }
            }

            return patterns;

        } catch (error) {
            Logger.error('❌ Erro ao analisar padrões de localização:', error);
            return [];
        }
    }

    /**
     * Analisar padrões de horário
     */
    async analyzeTimePatterns(windowStart) {
        try {
            const patterns = [];
            const now = new Date();
            const currentHour = now.getHours();

            // Simular análise de padrões de horário
            const timePatterns = [
                { hour: 8, frequency: 0.7, type: 'morning_commute' },
                { hour: 18, frequency: 0.8, type: 'evening_commute' },
                { hour: 12, frequency: 0.5, type: 'lunch_time' }
            ];

            for (const pattern of timePatterns) {
                if (Math.abs(currentHour - pattern.hour) <= 1) {
                    patterns.push({
                        type: 'time',
                        data: pattern,
                        priority: pattern.frequency,
                        prediction: 'time_based'
                    });
                }
            }

            return patterns;

        } catch (error) {
            Logger.error('❌ Erro ao analisar padrões de horário:', error);
            return [];
        }
    }

    /**
     * Analisar padrões de uso
     */
    async analyzeUsagePatterns(windowStart) {
        try {
            const patterns = [];

            // Simular análise de padrões de uso
            const usagePatterns = [
                { action: 'search_drivers', frequency: 0.9, lastUsed: Date.now() - 1800000 },
                { action: 'calculate_price', frequency: 0.8, lastUsed: Date.now() - 3600000 },
                { action: 'get_directions', frequency: 0.7, lastUsed: Date.now() - 5400000 }
            ];

            for (const pattern of usagePatterns) {
                if (pattern.frequency > 0.5) {
                    patterns.push({
                        type: 'usage',
                        data: pattern,
                        priority: pattern.frequency,
                        prediction: 'usage_based'
                    });
                }
            }

            return patterns;

        } catch (error) {
            Logger.error('❌ Erro ao analisar padrões de uso:', error);
            return [];
        }
    }

    /**
     * Pre-carregar dados baseado em padrão
     */
    async preloadBasedOnPattern(pattern) {
        try {
            switch (pattern.type) {
                case 'location':
                    await this.preloadLocationData(pattern.data);
                    break;
                case 'time':
                    await this.preloadTimeBasedData(pattern.data);
                    break;
                case 'usage':
                    await this.preloadUsageBasedData(pattern.data);
                    break;
            }

            this.cacheData.analytics.predictions++;

        } catch (error) {
            Logger.error('❌ Erro ao pre-carregar dados:', error);
        }
    }

    /**
     * Pre-carregar dados de localização
     */
    async preloadLocationData(locationData) {
        try {
            const { lat, lng } = locationData;

            // Pre-carregar motoristas próximos
            const nearbyDrivers = await this.preloadNearbyDrivers(lat, lng);

            // Pre-carregar rotas comuns
            const commonRoutes = await this.preloadCommonRoutes(lat, lng);

            // Salvar no cache predictivo
            const key = `predictive_location_${lat}_${lng}`;
            this.cacheData.predictive.set(key, {
                type: 'location',
                data: { nearbyDrivers, commonRoutes },
                timestamp: Date.now(),
                ttl: Date.now() + this.config.predictiveCache.preloadTime
            });

            Logger.log(`🧠 Dados de localização pre-carregados: ${lat}, ${lng}`);

        } catch (error) {
            Logger.error('❌ Erro ao pre-carregar dados de localização:', error);
        }
    }

    /**
     * Pre-carregar motoristas próximos
     */
    async preloadNearbyDrivers(lat, lng) {
        try {
            // Simular busca de motoristas próximos
            return [
                { id: 'driver_1', lat: lat + 0.001, lng: lng + 0.001, distance: 100 },
                { id: 'driver_2', lat: lat - 0.001, lng: lng - 0.001, distance: 200 },
                { id: 'driver_3', lat: lat + 0.002, lng: lng - 0.001, distance: 300 }
            ];
        } catch (error) {
            Logger.error('❌ Erro ao pre-carregar motoristas:', error);
            return [];
        }
    }

    /**
     * Pre-carregar rotas comuns
     */
    async preloadCommonRoutes(lat, lng) {
        try {
            // Simular rotas comuns
            return [
                { destination: { lat: lat + 0.01, lng: lng + 0.01 }, frequency: 0.8 },
                { destination: { lat: lat - 0.01, lng: lng - 0.01 }, frequency: 0.6 },
                { destination: { lat: lat + 0.02, lng: lng - 0.01 }, frequency: 0.4 }
            ];
        } catch (error) {
            Logger.error('❌ Erro ao pre-carregar rotas:', error);
            return [];
        }
    }

    /**
     * Pre-carregar dados baseados em horário
     */
    async preloadTimeBasedData(timeData) {
        try {
            // Pre-carregar dados específicos do horário
            const timeBasedData = {
                hour: timeData.hour,
                type: timeData.type,
                commonDestinations: await this.getCommonDestinationsForTime(timeData.hour),
                expectedDemand: await this.getExpectedDemandForTime(timeData.hour)
            };

            const key = `predictive_time_${timeData.hour}`;
            this.cacheData.predictive.set(key, {
                type: 'time',
                data: timeBasedData,
                timestamp: Date.now(),
                ttl: Date.now() + this.config.predictiveCache.preloadTime
            });

            Logger.log(`🧠 Dados de horário pre-carregados: ${timeData.hour}h`);

        } catch (error) {
            Logger.error('❌ Erro ao pre-carregar dados de horário:', error);
        }
    }

    /**
     * Pre-carregar dados baseados em uso
     */
    async preloadUsageBasedData(usageData) {
        try {
            // Pre-carregar dados específicos do uso
            const usageBasedData = {
                action: usageData.action,
                frequency: usageData.frequency,
                relatedData: await this.getRelatedDataForAction(usageData.action)
            };

            const key = `predictive_usage_${usageData.action}`;
            this.cacheData.predictive.set(key, {
                type: 'usage',
                data: usageBasedData,
                timestamp: Date.now(),
                ttl: Date.now() + this.config.predictiveCache.preloadTime
            });

            Logger.log(`🧠 Dados de uso pre-carregados: ${usageData.action}`);

        } catch (error) {
            Logger.error('❌ Erro ao pre-carregar dados de uso:', error);
        }
    }

    /**
     * Executar análise adaptativa
     */
    async performAdaptiveAnalysis() {
        try {
            if (!this.isAdaptiveEnabled) return;

            // Analisar padrões de acesso
            const accessPatterns = await this.analyzeAccessPatterns();

            // Ajustar TTL baseado nos padrões
            for (const pattern of accessPatterns) {
                await this.adjustTTLBasedOnPattern(pattern);
            }

            Logger.log(`🧠 Análise adaptativa executada: ${accessPatterns.length} ajustes`);

        } catch (error) {
            Logger.error('❌ Erro na análise adaptativa:', error);
        }
    }

    /**
     * Analisar padrões de acesso
     */
    async analyzeAccessPatterns() {
        try {
            const patterns = [];

            // Simular análise de padrões de acesso
            const accessData = [
                { key: 'route_123', accessCount: 15, lastAccess: Date.now() - 300000, ttl: 3600000 },
                { key: 'price_456', accessCount: 8, lastAccess: Date.now() - 600000, ttl: 120000 },
                { key: 'drivers_789', accessCount: 3, lastAccess: Date.now() - 900000, ttl: 300000 }
            ];

            for (const data of accessData) {
                if (data.accessCount >= this.config.adaptiveCache.accessThreshold) {
                    patterns.push({
                        key: data.key,
                        accessCount: data.accessCount,
                        currentTTL: data.ttl,
                        lastAccess: data.lastAccess,
                        popularity: data.accessCount / 20 // Normalizar
                    });
                }
            }

            return patterns;

        } catch (error) {
            Logger.error('❌ Erro ao analisar padrões de acesso:', error);
            return [];
        }
    }

    /**
     * Ajustar TTL baseado em padrão
     */
    async adjustTTLBasedOnPattern(pattern) {
        try {
            const { key, accessCount, currentTTL, popularity } = pattern;

            // Calcular novo TTL baseado na popularidade
            const baseTTL = this.config.adaptiveCache.minTTL;
            const maxTTL = this.config.adaptiveCache.maxTTL;
            const newTTL = Math.min(maxTTL, baseTTL * Math.pow(2, popularity * 5));

            // Aplicar fator de decaimento se não foi acessado recentemente
            const timeSinceLastAccess = Date.now() - pattern.lastAccess;
            const decayFactor = Math.pow(this.config.adaptiveCache.decayFactor, timeSinceLastAccess / 3600000);
            const adjustedTTL = newTTL * decayFactor;

            // Salvar ajuste
            this.cacheData.adaptive.set(key, {
                originalTTL: currentTTL,
                adjustedTTL: Math.max(this.config.adaptiveCache.minTTL, adjustedTTL),
                popularity,
                lastAdjustment: Date.now()
            });

            this.cacheData.analytics.adaptations++;

            Logger.log(`🧠 TTL ajustado para ${key}: ${currentTTL}ms → ${Math.round(adjustedTTL)}ms`);

        } catch (error) {
            Logger.error('❌ Erro ao ajustar TTL:', error);
        }
    }

    /**
     * Sincronizar cache de WebSocket
     */
    async syncWebSocketCache() {
        try {
            // Sincronizar eventos WebSocket com cache
            const events = await this.getRecentWebSocketEvents();

            for (const event of events) {
                const key = `websocket_${event.type}_${event.timestamp}`;
                this.cacheData.websocket.set(key, {
                    type: event.type,
                    data: event.data,
                    timestamp: event.timestamp,
                    ttl: Date.now() + this.config.websocketCache.eventTTL
                });
            }

            // Limpar eventos expirados
            await this.cleanupExpiredWebSocketEvents();

            Logger.log(`🧠 Cache de WebSocket sincronizado: ${events.length} eventos`);

        } catch (error) {
            Logger.error('❌ Erro na sincronização do cache WebSocket:', error);
        }
    }

    /**
     * Obter eventos WebSocket recentes
     */
    async getRecentWebSocketEvents() {
        try {
            // Simular eventos WebSocket recentes
            return [
                { type: 'driverLocationUpdate', data: { driverId: 'driver_1', lat: -23.5505, lng: -46.6333 }, timestamp: Date.now() - 5000 },
                { type: 'rideRequest', data: { customerId: 'customer_1', pickupLocation: { lat: -23.5505, lng: -46.6333 } }, timestamp: Date.now() - 10000 },
                { type: 'paymentConfirmed', data: { bookingId: 'booking_1', amount: 25.5 }, timestamp: Date.now() - 15000 }
            ];
        } catch (error) {
            Logger.error('❌ Erro ao obter eventos WebSocket:', error);
            return [];
        }
    }

    /**
     * Limpar eventos WebSocket expirados
     */
    async cleanupExpiredWebSocketEvents() {
        try {
            const now = Date.now();
            const expiredKeys = [];

            for (const [key, value] of this.cacheData.websocket) {
                if (value.ttl < now) {
                    expiredKeys.push(key);
                }
            }

            expiredKeys.forEach(key => {
                this.cacheData.websocket.delete(key);
            });

            if (expiredKeys.length > 0) {
                Logger.log(`🧠 Eventos WebSocket expirados removidos: ${expiredKeys.length}`);
            }

        } catch (error) {
            Logger.error('❌ Erro ao limpar eventos expirados:', error);
        }
    }

    /**
     * Ativar cache de fallback
     */
    async activateFallbackCache() {
        try {
            Logger.log('🧠 Ativando cache de fallback...');

            // Pre-carregar dados críticos para fallback
            const criticalData = await this.preloadCriticalFallbackData();

            for (const [key, data] of criticalData) {
                this.cacheData.fallback.set(key, {
                    ...data,
                    priority: data.priority || 0.5,
                    fallbackTTL: Date.now() + this.config.fallbackCache.fallbackTTL
                });
            }

            Logger.log(`🧠 Cache de fallback ativado: ${criticalData.size} itens`);

        } catch (error) {
            Logger.error('❌ Erro ao ativar cache de fallback:', error);
        }
    }

    /**
     * Desativar cache de fallback
     */
    async deactivateFallbackCache() {
        try {
            Logger.log('🧠 Desativando cache de fallback...');

            // Limpar cache de fallback
            this.cacheData.fallback.clear();

            Logger.log('🧠 Cache de fallback desativado');

        } catch (error) {
            Logger.error('❌ Erro ao desativar cache de fallback:', error);
        }
    }

    /**
     * Pre-carregar dados críticos para fallback
     */
    async preloadCriticalFallbackData() {
        try {
            const criticalData = new Map();

            // Dados críticos para fallback
            criticalData.set('fallback_routes', {
                data: await this.getCriticalRoutes(),
                priority: 0.9,
                type: 'route'
            });

            criticalData.set('fallback_prices', {
                data: await this.getCriticalPrices(),
                priority: 0.8,
                type: 'price'
            });

            criticalData.set('fallback_drivers', {
                data: await this.getCriticalDrivers(),
                priority: 0.7,
                type: 'driver'
            });

            return criticalData;

        } catch (error) {
            Logger.error('❌ Erro ao pre-carregar dados críticos:', error);
            return new Map();
        }
    }

    /**
     * Obter rotas críticas
     */
    async getCriticalRoutes() {
        try {
            // Simular rotas críticas
            return [
                { start: { lat: -23.5505, lng: -46.6333 }, end: { lat: -23.5615, lng: -46.6553 }, distance: 5.2, time: 1200 },
                { start: { lat: -23.5700, lng: -46.6400 }, end: { lat: -23.5800, lng: -46.6500 }, distance: 3.8, time: 900 }
            ];
        } catch (error) {
            Logger.error('❌ Erro ao obter rotas críticas:', error);
            return [];
        }
    }

    /**
     * Obter preços críticos
     */
    async getCriticalPrices() {
        try {
            // Simular preços críticos
            return [
                { distance: 5.2, time: 1200, baseFare: 5.00, totalFare: 28.00, carType: 'standard' },
                { distance: 3.8, time: 900, baseFare: 5.00, totalFare: 20.50, carType: 'standard' }
            ];
        } catch (error) {
            Logger.error('❌ Erro ao obter preços críticos:', error);
            return [];
        }
    }

    /**
     * Obter motoristas críticos
     */
    async getCriticalDrivers() {
        try {
            // Simular motoristas críticos
            return [
                { id: 'driver_1', lat: -23.5505, lng: -46.6333, status: 'online', rating: 4.8 },
                { id: 'driver_2', lat: -23.5600, lng: -46.6400, status: 'online', rating: 4.9 }
            ];
        } catch (error) {
            Logger.error('❌ Erro ao obter motoristas críticos:', error);
            return [];
        }
    }

    /**
     * Registrar evento de cache
     */
    recordCacheEvent(eventType, data) {
        try {
            const event = {
                type: eventType,
                data,
                timestamp: Date.now()
            };

            // Notificar listeners
            this.eventListeners.forEach(listener => {
                try {
                    listener(event);
                } catch (error) {
                    Logger.error('❌ Erro em listener de cache:', error);
                }
            });

            // Atualizar analytics
            if (eventType.includes('hit')) {
                this.cacheData.analytics.hits++;
            } else if (eventType.includes('miss')) {
                this.cacheData.analytics.misses++;
            }

        } catch (error) {
            Logger.error('❌ Erro ao registrar evento de cache:', error);
        }
    }

    /**
     * Obter dados do cache inteligente
     */
    getCacheData(key, type = 'predictive') {
        try {
            const cache = this.cacheData[type];
            if (!cache) return null;

            const data = cache.get(key);
            if (!data) return null;

            // Verificar TTL
            if (data.ttl && data.ttl < Date.now()) {
                cache.delete(key);
                return null;
            }

            // Registrar hit
            this.recordCacheEvent('cache_hit', { key, type });

            return data;

        } catch (error) {
            Logger.error('❌ Erro ao obter dados do cache:', error);
            return null;
        }
    }

    /**
     * Salvar dados no cache inteligente
     */
    setCacheData(key, data, type = 'predictive', ttl = null) {
        try {
            const cache = this.cacheData[type];
            if (!cache) return false;

            const cacheData = {
                ...data,
                timestamp: Date.now(),
                ttl: ttl || Date.now() + this.config.predictiveCache.preloadTime
            };

            cache.set(key, cacheData);

            // Registrar miss (dados não estavam em cache)
            this.recordCacheEvent('cache_miss', { key, type });

            return true;

        } catch (error) {
            Logger.error('❌ Erro ao salvar dados no cache:', error);
            return false;
        }
    }

    /**
     * Obter analytics do cache
     */
    getCacheAnalytics() {
        return {
            ...this.cacheData.analytics,
            hitRate: this.cacheData.analytics.hits / (this.cacheData.analytics.hits + this.cacheData.analytics.misses) || 0,
            predictiveSize: this.cacheData.predictive.size,
            adaptiveSize: this.cacheData.adaptive.size,
            websocketSize: this.cacheData.websocket.size,
            fallbackSize: this.cacheData.fallback.size,
            userPatternsSize: this.cacheData.userPatterns.size
        };
    }

    /**
     * Adicionar listener de eventos
     */
    addEventListener(listener) {
        this.eventListeners.push(listener);

        // Retornar função para remover listener
        return () => {
            const index = this.eventListeners.indexOf(listener);
            if (index > -1) {
                this.eventListeners.splice(index, 1);
            }
        };
    }

    /**
     * Salvar dados do cache
     */
    async saveCacheData() {
        try {
            await localCacheService.multiSet([
                [this.config.storageKeys.predictiveData, JSON.stringify([...this.cacheData.predictive])],
                [this.config.storageKeys.adaptiveMetrics, JSON.stringify([...this.cacheData.adaptive])],
                [this.config.storageKeys.websocketEvents, JSON.stringify([...this.cacheData.websocket])],
                [this.config.storageKeys.fallbackData, JSON.stringify([...this.cacheData.fallback])],
                [this.config.storageKeys.userPatterns, JSON.stringify([...this.cacheData.userPatterns])],
                [this.config.storageKeys.cacheAnalytics, JSON.stringify(this.cacheData.analytics)]
            ]);

        } catch (error) {
            Logger.error('❌ Erro ao salvar dados do cache:', error);
        }
    }

    /**
     * Limpar recursos
     */
    async cleanup() {
        try {
            // Salvar dados finais
            await this.saveCacheData();

            this.isInitialized = false;
            this.eventListeners = [];

            Logger.log('✅ Sistema de cache inteligente limpo');

        } catch (error) {
            Logger.error('❌ Erro ao limpar cache inteligente:', error);
        }
    }
}

// Singleton
const intelligentCacheService = new IntelligentCacheService();
export default intelligentCacheService;






