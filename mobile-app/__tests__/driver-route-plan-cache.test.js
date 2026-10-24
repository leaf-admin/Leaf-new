const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync(require.resolve('../src/screens/prototype/prototypeRideRuntime'), 'utf8');
const start = source.indexOf('function getCachedDriverRoutePlan(');
const end = source.indexOf('function resolveRouteDurationMinutesFromSource', start);
const hydrationStart = source.indexOf('function ensurePersistedDriverRoutePlan(');
const hydrationEnd = source.indexOf('function resolveDriverRoutePlan(', hydrationStart);

// Execute the actual private cache operations, isolating their geometry validator
// from Auth/GPS. Only this insertion function can write to the runtime's cache.
function createCache() {
  const extractDriverRoutePlan = jest.fn(({ routePlan }) => routePlan ? JSON.parse(JSON.stringify(routePlan)) : null);
  const hasCompleteRoadRoutePlanGeometry = jest.fn(plan => plan.pickupCoordinates.length >= 3 && plan.destinationCoordinates.length >= 3);
  const buildDriverRoutePlanWithCanonicalDestination = jest.fn(({ routePlan, canonicalDestinationRoute }) => {
    if (!routePlan) return null;
    const next = JSON.parse(JSON.stringify(routePlan));
    if (canonicalDestinationRoute?.coordinates?.length > next.destinationCoordinates.length) {
      next.destinationCoordinates = canonicalDestinationRoute.coordinates;
    }
    return next;
  });
  const context = { extractDriverRoutePlan, hasCompleteRoadRoutePlanGeometry, buildDriverRoutePlanWithCanonicalDestination,
    runtimeRoutePlanCache: new Map(),
    buildRuntimeRoutePlanCacheKeys: id => id ? [id] : [],
  };
  vm.createContext(context);
  vm.runInContext(`${source.slice(start, end)}\n${source.slice(hydrationStart, hydrationEnd)}; this.cache = cacheDriverRoutePlan; this.read = getCachedDriverRoutePlan; this.hydrate = ensurePersistedDriverRoutePlan;`, context);
  return { ...context, extractDriverRoutePlan, hasCompleteRoadRoutePlanGeometry };
}
function plan(offset = 0) {
  const points = [0, 1, 2].map(i => ({ latitude: i + offset, longitude: i }));
  return { pickupCoordinates: points, destinationCoordinates: points, combinedCoordinates: points, synthetic: false };
}
describe('validated driver route plan cache', () => {
  it('validates at insertion and reuses the same geometry without scanning it for each GPS render', () => {
    const c = createCache();
    const input = plan();
    const saved = c.cache({ bookingId: 'ride-1', routePlan: input });
    for (let i = 0; i < 60; i++) expect(c.read({ bookingId: 'ride-1' })).toBe(saved);
    expect(c.extractDriverRoutePlan).toHaveBeenCalledTimes(1);
    expect(c.hasCompleteRoadRoutePlanGeometry).toHaveBeenCalledTimes(1);
    expect(Object.isFrozen(saved)).toBe(true);
    expect(Object.isFrozen(saved.pickupCoordinates)).toBe(true);
    expect(Object.isFrozen(saved.pickupCoordinates[0])).toBe(true);
    input.pickupCoordinates[0].latitude = 50;
    expect(saved.pickupCoordinates[0].latitude).toBe(0);
    expect(c.read({ bookingId: 'ride-2' })).toBeNull();
  });
  it.each([null, { ...plan(), synthetic: true }, { ...plan(), destinationCoordinates: [] }])('does not insert invalid or synthetic geometry %j', routePlan => {
    const c = createCache();
    expect(c.cache({ bookingId: 'ride-1', routePlan })).toBeNull();
    expect(c.read({ bookingId: 'ride-1' })).toBeNull();
  });
  it('validates a replacement before changing the cached plan', () => {
    const c = createCache();
    const old = c.cache({ bookingId: 'ride-1', routePlan: plan() });
    c.cache({ bookingId: 'ride-1', routePlan: { ...plan(), synthetic: true } });
    expect(c.read({ bookingId: 'ride-1' })).toBe(old);
    const replacement = c.cache({ bookingId: 'ride-1', routePlan: plan(2) });
    expect(c.read({ bookingId: 'ride-1' })).toBe(replacement);
    expect(replacement).not.toBe(old);
    expect(c.hasCompleteRoadRoutePlanGeometry).toHaveBeenCalledTimes(2);
  });
});


describe('route hydration after app resume', () => {
  it('keeps the private validated plan stable across repeated GPS/meta hydration', () => {
    const c = createCache();
    const saved = c.cache({ bookingId: 'ride-1', routePlan: plan() });
    for (let i = 0; i < 60; i++) {
      expect(c.hydrate({ bookingId: 'ride-1', routePlan: saved,
        canonicalDestinationRoute: { coordinates: plan().destinationCoordinates },
      })).toBe(saved);
    }
    expect(c.buildDriverRoutePlanWithCanonicalDestination).not.toHaveBeenCalled();
    expect(c.hasCompleteRoadRoutePlanGeometry).toHaveBeenCalledTimes(1);
    expect(c.extractDriverRoutePlan).toHaveBeenCalledTimes(1);
  });
  it('still builds and validates an expanded canonical route', () => {
    const c = createCache();
    const saved = c.cache({ bookingId: 'ride-1', routePlan: plan() });
    const expanded = [...plan().destinationCoordinates, { latitude: 3, longitude: 3 }];
    const updated = c.hydrate({ bookingId: 'ride-1', routePlan: saved,
      canonicalDestinationRoute: { coordinates: expanded },
    });
    expect(updated).not.toBe(saved);
    expect(updated.destinationCoordinates).toHaveLength(4);
    expect(c.read({ bookingId: 'ride-1' })).toBe(updated);
    expect(c.hasCompleteRoadRoutePlanGeometry).toHaveBeenCalledTimes(2);
  });
  it('does not trust an object merely because it was frozen outside the private cache', () => {
    const c = createCache();
    const input = Object.freeze(plan());
    const saved = c.hydrate({ bookingId: 'ride-1', routePlan: input });
    expect(saved).not.toBe(input);
    expect(c.buildDriverRoutePlanWithCanonicalDestination).toHaveBeenCalledTimes(1);
    expect(c.hasCompleteRoadRoutePlanGeometry).toHaveBeenCalledTimes(1);
  });
});
