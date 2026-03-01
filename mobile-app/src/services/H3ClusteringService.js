import Logger from '../utils/Logger';
// H3ClusteringService.js - Serviço de clustering H3 compatível com Hermes
// Versão com polyfills específicos para resolver problemas de encoding

// Polyfills para Hermes
if (typeof global.TextDecoder === 'undefined') {
    global.TextDecoder = class TextDecoder {
        constructor(encoding = 'utf-8') {
            this.encoding = encoding;
        }
        decode(input) {
            if (typeof input === 'string') return input;
            if (input instanceof ArrayBuffer) {
                const view = new Uint8Array(input);
                return String.fromCharCode.apply(null, view);
            }
            return '';
        }
    };
}

if (typeof global.TextEncoder === 'undefined') {
    global.TextEncoder = class TextEncoder {
        constructor() {}
        encode(input) {
            const buffer = new ArrayBuffer(input.length);
            const view = new Uint8Array(buffer);
            for (let i = 0; i < input.length; i++) {
                view[i] = input.charCodeAt(i);
            }
            return buffer;
        }
    };
}

// H3 COMPLETAMENTE DESABILITADO - SEM IMPORTAÇÃO
let h3 = null;
let h3Available = false;

class H3ClusteringService {
    constructor() {
        this.clusters = new Map();
        this.resolutionLevels = {
            'high': 9,    // ~0.1km²
            'medium': 8,  // ~0.7km²
            'low': 7      // ~5.2km²
        };
    }

    /**
     * Verifica se H3 está disponível
     * @returns {boolean} True se H3 está funcionando
     */
    isH3Available() {
        return h3Available && h3 && typeof h3.latLngToCell === 'function';
    }

    /**
     * Cria grade permanente de hexágonos H3
     * @param {number} centerLat - Latitude central
     * @param {number} centerLng - Longitude central
     * @param {number} radiusKm - Raio em km para gerar hexágonos
     * @param {number} resolution - Resolução H3 para 1km² (padrão: 9)
     * @returns {Array} Hexágonos H3 permanentes
     */
    createPermanentHexagonGrid(centerLat, centerLng, radiusKm = 5, resolution = 9) {
        try {
            if (!this.isH3Available()) {
                Logger.log('⚠️ H3 não disponível, usando grade simples');
                return this.createSimpleGrid(centerLat, centerLng, radiusKm);
            }

            const hexagons = [];
            
            // Obter o hexágono central
            const centerHex = h3.latLngToCell(centerLat, centerLng, resolution);
            const centerCoords = h3.cellToLatLng(centerHex);
            
            // Obter hexágonos vizinhos em camadas concêntricas
            let currentRing = [centerHex];
            const processedHexes = new Set([centerHex]);
            
            // Calcular quantas camadas precisamos baseado no raio
            const hexArea = this.getH3CellArea(resolution);
            const maxLayers = Math.ceil(radiusKm / Math.sqrt(hexArea));
            
            // Processar camadas de hexágonos
            for (let layer = 0; layer < maxLayers; layer++) {
                const nextRing = [];
                
                for (const hex of currentRing) {
                    try {
                        // Obter vizinhos do hexágono atual
                        const neighbors = h3.gridDisk(hex, 1);
                        
                        for (const neighbor of neighbors) {
                            if (!processedHexes.has(neighbor)) {
                                processedHexes.add(neighbor);
                                nextRing.push(neighbor);
                                
                                // Obter coordenadas do centro do hexágono
                                const coords = h3.cellToLatLng(neighbor);
                                
                                // Calcular distância do centro para filtrar por raio
                                const distance = this.calculateDistance(centerLat, centerLng, coords[0], coords[1]);
                                
                                if (distance <= radiusKm) {
                                    hexagons.push({
                                        h3Index: neighbor,
                                        center: {
                                            latitude: coords[0],
                                            longitude: coords[1]
                                        },
                                        resolution,
                                        area: hexArea,
                                        distance: distance,
                                        metrics: {
                                            demandLevel: 'low',
                                            demandMultiplier: 1.0,
                                            density: 0,
                                            driverCount: 0,
                                            averageRating: 0,
                                            totalEarnings: 0
                                        }
                                    });
                                }
                            }
                        }
                    } catch (error) {
                        // Continuar mesmo se um hexágono falhar
                        continue;
                    }
                }
                
                currentRing = nextRing;
                if (currentRing.length === 0) break;
            }
            
            Logger.log(`✅ Grade H3 criada: ${hexagons.length} hexágonos`);
            return hexagons;
            
        } catch (error) {
            Logger.error('❌ Erro ao criar grade permanente:', error);
            return this.createSimpleGrid(centerLat, centerLng, radiusKm);
        }
    }

    /**
     * Atualiza demanda dos hexágonos baseado nos motoristas
     * @param {Array} hexagons - Hexágonos permanentes
     * @param {Array} drivers - Lista de motoristas
     * @returns {Array} Hexágonos com demanda atualizada
     */
    updateHexagonDemand(hexagons, drivers) {
        // Resetar contadores
        hexagons.forEach(hex => {
            hex.metrics.driverCount = 0;
            hex.metrics.density = 0;
            hex.metrics.demandMultiplier = 1.0;
            hex.metrics.demandLevel = 'low';
        });

        // Contar motoristas por hexágono
        drivers.forEach(driver => {
            if (!driver || typeof driver.lat !== 'number' || typeof driver.lng !== 'number') {
                return;
            }

            try {
                if (this.isH3Available() && hexagons.length > 0) {
                    const driverHex = h3.latLngToCell(driver.lat, driver.lng, hexagons[0].resolution);
                    
                    // Encontrar o hexágono correspondente
                    const hexagon = hexagons.find(h => h.h3Index === driverHex);
                    if (hexagon) {
                        hexagon.metrics.driverCount++;
                    }
                } else {
                    // Fallback: encontrar hexágono mais próximo
                    let closestHex = null;
                    let minDistance = Infinity;
                    
                    hexagons.forEach(hex => {
                        const distance = this.calculateDistance(
                            driver.lat, driver.lng,
                            hex.center.latitude, hex.center.longitude
                        );
                        
                        if (distance < minDistance) {
                            minDistance = distance;
                            closestHex = hex;
                        }
                    });
                    
                    if (closestHex && minDistance < 1.0) {
                        closestHex.metrics.driverCount++;
                    }
                }
            } catch (error) {
                // Silenciar erros de processamento individual
            }
        });

        // Calcular demanda para cada hexágono
        hexagons.forEach(hexagon => {
            const density = hexagon.metrics.driverCount / hexagon.area;
            
            const baseMultiplier = 1.0;
            const densityFactor = 0.1;
            const demandMultiplier = baseMultiplier + (density * densityFactor);
            
            if (demandMultiplier >= 2.0) {
                hexagon.metrics.demandLevel = 'high';
            } else if (demandMultiplier >= 1.5) {
                hexagon.metrics.demandLevel = 'medium';
            } else {
                hexagon.metrics.demandLevel = 'low';
            }
            
            hexagon.metrics.density = density;
            hexagon.metrics.demandMultiplier = demandMultiplier;
        });

        return hexagons;
    }

    /**
     * Agrupa motoristas em clusters H3
     * @param {Array} drivers - Lista de motoristas
     * @param {number} resolution - Resolução H3 (padrão: 8)
     * @returns {Array} Clusters de motoristas
     */
    clusterDrivers(drivers, resolution = 8) {
        try {
            if (!this.isH3Available()) {
                return this.simpleClustering(drivers);
            }
            
            const clusters = new Map();
            
            drivers.forEach(driver => {
                try {
                    if (!driver || typeof driver.lat !== 'number' || typeof driver.lng !== 'number') {
                        return;
                    }
                    
                    const h3Index = h3.latLngToCell(driver.lat, driver.lng, resolution);
                    
                    if (!clusters.has(h3Index)) {
                        const center = h3.cellToLatLng(h3Index);
                        clusters.set(h3Index, {
                            h3Index,
                            center: {
                                latitude: center[0],
                                longitude: center[1]
                            },
                            drivers: [],
                            count: 0,
                            resolution,
                            metrics: {
                                averageRating: 0,
                                totalEarnings: 0,
                                averageDistance: 0,
                                demandLevel: 'medium'
                            }
                        });
                    }
                    
                    const cluster = clusters.get(h3Index);
                    cluster.drivers.push(driver);
                    cluster.count++;
                    
                    this.updateClusterMetrics(cluster);
                    
                } catch (error) {
                    // Silenciar erros de processamento individual
                }
            });

            return Array.from(clusters.values());

        } catch (error) {
            Logger.error('❌ H3ClusteringService - Erro no clustering:', error);
            return this.simpleClustering(drivers);
        }
    }

    /**
     * Clustering simples baseado em distância
     * @param {Array} drivers - Lista de motoristas
     * @returns {Array} Clusters simples
     */
    simpleClustering(drivers) {
        const clusters = [];
        const clusterDistance = 0.01; // ~1km
        
        drivers.forEach(driver => {
            if (!driver || typeof driver.lat !== 'number' || typeof driver.lng !== 'number') {
                return;
            }
            
            let foundCluster = null;
            for (const cluster of clusters) {
                const distance = Math.sqrt(
                    Math.pow(driver.lat - cluster.center.latitude, 2) + 
                    Math.pow(driver.lng - cluster.center.longitude, 2)
                );
                
                if (distance < clusterDistance) {
                    foundCluster = cluster;
                    break;
                }
            }
            
            if (foundCluster) {
                foundCluster.drivers.push(driver);
                foundCluster.count++;
                
                const totalLat = foundCluster.drivers.reduce((sum, d) => sum + d.lat, 0);
                const totalLng = foundCluster.drivers.reduce((sum, d) => sum + d.lng, 0);
                foundCluster.center.latitude = totalLat / foundCluster.count;
                foundCluster.center.longitude = totalLng / foundCluster.count;
            } else {
                clusters.push({
                    h3Index: `simple_${clusters.length}`,
                    center: {
                        latitude: driver.lat,
                        longitude: driver.lng
                    },
                    drivers: [driver],
                    count: 1,
                    resolution: 'simple',
                    metrics: {
                        averageRating: driver.rating || 0,
                        totalEarnings: driver.earnings || 0,
                        averageDistance: 0,
                        demandLevel: 'medium'
                    }
                });
            }
        });
        
        return clusters;
    }

    /**
     * Cria grade simples quando H3 não está disponível
     * @param {number} centerLat - Latitude central
     * @param {number} centerLng - Longitude central
     * @param {number} radiusKm - Raio em km
     * @returns {Array} Grade simples
     */
    createSimpleGrid(centerLat, centerLng, radiusKm) {
        const hexagons = [];
        const hexRadius = 0.2; // Raio menor para evitar sobreposição
        const hexSpacing = hexRadius * 2; // Distância entre centros = diâmetro (sem sobreposição)
        
        // Calcular quantas camadas precisamos
        const maxLayers = Math.ceil(radiusKm / hexSpacing) + 1;
        
        // Criar grade hexagonal simples sem sobreposição
        for (let q = -maxLayers; q <= maxLayers; q++) {
            const r1 = Math.max(-maxLayers, -q - maxLayers);
            const r2 = Math.min(maxLayers, -q + maxLayers);
            
            for (let r = r1; r <= r2; r++) {
                // Converter coordenadas hexagonais para cartesianas
                const x = hexSpacing * (3/2 * q);
                const y = hexSpacing * (Math.sqrt(3)/2 * q + Math.sqrt(3) * r);
                
                // Converter para coordenadas geográficas
                const lat = centerLat + (x / 111);
                const lng = centerLng + (y / (111 * Math.cos(lat * Math.PI / 180)));
                
                // Verificar se está dentro do raio
                const distance = this.calculateDistance(centerLat, centerLng, lat, lng);
                if (distance <= radiusKm) {
                    hexagons.push({
                        h3Index: `hex_${q}_${r}`,
                        center: { latitude: lat, longitude: lng },
                        resolution: 'simple',
                        area: (3 * Math.sqrt(3) / 2) * hexRadius * hexRadius,
                        distance: distance,
                        hexRadius: hexRadius,
                        metrics: {
                            demandLevel: 'low',
                            demandMultiplier: 1.0,
                            density: 0,
                            driverCount: 0,
                            averageRating: 0,
                            totalEarnings: 0
                        }
                    });
                }
            }
        }
        
        return hexagons;
    }

    /**
     * Atualiza métricas de um cluster
     * @param {Object} cluster - Cluster a ser atualizado
     */
    updateClusterMetrics(cluster) {
        if (cluster.drivers.length === 0) return;
        
        const totalRating = cluster.drivers.reduce((sum, driver) => sum + (driver.rating || 0), 0);
        const totalEarnings = cluster.drivers.reduce((sum, driver) => sum + (driver.earnings || 0), 0);
        
        cluster.metrics.averageRating = totalRating / cluster.drivers.length;
        cluster.metrics.totalEarnings = totalEarnings;
        
        const totalDistance = cluster.drivers.reduce((sum, driver) => {
            const distance = this.calculateDistance(
                driver.lat, driver.lng,
                cluster.center.latitude, cluster.center.longitude
            );
            return sum + distance;
        }, 0);
        
        cluster.metrics.averageDistance = totalDistance / cluster.drivers.length;
        
        if (cluster.count >= 5) {
            cluster.metrics.demandLevel = 'high';
        } else if (cluster.count >= 3) {
            cluster.metrics.demandLevel = 'medium';
        } else {
            cluster.metrics.demandLevel = 'low';
        }
    }

    /**
     * Calcula área de uma célula H3
     * @param {number} resolution - Resolução H3
     * @returns {number} Área em km²
     */
    getH3CellArea(resolution) {
        try {
            if (this.isH3Available()) {
                return h3.getHexagonAreaAvgKm2(resolution);
            }
        } catch (error) {
            // Fallback para valores conhecidos
        }
        
        const areas = {
            7: 5.2,
            8: 0.7,
            9: 0.1
        };
        return areas[resolution] || 1.0;
    }

    /**
     * Calcula distância entre duas coordenadas (Haversine)
     * @param {number} lat1 - Latitude 1
     * @param {number} lng1 - Longitude 1
     * @param {number} lat2 - Latitude 2
     * @param {number} lng2 - Longitude 2
     * @returns {number} Distância em km
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
}

const h3ClusteringService = new H3ClusteringService();
export default h3ClusteringService;