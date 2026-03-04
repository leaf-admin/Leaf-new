/**
 * 📍 GEOFENCE UTILS (POLYGON-BASED)
 * 
 * Utilitários baseados em GeoJSON para verificar se uma coordenada
 * está dentro da área de operação permitida da Leaf.
 */

const fs = require('fs');
const path = require('path');
const { point } = require('@turf/helpers');
const booleanPointInPolygon = require('@turf/boolean-point-in-polygon').default || require('@turf/boolean-point-in-polygon');
const { logStructured } = require('./logger');

// Variável para armazenar o polígono em cache na memória (evita ler o disco toda hora)
let geofenceCache = null;

/**
 * Lê e carrega o arquivo geofence.json
 */
function loadGeofence() {
    if (geofenceCache) return geofenceCache;

    try {
        const filePath = path.join(__dirname, '..', 'config', 'geofence.json');

        // Verifica se o arquivo existe, senão retorna null calmamente
        if (!fs.existsSync(filePath)) {
            logStructured('warn', 'Arquivo config/geofence.json não encontrado. Geofencing desativado.', { service: 'geofence' });
            return null;
        }

        const data = fs.readFileSync(filePath, 'utf8');
        const geojson = JSON.parse(data);

        if (!geojson || !geojson.features || geojson.features.length === 0) {
            logStructured('warn', 'Formato inválido em config/geofence.json.', { service: 'geofence' });
            return null;
        }

        // Armazena a primeira Feature (Polygon) como limite operacional
        geofenceCache = geojson.features[0];

        logStructured('info', `Geofence carregado: ${geofenceCache.properties?.name || 'Polígono Indefinido'}`, { service: 'geofence' });
        return geofenceCache;
    } catch (e) {
        logStructured('error', 'Erro ao carregar geofence.json', { service: 'geofence', error: e.message });
        return null;
    }
}

/**
 * Verifica se uma coordenada está dentro do polígono de operação
 * @param {number} lat - Latitude do request
 * @param {number} lng - Longitude do request
 * @returns {object} - { isAllowed: boolean, reason?: string }
 */
function isWithinOperatingArea(lat, lng) {
    // 1. Fallback se não bater nos parâmetros
    if (typeof lat !== 'number' || typeof lng !== 'number') {
        return { isAllowed: false, reason: "Coordenadas inválidas." };
    }

    // 2. Bypass para testes E2E
    if (process.env.GEOFENCE_RADIUS_KM === '9999' || process.env.BYPASS_GEOFENCE === 'true') {
        return { isAllowed: true, reason: "Bypass de testes ativado." };
    }

    // 3. Carrega o Polígono
    const polygon = loadGeofence();

    // 4. Se não existe arquivo configurado no servidor, permitimos a corrida para não travar o app cego
    if (!polygon) {
        return { isAllowed: true, reason: "Nenhum polígono estrito configurado." };
    }

    // 5. Validação Turf.js
    try {
        // Turf usa [longitude, latitude]!
        const pt = point([lng, lat]);
        const isAllowed = booleanPointInPolygon(pt, polygon);

        if (!isAllowed) {
            logStructured('warn', 'Requisição de corrida fora do polígono de operação', {
                service: 'geofence',
                requestedLat: lat,
                requestedLng: lng,
                geoZone: polygon.properties?.name || 'Desconhecida'
            });
            return { isAllowed: false, reason: `Fora da área delimitada (${polygon.properties?.name || 'Região'}).` };
        }

        return { isAllowed: true };
    } catch (error) {
        logStructured('error', 'Falha ao processar limite geográfico no Turf.js', { service: 'geofence', error: error.message });
        // Em caso de erro matemático bizarro, rejeita por segurança
        return { isAllowed: false, reason: "Erro no processamento territorial." };
    }
}

module.exports = {
    isWithinOperatingArea,
    loadGeofence
};
