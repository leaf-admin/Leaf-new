import {
  DRIVER_ONBOARDING_STAGE_KEYS,
  computeDriverOnboardingState,
  createInitialDriverOnboardingState,
} from '../services/DriverOnboardingService';

const QA_DRIVER_UID = '8vg2kxxqi3TYKlpD6eBlWgYseIq2';
const QA_PASSENGER_UID = 'OjML1wSzdNRaynjqMRlSW1Y0LVy2';

const normalizeUserType = (value) => {
  if (value === 'passenger') {
    return 'customer';
  }
  if (value === 'motorista' || value === 'partner' || value === 'parceiro') {
    return 'driver';
  }
  return value === 'driver' ? 'driver' : value === 'customer' ? 'customer' : null;
};

const buildBaseProfile = ({ uid, role, phone, email, name, firstName, lastName }) => {
  const normalizedRole = normalizeUserType(role) || 'customer';

  return {
    uid,
    id: uid,
    phone,
    phoneNumber: phone,
    mobile: phone,
    email,
    name,
    firstName,
    lastName,
    usertype: normalizedRole,
    userType: normalizedRole,
    role: normalizedRole,
    approved: true,
    isApproved: true,
    canGoOnline: normalizedRole === 'driver',
    isTestUser: true,
    profileImage: null,
    profile_image: '',
    walletBalance: 0,
  };
};

const buildApprovedQaDriverActivation = (seed = null) => {
  if (seed && typeof seed === 'object') {
    const normalizedSeed = computeDriverOnboardingState(seed);
    if (normalizedSeed.canGoOnline) {
      return normalizedSeed;
    }
  }

  const timestamp = new Date().toISOString();
  const base = createInitialDriverOnboardingState();

  return computeDriverOnboardingState({
    ...base,
    driverProfileStatus: 'approved',
    vehicleProfileStatus: 'approved',
    stages: {
      ...base.stages,
      [DRIVER_ONBOARDING_STAGE_KEYS.DRIVER_DATA]: {
        ...base.stages[DRIVER_ONBOARDING_STAGE_KEYS.DRIVER_DATA],
        status: 'approved',
        completedAt: timestamp,
        updatedAt: timestamp,
        checklist: {
          ...base.stages[DRIVER_ONBOARDING_STAGE_KEYS.DRIVER_DATA].checklist,
          cnhEar: true,
          vehicleRegistration: true,
          inssOrMei: true,
          backgroundCheckConsent: true,
        },
      },
      [DRIVER_ONBOARDING_STAGE_KEYS.FACE_VALIDATION]: {
        ...base.stages[DRIVER_ONBOARDING_STAGE_KEYS.FACE_VALIDATION],
        status: 'approved',
        completedAt: timestamp,
        updatedAt: timestamp,
        checklist: {
          ...base.stages[DRIVER_ONBOARDING_STAGE_KEYS.FACE_VALIDATION].checklist,
          facialValidation: true,
        },
      },
      [DRIVER_ONBOARDING_STAGE_KEYS.VEHICLE_DATA]: {
        ...base.stages[DRIVER_ONBOARDING_STAGE_KEYS.VEHICLE_DATA],
        status: 'approved',
        completedAt: timestamp,
        updatedAt: timestamp,
        checklist: {
          ...base.stages[DRIVER_ONBOARDING_STAGE_KEYS.VEHICLE_DATA].checklist,
          crlv: true,
        },
      },
    },
    notifications: [
      {
        id: 'seed-driver-activation-approved',
        title: 'Ativação aprovada',
        message: 'Motorista liberado para ficar online.',
        kind: 'driver',
        scope: 'driver',
        read: false,
        createdAt: timestamp,
      },
    ],
    updatedAt: timestamp,
  });
};

export const buildQaSeedProfile = ({ uid, driverActivation = null }) => {
  const normalizedUid = String(uid || '').trim();
  if (!normalizedUid) {
    return null;
  }

  if (normalizedUid === QA_DRIVER_UID) {
    const resolvedDriverActivation = buildApprovedQaDriverActivation(driverActivation);
    const baseProfile = buildBaseProfile({
      uid: normalizedUid,
      role: 'driver',
      phone: '+5511888888888',
      email: 'motorista.teste@leafapp.com',
      name: 'Motorista',
      firstName: 'Leaf',
      lastName: 'Motorista Teste',
    });

    return {
      ...baseProfile,
      vehicleId: 'test_vehicle_8vg2kxxqi3TY',
      userVehicleId: 'uv_test_vehicle_8vg2kxxqi3TY',
      carPlate: 'TES8888',
      carModel: 'Tesla Model 3',
      carType: 'standard',
      driverActivation: resolvedDriverActivation,
      profile: {
        ...baseProfile,
        canGoOnline: true,
        vehicleId: 'test_vehicle_8vg2kxxqi3TY',
        userVehicleId: 'uv_test_vehicle_8vg2kxxqi3TY',
        carPlate: 'TES8888',
        carModel: 'Tesla Model 3',
        carType: 'standard',
        driverActivation: resolvedDriverActivation,
      },
    };
  }

  if (normalizedUid === QA_PASSENGER_UID) {
    const baseProfile = buildBaseProfile({
      uid: normalizedUid,
      role: 'customer',
      phone: '+5511999999999',
      email: 'passageiro.teste@leafapp.com',
      name: 'Leaf Passageiro Teste',
      firstName: 'Leaf',
      lastName: 'Passageiro Teste',
    });

    return {
      ...baseProfile,
      canGoOnline: true,
      profile: {
        ...baseProfile,
        canGoOnline: true,
      },
    };
  }

  return null;
};

export const restoreQaSeedProfile = async ({
  AsyncStorage,
  authUidKey,
  userDataKey,
  testModeKey = '@test_mode',
  driverActivationKey = null,
}) => {
  if (!AsyncStorage || !authUidKey || !userDataKey) {
    return null;
  }

  const keys = [authUidKey, userDataKey, testModeKey];
  if (driverActivationKey) {
    keys.push(driverActivationKey);
  }

  const entries = await AsyncStorage.multiGet(keys);
  const values = Object.fromEntries(entries);
  const testModeEnabled = String(values[testModeKey] || '').trim() === 'true';
  if (!testModeEnabled) {
    return null;
  }

  const authUid = String(values[authUidKey] || '').trim();
  if (!authUid) {
    return null;
  }

  let storedUserData = null;
  if (values[userDataKey]) {
    try {
      const parsed = JSON.parse(values[userDataKey]);
      if (parsed && typeof parsed === 'object' && String(parsed.uid || parsed.id || '').trim() === authUid) {
        storedUserData = {
          ...parsed,
          uid: authUid,
          id: String(parsed.id || authUid).trim() || authUid,
          profile:
            parsed.profile && typeof parsed.profile === 'object'
              ? {
                  ...parsed.profile,
                  uid: authUid,
                  id: String(parsed.profile.id || parsed.id || authUid).trim() || authUid,
                }
              : undefined,
        };
      }
    } catch (_error) {
      storedUserData = null;
    }
  }

  const rawDriverActivation = driverActivationKey ? values[driverActivationKey] : null;
  let driverActivation = null;
  if (rawDriverActivation) {
    try {
      driverActivation = JSON.parse(rawDriverActivation);
    } catch (_error) {
      driverActivation = null;
    }
  }

  const canonicalQaProfile = buildQaSeedProfile({
    uid: authUid,
    driverActivation,
  });

  const rebuiltProfile = canonicalQaProfile
    ? {
        ...canonicalQaProfile,
        ...(storedUserData || {}),
        canGoOnline: canonicalQaProfile.canGoOnline,
        driverActivation:
          driverActivation ||
          canonicalQaProfile.driverActivation ||
          storedUserData?.driverActivation ||
          undefined,
        profile: {
          ...(canonicalQaProfile.profile || {}),
          ...(storedUserData?.profile && typeof storedUserData.profile === 'object'
            ? storedUserData.profile
            : {}),
          canGoOnline:
            canonicalQaProfile.profile?.canGoOnline ?? canonicalQaProfile.canGoOnline,
          driverActivation:
            driverActivation ||
            canonicalQaProfile.profile?.driverActivation ||
            canonicalQaProfile.driverActivation ||
            storedUserData?.profile?.driverActivation ||
            undefined,
        },
      }
    : storedUserData
      ? {
          ...storedUserData,
          driverActivation: driverActivation || storedUserData.driverActivation || undefined,
          profile:
            storedUserData.profile && typeof storedUserData.profile === 'object'
              ? {
                  ...storedUserData.profile,
                  driverActivation:
                    driverActivation || storedUserData.profile.driverActivation || undefined,
                }
              : storedUserData.profile,
        }
      : null;

  if (!rebuiltProfile) {
    return null;
  }

  await AsyncStorage.multiSet([
    [authUidKey, authUid],
    [userDataKey, JSON.stringify(rebuiltProfile)],
  ]);

  return rebuiltProfile;
};
