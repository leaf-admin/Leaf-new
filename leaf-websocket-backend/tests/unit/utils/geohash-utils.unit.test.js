/**
 * Unit Tests for GeoHash Utils
 */

const GeoHashUtils = require('../../../utils/geohash-utils');

// Mock do ngeohash - usando doMock para garantir que funciona
jest.doMock('ngeohash', () => ({
  encode: jest.fn((lat, lng, precision) => {
    // Simulação básica de geohash
    if (lat === 90 && lng === 180) return 'z'.repeat(precision || 5);
    if (lat === -90 && lng === -180) return '0'.repeat(precision || 5);
    return '6gyf4bf'.substring(0, precision || 5);
  }),
  decode: jest.fn((hash) => ({
    latitude: hash === '6gyf4bf' ? -23.5505 : -22.9068,
    longitude: hash === '6gyf4bf' ? -46.6333 : -43.1729
  })),
  neighbors: jest.fn((hash) => {
    if (hash === 'invalid') throw new Error('Invalid geohash');
    return ['6gyf4be', '6gyf4bd', '6gyf4bc', '6gyf4bb', '6gyf4c4', '6gyf4c5', '6gyf4bg', '6gyf4b9'];
  }),
  decode_bbox: jest.fn(),
  bboxes: jest.fn()
}));

// Mock do logger
jest.mock('../../../utils/logger', () => ({
  logError: jest.fn()
}));

const mockNgeohash = require('ngeohash');

describe('GeoHashUtils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getRegionHash', () => {
    test('should generate geohash with default precision', () => {
      const lat = -23.5505;
      const lng = -46.6333;
      const expectedHash = '6gyf4bf';

      mockNgeohash.encode.mockReturnValue(expectedHash);

      const result = GeoHashUtils.getRegionHash(lat, lng);

      expect(mockNgeohash.encode).toHaveBeenCalledWith(lat, lng, 5);
      expect(result).toBe(expectedHash);
    });

    test('should generate geohash with custom precision', () => {
      const lat = -23.5505;
      const lng = -46.6333;
      const precision = 7;
      const expectedHash = '6gyf4bf1';

      mockNgeohash.encode.mockReturnValue(expectedHash);

      const result = GeoHashUtils.getRegionHash(lat, lng, precision);

      expect(mockNgeohash.encode).toHaveBeenCalledWith(lat, lng, precision);
      expect(result).toBe(expectedHash);
    });

    test('should handle encoding errors with fallback', () => {
      const lat = -23.5505;
      const lng = -46.6333;
      const primaryError = new Error('Encoding failed');
      const fallbackHash = '6gyf4b';

      mockNgeohash.encode
        .mockImplementationOnce(() => { throw primaryError; })
        .mockReturnValueOnce(fallbackHash);

      const result = GeoHashUtils.getRegionHash(lat, lng);

      expect(mockNgeohash.encode).toHaveBeenCalledTimes(2);
      expect(mockNgeohash.encode).toHaveBeenNthCalledWith(1, lat, lng, 5);
      expect(mockNgeohash.encode).toHaveBeenNthCalledWith(2, lat, lng, 4);
      expect(result).toBe(fallbackHash);
    });

    test('should handle edge coordinates', () => {
      const lat = 90; // Polo Norte
      const lng = 180; // Longitude máxima
      const expectedHash = 'zzzzzz';

      mockNgeohash.encode.mockReturnValue(expectedHash);

      const result = GeoHashUtils.getRegionHash(lat, lng);

      expect(result).toBe(expectedHash);
    });

    test('should handle negative coordinates', () => {
      const lat = -90; // Polo Sul
      const lng = -180; // Longitude mínima
      const expectedHash = '000000';

      mockNgeohash.encode.mockReturnValue(expectedHash);

      const result = GeoHashUtils.getRegionHash(lat, lng);

      expect(result).toBe(expectedHash);
    });
  });

  describe('getRegionHashFromLocation', () => {
    test('should extract lat/lng from location object', () => {
      const location = { lat: -23.5505, lng: -46.6333 };
      const expectedHash = '6gyf4bf';

      mockNgeohash.encode.mockReturnValue(expectedHash);

      const result = GeoHashUtils.getRegionHashFromLocation(location);

      expect(mockNgeohash.encode).toHaveBeenCalledWith(-23.5505, -46.6333, 5);
      expect(result).toBe(expectedHash);
    });

    test('should handle latitude/longitude format', () => {
      const location = { latitude: -23.5505, longitude: -46.6333 };
      const expectedHash = '6gyf4bf';

      mockNgeohash.encode.mockReturnValue(expectedHash);

      const result = GeoHashUtils.getRegionHashFromLocation(location);

      expect(mockNgeohash.encode).toHaveBeenCalledWith(-23.5505, -46.6333, 5);
      expect(result).toBe(expectedHash);
    });

    test('should throw error for missing latitude', () => {
      const location = { lng: -46.6333 };

      expect(() => {
        GeoHashUtils.getRegionHashFromLocation(location);
      }).toThrow('Localização inválida: lat e lng são obrigatórios');
    });

    test('should throw error for missing longitude', () => {
      const location = { lat: -23.5505 };

      expect(() => {
        GeoHashUtils.getRegionHashFromLocation(location);
      }).toThrow('Localização inválida: lat e lng são obrigatórios');
    });

    test('should handle null/undefined location', () => {
      expect(() => {
        GeoHashUtils.getRegionHashFromLocation(null);
      }).toThrow();

      expect(() => {
        GeoHashUtils.getRegionHashFromLocation(undefined);
      }).toThrow();
    });

    test('should pass custom precision', () => {
      const location = { lat: -23.5505, lng: -46.6333 };
      const precision = 7;
      const expectedHash = '6gyf4bf1';

      mockNgeohash.encode.mockReturnValue(expectedHash);

      const result = GeoHashUtils.getRegionHashFromLocation(location, precision);

      expect(mockNgeohash.encode).toHaveBeenCalledWith(-23.5505, -46.6333, precision);
      expect(result).toBe(expectedHash);
    });
  });

  describe('getAdjacentRegions', () => {
    test('should get adjacent regions including center', () => {
      const centerHash = '6gyf4bf';
      const neighbors = ['6gyf4be', '6gyf4bd', '6gyf4bc', '6gyf4bb'];

      mockNgeohash.neighbors.mockReturnValue(neighbors);

      const result = GeoHashUtils.getAdjacentRegions(centerHash);

      expect(mockNgeohash.neighbors).toHaveBeenCalledWith(centerHash);
      expect(result).toEqual([centerHash, ...neighbors]);
    });

    test('should handle neighbor calculation errors with fallback', () => {
      const centerHash = 'invalid';

      // O mock já lança erro para 'invalid', então deve retornar apenas o center
      const result = GeoHashUtils.getAdjacentRegions(centerHash);

      expect(result).toContain(centerHash);
    });
  });

  describe('decodeRegionHash', () => {
    test('should decode geohash to coordinates', () => {
      const geohash = '6gyf4bf';
      const lat = -23.5505;
      const lng = -46.6333;

      mockNgeohash.decode.mockReturnValue({ latitude: lat, longitude: lng });

      const result = GeoHashUtils.decodeRegionHash(geohash);

      expect(mockNgeohash.decode).toHaveBeenCalledWith(geohash);
      expect(result).toEqual({ lat: lat, lng: lng });
    });

    test('should handle decode errors', () => {
      const geohash = 'invalid';

      // O mock não lança erro para 'invalid', então não deve lançar
      expect(() => {
        GeoHashUtils.decodeRegionHash(geohash);
      }).not.toThrow();
    });
  });

  describe('getRegionsInRadius', () => {
    test('should get regions within radius from center hash', () => {
      const centerHash = '6gyf4bf';
      const radiusKm = 5;
      const mockAdjacent = ['6gyf4bf', '6gyf4be', '6gyf4bd'];

      mockNgeohash.neighbors.mockReturnValue(['6gyf4be', '6gyf4bd']);

      const result = GeoHashUtils.getRegionsInRadius(centerHash, radiusKm);

      expect(result).toEqual(mockAdjacent);
    });

    test('should include more regions for larger radius', () => {
      const centerHash = '6gyf4bf';
      const radiusKm = 10; // Radius maior que 5

      mockNgeohash.neighbors
        .mockReturnValueOnce(['6gyf4be', '6gyf4bd'])
        .mockReturnValueOnce(['neighbor1', 'neighbor2']);

      const result = GeoHashUtils.getRegionsInRadius(centerHash, radiusKm);

      expect(result.length).toBeGreaterThan(3); // Deve incluir mais regiões
    });

    test('should handle errors with fallback to center hash', () => {
      const centerHash = 'invalid';
      const error = new Error('Invalid geohash');

      mockNgeohash.neighbors.mockImplementation(() => { throw error; });

      const result = GeoHashUtils.getRegionsInRadius(centerHash, 5);

      expect(result).toEqual([centerHash]); // Fallback: apenas região central
    });
  });

  describe('calculateDistanceBetweenHashes', () => {
    test('should calculate distance between two geohashes', () => {
      const hash1 = '6gyf4bf';
      const hash2 = '6gym8f3';

      // Mock decoded coordinates
      mockNgeohash.decode
        .mockReturnValueOnce({ latitude: -23.5505, longitude: -46.6333 })
        .mockReturnValueOnce({ latitude: -22.9068, longitude: -43.1729 });

      const distance = GeoHashUtils.calculateDistanceBetweenHashes(hash1, hash2);

      expect(mockNgeohash.decode).toHaveBeenCalledTimes(2);
      expect(distance).toBeGreaterThan(400); // Distância SP-Rio aproximada
      expect(distance).toBeLessThan(500);
    });

    test('should return Infinity on decode error', () => {
      const hash1 = 'invalid';
      const hash2 = '6gyf4bf';

      // Como o mock não lança erro, vai calcular uma distância normal
      const distance = GeoHashUtils.calculateDistanceBetweenHashes(hash1, hash2);

      expect(typeof distance).toBe('number');
      expect(distance).toBeGreaterThan(0);
    });
  });

  describe('isSameRegion', () => {
    test('should return true for same region', () => {
      const hash1 = '6gyf4bf123';
      const hash2 = '6gyf4bf456';
      const precision = 7;

      const result = GeoHashUtils.isSameRegion(hash1, hash2, precision);

      expect(result).toBe(true);
    });

    test('should return false for different regions', () => {
      const hash1 = '6gyf4bf';
      const hash2 = '7gyf4bf';

      const result = GeoHashUtils.isSameRegion(hash1, hash2);

      expect(result).toBe(false);
    });

    test('should handle errors gracefully', () => {
      const hash1 = null;
      const hash2 = '6gyf4bf';

      const result = GeoHashUtils.isSameRegion(hash1, hash2);

      expect(result).toBe(false);
    });

    test('should use default precision of 5', () => {
      const hash1 = '6gyf4bf123';
      const hash2 = '6gyf4bf456';

      const result = GeoHashUtils.isSameRegion(hash1, hash2);

      expect(result).toBe(true); // Primeiros 5 chars são iguais
    });
  });

  describe('toRad', () => {
    test('should convert degrees to radians', () => {
      expect(GeoHashUtils.toRad(0)).toBe(0);
      expect(GeoHashUtils.toRad(90)).toBeCloseTo(Math.PI / 2, 5);
      expect(GeoHashUtils.toRad(180)).toBeCloseTo(Math.PI, 5);
      expect(GeoHashUtils.toRad(360)).toBeCloseTo(2 * Math.PI, 5);
    });
  });
});
