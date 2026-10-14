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
