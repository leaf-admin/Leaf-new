export function normalizeAuthFlowUserType(userType) {
  if (userType === 'passenger') {
    return 'customer';
  }
  return userType === 'driver' ? 'driver' : 'customer';
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

export function resolveAuthFlowInitialStep(
  completedSteps = [],
  fallbackStep = 0,
  userType = null,
) {
  const normalizedType = normalizeAuthFlowUserType(userType);

  if (completedSteps.includes('driver_contact')) {
    return 6;
  }

  if (completedSteps.includes('credentials')) {
    if (normalizedType === 'driver') {
      return 6;
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
  driverContactData = null,
} = {}) {
  const savedData = {};

  if (completedSteps.includes('phone_validation') && phoneData) {
    if (phoneData.phoneNumber) {
      savedData.phoneNumber = phoneData.phoneNumber;
    }
    if (phoneData.confirmation) {
      savedData.confirmation = phoneData.confirmation;
    }
    if (Object.prototype.hasOwnProperty.call(phoneData, 'isExistingUser')) {
      savedData.isExistingUser = Boolean(phoneData.isExistingUser);
    }
  }

  if (completedSteps.includes('profile_selection') && profileSelectionData?.userType) {
    savedData.profileSelection = {
      userType: normalizeAuthFlowUserType(profileSelectionData.userType),
      timestamp: profileSelectionData.timestamp,
    };
  }

  if (completedSteps.includes('profile_data') && profileData) {
    const normalizedProfile = normalizeAuthFlowProfileData(profileData);
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
    documentData &&
    (
      documentData.cpf ||
      documentData.email ||
      documentData.city ||
      documentData.cnhExtraction ||
      documentData.vehicleExtraction
    )
  ) {
    savedData.documentData = {
      cpf: documentData.cpf || '',
      email: documentData.email || '',
      city: documentData.city || '',
      cnhExtraction: documentData.cnhExtraction || null,
      vehicleExtraction: documentData.vehicleExtraction || null,
      cnhPdfMeta: documentData.cnhPdfMeta || null,
      vehiclePdfMeta: documentData.vehiclePdfMeta || null,
    };
  }

  if (completedSteps.includes('driver_contact') && driverContactData?.email) {
    savedData.driverContactData = {
      email: driverContactData.email,
    };
    savedData.documentData = {
      ...(savedData.documentData || {}),
      email: driverContactData.email,
    };
  }

  return savedData;
}
