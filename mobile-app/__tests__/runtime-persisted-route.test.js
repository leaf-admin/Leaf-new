import { compactPersistedRoute } from '../src/screens/prototype/persistedRideCompaction';

describe('persisted ride route compaction', () => {
  const route = Array.from({ length: 1000 }, (_, i) => ({ latitude: -22.9 - i * 1e-5 + 1.234e-7, longitude: -43.3 + i * 1e-5 }));

  it('keeps at most 120 points with the same start and end, rounded to ~1 m', () => {
    const out = compactPersistedRoute(route);
    expect(out).toHaveLength(120);
    expect(out[0].latitude).toBeCloseTo(route[0].latitude, 5);
    expect(out[119].longitude).toBeCloseTo(route[999].longitude, 5);
    expect(String(out[10].latitude).split('.')[1].length).toBeLessThanOrEqual(5);
  });

  it('leaves short routes and missing routes untouched', () => {
    const short = route.slice(0, 50);
    expect(compactPersistedRoute(short)).toBe(short);
    expect(compactPersistedRoute(undefined)).toBeUndefined();
  });
});
