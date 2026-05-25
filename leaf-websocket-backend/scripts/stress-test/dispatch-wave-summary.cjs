function incrementCounterBy(target, key, value = 1) {
  const normalizedKey = String(key || '').trim();
  if (!normalizedKey) return;
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue === 0) return;
  target[normalizedKey] = (target[normalizedKey] || 0) + numericValue;
}

function deriveDispatchWaveSummaryFromTrace(rawEvents = []) {
  const events = rawEvents
    .map((entry) => {
      try {
        return JSON.parse(entry);
      } catch (_error) {
        return null;
      }
    })
    .filter(Boolean);

  if (!events.length) {
    return null;
  }

  const waveEvents = events.filter((event) => event.type === 'wave');
  const directEvents = events.filter((event) => event.type === 'direct');
  const acceptedEvent = [...events].reverse().find((event) => event.type === 'accepted') || null;
  const lastEvent = events[events.length - 1] || null;

  const waveCandidates = waveEvents.reduce((acc, event) => acc + (Number(event.candidateCount) || 0), 0);
  const waveNotified = waveEvents.reduce((acc, event) => acc + (Number(event.notifiedCount) || 0), 0);
  const waveFailed = waveEvents.reduce((acc, event) => acc + (Number(event.failedCount) || 0), 0);
  const failureReasonCounts = waveEvents.reduce((acc, event) => {
    const reasons = event?.failureReasons;
    if (!reasons || typeof reasons !== 'object') {
      return acc;
    }
    Object.entries(reasons).forEach(([key, value]) => {
      incrementCounterBy(acc, key, value);
    });
    return acc;
  }, {});

  const acceptedWave = Number(acceptedEvent?.waveNumber);
  const acceptedRadiusKm = Number(acceptedEvent?.radiusKm);
  const acceptedWaveCount = Number(acceptedEvent?.waveCount);
  const acceptedTotalCandidates = Number(acceptedEvent?.totalCandidates);
  const acceptedTotalNotified = Number(acceptedEvent?.totalNotified);
  const acceptedTotalFailed = Number(acceptedEvent?.totalFailed);
  const directCount = directEvents.length;
  const hasWaveEvents = waveEvents.length > 0;

  return {
    acceptedWave: Number.isFinite(acceptedWave) ? acceptedWave : 0,
    acceptedRadiusKm: Number.isFinite(acceptedRadiusKm) ? acceptedRadiusKm : 0,
    waveCount: hasWaveEvents
      ? waveEvents.length
      : (Number.isFinite(acceptedWaveCount) ? acceptedWaveCount : (Number.isFinite(acceptedWave) ? acceptedWave : 0)),
    totalCandidates: hasWaveEvents
      ? waveCandidates
      : (Number.isFinite(acceptedTotalCandidates) ? acceptedTotalCandidates : 0),
    totalNotified: hasWaveEvents
      ? waveNotified
      : (Number.isFinite(acceptedTotalNotified) ? acceptedTotalNotified : 0),
    totalFailed: hasWaveEvents
      ? waveFailed
      : (Number.isFinite(acceptedTotalFailed) ? acceptedTotalFailed : 0),
    failureReasonCounts,
    directCount,
    acceptedSource: String(
      acceptedEvent?.source
      || lastEvent?.source
      || ''
    ).trim() || 'unknown',
    acceptedType: String(
      acceptedEvent?.dispatchType
      || lastEvent?.type
      || ''
    ).trim() || 'unknown'
  };
}

module.exports = {
  deriveDispatchWaveSummaryFromTrace
};
