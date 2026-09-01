import { useCallback } from 'react';
import * as Haptics from 'expo-haptics';

const triggers = {
  tap: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
  medium: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
  heavy: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy),
  success: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  warning: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning),
  error: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
};

export function useHapticFeedback() {
  return useCallback(preset => {
    const trigger = triggers[preset];
    if (typeof trigger !== 'function') {
      return;
    }
    try {
      Promise.resolve(trigger()).catch(() => {});
    } catch {
      // Haptics unavailable (emulator/unsupported device) — silently ignore.
    }
  }, []);
}

export default useHapticFeedback;
