/**
 * GEOFENCE SERVICE
 * 
 * Serviço para validar se corridas estão dentro de região permitida
 * Implementa validação de polígono geográfico para limitar operação
 */

const { logger } = require('../utils/logger');
const fs = require('fs');
const path = require('path');

class GeofenceService {
    constructor() {
        // ✅ Região padrão: São Paulo (pode ser configurada via env)
        // Formato: Array de coordenadas [lng, lat] formando polígono
        this.defaultRegion = this.getDefaultRegion();
        
        // ✅ Carregar região do ambiente ou usar padrão
        this.allowedRegion = this.loadRegionFromEnv() || this.defaultRegion;
        
        logger.info('✅ GeofenceService inicializado', {
            regionPoints: this.allowedRegion.length,
            region: process.env.GEOFENCE_REGION || 'default'
        });
    }

    /**
     * Obter região padrão (São Paulo - área metropolitana)
     * @returns {Array<Array<number>>} Array de coordenadas [lng, lat]
     */
    getDefaultRegion() {
        // Priorizar polígono oficial do projeto para manter consistência
        // com outras validações (ex.: RequestRideCommand -> utils/geofence.js).
        try {
            const filePath = path.join(__dirname, '..', 'config', 'geofence.json');
            if (fs.existsSync(filePath)) {
                const geojson = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                const coords = geojson?.features?.[0]?.geometry?.coordinates?.[0];
                if (Array.isArray(coords) && coords.length >= 4) {
                    return coords;
                }
            }
        } catch (error) {
            logger.warn('⚠️ Falha ao carregar config/geofence.json no GeofenceService, usando fallback SP', {
                error: error.message
            });
        }

        // Região de São Paulo (área metropolitana aproximada)
        // Formato: [longitude, latitude] - GeoJSON format
        return [
            [-47.2, -23.8],  // Oeste
            [-46.3, -23.8],  // Leste (inferior)
            [-46.3, -23.4],  // Leste (superior)
            [-47.2, -23.4],  // Oeste (superior)
            [-47.2, -23.8]   // Fechar polígono
        ];
    }

    /**
     * Carregar região do ambiente
     * @returns {Array<Array<number>>|null} Região configurada ou null
     */
    loadRegionFromEnv() {
        if (!process.env.GEOFENCE_REGION) {
            return null;
        }

        try {
            // Formato esperado: JSON array de coordenadas
            // Exemplo: GEOFENCE_REGION='[[-47.2,-23.8],[-46.3,-23.8],[-46.3,-23.4],[-47.2,-23.4],[-47.2,-23.8]]'
            const region = JSON.parse(process.env.GEOFENCE_REGION);
            
            if (Array.isArray(region) && region.length >= 3) {
                return region;
            }
            
            logger.warn('⚠️ GEOFENCE_REGION inválido, usando região padrão');
            return null;
        } catch (error) {
            logger.error('❌ Erro ao carregar GEOFENCE_REGION:', error);
            return null;
        }
    }

    /**
     * Verificar se ponto está dentro do polígono (Ray Casting Algorithm)
     * @param {number} lat - Latitude do ponto
     * @param {number} lng - Longitude do ponto
     * @param {Array<Array<number>>} polygon - Polígono de coordenadas [lng, lat]
     * @returns {boolean} true se ponto está dentro do polígono
     */
    isPointInPolygon(lat, lng, polygon = null) {
        const region = polygon || this.allowedRegion;
        
        if (!region || region.length < 3) {
            logger.warn('⚠️ Região inválida, permitindo ponto');
            return true; // Se não há região definida, permitir
        }

        let inside = false;
        const x = lng;
        const y = lat;

        for (let i = 0, j = region.length - 1; i < region.length; j = i++) {
            const xi = region[i][0]; // longitude
            const yi = region[i][1]; // latitude
            const xj = region[j][0]; // longitude
            const yj = region[j][1]; // latitude

            const intersect = ((yi > y) !== (yj > y)) && 
                            (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
            
            if (intersect) {
                inside = !inside;
            }
        }

        return inside;
    }

    /**
     * Validar se origem e destino estão dentro da região permitida
     * @param {Object} pickupLocation - { lat, lng }
     * @param {Object} destinationLocation - { lat, lng }
     * @returns {{valid: boolean, error?: string, details?: Object}}
     */
    validateRideLocations(pickupLocation, destinationLocation) {
        if (!pickupLocation || !pickupLocation.lat || !pickupLocation.lng) {
            return {
                valid: false,
                error: 'Localização de origem inválida',
                code: 'INVALID_PICKUP'
            };
        }

        if (!destinationLocation || !destinationLocation.lat || !destinationLocation.lng) {
            return {
                valid: false,
                error: 'Localização de destino inválida',
                code: 'INVALID_DESTINATION'
            };
        }

        // Verificar se origem está dentro da região
        const pickupInside = this.isPointInPolygon(
            pickupLocation.lat,
            pickupLocation.lng
        );

        // Verificar se destino está dentro da região
        const destinationInside = this.isPointInPolygon(
            destinationLocation.lat,
            destinationLocation.lng
        );

        if (!pickupInside) {
            return {
                valid: false,
                error: 'Origem fora da região de operação permitida',
                code: 'PICKUP_OUTSIDE_REGION',
                details: {
                    pickup: { lat: pickupLocation.lat, lng: pickupLocation.lng },
                    inside: false
                }
            };
        }

        if (!destinationInside) {
            return {
                valid: false,
                error: 'Destino fora da região de operação permitida',
                code: 'DESTINATION_OUTSIDE_REGION',
                details: {
                    destination: { lat: destinationLocation.lat, lng: destinationLocation.lng },
                    inside: false
                }
            };
        }

        return {
            valid: true,
            details: {
                pickup: { inside: true },
                destination: { inside: true }
            }
        };
    }

    /**
     * Obter região atual configurada
     * @returns {Array<Array<number>>} Região atual
     */
    getCurrentRegion() {
        return this.allowedRegion;
    }

    /**
     * Atualizar região permitida (para uso administrativo)
     * @param {Array<Array<number>>} newRegion - Nova região [lng, lat]
     * @returns {boolean} true se atualizado com sucesso
     */
    updateRegion(newRegion) {
        if (!Array.isArray(newRegion) || newRegion.length < 3) {
            logger.error('❌ Região inválida para atualização');
            return false;
        }

        this.allowedRegion = newRegion;
        logger.info('✅ Região de geofence atualizada', {
            points: newRegion.length
        });
        
        return true;
    }

    /**
     * Verificar se geofence está ativo
     * @returns {boolean} true se geofence está ativo
     */
    isActive() {
        // Geofence está ativo se há região definida
        return this.allowedRegion && this.allowedRegion.length >= 3;
    }
}

// Exportar instância singleton
const geofenceService = new GeofenceService();
module.exports = geofenceService;
