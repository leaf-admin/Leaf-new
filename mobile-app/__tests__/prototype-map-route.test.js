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

  it('preserves traffic segments when the same route is republished without coordinates', () => {
    const origin = { latitude: -22.9453, longitude: -43.3652 };
    const destination = { latitude: -23.0008, longitude: -43.3658 };
    const realRouteCoordinates = [
      origin,
      { latitude: -22.9524, longitude: -43.3602 },
      destination,
    ];
    const trafficSegments = [
      {
        level: 'moderate',
        color: '#F59E0B',
        coordinates: [origin, realRouteCoordinates[1]],
      },
      {
        level: 'heavy',
        color: '#DC2626',
        coordinates: [realRouteCoordinates[1], destination],
      },
    ];

    setPrototypeMapRoute({
      origin,
      destination,
      coordinates: realRouteCoordinates,
      trafficSegments,
      destinationLabel: 'Barra Shopping',
    });

    setPrototypeMapRoute({
      origin: { ...origin },
      destination: { ...destination },
      destinationLabel: 'Barra Shopping',
    });

    expect(getPrototypeMapRoute().trafficSegments).toEqual(trafficSegments);
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

  it('does not publish a synthetic route when fallback is disabled', () => {
    const origin = { latitude: -22.9453, longitude: -43.3652 };
    const destination = { latitude: -23.0008, longitude: -43.3658 };

    setPrototypeMapRoute({
      origin,
      destination,
      allowFallback: false,
      destinationLabel: 'Barra Shopping',
    });

    expect(getPrototypeMapRoute().coordinates).toEqual([]);
  });

  it('clears the previous route while waiting for a real route with fallback disabled', () => {
    const origin = { latitude: -22.9453, longitude: -43.3652 };
    const firstDestination = { latitude: -23.0008, longitude: -43.3658 };
    const secondDestination = { latitude: -22.9131, longitude: -43.2302 };

    setPrototypeMapRoute({
      origin,
      destination: firstDestination,
      coordinates: [
        origin,
        { latitude: -22.9524, longitude: -43.3602 },
        firstDestination,
      ],
      destinationLabel: 'Barra Shopping',
    });

    setPrototypeMapRoute({
      origin,
      destination: secondDestination,
      allowFallback: false,
      destinationLabel: 'Centro',
    });

    expect(getPrototypeMapRoute().coordinates).toEqual([]);
    expect(getPrototypeMapRoute().trafficSegments).toEqual([]);
  });
});
