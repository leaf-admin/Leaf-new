import { useEffect, useRef } from 'react';
import { useHapticFeedback } from './useHapticFeedback';

// One tactile cue per ride step, so the phone confirms the change without the
// user reading the screen: a new offer, the match, the arrival, the start.
// Fires only on a change of step; the first value seen (app opened mid-ride)
// stays silent.
export default function useRideStepHaptics(stepKey, hapticByStep = {}) {
  const triggerHaptic = useHapticFeedback();
  const previousStepRef = useRef(stepKey);

  useEffect(() => {
    if (previousStepRef.current === stepKey) {
      return;
    }
    previousStepRef.current = stepKey;
    const preset = hapticByStep[stepKey];
    if (preset) {
      triggerHaptic(preset);
    }
    // hapticByStep is a static map per call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepKey, triggerHaptic]);
}
