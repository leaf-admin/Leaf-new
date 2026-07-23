const admin = require('firebase-admin');
const firebaseConfig = require('../firebase-config');
const { logStructured } = require('../utils/logger');
const { resolveUserPersistenceScope } = require('./sandbox-persistence-context');

const COLLECTION = 'driver_applications';
const REVIEWABLE_DOCUMENT_TYPES = new Set(['cnh', 'crlv', 'antecedentes_criminais']);
const REVIEWABLE_DOCUMENT_STATUSES = new Set(['pending', 'approved', 'rejected']);
const DASHBOARD_PROVIDER_URL_KEYS = new Set([
  'fileUrl',
  'fileUrlExpiresAt',
  'url',
  'downloadUrl',
  'front',
  'back',
  'registration',
  'insurance'
]);

function projectDashboardApplication(value) {
  if (Array.isArray(value)) return value.map((item) => projectDashboardApplication(item));
  if (!value || typeof value !== 'object') return value;
  return Object.entries(value).reduce((projection, [key, item]) => {
    if (!DASHBOARD_PROVIDER_URL_KEYS.has(key)) {
      projection[key] = projectDashboardApplication(item);
    }
    return projection;
  }, {});
}

function isDocumentContentAvailable(driverId, documentType, document = {}) {
  const safeDriverId = normalizeId(driverId);
  const safeType = String(documentType || '').trim().toLowerCase();
  const filePath = String(document?.filePath || '').trim();
  const expectedPrefix = safeType === 'antecedentes_criminais'
    ? `documents/${safeDriverId}/${safeType}/`
    : `driver-activation/${safeDriverId}/${safeType}/`;
  if (!safeDriverId || !REVIEWABLE_DOCUMENT_TYPES.has(safeType)) return false;
  if (!filePath.startsWith(expectedPrefix) || filePath.includes('..')) return false;
  return /^[a-f0-9]{64}$/i.test(String(document?.documentSha256 || '').trim())
    && /^\d+$/.test(String(document?.storageGeneration || '').trim());
}

function normalizeApplicationPersistenceScope(value = {}) {
  const namespace = String(value?.namespace || '').trim().toLowerCase();
  if (!['operational', 'sandbox'].includes(namespace)) return null;
  const financialContextId = String(value?.financialContextId || '').trim() || null;
  if (namespace === 'sandbox' && !financialContextId) return null;
  return { namespace, financialContextId };
}

function getFirestoreOrThrow() {
  const firestore = firebaseConfig?.getFirestore ? firebaseConfig.getFirestore() : null;
  if (!firestore) {
    throw new Error('Firestore indisponível para driver applications');
  }
  return firestore;
}

function getRealtimeDbOrThrow() {
  const db = firebaseConfig?.getRealtimeDB ? firebaseConfig.getRealtimeDB() : null;
  if (!db) {
    throw new Error('Realtime Database indisponível para driver applications');
  }
  return db;
}

function parseRatingValue(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeId(value) {
  return String(value || '').trim();
}

function firstText(...values) {
  for (const value of values) {
    const normalized = String(value ?? '').trim();
    if (normalized) return normalized;
  }
  return '';
}

function normalizeProfileUserType(profile = {}) {
  const normalized = firstText(
    profile?.usertype,
    profile?.userType,
    profile?.role,
    profile?.user_role,
    profile?.accountType
  ).toLowerCase();

  if (normalized === 'passenger') return 'customer';
  return ['customer', 'driver'].includes(normalized) ? normalized : '';
}

function toIso(value, fallback = null) {
  if (!value) return fallback;
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number') {
    const dt = new Date(value);
    return Number.isNaN(dt.getTime()) ? fallback : dt.toISOString();
  }
  if (typeof value === 'object') {
    if (typeof value.toDate === 'function') {
      const dt = value.toDate();
      return Number.isNaN(dt.getTime()) ? fallback : dt.toISOString();
    }
    if (typeof value._seconds === 'number') {
      return new Date((value._seconds * 1000) + Math.round((value._nanoseconds || 0) / 1e6)).toISOString();
    }
  }
  return fallback;
}

function normalizeBirthDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const ddmmyyyy = raw.match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{4})$/);
  if (ddmmyyyy) {
    const [, dd, mm, yyyy] = ddmmyyyy;
    return `${yyyy}-${mm}-${dd}`;
  }

  const yyyymmdd = raw.match(/^(\d{4})[\/\-](\d{2})[\/\-](\d{2})$/);
  if (yyyymmdd) {
    const [, yyyy, mm, dd] = yyyymmdd;
    return `${yyyy}-${mm}-${dd}`;
  }

  return null;
}

function normalizeMotherName(value) {
  const name = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  return name || null;
}

function normalizeGenderCode(value) {
  const normalized = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();

  if (!normalized) return null;
  if (['F', 'FEMININO', 'FEMALE', 'MULHER'].includes(normalized)) return 'F';
  if (['M', 'MASCULINO', 'MALE', 'HOMEM'].includes(normalized)) return 'M';
  if (['X', 'OUTRO', 'OTHER', 'N', 'NB', 'NAO BINARIO', 'NAO-BINARIO', 'NON BINARY'].includes(normalized)) return 'X';
  return null;
}

function genderCodeToLabel(code) {
  if (code === 'F') return 'Feminino';
  if (code === 'M') return 'Masculino';
  if (code === 'X') return 'Outro';
  return null;
}

function resolveDriverProfileProjection({
  canonicalProfile = {},
  realtimeUser = {},
  documents = {},
  canonicalCnhData = null
} = {}) {
  const mirroredCnhData =
    documents?.cnh?.extractedData ||
    documents?.cnh?.analysisData ||
    {};
  const cnhData = canonicalCnhData && typeof canonicalCnhData === 'object'
    ? canonicalCnhData
    : mirroredCnhData;

  const canonicalFirstName = firstText(canonicalProfile?.firstName);
  const canonicalLastName = firstText(canonicalProfile?.lastName);
  const realtimeFirstName = firstText(realtimeUser?.firstName);
  const realtimeLastName = firstText(realtimeUser?.lastName);

  return {
    name: firstText(
      canonicalProfile?.name,
      canonicalProfile?.fullName,
      canonicalProfile?.displayName,
      [canonicalFirstName, canonicalLastName].filter(Boolean).join(' '),
      realtimeUser?.name,
      realtimeUser?.fullName,
      realtimeUser?.displayName,
      [realtimeFirstName, realtimeLastName].filter(Boolean).join(' '),
      cnhData?.nome,
      cnhData?.name
    ),
    email: firstText(canonicalProfile?.email, realtimeUser?.email),
    phone: firstText(
      canonicalProfile?.mobile,
      canonicalProfile?.phone,
      canonicalProfile?.phoneNumber,
      realtimeUser?.mobile,
      realtimeUser?.phone,
      realtimeUser?.phoneNumber
    ),
    cpf: firstText(
      canonicalProfile?.cpf,
      canonicalProfile?.document,
      canonicalProfile?.documentNumber,
      realtimeUser?.cpf,
      realtimeUser?.document,
      realtimeUser?.documentNumber,
      cnhData?.cpf
    ),
    birthDate: firstText(
      canonicalProfile?.birthDate,
      canonicalProfile?.dateOfBirth,
      canonicalProfile?.dob,
      canonicalProfile?.dataNascimento,
      realtimeUser?.birthDate,
      realtimeUser?.dateOfBirth,
      realtimeUser?.dob,
      realtimeUser?.dataNascimento,
      cnhData?.dataNascimento,
      cnhData?.birthDate,
      cnhData?.dateOfBirth
    ),
    motherName: firstText(
      canonicalProfile?.motherName,
      canonicalProfile?.nomeMae,
      canonicalProfile?.nomeDaMae,
      realtimeUser?.motherName,
      realtimeUser?.nomeMae,
      realtimeUser?.nomeDaMae,
      cnhData?.nomeMae,
      cnhData?.nomeDaMae,
      cnhData?.motherName
    ),
    gender: firstText(
      canonicalProfile?.gender,
      canonicalProfile?.genero,
      realtimeUser?.gender,
      realtimeUser?.genero,
      cnhData?.genero,
      cnhData?.sexo,
      cnhData?.gender,
      cnhData?.sex
    ),
    city: firstText(canonicalProfile?.city, realtimeUser?.city),
    state: firstText(canonicalProfile?.state, realtimeUser?.state),
    registrationDate: toIso(canonicalProfile?.createdAt) || toIso(realtimeUser?.createdAt)
  };
}

function resolveDriverIdentityData(userData = {}, documents = {}) {
  const cnhExtracted = documents?.cnh?.extractedData || {};
  const cnhIdentity = documents?.cnh?.extractedIdentity || {};

  const birthDate = normalizeBirthDate(
    userData?.birthDate ||
      userData?.dateOfBirth ||
      userData?.dob ||
      userData?.dataNascimento ||
      cnhExtracted?.dataNascimento ||
      cnhExtracted?.birthDate ||
      cnhExtracted?.dateOfBirth ||
      cnhIdentity?.birthDate ||
      null
  );

  const motherName = normalizeMotherName(
    userData?.motherName ||
      userData?.nomeMae ||
      userData?.nomeDaMae ||
      cnhExtracted?.nomeMae ||
      cnhExtracted?.nome_da_mae ||
      cnhExtracted?.nomeDaMae ||
      cnhExtracted?.mae ||
      cnhExtracted?.motherName ||
      cnhExtracted?.filiacaoMae ||
      cnhExtracted?.filiacao?.mae ||
      cnhIdentity?.motherName ||
      null
  );

  const gender = normalizeGenderCode(
    userData?.gender ||
      userData?.genero ||
      cnhExtracted?.genero ||
      cnhExtracted?.sexo ||
      cnhExtracted?.gender ||
      cnhExtracted?.sex ||
      cnhIdentity?.gender ||
      null
  );

  return {
    birthDate,
    motherName,
    gender,
    genderLabel: genderCodeToLabel(gender)
  };
}

function buildCarsByDriverId(cars = {}) {
  const carsByDriverId = {};
  Object.entries(cars || {}).forEach(([carId, carValue]) => {
    if (!carValue || typeof carValue !== 'object') return;
    const ownerId = String(carValue.driver || carValue.userId || '').trim();
    if (!ownerId) return;
    if (!Array.isArray(carsByDriverId[ownerId])) {
      carsByDriverId[ownerId] = [];
    }
    carsByDriverId[ownerId].push({ id: carId, ...carValue });
  });
  return carsByDriverId;
}

function sortApplications(applications, sortBy = 'submissionDate', sortOrder = 'desc') {
  const sortDirection = String(sortOrder).toLowerCase() === 'asc' ? 1 : -1;
  const normalizedSortBy = String(sortBy || 'submissionDate').toLowerCase();
  return applications.sort((a, b) => {
    if (normalizedSortBy === 'status') {
      return String(a.status || '').localeCompare(String(b.status || '')) * sortDirection;
    }
    if (normalizedSortBy === 'name') {
      return String(a?.driver?.name || '').localeCompare(String(b?.driver?.name || '')) * sortDirection;
    }
    const aTs = new Date(a?.submissionDate || 0).getTime();
    const bTs = new Date(b?.submissionDate || 0).getTime();
    return (aTs - bTs) * sortDirection;
  });
}

function filterApplications(applications, { status, dateRange }) {
  let next = Array.isArray(applications) ? applications.slice() : [];

  if (status && status !== 'all') {
    next = next.filter((app) => app.status === status);
  }

  if (dateRange) {
    const [startDate, endDate] = String(dateRange).split(',');
    if (startDate && endDate) {
      next = next.filter((app) => {
        const createdDate = new Date(app.submissionDate);
        return createdDate >= new Date(startDate) && createdDate <= new Date(endDate);
      });
    }
  }

  return next;
}

function normalizeReviewQueueStatus(value) {
  const normalized = String(value || 'pending').trim().toLowerCase();
  if (normalized === 'all') return 'all';
  return REVIEWABLE_DOCUMENT_STATUSES.has(normalized) ? normalized : 'pending';
}

function normalizeReviewQueueSortField(value) {
  const normalized = String(value || 'uploadedAt').trim();
  return ['uploadedAt', 'updatedAt', 'reviewedAt'].includes(normalized) ? normalized : 'uploadedAt';
}

function normalizeReviewQueueSortOrder(value) {
  return String(value || 'desc').trim().toLowerCase() === 'asc' ? 'asc' : 'desc';
}

function parseTimestampValue(value) {
  if (!value) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

class DriverApplicationService {
  constructor() {
    this.firestore = null;
    this.realtimeDb = null;
  }

  getFirestore() {
    if (!this.firestore) this.firestore = getFirestoreOrThrow();
    return this.firestore;
  }

  getRealtimeDb() {
    if (!this.realtimeDb) this.realtimeDb = getRealtimeDbOrThrow();
    return this.realtimeDb;
  }

  collection() {
    return this.getFirestore().collection(COLLECTION);
  }

  async ensureApplicationPersistenceScope(application = {}) {
    const driverId = normalizeId(application.driverId || application.id || application.driver?.id);
    if (!driverId) {
      throw new Error('Driver application sem identificador para classificação de persistência');
    }
    const scope = await resolveUserPersistenceScope({ userId: driverId });
    const persistenceScope = normalizeApplicationPersistenceScope({
      namespace: scope?.namespace,
      financialContextId: scope?.financialContextId
    });
    if (!persistenceScope) {
      throw new Error('Classificação de persistência indisponível para driver application');
    }
    const existing = normalizeApplicationPersistenceScope(application.persistenceScope);
    if (
      !existing ||
      existing.namespace !== persistenceScope.namespace ||
      existing.financialContextId !== persistenceScope.financialContextId
    ) {
      await this.collection().doc(driverId).set({ persistenceScope }, { merge: true });
    }
    return { ...application, persistenceScope };
  }

  async buildApplication(driverId, {
    db = null,
    userData = null,
    canonicalProfileData = null,
    canonicalCnhData = null,
    carsByDriverId = null,
    userVehiclesRaw = null,
    vehiclesRaw = null,
    ratingsRaw = null
  } = {}) {
    const realtimeDb = db || this.getRealtimeDb();
    const safeDriverId = normalizeId(driverId);
    if (!safeDriverId) return null;

    const user = userData || (await realtimeDb.ref(`users/${safeDriverId}`).once('value')).val();
    if (!user || typeof user !== 'object') return null;
    const canonicalProfile = canonicalProfileData && typeof canonicalProfileData === 'object'
      ? canonicalProfileData
      : {};
    const userType = normalizeProfileUserType(canonicalProfile) || normalizeProfileUserType(user);
    if (userType !== 'driver') return null;

    let carsIndex = carsByDriverId;
    if (!carsIndex) {
      const carsSnapshot = await realtimeDb.ref('cars').once('value');
      carsIndex = buildCarsByDriverId(carsSnapshot.val() || {});
    }

    const userCar = (carsIndex[safeDriverId] && carsIndex[safeDriverId][0]) || null;
    const documents = user?.documents && typeof user.documents === 'object' ? user.documents : {};

    let resolvedUserVehiclesRaw = userVehiclesRaw;
    let resolvedVehiclesRaw = vehiclesRaw;
    if (!resolvedUserVehiclesRaw) {
      const snapshot = await realtimeDb.ref(`user_vehicles/${safeDriverId}`).once('value');
      resolvedUserVehiclesRaw = snapshot.val() || {};
    }
    if (!resolvedVehiclesRaw) {
      const linkedVehicleIds = [...new Set(
        Object.values(resolvedUserVehiclesRaw)
          .map((entry) => entry?.vehicleId)
          .filter(Boolean)
          .map((value) => String(value))
      )];
      const vehicleSnapshots = await Promise.all(
        linkedVehicleIds.map((vehicleId) => realtimeDb.ref(`vehicles/${vehicleId}`).once('value'))
      );
      resolvedVehiclesRaw = {};
      vehicleSnapshots.forEach((snapshot, index) => {
        if (!snapshot?.exists()) return;
        resolvedVehiclesRaw[linkedVehicleIds[index]] = snapshot.val() || {};
      });
    }

    let applicationStatus = 'pending';
    const hasExplicitRejection =
      user.status === 'rejected' ||
      user.kycStatus === 'rejected' ||
      user.rejectedAt ||
      user.rejectionReason ||
      (Array.isArray(user.rejectionReasons) && user.rejectionReasons.length > 0);

    if (user.approved === true) {
      applicationStatus = 'approved';
    } else if (hasExplicitRejection) {
      applicationStatus = 'rejected';
    } else if (
      documents.cnh ||
      documents.crlv ||
      documents.antecedentes_criminais ||
      user.licenseImage ||
      user.verifyIdImage
    ) {
      applicationStatus = 'in_review';
    }

    const normalizedDocuments = {
      license: {
        front: documents.cnh?.fileUrl || user.licenseImage || null,
        back: documents.cnh_verso?.fileUrl || user.licenseImageBack || null,
        status: documents.cnh
          ? documents.cnh.status
          : (user.licenseImage ? (user.approved ? 'approved' : 'pending') : 'missing'),
        uploadedAt: documents.cnh?.uploadedAt || null,
        type: documents.cnh?.fileType || null
      },
      identity: {
        front: documents.comprovante_residencia?.fileUrl || user.verifyIdImage || null,
        back: documents.identidade_verso?.fileUrl || user.verifyIdImageBack || null,
        status: documents.comprovante_residencia
          ? documents.comprovante_residencia.status
          : (user.verifyIdImage ? (user.approved ? 'approved' : 'pending') : 'missing'),
        uploadedAt: documents.comprovante_residencia?.uploadedAt || null,
        type: documents.comprovante_residencia?.fileType || null
      },
      vehicle: {
        registration: documents.crlv?.fileUrl || userCar?.vehicleRegistration || null,
        insurance: documents.seguro?.fileUrl || userCar?.vehicleInsurance || null,
        photos: userCar?.carImage || null,
        status: documents.crlv
          ? documents.crlv.status
          : (userCar ? (user.approved ? 'approved' : 'pending') : 'missing'),
        uploadedAt: documents.crlv?.uploadedAt || null,
        type: documents.crlv?.fileType || null
      },
      backgroundCheck: {
        fileUrl: documents.antecedentes_criminais?.fileUrl || null,
        contentAvailable: isDocumentContentAvailable(
          safeDriverId,
          'antecedentes_criminais',
          documents.antecedentes_criminais
        ),
        status: documents.antecedentes_criminais?.status || 'missing',
        uploadedAt: documents.antecedentes_criminais?.uploadedAt || null,
        type: documents.antecedentes_criminais?.fileType || null
      },
      all_documents: Object.keys(documents).map((docType) => ({
        type: docType,
        fileUrl: documents[docType]?.fileUrl || null,
        contentAvailable: isDocumentContentAvailable(safeDriverId, docType, documents[docType]),
        status: documents[docType]?.status || 'pending',
        uploadedAt: documents[docType]?.uploadedAt || null,
        fileType: documents[docType]?.fileType || null,
        rejectionReason: documents[docType]?.rejectionReason || null,
        extractedData: documents[docType]?.extractedData || null,
        extractedIdentity: documents[docType]?.extractedIdentity || null
      }))
    };

    const profileProjection = resolveDriverProfileProjection({
      canonicalProfile,
      realtimeUser: user,
      documents,
      canonicalCnhData
    });
    const driverIdentity = resolveDriverIdentityData(profileProjection, documents);

    const userVehicleEntries = Object.keys(resolvedUserVehiclesRaw).map((userVehicleId) => {
      const userVehicle = resolvedUserVehiclesRaw[userVehicleId] || {};
      const linkedVehicle = userVehicle.vehicleId ? (resolvedVehiclesRaw[userVehicle.vehicleId] || {}) : {};
      const category = linkedVehicle.manualCategory ||
        linkedVehicle.carType ||
        linkedVehicle.category ||
        userVehicle.manualCategory ||
        user.carType ||
        null;

      return {
        userVehicleId,
        vehicleId: userVehicle.vehicleId || null,
        isActive: userVehicle.isActive === true,
        status: userVehicle.status || (userVehicle.approved === true ? 'approved' : 'pending'),
        approved: userVehicle.approved === true || userVehicle.status === 'approved',
        category,
        plate: linkedVehicle.plate || linkedVehicle.vehicleNumber || linkedVehicle.vehiclePlate || null,
        brand: linkedVehicle.brand || linkedVehicle.vehicleMake || null,
        model: linkedVehicle.model || linkedVehicle.vehicleModel || null,
        year: linkedVehicle.year || linkedVehicle.manufactureYear || null,
        color:
          linkedVehicle.color ||
          linkedVehicle.vehicleColor ||
          linkedVehicle.carColor ||
          userVehicle.color ||
          userVehicle.vehicleColor ||
          null,
        identitySource:
          linkedVehicle?.ocrData?.source ||
          userVehicle?.ocrData?.source ||
          (Object.keys(linkedVehicle).length > 0 ? 'vehicles_catalog' : 'user_vehicles')
      };
    });

    const activeUserVehicle = userVehicleEntries.find((vehicle) => vehicle.isActive) || null;
    const dashboardVehicle = activeUserVehicle
      ? {
          make: activeUserVehicle.brand || '',
          model: activeUserVehicle.model || '',
          year: activeUserVehicle.year || '',
          plate: activeUserVehicle.plate || '',
          color: activeUserVehicle.color || '',
          identitySource: activeUserVehicle.identitySource || 'user_vehicles'
        }
      : userCar
        ? {
            make: userCar.carMake || '',
            model: userCar.carModel || '',
            year: userCar.carYear || '',
            plate: userCar.carNumber || '',
            color: userCar.carColor || '',
            identitySource: 'cars_legacy'
          }
        : null;
    const normalizedKycStatus = user.kycStatus ||
      user.kycOnboarding?.status ||
      (user.kycBlocked === true ? 'blocked' : null) ||
      'not_started';
    const kycPayload = user.kycOnboarding || {};

    let userRatings = [];
    if (ratingsRaw && typeof ratingsRaw === 'object') {
      userRatings = Object.entries(ratingsRaw)
        .map(([ratingId, ratingData]) => {
          const parsedRating = parseRatingValue(ratingData?.rating);
          if (parsedRating == null) return null;
          return {
            id: ratingData?.id || ratingId,
            tripId: ratingData?.tripId || null,
            reviewerId: ratingData?.reviewerId || null,
            reviewerType: ratingData?.reviewerType || null,
            rating: parsedRating,
            comment: String(ratingData?.comment || '').trim(),
            createdAt: ratingData?.createdAt || null
          };
        })
        .filter(Boolean)
        .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
    }

    const ratingCount = userRatings.length;
    const ratingAverageFromReviews = ratingCount > 0
      ? userRatings.reduce((sum, item) => sum + Number(item.rating || 0), 0) / ratingCount
      : null;
    const fallbackRating = parseRatingValue(user.driverRating || user.rating);
    const resolvedRating = ratingAverageFromReviews != null ? ratingAverageFromReviews : fallbackRating;

    return {
      id: safeDriverId,
      driverId: safeDriverId,
      driver: {
        id: safeDriverId,
        name: profileProjection.name,
        email: profileProjection.email,
        phone: profileProjection.phone,
        cpf: profileProjection.cpf,
        birthDate: driverIdentity.birthDate,
        motherName: driverIdentity.motherName,
        gender: driverIdentity.gender,
        genderLabel: driverIdentity.genderLabel,
        city: profileProjection.city,
        state: profileProjection.state,
        registrationDate: profileProjection.registrationDate,
        rating: resolvedRating != null ? Number(resolvedRating).toFixed(1) : null,
        ratingCount,
        approved: user.approved === true,
        status: user.status || (user.approved === true ? 'approved' : 'pending')
      },
      vehicle: dashboardVehicle,
      documents: normalizedDocuments,
      status: applicationStatus,
      submissionDate: profileProjection.registrationDate || new Date().toISOString(),
      reviewDate: user.approvedAt ? new Date(user.approvedAt).toISOString() : null,
      reviewedBy: user.approvedBy || null,
      rejectionReason: user.rejectionReason || null,
      notes: user.adminNotes || '',
      ratingInsights: {
        averageRating: resolvedRating != null ? Number(resolvedRating).toFixed(1) : null,
        totalRatings: ratingCount,
        latestNegativeReviews: userRatings
          .filter((item) => Number(item.rating) <= 3 && item.comment.length > 0)
          .slice(0, 10)
      },
      kyc: {
        status: normalizedKycStatus,
        blocked: user.kycBlocked === true || kycPayload.blocked === true,
        approved: normalizedKycStatus === 'approved' || kycPayload.approved === true,
        needsReview: normalizedKycStatus === 'pending_review' || kycPayload.needsReview === true,
        similarity: typeof kycPayload.similarity === 'number' ? kycPayload.similarity : null,
        message: kycPayload.message || null,
        updatedAt: user.kycUpdatedAt || kycPayload.updatedAt || null
      },
      vehicleConfig: {
        activeUserVehicleId: activeUserVehicle?.userVehicleId || null,
        activeVehicleId: activeUserVehicle?.vehicleId || null,
        activeVehiclePlate: activeUserVehicle?.plate || user.vehicleNumber || user.carPlate || null,
        activeVehicleModel: activeUserVehicle?.model || user.vehicleModel || user.carModel || null,
        activeVehicleColor: activeUserVehicle?.color || user.vehicleColor || user.carColor || null,
        activeVehicleIdentitySource: activeUserVehicle?.identitySource || null,
        category: activeUserVehicle?.category || user.carType || null,
        acceptPlusWithElite: user.acceptPlusWithElite === true || user.acceptPlusRides === true || user.receivePlusRides === true,
        vehicles: userVehicleEntries
      },
      totalDocuments: Object.keys(normalizedDocuments).length,
      source: canonicalProfileData ? 'firestore_profile_rtdb_activation' : 'rtdb_mirror',
      syncedAt: new Date().toISOString()
    };
  }

  async syncDriverApplication(driverId, { db = null, includeRatings = false } = {}) {
    const realtimeDb = db || this.getRealtimeDb();
    const safeDriverId = normalizeId(driverId);
    if (!safeDriverId) return null;

    const [ratingsSnapshot, canonicalProfileSnapshot, canonicalCnhSnapshot] = await Promise.all([
      includeRatings
        ? realtimeDb.ref(`user_ratings/${safeDriverId}`).once('value')
        : Promise.resolve(null),
      this.getFirestore().collection('users').doc(safeDriverId).get(),
      realtimeDb.ref(`driver_activation/${safeDriverId}/documents/cnh`).once('value')
    ]);
    const canonicalCnhNode = canonicalCnhSnapshot?.val?.() || {};
    const application = await this.buildApplication(safeDriverId, {
      db: realtimeDb,
      ratingsRaw: ratingsSnapshot?.val?.() || null,
      canonicalProfileData: canonicalProfileSnapshot?.exists
        ? canonicalProfileSnapshot.data() || {}
        : null,
      canonicalCnhData: canonicalCnhNode?.data || canonicalCnhNode?.extractedData || null
    });
    if (!application) return null;

    await this.collection().doc(safeDriverId).set({
      ...application,
      syncedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    return application;
  }

  async syncAllDriverApplications({ db = null } = {}) {
    const realtimeDb = db || this.getRealtimeDb();
    const [usersSnapshot, carsSnapshot, userVehiclesSnapshot, vehiclesSnapshot] = await Promise.all([
      realtimeDb.ref('users').orderByChild('usertype').equalTo('driver').once('value'),
      realtimeDb.ref('cars').once('value'),
      realtimeDb.ref('user_vehicles').once('value'),
      realtimeDb.ref('vehicles').once('value')
    ]);

    const users = usersSnapshot.val() || {};
    const carsByDriverId = buildCarsByDriverId(carsSnapshot.val() || {});
    const allUserVehicles = userVehiclesSnapshot.val() || {};
    const allVehicles = vehiclesSnapshot.val() || {};

    const applications = [];
    for (const driverId of Object.keys(users)) {
      const application = await this.buildApplication(driverId, {
        db: realtimeDb,
        userData: users[driverId],
        carsByDriverId,
        userVehiclesRaw: allUserVehicles[driverId] || {},
        vehiclesRaw: allVehicles
      });
      if (application) {
        applications.push(application);
      }
    }

    if (applications.length === 0) return [];

    const firestore = this.getFirestore();
    for (let index = 0; index < applications.length; index += 400) {
      const batch = firestore.batch();
      applications.slice(index, index + 400).forEach((application) => {
        batch.set(this.collection().doc(application.id), {
          ...application,
          syncedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      });
      await batch.commit();
    }

    logStructured('info', 'Espelho Firestore de driver applications sincronizado', {
      service: 'driver-application-service',
      total: applications.length
    });

    return applications;
  }

  async listApplications({
    status,
    dateRange,
    sortBy = 'submissionDate',
    sortOrder = 'desc',
    page = 1,
    limit = 20,
    persistenceScope = 'operational'
  } = {}) {
    let snapshot = await this.collection().get();
    let applications = snapshot.docs.map((doc) => doc.data() || {});

    if (applications.length === 0) {
      applications = await this.syncAllDriverApplications({});
    }
    const requestedPersistenceScope = String(persistenceScope || '').trim().toLowerCase();
    if (!['operational', 'sandbox'].includes(requestedPersistenceScope)) {
      throw new Error('Escopo de persistência inválido para aplicações de motoristas');
    }
    const classifiedApplications = [];
    for (const application of applications) {
      classifiedApplications.push(await this.ensureApplicationPersistenceScope(application));
    }
    applications = classifiedApplications.filter(
      (application) => application.persistenceScope?.namespace === requestedPersistenceScope
    );

    applications = filterApplications(applications, { status, dateRange });
    applications = sortApplications(applications, sortBy, sortOrder);

    const totalCount = applications.length;
    const numericPage = Number.parseInt(page, 10) || 1;
    const numericLimit = Number.parseInt(limit, 10) || 20;
    const startIndex = (numericPage - 1) * numericLimit;
    const endIndex = startIndex + numericLimit;

    return {
      applications: projectDashboardApplication(applications.slice(startIndex, endIndex)),
      pagination: {
        page: numericPage,
        limit: numericLimit,
        total: totalCount,
        pages: Math.ceil(totalCount / numericLimit)
      }
    };
  }

  async getDriverApplication(driverId, { refresh = false, includeRatings = true } = {}) {
    const safeDriverId = normalizeId(driverId);
    if (!safeDriverId) return null;

    if (refresh) {
      const application = await this.syncDriverApplication(safeDriverId, { includeRatings });
      return application ? projectDashboardApplication(application) : null;
    }

    const snapshot = await this.collection().doc(safeDriverId).get();
    if (snapshot.exists) {
      return projectDashboardApplication(snapshot.data() || null);
    }

    const application = await this.syncDriverApplication(safeDriverId, { includeRatings });
    return application ? projectDashboardApplication(application) : null;
  }

  async listReviewQueue({
    documentType = 'all',
    status = 'pending',
    search = '',
    page = 1,
    limit = 25,
    sortBy = 'uploadedAt',
    sortOrder = 'desc',
    persistenceScope = 'operational'
  } = {}) {
    let snapshot = await this.collection().get();
    let applications = snapshot.docs.map((doc) => doc.data() || {});

    if (applications.length === 0) {
      applications = await this.syncAllDriverApplications({});
    }
    const requestedPersistenceScope = String(persistenceScope || '').trim().toLowerCase();
    if (!['operational', 'sandbox'].includes(requestedPersistenceScope)) {
      throw new Error('Escopo de persistência inválido para fila documental');
    }
    const classifiedApplications = [];
    for (const application of applications) {
      classifiedApplications.push(await this.ensureApplicationPersistenceScope(application));
    }
    applications = classifiedApplications.filter(
      (application) => application.persistenceScope?.namespace === requestedPersistenceScope
    );

    const selectedTypes = String(documentType || '').toLowerCase() === 'all'
      ? [...REVIEWABLE_DOCUMENT_TYPES]
      : [String(documentType || '').trim().toLowerCase()].filter((value) => REVIEWABLE_DOCUMENT_TYPES.has(value));

    const safeTypes = selectedTypes.length > 0 ? selectedTypes : [...REVIEWABLE_DOCUMENT_TYPES];
    const safeStatus = normalizeReviewQueueStatus(status);
    const safeSortBy = normalizeReviewQueueSortField(sortBy);
    const safeSortOrder = normalizeReviewQueueSortOrder(sortOrder);
    const searchText = String(search || '').trim().toLowerCase();
    const numericPage = Math.max(1, Number.parseInt(page, 10) || 1);
    const numericLimit = Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 25));

    const items = [];
    for (const application of applications) {
      const driver = application.driver || {};
      const docs = Array.isArray(application?.documents?.all_documents) ? application.documents.all_documents : [];
      for (const doc of docs) {
        const type = String(doc?.type || '').trim().toLowerCase();
        if (!REVIEWABLE_DOCUMENT_TYPES.has(type)) continue;
        if (!safeTypes.includes(type)) continue;

        const normalizedStatus = String(doc?.status || 'pending').trim().toLowerCase();
        if (!REVIEWABLE_DOCUMENT_STATUSES.has(normalizedStatus)) continue;
        const effectiveStatus = normalizedStatus;
        if (safeStatus !== 'all' && effectiveStatus !== safeStatus) continue;

        items.push({
          driverId: application.driverId || application.id,
          driver: {
            id: application.driverId || application.id,
            name: driver.name || '-',
            email: driver.email || '',
            phone: driver.phone || '',
            cpf: driver.cpf || '',
            approved: driver.approved === true,
            status: driver.status || application.status || 'pending'
          },
          documentType: type,
          status: effectiveStatus,
          fileName: doc.fileName || null,
          fileType: doc.fileType || null,
          uploadedAt: doc.uploadedAt || null,
          updatedAt: doc.updatedAt || null,
          reviewedAt: doc.reviewedAt || null,
          rejectionReason: doc.rejectionReason || null,
          requestStatus: doc.requestStatus || null,
          requiredUpdate: doc.requiredUpdate === true,
          requestedAt: doc.requestedAt || null,
          requestReason: doc.requestReason || null,
          contentAvailable: doc.contentAvailable === true,
          sortTs: parseTimestampValue(doc[safeSortBy])
        });
      }
    }

    const filtered = searchText
      ? items.filter((item) => {
          const haystack = [
            item.driverId,
            item.driver?.name,
            item.driver?.email,
            item.driver?.phone,
            item.driver?.cpf,
            item.documentType
          ].map((value) => String(value || '').toLowerCase()).join(' ');
          return haystack.includes(searchText);
        })
      : items;

    filtered.sort((a, b) => {
      const tsCompare = a.sortTs - b.sortTs;
      if (tsCompare !== 0) {
        return safeSortOrder === 'asc' ? tsCompare : -tsCompare;
      }
      const aId = `${a.driverId}:${a.documentType}:${a.status}`;
      const bId = `${b.driverId}:${b.documentType}:${b.status}`;
      return aId.localeCompare(bId);
    });

    const summary = filtered.reduce((acc, item) => {
      acc.total += 1;
      acc.byStatus[item.status] += 1;
      return acc;
    }, {
      total: 0,
      byStatus: {
        pending: 0,
        approved: 0,
        rejected: 0
      }
    });

    const offset = (numericPage - 1) * numericLimit;
    const paged = filtered.slice(offset, offset + numericLimit).map(({ sortTs, ...item }) => item);

    return {
      items: paged,
      pagination: {
        page: numericPage,
        limit: numericLimit,
        total: filtered.length,
        pages: Math.ceil(filtered.length / numericLimit)
      },
      filters: {
        documentType: safeTypes.length === REVIEWABLE_DOCUMENT_TYPES.size ? 'all' : safeTypes[0],
        status: safeStatus,
        sortBy: safeSortBy,
        sortOrder: safeSortOrder,
        search: searchText,
        persistenceScope: requestedPersistenceScope
      },
      summary
    };
  }

  async getReviewQueueSummary() {
    const db = this.getRealtimeDb();
    const snapshot = await db.ref('driver_documents_index_stats').once('value');
    const statsByType = snapshot.val() || {};
    const byStatus = {
      pending: 0,
      approved: 0,
      rejected: 0
    };

    Object.values(statsByType).forEach((typeStats) => {
      if (!typeStats || typeof typeStats !== 'object') return;
      byStatus.pending += Number.parseInt(typeStats.pending, 10) || 0;
      byStatus.approved += Number.parseInt(typeStats.approved, 10) || 0;
      byStatus.rejected += Number.parseInt(typeStats.rejected, 10) || 0;
    });

    return {
      source: 'driver_documents_index_stats',
      summary: {
        total: byStatus.pending + byStatus.approved + byStatus.rejected,
        byStatus
      }
    };
  }
}

module.exports = new DriverApplicationService();
