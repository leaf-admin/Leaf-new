import apiClient from '../httpClient';

function normalizeReferralType(value) {
  const safeType = String(value || '').trim().toLowerCase();
  if (safeType === 'driver') return 'driver_referral';
  if (safeType === 'passenger') return 'passenger_referral';
  if (['driver_referral', 'passenger_referral', 'founder_wave'].includes(safeType)) {
    return safeType;
  }
  return 'passenger_referral';
}

function normalizeStatus(value) {
  return String(value || 'pending').trim().toLowerCase();
}

function normalizeInvite(raw = {}) {
  const qualification = raw.qualification && typeof raw.qualification === 'object'
    ? raw.qualification
    : null;

  return {
    id: String(raw.id || raw.inviteId || raw.code || '').trim(),
    code: String(raw.code || raw.invite_code || '').trim(),
    type: normalizeReferralType(raw.type),
    status: normalizeStatus(raw.status),
    inviterId: String(raw.inviterId || raw.inviter_id || '').trim(),
    inviteeId: String(raw.inviteeId || raw.invitee_id || '').trim(),
    inviteeEmail: String(raw.inviteeEmail || raw.invitee_email || '').trim(),
    inviteePhone: String(raw.inviteePhone || raw.invitee_phone || '').trim(),
    discountPercent: Number(raw.discountPercent || 0) || 0,
    maxDiscountRides: Number(raw.maxDiscountRides || 0) || 0,
    requiredCompletedTrips: Number(raw.requiredCompletedTrips || 0) || 0,
    rewardMonths: Number(raw.rewardMonths || 0) || 0,
    qualificationWindowDays: Number(raw.qualificationWindowDays || 0) || 0,
    qualification,
    acceptedBy: String(raw.acceptedBy || raw.accepted_by || '').trim(),
    acceptedAt: raw.acceptedAt || raw.accepted_at || null,
    expiresAt: raw.expiresAt || raw.expires_at || null,
    createdAt: raw.createdAt || raw.created_at || null,
    updatedAt: raw.updatedAt || raw.updated_at || null,
  };
}

function normalizeInviteList(items = []) {
  return Array.isArray(items) ? items.map(normalizeInvite).filter((invite) => invite.id || invite.code) : [];
}

export async function loadMyReferralInvites() {
  const response = await apiClient.get('/api/programs/referrals/invites/me');
  const payload = response?.data || {};
  return {
    sent: normalizeInviteList(payload.sent),
    received: normalizeInviteList(payload.received),
    userId: payload.userId || null,
  };
}

export async function createReferralInvite({ type = 'passenger', inviteeEmail = '', inviteePhone = '' } = {}) {
  const normalizedType = type === 'driver' ? 'driver' : 'passenger';
  const response = await apiClient.post(
    `/api/programs/referrals/invites/${normalizedType}`,
    {
      inviteeEmail: String(inviteeEmail || '').trim(),
      inviteePhone: String(inviteePhone || '').trim(),
    },
  );

  return {
    invite: normalizeInvite(response?.data?.invite || {}),
    usage: response?.data?.usage || null,
  };
}

export async function acceptReferralInvite(code) {
  const response = await apiClient.post('/api/programs/referrals/invites/accept', {
    code: String(code || '').trim(),
  });

  return {
    invite: normalizeInvite(response?.data?.invite || {}),
    passengerBenefit: response?.data?.passengerBenefit || null,
  };
}

export const referralProgramUtils = {
  normalizeInvite,
  normalizeInviteList,
  normalizeReferralType,
};
