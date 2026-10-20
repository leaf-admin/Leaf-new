import {
  resolveDisplayEtaMinutes,
  resolveMonotonicArrivalState,
  resolveRouteProgress,
} from "../src/screens/prototype/liveRouteTiming";

describe("live route timing", () => {
  it("allows a just-started live route to begin at zero progress", () => {
    expect(
      resolveRouteProgress({
        remainingMinutes: 20,
        totalMinutes: 20,
        nowMs: 0,
      }),
    ).toBe(0);

    expect(
      resolveRouteProgress({
        remainingMinutes: 20,
        totalMinutes: 20,
        startedAt: new Date(0).toISOString(),
        nowMs: 0,
      }),
    ).toBe(0);
  });

  it("does not default an incomplete live route to the middle of the progress line", () => {
    expect(
      resolveRouteProgress({
        remainingMinutes: 20,
        totalMinutes: null,
        startedAt: null,
        nowMs: 0,
      }),
    ).toBe(0);
  });

  it("advances route progress between ETA updates", () => {
    const startedAt = new Date(0).toISOString();
    const firstProgress = resolveRouteProgress({
      remainingMinutes: 17,
      totalMinutes: 20,
      startedAt,
      nowMs: 10 * 60000,
    });
    const nextProgress = resolveRouteProgress({
      remainingMinutes: 17,
      totalMinutes: 20,
      startedAt,
      nowMs: 10 * 60000 + 1000,
    });

    expect(nextProgress).toBeGreaterThan(firstProgress);
    expect(nextProgress - firstProgress).toBeLessThan(0.002);
  });

  it("does not move the displayed arrival back and forth on 17/18 minute jitter", () => {
    const initialState = resolveMonotonicArrivalState(null, {
      routeKey: "booking_1:started",
      remainingMinutes: 17,
      nowMs: 0,
    });
    const jitterState = resolveMonotonicArrivalState(initialState, {
      routeKey: "booking_1:started",
      remainingMinutes: 18,
      nowMs: 1000,
    });

    expect(jitterState.arrivalTimestampMs).toBe(initialState.arrivalTimestampMs);
    expect(resolveDisplayEtaMinutes(jitterState.arrivalTimestampMs, 1000)).toBe(17);
  });

  it("accepts a worse ETA when it persists instead of oscillating", () => {
    const initialState = resolveMonotonicArrivalState(null, {
      routeKey: "booking_1:started",
      remainingMinutes: 17,
      nowMs: 0,
    });
    const pendingState = resolveMonotonicArrivalState(initialState, {
      routeKey: "booking_1:started",
      remainingMinutes: 18,
      nowMs: 1000,
    });
    const persistedState = resolveMonotonicArrivalState(pendingState, {
      routeKey: "booking_1:started",
      remainingMinutes: 18,
      nowMs: 12000,
    });

    expect(persistedState.arrivalTimestampMs).toBeGreaterThan(
      initialState.arrivalTimestampMs,
    );
    expect(resolveDisplayEtaMinutes(persistedState.arrivalTimestampMs, 12000)).toBe(18);
  });

  it("resets the timing model when the route changes", () => {
    const initialState = resolveMonotonicArrivalState(null, {
      routeKey: "booking_1:started",
      remainingMinutes: 25,
      nowMs: 0,
    });
    const nextRouteState = resolveMonotonicArrivalState(initialState, {
      routeKey: "booking_2:started",
      remainingMinutes: 5,
      nowMs: 1000,
    });

    expect(nextRouteState.arrivalTimestampMs).toBe(301000);
  });
});

describe('passenger trip card at the end of the ride and on the way', () => {
  const {
    formatArrivalClockLabelFromTimestamp: formatClock,
    resolveDisplayEtaMinutes: displayEta,
    resolveDistanceProgressState: distanceProgress,
  } = require('../src/screens/prototype/liveRouteTiming');

  it('never reads "Chegada às 21:00" when the ETA reaches zero', () => {
    expect(formatClock(null)).toBe('Chegada prevista em instantes');
    expect(formatClock(undefined)).toBe('Chegada prevista em instantes');
    expect(formatClock(0)).toBe('Chegada prevista em instantes');
    expect(displayEta(null)).toBeNull();
  });

  it('moves the car by distance driven, with the longest remaining distance as the total', () => {
    let state = distanceProgress(null, { routeKey: 'b1', remainingKm: 12 });
    expect(state.progress).toBe(0);
    state = distanceProgress(state, { routeKey: 'b1', remainingKm: 9 });
    expect(state.progress).toBeCloseTo(0.25);
    state = distanceProgress(state, { routeKey: 'b1', remainingKm: 0.3 });
    expect(state.progress).toBeCloseTo(0.975);
    // A new ride starts over.
    state = distanceProgress(state, { routeKey: 'b2', remainingKm: 5 });
    expect(state.progress).toBe(0);
    expect(distanceProgress(state, { routeKey: 'b2', remainingKm: null }).progress).toBeNull();
  });
});
