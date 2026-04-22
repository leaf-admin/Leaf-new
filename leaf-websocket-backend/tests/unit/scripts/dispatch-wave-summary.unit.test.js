const { deriveDispatchWaveSummaryFromTrace } = require('../../../scripts/stress-test/dispatch-wave-summary.cjs');

describe('deriveDispatchWaveSummaryFromTrace', () => {
  it('falls back to accepted event counters when wave events are missing', () => {
    const summary = deriveDispatchWaveSummaryFromTrace([
      JSON.stringify({
        type: 'accepted',
        source: 'gradual_expander',
        dispatchType: 'wave',
        waveNumber: 2,
        radiusKm: 2,
        waveCount: 2,
        totalCandidates: 13,
        totalNotified: 13,
        totalFailed: 0
      })
    ]);

    expect(summary).toEqual(
      expect.objectContaining({
        acceptedWave: 2,
        acceptedRadiusKm: 2,
        waveCount: 2,
        totalCandidates: 13,
        totalNotified: 13,
        totalFailed: 0,
        acceptedSource: 'gradual_expander',
        acceptedType: 'wave'
      })
    );
  });

  it('prefers explicit wave events when they exist', () => {
    const summary = deriveDispatchWaveSummaryFromTrace([
      JSON.stringify({
        type: 'wave',
        source: 'gradual_expander',
        candidateCount: 7,
        notifiedCount: 5,
        failedCount: 1,
        failureReasons: {
          stale_driver: 1
        }
      }),
      JSON.stringify({
        type: 'accepted',
        source: 'gradual_expander',
        dispatchType: 'wave',
        waveNumber: 1,
        radiusKm: 1,
        waveCount: 1,
        totalCandidates: 99,
        totalNotified: 99,
        totalFailed: 0
      })
    ]);

    expect(summary).toEqual(
      expect.objectContaining({
        acceptedWave: 1,
        acceptedRadiusKm: 1,
        waveCount: 1,
        totalCandidates: 7,
        totalNotified: 5,
        totalFailed: 1,
        acceptedSource: 'gradual_expander',
        acceptedType: 'wave',
        failureReasonCounts: {
          stale_driver: 1
        }
      })
    );
  });
});
