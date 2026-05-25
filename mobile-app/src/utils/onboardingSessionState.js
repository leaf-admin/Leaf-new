import AsyncStorage from '@react-native-async-storage/async-storage';
import Logger from './Logger';

const AUTH_UID_STORAGE_KEY = '@auth_uid';
const USER_DATA_STORAGE_KEY = '@user_data';
const ONBOARDING_DATA_STORAGE_KEY = '@onboarding_data';
const ONBOARDING_PROGRESS_STORAGE_KEY = '@onboarding_progress';
const ONBOARDING_CURRENT_STEP_STORAGE_KEY = '@onboarding_current_step';
const SECURE_PHONE_STEP_STORAGE_KEY = 'onboarding_phone_validation';

export const PHONE_VALIDATION_STEP = 'phone_validation';
export const PROFILE_SELECTION_STEP_INDEX = 2;

const safeJsonParse = (value, fallback = {}) => {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

export function sanitizeAuthUserForOnboarding(userOrProfile = {}) {
  const sourceUser = userOrProfile?.user || userOrProfile || {};
  const uid = String(sourceUser.uid || userOrProfile.uid || '').trim();
  const phoneNumber =
    sourceUser.phoneNumber ||
    userOrProfile.phoneNumber ||
    sourceUser.phone ||
    userOrProfile.phone ||
    sourceUser.mobile ||
    userOrProfile.mobile ||
    null;

  return {
    uid,
    phoneNumber,
    phone: phoneNumber,
    mobile: phoneNumber,
    email: sourceUser.email || userOrProfile.email || null,
    displayName: sourceUser.displayName || userOrProfile.displayName || null,
  };
}

export function buildIncompleteOnboardingProfile(userOrProfile = {}) {
  const sanitizedUser = sanitizeAuthUserForOnboarding(userOrProfile);

  return {
    uid: sanitizedUser.uid,
    email: sanitizedUser.email,
    phoneNumber: sanitizedUser.phoneNumber,
    phone: sanitizedUser.phone,
    mobile: sanitizedUser.mobile,
    profileIncomplete: true,
    onboardingPending: true,
  };
}

export async function persistPhoneValidatedOnboardingSession(userOrProfile = {}) {
  const sanitizedUser = sanitizeAuthUserForOnboarding(userOrProfile);
  if (!sanitizedUser.uid) {
    return null;
  }

  const now = new Date().toISOString();
  const phoneValidationData = {
    phoneNumber: sanitizedUser.phoneNumber,
    phoneValidated: true,
    isExistingUser: false,
    user: sanitizedUser,
    timestamp: now,
  };

  try {
    const entries = await AsyncStorage.multiGet([
      ONBOARDING_PROGRESS_STORAGE_KEY,
      ONBOARDING_DATA_STORAGE_KEY,
      SECURE_PHONE_STEP_STORAGE_KEY,
    ]);
    const storedProgress = safeJsonParse(entries?.[0]?.[1], {});
    const storedOnboardingData = safeJsonParse(entries?.[1]?.[1], {});
    const storedPhoneStepData = safeJsonParse(entries?.[2]?.[1], {});

    const nextProgress = {
      ...storedProgress,
      [PHONE_VALIDATION_STEP]: true,
    };
    const nextOnboardingData = {
      ...storedOnboardingData,
      [PHONE_VALIDATION_STEP]: {
        ...(storedOnboardingData?.[PHONE_VALIDATION_STEP] || {}),
        ...phoneValidationData,
      },
    };
    const nextPhoneStepData = {
      ...storedPhoneStepData,
      ...phoneValidationData,
    };

    await AsyncStorage.multiSet([
      [AUTH_UID_STORAGE_KEY, sanitizedUser.uid],
      [USER_DATA_STORAGE_KEY, JSON.stringify(buildIncompleteOnboardingProfile(sanitizedUser))],
      [ONBOARDING_PROGRESS_STORAGE_KEY, JSON.stringify(nextProgress)],
      [ONBOARDING_DATA_STORAGE_KEY, JSON.stringify(nextOnboardingData)],
      [ONBOARDING_CURRENT_STEP_STORAGE_KEY, JSON.stringify(PROFILE_SELECTION_STEP_INDEX)],
      [SECURE_PHONE_STEP_STORAGE_KEY, JSON.stringify(nextPhoneStepData)],
    ]);

    return phoneValidationData;
  } catch (error) {
    Logger.warn(
      '⚠️ Falha ao persistir sessão de onboarding pós-OTP:',
      error?.message || error
    );
    return phoneValidationData;
  }
}
