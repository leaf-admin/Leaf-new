const DEFAULT_TIME_ZONE = String(
  process.env.PRICING_DEFAULT_TIME_ZONE
    || process.env.DEFAULT_OPERATIONS_TIMEZONE
    || process.env.LEAF_OPERATION_TIME_ZONE
    || 'America/Sao_Paulo'
).trim() || 'America/Sao_Paulo';

const NIGHT_SURCHARGE_RATE = 0.15;
const NIGHT_SURCHARGE_START_HOUR = 23;
const NIGHT_SURCHARGE_END_HOUR = 4;

function normalizeCityKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function isValidTimeZone(value) {
  const timeZone = String(value || '').trim();
  if (!timeZone) return false;

  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format();
    return true;
  } catch (_error) {
    return false;
  }
}

function parseCityTimeZoneOverrides() {
  const raw = String(process.env.PRICING_CITY_TIMEZONES_JSON || '').trim();
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    return Object.entries(parsed).reduce((overrides, [city, timeZone]) => {
      const normalizedCity = normalizeCityKey(city);
      const normalizedTimeZone = String(timeZone || '').trim();
      if (normalizedCity && isValidTimeZone(normalizedTimeZone)) {
        overrides[normalizedCity] = normalizedTimeZone;
      }
      return overrides;
    }, {});
  } catch (_error) {
    return {};
  }
}

const CITY_TIME_ZONE_OVERRIDES = parseCityTimeZoneOverrides();

function normalizeRequestedAt(value) {
  if (!value) return null;

  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function resolveTimeZone({
  timeZone,
  timezone,
  cityTimeZone,
  city,
  cityName,
  pickupLocation
} = {}) {
  const cityCandidates = [
    city,
    cityName,
    pickupLocation?.city,
    pickupLocation?.cityName,
    pickupLocation?.cityKey
  ];

  for (const cityCandidate of cityCandidates) {
    const override = CITY_TIME_ZONE_OVERRIDES[normalizeCityKey(cityCandidate)];
    if (override) return override;
  }

  const explicitCandidates = [
    timeZone,
    timezone,
    cityTimeZone,
    pickupLocation?.timeZone,
    pickupLocation?.timezone
  ];

  for (const candidate of explicitCandidates) {
    if (isValidTimeZone(candidate)) {
      return String(candidate).trim();
    }
  }

  return isValidTimeZone(DEFAULT_TIME_ZONE) ? DEFAULT_TIME_ZONE : 'UTC';
}

function getLocalHour(requestedAt, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date(requestedAt));
  const hourPart = parts.find((part) => part.type === 'hour');
  return Number.parseInt(hourPart?.value || '', 10);
}

function isWithinNightWindow(localHour) {
  if (!Number.isFinite(localHour)) return false;
  if (NIGHT_SURCHARGE_START_HOUR < NIGHT_SURCHARGE_END_HOUR) {
    return localHour >= NIGHT_SURCHARGE_START_HOUR && localHour < NIGHT_SURCHARGE_END_HOUR;
  }
  return localHour >= NIGHT_SURCHARGE_START_HOUR || localHour < NIGHT_SURCHARGE_END_HOUR;
}

function resolveNightSurcharge({
  requestedAt,
  timeZone,
  timezone,
  cityTimeZone,
  city,
  cityName,
  pickupLocation
} = {}) {
  const normalizedRequestedAt = normalizeRequestedAt(requestedAt);
  const resolvedTimeZone = resolveTimeZone({
    timeZone,
    timezone,
    cityTimeZone,
    city,
    cityName,
    pickupLocation
  });

  if (!normalizedRequestedAt) {
    return {
      applied: false,
      rate: 0,
      percentage: 0,
      amountRate: 0,
      requestedAt: null,
      timeZone: resolvedTimeZone,
      localHour: null,
      windowStartHour: NIGHT_SURCHARGE_START_HOUR,
      windowEndHour: NIGHT_SURCHARGE_END_HOUR
    };
  }

  const localHour = getLocalHour(normalizedRequestedAt, resolvedTimeZone);
  const applied = isWithinNightWindow(localHour);

  return {
    applied,
    rate: applied ? NIGHT_SURCHARGE_RATE : 0,
    percentage: applied ? NIGHT_SURCHARGE_RATE * 100 : 0,
    amountRate: NIGHT_SURCHARGE_RATE,
    requestedAt: normalizedRequestedAt,
    timeZone: resolvedTimeZone,
    localHour,
    windowStartHour: NIGHT_SURCHARGE_START_HOUR,
    windowEndHour: NIGHT_SURCHARGE_END_HOUR
  };
}

module.exports = {
  DEFAULT_TIME_ZONE,
  NIGHT_SURCHARGE_RATE,
  NIGHT_SURCHARGE_START_HOUR,
  NIGHT_SURCHARGE_END_HOUR,
  normalizeCityKey,
  normalizeRequestedAt,
  resolveTimeZone,
  isWithinNightWindow,
  resolveNightSurcharge
};
