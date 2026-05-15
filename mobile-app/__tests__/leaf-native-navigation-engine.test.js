import {
  buildLeafNativeNavigationState,
  calculateNavigationBearingDegrees,
  calculateDistanceToRouteMeters,
  resolveCurrentNavigationStepIndex,
} from '../src/services/LeafNativeNavigationEngine';

const routeCoordinates = [
  { latitude: -22.9700, longitude: -43.1800 },
  { latitude: -22.9700, longitude: -43.1790 },
  { latitude: -22.9690, longitude: -43.1790 },
];

const steps = [
  {
    instruction: 'Siga pela Rua A',
    startLocation: routeCoordinates[0],
    endLocation: routeCoordinates[1],
    distanceMeters: 102,
    durationSeconds: 60,
  },
  {
    instruction: 'Vire à direita na Rua B',
    startLocation: routeCoordinates[1],
    endLocation: routeCoordinates[2],
    distanceMeters: 111,
    durationSeconds: 70,
  },
];

describe('LeafNativeNavigationEngine', () => {
  it('chooses the step closest to the driver position', () => {
    const currentStepIndex = resolveCurrentNavigationStepIndex({
      currentCoordinate: { latitude: -22.9694, longitude: -43.1790 },
      steps,
    });

    expect(currentStepIndex).toBe(1);
  });

  it('advances to the next step when the driver reaches the current maneuver', () => {
    const currentStepIndex = resolveCurrentNavigationStepIndex({
      currentCoordinate: { latitude: -22.9700, longitude: -43.1791 },
      steps,
    });

    expect(currentStepIndex).toBe(1);
  });

  it('detects off-route positions above the 100m threshold', () => {
    const distanceToRouteMeters = calculateDistanceToRouteMeters(
      { latitude: -22.9695, longitude: -43.1765 },
      routeCoordinates,
    );
    const state = buildLeafNativeNavigationState({
      bookingId: 'booking_nav_1',
      phase: 'pickup',
      status: 'accepted',
      currentCoordinate: { latitude: -22.9695, longitude: -43.1765 },
      targetCoordinate: routeCoordinates[2],
      routeCoordinates,
      steps,
      totalDistanceMeters: 213,
      totalDurationMinutes: 3,
    });

    expect(distanceToRouteMeters).toBeGreaterThan(100);
    expect(state.isOffRoute).toBe(true);
    expect(state.currentInstruction).toBe('Vire à direita na Rua B');
  });

  it('uses a safe generic instruction when route steps are unavailable', () => {
    const state = buildLeafNativeNavigationState({
      bookingId: 'booking_nav_2',
      phase: 'destination',
      status: 'started',
      currentCoordinate: routeCoordinates[1],
      targetCoordinate: routeCoordinates[2],
      routeCoordinates: [],
      steps: [],
      remainingDistanceMeters: 500,
      totalDistanceMeters: 1000,
      totalDurationMinutes: 8,
    });

    expect(state.hasSteps).toBe(false);
    expect(state.currentInstruction).toBe('Siga até o destino');
    expect(state.remainingDistanceLabel).toBe('500 m');
    expect(state.etaLabel).toBe('4 min');
    expect(state.maneuverDistanceTargetLabel).toBe('o destino');
  });

  it('synthesizes the next turn from route geometry when cached directions omit steps', () => {
    const state = buildLeafNativeNavigationState({
      bookingId: 'booking_nav_synthetic',
      phase: 'destination',
      status: 'started',
      currentCoordinate: routeCoordinates[0],
      targetCoordinate: routeCoordinates[2],
      routeCoordinates,
      steps: [],
      totalDistanceMeters: 213,
      totalDurationMinutes: 3,
    });

    expect(state.hasSteps).toBe(true);
    expect(state.currentInstruction).toBe('Vire à esquerda');
    expect(state.maneuverDistanceTargetLabel).toBe('a próxima curva');
    expect(state.maneuverDistanceMeters).toBeGreaterThan(80);
  });

  it('returns a route bearing so navigation can keep the driver moving upward', () => {
    const bearing = calculateNavigationBearingDegrees(
      routeCoordinates[0],
      routeCoordinates[1],
    );
    const state = buildLeafNativeNavigationState({
      bookingId: 'booking_nav_heading',
      phase: 'pickup',
      status: 'accepted',
      currentCoordinate: routeCoordinates[0],
      targetCoordinate: routeCoordinates[2],
      routeCoordinates,
      steps,
      totalDistanceMeters: 213,
      totalDurationMinutes: 3,
    });

    expect(Number.isFinite(bearing)).toBe(true);
    expect(Number.isFinite(state.cameraHeadingDegrees)).toBe(true);
    expect(state.cameraHeadingDegrees).toBeGreaterThanOrEqual(0);
    expect(state.cameraHeadingDegrees).toBeLessThan(360);
  });

  it('uses step geometry for off-route checks when polyline coordinates are unavailable', () => {
    const state = buildLeafNativeNavigationState({
      bookingId: 'booking_nav_2b',
      phase: 'pickup',
      status: 'accepted',
      currentCoordinate: { latitude: -22.9700, longitude: -43.1795 },
      targetCoordinate: routeCoordinates[2],
      routeCoordinates: [],
      steps,
      totalDistanceMeters: 213,
      totalDurationMinutes: 3,
    });

    expect(state.isOffRoute).toBe(false);
    expect(state.distanceToRouteMeters).toBeLessThan(5);
  });

  it('does not produce navigation while the driver is arrived or idle', () => {
    expect(
      buildLeafNativeNavigationState({
        bookingId: 'booking_nav_3',
        phase: 'pickup',
        status: 'arrived',
        currentCoordinate: routeCoordinates[0],
        targetCoordinate: routeCoordinates[1],
        routeCoordinates,
        steps,
      }),
    ).toBeNull();
  });
});
