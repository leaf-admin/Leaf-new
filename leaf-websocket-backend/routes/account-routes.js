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
