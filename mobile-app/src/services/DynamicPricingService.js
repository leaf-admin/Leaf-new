import Logger from '../utils/Logger';
// DynamicPricingService.js - Serviço de tarifa dinâmica baseado em demanda

class DynamicPricingService {
    constructor() {
        this.pricingData = new Map(); // Cache de dados de preços por região
        this.updateInterval = 30000; // 30 segundos
        this.updateTimer = null;
        this.isRunning = false;
        this.listeners = new Map(); // Inicializar listeners
        
        // Configurações do modelo de tarifa dinâmica
        this.config = {
            // Fatores do modelo
            K: 0.3, // Fator de correção para suavizar variações bruscas
            
            // Limites operacionais
            minFactor: 1.0, // Sem aumento
            maxFactor: 2.5, // Tarifa até 150% acima do normal
            
            // Raio de área padrão (km)
            defaultRadius: 2,
            
            // Intervalos de atualização
            updateInterval: 30000, // 30 segundos
            
            // Indicadores visuais
            indicators: {
                green: { min: 1.0, max: 1.2, color: '#4CAF50', label: 'Demanda Normal' },
                yellow: { min: 1.3, max: 1.6, color: '#FF9800', label: 'Demanda Moderada' },
                red: { min: 1.7, max: 2.5, color: '#F44336', label: 'Alta Demanda' }
            }
        };
        
        this.startRealTimeUpdates();
    }

    // ==================== CÁLCULO DE TARIFA DINÂMICA ====================

    /**
     * Calcula o fator dinâmico baseado no modelo especificado
     * @param {number} M - Número de motoristas disponíveis na região
     * @param {number} P - Número de pedidos ativos na região
     * @param {number} K - Fator de correção (padrão: 0.3)
     * @returns {number} Fator dinâmico calculado
     */
    calculateDynamicFactor(M, P, K = this.config.K) {
        Logger.log('💰 DynamicPricingService - Calculando fator dinâmico:', {
            motoristas: M,
            pedidos: P,
            fatorK: K
        });

        // Evitar divisão por zero
        if (M === 0) {
            Logger.warn('⚠️ Nenhum motorista disponível, usando fator máximo');
            return this.config.maxFactor;
        }

        // Fórmula base: fator_dinamico = 1 + K * ((P / M) - 1)
        const ratio = P / M;
        const dynamicFactor = 1 + K * (ratio - 1);

        // Aplicar limites operacionais
        const clampedFactor = Math.max(
            this.config.minFactor,
            Math.min(this.config.maxFactor, dynamicFactor)
        );

        Logger.log('✅ Fator dinâmico calculado:', {
            ratio: ratio.toFixed(2),
            rawFactor: dynamicFactor.toFixed(2),
            clampedFactor: clampedFactor.toFixed(2)
        });

        return clampedFactor;
    }

    /**
     * Calcula tarifa final com fator dinâmico
     * @param {number} baseFare - Tarifa base
     * @param {number} dynamicFactor - Fator dinâmico calculado
     * @returns {number} Tarifa final
     */
    calculateFinalFare(baseFare, dynamicFactor) {
        const finalFare = baseFare * dynamicFactor;
        
        Logger.log('💰 Tarifa calculada:', {
            tarifaBase: baseFare,
            fatorDinamico: dynamicFactor.toFixed(2),
            tarifaFinal: finalFare.toFixed(2),
            aumento: ((dynamicFactor - 1) * 100).toFixed(1) + '%'
        });

        return finalFare;
    }

    // ==================== ANÁLISE POR REGIÃO ====================

    /**
     * Analisa demanda por região usando clusters H3
     * @param {Array} clusters - Clusters de motoristas
     * @param {number} lat - Latitude de referência
     * @param {number} lng - Longitude de referência
     * @param {number} radius - Raio em quilômetros
     * @returns {Object} Análise de demanda da região
     */
    analyzeRegionDemand(clusters, lat, lng, radius = this.config.defaultRadius) {
        Logger.log('🔍 DynamicPricingService - Analisando demanda da região:', {
            lat, lng, radius,
            clustersCount: clusters.length
        });

        // Filtrar clusters dentro do raio
        const nearbyClusters = clusters.filter(cluster => {
            const distance = this.calculateDistance(
                lat, lng,
                cluster.center.latitude, cluster.center.longitude
            );
            return distance <= radius;
        });

        // Calcular totais da região
        const totalDrivers = nearbyClusters.reduce((sum, cluster) => sum + cluster.count, 0);
        const totalOrders = this.estimateActiveOrders(nearbyClusters);
        
        // Calcular fator dinâmico
        const dynamicFactor = this.calculateDynamicFactor(totalDrivers, totalOrders);
        
        // Determinar indicador visual
        const indicator = this.getDemandIndicator(dynamicFactor);
        
        const analysis = {
            region: { lat, lng, radius },
            clusters: nearbyClusters.length,
            totalDrivers,
            totalOrders,
            dynamicFactor,
            indicator,
            timestamp: new Date().toISOString(),
            // Métricas adicionais
            driverDensity: totalDrivers / (Math.PI * radius * radius), // motoristas/km²
            orderToDriverRatio: totalDrivers > 0 ? totalOrders / totalDrivers : 0,
            demandLevel: this.getDemandLevel(dynamicFactor)
        };

        Logger.log('✅ Análise de demanda concluída:', analysis);
        return analysis;
    }

    /**
     * Estima pedidos ativos baseado nos clusters
     * @param {Array} clusters - Clusters próximos
     * @returns {number} Estimativa de pedidos ativos
     */
    estimateActiveOrders(clusters) {
        // Simulação baseada na densidade de motoristas e horário
        const now = new Date();
        const hour = now.getHours();
        
        // Fator de horário (picos de demanda)
        let timeFactor = 1.0;
        if (hour >= 7 && hour <= 9) timeFactor = 1.5; // Manhã
        else if (hour >= 17 && hour <= 19) timeFactor = 1.8; // Tarde
        else if (hour >= 22 || hour <= 6) timeFactor = 0.7; // Noite
        
        const totalDrivers = clusters.reduce((sum, cluster) => sum + cluster.count, 0);
        
        // Estimativa: 30-80% dos motoristas têm pedidos ativos, ajustado pelo horário
        const baseOrders = totalDrivers * (0.3 + Math.random() * 0.5);
        const estimatedOrders = Math.floor(baseOrders * timeFactor);
        
        Logger.log('📊 Estimativa de pedidos:', {
            totalDrivers,
            timeFactor,
            estimatedOrders,
            hour
        });
        
        return Math.max(1, estimatedOrders); // Mínimo 1 pedido
    }

    // ==================== INDICADORES VISUAIS ====================

    /**
     * Determina indicador visual baseado no fator dinâmico
     * @param {number} dynamicFactor - Fator dinâmico
     * @returns {Object} Indicador visual
     */
    getDemandIndicator(dynamicFactor) {
        const { indicators } = this.config;
        
        if (dynamicFactor >= indicators.green.min && dynamicFactor <= indicators.green.max) {
            return {
                ...indicators.green,
                factor: dynamicFactor,
                description: `Demanda normal (${((dynamicFactor - 1) * 100).toFixed(1)}% de aumento)`
            };
        } else if (dynamicFactor >= indicators.yellow.min && dynamicFactor <= indicators.yellow.max) {
            return {
                ...indicators.yellow,
                factor: dynamicFactor,
                description: `Demanda moderada (${((dynamicFactor - 1) * 100).toFixed(1)}% de aumento)`
            };
        } else if (dynamicFactor >= indicators.red.min && dynamicFactor <= indicators.red.max) {
            return {
                ...indicators.red,
                factor: dynamicFactor,
                description: `Alta demanda (${((dynamicFactor - 1) * 100).toFixed(1)}% de aumento)`
            };
        }
        
        // Fallback
        return {
            color: '#9E9E9E',
            label: 'Indefinido',
            factor: dynamicFactor,
            description: `Fator: ${dynamicFactor.toFixed(2)}`
        };
    }

    /**
     * Obtém nível de demanda textual
     * @param {number} dynamicFactor - Fator dinâmico
     * @returns {string} Nível de demanda
     */
    getDemandLevel(dynamicFactor) {
        if (dynamicFactor <= 1.2) return 'normal';
        if (dynamicFactor <= 1.6) return 'moderada';
        return 'alta';
    }

    // ==================== ATUALIZAÇÃO EM TEMPO REAL ====================

    /**
     * Inicia atualizações em tempo real
     */
    startRealTimeUpdates() {
        if (this.isRunning) return;
        
        Logger.log('🔄 DynamicPricingService - Iniciando atualizações em tempo real');
        this.isRunning = true;
        
        this.updateTimer = setInterval(() => {
            this.updateAllRegions();
        }, this.config.updateInterval);
    }

    /**
     * Para atualizações em tempo real
     */
    stopRealTimeUpdates() {
        if (this.updateTimer) {
            clearInterval(this.updateTimer);
            this.updateTimer = null;
        }
        this.isRunning = false;
        Logger.log('⏹️ DynamicPricingService - Atualizações em tempo real paradas');
    }

    /**
     * Atualiza dados de todas as regiões
     */
    updateAllRegions() {
        Logger.log('🔄 DynamicPricingService - Atualizando todas as regiões');
        
        // Em produção, isso seria conectado ao Redis/Realtime DB
        // Por enquanto, simulamos a atualização
        this.pricingData.clear();
        
        // Notificar listeners sobre atualização
        this.notifyListeners('pricingUpdated', {
            timestamp: new Date().toISOString(),
            regionsCount: this.pricingData.size
        });
    }

    // ==================== CACHE E PERSISTÊNCIA ====================

    /**
     * Armazena dados de preços para uma região
     * @param {string} regionKey - Chave da região
     * @param {Object} pricingData - Dados de preços
     */
    cachePricingData(regionKey, pricingData) {
        this.pricingData.set(regionKey, {
            ...pricingData,
            cachedAt: new Date().toISOString()
        });
    }

    /**
     * Recupera dados de preços de uma região
     * @param {string} regionKey - Chave da região
     * @returns {Object|null} Dados de preços ou null
     */
    getCachedPricingData(regionKey) {
        return this.pricingData.get(regionKey) || null;
    }

    /**
     * Gera chave única para região
     * @param {number} lat - Latitude
     * @param {number} lng - Longitude
     * @param {number} radius - Raio
     * @returns {string} Chave da região
     */
    generateRegionKey(lat, lng, radius) {
        // Arredondar para precisão de ~100m
        const precision = 3;
        const roundedLat = Math.round(lat * Math.pow(10, precision)) / Math.pow(10, precision);
        const roundedLng = Math.round(lng * Math.pow(10, precision)) / Math.pow(10, precision);
        return `${roundedLat}_${roundedLng}_${radius}`;
    }

    // ==================== LISTENERS E EVENTOS ====================

    /**
     * Adiciona listener para eventos
     * @param {string} event - Nome do evento
     * @param {Function} callback - Função callback
     */
    addListener(event, callback) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }
        this.listeners.get(event).push(callback);
    }

    /**
     * Remove listener
     * @param {string} event - Nome do evento
     * @param {Function} callback - Função callback
     */
    removeListener(event, callback) {
        if (this.listeners.has(event)) {
            const callbacks = this.listeners.get(event);
            const index = callbacks.indexOf(callback);
            if (index > -1) {
                callbacks.splice(index, 1);
            }
        }
    }

    /**
     * Notifica todos os listeners de um evento
     * @param {string} event - Nome do evento
     * @param {Object} data - Dados do evento
     */
    notifyListeners(event, data) {
        if (this.listeners.has(event)) {
            this.listeners.get(event).forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    Logger.error('❌ Erro ao notificar listener:', error);
                }
            });
        }
    }

    // ==================== UTILITÁRIOS ====================

    /**
     * Calcula distância entre duas coordenadas (Haversine)
     * @param {number} lat1 - Latitude 1
     * @param {number} lng1 - Longitude 1
     * @param {number} lat2 - Latitude 2
     * @param {number} lng2 - Longitude 2
     * @returns {number} Distância em quilômetros
     */
    calculateDistance(lat1, lng1, lat2, lng2) {
        const R = 6371; // Raio da Terra em km
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLng = (lng2 - lng1) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                Math.sin(dLng/2) * Math.sin(dLng/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    }

    /**
     * Obtém estatísticas do serviço
     * @returns {Object} Estatísticas
     */
    getStats() {
        return {
            isRunning: this.isRunning,
            updateInterval: this.config.updateInterval,
            cachedRegions: this.pricingData.size,
            config: this.config,
            listeners: Array.from(this.listeners.keys())
        };
    }

    /**
     * Limpa cache de dados
     */
    clearCache() {
        this.pricingData.clear();
        Logger.log('🗑️ DynamicPricingService - Cache limpo');
    }
}

export default new DynamicPricingService();

