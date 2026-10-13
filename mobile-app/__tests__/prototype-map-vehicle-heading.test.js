import {
  buildRouteMotionMetrics,
  clampDriverSpeedMetersPerSecond,
  interpolateHeadingDegrees,
  resolveScreenRelativeVehicleHeading,
  resolveVehicleRouteFrame,
} from '../src/components/prototype/PrototypeMapLayer';

describe('prototype map vehicle heading', () => {
  it('keeps a projected vehicle aligned with the route when navigation rotates the map', () => {
    expect(resolveScreenRelativeVehicleHeading(128, 128)).toBe(0);
    expect(resolveScreenRelativeVehicleHeading(188, 128)).toBe(60);
  });

  it('normalizes turn wrap-around and safely handles missing vehicle heading', () => {
    expect(resolveScreenRelativeVehicleHeading(12, 348)).toBe(24);
    expect(resolveScreenRelativeVehicleHeading(null, 90)).toBe(0);
  });

  it('turns across north using the short arc instead of spinning around', () => {
    expect(interpolateHeadingDegrees(350, 10, 0.5)).toBe(0);
    expect(interpolateHeadingDegrees(10, 350, 0.5)).toBe(0);
    expect(interpolateHeadingDegrees(null, 90, 1)).toBe(90);
  });

  const cornerRoute = [
    { latitude: 0, longitude: 0 },
    { latitude: 0.001, longitude: 0 },
    { latitude: 0.001, longitude: 0.001 },
  ];
  const metrics = buildRouteMotionMetrics(cornerRoute);
  const frame = progress => resolveVehicleRouteFrame({
    routeMetrics: metrics, startMeters: 0, endMeters: metrics.totalMeters, progress,
  });

  it('follows the supplied corner without cutting diagonally across blocks', () => {
    expect(frame(0.25).coordinate.latitude).toBeCloseTo(0.0005, 6);
    expect(frame(0.25).coordinate.longitude).toBeCloseTo(0, 6);
    expect(frame(0.75).coordinate.latitude).toBeCloseTo(0.001, 6);
    expect(frame(0.75).coordinate.longitude).toBeCloseTo(0.0005, 6);
    expect(frame(0.25).heading).toBeCloseTo(0, 3);
    expect(frame(0.75).heading).toBeCloseTo(90, 3);
  });

  it('blends the tangent near a corner while keeping the position on the road', () => {
    const atCorner = frame(0.5);
    expect(atCorner.heading).toBeCloseTo(45, 1);
    expect(atCorner.coordinate.latitude).toBeCloseTo(0.001, 6);
    expect(atCorner.coordinate.longitude).toBeCloseTo(0, 6);
  });

  it('bounds route progress and safely rejects missing geometry', () => {
    expect(frame(-1).coordinate).toEqual(cornerRoute[0]);
    expect(frame(2).coordinate).toEqual(cornerRoute[2]);
    expect(resolveVehicleRouteFrame({ startMeters: 0, endMeters: 10 })).toBeNull();
    expect(resolveVehicleRouteFrame({ routeMetrics: metrics, startMeters: null, endMeters: 10 })).toBeNull();
  });

  it('keeps the car stopped until there is observed movement instead of inventing speed', () => {
    expect(clampDriverSpeedMetersPerSecond(undefined)).toBe(0);
    expect(clampDriverSpeedMetersPerSecond(null)).toBe(0);
    expect(clampDriverSpeedMetersPerSecond(0)).toBe(0);
    expect(clampDriverSpeedMetersPerSecond(-3)).toBe(0);
    expect(clampDriverSpeedMetersPerSecond(0.5)).toBe(0.5);
    expect(clampDriverSpeedMetersPerSecond(30)).toBe(18);
  });
});
