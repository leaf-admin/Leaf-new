import {
  advanceCoordinateAlongPath,
  buildPlaybackPath,
  calculateHeadingDegrees,
  resolvePlaybackProfile,
  resolvePlaybackStepMeters,
} from "../src/screens/prototype/mockRoutePlaybackService";

describe("mockRoutePlaybackService", () => {
  it("builds a fallback path from origin to destination when no polyline exists", () => {
    const path = buildPlaybackPath(
      [],
      { latitude: -23.55, longitude: -46.63 },
      { latitude: -23.56, longitude: -46.64 },
    );

    expect(path).toHaveLength(2);
    expect(path[0]).toEqual({ latitude: -23.55, longitude: -46.63 });
    expect(path[1]).toEqual({ latitude: -23.56, longitude: -46.64 });
  });

  it("advances the marker along the route instead of teleporting to the destination", () => {
    const path = [
      { latitude: -23.55, longitude: -46.63 },
      { latitude: -23.5504, longitude: -46.6304 },
      { latitude: -23.5508, longitude: -46.6308 },
    ];

    const frame = advanceCoordinateAlongPath({
      currentCoordinate: path[0],
      path,
      stepMeters: 30,
      destinationCoordinate: path[2],
    });

    expect(frame.coordinate).toBeTruthy();
    expect(frame.reachedDestination).toBe(false);
    expect(frame.coordinate).not.toEqual(path[2]);
    expect(frame.remainingMeters).toBeGreaterThan(0);
  });

  it("returns route-specific step distances and a valid heading", () => {
    expect(resolvePlaybackStepMeters("accepted")).toBe(20);
    expect(resolvePlaybackStepMeters("started")).toBe(25);
    expect(resolvePlaybackStepMeters("idle")).toBe(0);

    const heading = calculateHeadingDegrees(
      { latitude: -23.55, longitude: -46.63 },
      { latitude: -23.551, longitude: -46.631 },
    );

    expect(Number.isFinite(heading)).toBe(true);
    expect(heading).toBeGreaterThanOrEqual(0);
    expect(heading).toBeLessThan(360);
  });

  it("supports configurable playback speed, tick interval and QA multiplier", () => {
    const profile = resolvePlaybackProfile("started", {
      tickMs: 3000,
      qaMultiplier: 2,
      speedMetersPerSecond: 9,
    });

    expect(profile.tickMs).toBe(3000);
    expect(profile.qaMultiplier).toBe(2);
    expect(profile.speedMetersPerSecond).toBe(9);
    expect(profile.stepMeters).toBe(54);
  });
});
