/**
 * Prevents concurrent taps from running the same onboarding finalization twice.
 * Callers share the in-flight promise, so completion and retry behavior stay
 * consistent across the passenger and driver signup paths.
 */
export function createSingleFlightGate() {
  let inFlightPromise = null;

  return {
    run(operation) {
      if (inFlightPromise) {
        return inFlightPromise;
      }

      if (typeof operation !== 'function') {
        throw new TypeError('A submission operation is required when no work is in flight.');
      }

      const trackedPromise = Promise.resolve()
        .then(operation)
        .finally(() => {
          if (inFlightPromise === trackedPromise) {
            inFlightPromise = null;
          }
        });

      inFlightPromise = trackedPromise;
      return trackedPromise;
    },

    isRunning() {
      return inFlightPromise !== null;
    },
  };
}
