const firebaseConfig = require('../firebase-config');
const { logStructured } = require('../utils/logger');

const CONFIG_COLLECTION = 'referral_program_configs';
const CONFIG_DOC_ID = 'current';
const CAMPAIGNS_COLLECTION = 'referral_campaigns';
const INVITES_COLLECTION = 'referral_invites';
const PASSENGER_BENEFITS_COLLECTION = 'passenger_discount_benefits';

const LEGACY_CONFIG_PATH = 'operations/programs/referrals/config';
const LEGACY_CAMPAIGNS_PATH = 'operations/programs/referrals/campaigns';
const LEGACY_INVITES_PATH = 'operations/programs/referrals/invites';

const LEGACY_IMPORT_ENABLED = String(
  process.env.REFERRAL_PROGRAMS_ENABLE_LEGACY_IMPORT ?? 'true'
).toLowerCase() !== 'false';
const LEGACY_MIRROR_ENABLED = String(
  process.env.REFERRAL_PROGRAMS_ENABLE_LEGACY_RTDB_MIRROR ?? 'false'
).toLowerCase() === 'true';

logStructured('info', 'Referral compatibility mode', {
  service: 'referral-program-state-service',
  legacyImportEnabled: LEGACY_IMPORT_ENABLED,
  legacyMirrorEnabled: LEGACY_MIRROR_ENABLED
});

function nowIso() {
  return new Date().toISOString();
}

function normalizeId(value) {
  return String(value || '').trim();
}

function toIso(value, fallback = null) {
  if (!value) return fallback;
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number') {
    const normalized = value > 1e12 ? value : value * 1000;
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
  }
  if (typeof value === 'object') {
    if (typeof value.toDate === 'function') {
      const parsed = value.toDate();
      return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
    }
    if (typeof value._seconds === 'number') {
      return new Date((value._seconds * 1000) + Math.round((value._nanoseconds || 0) / 1e6)).toISOString();
    }
  }
  return fallback;
}

function sortByCreatedAtDesc(rows = []) {
  return rows.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
}

function normalizeCampaign(raw = {}, fallbackId = '') {
  return {
    id: normalizeId(raw.id || fallbackId),
    name: String(raw.name || '').trim(),
    type: String(raw.type || '').trim() || 'driver_referral',
    status: String(raw.status || '').trim() || 'active',
    startAt: toIso(raw.startAt, nowIso()),
    endAt: toIso(raw.endAt, null),
    params: raw.params && typeof raw.params === 'object' ? raw.params : {},
    createdAt: toIso(raw.createdAt, nowIso()),
    createdBy: String(raw.createdBy || 'admin').trim(),
    updatedAt: toIso(raw.updatedAt, toIso(raw.createdAt, nowIso())),
    updatedBy: String(raw.updatedBy || raw.createdBy || 'admin').trim(),
    source: String(raw.source || '').trim() || 'firestore'
  };
}

function normalizeInvite(raw = {}, fallbackId = '') {
  return {
    id: normalizeId(raw.id || fallbackId),
    code: String(raw.code || '').trim(),
    type: String(raw.type || '').trim() || 'driver_referral',
    status: String(raw.status || '').trim() || 'pending',
    inviterId: normalizeId(raw.inviterId),
    inviteeId: normalizeId(raw.inviteeId),
    inviteeEmail: String(raw.inviteeEmail || '').trim(),
    inviteePhone: String(raw.inviteePhone || '').trim(),
    acceptedBy: normalizeId(raw.acceptedBy),
    acceptedAt: toIso(raw.acceptedAt, null),
    campaignId: normalizeId(raw.campaignId),
    requiredCompletedTrips: raw.requiredCompletedTrips ?? null,
    rewardMonths: raw.rewardMonths ?? null,
    qualificationWindowDays: raw.qualificationWindowDays ?? null,
    discountPercent: raw.discountPercent ?? null,
    maxDiscountRides: raw.maxDiscountRides ?? null,
    nonCumulative: raw.nonCumulative !== false,
    qualification: raw.qualification && typeof raw.qualification === 'object' ? raw.qualification : null,
    rewardStatus: raw.rewardStatus || null,
    reward: raw.reward && typeof raw.reward === 'object' ? raw.reward : null,
    createdAt: toIso(raw.createdAt, nowIso()),
    updatedAt: toIso(raw.updatedAt, toIso(raw.createdAt, nowIso())),
    source: String(raw.source || '').trim() || 'firestore'
  };
}

class ReferralProgramStateService {
  constructor() {
    this.firestore = null;
    this.legacyDb = null;
  }

  getFirestore() {
    if (!this.firestore && firebaseConfig?.getFirestore) {
      this.firestore = firebaseConfig.getFirestore();
    }
    return this.firestore;
  }

  getLegacyDb() {
    if (!this.legacyDb && firebaseConfig?.getRealtimeDB) {
      this.legacyDb = firebaseConfig.getRealtimeDB();
    }
    return this.legacyDb;
  }

  configDoc() {
    const firestore = this.getFirestore();
    if (!firestore) throw new Error('Firestore indisponível para referral programs');
    return firestore.collection(CONFIG_COLLECTION).doc(CONFIG_DOC_ID);
  }

  campaignsCollection() {
    const firestore = this.getFirestore();
    if (!firestore) throw new Error('Firestore indisponível para referral programs');
    return firestore.collection(CAMPAIGNS_COLLECTION);
  }

  invitesCollection() {
    const firestore = this.getFirestore();
    if (!firestore) throw new Error('Firestore indisponível para referral programs');
    return firestore.collection(INVITES_COLLECTION);
  }

  passengerBenefitsCollection() {
    const firestore = this.getFirestore();
    if (!firestore) throw new Error('Firestore indisponível para referral programs');
    return firestore.collection(PASSENGER_BENEFITS_COLLECTION);
  }

  async mirrorConfigToLegacy(config) {
    if (!LEGACY_MIRROR_ENABLED) return;
    const db = this.getLegacyDb();
    if (!db) return;
    await db.ref(LEGACY_CONFIG_PATH).set({
      ...config,
      source: 'firestore_mirror'
    });
  }

  async mirrorCampaignToLegacy(campaign) {
    if (!LEGACY_MIRROR_ENABLED) return;
    const db = this.getLegacyDb();
    if (!db) return;
    await db.ref(`${LEGACY_CAMPAIGNS_PATH}/${campaign.id}`).set({
      ...campaign,
      source: 'firestore_mirror'
    });
  }

  async mirrorInviteToLegacy(invite) {
    if (!LEGACY_MIRROR_ENABLED) return;
    const db = this.getLegacyDb();
    if (!db) return;
    await db.ref(`${LEGACY_INVITES_PATH}/${invite.id}`).set({
      ...invite,
      source: 'firestore_mirror'
    });
  }

  async getUserProfile(userId) {
    const safeUserId = normalizeId(userId);
    if (!safeUserId) return null;

    const firestore = this.getFirestore();
    if (firestore) {
      const doc = await firestore.collection('users').doc(safeUserId).get();
      if (doc.exists) {
        return { id: doc.id, ...doc.data() };
      }
    }

    const db = this.getLegacyDb();
    if (!db) return null;
    const snapshot = await db.ref(`users/${safeUserId}`).once('value');
    if (!snapshot.exists()) return null;
    return { id: safeUserId, ...(snapshot.val() || {}) };
  }

  async updateUserProfile(userId, patch = {}, { legacyDb = null } = {}) {
    const safeUserId = normalizeId(userId);
    if (!safeUserId) return;

    const firestore = this.getFirestore();
    if (firestore) {
      await firestore.collection('users').doc(safeUserId).set({
        ...patch,
        updatedAt: patch.updatedAt || nowIso()
      }, { merge: true });
    }

    if (LEGACY_MIRROR_ENABLED) {
      const db = legacyDb || this.getLegacyDb();
      if (db) {
        await db.ref(`users/${safeUserId}`).update({
          ...patch,
          updatedAt: patch.updatedAt || nowIso()
        });
      }
    }
  }

  async savePassengerBenefit(userId, inviteId, payload) {
    const safeUserId = normalizeId(userId);
    const safeInviteId = normalizeId(inviteId);
    const docId = `${safeUserId}__${safeInviteId}`;
    const normalized = {
      id: docId,
      inviteId: safeInviteId,
      userId: safeUserId,
      ...payload,
      createdAt: toIso(payload.createdAt, nowIso()),
      updatedAt: toIso(payload.updatedAt, toIso(payload.createdAt, nowIso())),
      source: 'firestore'
    };

    await this.passengerBenefitsCollection().doc(docId).set(normalized, { merge: true });

    if (LEGACY_MIRROR_ENABLED) {
      const db = this.getLegacyDb();
      if (db) {
        await db.ref(`users/${safeUserId}/passengerDiscountBenefits/${safeInviteId}`).set({
          ...normalized,
          source: 'firestore_mirror'
        });
      }
    }

    return normalized;
  }

  async extendFreeMonthsForUser(userId, months, metadata = {}) {
    const safeUserId = normalizeId(userId);
    if (!safeUserId) throw new Error('userId inválido');

    const user = await this.getUserProfile(safeUserId);
    const currentFreeEndTs = user?.free_months_end ? new Date(user.free_months_end).getTime() : null;
    const baseDate = currentFreeEndTs && currentFreeEndTs > Date.now()
      ? new Date(currentFreeEndTs)
      : new Date();

    const nextEnd = new Date(baseDate);
    nextEnd.setMonth(nextEnd.getMonth() + Number(months || 0));

    await this.updateUserProfile(safeUserId, {
      free_months_end: nextEnd.toISOString(),
      referralRewardUpdatedAt: nowIso(),
      referralRewardMeta: {
        ...(user?.referralRewardMeta || {}),
        ...metadata
      }
    });

    return nextEnd.toISOString();
  }

  async importLegacyConfig(defaults) {
    if (!LEGACY_IMPORT_ENABLED) return defaults;
    const db = this.getLegacyDb();
    if (!db) {
      await this.configDoc().set(defaults, { merge: true });
      return defaults;
    }

    const snapshot = await db.ref(LEGACY_CONFIG_PATH).once('value');
    const existing = snapshot.val();
    const config = existing ? { ...defaults, ...existing } : defaults;
    await this.configDoc().set({
      ...config,
      source: existing ? 'rtdb_import' : 'firestore'
    }, { merge: true });
    if (!existing) {
      await this.mirrorConfigToLegacy(config);
    }
    return config;
  }

  async getConfig(defaults) {
    const doc = await this.configDoc().get();
    if (doc.exists) {
      return { ...defaults, ...(doc.data() || {}) };
    }
    return this.importLegacyConfig(defaults);
  }

  async saveConfig(config, defaults = {}) {
    const normalized = {
      ...defaults,
      ...(config || {}),
      updatedAt: nowIso(),
      source: 'firestore'
    };
    await this.configDoc().set(normalized, { merge: true });
    await this.mirrorConfigToLegacy(normalized);
    return normalized;
  }

  async importLegacyCampaigns() {
    if (!LEGACY_IMPORT_ENABLED) return [];
    const db = this.getLegacyDb();
    if (!db) return [];

    const snapshot = await db.ref(LEGACY_CAMPAIGNS_PATH).once('value');
    const raw = snapshot.val() || {};
    const rows = Object.entries(raw).map(([id, value]) => normalizeCampaign({
      ...(value || {}),
      source: 'rtdb_import'
    }, id));

    for (let index = 0; index < rows.length; index += 400) {
      const batch = this.getFirestore().batch();
      rows.slice(index, index + 400).forEach((campaign) => {
        batch.set(this.campaignsCollection().doc(campaign.id), campaign, { merge: true });
      });
      await batch.commit();
    }

    return rows;
  }

  async listCampaigns() {
    let snapshot = await this.campaignsCollection().get();
    let campaigns = snapshot.docs.map((doc) => normalizeCampaign(doc.data(), doc.id));
    if (campaigns.length === 0) {
      campaigns = await this.importLegacyCampaigns();
    }
    return sortByCreatedAtDesc(campaigns);
  }

  async getCampaign(campaignId) {
    const safeCampaignId = normalizeId(campaignId);
    if (!safeCampaignId) return null;

    const doc = await this.campaignsCollection().doc(safeCampaignId).get();
    if (doc.exists) {
      return normalizeCampaign(doc.data(), doc.id);
    }

    if (!LEGACY_IMPORT_ENABLED) return null;
    const db = this.getLegacyDb();
    if (!db) return null;
    const snapshot = await db.ref(`${LEGACY_CAMPAIGNS_PATH}/${safeCampaignId}`).once('value');
    if (!snapshot.exists()) return null;

    const normalized = normalizeCampaign({
      ...(snapshot.val() || {}),
      source: 'rtdb_import'
    }, safeCampaignId);
    await this.campaignsCollection().doc(normalized.id).set(normalized, { merge: true });
    return normalized;
  }

  async createCampaign(payload) {
    const normalized = normalizeCampaign({
      ...(payload || {}),
      source: 'firestore',
      createdAt: nowIso(),
      updatedAt: nowIso()
    }, payload?.id);
    await this.campaignsCollection().doc(normalized.id).set(normalized, { merge: true });
    await this.mirrorCampaignToLegacy(normalized);
    return normalized;
  }

  async updateCampaign(campaignId, patch = {}) {
    const current = await this.getCampaign(campaignId);
    if (!current) return null;
    const normalized = normalizeCampaign({
      ...current,
      ...(patch || {}),
      params: {
        ...(current.params || {}),
        ...((patch && patch.params) || {})
      },
      updatedAt: nowIso(),
      source: 'firestore'
    }, current.id);
    await this.campaignsCollection().doc(normalized.id).set(normalized, { merge: true });
    await this.mirrorCampaignToLegacy(normalized);
    return normalized;
  }

  async importLegacyInvites() {
    if (!LEGACY_IMPORT_ENABLED) return [];
    const db = this.getLegacyDb();
    if (!db) return [];

    const snapshot = await db.ref(LEGACY_INVITES_PATH).once('value');
    const raw = snapshot.val() || {};
    const rows = Object.entries(raw).map(([id, value]) => normalizeInvite({
      ...(value || {}),
      source: 'rtdb_import'
    }, id));

    for (let index = 0; index < rows.length; index += 400) {
      const batch = this.getFirestore().batch();
      rows.slice(index, index + 400).forEach((invite) => {
        batch.set(this.invitesCollection().doc(invite.id), invite, { merge: true });
      });
      await batch.commit();
    }

    return rows;
  }

  async listInvites() {
    let snapshot = await this.invitesCollection().get();
    let invites = snapshot.docs.map((doc) => normalizeInvite(doc.data(), doc.id));
    if (invites.length === 0) {
      invites = await this.importLegacyInvites();
    }
    return sortByCreatedAtDesc(invites);
  }

  async getInvite(inviteId) {
    const safeInviteId = normalizeId(inviteId);
    if (!safeInviteId) return null;

    const doc = await this.invitesCollection().doc(safeInviteId).get();
    if (doc.exists) {
      return normalizeInvite(doc.data(), doc.id);
    }

    if (!LEGACY_IMPORT_ENABLED) return null;
    const db = this.getLegacyDb();
    if (!db) return null;
    const snapshot = await db.ref(`${LEGACY_INVITES_PATH}/${safeInviteId}`).once('value');
    if (!snapshot.exists()) return null;

    const normalized = normalizeInvite({
      ...(snapshot.val() || {}),
      source: 'rtdb_import'
    }, safeInviteId);
    await this.invitesCollection().doc(normalized.id).set(normalized, { merge: true });
    return normalized;
  }

  async findInviteByCode(code) {
    const safeCode = String(code || '').trim().toUpperCase();
    if (!safeCode) return null;

    let snapshot = await this.invitesCollection().where('code', '==', safeCode).limit(1).get();
    if (snapshot.empty) {
      await this.importLegacyInvites();
      snapshot = await this.invitesCollection().where('code', '==', safeCode).limit(1).get();
    }
    if (snapshot.empty) return null;
    const doc = snapshot.docs[0];
    return normalizeInvite(doc.data(), doc.id);
  }

  async createInvite(payload) {
    const normalized = normalizeInvite({
      ...(payload || {}),
      source: 'firestore',
      createdAt: nowIso(),
      updatedAt: nowIso()
    }, payload?.id);
    await this.invitesCollection().doc(normalized.id).set(normalized, { merge: true });
    await this.mirrorInviteToLegacy(normalized);
    return normalized;
  }

  async updateInvite(inviteId, patch = {}) {
    const current = await this.getInvite(inviteId);
    if (!current) return null;
    const normalized = normalizeInvite({
      ...current,
      ...(patch || {}),
      qualification: patch.qualification !== undefined
        ? patch.qualification
        : current.qualification,
      reward: patch.reward !== undefined ? patch.reward : current.reward,
      updatedAt: nowIso(),
      source: 'firestore'
    }, current.id);
    await this.invitesCollection().doc(normalized.id).set(normalized, { merge: true });
    await this.mirrorInviteToLegacy(normalized);
    return normalized;
  }
}

module.exports = new ReferralProgramStateService();
