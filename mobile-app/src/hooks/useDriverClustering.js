import Logger from '../utils/Logger';
// useDriverClustering.js - Hook para clustering H3 específico de motoristas
import { useState, useEffect, useCallback, useRef } from 'react';
import H3ClusteringService from '../services/H3ClusteringService';
import { useSelector } from 'react-redux';


export const useDriverClustering = () => {
    const auth = useSelector(state => state.auth);
    const isDriver = auth.profile?.usertype === 'driver' || auth.profile?.userType === 'driver';
    
    // Estados do clustering
    const [nearbyDrivers, setNearbyDrivers] = useState([]);
    const [driverClusters, setDriverClusters] = useState([]);
    const [permanentHexagons, setPermanentHexagons] = useState([]); // Nova grade permanente
    const [expandedCluster, setExpandedCluster] = useState(null);
    const [clusterStats, setClusterStats] = useState(null);
    const [demandAnalysis, setDemandAnalysis] = useState(null);
    const [isClusteringEnabled, setIsClusteringEnabled] = useState(false);
    
    // Garantir que driverClusters sempre seja um array
    const safeDriverClusters = Array.isArray(driverClusters) ? driverClusters : [];
    const safePermanentHexagons = Array.isArray(permanentHexagons) ? permanentHexagons : [];
    
    // Estados de performance
    const [lastUpdateTime, setLastUpdateTime] = useState(null);
    const [clusteringPerformance, setClusteringPerformance] = useState({});
    
    // Refs para otimização
    const clusteringTimeoutRef = useRef(null);
    const lastRegionRef = useRef(null);

    // ==================== FUNÇÕES PRINCIPAIS ====================

    /**
     * Inicializa o clustering para motoristas
     */
    const initializeClustering = useCallback(() => {
        if (!isDriver) {
            Logger.log('⚠️ useDriverClustering - Usuário não é motorista, clustering desabilitado');
            return;
        }

        Logger.log('🚀 useDriverClustering - Inicializando clustering para motorista');
        setIsClusteringEnabled(true);
        
        // Carregar motoristas próximos inicialmente
        loadNearbyDrivers(-23.5505, -46.6333, 10); // São Paulo como padrão
    }, [isDriver]);

    /**
     * Carrega motoristas próximos e aplica clustering
     */
    const loadNearbyDrivers = useCallback(async (lat = null, lng = null, radius = 10) => {
        try {
            Logger.log('🔍 useDriverClustering - Carregando motoristas próximos...');
            
            // Simular dados de motoristas (em produção viria da API)
            const mockDrivers = generateMockDrivers(lat, lng, radius);
            setNearbyDrivers(mockDrivers);
            
            // Não usar mais H3 - apenas carregar motoristas
            setLastUpdateTime(new Date());
            
        } catch (error) {
            Logger.error('❌ useDriverClustering - Erro ao carregar motoristas:', error);
        }
    }, []);

           /**
            * Atualiza clustering baseado na região do mapa (com logs reduzidos)
            */
           const updateClusteringForRegion = useCallback((region) => {
               if (!region || !region.latitude || !region.longitude) return;
               
               // Sempre atualizar, independente do clustering estar habilitado
               const centerLat = region.latitude;
               const centerLng = region.longitude;
               
               // Calcular raio baseado no zoom
               const latDelta = region.latitudeDelta || 0.01;
               const lngDelta = region.longitudeDelta || 0.01;
               const radius = Math.max(latDelta, lngDelta) * 111; // Converter para km
               
               // Carregar motoristas e atualizar hexágonos
               loadNearbyDrivers(centerLat, centerLng, radius);
           }, [loadNearbyDrivers]);

    /**
     * Expande um cluster para mostrar detalhes
     */
    const expandCluster = useCallback((cluster) => {
        Logger.log('🔍 useDriverClustering - Expandindo cluster:', cluster.h3Index);
        setExpandedCluster(cluster);
        
        // Mostrar motoristas individuais do cluster
        const individualDrivers = H3ClusteringService.expandCluster(cluster);
        Logger.log('👥 Motoristas no cluster:', individualDrivers.length);
        
        return individualDrivers;
    }, []);

    /**
     * Colapsa o cluster expandido
     */
    const collapseCluster = useCallback(() => {
        setExpandedCluster(null);
    }, []);

    /**
     * Filtra clusters por critérios específicos
     */
    const filterClusters = useCallback((filters) => {
        const filteredClusters = H3ClusteringService.filterClusters(driverClusters, filters);
        Logger.log('🔍 useDriverClustering - Clusters filtrados:', {
            original: driverClusters.length,
            filtered: filteredClusters.length,
            filters
        });
        return filteredClusters;
    }, [driverClusters]);

    /**
     * Busca clusters próximos a uma coordenada
     */
    const findNearbyClusters = useCallback((lat, lng, radiusKm = 5) => {
        const nearbyClusters = H3ClusteringService.findNearbyClusters(driverClusters, lat, lng, radiusKm);
        Logger.log('📍 useDriverClustering - Clusters próximos encontrados:', nearbyClusters.length);
        return nearbyClusters;
    }, [driverClusters]);

    // ==================== FUNÇÕES AUXILIARES ====================

    /**
     * Gera dados mock de motoristas para teste
     */
    const generateMockDrivers = (centerLat, centerLng, radius) => {
        const drivers = [];
        
        // SIMULAÇÃO CENTRALIZADA NA LOCALIZAÇÃO DO USUÁRIO
        const baseLat = centerLat || -23.5505; // Usar localização atual do usuário
        const baseLng = centerLng || -46.6333;
        
        Logger.log(`📍 Gerando clusters centralizados em: ${baseLat.toFixed(6)}, ${baseLng.toFixed(6)}`);
        
        // Criar 4 zonas de demanda variada ao redor da localização atual
        const demandZones = [
            { lat: baseLat, lng: baseLng, count: 20, multiplier: 2.5 }, // Centro - Alta demanda
            { lat: baseLat + 0.005, lng: baseLng + 0.005, count: 15, multiplier: 2.0 }, // NE - Média-Alta
            { lat: baseLat - 0.005, lng: baseLng - 0.005, count: 12, multiplier: 1.8 }, // SW - Média
            { lat: baseLat + 0.003, lng: baseLng - 0.003, count: 8, multiplier: 1.3 }, // SE - Baixa-Média
        ];
        
        let driverId = 0;
        
        demandZones.forEach((zone, zoneIndex) => {
            for (let i = 0; i < zone.count; i++) {
                try {
                    // Gerar coordenadas dentro de 1km² (raio ~0.5km)
                    const angle = Math.random() * 2 * Math.PI;
                    const distance = Math.random() * 0.005; // ~500m de raio para 1km²
                    
                    const lat = zone.lat + (distance * Math.cos(angle) / 111);
                    const lng = zone.lng + (distance * Math.sin(angle) / (111 * Math.cos(lat * Math.PI / 180)));
                    
                    // Validar coordenadas
                    if (isNaN(lat) || isNaN(lng) || lat === undefined || lng === undefined) {
                        Logger.warn(`⚠️ Coordenadas inválidas para motorista ${driverId}:`, { lat, lng });
                        continue;
                    }
                    
                    drivers.push({
                        id: `driver_${driverId}`,
                        lat: Number(lat.toFixed(6)),
                        lng: Number(lng.toFixed(6)),
                        name: `Motorista ${driverId + 1}`,
                        rating: Number((4.2 + Math.random() * 0.8).toFixed(1)), // 4.2-5.0
                        estimatedEarnings: Math.floor(Math.random() * 150) + 100, // R$ 100-250
                        distance: Number((Math.random() * 2).toFixed(2)), // 0-2km
                        status: Math.random() > 0.15 ? 'available' : 'busy', // 85% disponível
                        vehicle: {
                            model: ['Honda Civic', 'Toyota Corolla', 'Volkswagen Gol'][Math.floor(Math.random() * 3)],
                            plate: `ABC${Math.floor(Math.random() * 9000) + 1000}`
                        },
                        zone: `Zona ${zoneIndex + 1}`,
                        demandMultiplier: zone.multiplier // Adicionar multiplicador de demanda
                    });
                    
                    driverId++;
                } catch (error) {
                    Logger.error(`❌ Erro ao gerar motorista ${driverId}:`, error);
                    continue;
                }
            }
        });
        
        // Adicionar alguns motoristas espalhados (baixa densidade)
        for (let i = 0; i < 8; i++) {
            try {
                const angle = Math.random() * 2 * Math.PI;
                const distance = Math.random() * radius;
                
                const lat = baseLat + (distance * Math.cos(angle) / 111);
                const lng = baseLng + (distance * Math.sin(angle) / (111 * Math.cos(lat * Math.PI / 180)));
                
                if (isNaN(lat) || isNaN(lng)) continue;
                
                drivers.push({
                    id: `driver_${driverId}`,
                    lat: Number(lat.toFixed(6)),
                    lng: Number(lng.toFixed(6)),
                    name: `Motorista ${driverId + 1}`,
                    rating: Number((4.0 + Math.random() * 1.0).toFixed(1)),
                    estimatedEarnings: Math.floor(Math.random() * 100) + 50,
                    distance: Number((Math.random() * 5).toFixed(2)),
                    status: Math.random() > 0.3 ? 'available' : 'busy',
                    vehicle: {
                        model: ['Honda Civic', 'Toyota Corolla', 'Volkswagen Gol'][Math.floor(Math.random() * 3)],
                        plate: `ABC${Math.floor(Math.random() * 9000) + 1000}`
                    },
                    zone: 'Espalhado'
                });
                
                driverId++;
            } catch (error) {
                Logger.error(`❌ Erro ao gerar motorista espalhado ${driverId}:`, error);
                continue;
            }
        }
        
               return drivers;
    };

    /**
     * Obtém recomendações estratégicas para o motorista
     */
    const getStrategicRecommendations = useCallback(() => {
        if (!demandAnalysis) return [];
        
        const recommendations = [];
        
        // Recomendação baseada em densidade
        if (demandAnalysis.highDemandAreas > demandAnalysis.mediumDemandAreas + demandAnalysis.lowDemandAreas) {
            recommendations.push({
                type: 'density',
                priority: 'high',
                title: 'Área Saturada',
                message: 'Muitos motoristas na região. Considere áreas menos concorridas.',
                action: 'Mover para área de menor densidade'
            });
        }
        
        // Recomendação baseada em ganhos
        const avgEarnings = clusterStats?.averageClusterSize * 100 || 0;
        if (avgEarnings > 150) {
            recommendations.push({
                type: 'earnings',
                priority: 'medium',
                title: 'Alto Potencial',
                message: 'Região com bom potencial de ganhos.',
                action: 'Manter posição atual'
            });
        }
        
        return recommendations;
    }, [demandAnalysis, clusterStats]);

    // ==================== EFFECTS ====================

    // Inicializar clustering quando o componente monta
    useEffect(() => {
        initializeClustering();
        
        return () => {
            if (clusteringTimeoutRef.current) {
                clearTimeout(clusteringTimeoutRef.current);
            }
        };
    }, [initializeClustering]);

    // Atualizar clustering quando motoristas mudam
    useEffect(() => {
        if (nearbyDrivers.length > 0 && isClusteringEnabled) {
            const clusters = H3ClusteringService.clusterDrivers(nearbyDrivers, 8);
            setDriverClusters(clusters);
        }
    }, [nearbyDrivers, isClusteringEnabled]);

    // ==================== RETORNO DO HOOK ====================

    return {
        // Estados principais
        nearbyDrivers,
        driverClusters: safeDriverClusters,
        permanentHexagons: safePermanentHexagons, // Nova grade permanente
        expandedCluster,
        clusterStats,
        demandAnalysis,
        isClusteringEnabled,
        
        // Estados de performance
        lastUpdateTime,
        clusteringPerformance,
        
        // Funções principais
        initializeClustering,
        loadNearbyDrivers,
        updateClusteringForRegion,
        expandCluster,
        collapseCluster,
        filterClusters,
        findNearbyClusters,
        
        // Funções auxiliares
        getStrategicRecommendations,
        
        // Utilitários
        isDriver,
        clusteringService: H3ClusteringService
    };
};

export default useDriverClustering;

