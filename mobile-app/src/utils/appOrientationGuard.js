import { AppState, Platform } from 'react-native';
import * as ScreenOrientation from 'expo-screen-orientation';
import Logger from './Logger';

const PORTRAIT_LOCK_WARNING =
  '⚠️ [App] Não foi possível travar orientação portrait:';

function warnWithoutBlocking(logger, error) {
  try {
    logger?.warn?.(PORTRAIT_LOCK_WARNING, error?.message || error);
  } catch (_loggerError) {
    // Orientation recovery is best-effort and must never block the UI.
  }
}

export async function lockPortraitOrientation({
  platform = Platform.OS,
  screenOrientation = ScreenOrientation,
  logger = Logger,
} = {}) {
  if (platform === 'web') {
    return false;
  }

  try {
    if (
      typeof screenOrientation?.lockAsync !== 'function' ||
      screenOrientation?.OrientationLock?.PORTRAIT_UP === undefined
    ) {
      return false;
    }

    await screenOrientation.lockAsync(
      screenOrientation.OrientationLock.PORTRAIT_UP
    );
    return true;
  } catch (error) {
    warnWithoutBlocking(logger, error);
    return false;
  }
}

export function registerPortraitOrientationGuard({
  appState = AppState,
  platform = Platform.OS,
  screenOrientation = ScreenOrientation,
  logger = Logger,
} = {}) {
  const applyPortraitLock = () => {
    void lockPortraitOrientation({ platform, screenOrientation, logger });
  };

  applyPortraitLock();

  if (
    platform === 'web' ||
    typeof appState?.addEventListener !== 'function'
  ) {
    return () => {};
  }

  let subscription;
  try {
    subscription = appState.addEventListener('change', nextAppState => {
      if (nextAppState === 'active') {
        applyPortraitLock();
      }
    });
  } catch (error) {
    warnWithoutBlocking(logger, error);
    return () => {};
  }

  return () => {
    try {
      subscription?.remove?.();
    } catch (error) {
      warnWithoutBlocking(logger, error);
    }
  };
}

