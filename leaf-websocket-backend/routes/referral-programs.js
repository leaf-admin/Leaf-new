const express = require('express');
const admin = require('firebase-admin');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const { authenticateJWT, requireRole } = require('../middleware/jwt-auth');
const { logError, logStructured } = require('../utils/logger');
const referralProgramStateService = require('../services/referral-program-state-service');
const {
  isLaunchFeatureEnabled,
  buildLaunchFeatureDisabledPayload
} = require('../utils/pilot-launch-flags');

const router = express.Router();

let firebaseConfig = null;
try {
  firebaseConfig = require('../firebase-config');
} catch (_error) {}

const ADMIN_ROLES = ['admin', 'super-admin', 'manager', 'development'];
const PROGRAM_ROOT_PATH = 'operations/programs/referrals';
const CONFIG_PATH = `${PROGRAM_ROOT_PATH}/config`;
const CAMPAIGNS_PATH = `${PROGRAM_ROOT_PATH}/campaigns`;
const INVITES_PATH = `${PROGRAM_ROOT_PATH}/invites`;
const DEFAULT_DRIVER_MAX_INVITES = Number.parseInt(process.env.REFERRAL_DRIVER_MAX_INVITES || '3', 10);
const DEFAULT_DRIVER_REQUIRED_TRIPS = Number.parseInt(process.env.REFERRAL_DRIVER_REQUIRED_TRIPS || '20', 10);
const DEFAULT_DRIVER_REWARD_MONTHS = Number.parseInt(process.env.REFERRAL_DRIVER_REWARD_MONTHS || '1', 10);
const DEFAULT_DRIVER_QUALIFICATION_DAYS = Number.parseInt(process.env.REFERRAL_DRIVER_QUALIFICATION_DAYS || '30', 10);
const DEFAULT_PASSENGER_DISCOUNT_PERCENT = Number.parseFloat(process.env.REFERRAL_PASSENGER_DISCOUNT_PERCENT || '10');
const DEFAULT_PASSENGER_MAX_RIDES = Number.parseInt(process.env.REFERRAL_PASSENGER_MAX_RIDES || '3', 10);
const DEFAULT_FOUNDER_MONTHS = Number.parseInt(process.env.FOUNDER_DEFAULT_FREE_MONTHS || '6', 10);
const DEFAULT_INVITE_EXPIRES_DAYS = Number.parseInt(process.env.REFERRAL_INVITE_EXPIRES_DAYS || '30', 10);
const MAX_INVITE_CODE_ATTEMPTS = Number.parseInt(process.env.REFERRAL_INVITE_CODE_ATTEMPTS || '8', 10);

const publicInviteLookupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number.parseInt(process.env.REFERRAL_PUBLIC_LOOKUP_RATE_LIMIT || '80', 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Muitas tentativas. Tente novamente em alguns minutos.',
    retryAfter: 900
  }
});

function buildAuditOperator(user = {}) {
  return {
    id: user.id || user.uid || null,
    email: user.email || null,
    role: user.role || null
  };
}

function logReferralAdminAudit(req, action, entity, metadata = {}) {
  logStructured('info', 'Auditoria admin referral programs', {
    service: 'referral-programs',
    action,
    entity,
    operator: buildAuditOperator(req.user || {}),
    ...metadata
  });
}

function respondReferralProgramsDisabled(res) {
  return res.status(503).json(
    buildLaunchFeatureDisabledPayload(
      'referral_programs',
      'Programa de convites esta desativado neste perfil de lancamento'
    )
  );
}

function requireAdminMutationsEnabled(req, res, next) {
  if (isLaunchFeatureEnabled('adminMutationsEnabled', true)) {
    return next();
  }

  logStructured('warn', 'Mutacao admin de referral bloqueada por feature flag', {
    service: 'referral-programs',
    operation: 'admin-mutation-guard',
    action: 'referral_programs.admin_mutation.blocked',
    entity: { type: 'referral_programs', id: null },
    operator: buildAuditOperator(req.user || {}),
    path: req.originalUrl || req.url,
    adminUserId: req.user?.id || null,
    adminRole: req.user?.role || null
  });

  return res.status(503).json(
    buildLaunchFeatureDisabledPayload(
      'admin_mutations',
      'Mutacoes administrativas estao desativadas neste perfil de lancamento'
    )
  );
}

function nowIso() {
  return new Date().toISOString();
}

function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function toPercent(value, fallback) {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(parsed, 100);
}

function normalizeStatus(value, fallback = 'active') {
  const safe = String(value || '').trim().toLowerCase();
  if (['active', 'paused', 'archived', 'completed'].includes(safe)) return safe;
  return fallback;
}

function normalizeCampaignType(value, fallback = 'driver_referral') {
  const safe = String(value || '').trim().toLowerCase();
  if (['driver_referral', 'passenger_referral', 'founder_wave'].includes(safe)) return safe;
  return fallback;
}

function normalizeIdentifier(value) {
  return String(value || '').trim();
}

function normalizeEmail(value) {
  return normalizeIdentifier(value).toLowerCase();
}

function normalizePhoneDigits(value) {
  return normalizeIdentifier(value).replace(/\D/g, '');
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

  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : null;
}

function generateInviteCode(type) {
  const prefix = type === 'driver_referral' ? 'DRV' : 'PSG';
  const stamp = Date.now().toString(36).toUpperCase();
  const random = crypto.randomBytes(5).toString('hex').toUpperCase();
  return `${prefix}-${stamp}-${random}`;
}

function inviteIsExpired(invite, nowTs = Date.now()) {
  const expiresTs = parseTimestamp(invite?.expiresAt);
  return Boolean(expiresTs && expiresTs <= nowTs);
}

function resolveInviteStatus(invite) {
  const status = String(invite?.status || 'pending').trim().toLowerCase();
  if (status === 'pending' && inviteIsExpired(invite)) return 'expired';
  return status;
}

function buildPublicInvitePayload(invite = {}) {
  const type = normalizeCampaignType(invite.type);
  const status = resolveInviteStatus(invite);
  const canAccept = status === 'pending';

  const payload = {
    code: String(invite.code || '').trim().toUpperCase(),
    kind: type === 'driver_referral' ? 'driver' : 'passenger',
    status,
    canAccept,
    message: canAccept
      ? 'Convite ativo'
      : 'Convite ja utilizado ou indisponivel'
  };

  if (type === 'driver_referral') {
    payload.driverReward = {
      requiredCompletedTrips: toPositiveInt(invite.requiredCompletedTrips, DEFAULT_DRIVER_REQUIRED_TRIPS),
      rewardMonths: toPositiveInt(invite.rewardMonths, DEFAULT_DRIVER_REWARD_MONTHS),
      qualificationWindowDays: toPositiveInt(invite.qualificationWindowDays, DEFAULT_DRIVER_QUALIFICATION_DAYS)
    };
    return payload;
  }

  payload.passengerBenefit = {
    discountPercent: toPercent(invite.discountPercent, DEFAULT_PASSENGER_DISCOUNT_PERCENT),
    maxDiscountRides: toPositiveInt(invite.maxDiscountRides, DEFAULT_PASSENGER_MAX_RIDES),
    nonCumulative: invite.nonCumulative !== false
  };
  return payload;
}

function resolveInviteExpiresAt(campaign = null, createdAtTs = Date.now()) {
  const campaignDays = toPositiveInt(campaign?.params?.inviteExpiresInDays, DEFAULT_INVITE_EXPIRES_DAYS);
  const expiresInDays = campaignDays > 0 ? campaignDays : DEFAULT_INVITE_EXPIRES_DAYS;
  const candidateTs = createdAtTs + expiresInDays * 24 * 60 * 60 * 1000;
  const campaignEndTs = parseTimestamp(campaign?.endAt);
  const finalTs = campaignEndTs && campaignEndTs < candidateTs ? campaignEndTs : candidateTs;
  return new Date(finalTs).toISOString();
}

function countCampaignInvites(invites = [], campaignId = '') {
  const safeCampaignId = normalizeIdentifier(campaignId);
  if (!safeCampaignId) return 0;
  return invites.filter((invite) => normalizeIdentifier(invite.campaignId) === safeCampaignId).length;
}

function enforceCampaignInviteQuota(activeCampaign, allInvites) {
  const maxInvitesTotal = toPositiveInt(activeCampaign?.params?.maxInvitesTotal, 0);
  if (!activeCampaign?.id || maxInvitesTotal <= 0) return null;

  const used = countCampaignInvites(allInvites, activeCampaign.id);
  if (used >= maxInvitesTotal) {
    return {
      error: 'Limite total de convites da campanha atingido',
      campaignId: activeCampaign.id,
      limit: maxInvitesTotal
    };
  }
  return null;
}

async function createInviteWithUniqueCode(type, buildPayload) {
  let lastError = null;
  const attempts = Math.max(1, MAX_INVITE_CODE_ATTEMPTS);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const code = generateInviteCode(type);
    const inviteId = `invite_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const payload = buildPayload({ inviteId, code });
    try {
      if (typeof referralProgramStateService.createInviteWithUniqueCode === 'function') {
        return await referralProgramStateService.createInviteWithUniqueCode(payload);
      }
      const existing = await referralProgramStateService.findInviteByCode(code);
      if (existing) {
        lastError = new Error('Código de convite já existe');
        continue;
      }
      return await saveInvite(inviteId, payload);
    } catch (error) {
      lastError = error;
      if (!['INVITE_CODE_ALREADY_EXISTS', 'INVITE_ID_ALREADY_EXISTS'].includes(error?.code)) {
        throw error;
      }
    }
  }

  const error = new Error('Não foi possível gerar um código único de convite');
  error.cause = lastError;
  error.code = 'INVITE_CODE_GENERATION_FAILED';
  error.statusCode = 500;
  throw error;
}

function monthsFromNow(startDate, months) {
  const date = new Date(startDate || Date.now());
  date.setMonth(date.getMonth() + Number(months || 0));
  return date;
}

async function ensureUserFromFirebaseToken(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token de autorização não fornecido' });
    }
    const token = authHeader.slice('Bearer '.length);
    const decoded = await admin.auth().verifyIdToken(token);
    req.firebaseUser = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Token inválido' });
  }
}

function getDefaultProgramConfig() {
  return {
    version: 1,
    updatedAt: nowIso(),
    updatedBy: 'system',
    driver: {
      enabled: true,
      maxInvitesPerDriver: DEFAULT_DRIVER_MAX_INVITES,
      requiredCompletedTrips: DEFAULT_DRIVER_REQUIRED_TRIPS,
      qualificationWindowDays: DEFAULT_DRIVER_QUALIFICATION_DAYS,
      rewardMonths: DEFAULT_DRIVER_REWARD_MONTHS,
      avoidDuplicateInvitees: true
    },
    passenger: {
      enabled: true,
      discountPercent: DEFAULT_PASSENGER_DISCOUNT_PERCENT,
      maxDiscountRides: DEFAULT_PASSENGER_MAX_RIDES,
      nonCumulative: true
    },
    founder: {
      enabled: true,
      freeMonths: DEFAULT_FOUNDER_MONTHS,
      waveTag: 'founder-wave-1'
    }
  };
}

async function loadProgramConfig() {
  const defaults = getDefaultProgramConfig();
  const existing = await referralProgramStateService.getConfig(defaults);
  return {
    ...defaults,
    ...existing,
    driver: {
      ...defaults.driver,
      ...(existing.driver || {})
    },
    passenger: {
      ...defaults.passenger,
      ...(existing.passenger || {})
    },
    founder: {
      ...defaults.founder,
      ...(existing.founder || {})
    }
  };
}

async function loadCampaigns() {
  return referralProgramStateService.listCampaigns();
}

function campaignIsActive(campaign, nowTs = Date.now()) {
  if (!campaign || normalizeStatus(campaign.status) !== 'active') return false;
  const startTs = parseTimestamp(campaign.startAt || campaign.createdAt) || 0;
  const endTs = parseTimestamp(campaign.endAt);
  if (nowTs < startTs) return false;
  if (endTs && nowTs > endTs) return false;
  return true;
}

async function resolveCampaignForType(type) {
  const campaigns = await loadCampaigns();
  const nowTs = Date.now();
  const selected = campaigns.find((campaign) =>
    normalizeCampaignType(campaign.type) === type && campaignIsActive(campaign, nowTs)
  );
  return selected || null;
}

async function loadInvites() {
  return referralProgramStateService.listInvites();
}

function sameInviteTarget(invite, inviteeEmail, inviteePhone) {
  const normalizedEmail = normalizeIdentifier(inviteeEmail).toLowerCase();
  const normalizedPhone = normalizeIdentifier(inviteePhone).replace(/\D/g, '');
  const inviteEmail = normalizeIdentifier(invite.inviteeEmail).toLowerCase();
  const invitePhone = normalizeIdentifier(invite.inviteePhone).replace(/\D/g, '');

  if (normalizedEmail && inviteEmail && normalizedEmail === inviteEmail) return true;
  if (normalizedPhone && invitePhone && normalizedPhone === invitePhone) return true;
  return false;
}

async function saveInvite(inviteId, payload) {
  return referralProgramStateService.createInvite({
    id: inviteId,
    ...payload
  });
}

async function updateInvite(inviteId, payload) {
  return referralProgramStateService.updateInvite(inviteId, payload);
}

async function extendFreeMonthsForUser(userId, months, metadata = {}) {
  return referralProgramStateService.extendFreeMonthsForUser(userId, months, metadata);
}

function bookingStatusIsCompleted(status) {
  const normalized = String(status || '').toUpperCase();
  return ['COMPLETE', 'COMPLETED', 'PAID'].includes(normalized);
}

async function countDriverTripsWithinWindow(driverId, startTs, endTs) {
  const firestore = firebaseConfig && typeof firebaseConfig.getFirestore === 'function'
    ? firebaseConfig.getFirestore()
    : null;

  if (firestore) {
    const snapshot = await firestore
      .collection('rides')
      .where('driverId', '==', normalizeIdentifier(driverId))
      .get();

    const rides = snapshot.docs.map((doc) => doc.data() || {});
    if (rides.length > 0) {
      return rides.filter((ride) => {
        if (!bookingStatusIsCompleted(ride.status || ride.currentStatus)) return false;
        const ts = parseTimestamp(
          ride.completedAt ||
          ride.paidAt ||
          ride.tripdate ||
          ride.startedAt ||
          ride.createdAt
        );
        if (!Number.isFinite(ts)) return false;
        if (ts < startTs) return false;
        if (endTs && ts > endTs) return false;
        return true;
      }).length;
    }
  }

  if (!firebaseConfig || typeof firebaseConfig.getFromRealtimeDB !== 'function') {
    return 0;
  }

  const bookings = await firebaseConfig.getFromRealtimeDB('bookings') || {};

  return Object.values(bookings).filter((booking) => {
    const bookingDriver = normalizeIdentifier(booking.driver || booking.driverId);
    if (!bookingDriver || bookingDriver !== normalizeIdentifier(driverId)) return false;
    if (!bookingStatusIsCompleted(booking.status)) return false;
    const ts = parseTimestamp(booking.tripdate || booking.createdAt || booking.timestamp || booking.paidAt || booking.completedAt);
    if (!Number.isFinite(ts)) return false;
    if (ts < startTs) return false;
    if (endTs && ts > endTs) return false;
    return true;
  }).length;
}

async function applyPassengerBenefit(invite, config) {
  const inviteeId = normalizeIdentifier(invite.acceptedBy || invite.inviteeId);
  if (!inviteeId) return null;

  const discountPercent = toPercent(
    invite.discountPercent ?? config?.passenger?.discountPercent,
    DEFAULT_PASSENGER_DISCOUNT_PERCENT
  );
  const maxRides = toPositiveInt(
    invite.maxDiscountRides ?? config?.passenger?.maxDiscountRides,
    DEFAULT_PASSENGER_MAX_RIDES
  );
  const nonCumulative = invite.nonCumulative !== false && config?.passenger?.nonCumulative !== false;

  const benefitPayload = {
    inviteId: invite.id,
    campaignId: invite.campaignId || null,
    discountPercent,
    maxRides,
    remainingRides: maxRides,
    nonCumulative,
    status: 'active',
    createdAt: nowIso()
  };

  return referralProgramStateService.savePassengerBenefit(inviteeId, invite.id, benefitPayload);
}

function resolveInviterId(req, body) {
  const fromBody = normalizeIdentifier(body.inviterId);
  if (fromBody) return fromBody;
  const fromFirebase = normalizeIdentifier(req?.firebaseUser?.uid);
  if (fromFirebase) return fromFirebase;
  return '';
}

function resolveInviteeIdentity(body) {
  return {
    inviteeId: normalizeIdentifier(body.inviteeId),
    inviteeEmail: normalizeIdentifier(body.inviteeEmail),
    inviteePhone: normalizeIdentifier(body.inviteePhone)
  };
}

async function resolveAuthenticatedInviteeIdentity(req, inviteeId) {
  const profile = inviteeId
    ? await referralProgramStateService.getUserProfile(inviteeId).catch(() => null)
    : null;
  const firebaseUser = req.firebaseUser || {};

  return {
    uid: inviteeId,
    email: normalizeEmail(
      firebaseUser.email ||
      firebaseUser.emailAddress ||
      profile?.email ||
      profile?.useremail
    ),
    phoneDigits: normalizePhoneDigits(
      firebaseUser.phone_number ||
      firebaseUser.phoneNumber ||
      firebaseUser.phone ||
      profile?.phone ||
      profile?.phoneNumber ||
      profile?.mobile ||
      profile?.usermobile
    )
  };
}

function validateInviteTarget(invite, identity) {
  const expectedInviteeId = normalizeIdentifier(invite.inviteeId);
  const expectedEmail = normalizeEmail(invite.inviteeEmail);
  const expectedPhoneDigits = normalizePhoneDigits(invite.inviteePhone);

  if (expectedInviteeId && expectedInviteeId !== normalizeIdentifier(identity.uid)) {
    return {
      ok: false,
      status: 403,
      error: 'Este convite pertence a outra conta'
    };
  }

  if (expectedEmail && expectedEmail !== identity.email) {
    return {
      ok: false,
      status: 403,
      error: 'Este convite pertence a outro email'
    };
  }

  if (expectedPhoneDigits && expectedPhoneDigits !== identity.phoneDigits) {
    return {
      ok: false,
      status: 403,
      error: 'Este convite pertence a outro telefone'
    };
  }

  return { ok: true };
}

router.use((req, res, next) => {
  if (isLaunchFeatureEnabled('referralProgramsEnabled', true)) {
    return next();
  }

  return respondReferralProgramsDisabled(res);
});

router.get('/invites/public/:code', publicInviteLookupLimiter, async (req, res) => {
  try {
    const code = normalizeIdentifier(req.params.code).toUpperCase();
    if (!code) {
      return res.status(400).json({ error: 'Codigo do convite e obrigatorio' });
    }

    const invite = await referralProgramStateService.findInviteByCode(code);
    if (!invite) {
      return res.status(404).json({
        success: false,
        error: 'Convite nao encontrado'
      });
    }

    return res.json({
      success: true,
      invite: buildPublicInvitePayload(invite)
    });
  } catch (error) {
    logError(error, 'Erro ao consultar convite publico', { service: 'referral-programs' });
    return res.status(500).json({ error: 'Erro ao consultar convite' });
  }
});

router.get('/config', authenticateJWT, requireRole(ADMIN_ROLES), async (req, res) => {
  try {
    const config = await loadProgramConfig();
    res.json({ success: true, config });
  } catch (error) {
    logError(error, 'Erro ao carregar config de referral programs', { service: 'referral-programs' });
    res.status(500).json({ error: 'Erro ao carregar configuração' });
  }
});

router.patch('/config', authenticateJWT, requireRole(ADMIN_ROLES), requireAdminMutationsEnabled, async (req, res) => {
  try {
    const current = await loadProgramConfig();
    const payload = req.body || {};
    const next = {
      ...current,
      driver: {
        ...current.driver,
        ...(payload.driver || {})
      },
      passenger: {
        ...current.passenger,
        ...(payload.passenger || {})
      },
      founder: {
        ...current.founder,
        ...(payload.founder || {})
      },
      updatedAt: nowIso(),
      updatedBy: req.user?.id || req.user?.email || 'admin'
    };

    next.driver.maxInvitesPerDriver = toPositiveInt(next.driver.maxInvitesPerDriver, DEFAULT_DRIVER_MAX_INVITES);
    next.driver.requiredCompletedTrips = toPositiveInt(next.driver.requiredCompletedTrips, DEFAULT_DRIVER_REQUIRED_TRIPS);
    next.driver.rewardMonths = toPositiveInt(next.driver.rewardMonths, DEFAULT_DRIVER_REWARD_MONTHS);
    next.driver.qualificationWindowDays = toPositiveInt(next.driver.qualificationWindowDays, DEFAULT_DRIVER_QUALIFICATION_DAYS);

    next.passenger.discountPercent = toPercent(next.passenger.discountPercent, DEFAULT_PASSENGER_DISCOUNT_PERCENT);
    next.passenger.maxDiscountRides = toPositiveInt(next.passenger.maxDiscountRides, DEFAULT_PASSENGER_MAX_RIDES);

    next.founder.freeMonths = toPositiveInt(next.founder.freeMonths, DEFAULT_FOUNDER_MONTHS);

    await referralProgramStateService.saveConfig(next, getDefaultProgramConfig());
    logReferralAdminAudit(req, 'referral_programs.config.update', {
      type: 'referral_config',
      id: 'current'
    });

    res.json({ success: true, config: next });
  } catch (error) {
    logError(error, 'Erro ao atualizar config de referral programs', { service: 'referral-programs' });
    res.status(500).json({ error: 'Erro ao atualizar configuração' });
  }
});

router.get('/campaigns', authenticateJWT, requireRole(ADMIN_ROLES), async (_req, res) => {
  try {
    const campaigns = await loadCampaigns();
    res.json({ success: true, campaigns });
  } catch (error) {
    logError(error, 'Erro ao listar campanhas de referral programs', { service: 'referral-programs' });
    res.status(500).json({ error: 'Erro ao listar campanhas' });
  }
});

router.post('/campaigns', authenticateJWT, requireRole(ADMIN_ROLES), requireAdminMutationsEnabled, async (req, res) => {
  try {
    const {
      name,
      type = 'driver_referral',
      status = 'active',
      startAt,
      endAt,
      params = {}
    } = req.body || {};

    if (!name || String(name).trim().length < 3) {
      return res.status(400).json({ error: 'Nome da campanha é obrigatório' });
    }

    const id = `campaign_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const campaignPayload = {
      id,
      name: String(name).trim(),
      type: normalizeCampaignType(type),
      status: normalizeStatus(status),
      startAt: startAt || nowIso(),
      endAt: endAt || null,
      params: {
        maxInvitesPerDriver: toPositiveInt(params.maxInvitesPerDriver, DEFAULT_DRIVER_MAX_INVITES),
        maxInvitesTotal: toPositiveInt(params.maxInvitesTotal, 0),
        inviteExpiresInDays: toPositiveInt(params.inviteExpiresInDays, DEFAULT_INVITE_EXPIRES_DAYS),
        requiredCompletedTrips: toPositiveInt(params.requiredCompletedTrips, DEFAULT_DRIVER_REQUIRED_TRIPS),
        rewardMonths: toPositiveInt(params.rewardMonths, DEFAULT_DRIVER_REWARD_MONTHS),
        qualificationWindowDays: toPositiveInt(params.qualificationWindowDays, DEFAULT_DRIVER_QUALIFICATION_DAYS),
        discountPercent: toPercent(params.discountPercent, DEFAULT_PASSENGER_DISCOUNT_PERCENT),
        maxDiscountRides: toPositiveInt(params.maxDiscountRides, DEFAULT_PASSENGER_MAX_RIDES),
        nonCumulative: params.nonCumulative !== false,
        founderFreeMonths: toPositiveInt(params.founderFreeMonths, DEFAULT_FOUNDER_MONTHS)
      },
      createdAt: nowIso(),
      createdBy: req.user?.id || req.user?.email || 'admin',
      updatedAt: nowIso()
    };

    await referralProgramStateService.createCampaign(campaignPayload);
    logReferralAdminAudit(req, 'referral_programs.campaign.create', {
      type: 'referral_campaign',
      id: campaignPayload.id
    }, {
      campaignType: campaignPayload.type,
      status: campaignPayload.status
    });
    res.json({ success: true, campaign: campaignPayload });
  } catch (error) {
    logError(error, 'Erro ao criar campanha de referral programs', { service: 'referral-programs' });
    res.status(500).json({ error: 'Erro ao criar campanha' });
  }
});

router.patch('/campaigns/:campaignId', authenticateJWT, requireRole(ADMIN_ROLES), requireAdminMutationsEnabled, async (req, res) => {
  try {
    const campaignId = normalizeIdentifier(req.params.campaignId);
    if (!campaignId) {
      return res.status(400).json({ error: 'campaignId inválido' });
    }

    const current = await referralProgramStateService.getCampaign(campaignId);
    if (!current) {
      return res.status(404).json({ error: 'Campanha não encontrada' });
    }

    const incoming = req.body || {};
    const merged = {
      ...current,
      ...incoming,
      type: normalizeCampaignType(incoming.type || current.type),
      status: normalizeStatus(incoming.status || current.status),
      params: {
        ...(current.params || {}),
        ...(incoming.params || {})
      },
      updatedAt: nowIso(),
      updatedBy: req.user?.id || req.user?.email || 'admin'
    };

    merged.params.maxInvitesPerDriver = toPositiveInt(merged.params.maxInvitesPerDriver, DEFAULT_DRIVER_MAX_INVITES);
    merged.params.maxInvitesTotal = toPositiveInt(merged.params.maxInvitesTotal, 0);
    merged.params.inviteExpiresInDays = toPositiveInt(merged.params.inviteExpiresInDays, DEFAULT_INVITE_EXPIRES_DAYS);
    merged.params.requiredCompletedTrips = toPositiveInt(merged.params.requiredCompletedTrips, DEFAULT_DRIVER_REQUIRED_TRIPS);
    merged.params.rewardMonths = toPositiveInt(merged.params.rewardMonths, DEFAULT_DRIVER_REWARD_MONTHS);
    merged.params.qualificationWindowDays = toPositiveInt(merged.params.qualificationWindowDays, DEFAULT_DRIVER_QUALIFICATION_DAYS);
    merged.params.discountPercent = toPercent(merged.params.discountPercent, DEFAULT_PASSENGER_DISCOUNT_PERCENT);
    merged.params.maxDiscountRides = toPositiveInt(merged.params.maxDiscountRides, DEFAULT_PASSENGER_MAX_RIDES);

    await referralProgramStateService.updateCampaign(campaignId, merged);
    logReferralAdminAudit(req, 'referral_programs.campaign.update', {
      type: 'referral_campaign',
      id: campaignId
    }, {
      campaignType: merged.type,
      status: merged.status
    });
    res.json({ success: true, campaign: merged });
  } catch (error) {
    logError(error, 'Erro ao atualizar campanha de referral programs', { service: 'referral-programs' });
    res.status(500).json({ error: 'Erro ao atualizar campanha' });
  }
});

router.post('/invites/driver', ensureUserFromFirebaseToken, async (req, res) => {
  try {
    const config = await loadProgramConfig();
    if (config.driver.enabled === false) {
      return res.status(400).json({ error: 'Programa de convites para motoristas está desativado' });
    }

    const inviterId = resolveInviterId(req, req.body || {});
    if (!inviterId) {
      return res.status(400).json({ error: 'inviterId é obrigatório' });
    }

    const { inviteeId, inviteeEmail, inviteePhone } = resolveInviteeIdentity(req.body || {});
    if (!inviteeId && !inviteeEmail && !inviteePhone) {
      return res.status(400).json({ error: 'Informe inviteeId, inviteeEmail ou inviteePhone' });
    }

    const activeCampaign = await resolveCampaignForType('driver_referral');
    const maxInvitesPerDriver = toPositiveInt(
      activeCampaign?.params?.maxInvitesPerDriver ?? config.driver.maxInvitesPerDriver,
      DEFAULT_DRIVER_MAX_INVITES
    );

    const allInvites = await loadInvites();
    const campaignQuotaError = enforceCampaignInviteQuota(activeCampaign, allInvites);
    if (campaignQuotaError) {
      return res.status(400).json(campaignQuotaError);
    }

    const driverInvites = allInvites.filter((invite) =>
      normalizeIdentifier(invite.inviterId) === inviterId &&
      normalizeCampaignType(invite.type) === 'driver_referral' &&
      ['pending', 'accepted', 'qualified', 'rewarded'].includes(String(invite.status || '').toLowerCase())
    );

    if (driverInvites.length >= maxInvitesPerDriver) {
      return res.status(400).json({
        error: 'Limite de convites atingido para este motorista',
        limit: maxInvitesPerDriver
      });
    }

    if (config.driver.avoidDuplicateInvitees !== false) {
      const duplicated = allInvites.find((invite) =>
        normalizeCampaignType(invite.type) === 'driver_referral' &&
        ['pending', 'accepted', 'qualified', 'rewarded'].includes(String(invite.status || '').toLowerCase()) &&
        sameInviteTarget(invite, inviteeEmail, inviteePhone)
      );

      if (duplicated) {
        return res.status(409).json({ error: 'Convidado já possui convite ativo para motorista' });
      }
    }

    const requiredCompletedTrips = toPositiveInt(
      activeCampaign?.params?.requiredCompletedTrips ?? config.driver.requiredCompletedTrips,
      DEFAULT_DRIVER_REQUIRED_TRIPS
    );
    const rewardMonths = toPositiveInt(
      activeCampaign?.params?.rewardMonths ?? config.driver.rewardMonths,
      DEFAULT_DRIVER_REWARD_MONTHS
    );
    const qualificationWindowDays = toPositiveInt(
      activeCampaign?.params?.qualificationWindowDays ?? config.driver.qualificationWindowDays,
      DEFAULT_DRIVER_QUALIFICATION_DAYS
    );

    const createdAt = nowIso();
    const invitePayload = await createInviteWithUniqueCode('driver_referral', ({ inviteId, code }) => ({
      id: inviteId,
      code,
      type: 'driver_referral',
      status: 'pending',
      inviterId,
      inviteeId: inviteeId || null,
      inviteeEmail: inviteeEmail || null,
      inviteePhone: inviteePhone || null,
      campaignId: activeCampaign?.id || null,
      requiredCompletedTrips,
      rewardMonths,
      qualificationWindowDays,
      expiresAt: resolveInviteExpiresAt(activeCampaign, Date.now()),
      createdAt,
      updatedAt: createdAt
    }));

    res.json({
      success: true,
      invite: invitePayload,
      usage: {
        used: driverInvites.length + 1,
        max: maxInvitesPerDriver,
        remaining: Math.max(0, maxInvitesPerDriver - (driverInvites.length + 1))
      }
    });
  } catch (error) {
    logError(error, 'Erro ao criar convite de motorista', { service: 'referral-programs' });
    res.status(error.statusCode || 500).json({
      error: error.statusCode ? error.message : 'Erro ao criar convite de motorista',
      code: error.code || undefined
    });
  }
});

router.post('/invites/passenger', ensureUserFromFirebaseToken, async (req, res) => {
  try {
    const config = await loadProgramConfig();
    if (config.passenger.enabled === false) {
      return res.status(400).json({ error: 'Programa de convites para passageiros está desativado' });
    }

    const inviterId = resolveInviterId(req, req.body || {});
    if (!inviterId) {
      return res.status(400).json({ error: 'inviterId é obrigatório' });
    }

    const { inviteeId, inviteeEmail, inviteePhone } = resolveInviteeIdentity(req.body || {});
    if (!inviteeId && !inviteeEmail && !inviteePhone) {
      return res.status(400).json({ error: 'Informe inviteeId, inviteeEmail ou inviteePhone' });
    }

    const activeCampaign = await resolveCampaignForType('passenger_referral');
    const allInvites = await loadInvites();
    const campaignQuotaError = enforceCampaignInviteQuota(activeCampaign, allInvites);
    if (campaignQuotaError) {
      return res.status(400).json(campaignQuotaError);
    }

    const discountPercent = toPercent(
      activeCampaign?.params?.discountPercent ?? config.passenger.discountPercent,
      DEFAULT_PASSENGER_DISCOUNT_PERCENT
    );
    const maxDiscountRides = toPositiveInt(
      activeCampaign?.params?.maxDiscountRides ?? config.passenger.maxDiscountRides,
      DEFAULT_PASSENGER_MAX_RIDES
    );
    const nonCumulative = activeCampaign?.params?.nonCumulative !== false && config.passenger.nonCumulative !== false;

    const createdAt = nowIso();
    const invitePayload = await createInviteWithUniqueCode('passenger_referral', ({ inviteId, code }) => ({
      id: inviteId,
      code,
      type: 'passenger_referral',
      status: 'pending',
      inviterId,
      inviteeId: inviteeId || null,
      inviteeEmail: inviteeEmail || null,
      inviteePhone: inviteePhone || null,
      campaignId: activeCampaign?.id || null,
      discountPercent,
      maxDiscountRides,
      nonCumulative,
      expiresAt: resolveInviteExpiresAt(activeCampaign, Date.now()),
      createdAt,
      updatedAt: createdAt
    }));

    res.json({ success: true, invite: invitePayload });
  } catch (error) {
    logError(error, 'Erro ao criar convite de passageiro', { service: 'referral-programs' });
    res.status(error.statusCode || 500).json({
      error: error.statusCode ? error.message : 'Erro ao criar convite de passageiro',
      code: error.code || undefined
    });
  }
});

router.post('/invites/accept', ensureUserFromFirebaseToken, async (req, res) => {
  try {
    const code = normalizeIdentifier(req.body?.code).toUpperCase();
    const inviteeId = normalizeIdentifier(req.body?.inviteeId || req.firebaseUser?.uid);
    if (!code) {
      return res.status(400).json({ error: 'Código do convite é obrigatório' });
    }
    if (!inviteeId) {
      return res.status(400).json({ error: 'inviteeId é obrigatório' });
    }

    const invite = await referralProgramStateService.findInviteByCode(code);
    if (!invite) {
      return res.status(404).json({ error: 'Convite não encontrado' });
    }

    if (normalizeIdentifier(invite.inviterId) === inviteeId) {
      return res.status(400).json({ error: 'Não é permitido aceitar convite próprio' });
    }

    const currentStatus = resolveInviteStatus(invite);
    if (currentStatus !== 'pending') {
      const statusCode = currentStatus === 'expired' ? 410 : 409;
      return res.status(statusCode).json({ error: `Convite já está ${currentStatus}` });
    }

    const targetValidation = validateInviteTarget(
      invite,
      await resolveAuthenticatedInviteeIdentity(req, inviteeId)
    );
    if (!targetValidation.ok) {
      return res.status(targetValidation.status).json({ error: targetValidation.error });
    }

    const acceptedAt = nowIso();
    const acceptancePatch = {
      status: 'accepted',
      acceptedAt,
      acceptedBy: inviteeId,
      updatedAt: acceptedAt
    };

    if (normalizeCampaignType(invite.type) === 'driver_referral') {
      const windowDays = toPositiveInt(invite.qualificationWindowDays, DEFAULT_DRIVER_QUALIFICATION_DAYS);
      const dueAt = new Date(Date.now() + windowDays * 24 * 60 * 60 * 1000).toISOString();
      acceptancePatch.qualification = {
        status: 'tracking',
        startedAt: acceptedAt,
        dueAt,
        requiredCompletedTrips: toPositiveInt(invite.requiredCompletedTrips, DEFAULT_DRIVER_REQUIRED_TRIPS),
        currentCompletedTrips: 0
      };
    }

    const updatedInvite = typeof referralProgramStateService.acceptInvite === 'function'
      ? await referralProgramStateService.acceptInvite(invite.id, acceptancePatch, { expectedCode: code })
      : await updateInvite(invite.id, acceptancePatch);

    let passengerBenefit = null;
    if (normalizeCampaignType(invite.type) === 'passenger_referral') {
      const config = await loadProgramConfig();
      passengerBenefit = await applyPassengerBenefit({ ...invite, ...(updatedInvite || acceptancePatch), id: invite.id }, config);
    }

    await referralProgramStateService.updateUserProfile(inviteeId, {
      invitedBy: normalizeIdentifier(invite.inviterId),
      inviteAcceptedAt: acceptedAt
    });

    res.json({
      success: true,
      invite: {
        ...invite,
        ...(updatedInvite || acceptancePatch),
        id: invite.id
      },
      passengerBenefit
    });
  } catch (error) {
    logError(error, 'Erro ao aceitar convite', { service: 'referral-programs' });
    res.status(error.statusCode || 500).json({
      error: error.statusCode ? error.message : 'Erro ao aceitar convite',
      code: error.code || undefined
    });
  }
});

router.post('/invites/driver/evaluate', authenticateJWT, requireRole(ADMIN_ROLES), requireAdminMutationsEnabled, async (req, res) => {
  try {
    const inviteId = normalizeIdentifier(req.body?.inviteId);
    if (!inviteId) {
      return res.status(400).json({ error: 'inviteId é obrigatório' });
    }

    const invite = await referralProgramStateService.getInvite(inviteId);
    if (!invite) {
      return res.status(404).json({ error: 'Convite não encontrado' });
    }
    if (normalizeCampaignType(invite.type) !== 'driver_referral') {
      return res.status(400).json({ error: 'Convite informado não é de motorista' });
    }

    if (String(invite.status || '').toLowerCase() !== 'accepted' && String(invite.status || '').toLowerCase() !== 'qualified') {
      return res.status(400).json({ error: 'Convite ainda não está aceito para avaliação' });
    }

    const inviteeId = normalizeIdentifier(invite.acceptedBy || invite.inviteeId);
    const inviterId = normalizeIdentifier(invite.inviterId);

    if (!inviteeId || !inviterId) {
      return res.status(400).json({ error: 'Convite sem IDs válidos de convidador/convidado' });
    }

    const acceptedAtTs = parseTimestamp(invite.acceptedAt || invite.createdAt) || Date.now();
    const dueAtTs = parseTimestamp(invite?.qualification?.dueAt) || (acceptedAtTs + DEFAULT_DRIVER_QUALIFICATION_DAYS * 24 * 60 * 60 * 1000);
    const requiredTrips = toPositiveInt(
      invite?.qualification?.requiredCompletedTrips || invite.requiredCompletedTrips,
      DEFAULT_DRIVER_REQUIRED_TRIPS
    );

    const completedTrips = await countDriverTripsWithinWindow(inviteeId, acceptedAtTs, dueAtTs);
    const qualified = completedTrips >= requiredTrips;

    const patch = {
      updatedAt: nowIso(),
      qualification: {
        ...(invite.qualification || {}),
        status: qualified ? 'qualified' : 'tracking',
        evaluatedAt: nowIso(),
        currentCompletedTrips: completedTrips,
        requiredCompletedTrips: requiredTrips,
        dueAt: new Date(dueAtTs).toISOString()
      }
    };

    let reward = null;
    if (qualified && String(invite.rewardStatus || '').toLowerCase() !== 'granted') {
      const rewardMonths = toPositiveInt(invite.rewardMonths, DEFAULT_DRIVER_REWARD_MONTHS);
      const freeUntil = await extendFreeMonthsForUser(inviterId, rewardMonths, {
        source: 'driver_referral',
        inviteId,
        inviteeId,
        grantedAt: nowIso()
      });

      patch.rewardStatus = 'granted';
      patch.status = 'qualified';
      patch.reward = {
        rewardMonths,
        grantedAt: nowIso(),
        grantedBy: req.user?.id || req.user?.email || 'admin',
        inviterFreeUntil: freeUntil
      };

      reward = patch.reward;
    }

    await referralProgramStateService.updateInvite(inviteId, patch);
    logReferralAdminAudit(req, 'referral_programs.driver_invite.evaluate', {
      type: 'referral_invite',
      id: inviteId
    }, {
      qualified,
      completedTrips,
      requiredTrips,
      rewardGranted: Boolean(reward)
    });

    res.json({
      success: true,
      inviteId,
      qualified,
      completedTrips,
      requiredTrips,
      reward
    });
  } catch (error) {
    logError(error, 'Erro ao avaliar convite de motorista', { service: 'referral-programs' });
    res.status(500).json({ error: 'Erro ao avaliar convite' });
  }
});

router.post('/founder/assign', authenticateJWT, requireRole(ADMIN_ROLES), requireAdminMutationsEnabled, async (req, res) => {
  try {
    const driverId = normalizeIdentifier(req.body?.driverId);
    if (!driverId) {
      return res.status(400).json({ error: 'driverId é obrigatório' });
    }

    const config = await loadProgramConfig();
    if (config.founder.enabled === false) {
      return res.status(400).json({ error: 'Plano founder está desativado' });
    }

    const months = toPositiveInt(req.body?.months, config.founder.freeMonths || DEFAULT_FOUNDER_MONTHS);
    const freeUntil = await extendFreeMonthsForUser(driverId, months, {
      source: 'founder_plan',
      waveTag: req.body?.waveTag || config.founder.waveTag,
      grantedAt: nowIso()
    });

    await referralProgramStateService.updateUserProfile(driverId, {
      founderPlan: {
        active: true,
        waveTag: req.body?.waveTag || config.founder.waveTag,
        freeMonths: months,
        assignedAt: nowIso(),
        assignedBy: req.user?.id || req.user?.email || 'admin',
        freeUntil
      }
    });
    logReferralAdminAudit(req, 'referral_programs.founder.assign', {
      type: 'driver',
      id: driverId
    }, {
      freeMonths: months,
      waveTag: req.body?.waveTag || config.founder.waveTag
    });

    res.json({
      success: true,
      driverId,
      freeMonths: months,
      freeUntil
    });
  } catch (error) {
    logError(error, 'Erro ao atribuir plano founder', { service: 'referral-programs' });
    res.status(500).json({ error: 'Erro ao atribuir plano founder' });
  }
});

router.get('/invites/me', ensureUserFromFirebaseToken, async (req, res) => {
  try {
    const userId = normalizeIdentifier(req.firebaseUser?.uid);
    const allInvites = await loadInvites();

    const sent = allInvites.filter((invite) => normalizeIdentifier(invite.inviterId) === userId);
    const received = allInvites.filter((invite) => normalizeIdentifier(invite.acceptedBy || invite.inviteeId) === userId);

    res.json({
      success: true,
      userId,
      sent,
      received
    });
  } catch (error) {
    logError(error, 'Erro ao listar convites do usuário', { service: 'referral-programs' });
    res.status(500).json({ error: 'Erro ao listar convites' });
  }
});

router.get('/summary', authenticateJWT, requireRole(ADMIN_ROLES), async (_req, res) => {
  try {
    const [config, campaigns, invites, passengerBenefits] = await Promise.all([
      loadProgramConfig(),
      loadCampaigns(),
      loadInvites(),
      referralProgramStateService.listPassengerBenefits().catch(() => [])
    ]);
    const passengerBenefitsActive = passengerBenefits.filter((benefit) =>
      String(benefit.status || '').toLowerCase() === 'active' &&
      Number(benefit.remainingRides || 0) > 0
    ).length;
    const passengerBenefitsConsumed = passengerBenefits.filter((benefit) =>
      String(benefit.status || '').toLowerCase() === 'consumed' ||
      Number(benefit.remainingRides || 0) <= 0
    ).length;
    const driverTracking = invites.filter((invite) =>
      normalizeCampaignType(invite.type) === 'driver_referral' &&
      String(invite?.qualification?.status || '').toLowerCase() === 'tracking'
    ).length;

    const summary = {
      campaigns: {
        total: campaigns.length,
        active: campaigns.filter((campaign) => campaignIsActive(campaign)).length,
        paused: campaigns.filter((campaign) => normalizeStatus(campaign.status) === 'paused').length,
        byType: {
          driver_referral: campaigns.filter((campaign) => normalizeCampaignType(campaign.type) === 'driver_referral').length,
          passenger_referral: campaigns.filter((campaign) => normalizeCampaignType(campaign.type) === 'passenger_referral').length,
          founder_wave: campaigns.filter((campaign) => normalizeCampaignType(campaign.type) === 'founder_wave').length
        }
      },
      invites: {
        total: invites.length,
        pending: invites.filter((invite) => String(invite.status || '').toLowerCase() === 'pending').length,
        accepted: invites.filter((invite) => String(invite.status || '').toLowerCase() === 'accepted').length,
        qualified: invites.filter((invite) => String(invite.status || '').toLowerCase() === 'qualified').length,
        rewarded: invites.filter((invite) => String(invite.rewardStatus || '').toLowerCase() === 'granted').length,
        driverReferral: invites.filter((invite) => normalizeCampaignType(invite.type) === 'driver_referral').length,
        passengerReferral: invites.filter((invite) => normalizeCampaignType(invite.type) === 'passenger_referral').length,
        driverTracking,
        passengerBenefitsActive,
        passengerBenefitsConsumed,
        acceptanceRate: invites.length > 0
          ? Number((invites.filter((invite) => ['accepted', 'qualified'].includes(String(invite.status || '').toLowerCase())).length / invites.length).toFixed(4))
          : 0,
        rewardRate: invites.length > 0
          ? Number((invites.filter((invite) => String(invite.rewardStatus || '').toLowerCase() === 'granted').length / invites.length).toFixed(4))
          : 0,
        recent: invites.slice(0, 8).map((invite) => ({
          id: invite.id,
          code: invite.code,
          type: invite.type,
          status: invite.status,
          rewardStatus: invite.rewardStatus || null,
          inviterId: invite.inviterId || null,
          acceptedBy: invite.acceptedBy || null,
          createdAt: invite.createdAt || null,
          acceptedAt: invite.acceptedAt || null,
        }))
      },
      config
    };

    res.json({ success: true, summary });
  } catch (error) {
    logError(error, 'Erro ao carregar summary de referral programs', { service: 'referral-programs' });
    res.status(500).json({ error: 'Erro ao carregar resumo' });
  }
});

module.exports = router;
