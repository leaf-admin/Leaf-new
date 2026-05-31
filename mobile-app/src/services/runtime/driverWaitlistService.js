import apiClient from '../httpClient';
import FCMNotificationService from '../FCMNotificationService';

const DEFAULT_CITY = 'Rio de Janeiro';

function normalizeNumber(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeCity(raw = {}, fallbackCity = DEFAULT_CITY) {
  if (typeof raw === 'string') {
    return {
      cityKey: raw,
      cityLabel: raw,
      stateCode: 'RJ',
    };
  }

  return {
    cityKey: String(raw.cityKey || raw.key || fallbackCity || DEFAULT_CITY).trim(),
    cityLabel: String(raw.cityLabel || raw.label || raw.name || fallbackCity || DEFAULT_CITY).trim(),
    stateCode: String(raw.stateCode || raw.state || 'RJ').trim(),
    cityActive: raw.cityActive !== false,
    stateEnabled: raw.stateEnabled !== false,
    pendingDrivers: normalizeNumber(raw.pendingDrivers, null),
    approvedDrivers: normalizeNumber(raw.approvedDrivers, null),
  };
}

function normalizeDocumentsStatus(raw = {}) {
  return {
    cnhUploaded: raw.cnhUploaded === true,
    vehicleRegistered: raw.vehicleRegistered === true,
    documentsComplete: raw.documentsComplete === true,
  };
}

function normalizeWaitlistStatus(raw = {}, fallbackCity = DEFAULT_CITY) {
  const city = normalizeCity(raw.city, fallbackCity);
  const maxActiveDrivers = normalizeNumber(raw.maxActiveDrivers, null);
  const currentActiveDrivers = normalizeNumber(raw.currentActiveDrivers, null);
  const availableSlots =
    Number.isFinite(maxActiveDrivers) && Number.isFinite(currentActiveDrivers)
      ? Math.max(0, maxActiveDrivers - currentActiveDrivers)
      : null;

  return {
    ...raw,
    waitListStatus: String(raw.waitListStatus || raw.status || 'none').trim().toLowerCase(),
    isApproved: raw.isApproved === true,
    isActiveDriver: raw.isActiveDriver === true,
    position: normalizeNumber(raw.position ?? raw.waitListPosition, null),
    estimatedWaitTime: normalizeNumber(raw.estimatedWaitTime, null),
    maxActiveDrivers,
    currentActiveDrivers,
    availableSlots,
    waitListEnabled: raw.waitListEnabled !== false,
    city,
    documentsStatus: normalizeDocumentsStatus(raw.documentsStatus),
    joinedAt: raw.joinedAt || raw.waitListJoinedAt || null,
    priority: String(raw.priority || 'normal').trim(),
    criteria: {
      cityActive: city.cityActive !== false && city.stateEnabled !== false,
      waitListEnabled: raw.waitListEnabled !== false,
      hasCapacity: availableSlots === null ? null : availableSlots > 0,
      documentsComplete: raw.documentsStatus?.documentsComplete === true,
      cnhUploaded: raw.documentsStatus?.cnhUploaded === true,
      vehicleRegistered: raw.documentsStatus?.vehicleRegistered === true,
    },
  };
}

function getCurrentFcmToken() {
  try {
    return FCMNotificationService.getCurrentToken?.() || '';
  } catch (_error) {
    return '';
  }
}

export async function loadDriverWaitlistStatus() {
  const response = await apiClient.get('/api/waitlist/status');
  return normalizeWaitlistStatus(response?.data || {});
}

export async function joinDriverWaitlist({ city = 'Rio de Janeiro', notes = '' } = {}) {
  const response = await apiClient.post('/api/waitlist/join', {
    city,
    notes,
    priority: 'normal',
    fcmToken: getCurrentFcmToken() || undefined,
    notificationDeepLink: 'leafapp://robotaxi/driver/waitlist/status',
  });
  return normalizeWaitlistStatus(
    {
      ...(response?.data || {}),
      waitListStatus: 'pending',
    },
    city,
  );
}

export async function leaveDriverWaitlist() {
  const response = await apiClient.delete('/api/waitlist/leave');
  return response?.data || {};
}

export const driverWaitlistUtils = {
  normalizeWaitlistStatus,
};
