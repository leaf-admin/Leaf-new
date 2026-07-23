import AsyncStorage from '@react-native-async-storage/async-storage';
import Logger from './Logger';

const AUTH_UID_STORAGE_KEY = '@auth_uid';
const USER_DATA_STORAGE_KEY = '@user_data';
const ONBOARDING_DATA_STORAGE_KEY = '@onboarding_data';
const ONBOARDING_PROGRESS_STORAGE_KEY = '@onboarding_progress';
const ONBOARDING_CURRENT_STEP_STORAGE_KEY = '@onboarding_current_step';
const SECURE_PHONE_STEP_STORAGE_KEY = 'onboarding_phone_validation';
export const ONBOARDING_OWNER_UID_STORAGE_KEY = '@onboarding_owner_uid';

export const ONBOARDING_SESSION_STORAGE_KEYS = [
  ONBOARDING_OWNER_UID_STORAGE_KEY,
  ONBOARDING_DATA_STORAGE_KEY,
  ONBOARDING_PROGRESS_STORAGE_KEY,
  ONBOARDING_CURRENT_STEP_STORAGE_KEY,
  '@onboarding_encrypted_data',
  'onboarding_phone_validation',
  'onboarding_profile_selection',
  'onboarding_profile_data',
  'onboarding_document_data',
  'onboarding_credentials',
  'onboarding_driver_contact',
];

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

const normalizeUid = value => String(value || '').trim();

const resolvePhoneStepOwnerUid = storedPhoneStepData => {
  const normalizedPhoneStep =
    storedPhoneStepData?.phoneValidation && typeof storedPhoneStepData.phoneValidation === 'object'
      ? storedPhoneStepData.phoneValidation
      : storedPhoneStepData;

  return normalizeUid(
    normalizedPhoneStep?.user?.uid ||
      normalizedPhoneStep?.uid ||
      normalizedPhoneStep?.profile?.uid,
  );
};

export async function validateOnboardingStorageOwner({
  adoptTrustedLegacy = true,
  activeAuthUid = null,
} = {}) {
  const entries = await AsyncStorage.multiGet([
    AUTH_UID_STORAGE_KEY,
    ONBOARDING_OWNER_UID_STORAGE_KEY,
    SECURE_PHONE_STEP_STORAGE_KEY,
  ]);
  const authUid = normalizeUid(entries?.[0]?.[1]);
  const ownerUid = normalizeUid(entries?.[1]?.[1]);
  const nativeAuthUid = normalizeUid(activeAuthUid);
  const phoneStepOwnerUid = resolvePhoneStepOwnerUid(
    safeJsonParse(entries?.[2]?.[1], {}),
  );

  if (nativeAuthUid && nativeAuthUid !== authUid) {
    return {
      valid: false,
      activeAuthUid: nativeAuthUid,
      authUid: authUid || null,
      ownerUid: ownerUid || null,
      reason: authUid ? 'ACTIVE_AUTH_UID_MISMATCH' : 'AUTH_UID_MISSING_FOR_ACTIVE_SESSION',
    };
  }

  if (!authUid) {
    return {
      valid: !ownerUid,
      authUid: null,
      ownerUid: ownerUid || null,
      reason: ownerUid ? 'AUTH_UID_MISSING' : 'PRE_AUTH_DRAFT',
    };
  }

  if (ownerUid) {
    return {
      valid: ownerUid === authUid,
      authUid,
      ownerUid,
      reason: ownerUid === authUid ? 'OWNER_MATCH' : 'OWNER_UID_MISMATCH',
    };
  }

  if (adoptTrustedLegacy && phoneStepOwnerUid && phoneStepOwnerUid === authUid) {
    await AsyncStorage.setItem(ONBOARDING_OWNER_UID_STORAGE_KEY, authUid);
    return {
      valid: true,
      authUid,
      ownerUid: authUid,
      reason: 'TRUSTED_LEGACY_ADOPTED',
    };
  }

  return {
    valid: false,
    authUid,
    ownerUid: null,
    reason: phoneStepOwnerUid ? 'LEGACY_UID_MISMATCH' : 'OWNER_UID_MISSING',
  };
}

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
      AUTH_UID_STORAGE_KEY,
      ONBOARDING_OWNER_UID_STORAGE_KEY,
      ONBOARDING_PROGRESS_STORAGE_KEY,
      ONBOARDING_DATA_STORAGE_KEY,
      SECURE_PHONE_STEP_STORAGE_KEY,
    ]);
    const storedAuthUid = normalizeUid(entries?.[0]?.[1]);
    const storedOwnerUid = normalizeUid(entries?.[1]?.[1]);
    const storedProgress = safeJsonParse(entries?.[2]?.[1], {});
    const storedOnboardingData = safeJsonParse(entries?.[3]?.[1], {});
    const storedPhoneStepData = safeJsonParse(entries?.[4]?.[1], {});
    const storedPhoneStepOwnerUid = resolvePhoneStepOwnerUid(storedPhoneStepData);
    const identityCandidates = [
      storedAuthUid,
      storedOwnerUid,
      storedPhoneStepOwnerUid,
    ].filter(Boolean);
    const hasDifferentOwner = identityCandidates.some(uid => uid !== sanitizedUser.uid);

    if (hasDifferentOwner) {
      await AsyncStorage.multiRemove(ONBOARDING_SESSION_STORAGE_KEYS);
    }

    const nextProgress = {
      ...(hasDifferentOwner ? {} : storedProgress),
      [PHONE_VALIDATION_STEP]: true,
    };
    const nextOnboardingData = {
      ...(hasDifferentOwner ? {} : storedOnboardingData),
      [PHONE_VALIDATION_STEP]: {
        ...(hasDifferentOwner ? {} : storedOnboardingData?.[PHONE_VALIDATION_STEP] || {}),
        ...phoneValidationData,
      },
    };
    const nextPhoneStepData = {
      ...(hasDifferentOwner ? {} : storedPhoneStepData),
      ...phoneValidationData,
    };

    await AsyncStorage.multiSet([
      [AUTH_UID_STORAGE_KEY, sanitizedUser.uid],
      [ONBOARDING_OWNER_UID_STORAGE_KEY, sanitizedUser.uid],
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
