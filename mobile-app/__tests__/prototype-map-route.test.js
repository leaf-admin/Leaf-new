import {
  buildFallbackRouteCoordinates,
  clearPrototypeMapRoute,
  getPrototypeMapRoute,
  setPrototypeMapRoute,
} from '../src/screens/prototype/prototypeMapRoute';

describe('prototypeMapRoute', () => {
  beforeEach(() => {
    clearPrototypeMapRoute();
  });

  it('preserves real route coordinates when the same route is republished without coordinates', () => {
    const origin = { latitude: -22.9453, longitude: -43.3652 };
    const destination = { latitude: -23.0008, longitude: -43.3658 };
    const realRouteCoordinates = [
      origin,
      { latitude: -22.9524, longitude: -43.3602 },
      { latitude: -22.9701, longitude: -43.3521 },
      { latitude: -22.9887, longitude: -43.3589 },
      destination,
    ];

    setPrototypeMapRoute({
      origin,
      destination,
      coordinates: realRouteCoordinates,
      destinationLabel: 'Barra Shopping',
    });

    setPrototypeMapRoute({
      origin: { ...origin },
      destination: { ...destination },
      destinationLabel: 'Barra Shopping',
    });

    expect(getPrototypeMapRoute().coordinates).toEqual(realRouteCoordinates);
  });

  it('builds a non-linear fallback route when only origin and destination are available', () => {
    const origin = { latitude: -22.9453, longitude: -43.3652 };
    const destination = { latitude: -23.0008, longitude: -43.3658 };

    const coordinates = buildFallbackRouteCoordinates(origin, destination);

    expect(coordinates).toHaveLength(4);
    expect(coordinates[0]).toEqual(origin);
    expect(coordinates[3]).toEqual(destination);
    expect(coordinates[1]).not.toEqual(origin);
    expect(coordinates[2]).not.toEqual(destination);
  });
});
