import {
  DRIVER_ONBOARDING_STAGE_KEYS,
  computeDriverOnboardingState,
  createInitialDriverOnboardingState,
} from '../services/DriverOnboardingService';

const QA_DRIVER_UID = '8vg2kxxqi3TYKlpD6eBlWgYseIq2';
const QA_DRIVER_CURRENT_UID = 'DV4cwZvql3T3pI3lnKYQwQVALKZ2';
const QA_PASSENGER_UID = 'OjML1wSzdNRaynjqMRlSW1Y0LVy2';
const QA_PASSENGER_CURRENT_UID = '3tEQ8pQ2QzeWbMKhLGsXHHhnOGL2';
const QA_PASSENGER_PREFLIGHT_UID = 'juYe4nF4TyOzFTnIzW91Qo0sXtz1';

const QA_DRIVER_UIDS = new Set([QA_DRIVER_UID, QA_DRIVER_CURRENT_UID]);
const QA_PASSENGER_UIDS = new Set([
  QA_PASSENGER_UID,
  QA_PASSENGER_CURRENT_UID,
  QA_PASSENGER_PREFLIGHT_UID,
]);

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

  if (QA_DRIVER_UIDS.has(normalizedUid)) {
    const resolvedDriverActivation = buildApprovedQaDriverActivation(driverActivation);
    const isCurrentDriver = normalizedUid === QA_DRIVER_CURRENT_UID;
    const baseProfile = buildBaseProfile({
      uid: normalizedUid,
      role: 'driver',
      phone: isCurrentDriver ? '+5521987654321' : '+5521123456789',
      email: isCurrentDriver ? 'motorista.qa.vilakosmos@leafapp.com' : 'motorista.teste@leafapp.com',
      name: isCurrentDriver ? 'Motorista QA' : 'Motorista',
      firstName: 'Leaf',
      lastName: 'Motorista Teste',
    });
    const vehicleId = isCurrentDriver ? 'test_vehicle_DV4cwZvql3T3' : 'test_vehicle_8vg2kxxqi3TY';
    const userVehicleId = isCurrentDriver ? 'uv_test_vehicle_DV4cwZvql3T3' : 'uv_test_vehicle_8vg2kxxqi3TY';
    const carPlate = isCurrentDriver ? 'TES6789' : 'TES8888';
    const carModel = isCurrentDriver ? 'Toyota Prius' : 'Tesla Model 3';
    const carType = isCurrentDriver ? 'Leaf Plus' : 'standard';

    return {
      ...baseProfile,
      vehicleId,
      userVehicleId,
      carPlate,
      carModel,
      carType,
      driverActivation: resolvedDriverActivation,
      profile: {
        ...baseProfile,
        canGoOnline: true,
        vehicleId,
        userVehicleId,
        carPlate,
        carModel,
        carType,
        driverActivation: resolvedDriverActivation,
      },
    };
  }

  if (QA_PASSENGER_UIDS.has(normalizedUid)) {
    const baseProfile = buildBaseProfile({
      uid: normalizedUid,
      role: 'customer',
      phone: normalizedUid === QA_PASSENGER_CURRENT_UID ? '+5521102938476' : '+5521102938475',
      email:
        normalizedUid === QA_PASSENGER_CURRENT_UID
          ? 'passageiro.qa.vilakosmos@leafapp.com'
          : 'passageiro.teste@leafapp.com',
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
  const authUid = String(values[authUidKey] || '').trim();
  if (!authUid) {
    return null;
  }
  const canRestoreKnownQaUid = QA_DRIVER_UIDS.has(authUid) || QA_PASSENGER_UIDS.has(authUid);
  const testModeEnabled = String(values[testModeKey] || '').trim() === 'true';
  if (!testModeEnabled && !canRestoreKnownQaUid) {
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
