import {
  buildLeafNativeNavigationState,
  calculateNavigationBearingDegrees,
  calculateDistanceToRouteMeters,
  resolveNavigationCameraPitch,
  resolveNavigationCameraZoom,
  resolveStableNavigationCameraZoom,
  resolveCurrentNavigationStepIndex,
  shouldRevealNavigationRoute,
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
  it.each([[15.8, 25, 29, 15.5], [15.5, 50, 54, 15.2], [15.2, 80, 84, 14.9]])(
    'holds zoom %s through speed noise around %s km/h, then changes at %s', (zoom, boundary, exit, nextZoom) => {
      for (const speed of [boundary - 1, boundary + 1, boundary - 0.5, boundary + 2]) {
        expect(resolveStableNavigationCameraZoom(speed, zoom)).toBe(zoom);
      }
      expect(resolveStableNavigationCameraZoom(exit, zoom)).toBe(nextZoom);
    });

  it('returns to closer zoom on deceleration and honors explicit arrival framing', () => {
    expect(resolveStableNavigationCameraZoom(79, 14.9)).toBe(14.9);
    expect(resolveStableNavigationCameraZoom(76, 14.9)).toBe(15.2);
    expect(resolveStableNavigationCameraZoom(46, 15.2)).toBe(15.5);
    expect(resolveStableNavigationCameraZoom(21, 15.5)).toBe(15.8);
    expect(resolveStableNavigationCameraZoom(60, 15.2, 15.8)).toBe(15.8);
    expect(resolveStableNavigationCameraZoom(90, null)).toBe(14.9);
  });

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

  it('keeps pickup arrival at the server default radius without changing destination hints', () => {
    const build = (phase, meters, projectedMeters = meters) => buildLeafNativeNavigationState({
      bookingId: 'arrival-radius', phase,
      status: phase === 'pickup' ? 'accepted' : 'started',
      currentCoordinate: { latitude: routeCoordinates[2].latitude - meters / 111195, longitude: routeCoordinates[2].longitude },
      targetCoordinate: routeCoordinates[2], routeCoordinates: [], steps: [],
      remainingDistanceMeters: projectedMeters, totalDistanceMeters: 1000, totalDurationMinutes: 4,
    });
    expect(build('pickup', 50).hasArrived).toBe(false);
    expect(build('pickup', 50, 0).hasArrived).toBe(false);
    expect(build('pickup', 10).hasArrived).toBe(true);
    expect(build('destination', 50).hasArrived).toBe(true);
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
    expect(state.currentInstruction).toBe('Siga até o embarque');
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

  it('keeps summary guidance when cached directions omit provider steps', () => {
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

    expect(state.hasSteps).toBe(false);
    expect(state.currentInstruction).toBe('Siga até o destino');
    expect(state.maneuverDistanceTargetLabel).toBe('o destino');
    expect(state.maneuverDistanceMeters).toBeGreaterThan(80);
  });

  it('ignores inferred steps in old plans and preserves the provider maneuver', () => {
    const state = buildLeafNativeNavigationState({
      bookingId: 'provider_steps', phase: 'pickup', status: 'accepted',
      currentCoordinate: routeCoordinates[0], targetCoordinate: routeCoordinates[2],
      routeCoordinates,
      steps: [
        { ...steps[0], synthetic: true, instruction: 'Vire à esquerda' },
        { ...steps[1], instruction: 'Pegue a saída indicada', maneuver: 'RAMP_RIGHT' },
      ],
      totalDistanceMeters: 213, totalDurationMinutes: 3,
    });
    expect(state.currentInstruction).toBe('Pegue a saída indicada');
    expect(state.maneuver).toBe('RAMP_RIGHT');
  });

  it('keeps maneuver distance decreasing as the driver advances along the route', () => {
    const startState = buildLeafNativeNavigationState({
      bookingId: 'booking_nav_monotonic',
      phase: 'pickup',
      status: 'accepted',
      currentCoordinate: routeCoordinates[0],
      targetCoordinate: routeCoordinates[2],
      routeCoordinates,
      steps,
      totalDistanceMeters: 213,
      totalDurationMinutes: 3,
    });
    const halfwayState = buildLeafNativeNavigationState({
      bookingId: 'booking_nav_monotonic',
      phase: 'pickup',
      status: 'accepted',
      currentCoordinate: { latitude: -22.9700, longitude: -43.1795 },
      targetCoordinate: routeCoordinates[2],
      routeCoordinates,
      steps,
      totalDistanceMeters: 213,
      totalDurationMinutes: 3,
    });

    expect(startState.maneuverDistanceTargetLabel).toBe('a próxima curva');
    expect(halfwayState.maneuverDistanceTargetLabel).toBe('a próxima curva');
    expect(halfwayState.maneuverDistanceMeters).toBeLessThan(startState.maneuverDistanceMeters);
    expect(halfwayState.remainingDistanceMeters).toBeLessThan(startState.remainingDistanceMeters);
  });

  it('stops showing a passed turn as the next curve', () => {
    const state = buildLeafNativeNavigationState({
      bookingId: 'booking_nav_passed_turn',
      phase: 'pickup',
      status: 'accepted',
      currentCoordinate: routeCoordinates[1],
      targetCoordinate: routeCoordinates[2],
      routeCoordinates,
      steps,
      totalDistanceMeters: 213,
      totalDurationMinutes: 3,
    });

    expect(state.maneuverDistanceTargetLabel).toBe('o embarque');
    expect(state.currentInstruction).toBe('Siga até o embarque');
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
    expect(state.cameraAnchorY).toBe(0.68);
    expect(state.cameraAnimationDurationMs).toBe(800);
    expect(state.routeCoordinates).toEqual(routeCoordinates);
  });

  it('keeps navigation camera pitch top-down while zoom adapts by driver speed', () => {
    expect(resolveNavigationCameraZoom(0)).toBe(15.8);
    expect(resolveNavigationCameraZoom(30)).toBe(15.5);
    expect(resolveNavigationCameraZoom(55)).toBe(15.2);
    expect(resolveNavigationCameraZoom(90)).toBe(14.9);
    expect(resolveNavigationCameraPitch(0)).toBe(0);
    expect(resolveNavigationCameraPitch(12)).toBe(0);

    const stoppedState = buildLeafNativeNavigationState({
      bookingId: 'booking_nav_camera_stopped',
      phase: 'destination',
      status: 'started',
      currentCoordinate: { ...routeCoordinates[0], speed: 0 },
      targetCoordinate: routeCoordinates[2],
      routeCoordinates,
      steps,
      totalDistanceMeters: 213,
      totalDurationMinutes: 3,
    });
    const fastState = buildLeafNativeNavigationState({
      bookingId: 'booking_nav_camera_fast',
      phase: 'destination',
      status: 'started',
      currentCoordinate: routeCoordinates[0],
      currentSpeedMetersPerSecond: 20,
      targetCoordinate: routeCoordinates[2],
      routeCoordinates,
      steps,
      totalDistanceMeters: 213,
      totalDurationMinutes: 3,
    });

    expect(stoppedState.cameraZoom).toBeGreaterThan(fastState.cameraZoom);
    expect(stoppedState.cameraZoom).toBe(15.8);
    expect(stoppedState.cameraPitch).toBe(0);
    expect(fastState.currentSpeedKmh).toBe(72);
    expect(fastState.cameraZoom).toBeGreaterThanOrEqual(15);
    expect(fastState.cameraPitch).toBe(0);
  });

  it('keeps one steady zoom along the leg instead of closing in as the target gets near', () => {
    const farZoom = resolveNavigationCameraZoom(30, 5000, 5000);
    const nearZoom = resolveNavigationCameraZoom(30, 40, 5000);
    expect(nearZoom).toBe(farZoom);
    // Never above the zoom where the Android base map shades the blocks.
    expect(resolveNavigationCameraZoom(0)).toBeLessThanOrEqual(15.8);
  });

  it('reveals each new pickup or destination route exactly once per navigation phase', () => {
    const pickupKey = 'booking_nav_reveal:pickup:accepted';
    const destinationKey = 'booking_nav_reveal:destination:started';

    expect(shouldRevealNavigationRoute({
      navigationKey: pickupKey,
      status: 'accepted',
      routeCoordinates,
    })).toBe(true);
    expect(shouldRevealNavigationRoute({
      lastRevealedNavigationKey: pickupKey,
      navigationKey: pickupKey,
      status: 'accepted',
      routeCoordinates,
    })).toBe(false);
    expect(shouldRevealNavigationRoute({
      lastRevealedNavigationKey: pickupKey,
      navigationKey: destinationKey,
      status: 'started',
      routeCoordinates,
    })).toBe(true);
    expect(shouldRevealNavigationRoute({
      lastRevealedNavigationKey: pickupKey,
      navigationKey: destinationKey,
      status: 'arrived',
      routeCoordinates,
    })).toBe(false);
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

describe('arrival in the Leaf navigation banner', () => {
  it('says the driver arrived instead of "Siga até o destino · 0 m"', () => {
    const arrived = buildLeafNativeNavigationState({
      bookingId: 'booking_nav_arrival',
      phase: 'destination',
      status: 'started',
      currentCoordinate: routeCoordinates[2],
      targetCoordinate: routeCoordinates[2],
      routeCoordinates,
      steps,
      totalDistanceMeters: 213,
      totalDurationMinutes: 3,
    });
    expect(arrived.hasArrived).toBe(true);
    expect(arrived.currentInstruction).toBe('Você chegou ao destino');
    expect(arrived.arrivalHint).toBe('Deslize para encerrar a corrida');
    expect(arrived.etaLabel).toBe('');

    const pickup = buildLeafNativeNavigationState({
      bookingId: 'booking_nav_arrival',
      phase: 'pickup',
      status: 'accepted',
      currentCoordinate: routeCoordinates[2],
      targetCoordinate: routeCoordinates[2],
      routeCoordinates,
      steps,
      totalDistanceMeters: 213,
      totalDurationMinutes: 3,
    });
    expect(pickup.currentInstruction).toBe('Você chegou ao embarque');

    const onTheWay = buildLeafNativeNavigationState({
      bookingId: 'booking_nav_arrival',
      phase: 'destination',
      status: 'started',
      currentCoordinate: routeCoordinates[0],
      targetCoordinate: routeCoordinates[2],
      routeCoordinates,
      steps,
      totalDistanceMeters: 213,
      totalDurationMinutes: 3,
    });
    expect(onTheWay.hasArrived).toBe(false);
    expect(onTheWay.currentInstruction).not.toMatch(/chegou/);
  });
});


describe('shared maneuver route measurement', () => {
  it('builds the route geometry once for current position and multiple candidate turns', () => {
    const fs = require('fs');
    const vm = require('vm');
    const source = fs.readFileSync(require.resolve('../src/services/LeafNativeNavigationEngine'), 'utf8');
    const start = source.indexOf('function resolveUpcomingNavigationTarget(');
    const end = source.indexOf('export function resolveCurrentNavigationStepIndex', start);
    const prepared = { segments: ['prepared-once'] };
    const buildRouteMeasureSegments = jest.fn(() => prepared);
    const projectCoordinateToRouteMeasure = jest.fn((coordinate, coordinates, measure) => {
      expect(measure).toBe(prepared);
      return { routeMeters: coordinate.meters };
    });
    const input = {
      current: { meters: 100 }, target: { meters: 1000 }, routeGeometryCoordinates: ['route'],
      normalizedSteps: [110, 120, 200].map(meters => ({ startLocation: { meters }, instruction: 'Vire à direita' })),
      currentStepIndex: 0, remainingMeters: 900, fallbackInstruction: 'Siga',
    };
    const result = vm.runInNewContext(`${source.slice(start, end)}\nresolveUpcomingNavigationTarget(input);`, {
      input, buildRouteMeasureSegments, projectCoordinateToRouteMeasure,
      isTurningStep: () => true, DEFAULT_ADVANCE_THRESHOLD_METERS: 35,
      calculateNavigationDistanceMeters: () => 100,
      calculateRouteDistanceToCoordinateMeters: () => 100,
    });
    expect(result.distanceTargetCoordinate.meters).toBe(200);
    expect(buildRouteMeasureSegments).toHaveBeenCalledTimes(1);
    expect(projectCoordinateToRouteMeasure).toHaveBeenCalledTimes(4);
  });
});


it('preserves partial-segment route distance when sharing prepared maneuver geometry', () => {
  const state = buildLeafNativeNavigationState({
    bookingId: 'partial-segment', phase: 'destination', status: 'started',
    currentCoordinate: { latitude: 0, longitude: 0.005 },
    targetCoordinate: { latitude: 0, longitude: 0.02 },
    routeCoordinates: [0, 0.01, 0.02].map(longitude => ({ latitude: 0, longitude })),
    steps: [{
      instruction: 'Vire à direita', maneuver: 'TURN_RIGHT',
      startLocation: { latitude: 0, longitude: 0 },
      endLocation: { latitude: 0, longitude: 0.01 },
      maneuverLocation: { latitude: 0, longitude: 0.01 },
    }],
  });
  expect(state.remainingDistanceMeters).toBeGreaterThan(1600);
  expect(state.remainingDistanceMeters).toBeLessThan(1700);
  expect(state.maneuverDistanceMeters).toBeGreaterThan(500);
  expect(state.maneuverDistanceMeters).toBeLessThan(600);
});
