import Logger from '../utils/Logger';
// useDynamicPricing.js - Hook para tarifa dinâmica
import { useState, useEffect, useCallback, useRef } from 'react';
import { useSelector } from 'react-redux';
import DynamicPricingService from '../services/DynamicPricingService';


export const useDynamicPricing = () => {
    const auth = useSelector(state => state.auth);
    const settings = useSelector(state => state.settingsdata?.settings);
    const isDriver = auth.profile?.usertype === 'driver' || auth.profile?.userType === 'driver';
    
    // Estados da tarifa dinâmica
    const [pricingData, setPricingData] = useState(null);
    const [demandIndicator, setDemandIndicator] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [lastUpdate, setLastUpdate] = useState(null);
    const [error, setError] = useState(null);
    
    // Estados de configuração
    const [currentRegion, setCurrentRegion] = useState(null);
    const [pricingHistory, setPricingHistory] = useState([]);
    
    // Refs para otimização
    const updateTimeoutRef = useRef(null);
    const lastRegionRef = useRef(null);

    // Verificar se tarifa dinâmica está habilitada pelo admin (via settings do backend)
    // Padrão: false (desabilitado na fase inicial de baixa demanda)
    // Só está habilitado se explicitamente definido como true pelo admin
    const isEnabled = settings?.dynamicPricingEnabled === true;

    // ==================== FUNÇÕES PRINCIPAIS ====================

    // Limpar dados quando tarifa dinâmica for desabilitada pelo admin
    useEffect(() => {
        if (!isEnabled && pricingData) {
            Logger.log('⚠️ useDynamicPricing - Tarifa dinâmica desabilitada pelo admin, limpando dados');
            setPricingData(null);
            setDemandIndicator(null);
        }
    }, [isEnabled, pricingData]);

    /**
     * Calcula tarifa dinâmica para uma região específica
     * @param {number} lat - Latitude
     * @param {number} lng - Longitude
     * @param {number} radius - Raio em km
     * @param {Array} clusters - Clusters de motoristas
     * @param {number} baseFare - Tarifa base
     */
    const calculateDynamicPricing = useCallback(async (lat, lng, radius = 2, clusters = [], baseFare = 20) => {
        if (!isDriver) {
            Logger.log('⚠️ useDynamicPricing - Usuário não é motorista, tarifa dinâmica desabilitada');
            return;
        }

        if (!isEnabled) {
            Logger.log('⚠️ useDynamicPricing - Tarifa dinâmica desabilitada pelo usuário');
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            Logger.log('💰 useDynamicPricing - Calculando tarifa dinâmica:', {
                lat, lng, radius,
                clustersCount: clusters.length,
                baseFare
            });

            // Analisar demanda da região
            const demandAnalysis = DynamicPricingService.analyzeRegionDemand(clusters, lat, lng, radius);
            
            // Calcular tarifa final
            const finalFare = DynamicPricingService.calculateFinalFare(baseFare, demandAnalysis.dynamicFactor);
            
            // Obter indicador visual
            const indicator = DynamicPricingService.getDemandIndicator(demandAnalysis.dynamicFactor);
            
            const pricingResult = {
                region: { lat, lng, radius },
                baseFare,
                dynamicFactor: demandAnalysis.dynamicFactor,
                finalFare,
                indicator,
                demandAnalysis,
                timestamp: new Date().toISOString()
            };

            setPricingData(pricingResult);
            setDemandIndicator(indicator);
            setLastUpdate(new Date());
            
            // Adicionar ao histórico
            setPricingHistory(prev => [...prev.slice(-9), pricingResult]); // Manter últimos 10
            
            // Cache dos dados
            const regionKey = DynamicPricingService.generateRegionKey(lat, lng, radius);
            DynamicPricingService.cachePricingData(regionKey, pricingResult);
            
            Logger.log('✅ Tarifa dinâmica calculada:', pricingResult);
            
            return pricingResult;
            
        } catch (error) {
            Logger.error('❌ useDynamicPricing - Erro ao calcular tarifa:', error);
            setError(error.message);
        } finally {
            setIsLoading(false);
        }
    }, [isDriver]);

    /**
     * Atualiza tarifa dinâmica quando região muda
     * @param {Object} region - Região do mapa
     * @param {Array} clusters - Clusters de motoristas
     * @param {number} baseFare - Tarifa base
     */
    const updatePricingForRegion = useCallback((region, clusters = [], baseFare = 20) => {
        if (!isDriver || !region || !isEnabled) return;
        
        // Debounce para evitar muitas atualizações
        if (updateTimeoutRef.current) {
            clearTimeout(updateTimeoutRef.current);
        }
        
        updateTimeoutRef.current = setTimeout(() => {
            const regionKey = `${region.latitude}_${region.longitude}_${region.latitudeDelta}`;
            
            // Evitar recálculo desnecessário
            if (lastRegionRef.current === regionKey) {
                return;
            }
            
            lastRegionRef.current = regionKey;
            setCurrentRegion(region);
            
            Logger.log('🔄 useDynamicPricing - Atualizando tarifa para nova região:', region);
            
            calculateDynamicPricing(
                region.latitude,
                region.longitude,
                DynamicPricingService.config.defaultRadius,
                clusters,
                baseFare
            );
        }, 500); // 500ms de debounce
    }, [isDriver, isEnabled, calculateDynamicPricing]);

    /**
     * Obtém tarifa dinâmica para uma corrida específica
     * @param {Object} rideData - Dados da corrida
     * @returns {Object} Dados de tarifa
     */
    const getRidePricing = useCallback((rideData) => {
        if (!pricingData || !rideData) {
            return {
                baseFare: rideData?.baseFare || 20,
                dynamicFactor: 1.0,
                finalFare: rideData?.baseFare || 20,
                indicator: DynamicPricingService.getDemandIndicator(1.0),
                isDynamic: false
            };
        }

        return {
            baseFare: rideData.baseFare || pricingData.baseFare,
            dynamicFactor: pricingData.dynamicFactor,
            finalFare: DynamicPricingService.calculateFinalFare(
                rideData.baseFare || pricingData.baseFare,
                pricingData.dynamicFactor
            ),
            indicator: pricingData.indicator,
            isDynamic: true,
            region: pricingData.region,
            timestamp: pricingData.timestamp
        };
    }, [pricingData]);

    // ==================== FUNÇÕES AUXILIARES ====================

    /**
     * Simula dados de corrida para teste
     * @param {number} baseFare - Tarifa base
     * @returns {Object} Dados simulados
     */
    const simulateRidePricing = useCallback((baseFare = 20) => {
        const mockRideData = {
            baseFare,
            distance: 5 + Math.random() * 10, // 5-15km
            duration: 15 + Math.random() * 30, // 15-45min
            surgeMultiplier: pricingData?.dynamicFactor || 1.0
        };

        return getRidePricing(mockRideData);
    }, [pricingData, getRidePricing]);

    /**
     * Obtém histórico de preços
     * @param {number} hours - Horas para trás
     * @returns {Array} Histórico filtrado
     */
    const getPricingHistory = useCallback((hours = 1) => {
        const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000);
        return pricingHistory.filter(entry => 
            new Date(entry.timestamp) >= cutoffTime
        );
    }, [pricingHistory]);

    /**
     * Calcula tendência de preços
     * @returns {Object} Análise de tendência
     */
    const getPricingTrend = useCallback(() => {
        if (pricingHistory.length < 2) {
            return { trend: 'stable', change: 0, description: 'Dados insuficientes' };
        }

        const recent = pricingHistory.slice(-5); // Últimos 5 registros
        const older = pricingHistory.slice(-10, -5); // 5 anteriores
        
        const recentAvg = recent.reduce((sum, entry) => sum + entry.dynamicFactor, 0) / recent.length;
        const olderAvg = older.reduce((sum, entry) => sum + entry.dynamicFactor, 0) / older.length;
        
        const change = ((recentAvg - olderAvg) / olderAvg) * 100;
        
        let trend = 'stable';
        let description = 'Preços estáveis';
        
        if (change > 5) {
            trend = 'increasing';
            description = `Preços subindo ${change.toFixed(1)}%`;
        } else if (change < -5) {
            trend = 'decreasing';
            description = `Preços caindo ${Math.abs(change).toFixed(1)}%`;
        }
        
        return { trend, change, description, recentAvg, olderAvg };
    }, [pricingHistory]);

    // ==================== EFFECTS ====================

    // Configurar listeners do serviço
    useEffect(() => {
        if (!isDriver || !isEnabled) return;

        const handlePricingUpdate = (data) => {
            Logger.log('🔄 useDynamicPricing - Recebida atualização de preços:', data);
            setLastUpdate(new Date());
            
            // Se temos dados atuais, recalcular
            if (currentRegion) {
                updatePricingForRegion(currentRegion);
            }
        };

        DynamicPricingService.addListener('pricingUpdated', handlePricingUpdate);

        return () => {
            DynamicPricingService.removeListener('pricingUpdated', handlePricingUpdate);
        };
    }, [isDriver, isEnabled, currentRegion, updatePricingForRegion]);

    // Limpeza ao desmontar
    useEffect(() => {
        return () => {
            if (updateTimeoutRef.current) {
                clearTimeout(updateTimeoutRef.current);
            }
        };
    }, []);

    // ==================== RETORNO DO HOOK ====================

    return {
        // Estados principais
        pricingData,
        demandIndicator,
        isLoading,
        lastUpdate,
        error,
        currentRegion,
        pricingHistory,
        
        // Funções principais
        calculateDynamicPricing,
        updatePricingForRegion,
        getRidePricing,
        
        // Funções auxiliares
        simulateRidePricing,
        getPricingHistory,
        getPricingTrend,
        
        // Utilitários
        isDriver,
        isEnabled: isDriver && isEnabled, // Só está habilitado se for motorista E a preferência estiver ativa
        service: DynamicPricingService
    };
};

export default useDynamicPricing;

