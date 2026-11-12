// Pacote de dados de um incidente de emergência: o que a central de atendimento (equipe Leaf
// hoje, 190 quando houver termo de cooperação) precisa para agir. Montado a partir do estado da
// corrida no Redis e dos perfis no Firestore, sem chamadas pagas. Nunca derruba o fluxo de
// emergência: qualquer falha vira campo nulo e um aviso em `warnings`.
const userStore = require('./user-store');

const PACKAGE_VERSION = 1;

function firstText(...values) {
  for (const value of values) {
    const text = typeof value === 'string' ? value.trim() : (value == null ? '' : String(value).trim());
    if (text) return text;
  }
  return null;
}

function parseJsonSafe(value, fallback = null) {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string' || !value.trim()) return fallback;
  try {
    return JSON.parse(value);
  } catch (_error) {
    return fallback;
  }
}

function participantId(value) {
  const parsed = parseJsonSafe(value, value);
  if (!parsed) return null;
  if (typeof parsed === 'object') {
    return firstText(parsed.id, parsed.uid, parsed.userId, parsed.customerId, parsed.driverId);
  }
  return firstText(parsed);
}

function toPoint(value) {
  const parsed = parseJsonSafe(value, value);
  if (!parsed || typeof parsed !== 'object') return null;
  const lat = Number(parsed.lat ?? parsed.latitude ?? parsed.location?.lat ?? parsed.location?.latitude);
  const lng = Number(parsed.lng ?? parsed.longitude ?? parsed.lon ?? parsed.location?.lng ?? parsed.location?.longitude);
  const address = firstText(parsed.add, parsed.address, parsed.formattedAddress, parsed.label, parsed.name);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return address ? { address } : null;
  }
  return { lat, lng, ...(address ? { address } : {}) };
}

function toIsoTimestamp(value) {
  if (value == null || value === '') return null;
  const numeric = Number(value);
  const date = Number.isFinite(numeric) && String(value).trim() !== '' && !Number.isNaN(numeric)
    ? new Date(numeric)
    : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// Posição mais recente da viagem: a que o app do motorista manda durante a corrida.
function tripStreamLocation(meta = {}) {
  const point = toPoint({ lat: meta.canonicalLastLat, lng: meta.canonicalLastLng });
  if (!point || point.lat == null) return null;
  return {
    lat: point.lat,
    lng: point.lng,
    capturedAt: toIsoTimestamp(meta.canonicalLastReceivedAt),
    source: 'trip_stream'
  };
}

function reportedLocation(location, now) {
  const point = toPoint(location);
  if (!point || point.lat == null) return null;
  const accuracy = Number(location?.accuracy ?? location?.coords?.accuracy);
  return {
    lat: point.lat,
    lng: point.lng,
    ...(Number.isFinite(accuracy) && accuracy >= 0 ? { accuracyMeters: Math.round(accuracy) } : {}),
    capturedAt: toIsoTimestamp(location?.capturedAt ?? location?.timestamp) || now,
    source: 'reporter_device'
  };
}

function personPhone(user = {}) {
  return firstText(user.phoneNumber, user.mobile, user.phone);
}

function personName(user = {}, fallback = null) {
  const full = firstText(
    user.fullName,
    user.displayName,
    [user.firstName, user.lastName].filter(Boolean).join(' '),
    user.name
  );
  return full || fallback;
}

function createEmergencyPackageService({
  getRedis,
  getFirestore,
  readUser = userStore.readUser,
  now = () => new Date().toISOString()
} = {}) {
  async function safeRead(label, warnings, read) {
    try {
      return await read();
    } catch (error) {
      warnings.push(`${label}_unavailable`);
      return null;
    }
  }

  async function readTripLocation(redis, bookingId, warnings) {
    if (!redis || !bookingId) return null;
    const meta = await safeRead('trip_location', warnings, () => redis.hgetall(`trip_loc_meta:${bookingId}`));
    return tripStreamLocation(meta || {});
  }

  async function buildEmergencyPackage({
    bookingId = null,
    reporterId,
    reporterType = 'passenger',
    location = null
  } = {}) {
    const generatedAt = now();
    const warnings = [];
    const redis = getRedis ? getRedis() : null;
    const firestore = getFirestore ? getFirestore() : null;

    const booking = bookingId && redis
      ? (await safeRead('booking', warnings, () => redis.hgetall(`booking:${bookingId}`))) || {}
      : {};

    const driverId = firstText(booking.driverId, participantId(booking.driver), participantId(booking.driverData));
    const passengerId = firstText(
      booking.customerId,
      participantId(booking.customer),
      booking.passengerId,
      participantId(booking.passenger)
    );

    const [driverUser, passengerUser] = await Promise.all([
      driverId && firestore ? safeRead('driver_profile', warnings, () => readUser(firestore, driverId)) : null,
      passengerId && firestore ? safeRead('passenger_profile', warnings, () => readUser(firestore, passengerId)) : null
    ]);

    const tripLocation = await readTripLocation(redis, bookingId, warnings);
    const reporterLocation = reportedLocation(location, generatedAt);

    return {
      version: PACKAGE_VERSION,
      generatedAt,
      reporter: { userId: reporterId || null, userType: reporterType || null },
      ride: bookingId
        ? {
            bookingId,
            status: firstText(booking.status, booking.state, booking.bookingStatus),
            pickup: toPoint(booking.pickupLocation || booking.pickup),
            destination: toPoint(booking.destinationLocation || booking.drop),
            acceptedAt: toIsoTimestamp(booking.acceptedAt),
            startedAt: toIsoTimestamp(booking.startedAt)
          }
        : null,
      vehicle: bookingId
        ? {
            plate: firstText(booking.vehiclePlate, booking.driverVehiclePlate, booking.plate),
            model: firstText(booking.vehicleModel, booking.driverVehicleModel, booking.carModel),
            color: firstText(booking.vehicleColor, booking.driverVehicleColor),
            category: firstText(booking.carType, booking.vehicleType)
          }
        : null,
      driver: driverId
        ? { userId: driverId, name: personName(driverUser || {}, firstText(booking.driverName)), phone: personPhone(driverUser || {}) }
        : null,
      passenger: passengerId
        ? { userId: passengerId, name: personName(passengerUser || {}, firstText(booking.customerName, booking.passengerName)), phone: personPhone(passengerUser || {}) }
        : null,
      // Prioridade: o que o celular de quem acionou mandou; depois a última posição da viagem.
      location: reporterLocation || tripLocation,
      lastTripLocation: tripLocation,
      warnings
    };
  }

  // Posição atual para quem acompanha o incidente aberto: a última da viagem, se houver.
  async function readCurrentLocation(bookingId) {
    const warnings = [];
    const redis = getRedis ? getRedis() : null;
    const location = await readTripLocation(redis, bookingId, warnings);
    return { location, warnings };
  }

  return { buildEmergencyPackage, readCurrentLocation };
}

let defaultService = null;
function getDefaultEmergencyPackageService() {
  if (!defaultService) {
    const firebaseConfig = require('../firebase-config');
    const redisPool = require('../utils/redis-pool');
    defaultService = createEmergencyPackageService({
      getRedis: () => (redisPool?.getConnection ? redisPool.getConnection() : null),
      getFirestore: () => (firebaseConfig?.getFirestore ? firebaseConfig.getFirestore() : null)
    });
  }
  return defaultService;
}

module.exports = {
  PACKAGE_VERSION,
  createEmergencyPackageService,
  getDefaultEmergencyPackageService
};
