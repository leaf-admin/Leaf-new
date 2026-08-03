import { store } from '../src/state/appStore';
import {
  loadOnboardingFromStorage,
  resetOnboarding,
} from '../src/state/onboarding/onboardingActions';

describe('active app store onboarding reducer', () => {
  afterEach(() => {
    store.dispatch(resetOnboarding());
  });

  it('hydrates onboarding state instead of forcing Splash to time out', () => {
    expect(Object.keys(store.getState()).sort()).toEqual([
      'auth',
      'cartypes',
      'languagedata',
      'onboarding',
      'settingsdata',
    ]);

    store.dispatch(loadOnboardingFromStorage({
      currentStep: 5,
      completedSteps: ['phone_validation', 'profile_selection'],
      stepData: { profile_selection: { userType: 'driver' } },
      progress: { phone_validation: true, profile_selection: true },
    }));

    expect(store.getState().onboarding).toEqual(expect.objectContaining({
      currentStep: 5,
      completedSteps: ['phone_validation', 'profile_selection'],
      isLoaded: true,
    }));
  });
});
