/**
 * Unit tests (atualizados) para GeoHashUtils.
 */

const GeoHashUtils = require('../../../utils/geohash-utils');

describe('GeoHashUtils', () => {
  test('getRegionHash should generate geohash string', () => {
    const hash = GeoHashUtils.getRegionHash(-23.5505, -46.6333);
    expect(typeof hash).toBe('string');
    expect(hash.length).toBeGreaterThanOrEqual(4);
  });

  test('getRegionHashFromLocation should accept lat/lng and latitude/longitude', () => {
    const hash1 = GeoHashUtils.getRegionHashFromLocation({ lat: -23.55, lng: -46.63 });
    const hash2 = GeoHashUtils.getRegionHashFromLocation({ latitude: -23.55, longitude: -46.63 });
    expect(typeof hash1).toBe('string');
    expect(typeof hash2).toBe('string');
  });

  test('getAdjacentRegions should include center hash', () => {
    const center = GeoHashUtils.getRegionHash(-23.5505, -46.6333, 6);
    const regions = GeoHashUtils.getAdjacentRegions(center);
    expect(Array.isArray(regions)).toBe(true);
    expect(regions[0]).toBe(center);
  });

  test('decodeRegionHash should return lat/lng', () => {
    const center = GeoHashUtils.getRegionHash(-23.5505, -46.6333, 6);
    const decoded = GeoHashUtils.decodeRegionHash(center);
    expect(decoded).toHaveProperty('lat');
    expect(decoded).toHaveProperty('lng');
  });

  test('calculateDistanceBetweenHashes should return finite distance for valid hashes', () => {
    const sp = GeoHashUtils.getRegionHash(-23.5505, -46.6333, 6);
    const rj = GeoHashUtils.getRegionHash(-22.9068, -43.1729, 6);
    const distance = GeoHashUtils.calculateDistanceBetweenHashes(sp, rj);
    expect(Number.isFinite(distance)).toBe(true);
    expect(distance).toBeGreaterThan(0);
  });

  test('isSameRegion should compare by prefix precision', () => {
    expect(GeoHashUtils.isSameRegion('abcdef', 'abcxyz', 3)).toBe(true);
    expect(GeoHashUtils.isSameRegion('abcdef', 'zzzxyz', 3)).toBe(false);
  });

  test('getRegionsInRadius should include center hash', () => {
    const center = GeoHashUtils.getRegionHash(-23.5505, -46.6333, 6);
    const regions = GeoHashUtils.getRegionsInRadius(center, 5);
    expect(regions).toContain(center);
  });
});
