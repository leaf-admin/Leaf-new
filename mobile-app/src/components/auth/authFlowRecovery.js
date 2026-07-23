export function normalizeAuthFlowUserType(userType) {
  if (userType === 'passenger') {
    return 'customer';
  }
  if (userType === 'customer' || userType === 'driver') {
    return userType;
  }
  return null;
}

const AUTH_FLOW_STEP_FIELD = {
  phone_validation: 'phoneValidation',
  profile_selection: 'profileSelection',
  profile_data: 'profileData',
  document_data: 'documentData',
  credentials: 'credentials',
  driver_contact: 'driverContactData',
};

export function unwrapAuthFlowStepData(stepName, data) {
  if (!data || typeof data !== 'object') {
    return data;
  }

  const fieldName = AUTH_FLOW_STEP_FIELD[stepName];
  const wrappedData = fieldName ? data[fieldName] : null;
  return wrappedData && typeof wrappedData === 'object' ? wrappedData : data;
}

export function hasRequiredDriverConsents(credentials = {}) {
  const normalizedCredentials =
    credentials?.credentials && typeof credentials.credentials === 'object'
      ? credentials.credentials
      : credentials;

  return (
    normalizedCredentials?.acceptTerms === true &&
    normalizedCredentials?.acceptPrivacy === true &&
    normalizedCredentials?.consentBackgroundCheck === true
  );
}

export function isProfileIdentityConsistent({
  profile = null,
  firebaseUser = null,
  storedUid = null,
} = {}) {
  const profileUid = String(profile?.uid || '').trim();
  const firebaseUid = String(firebaseUser?.uid || '').trim();
  const persistedUid = String(storedUid || '').trim();

  if (!profileUid || !firebaseUid || profileUid !== firebaseUid) {
    return false;
  }
  if (persistedUid && persistedUid !== firebaseUid) {
    return false;
  }

  const normalizePhoneDigits = value => String(value || '').replace(/\D/g, '');
  const firebasePhone = normalizePhoneDigits(firebaseUser?.phoneNumber);
  const profilePhone = normalizePhoneDigits(
    profile?.phoneNumber ||
      profile?.phone ||
      profile?.mobile ||
      profile?.profile?.phoneNumber ||
      profile?.profile?.phone ||
      profile?.profile?.mobile,
  );

  return !firebasePhone || !profilePhone || firebasePhone === profilePhone;
}

export function isPersistedProfileOnboardingComplete(profile = {}) {
  const userType = normalizeAuthFlowUserType(
    profile?.usertype || profile?.userType || profile?.profile?.usertype || profile?.profile?.userType,
  );

  if (!profile?.usertype && !profile?.userType && !profile?.profile?.usertype && !profile?.profile?.userType) {
    return false;
  }

  if (
    profile?.profileIncomplete === true ||
    profile?.onboardingPending === true ||
    profile?.profileComplete === false ||
    profile?.onboardingCompleted === false
  ) {
    return false;
  }

  if (userType !== 'driver' || Number(profile?.onboardingVersion || 0) < 2) {
    return true;
  }

  return (
    profile?.onboardingCompleted === true &&
    profile?.profileComplete === true &&
    hasRequiredDriverConsents(profile)
  );
}

export function splitAuthFlowFullName(fullName) {
  const clean = String(fullName || '').trim();
  if (!clean) {
    return {
      firstName: '',
      lastName: '',
    };
  }

  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return {
      firstName: parts[0],
      lastName: '',
    };
  }

  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' '),
  };
}

export function normalizeAuthFlowProfileData(profileData = {}) {
  const fullNameCandidate =
    profileData.fullName ||
    [profileData.firstName, profileData.lastName].filter(Boolean).join(' ').trim();
  const { firstName, lastName } = splitAuthFlowFullName(fullNameCandidate);

  return {
    fullName: fullNameCandidate || '',
    firstName,
    lastName,
  };
}

export function buildSerializableConfirmationMeta(confirmation) {
  if (!confirmation || typeof confirmation !== 'object') {
    return null;
  }

  return {
    verificationId: String(confirmation.verificationId || '').trim() || null,
    isCustomOtp: confirmation.isCustomOtp === true,
    isReviewAccount: confirmation.isReviewAccount === true,
    isTestOtpBypass: confirmation.isTestOtpBypass === true,
    isTestNumber: confirmation.isTestNumber === true,
    source: confirmation.isCustomOtp ? 'custom_otp' : 'firebase_phone_auth',
  };
}

export function resolveAuthFlowInitialStep(
  completedSteps = [],
  fallbackStep = 0,
  userType = null,
  credentialsData = null,
) {
  const normalizedType = normalizeAuthFlowUserType(userType);
  const driverConsentsComplete =
    normalizedType !== 'driver' || hasRequiredDriverConsents(credentialsData || {});

  if (completedSteps.includes('driver_contact')) {
    return driverConsentsComplete ? 6 : 5;
  }

  if (completedSteps.includes('credentials')) {
    if (normalizedType === 'driver') {
      return driverConsentsComplete ? 6 : 5;
    }
    return 5;
  }

  if (completedSteps.includes('document_data')) {
    return 4;
  }

  if (completedSteps.includes('profile_data')) {
    return 4;
  }

  if (completedSteps.includes('profile_selection')) {
    if (normalizedType === 'driver') {
      return 4;
    }
    return 3;
  }

  if (completedSteps.includes('phone_validation')) {
    return 2;
  }

  return fallbackStep;
}

export function buildRestoredAuthFlowData({
  completedSteps = [],
  phoneData = null,
  profileSelectionData = null,
  profileData = null,
  documentData = null,
  credentialsData = null,
  driverContactData = null,
} = {}) {
  const savedData = {};
  const normalizedPhoneData = unwrapAuthFlowStepData('phone_validation', phoneData);
  const normalizedProfileSelectionData = unwrapAuthFlowStepData(
    'profile_selection',
    profileSelectionData,
  );
  const normalizedProfileData = unwrapAuthFlowStepData('profile_data', profileData);
  const normalizedDocumentData = unwrapAuthFlowStepData('document_data', documentData);
  const normalizedCredentialsData = unwrapAuthFlowStepData('credentials', credentialsData);
  const normalizedDriverContactData = unwrapAuthFlowStepData(
    'driver_contact',
    driverContactData,
  );

  if (completedSteps.includes('phone_validation') && normalizedPhoneData) {
    if (normalizedPhoneData.phoneNumber) {
      savedData.phoneNumber = normalizedPhoneData.phoneNumber;
    }
    if (normalizedPhoneData.confirmation) {
      savedData.confirmation = normalizedPhoneData.confirmation;
    }
    if (Object.prototype.hasOwnProperty.call(normalizedPhoneData, 'isExistingUser')) {
      savedData.isExistingUser = Boolean(normalizedPhoneData.isExistingUser);
    }
  }

  if (completedSteps.includes('profile_selection') && normalizedProfileSelectionData?.userType) {
    savedData.profileSelection = {
      userType: normalizeAuthFlowUserType(normalizedProfileSelectionData.userType),
      timestamp: normalizedProfileSelectionData.timestamp,
    };
  }

  if (completedSteps.includes('profile_data') && normalizedProfileData) {
    const normalizedProfile = normalizeAuthFlowProfileData(normalizedProfileData);
    if (
      normalizedProfile.firstName ||
      normalizedProfile.lastName ||
      normalizedProfile.fullName
    ) {
      savedData.profileData = normalizedProfile;
    }
  }

  if (
    completedSteps.includes('document_data') &&
    normalizedDocumentData &&
    (
      normalizedDocumentData.cpf ||
      normalizedDocumentData.email ||
      normalizedDocumentData.city ||
      normalizedDocumentData.cnhExtraction ||
      normalizedDocumentData.vehicleExtraction
    )
  ) {
    savedData.documentData = {
      cpf: normalizedDocumentData.cpf || '',
      email: normalizedDocumentData.email || '',
      city: normalizedDocumentData.city || '',
      ...(normalizedDocumentData.birthDate ? { birthDate: normalizedDocumentData.birthDate } : {}),
      ...(normalizedDocumentData.motherName || normalizedDocumentData.nomeMae
        ? { motherName: normalizedDocumentData.motherName || normalizedDocumentData.nomeMae }
        : {}),
      ...(normalizedDocumentData.gender || normalizedDocumentData.genero
        ? { gender: normalizedDocumentData.gender || normalizedDocumentData.genero }
        : {}),
      cnhExtraction: normalizedDocumentData.cnhExtraction || null,
      vehicleExtraction: normalizedDocumentData.vehicleExtraction || null,
      cnhPdfMeta: normalizedDocumentData.cnhPdfMeta || null,
      vehiclePdfMeta: normalizedDocumentData.vehiclePdfMeta || null,
    };
  }

  if (completedSteps.includes('credentials') && normalizedCredentialsData) {
    const normalizedCredentials =
      normalizedCredentialsData?.credentials && typeof normalizedCredentialsData.credentials === 'object'
        ? normalizedCredentialsData.credentials
        : normalizedCredentialsData;

    savedData.credentials = {
      acceptTerms: normalizedCredentials?.acceptTerms === true,
      acceptPrivacy: normalizedCredentials?.acceptPrivacy === true,
      consentBackgroundCheck: normalizedCredentials?.consentBackgroundCheck === true,
      marketingOptIn: normalizedCredentials?.marketingOptIn === true,
    };
  }

  if (completedSteps.includes('driver_contact') && normalizedDriverContactData?.email) {
    savedData.driverContactData = {
      email: normalizedDriverContactData.email,
    };
    savedData.documentData = {
      ...(savedData.documentData || {}),
      email: normalizedDriverContactData.email,
    };
  }

  return savedData;
}
