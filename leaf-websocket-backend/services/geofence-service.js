/**
 * GEOFENCE SERVICE
 * 
 * Serviço para validar se corridas estão dentro de região permitida
 * Implementa validação de polígono geográfico para limitar operação
 */

const { logger } = require('../utils/logger');
const fs = require('fs');
const path = require('path');

function coordinatesEqual(a, b) {
    return (
        Array.isArray(a) &&
        Array.isArray(b) &&
        Number(a[0]) === Number(b[0]) &&
        Number(a[1]) === Number(b[1])
    );
}

function normalizeRegionCoordinates(region) {
    if (!Array.isArray(region) || region.length < 3) {
        return null;
    }

    const normalized = [];

    for (const point of region) {
        let lng = null;
        let lat = null;

        if (Array.isArray(point) && point.length >= 2) {
            lng = Number(point[0]);
            lat = Number(point[1]);
        } else if (point && typeof point === 'object') {
            lng = Number(point.lng);
            lat = Number(point.lat);
        } else {
            return null;
        }

        if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
            return null;
        }

        normalized.push([lng, lat]);
    }

    if (normalized.length < 3) {
        return null;
    }

    const first = normalized[0];
    const last = normalized[normalized.length - 1];
    if (!coordinatesEqual(first, last)) {
        normalized.push([first[0], first[1]]);
    }

    return normalized.length >= 4 ? normalized : null;
}

const isGeofenceBypassEnabled = () => {
    return (
        String(process.env.BYPASS_GEOFENCE || '').toLowerCase() === 'true' ||
        String(process.env.GEOFENCE_RADIUS_KM || '') === '9999' ||
        String(process.env.APP_REVIEW || '').toLowerCase() === 'true'
    );
};

class GeofenceService {
    constructor() {
        // Região padrão vem do arquivo oficial do projeto (config/geofence.json).
        // Sem configuração explícita, geofence fica inativo para evitar bloqueios surpresa.
        this.defaultRegion = this.getDefaultRegion();

        this.runtimeEnabled = true;
        this.regionSource = 'none';

        // ✅ Carregar região do ambiente ou usar padrão
        const envRegion = this.loadRegionFromEnv();
        this.allowedRegion = envRegion || this.defaultRegion;
        this.regionSource = envRegion ? 'env' : (this.defaultRegion ? 'default' : 'none');

        logger.info('✅ GeofenceService inicializado', {
            regionPoints: Array.isArray(this.allowedRegion) ? this.allowedRegion.length : 0,
            regionSource: this.regionSource,
            runtimeEnabled: this.runtimeEnabled,
            bypassEnabled: isGeofenceBypassEnabled()
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
                const normalized = normalizeRegionCoordinates(coords);
                if (normalized) {
                    return normalized;
                }
            }
        } catch (error) {
            logger.warn('⚠️ Falha ao carregar config/geofence.json no GeofenceService, mantendo geofence inativo', {
                error: error.message
            });
        }

        return null;
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
            const normalized = normalizeRegionCoordinates(region);

            if (normalized) {
                return normalized;
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
        if (isGeofenceBypassEnabled()) {
            return {
                valid: true,
                details: {
                    bypass: true,
                    reason: 'BYPASS_GEOFENCE habilitado'
                }
            };
        }

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
        if (!Array.isArray(this.allowedRegion)) {
            return null;
        }
        return this.allowedRegion.map(([lng, lat]) => [lng, lat]);
    }

    /**
     * Atualizar região permitida (para uso administrativo)
     * @param {Array<Array<number>>} newRegion - Nova região [lng, lat]
     * @returns {boolean} true se atualizado com sucesso
     */
    updateRegion(newRegion) {
        const normalized = normalizeRegionCoordinates(newRegion);
        if (!normalized) {
            logger.error('❌ Região inválida para atualização');
            return false;
        }

        this.allowedRegion = normalized;
        this.regionSource = 'runtime';
        logger.info('✅ Região de geofence atualizada', {
            points: normalized.length
        });

        return true;
    }

    /**
     * Ativar/desativar geofence em runtime sem reiniciar backend
     * @param {boolean} enabled
     * @returns {boolean}
     */
    setEnabled(enabled) {
        if (typeof enabled !== 'boolean') {
            logger.error('❌ Flag enabled inválida para geofence');
            return false;
        }
        this.runtimeEnabled = enabled;
        logger.info('✅ Geofence runtime atualizado', { enabled });
        return true;
    }

    /**
     * Flag administrativa de geofence (independente do bypass)
     * @returns {boolean}
     */
    isEnabled() {
        return this.runtimeEnabled !== false;
    }

    /**
     * Retorna se bypass global está ativo
     * @returns {boolean}
     */
    isBypassEnabled() {
        return isGeofenceBypassEnabled();
    }

    /**
     * Verificar se geofence está ativo
     * @returns {boolean} true se geofence está ativo
     */
    isActive() {
        if (isGeofenceBypassEnabled()) {
            return false;
        }
        if (!this.isEnabled()) {
            return false;
        }
        // Geofence está ativo se há região definida
        return !!(this.allowedRegion && this.allowedRegion.length >= 4);
    }
}

// Exportar instância singleton
const geofenceService = new GeofenceService();
module.exports = geofenceService;
