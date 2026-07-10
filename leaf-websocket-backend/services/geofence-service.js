/**
 * GEOFENCE SERVICE
 * 
 * Serviço para validar se corridas estão dentro de região permitida
 * Implementa validação de polígono geográfico para limitar operação
 */

const { logger } = require('../utils/logger');
const fs = require('fs');
const path = require('path');
const { metrics } = require('../utils/prometheus-metrics');

const DEFAULT_RIO_DESTINATION_BOUNDS = Object.freeze({
    south: -23.0823,
    west: -43.7958,
    north: -22.7423,
    east: -43.0990
});

function coordinatesEqual(a, b) {
    return (
        Array.isArray(a) &&
        Array.isArray(b) &&
        Number(a[0]) === Number(b[0]) &&
        Number(a[1]) === Number(b[1])
    );
}

function normalizeRingCoordinates(region) {
    if (!Array.isArray(region) || region.length < 3) return null;

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

        if (
            !Number.isFinite(lng) ||
            !Number.isFinite(lat) ||
            lng < -180 ||
            lng > 180 ||
            lat < -90 ||
            lat > 90
        ) {
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

function extractRegionRings(region) {
    if (!region) return [];

    if (region.type === 'FeatureCollection') {
        return (region.features || []).flatMap((feature) => extractRegionRings(feature));
    }

    if (region.type === 'Feature') {
        return extractRegionRings(region.geometry);
    }

    if (region.type === 'Polygon') {
        const outerRing = normalizeRingCoordinates(region.coordinates?.[0]);
        return outerRing ? [outerRing] : [];
    }

    if (region.type === 'MultiPolygon') {
        return (region.coordinates || [])
            .map((polygon) => normalizeRingCoordinates(polygon?.[0]))
            .filter(Boolean);
    }

    if (!Array.isArray(region) || region.length === 0) return [];

    // Legacy/environment shape: [[lng, lat], ...]
    if (Array.isArray(region[0]) && Number.isFinite(Number(region[0][0]))) {
        const ring = normalizeRingCoordinates(region);
        return ring ? [ring] : [];
    }

    // Multi-region shape: [ringA, ringB, ...]
    return region
        .map((candidate) => normalizeRingCoordinates(candidate))
        .filter(Boolean);
}

function normalizeRegionCoordinates(region) {
    const rings = extractRegionRings(region);
    return rings.length > 0 ? rings : null;
}

function countRegionPoints(region) {
    return Array.isArray(region)
        ? region.reduce((total, ring) => total + (Array.isArray(ring) ? ring.length : 0), 0)
        : 0;
}

function isPointOnRingBoundary(x, y, ring) {
    const epsilon = 1e-10;
    for (let index = 0; index < ring.length - 1; index += 1) {
        const [x1, y1] = ring[index];
        const [x2, y2] = ring[index + 1];
        const cross = (x - x1) * (y2 - y1) - (y - y1) * (x2 - x1);
        if (Math.abs(cross) > epsilon) continue;

        const dot = (x - x1) * (x2 - x1) + (y - y1) * (y2 - y1);
        const lengthSquared = (x2 - x1) ** 2 + (y2 - y1) ** 2;
        if (dot >= -epsilon && dot <= lengthSquared + epsilon) return true;
    }
    return false;
}

const isGeofenceBypassEnabled = () => {
    const reviewMode = String(process.env.APP_REVIEW || '').trim().toLowerCase() === 'true';
    const reviewBypassEnabled = String(process.env.GEOFENCE_BYPASS_IN_REVIEW || '').trim().toLowerCase() === 'true';
    const bypassRequested = (
        String(process.env.BYPASS_GEOFENCE || '').toLowerCase() === 'true' ||
        String(process.env.GEOFENCE_RADIUS_KM || '') === '9999' ||
        (reviewMode && reviewBypassEnabled)
    );

    // A runtime production/pilot must never turn missing regional policy into
    // global availability. Review and test bypasses remain local/non-production.
    if (
        bypassRequested &&
        (
            String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production' ||
            isPilotControlledLaunch()
        )
    ) {
        return false;
    }

    return bypassRequested;
};

const isTruthy = (value) => String(value || '').trim().toLowerCase() === 'true';

const isPilotControlledLaunch = () => {
    const launchProfile = String(process.env.LEAF_LAUNCH_PROFILE || '').trim().toLowerCase();
    return (
        isTruthy(process.env.LEAF_PILOT_CONTROLLED) ||
        ['pilot', 'pilot_controlled', 'controlled_pilot', 'geofence_validation'].includes(launchProfile)
    );
};

const isFailClosedRequired = () => (
    String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production' ||
    isPilotControlledLaunch() ||
    isTruthy(process.env.GEOFENCE_FAIL_CLOSED)
);

const isDestinationRegionRequired = () => (
    isPilotControlledLaunch() ||
    isTruthy(process.env.GEOFENCE_REQUIRE_DESTINATION_INSIDE_REGION)
);

class GeofenceService {
    constructor() {
        // Região padrão vem do arquivo oficial do projeto (config/geofence.json).
        // Em produção/piloto, ausência de configuração é um bloqueio operacional recuperável.
        this.defaultRegion = this.getDefaultRegion();

        this.runtimeEnabled = true;
        this.regionSource = 'none';

        // ✅ Carregar região do ambiente ou usar padrão
        const envRegion = this.loadRegionFromEnv();
        this.allowedRegion = envRegion || this.defaultRegion;
        this.regionSource = envRegion ? 'env' : (this.defaultRegion ? 'default' : 'none');
        this.destinationBounds =
            this.loadDestinationBoundsFromEnv() || DEFAULT_RIO_DESTINATION_BOUNDS;

        logger.info('✅ GeofenceService inicializado', {
            regionPolygons: Array.isArray(this.allowedRegion) ? this.allowedRegion.length : 0,
            regionPoints: countRegionPoints(this.allowedRegion),
            regionSource: this.regionSource,
            destinationBounds: this.destinationBounds,
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
            const configuredPath = String(process.env.GEOFENCE_REGION_FILE || '').trim();
            const filePath = configuredPath
                ? path.resolve(__dirname, '..', configuredPath)
                : path.join(__dirname, '..', 'config', 'geofence.json');
            if (fs.existsSync(filePath)) {
                const geojson = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                const normalized = normalizeRegionCoordinates(geojson);
                if (normalized) {
                    const properties = geojson?.features?.[0]?.properties || geojson?.properties || {};
                    const metadata = geojson?.metadata || {};
                    this.regionMetadata = {
                        version: metadata.policyId || properties.version || properties.policyId || null,
                        updatedAt: metadata.generatedAt || properties.generatedAt || properties.updatedAt || null,
                        name: metadata.name || properties.name || null
                    };
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
            // Aceita um ring legado, uma lista de rings ou GeoJSON Polygon/MultiPolygon.
            const region = JSON.parse(process.env.GEOFENCE_REGION);
            const normalized = normalizeRegionCoordinates(region);

            if (normalized) {
                this.regionMetadata = {
                    version: String(process.env.GEOFENCE_REGION_VERSION || '').trim() || null,
                    updatedAt: String(process.env.GEOFENCE_REGION_UPDATED_AT || '').trim() || null,
                    name: String(process.env.GEOFENCE_REGION_NAME || '').trim() || null
                };
                return normalized;
            }

            logger.warn('⚠️ GEOFENCE_REGION inválido, usando região padrão');
            return null;
        } catch (error) {
            logger.error('❌ Erro ao carregar GEOFENCE_REGION:', error);
            return null;
        }
    }

    loadDestinationBoundsFromEnv() {
        const raw =
            process.env.GEOFENCE_DESTINATION_BOUNDS ||
            process.env.RIDE_DESTINATION_BOUNDS ||
            '';
        if (!raw) return null;

        try {
            const parsed = JSON.parse(raw);
            const bounds = Array.isArray(parsed)
                ? {
                    south: Number(parsed[0]),
                    west: Number(parsed[1]),
                    north: Number(parsed[2]),
                    east: Number(parsed[3])
                }
                : {
                    south: Number(parsed.south),
                    west: Number(parsed.west),
                    north: Number(parsed.north),
                    east: Number(parsed.east)
                };

            if (
                Number.isFinite(bounds.south) &&
                Number.isFinite(bounds.west) &&
                Number.isFinite(bounds.north) &&
                Number.isFinite(bounds.east) &&
                bounds.south < bounds.north &&
                bounds.west < bounds.east
            ) {
                return bounds;
            }

            logger.warn('⚠️ GEOFENCE_DESTINATION_BOUNDS inválido, usando área padrão do Rio');
            return null;
        } catch (error) {
            logger.warn('⚠️ Erro ao carregar GEOFENCE_DESTINATION_BOUNDS, usando área padrão do Rio', {
                error: error.message
            });
            return null;
        }
    }

    /**
     * Verificar se ponto está dentro do polígono (Ray Casting Algorithm)
     * @param {number} lat - Latitude do ponto
     * @param {number} lng - Longitude do ponto
     * @param {Array<Array<number>>|Array<Array<Array<number>>>} polygon - Ring ou lista de rings [lng, lat]
     * @returns {boolean} true se ponto está dentro do polígono
     */
    isPointInPolygon(lat, lng, polygon = null) {
        const regions = polygon ? normalizeRegionCoordinates(polygon) : this.allowedRegion;

        if (!regions || regions.length === 0) {
            logger.warn('⚠️ Região de geofence ausente ou inválida, bloqueando ponto');
            return false;
        }

        const x = lng;
        const y = lat;

        return regions.some((region) => {
            if (isPointOnRingBoundary(x, y, region)) return true;
            let inside = false;
            for (let i = 0, j = region.length - 1; i < region.length; j = i++) {
                const xi = region[i][0];
                const yi = region[i][1];
                const xj = region[j][0];
                const yj = region[j][1];

                const intersect = ((yi > y) !== (yj > y)) &&
                    (x < (xj - xi) * (y - yi) / (yj - yi) + xi);

                if (intersect) inside = !inside;
            }
            return inside;
        });
    }

    isPointInDestinationBounds(lat, lng, bounds = null) {
        const resolvedBounds = bounds || this.destinationBounds || DEFAULT_RIO_DESTINATION_BOUNDS;
        const normalizedLat = Number(lat);
        const normalizedLng = Number(lng);

        if (!Number.isFinite(normalizedLat) || !Number.isFinite(normalizedLng)) {
            return false;
        }

        return (
            normalizedLat >= resolvedBounds.south &&
            normalizedLat <= resolvedBounds.north &&
            normalizedLng >= resolvedBounds.west &&
            normalizedLng <= resolvedBounds.east
        );
    }

    /**
     * Validar se a origem inicia na geofence operacional e se o destino está no Rio.
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

        if (!this.isEnabled()) {
            metrics.recordOperationalEvent?.('geofence', 'ride_validation', 'disabled');
            return {
                valid: false,
                error: 'Região de operação temporariamente indisponível',
                code: 'GEOFENCE_DISABLED',
                retryable: true
            };
        }

        if (!this.hasConfiguredRegion()) {
            metrics.recordOperationalEvent?.('geofence', 'ride_validation', 'not_configured');
            return {
                valid: false,
                error: 'Região de operação não configurada',
                code: 'GEOFENCE_NOT_CONFIGURED',
                retryable: true
            };
        }

        if (!this.hasValidCoordinates(pickupLocation)) {
            return {
                valid: false,
                error: 'Localização de origem inválida',
                code: 'INVALID_PICKUP'
            };
        }

        if (!this.hasValidCoordinates(destinationLocation)) {
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

        const destinationInsideOperationalRegion = this.isPointInPolygon(
            destinationLocation.lat,
            destinationLocation.lng
        );
        const destinationInsideServiceArea = this.isPointInDestinationBounds(
            destinationLocation.lat,
            destinationLocation.lng
        );

        if (!pickupInside) {
            metrics.recordOperationalEvent?.('geofence', 'ride_validation', 'pickup_outside');
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

        if (isDestinationRegionRequired() && !destinationInsideOperationalRegion) {
            metrics.recordOperationalEvent?.('geofence', 'ride_validation', 'destination_outside_region');
            return {
                valid: false,
                error: 'Destino fora da região de operação permitida',
                code: 'DESTINATION_OUTSIDE_REGION',
                details: {
                    destination: { lat: destinationLocation.lat, lng: destinationLocation.lng },
                    insideOperationalRegion: false,
                    insideDestinationArea: destinationInsideServiceArea
                }
            };
        }

        if (!destinationInsideServiceArea) {
            metrics.recordOperationalEvent?.('geofence', 'ride_validation', 'destination_outside');
            return {
                valid: false,
                error: 'Destino fora da área de destino permitida',
                code: 'DESTINATION_OUTSIDE_SERVICE_AREA',
                details: {
                    destination: { lat: destinationLocation.lat, lng: destinationLocation.lng },
                    insideOperationalRegion: destinationInsideOperationalRegion,
                    insideDestinationArea: false
                }
            };
        }

        metrics.recordOperationalEvent?.('geofence', 'ride_validation', 'allowed');
        return {
            valid: true,
            details: {
                pickup: { inside: true },
                destination: {
                    insideOperationalRegion: destinationInsideOperationalRegion,
                    insideDestinationArea: true
                }
            }
        };
    }

    /**
     * Obter região atual configurada
     * @returns {Array<Array<number>>} Região atual
     */
    getCurrentRegion() {
        if (!Array.isArray(this.allowedRegion)) return null;
        const cloned = this.allowedRegion.map((ring) => ring.map(([lng, lat]) => [lng, lat]));
        return cloned.length === 1 ? cloned[0] : cloned;
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
        this.regionMetadata = {
            version: String(process.env.GEOFENCE_REGION_VERSION || 'runtime').trim(),
            updatedAt: new Date().toISOString(),
            name: String(process.env.GEOFENCE_REGION_NAME || '').trim() || null
        };
        logger.info('✅ Região de geofence atualizada', {
            polygons: normalized.length,
            points: countRegionPoints(normalized)
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

    hasConfiguredRegion() {
        return !!(
            Array.isArray(this.allowedRegion) &&
            this.allowedRegion.length > 0 &&
            this.allowedRegion.every((ring) => Array.isArray(ring) && ring.length >= 4)
        );
    }

    hasValidCoordinates(location) {
        if (!location || typeof location !== 'object') {
            return false;
        }

        const lat = Number(location.lat);
        const lng = Number(location.lng);
        return (
            Number.isFinite(lat) &&
            Number.isFinite(lng) &&
            lat >= -90 &&
            lat <= 90 &&
            lng >= -180 &&
            lng <= 180
        );
    }

    isFailClosedRequired() {
        return isFailClosedRequired();
    }

    getOperationalStatus() {
        const bypassEnabled = this.isBypassEnabled();
        const configured = this.hasConfiguredRegion();
        const enabled = this.isEnabled();
        const failClosed = this.isFailClosedRequired();

        let code = 'GEOFENCE_ACTIVE';
        if (bypassEnabled) code = 'GEOFENCE_BYPASSED';
        else if (!enabled) code = 'GEOFENCE_DISABLED';
        else if (!configured) code = 'GEOFENCE_NOT_CONFIGURED';

        return {
            active: this.isActive(),
            available: enabled && configured && !bypassEnabled,
            configured,
            enabled,
            bypassEnabled,
            failClosed,
            code,
            regionSource: this.regionSource,
            regionVersion: this.regionMetadata?.version || null,
            regionUpdatedAt: this.regionMetadata?.updatedAt || null,
            regionName: this.regionMetadata?.name || null,
            regionPolygons: Array.isArray(this.allowedRegion) ? this.allowedRegion.length : 0,
            regionPoints: countRegionPoints(this.allowedRegion),
            destinationInsideRegionRequired: isDestinationRegionRequired()
        };
    }

    /**
     * Verificar se geofence está ativo
     * @returns {boolean} true se geofence está ativo
     */
    isActive() {
        if (isGeofenceBypassEnabled()) {
            return false;
        }

        // Produção e piloto permanecem no caminho de validação mesmo quando a
        // configuração está ausente/desabilitada, para que quote e booking
        // recebam um bloqueio explícito em vez de operarem sem limite regional.
        if (this.isFailClosedRequired()) {
            return true;
        }

        return this.isEnabled() && this.hasConfiguredRegion();
    }
}

// Exportar instância singleton
const geofenceService = new GeofenceService();
module.exports = geofenceService;
