import { resolveRouteCometSegments } from '../src/components/prototype/PrototypeMapLayer';

const route = Array.from({ length: 200 }, (_, index) => ({ latitude: index, longitude: index }));

describe('route comet', () => {
  it('lights the tip of the drawn part while the route is being drawn', () => {
    const { glow, core } = resolveRouteCometSegments(route.slice(0, 100), route.length);
    expect(glow).toHaveLength(12);
    expect(core).toHaveLength(4);
    expect(glow[glow.length - 1]).toEqual(route[99]);
    expect(core[0]).toEqual(route[96]);
  });

  it('disappears when the route is complete or barely started', () => {
    expect(resolveRouteCometSegments(route, route.length)).toEqual({ glow: null, core: null });
    expect(resolveRouteCometSegments(route.slice(0, 3), route.length)).toEqual({ glow: null, core: null });
    expect(resolveRouteCometSegments(null, 0)).toEqual({ glow: null, core: null });
  });
});

describe('traffic colours during the route draw', () => {
  const { clipTrafficSegmentsByProgress } = require('../src/components/prototype/PrototypeMapLayer');
  const segments = [
    { key: 'a', color: 'green', coordinates: [{ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 }] },
    { key: 'b', color: 'orange', coordinates: [{ latitude: 1, longitude: 0 }, { latitude: 2, longitude: 0 }] },
  ];

  it('reveals the coloured segments in route order up to the drawn fraction', () => {
    expect(clipTrafficSegmentsByProgress(segments, 0.25)).toEqual([
      { key: 'a', color: 'green', coordinates: [{ latitude: 0, longitude: 0 }, { latitude: 0.5, longitude: 0 }] },
    ]);
    const threeQuarters = clipTrafficSegmentsByProgress(segments, 0.75);
    expect(threeQuarters).toHaveLength(2);
    expect(threeQuarters[1].coordinates[1].latitude).toBeCloseTo(1.5);
  });

  it('keeps every segment when the draw is done and none before it starts', () => {
    expect(clipTrafficSegmentsByProgress(segments, 1)).toBe(segments);
    expect(clipTrafficSegmentsByProgress(segments, 0)).toEqual([]);
  });
});
