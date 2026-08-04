const { isPilotControlledLaunch } = require('../utils/pilot-launch-flags');

const TRUTHY_VALUES = new Set(['1', 'true', 'yes', 'on', 'sim']);
const FALSY_VALUES = new Set(['0', 'false', 'no', 'off', 'nao', 'não']);

function readBoolean(name, fallback) {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === '') return fallback;
  const normalized = String(raw).trim().toLowerCase();
  if (TRUTHY_VALUES.has(normalized)) return true;
  if (FALSY_VALUES.has(normalized)) return false;
  return fallback;
}

function parseAllowlist(value) {
  const raw = String(value || '').trim();
  if (!raw) return new Set();

  if (raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return new Set(parsed.map((item) => String(item || '').trim()).filter(Boolean));
      }
    } catch (_error) {
      // Fall through to comma/newline parsing so a malformed JSON value fails
      // closed as an unmatched cohort instead of breaking runtime bootstrap.
    }
  }

  return new Set(raw.split(/[\n,;]+/).map((item) => item.trim()).filter(Boolean));
}

function resolveRoleAllowlist(role) {
  const normalizedRole = String(role || '').trim().toLowerCase();
  if (normalizedRole === 'driver') {
    return parseAllowlist(
      process.env.PILOT_ALLOWED_DRIVER_IDS || process.env.LEAF_PILOT_ALLOWED_DRIVER_IDS
    );
  }

  return parseAllowlist(
    process.env.PILOT_ALLOWED_PASSENGER_IDS || process.env.LEAF_PILOT_ALLOWED_PASSENGER_IDS
  );
}

function resolvePassengerAccessMode() {
  const normalized = String(process.env.PILOT_PASSENGER_ACCESS_MODE || 'cohort')
    .trim()
    .toLowerCase();

  if (normalized === 'broad') {
    return 'broad';
  }

  return 'cohort';
}

function isPassengerCohortRequired() {
  return resolvePassengerAccessMode() !== 'broad';
}

function resolveDriverCohortMaxSize() {
  const parsed = Number.parseInt(process.env.PILOT_MAX_DRIVER_COHORT_SIZE || '250', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 250;
}

function evaluatePilotAccess({ userId, role = 'passenger', operation = 'booking' } = {}) {
  if (!isPilotControlledLaunch()) {
    return { allowed: true, code: 'PILOT_CONTROL_NOT_ACTIVE' };
  }

  const normalizedOperation = String(operation || 'booking').trim().toLowerCase();
  if (normalizedOperation === 'payment' && !readBoolean('LEAF_ACCEPT_NEW_PIX', true)) {
    return {
      allowed: false,
      code: 'NEW_PIX_PAUSED',
      retryable: true,
      message: 'Novos pagamentos estão temporariamente pausados.'
    };
  }

  if (normalizedOperation === 'booking' && !readBoolean('LEAF_ACCEPT_NEW_BOOKINGS', true)) {
    return {
      allowed: false,
      code: 'NEW_BOOKINGS_PAUSED',
      retryable: true,
      message: 'Novas solicitações estão temporariamente pausadas.'
    };
  }

  const normalizedRole = String(role || 'passenger').trim().toLowerCase();
  if (normalizedRole === 'passenger' && !isPassengerCohortRequired()) {
    return {
      allowed: true,
      code: 'PILOT_PASSENGER_BROAD_ACCESS'
    };
  }

  const allowlist = resolveRoleAllowlist(role);
  if (normalizedRole === 'driver' && allowlist.size > resolveDriverCohortMaxSize()) {
    return {
      allowed: false,
      code: 'PILOT_DRIVER_COHORT_LIMIT_EXCEEDED',
      retryable: false,
      message: 'A configuração do grupo de motoristas excede o limite da operação assistida.'
    };
  }
  if (allowlist.size === 0) {
    return {
      allowed: false,
      code: 'PILOT_COHORT_NOT_CONFIGURED',
      retryable: false,
      message: 'Cohort do piloto não configurado.'
    };
  }

  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId || !allowlist.has(normalizedUserId)) {
    return {
      allowed: false,
      code: 'PILOT_COHORT_ACCESS_DENIED',
      retryable: false,
      message: 'Usuário fora do cohort autorizado para o piloto.'
    };
  }

  return { allowed: true, code: 'PILOT_COHORT_ALLOWED' };
}

function getPublicPilotAccessSnapshot() {
  const passengerAllowlist = resolveRoleAllowlist('passenger');
  const driverAllowlist = resolveRoleAllowlist('driver');
  const passengerAccessMode = resolvePassengerAccessMode();

  return {
    pilotControlled: isPilotControlledLaunch(),
    acceptNewBookings: readBoolean('LEAF_ACCEPT_NEW_BOOKINGS', true),
    acceptNewPix: readBoolean('LEAF_ACCEPT_NEW_PIX', true),
    passengerAccessMode,
    passengerCohortRequired: passengerAccessMode !== 'broad',
    passengerCohortConfigured: passengerAllowlist.size > 0,
    passengerCohortSize: passengerAllowlist.size,
    driverCohortConfigured: driverAllowlist.size > 0,
    driverCohortSize: driverAllowlist.size,
    driverCohortMaxSize: resolveDriverCohortMaxSize(),
    regionIds: String(process.env.PILOT_REGION_IDS || '')
      .split(/[\n,;]+/)
      .map((item) => item.trim())
      .filter(Boolean),
    financialPolicyVersion: String(process.env.LEAF_APPROVED_FINANCIAL_POLICY_ID || '').trim() || null,
    runtimePolicyVersion: String(process.env.LEAF_RUNTIME_POLICY_VERSION || '').trim() || null
  };
}

module.exports = {
  evaluatePilotAccess,
  getPublicPilotAccessSnapshot,
  isPassengerCohortRequired,
  parseAllowlist
};
