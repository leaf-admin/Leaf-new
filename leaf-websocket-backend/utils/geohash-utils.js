/**
 * UTILITÁRIOS DE GEOHASH
 * 
 * Funções para divisão regional usando GeoHash
 * Precisão 5 = ~5km x 5km (ideal para filas regionais)
 */

const ngeohash = require('ngeohash');
const { logError } = require('./logger');

class GeoHashUtils {
    /**
     * Obter GeoHash da região baseado em coordenadas
     * @param {number} lat - Latitude
     * @param {number} lng - Longitude
     * @param {number} precision - Precisão do GeoHash (padrão 5 = ~5km)
     * @returns {string} GeoHash da região
     */
    static getRegionHash(lat, lng, precision = 5) {
        try {
            return ngeohash.encode(lat, lng, precision);
        } catch (error) {
            logError(error, 'Erro ao gerar GeoHash', {
                service: 'geohash-utils',
                operation: 'getRegionHash',
                lat,
                lng,
                precision
            });
            // Fallback: usar precisão menor em caso de erro
            return ngeohash.encode(lat, lng, 4);
        }
    }

    /**
     * Obter GeoHash a partir de um objeto de localização
     * @param {Object} location - { lat, lng } ou { latitude, longitude }
     * @param {number} precision - Precisão do GeoHash
     * @returns {string} GeoHash da região
     */
    static getRegionHashFromLocation(location, precision = 5) {
        const lat = location.lat || location.latitude;
        const lng = location.lng || location.longitude;

        if (!lat || !lng) {
            throw new Error('Localização inválida: lat e lng são obrigatórios');
        }

        return this.getRegionHash(lat, lng, precision);
    }

    /**
     * Obter regiões adjacentes (9 células: centro + 8 ao redor)
     * Útil para busca expandida entre regiões
     * @param {string} regionHash - GeoHash da região central
     * @returns {Array<string>} Array com 9 GeoHashes (central + adjacentes)
     */
    static getAdjacentRegions(regionHash) {
        try {
            const neighbors = ngeohash.neighbors(regionHash);
            return [regionHash, ...neighbors]; // Incluir região central
        } catch (error) {
            logError(error, 'Erro ao buscar regiões adjacentes', {
                service: 'geohash-utils',
                operation: 'getAdjacentRegions',
                regionHash
            });
            return [regionHash]; // Fallback: retornar apenas a região central
        }
    }

    /**
     * Decodificar GeoHash para coordenadas (centro da célula)
     * @param {string} regionHash - GeoHash a ser decodificado
     * @returns {Object} { lat, lng } - Coordenadas do centro da célula
     */
    static decodeRegionHash(regionHash) {
        try {
            const decoded = ngeohash.decode(regionHash);
            return {
                lat: decoded.latitude,
                lng: decoded.longitude
            };
        } catch (error) {
            logError(error, 'Erro ao decodificar GeoHash', {
                service: 'geohash-utils',
                operation: 'decodeRegionHash',
                regionHash
            });
            throw error;
        }
    }

    /**
     * Calcular distância aproximada entre dois GeoHashes
     * @param {string} hash1 - Primeiro GeoHash
     * @param {string} hash2 - Segundo GeoHash
     * @returns {number} Distância em km (aproximada)
     */
    static calculateDistanceBetweenHashes(hash1, hash2) {
        try {
            const coord1 = this.decodeRegionHash(hash1);
            const coord2 = this.decodeRegionHash(hash2);
            
            // Fórmula de Haversine simplificada
            const R = 6371; // Raio da Terra em km
            const dLat = this.toRad(coord2.lat - coord1.lat);
            const dLng = this.toRad(coord2.lng - coord1.lng);
            
            const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                     Math.cos(this.toRad(coord1.lat)) * Math.cos(this.toRad(coord2.lat)) *
                     Math.sin(dLng / 2) * Math.sin(dLng / 2);
            
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            return R * c;
        } catch (error) {
            logError(error, 'Erro ao calcular distância entre GeoHashes', {
                service: 'geohash-utils',
                operation: 'calculateDistanceBetweenHashes',
                hash1,
                hash2
            });
            return Infinity; // Retornar distância muito grande em caso de erro
        }
    }

    /**
     * Converter graus para radianos
     * @private
     */
    static toRad(degrees) {
        return degrees * (Math.PI / 180);
    }

    /**
     * Verificar se dois GeoHashes estão na mesma região
     * (útil para verificar se corrida e motorista estão na mesma região)
     * @param {string} hash1 - Primeiro GeoHash
     * @param {string} hash2 - Segundo GeoHash
     * @param {number} precision - Precisão para comparação
     * @returns {boolean} true se estão na mesma região
     */
    static isSameRegion(hash1, hash2, precision = 5) {
        try {
            // Comparar apenas os primeiros N caracteres (precisão)
            const hash1Prefix = hash1.substring(0, precision);
            const hash2Prefix = hash2.substring(0, precision);
            return hash1Prefix === hash2Prefix;
        } catch (error) {
            logError(error, 'Erro ao comparar regiões', {
                service: 'geohash-utils',
                operation: 'isSameRegion',
                hash1,
                hash2,
                precision
            });
            return false;
        }
    }

    /**
     * Obter todas as regiões dentro de um raio (aproximado)
     * @param {string} centerHash - GeoHash central
     * @param {number} radiusKm - Raio em km
     * @returns {Array<string>} Array de GeoHashes dentro do raio
     */
    static getRegionsInRadius(centerHash, radiusKm) {
        try {
            const center = this.decodeRegionHash(centerHash);
            const allRegions = new Set([centerHash]);
            
            // Buscar regiões adjacentes em camadas (não muito preciso, mas útil para aproximação)
            const adjacent = this.getAdjacentRegions(centerHash);
            adjacent.forEach(hash => allRegions.add(hash));
            
            // Se raio for maior, incluir mais camadas
            if (radiusKm > 5) {
                // Para raios maiores, considerar mais camadas
                // (implementação simplificada - pode ser melhorada)
                adjacent.forEach(hash => {
                    const neighbors = ngeohash.neighbors(hash);
                    neighbors.forEach(n => allRegions.add(n));
                });
            }
            
            return Array.from(allRegions);
        } catch (error) {
            logError(error, 'Erro ao buscar regiões no raio', {
                service: 'geohash-utils',
                operation: 'getRegionsInRadius',
                centerHash,
                radiusKm
            });
            return [centerHash]; // Fallback: retornar apenas região central
        }
    }
}

module.exports = GeoHashUtils;


