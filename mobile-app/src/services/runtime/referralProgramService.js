import apiClient from '../httpClient';

function normalizeInvite(raw = {}) {
  return {
    id: String(raw.id || raw.inviteId || raw.code || '').trim(),
    code: String(raw.code || raw.invite_code || '').trim(),
    type: String(raw.type || '').trim(),
    status: String(raw.status || 'pending').trim(),
    inviteeEmail: String(raw.inviteeEmail || raw.invitee_email || '').trim(),
    inviteePhone: String(raw.inviteePhone || raw.invitee_phone || '').trim(),
    discountPercent: Number(raw.discountPercent || 0) || 0,
    maxDiscountRides: Number(raw.maxDiscountRides || 0) || 0,
    requiredCompletedTrips: Number(raw.requiredCompletedTrips || 0) || 0,
    rewardMonths: Number(raw.rewardMonths || 0) || 0,
    createdAt: raw.createdAt || raw.created_at || null,
  };
}

function normalizeInviteList(items = []) {
  return Array.isArray(items) ? items.map(normalizeInvite) : [];
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
