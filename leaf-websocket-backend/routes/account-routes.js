const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { logger } = require('../utils/logger');
const redisPool = require('../utils/redis-pool');
const {
  buildVehicleOcrUpdates,
  normalizeVehicleOcrPayload,
  sanitizeVehicleOcrData
} = require('../utils/vehicle-ocr-data');

const legacyProfileMirrorDefault = process.env.NODE_ENV === 'production' ? 'false' : 'true';
const legacyProfileRtdbMirrorEnabled =
  String(process.env.ENABLE_LEGACY_PROFILE_RTDB_MIRROR ?? legacyProfileMirrorDefault).toLowerCase() === 'true';
const DEFAULT_DELETION_REASON = 'user_requested_mobile_app';
const legacyDeleteDataRoutesEnabled =
  String(process.env.ENABLE_LEGACY_ACCOUNT_DELETE_ROUTES || 'false').toLowerCase() === 'true';
const immediateAccountPurgeEnabled =
  String(process.env.ACCOUNT_DELETE_IMMEDIATE_PURGE || 'true').toLowerCase() === 'true';
const removeFirebaseAuthUserEnabled =
  String(process.env.ACCOUNT_DELETE_REMOVE_AUTH_USER || 'true').toLowerCase() === 'true';
const USER_PII_FIELDS_TO_DELETE = [
  'name',
  'fullName',
  'firstName',
  'lastName',
  'email',
  'phone',
  'phoneNumber',
  'mobile',
  'cpf',
  'pix',
  'pixKey',
  'address',
  'street',
  'number',
  'complement',
  'district',
  'city',
  'state',
  'zipCode',
  'photo',
  'profileImage',
  'profile_image',
  'licenseImage',
  'verifyIdImage',
  'cnhImage',
  'crlvImage',
  'cnhExtraction',
  'vehicleExtraction',
  'documents'
];

// Middleware de autenticação Firebase
const requireFirebase = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Token de autorização não fornecido'
      });
    }

    const token = authHeader.split('Bearer ')[1];
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = decodedToken;
    req.userToken = token;
    next();
  } catch (error) {
    logger.error('Erro na autenticação Firebase:', error);
    return res.status(401).json({
      success: false,
      error: 'Token inválido ou expirado'
    });
  }
};

const normalizePhone = (phone) => String(phone || '').replace(/\D/g, '');
const maskEmail = (email) => {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized || !normalized.includes('@')) return null;
  const [user, domain] = normalized.split('@');
  if (!user || !domain) return null;
  return `${user.slice(0, 2)}***@${domain}`;
};
const maskPhone = (phone) => {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  if (normalized.length <= 4) return '***';
  return `${'*'.repeat(Math.max(0, normalized.length - 4))}${normalized.slice(-4)}`;
};

const PROFILE_MUTABLE_FIELDS = new Set([
  'mobile',
  'phone',
  'phoneNumber',
  'email',
  'name',
  'fullName',
  'firstName',
  'lastName',
  'cpf',
  'city',
  'cityLabel',
  'usertype',
  'userType',
  'phoneValidated',
  'paymentMethod',
  'onboardingVersion',
  'onboardingCompleted',
  'profileComplete',
  'acceptTerms',
  'acceptPrivacy',
  'consentBackgroundCheck',
  'marketingOptIn',
  'acceptMarketing',
  'birthDate',
  'dateOfBirth',
  'dob',
  'motherName',
  'nomeMae',
  'gender',
  'genero',
  'genderLabel',
  'profileImage',
  'profile_image',
  'fcmToken',
  'pushToken',
  'platform',
  'lastSeen',
  'driverContactData',
  'customerData',
  'emergencyContact'
]);

const PROFILE_DERIVED_FORBIDDEN_FIELDS = new Set([
  'approved',
  'isApproved',
  'canGoOnline',
  'approvalStatus',
  'driverProfileStatus',
  'driverActivation',
  'driverActivationConsent',
  'activationCurrentStage',
  'activationStatus',
  'vehicleProfileStatus',
  'vehicleStatus',
  'vehicleApproved',
  'vehicleCategory',
  'vehicleNumber',
  'vehiclePlate',
  'vehicleMake',
  'vehicleModel',
  'vehicleColor',
  'vehicleIdentitySource',
  'vehicleIdentityCanonical',
  'vehicleIdentityComplete',
  'activeVehicleId',
  'onboardingDocuments',
  'documents',
  'vehicles',
  'vehicle',
  'cnhUploaded',
  'cnhExtraction',
  'vehicleExtraction',
  'kycStatus',
  'kyc_status',
  'kycBlocked',
  'kycBlockedReason',
  'livenessStatus',
  'faceCompareStatus',
  'faceCompareResult'
]);

const PROFILE_IMMUTABLE_AFTER_CREATION_FIELDS = new Set([
  'role',
  'user_role',
  'accountType',
  'usertype',
  'userType',
  'mobile',
  'phone',
  'phoneNumber',
  'phoneValidated',
  'onboardingCompleted',
  'profileComplete'
]);

const PROFILE_ROLE_FIELDS = [
  'role',
  'user_role',
  'accountType',
  'usertype',
  'userType'
];

const DEFAULT_APP_PREFERENCES = Object.freeze({
  notificationsEnabled: true,
  trafficLayerEnabled: true,
  voiceGuidanceEnabled: false,
  schemaVersion: 1
});
const APP_PREFERENCE_FIELDS = new Set([
  'notificationsEnabled',
  'trafficLayerEnabled',
  'voiceGuidanceEnabled'
]);
const ONLINE_DRIVER_STATUSES = new Set([
  'online',
  'available',
  'busy',
  'accepted',
  'arrived',
  'started',
  'in_trip',
  'em viagem'
]);
const MAX_VEHICLES_PER_PROFILE = 4;

const FIRESTORE_PROTECTED_FIELDS = new Set([
  'status',
  'accountDisabled',
  'deletedAt',
  'deletionProcessedAt',
  'deletionReason',
  'deletionSource',
  'deletionAdditionalInfo',
  'role',
  'walletBalance',
  'totalEarned',
  'totalSpent'
]);

function normalizeUserType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'passenger') return 'customer';
  if (normalized === 'customer' || normalized === 'driver') return normalized;
  return null;
}

function isIncompleteOtpBootstrapProfile(profile) {
  return Boolean(
    profile &&
      String(profile.createdVia || '').trim().toLowerCase() === 'otp_verify' &&
      profile.profileComplete === false &&
      profile.onboardingCompleted === false
  );
}

function resolveExplicitProfileRole(input = {}) {
  const suppliedRoles = PROFILE_ROLE_FIELDS
    .filter((field) => Object.prototype.hasOwnProperty.call(input, field))
    .map((field) => ({ field, value: input[field], role: normalizeUserType(input[field]) }));

  if (suppliedRoles.length === 0) {
    return { role: null, error: 'missing', fields: [] };
  }

  const invalidFields = suppliedRoles.filter(({ role }) => !role).map(({ field }) => field);
  if (invalidFields.length > 0) {
    return { role: null, error: 'invalid', fields: invalidFields };
  }

  const distinctRoles = [...new Set(suppliedRoles.map(({ role }) => role))];
  if (distinctRoles.length !== 1) {
    return {
      role: null,
      error: 'conflict',
      fields: suppliedRoles.map(({ field }) => field)
    };
  }

  return { role: distinctRoles[0], error: null, fields: [] };
}

function findMissingProfileCompletionConsents(input, role) {
  const missingConsents = [];
  if (input.acceptTerms !== true) missingConsents.push('acceptTerms');
  if (input.acceptPrivacy !== true) missingConsents.push('acceptPrivacy');
  if (role === 'driver' && input.consentBackgroundCheck !== true) {
    missingConsents.push('consentBackgroundCheck');
  }
  return missingConsents;
}

function splitName(fullName) {
  const normalized = String(fullName || '').trim().replace(/\s+/g, ' ');
  if (!normalized) {
    return { firstName: '', lastName: '' };
  }

  const parts = normalized.split(' ');
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: '' };
  }

  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' ')
  };
}

function sanitizeProfilePatch(input = {}) {
  const patch = {};

  Object.entries(input || {}).forEach(([key, value]) => {
    if (PROFILE_MUTABLE_FIELDS.has(key) && value !== undefined) {
      patch[key] = value;
    }
  });

  return patch;
}

function findForbiddenProfileFields(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return [];
  }

  return Object.keys(input)
    .filter((key) => PROFILE_DERIVED_FORBIDDEN_FIELDS.has(key))
    .sort();
}

function findImmutableProfileFields(input = {}, existingProfile = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return [];
  }

  const existingRole = normalizeUserType(
    existingProfile.userType ||
      existingProfile.usertype ||
      existingProfile.role ||
      existingProfile.user_role ||
      existingProfile.accountType
  );
  const existingPhone = normalizePhone(
    existingProfile.phoneNumber || existingProfile.phone || existingProfile.mobile
  );

  return Object.keys(input)
    .filter((key) => PROFILE_IMMUTABLE_AFTER_CREATION_FIELDS.has(key))
    .filter((key) => {
      if (PROFILE_ROLE_FIELDS.includes(key)) {
        return normalizeUserType(input[key]) !== existingRole;
      }
      if (key === 'mobile' || key === 'phone' || key === 'phoneNumber') {
        return normalizePhone(input[key]) !== existingPhone;
      }
      return input[key] !== existingProfile[key];
    })
    .sort();
}

function stripProtectedFields(input = {}) {
  const next = { ...input };
  FIRESTORE_PROTECTED_FIELDS.forEach((key) => {
    delete next[key];
  });
  return next;
}

function serializeForClient(value) {
  if (value == null) return value;

  if (typeof value?.toDate === 'function') {
    return value.toDate().toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((entry) => serializeForClient(entry));
  }

  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, serializeForClient(entry)])
    );
  }

  return value;
}

function normalizeVehiclePlate(value) {
  return String(value || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

function normalizeVehicleInput(input = {}) {
  const plate = normalizeVehiclePlate(input.plate || input.vehiclePlate || input.vehicleNumber);
  const year = Number.parseInt(input.year || input.modelYear || input.anoModelo, 10);
  return {
    plate,
    plateNormalized: plate,
    brand: String(input.brand || input.make || input.marca || '').trim(),
    model: String(input.model || input.modelo || '').trim(),
    color: String(input.color || input.cor || '').trim(),
    year: Number.isFinite(year) ? year : null,
    vehicleType: String(input.vehicleType || 'carro').trim().toLowerCase() || 'carro'
  };
}

function validateVehicleInput(vehicle) {
  const errors = [];
  if (!/^[A-Z]{3}(?:\d{4}|\d[A-Z]\d{2})$/.test(vehicle.plate)) errors.push('plate');
  if (!vehicle.brand) errors.push('brand');
  if (!vehicle.model) errors.push('model');
  if (!vehicle.color) errors.push('color');
  const currentYear = new Date().getFullYear();
  if (!vehicle.year || vehicle.year < 1990 || vehicle.year > currentYear + 1) errors.push('year');
  return errors;
}

function sanitizePreferencePatch(input = {}) {
  return Object.fromEntries(
    Object.entries(input || {}).filter(([key, value]) =>
      APP_PREFERENCE_FIELDS.has(key) && typeof value === 'boolean'
    )
  );
}

async function readUserVehicles(userId) {
  const snapshot = await admin.database().ref(`user_vehicles/${userId}`).once('value');
  if (!snapshot.exists()) return [];
  const records = [];
  snapshot.forEach((childSnapshot) => {
    records.push({ userVehicleId: childSnapshot.key, ...(childSnapshot.val() || {}) });
  });
  return records;
}

async function readVehicleCatalogRecord(vehicleId) {
  const snapshot = await admin.database().ref(`vehicles/${vehicleId}`).once('value');
  return snapshot.exists() ? { id: vehicleId, ...(snapshot.val() || {}) } : null;
}

async function findVehicleCatalogRecordByPlate(plate) {
  const indexed = await admin.database().ref(`vehicle_plate_index/${plate}`).once('value');
  const indexedVehicleId = indexed.exists() ? String(indexed.val() || '').trim() : '';
  if (indexedVehicleId) {
    const indexedVehicle = await readVehicleCatalogRecord(indexedVehicleId);
    if (indexedVehicle) return indexedVehicle;
  }

  const catalogSnapshot = await admin.database().ref('vehicles').once('value');
  if (!catalogSnapshot.exists()) return null;
  let match = null;
  catalogSnapshot.forEach((childSnapshot) => {
    const vehicle = childSnapshot.val() || {};
    if (normalizeVehiclePlate(vehicle.plateNormalized || vehicle.plate) === plate) {
      match = { id: childSnapshot.key, ...vehicle };
      return true;
    }
    return false;
  });
  return match;
}

async function requireDriverOffline(req, res, next) {
  try {
    await redisPool.ensureConnection?.();
    const redis = redisPool.getConnection?.();
    if (!redis?.hgetall) {
      throw new Error('redis_unavailable');
    }
    const driverState = await redis.hgetall(`driver:${req.user.uid}`);
    const status = String(driverState?.status || 'offline').trim().toLowerCase();
    const isOnline = driverState?.isOnline === true || driverState?.isOnline === 'true' || ONLINE_DRIVER_STATUSES.has(status);
    if (isOnline) {
      return res.status(409).json({
        success: false,
        code: 'DRIVER_MUST_BE_OFFLINE',
        message: 'Fique offline para alterar os veículos do perfil.'
      });
    }
    return next();
  } catch (error) {
    logger.warn(`Falha ao confirmar status offline para gestão de veículo: ${error.message}`);
    return res.status(503).json({
      success: false,
      code: 'DRIVER_STATUS_UNAVAILABLE',
      message: 'Não foi possível confirmar seu status agora. Tente novamente.'
    });
  }
}

async function requireDriverAccount(req, res, next) {
  try {
    const result = await resolveAccountProfile(req.user.uid, req.user);
    const role = normalizeUserType(
      result.profile?.usertype ||
        result.profile?.userType ||
        req.user?.usertype ||
        req.user?.userType ||
        req.user?.role
    );
    if (role !== 'driver') {
      return res.status(403).json({
        success: false,
        code: 'DRIVER_ACCOUNT_REQUIRED',
        message: 'A gestão de veículos está disponível apenas para contas de motorista.'
      });
    }

    req.accountProfile = result.profile;
    return next();
  } catch (error) {
    logger.warn(`Falha ao confirmar papel de motorista para gestão de veículo: ${error.message}`);
    return res.status(503).json({
      success: false,
      code: 'DRIVER_ACCOUNT_ROLE_UNAVAILABLE',
      message: 'Não foi possível validar sua conta agora. Tente novamente.'
    });
  }
}

async function findUserVehicleIdForVehicle(userId, vehicleId) {
  const snapshot = await admin.database().ref(`user_vehicles/${userId}`).once('value');
  if (!snapshot.exists()) return null;

  let matchedUserVehicleId = null;
  snapshot.forEach((childSnapshot) => {
    const record = childSnapshot.val() || {};
    if (
      record.vehicleId === vehicleId ||
      record.id === vehicleId ||
      childSnapshot.key === vehicleId
    ) {
      matchedUserVehicleId = childSnapshot.key;
      return true;
    }
    return false;
  });

  return matchedUserVehicleId;
}

async function invalidateDriverEligibilityCache(userId) {
  try {
    await redisPool.ensureConnection?.();
    const redis = redisPool.getConnection?.();
    await redis?.del?.(`driver_eligibility_profile:${userId}`);
  } catch (error) {
    logger.warn(`Falha ao invalidar cache de elegibilidade do motorista ${userId}: ${error.message}`);
  }
}

function composeProfileRecord(userId, existingProfile = {}, incomingProfile = {}, tokenClaims = {}, options = {}) {
  const trustIncomingStatus = options.trustIncomingStatus === true;
  const useServerTimestamps = options.useServerTimestamps !== false;
  const mergedInput = stripProtectedFields({
    ...existingProfile,
    ...incomingProfile
  });

  const normalizedUserType =
    normalizeUserType(
      mergedInput.userType ||
        mergedInput.usertype ||
        existingProfile.role ||
        tokenClaims.userType ||
        tokenClaims.usertype ||
        tokenClaims.role
    ) || 'customer';

  const rawName =
    String(
      mergedInput.name ||
        mergedInput.fullName ||
        [mergedInput.firstName, mergedInput.lastName].filter(Boolean).join(' ') ||
        tokenClaims.name ||
        ''
    )
      .trim()
      .replace(/\s+/g, ' ');

  const derivedNames = splitName(rawName);
  const normalizedPhone =
    String(
      mergedInput.phoneNumber ||
        mergedInput.phone ||
        mergedInput.mobile ||
        tokenClaims.phone_number ||
        ''
    ).trim();
  const normalizedEmail = String(mergedInput.email || tokenClaims.email || '')
    .trim()
    .toLowerCase();

  const existingApproved = existingProfile.approved ?? existingProfile.isApproved;
  const incomingApproved = trustIncomingStatus
    ? incomingProfile.approved ?? incomingProfile.isApproved
    : undefined;
  const existingCanGoOnline = existingProfile.canGoOnline;
  const incomingCanGoOnline = trustIncomingStatus ? incomingProfile.canGoOnline : undefined;

  const timestampNow = useServerTimestamps
    ? admin.firestore.FieldValue.serverTimestamp()
    : new Date().toISOString();
  const createdAt =
    existingProfile.createdAt ||
    incomingProfile.createdAt ||
    timestampNow;

  const record = {
    ...mergedInput,
    uid: userId,
    usertype: normalizedUserType,
    userType: normalizedUserType,
    email: normalizedEmail,
    mobile: normalizedPhone,
    phone: normalizedPhone,
    phoneNumber: normalizedPhone,
    name: rawName,
    firstName: String(mergedInput.firstName || derivedNames.firstName || '').trim(),
    lastName: String(mergedInput.lastName || derivedNames.lastName || '').trim(),
    createdAt,
    updatedAt: timestampNow
  };

  if (normalizedUserType === 'driver') {
    record.approved = Boolean(existingApproved ?? incomingApproved ?? false);
    record.isApproved = Boolean(existingProfile.isApproved ?? existingApproved ?? incomingApproved ?? false);
    record.canGoOnline = Boolean(
      existingCanGoOnline ??
        incomingCanGoOnline ??
        mergedInput.driverActivation?.canGoOnline ??
        false
    );
  } else {
    record.approved = true;
    record.isApproved = true;
    record.canGoOnline = true;
  }

  if (!record.profileImage && record.profile_image) {
    record.profileImage = record.profile_image;
  }
  if (!record.profile_image && record.profileImage) {
    record.profile_image = record.profileImage;
  }

  return record;
}

async function getRealtimeProfile(userId) {
  try {
    const db = admin.database();
    const snapshot = await db.ref(`users/${userId}`).once('value');
    return snapshot.exists() ? snapshot.val() || {} : null;
  } catch (error) {
    logger.warn(`Falha ao obter perfil legado do RTDB para ${userId}: ${error.message}`);
    return null;
  }
}

async function mirrorProfileToRealtimeDB(userId, profile) {
  if (!legacyProfileRtdbMirrorEnabled) {
    return;
  }

  try {
    const db = admin.database();
    const serialized = serializeForClient(profile);
    await db.ref(`users/${userId}`).update({
      ...serialized,
      uid: userId,
      updatedAt: serialized.updatedAt || new Date().toISOString()
    });
  } catch (error) {
    logger.warn(`Falha ao espelhar perfil no RTDB para ${userId}: ${error.message}`);
  }
}

async function projectCanonicalDriverRoleToRealtimeDB(userId, profile) {
  const canonicalRole = normalizeUserType(
    profile?.usertype ||
      profile?.userType ||
      profile?.role ||
      profile?.user_role ||
      profile?.accountType
  );

  if (canonicalRole !== 'driver') {
    return;
  }

  await admin.database().ref(`users/${userId}`).update({
    usertype: canonicalRole,
    userType: canonicalRole,
    role: canonicalRole
  });
}

async function removeRealtimeProfile(userId) {
  try {
    const db = admin.database();
    await db.ref(`users/${userId}`).remove();
  } catch (error) {
    logger.warn(`Falha ao remover perfil legado do RTDB para ${userId}: ${error.message}`);
  }
}

async function resolveAccountProfile(userId, tokenClaims) {
  const userRef = admin.firestore().collection('users').doc(userId);
  const userDoc = await userRef.get();

  if (userDoc.exists) {
    const profile = composeProfileRecord(userId, userDoc.data() || {}, {}, tokenClaims, {
      useServerTimestamps: false
    });
    return {
      profile,
      source: 'firestore'
    };
  }

  const legacyProfile = await getRealtimeProfile(userId);
  if (!legacyProfile) {
    return {
      profile: null,
      source: 'missing'
    };
  }

  const migratedProfile = composeProfileRecord(userId, {}, legacyProfile, tokenClaims, {
    trustIncomingStatus: true
  });

  await userRef.set(migratedProfile, { merge: true });

  return {
    profile: composeProfileRecord(userId, {}, legacyProfile, tokenClaims, {
      trustIncomingStatus: true,
      useServerTimestamps: false
    }),
    source: 'rtdb_migrated'
  };
}

router.get('/api/account/profile', requireFirebase, async (req, res) => {
  try {
    const userId = req.user.uid;
    const result = await resolveAccountProfile(userId, req.user);

    if (!result.profile) {
      return res.status(404).json({
        success: false,
        message: 'Perfil não encontrado'
      });
    }

    return res.json({
      success: true,
      source: result.source,
      profile: serializeForClient(result.profile)
    });
  } catch (error) {
    logger.error('Erro ao obter perfil da conta:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao obter perfil da conta'
    });
  }
});

router.put('/api/account/profile', requireFirebase, async (req, res) => {
  try {
    const userId = req.user.uid;
    const incomingProfile =
      req.body && typeof req.body.profile === 'object' && req.body.profile !== null
        ? req.body.profile
        : req.body;

    if (!incomingProfile || typeof incomingProfile !== 'object' || Array.isArray(incomingProfile)) {
      return res.status(400).json({
        success: false,
        message: 'Payload de perfil inválido'
      });
    }

    const forbiddenFields = findForbiddenProfileFields(incomingProfile);
    if (forbiddenFields.length > 0) {
      return res.status(400).json({
        success: false,
        code: 'PROFILE_DERIVED_FIELD_FORBIDDEN',
        message: 'Campos derivados de aprovação, documentos, KYC ou veículo não podem ser atualizados pelo app.',
        forbiddenFields
      });
    }

    const existingResult = await resolveAccountProfile(userId, req.user);
    const isFirstProfileCompletion =
      !existingResult.profile || isIncompleteOtpBootstrapProfile(existingResult.profile);
    const immutableFields = findImmutableProfileFields(
      incomingProfile,
      existingResult.profile || {}
    );
    if (!isFirstProfileCompletion && immutableFields.length > 0) {
      return res.status(400).json({
        success: false,
        code: 'PROFILE_IDENTITY_FIELD_IMMUTABLE',
        message: 'Papel da conta, telefone e conclusão do onboarding não podem ser alterados pelo perfil.',
        immutableFields
      });
    }

    const sanitizedPatch = sanitizeProfilePatch(incomingProfile);
    let baseProfile = existingResult.profile || {};
    if (isFirstProfileCompletion) {
      const explicitRole = resolveExplicitProfileRole(incomingProfile);
      if (explicitRole.error) {
        return res.status(400).json({
          success: false,
          code: 'PROFILE_ROLE_REQUIRED_FOR_COMPLETION',
          message: 'Informe explicitamente um único papel válido para concluir o perfil.',
          invalidRoleFields: explicitRole.fields
        });
      }

      const missingConsents = findMissingProfileCompletionConsents(
        incomingProfile,
        explicitRole.role
      );
      if (missingConsents.length > 0) {
        return res.status(400).json({
          success: false,
          code: 'PROFILE_REQUIRED_CONSENTS_MISSING',
          message: 'As permissões obrigatórias devem ser concedidas para concluir o perfil.',
          missingConsents
        });
      }

      const tokenPhone = String(req.user?.phone_number || '').trim();
      const verifiedPhone = tokenPhone || String(
        baseProfile.phoneNumber || baseProfile.phone || baseProfile.mobile || ''
      ).trim();
      sanitizedPatch.usertype = explicitRole.role;
      sanitizedPatch.userType = explicitRole.role;
      sanitizedPatch.mobile = verifiedPhone;
      sanitizedPatch.phone = verifiedPhone;
      sanitizedPatch.phoneNumber = verifiedPhone;
      sanitizedPatch.phoneValidated = Boolean(verifiedPhone);
      sanitizedPatch.onboardingCompleted = true;
      sanitizedPatch.profileComplete = true;
      sanitizedPatch.acceptTerms = true;
      sanitizedPatch.acceptPrivacy = true;

      if (explicitRole.role === 'driver') {
        sanitizedPatch.consentBackgroundCheck = true;
        baseProfile = {
          ...baseProfile,
          approved: false,
          isApproved: false,
          canGoOnline: false
        };
      }
    }
    const nextProfile = composeProfileRecord(
      userId,
      baseProfile,
      sanitizedPatch,
      req.user
    );

    await admin.firestore().collection('users').doc(userId).set(nextProfile, { merge: true });
    await projectCanonicalDriverRoleToRealtimeDB(userId, nextProfile);
    await mirrorProfileToRealtimeDB(userId, nextProfile);
    const storedDoc = await admin.firestore().collection('users').doc(userId).get();
    const responseProfile = composeProfileRecord(
      userId,
      storedDoc.exists ? storedDoc.data() || {} : nextProfile,
      {},
      req.user,
      { useServerTimestamps: false }
    );

    return res.json({
      success: true,
      source: 'firestore',
      profile: serializeForClient(responseProfile),
      mirroredToRealtimeDb: legacyProfileRtdbMirrorEnabled
    });
  } catch (error) {
    logger.error('Erro ao atualizar perfil da conta:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao atualizar perfil da conta'
    });
  }
});

router.get('/api/account/preferences', requireFirebase, async (req, res) => {
  try {
    const userDoc = await admin.firestore().collection('users').doc(req.user.uid).get();
    const stored = userDoc.exists ? userDoc.data()?.appPreferences || {} : {};
    return res.json({
      success: true,
      preferences: serializeForClient({
        ...DEFAULT_APP_PREFERENCES,
        ...sanitizePreferencePatch(stored),
        schemaVersion: 1,
        updatedAt: stored.updatedAt || null
      })
    });
  } catch (error) {
    logger.error('Erro ao obter preferências da conta:', error);
    return res.status(500).json({ success: false, message: 'Erro ao obter preferências da conta' });
  }
});

router.patch('/api/account/preferences', requireFirebase, async (req, res) => {
  try {
    const patch = sanitizePreferencePatch(req.body?.preferences || req.body || {});
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ success: false, message: 'Nenhuma preferência válida foi informada' });
    }

    const userRef = admin.firestore().collection('users').doc(req.user.uid);
    const userDoc = await userRef.get();
    const current = userDoc.exists ? userDoc.data()?.appPreferences || {} : {};
    const updatedAt = new Date().toISOString();
    const preferences = {
      ...DEFAULT_APP_PREFERENCES,
      ...sanitizePreferencePatch(current),
      ...patch,
      schemaVersion: 1,
      updatedAt
    };
    await userRef.set({
      appPreferences: {
        ...preferences,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }
    }, { merge: true });

    return res.json({ success: true, preferences });
  } catch (error) {
    logger.error('Erro ao atualizar preferências da conta:', error);
    return res.status(500).json({ success: false, message: 'Erro ao atualizar preferências da conta' });
  }
});

router.get('/api/account/vehicles', requireFirebase, requireDriverAccount, async (req, res) => {
  try {
    const userVehicles = await readUserVehicles(req.user.uid);
    const vehicles = (await Promise.all(userVehicles.map(async (link) => {
      const vehicleId = String(link.vehicleId || '').trim();
      const accountVehicleId = vehicleId || String(link.userVehicleId || link.id || '').trim();
      if (!accountVehicleId) return null;
      const catalog = vehicleId ? await readVehicleCatalogRecord(vehicleId) : null;
      return {
        id: accountVehicleId,
        vehicleId: vehicleId || null,
        userVehicleId: link.userVehicleId,
        plate: link.plate || link.plateNormalized || catalog?.plate || catalog?.plateNormalized || '',
        brand: link.brand || link.make || catalog?.brand || catalog?.make || '',
        model: link.model || catalog?.model || '',
        color: link.color || catalog?.color || '',
        year: link.year || catalog?.year || null,
        vehicleType: link.vehicleType || catalog?.vehicleType || 'carro',
        status: link.status || (link.approved === true ? 'approved' : 'pending'),
        approved: link.approved === true || ['approved', 'active'].includes(String(link.status || '').toLowerCase()),
        isActive: link.isActive === true,
        createdAt: link.createdAt || catalog?.createdAt || null,
        updatedAt: link.updatedAt || catalog?.updatedAt || null
      };
    }))).filter(Boolean);

    return res.json({ success: true, vehicles, total: vehicles.length });
  } catch (error) {
    logger.error('Erro ao listar veículos da conta:', error);
    return res.status(500).json({ success: false, message: 'Erro ao listar veículos da conta' });
  }
});

router.post('/api/account/vehicles', requireFirebase, requireDriverAccount, requireDriverOffline, async (req, res) => {
  try {
    const userId = req.user.uid;
    const vehicleInput = normalizeVehicleInput(req.body?.vehicle || req.body || {});
    const invalidFields = validateVehicleInput(vehicleInput);
    if (invalidFields.length > 0) {
      return res.status(400).json({
        success: false,
        code: 'VEHICLE_INPUT_INVALID',
        message: 'Confira placa, marca, modelo, cor e ano.',
        invalidFields
      });
    }

    const userVehicles = await readUserVehicles(userId);
    if (userVehicles.length >= MAX_VEHICLES_PER_PROFILE) {
      return res.status(409).json({
        success: false,
        code: 'VEHICLE_PROFILE_LIMIT_REACHED',
        message: `O perfil pode ter até ${MAX_VEHICLES_PER_PROFILE} veículos.`
      });
    }

    let catalog = await findVehicleCatalogRecordByPlate(vehicleInput.plate);
    if (catalog && userVehicles.some(link => String(link.vehicleId || link.id) === String(catalog.id))) {
      return res.status(409).json({
        success: false,
        code: 'VEHICLE_ALREADY_LINKED',
        message: 'Este veículo já está no seu perfil.'
      });
    }

    const nowIso = new Date().toISOString();
    const vehicleId = catalog?.id || `vehicle_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const userVehicleId = `${userId}_${vehicleId}_${Date.now()}`;
    const updates = {};
    if (!catalog) {
      catalog = { id: vehicleId, ...vehicleInput, status: 'idle', createdAt: nowIso, updatedAt: nowIso };
      updates[`vehicles/${vehicleId}`] = catalog;
      updates[`vehicle_plate_index/${vehicleInput.plate}`] = vehicleId;
    }
    updates[`user_vehicles/${userId}/${userVehicleId}`] = {
      id: userVehicleId,
      userId,
      vehicleId,
      status: 'pending',
      approved: false,
      isActive: false,
      createdAt: nowIso,
      updatedAt: nowIso
    };
    await admin.database().ref().update(updates);
    await invalidateDriverEligibilityCache(userId);

    return res.status(201).json({
      success: true,
      vehicle: {
        id: vehicleId,
        vehicleId,
        userVehicleId,
        ...catalog,
        status: 'pending',
        approved: false,
        isActive: false
      }
    });
  } catch (error) {
    logger.error('Erro ao adicionar veículo à conta:', error);
    return res.status(500).json({ success: false, message: 'Erro ao adicionar veículo à conta' });
  }
});

router.patch('/api/account/vehicles/:vehicleId', requireFirebase, requireDriverAccount, requireDriverOffline, async (req, res) => {
  try {
    const userId = req.user.uid;
    const requestedVehicleId = String(req.params.vehicleId || '').trim();
    const vehicleInput = normalizeVehicleInput(req.body?.vehicle || req.body || {});
    const invalidFields = validateVehicleInput(vehicleInput);
    if (invalidFields.length > 0) {
      return res.status(400).json({
        success: false,
        code: 'VEHICLE_INPUT_INVALID',
        message: 'Confira placa, marca, modelo, cor e ano.',
        invalidFields
      });
    }

    const userVehicles = await readUserVehicles(userId);
    const target = userVehicles.find((link) =>
      [link.userVehicleId, link.id, link.vehicleId]
        .filter(Boolean)
        .some((candidate) => String(candidate) === requestedVehicleId)
    );
    if (!target) {
      return res.status(404).json({ success: false, message: 'Veículo não encontrado no perfil' });
    }

    const currentCatalog = target.vehicleId
      ? await readVehicleCatalogRecord(String(target.vehicleId))
      : null;
    const currentCatalogPlate = normalizeVehiclePlate(
      currentCatalog?.plateNormalized || currentCatalog?.plate
    );
    const matchingCatalog = currentCatalogPlate === vehicleInput.plate
      ? currentCatalog
      : await findVehicleCatalogRecordByPlate(vehicleInput.plate);
    const duplicateLink = userVehicles.find((link) => {
      if (link.userVehicleId === target.userVehicleId) return false;
      if (matchingCatalog?.id && String(link.vehicleId || '') === String(matchingCatalog.id)) return true;
      return normalizeVehiclePlate(link.plateNormalized || link.plate) === vehicleInput.plate;
    });
    if (duplicateLink) {
      return res.status(409).json({
        success: false,
        code: 'VEHICLE_ALREADY_LINKED',
        message: 'Este veículo já está no seu perfil.'
      });
    }

    const nowIso = new Date().toISOString();
    const linkPath = `user_vehicles/${userId}/${target.userVehicleId}`;
    const updates = {
      [`${linkPath}/vehicleId`]: matchingCatalog?.id || null,
      [`${linkPath}/plate`]: vehicleInput.plate,
      [`${linkPath}/plateNormalized`]: vehicleInput.plate,
      [`${linkPath}/brand`]: vehicleInput.brand,
      [`${linkPath}/model`]: vehicleInput.model,
      [`${linkPath}/color`]: vehicleInput.color,
      [`${linkPath}/year`]: vehicleInput.year,
      [`${linkPath}/vehicleType`]: vehicleInput.vehicleType,
      [`${linkPath}/status`]: 'pending',
      [`${linkPath}/approved`]: false,
      [`${linkPath}/isActive`]: false,
      [`${linkPath}/reviewedAt`]: null,
      [`${linkPath}/reviewedBy`]: null,
      [`${linkPath}/submittedAt`]: nowIso,
      [`${linkPath}/updatedAt`]: nowIso,
      [`users/${userId}/updatedAt`]: nowIso
    };
    if (target.isActive === true) {
      updates[`users/${userId}/activeVehicleId`] = '';
    }

    await admin.database().ref().update(updates);
    await invalidateDriverEligibilityCache(userId);

    return res.json({
      success: true,
      vehicle: {
        id: matchingCatalog?.id || target.userVehicleId,
        vehicleId: matchingCatalog?.id || null,
        userVehicleId: target.userVehicleId,
        ...vehicleInput,
        status: 'pending',
        approved: false,
        isActive: false,
        updatedAt: nowIso
      }
    });
  } catch (error) {
    logger.error('Erro ao editar veículo da conta:', error);
    return res.status(500).json({ success: false, message: 'Erro ao editar veículo da conta' });
  }
});

router.patch('/api/account/vehicles/:vehicleId/active', requireFirebase, requireDriverAccount, requireDriverOffline, async (req, res) => {
  try {
    const userId = req.user.uid;
    const vehicleId = String(req.params.vehicleId || '').trim();
    const userVehicles = await readUserVehicles(userId);
    const target = userVehicles.find(link => String(link.vehicleId || link.id) === vehicleId);
    if (!target) {
      return res.status(404).json({ success: false, message: 'Veículo não encontrado no perfil' });
    }
    const targetApproved = target.approved === true || ['approved', 'active'].includes(
      String(target.status || '').trim().toLowerCase()
    );
    if (!targetApproved) {
      return res.status(409).json({
        success: false,
        code: 'VEHICLE_APPROVAL_REQUIRED',
        message: 'Aguarde a aprovação do veículo antes de selecioná-lo.'
      });
    }
    const canonicalVehicleId = String(target.vehicleId || '').trim();
    if (!canonicalVehicleId) {
      return res.status(409).json({
        success: false,
        code: 'VEHICLE_CANONICAL_IDENTITY_REQUIRED',
        message: 'Aguarde a validação do CRLV antes de selecionar o veículo.'
      });
    }

    const nowIso = new Date().toISOString();
    const updates = {};
    userVehicles.forEach(link => {
      updates[`user_vehicles/${userId}/${link.userVehicleId}/isActive`] = link.userVehicleId === target.userVehicleId;
      updates[`user_vehicles/${userId}/${link.userVehicleId}/updatedAt`] = nowIso;
    });
    updates[`users/${userId}/activeVehicleId`] = canonicalVehicleId;
    updates[`users/${userId}/updatedAt`] = nowIso;
    await admin.database().ref().update(updates);
    await invalidateDriverEligibilityCache(userId);

    return res.json({ success: true, activeVehicleId: canonicalVehicleId });
  } catch (error) {
    logger.error('Erro ao selecionar veículo da conta:', error);
    return res.status(500).json({ success: false, message: 'Erro ao selecionar veículo da conta' });
  }
});

router.delete('/api/account/vehicles/:vehicleId', requireFirebase, requireDriverAccount, requireDriverOffline, async (req, res) => {
  try {
    const userId = req.user.uid;
    const vehicleId = String(req.params.vehicleId || '').trim();
    const userVehicles = await readUserVehicles(userId);
    const target = userVehicles.find(link => String(link.vehicleId || link.id) === vehicleId);
    if (!target) {
      return res.status(404).json({ success: false, message: 'Veículo não encontrado no perfil' });
    }

    const updates = {
      [`user_vehicles/${userId}/${target.userVehicleId}`]: null,
      [`users/${userId}/updatedAt`]: new Date().toISOString()
    };
    if (target.isActive === true) {
      updates[`users/${userId}/activeVehicleId`] = '';
    }
    await admin.database().ref().update(updates);
    await invalidateDriverEligibilityCache(userId);

    return res.json({ success: true, removedVehicleId: vehicleId });
  } catch (error) {
    logger.error('Erro ao remover veículo da conta:', error);
    return res.status(500).json({ success: false, message: 'Erro ao remover veículo da conta' });
  }
});

router.post('/api/vehicles/ocr-data', requireFirebase, async (req, res) => {
  try {
    const authenticatedUserId = req.user.uid;
    const vehicleId = String(req.body?.vehicleId || '').trim();
    const requestedUserId = String(req.body?.userId || authenticatedUserId).trim();
    const vehicleData = req.body?.vehicleData;
    const metadata = req.body?.metadata || {};

    if (!vehicleId) {
      return res.status(400).json({
        success: false,
        message: 'vehicleId é obrigatório'
      });
    }

    if (requestedUserId !== authenticatedUserId) {
      return res.status(403).json({
        success: false,
        message: 'Usuário autenticado não corresponde ao cadastro do veículo'
      });
    }

    if (!vehicleData || typeof vehicleData !== 'object' || Array.isArray(vehicleData)) {
      return res.status(400).json({
        success: false,
        message: 'vehicleData do OCR é obrigatório'
      });
    }

    const normalized = normalizeVehicleOcrPayload(vehicleData);
    const hasUsefulVehicleData = Boolean(
      normalized.plate ||
        normalized.color ||
        normalized.make ||
        normalized.model ||
        normalized.year ||
        normalized.renavam ||
        normalized.chassis
    );

    if (!hasUsefulVehicleData) {
      return res.status(400).json({
        success: false,
        message: 'OCR não contém dados veiculares úteis'
      });
    }

    const userVehicleId = await findUserVehicleIdForVehicle(authenticatedUserId, vehicleId);
    if (!userVehicleId) {
      return res.status(404).json({
        success: false,
        message: 'Veículo não está vinculado ao usuário autenticado'
      });
    }

    const nowIso = new Date().toISOString();
    const { updates } = buildVehicleOcrUpdates({
      vehicleId,
      userId: authenticatedUserId,
      userVehicleId,
      payload: vehicleData,
      metadata,
      nowIso
    });

    await admin.database().ref().update(updates);

    await admin.firestore()
      .collection('vehicle_ocr_data')
      .doc(`${authenticatedUserId}_${vehicleId}`)
      .set({
        userId: authenticatedUserId,
        vehicleId,
        userVehicleId,
        normalized,
        metadata: sanitizeVehicleOcrData(metadata),
        auditImageProvided: Boolean(req.body?.auditImage),
        source: 'crlv_pdf_ocr',
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

    await invalidateDriverEligibilityCache(authenticatedUserId);

    return res.json({
      success: true,
      vehicleId,
      userVehicleId,
      normalizedColor: normalized.color || null,
      normalizedPlate: normalized.plate || null,
      updatedPaths: Object.keys(updates)
    });
  } catch (error) {
    logger.error('Erro ao persistir dados estruturados do CRLV:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro ao persistir dados estruturados do CRLV'
    });
  }
});

const buildPurgedUserUpdate = ({
  deletionReason,
  source,
  additionalInfo
}) => {
  const update = {
    status: 'deleted',
    accountDisabled: true,
    deletedAt: admin.firestore.FieldValue.serverTimestamp(),
    deletionProcessedAt: admin.firestore.FieldValue.serverTimestamp(),
    deletionReason,
    deletionSource: source || 'mobile-app',
    deletionAdditionalInfo: additionalInfo || ''
  };

  USER_PII_FIELDS_TO_DELETE.forEach((fieldName) => {
    update[fieldName] = admin.firestore.FieldValue.delete();
  });

  return update;
};

async function processAccountDeletion(req, res, options = {}) {
  const { allowParamUserId = false } = options;

  try {
    const authenticatedUserId = req.user.uid;
    const requestedUserId = String(req.params.userId || authenticatedUserId).trim();

    if (allowParamUserId && requestedUserId && requestedUserId !== authenticatedUserId) {
      return res.status(403).json({
        success: false,
        message: 'Você só pode excluir a sua própria conta.'
      });
    }

    const userId = authenticatedUserId;

    const {
      reason,
      additionalInfo,
      phone,
      password,
      source
    } = req.body || {};

    const deletionReason = String(reason || DEFAULT_DELETION_REASON).trim() || DEFAULT_DELETION_REASON;

    const accountProfileResult = await resolveAccountProfile(userId, req.user);
    const storedUserDoc = await admin.firestore().collection('users').doc(userId).get();
    const storedUserData = storedUserDoc.exists ? storedUserDoc.data() || {} : {};
    const resolvedUserData = accountProfileResult.profile || {};
    const mergedUserData = {
      ...resolvedUserData,
      ...storedUserData
    };
    const userData = Object.keys(mergedUserData).length > 0 ? mergedUserData : {
      uid: userId,
      phone: req.user.phone_number || '',
      phoneNumber: req.user.phone_number || '',
      email: req.user.email || ''
    };

    // Torna o endpoint compatível com autenticação por OTP (sem senha no app).
    // Se telefone for enviado, validamos contra o cadastro para evitar erro de identificação.
    const normalizedPhone = normalizePhone(phone);
    const registeredPhone = normalizePhone(
      userData.phone || userData.phoneNumber || req.user.phone_number || ''
    );

    if (normalizedPhone && registeredPhone && normalizedPhone !== registeredPhone) {
      logger.warn(
        `Tentativa de exclusão com telefone divergente - UserId: ${userId}, informado: ${normalizedPhone}, cadastrado: ${registeredPhone}`
      );
      return res.status(400).json({
        success: false,
        message: 'Número de telefone não corresponde à sua conta.'
      });
    }

    if (userData.status === 'deleted') {
      return res.json({
        success: true,
        message: 'Sua conta já foi excluída.',
        deletionRequested: true,
        deleted: true
      });
    }

    const deletionLog = {
      userId,
      status: 'processing',
      reason: deletionReason,
      additionalInfo: additionalInfo || '',
      phoneMasked: maskPhone(normalizedPhone || registeredPhone || null),
      passwordProvided: Boolean(password),
      source: source || 'mobile-app',
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      userEmailMasked: maskEmail(userData.email || null)
    };

    const deletionLogRef = await admin.firestore().collection('account_deletions').add(deletionLog);
    logger.info(`Registro de exclusão de conta criado - UserId: ${userId}, Motivo: ${deletionReason}, purgeImediato: ${immediateAccountPurgeEnabled}`);

    try {
      await admin.auth().updateUser(userId, {
        disabled: true
      });

      if (immediateAccountPurgeEnabled) {
        await admin.firestore().collection('users').doc(userId).set(
          buildPurgedUserUpdate({
            deletionReason,
            source,
            additionalInfo
          }),
          { merge: true }
        );
        await removeRealtimeProfile(userId);

        if (removeFirebaseAuthUserEnabled) {
          try {
            await admin.auth().deleteUser(userId);
          } catch (deleteAuthError) {
            // Se já não existir, tratamos como sucesso idempotente.
            if (!String(deleteAuthError?.code || '').includes('user-not-found')) {
              throw deleteAuthError;
            }
          }
        }

        await deletionLogRef.update({
          status: 'completed',
          completedAt: admin.firestore.FieldValue.serverTimestamp(),
          immediatePurge: true
        });

        logger.info(`Conta excluída com purge imediato - UserId: ${userId}`);

        return res.json({
          success: true,
          message: 'Sua conta foi excluída com sucesso. Dados pessoais foram removidos conforme a política de retenção aplicável.',
          deletionRequested: true,
          deleted: true
        });
      }

      await admin.firestore().collection('users').doc(userId).set({
        status: 'deletion_pending',
        accountDisabled: true,
        deletionRequestedAt: admin.firestore.FieldValue.serverTimestamp(),
        deletionReason,
        deletionSource: source || 'mobile-app',
        deletionAdditionalInfo: additionalInfo || ''
      }, { merge: true });

      await deletionLogRef.update({
        status: 'queued',
        queuedAt: admin.firestore.FieldValue.serverTimestamp(),
        immediatePurge: false
      });

      logger.info(`Conta marcada para exclusão - UserId: ${userId}`);

      return res.json({
        success: true,
        message: 'Sua conta foi marcada para exclusão com sucesso. Seus dados serão removidos conforme a política de retenção aplicável.',
        deletionRequested: true,
        deleted: false
      });
    } catch (deleteError) {
      logger.error(`Erro ao excluir conta do usuário ${userId}:`, deleteError);

      try {
        await admin.firestore().collection('users').doc(userId).set({
          status: userData.status || 'active'
        }, { merge: true });
      } catch (revertError) {
        logger.error(`Erro ao reverter status da conta ${userId}:`, revertError);
      }

      try {
        await deletionLogRef.update({
          status: 'error',
          errorAt: admin.firestore.FieldValue.serverTimestamp(),
          errorMessage: String(deleteError?.message || 'Falha ao processar exclusão')
        });
      } catch (logUpdateError) {
        logger.error(`Erro ao atualizar log de exclusão com falha - UserId: ${userId}:`, logUpdateError);
      }

      return res.status(500).json({
        success: false,
        message: 'Erro ao processar exclusão da conta. Tente novamente ou entre em contato com o suporte.'
      });
    }
  } catch (error) {
    logger.error('Erro ao excluir conta:', error);
    return res.status(500).json({
      success: false,
      message: 'Erro interno ao processar exclusão da conta.'
    });
  }
}

/**
 * POST /api/account/delete
 * Exclui conta do usuário autenticado
 */
router.post('/api/account/delete', requireFirebase, async (req, res) => {
  await processAccountDeletion(req, res, { allowParamUserId: false });
});

/**
 * DELETE /api/privacy/delete-data/:userId
 * Rota legada para compatibilidade com versões antigas do app
 */
if (legacyDeleteDataRoutesEnabled) {
  router.delete('/api/privacy/delete-data/:userId', requireFirebase, async (req, res) => {
    await processAccountDeletion(req, res, { allowParamUserId: true });
  });

  /**
   * POST /api/privacy/delete-data/:userId
   * Compatibilidade adicional para clientes que não enviam DELETE
   */
  router.post('/api/privacy/delete-data/:userId', requireFirebase, async (req, res) => {
    await processAccountDeletion(req, res, { allowParamUserId: true });
  });
}

module.exports = router;
