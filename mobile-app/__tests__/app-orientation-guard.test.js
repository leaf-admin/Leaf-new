import {
  lockPortraitOrientation,
  registerPortraitOrientationGuard,
} from '../src/utils/appOrientationGuard';

function createHarness() {
  let appStateListener;
  const remove = jest.fn();
  const appState = {
    addEventListener: jest.fn((_eventName, listener) => {
      appStateListener = listener;
      return { remove };
    }),
  };
  const screenOrientation = {
    OrientationLock: { PORTRAIT_UP: 'PORTRAIT_UP' },
    lockAsync: jest.fn().mockResolvedValue(undefined),
  };
  const logger = { warn: jest.fn() };

  return {
    appState,
    getAppStateListener: () => appStateListener,
    logger,
    remove,
    screenOrientation,
  };
}

describe('appOrientationGuard', () => {
  it('locks portrait immediately and registers the AppState listener', () => {
    const harness = createHarness();

    registerPortraitOrientationGuard({
      appState: harness.appState,
      platform: 'android',
      screenOrientation: harness.screenOrientation,
      logger: harness.logger,
    });

    expect(harness.screenOrientation.lockAsync).toHaveBeenCalledTimes(1);
    expect(harness.screenOrientation.lockAsync).toHaveBeenCalledWith('PORTRAIT_UP');
    expect(harness.appState.addEventListener).toHaveBeenCalledWith(
      'change',
      expect.any(Function)
    );
  });

  it('reapplies the portrait lock whenever the app becomes active', () => {
    const harness = createHarness();
    registerPortraitOrientationGuard({
      appState: harness.appState,
      platform: 'ios',
      screenOrientation: harness.screenOrientation,
      logger: harness.logger,
    });

    harness.getAppStateListener()('active');

    expect(harness.screenOrientation.lockAsync).toHaveBeenCalledTimes(2);
  });

  it('ignores background and inactive transitions', () => {
    const harness = createHarness();
    registerPortraitOrientationGuard({
      appState: harness.appState,
      platform: 'android',
      screenOrientation: harness.screenOrientation,
      logger: harness.logger,
    });

    harness.getAppStateListener()('background');
    harness.getAppStateListener()('inactive');

    expect(harness.screenOrientation.lockAsync).toHaveBeenCalledTimes(1);
  });

  it('removes the AppState listener during cleanup', () => {
    const harness = createHarness();
    const cleanup = registerPortraitOrientationGuard({
      appState: harness.appState,
      platform: 'android',
      screenOrientation: harness.screenOrientation,
      logger: harness.logger,
    });

    cleanup();

    expect(harness.remove).toHaveBeenCalledTimes(1);
  });

  it('absorbs orientation failures so startup and resume remain non-blocking', async () => {
    const harness = createHarness();
    harness.screenOrientation.lockAsync.mockRejectedValue(
      new Error('native orientation unavailable')
    );

    await expect(
      lockPortraitOrientation({
        platform: 'android',
        screenOrientation: harness.screenOrientation,
        logger: harness.logger,
      })
    ).resolves.toBe(false);

    expect(harness.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('orientação portrait'),
      'native orientation unavailable'
    );
  });
});
