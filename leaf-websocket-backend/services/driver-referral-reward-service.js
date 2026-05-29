const firebaseConfig = require('../firebase-config');
const referralProgramStateService = require('./referral-program-state-service');
const { logStructured } = require('../utils/logger');

const DEFAULT_DRIVER_REQUIRED_TRIPS = Number.parseInt(process.env.REFERRAL_DRIVER_REQUIRED_TRIPS || '20', 10);
const DEFAULT_DRIVER_REWARD_MONTHS = Number.parseInt(process.env.REFERRAL_DRIVER_REWARD_MONTHS || '1', 10);
const DEFAULT_DRIVER_QUALIFICATION_DAYS = Number.parseInt(process.env.REFERRAL_DRIVER_QUALIFICATION_DAYS || '30', 10);

function normalizeId(value) {
  return String(value || '').trim();
}

function nowIso() {
  return new Date().toISOString();
}

function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function parseTimestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 10_000_000_000 ? value : value * 1000;
  }

  const asNum = Number(value);
  if (Number.isFinite(asNum) && String(value).trim() !== '') {
    return asNum > 10_000_000_000 ? asNum : asNum * 1000;
  }

  if (typeof value?.toDate === 'function') {
    const ts = value.toDate().getTime();
    return Number.isFinite(ts) ? ts : null;
  }

  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : null;
}

function normalizeCampaignType(value) {
  return String(value || '').trim().toLowerCase();
}

function bookingStatusIsCompleted(status) {
  const normalized = String(status || '').toUpperCase();
  return ['COMPLETE', 'COMPLETED', 'PAID'].includes(normalized);
}

function addCompletedRideId(target, rideId, timestamp, startTs, endTs) {
  const safeRideId = normalizeId(rideId);
  if (!safeRideId) return;
  if (!Number.isFinite(timestamp)) return;
  if (timestamp < startTs) return;
  if (endTs && timestamp > endTs) return;
  target.add(safeRideId);
}

class DriverReferralRewardService {
  async collectCompletedRideIdsWithinWindow(driverId, startTs, endTs, currentBookingId = '') {
    const safeDriverId = normalizeId(driverId);
    const rideIds = new Set();

    const firestore = firebaseConfig?.getFirestore ? firebaseConfig.getFirestore() : null;
    if (firestore) {
      const snapshot = await firestore
        .collection('rides')
        .where('driverId', '==', safeDriverId)
        .get();

      snapshot.docs.forEach((doc) => {
        const ride = doc.data() || {};
        if (!bookingStatusIsCompleted(ride.status || ride.currentStatus)) return;
        const ts = parseTimestamp(
          ride.completedAt ||
          ride.paidAt ||
          ride.tripdate ||
          ride.startedAt ||
          ride.createdAt
        );
        addCompletedRideId(rideIds, doc.id || ride.bookingId || ride.rideId, ts, startTs, endTs);
      });
    }

    if (firebaseConfig?.getFromRealtimeDB) {
      const bookings = await firebaseConfig.getFromRealtimeDB('bookings') || {};
      Object.entries(bookings).forEach(([bookingId, booking]) => {
        const bookingDriver = normalizeId(booking?.driver || booking?.driverId);
        if (!bookingDriver || bookingDriver !== safeDriverId) return;
        if (!bookingStatusIsCompleted(booking?.status)) return;
        const ts = parseTimestamp(
          booking?.tripdate ||
          booking?.createdAt ||
          booking?.timestamp ||
          booking?.paidAt ||
          booking?.completedAt
        );
        addCompletedRideId(rideIds, bookingId, ts, startTs, endTs);
      });
    }

    if (currentBookingId) {
      addCompletedRideId(rideIds, currentBookingId, Date.now(), startTs, endTs);
    }

    return rideIds;
  }

  async evaluateInvite(invite, options = {}) {
    const inviteId = normalizeId(invite?.id);
    const inviteeId = normalizeId(invite?.acceptedBy || invite?.inviteeId);
    const inviterId = normalizeId(invite?.inviterId);
    if (!inviteId || !inviteeId || !inviterId) {
      return { success: false, inviteId, code: 'INVITE_IDENTIFIERS_MISSING' };
    }

    const acceptedAtTs = parseTimestamp(invite.acceptedAt || invite.createdAt) || Date.now();
    const dueAtTs =
      parseTimestamp(invite?.qualification?.dueAt) ||
      (acceptedAtTs + DEFAULT_DRIVER_QUALIFICATION_DAYS * 24 * 60 * 60 * 1000);
    const requiredTrips = toPositiveInt(
      invite?.qualification?.requiredCompletedTrips || invite.requiredCompletedTrips,
      DEFAULT_DRIVER_REQUIRED_TRIPS
    );

    const completedRideIds = await this.collectCompletedRideIdsWithinWindow(
      inviteeId,
      acceptedAtTs,
      dueAtTs,
      options.bookingId
    );
    const completedTrips = completedRideIds.size;
    const qualified = completedTrips >= requiredTrips;

    const patch = {
      updatedAt: nowIso(),
      qualification: {
        ...(invite.qualification || {}),
        status: qualified ? 'qualified' : 'tracking',
        evaluatedAt: nowIso(),
        currentCompletedTrips: completedTrips,
        requiredCompletedTrips: requiredTrips,
        dueAt: new Date(dueAtTs).toISOString(),
        lastRideId: options.bookingId || null,
      },
    };

    let reward = null;
    if (qualified && String(invite.rewardStatus || '').toLowerCase() !== 'granted') {
      const rewardMonths = toPositiveInt(invite.rewardMonths, DEFAULT_DRIVER_REWARD_MONTHS);
      const freeUntil = await referralProgramStateService.extendFreeMonthsForUser(inviterId, rewardMonths, {
        source: 'driver_referral',
        inviteId,
        inviteeId,
        grantedAt: nowIso(),
        triggeredBy: options.source || 'ride_completed',
        bookingId: options.bookingId || null,
      });

      patch.rewardStatus = 'granted';
      patch.status = 'qualified';
      patch.reward = {
        rewardMonths,
        grantedAt: nowIso(),
        grantedBy: 'system',
        inviterFreeUntil: freeUntil,
        bookingId: options.bookingId || null,
      };
      reward = patch.reward;
    }

    await referralProgramStateService.updateInvite(inviteId, patch);

    return {
      success: true,
      inviteId,
      qualified,
      completedTrips,
      requiredTrips,
      reward,
    };
  }

  async evaluateDriverRewardsForDriver(driverId, options = {}) {
    const safeDriverId = normalizeId(driverId);
    if (!safeDriverId) {
      return { success: false, code: 'DRIVER_ID_REQUIRED', evaluated: 0, rewardsGranted: 0 };
    }

    const invites = await referralProgramStateService.listInvites();
    const candidateInvites = invites.filter((invite) => {
      const type = normalizeCampaignType(invite.type);
      const status = String(invite.status || '').toLowerCase();
      const inviteeId = normalizeId(invite.acceptedBy || invite.inviteeId);
      return (
        type === 'driver_referral' &&
        inviteeId === safeDriverId &&
        ['accepted', 'qualified'].includes(status) &&
        String(invite.rewardStatus || '').toLowerCase() !== 'granted'
      );
    });

    const results = [];
    for (const invite of candidateInvites) {
      results.push(await this.evaluateInvite(invite, options));
    }

    const rewardsGranted = results.filter((result) => result?.reward).length;
    logStructured('info', 'Avaliação automática de recompensa de indicação de motorista concluída', {
      service: 'driver-referral-reward-service',
      driverId: safeDriverId,
      evaluated: results.length,
      rewardsGranted,
      bookingId: options.bookingId || null,
    });

    return {
      success: true,
      driverId: safeDriverId,
      evaluated: results.length,
      rewardsGranted,
      results,
    };
  }
}

module.exports = new DriverReferralRewardService();
