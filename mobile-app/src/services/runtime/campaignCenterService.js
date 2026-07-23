import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import apiClient from "../httpClient";

const CACHE_TTL_MS = 5 * 60 * 1000;
const LOCAL_DISMISS_TTL_MS = 48 * 60 * 60 * 1000;
const CACHE_PREFIX = "@leaf_campaign_cache";
const DISMISS_PREFIX = "@leaf_campaign_dismissals";
const IS_TEST_ENV = typeof process !== "undefined" && process.env?.NODE_ENV === "test";
const FEATURE_DISABLED_CODE = "FEATURE_DISABLED_IN_LAUNCH_PROFILE";

function normalizeText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = normalizeSlug(value);
    if (["true", "1", "yes", "sim", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "nao", "off"].includes(normalized)) return false;
  }
  return fallback;
}

function normalizeDisplayMode(value, fallback = "text_overlay") {
  const normalized = normalizeSlug(value, fallback);
  if (["image_only", "creative_only", "full_art", "arte_completa"].includes(normalized)) return "image_only";
  return "text_overlay";
}

function normalizeSlug(value, fallback = "") {
  return String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_./:-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeCampaign(raw = {}) {
  const content = raw.content && typeof raw.content === "object" ? raw.content : {};
  const cta = content.cta && typeof content.cta === "object" ? content.cta : {};
  const displayMode = normalizeDisplayMode(
    content.displayMode || content.creativeMode || content.renderMode,
    normalizeBoolean(content.hideTextOverlay) ? "image_only" : "text_overlay",
  );
  return {
    id: normalizeText(raw.id || raw.campaignId),
    name: normalizeText(raw.name),
    template: normalizeSlug(raw.template, "compact_banner"),
    surface: normalizeSlug(raw.surface),
    placement: normalizeSlug(raw.placement),
    role: normalizeSlug(raw.role || raw.userType),
    priority: Number(raw.priority || 0) || 0,
    content: {
      eyebrow: normalizeText(content.eyebrow),
      title: normalizeText(content.title),
      body: normalizeText(content.body),
      footnote: normalizeText(content.footnote),
      accent: normalizeText(content.accent, "#1A330E"),
      assetKey: normalizeSlug(content.assetKey),
      imageUrl: normalizeText(content.imageUrl || content.imageURL || content.assetUrl),
      imageAlt: normalizeText(content.imageAlt || content.altText),
      displayMode,
      hideTextOverlay: displayMode === "image_only" || normalizeBoolean(content.hideTextOverlay),
      backgroundColor: normalizeText(content.backgroundColor, "#FBFCF8"),
      textColor: normalizeText(content.textColor, "#171412"),
      cta: {
        label: normalizeText(cta.label),
        action: normalizeSlug(cta.action),
        url: normalizeText(cta.url),
        route: normalizeText(cta.route),
        payload: cta.payload && typeof cta.payload === "object" ? cta.payload : {},
      },
    },
    rules: raw.rules && typeof raw.rules === "object"
      ? {
          autoRotateSeconds: Number(raw.rules.autoRotateSeconds || 6) || 6,
          rotationWeight: Number(raw.rules.rotationWeight || 1) || 1,
        }
      : {
          autoRotateSeconds: 6,
          rotationWeight: 1,
        },
    tracking: raw.tracking && typeof raw.tracking === "object" ? raw.tracking : {},
  };
}

function normalizeCampaignList(items = []) {
  return Array.isArray(items)
    ? items.map(normalizeCampaign).filter((campaign) => (
        campaign.id &&
        (
          campaign.content.title ||
          campaign.content.imageUrl ||
          campaign.content.assetKey
        )
      ))
    : [];
}

function campaignRoleMatches(campaignRole = '', requestedRole = '') {
  const role = normalizeSlug(requestedRole);
  const campaignRoleSlug = normalizeSlug(campaignRole);
  if (!role || !campaignRoleSlug || campaignRoleSlug === 'all') return true;
  if (role === 'customer' || role === 'passenger') {
    return campaignRoleSlug === 'customer' || campaignRoleSlug === 'passenger';
  }
  return campaignRoleSlug === role;
}

function applyLimit(campaigns = [], context = {}) {
  const limit = Math.max(1, Number(context.limit || campaigns.length || 1) || 1);
  return campaigns.slice(0, limit);
}

function buildCacheKey(context = {}) {
  const userId = normalizeText(context.userId, "anonymous");
  const role = normalizeSlug(context.role || context.userType, "all");
  const surface = normalizeSlug(context.surface, "default");
  const placement = normalizeSlug(context.placement, "default");
  return `${CACHE_PREFIX}:${userId}:${role}:${surface}:${placement}`;
}

function buildDismissKey(userId = "") {
  return `${DISMISS_PREFIX}:${normalizeText(userId, "anonymous")}`;
}

function resolveTestCampaigns(context = {}) {
  const fixtures = globalThis?.__LEAF_CAMPAIGN_FIXTURES__;
  if (!Array.isArray(fixtures)) {
    return [];
  }
  const surface = normalizeSlug(context.surface);
  const placement = normalizeSlug(context.placement);
  const role = normalizeSlug(context.role || context.userType);
  return applyLimit(normalizeCampaignList(fixtures).filter((campaign) => {
    if (surface && campaign.surface && campaign.surface !== surface) return false;
    if (placement && campaign.placement && campaign.placement !== placement) return false;
    if (role && campaign.role && !campaignRoleMatches(campaign.role, role)) return false;
    return true;
  }), context);
}

async function loadDismissals(userId = "") {
  try {
    const raw = await AsyncStorage.getItem(buildDismissKey(userId));
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_error) {
    return {};
  }
}

async function saveDismissal(userId = "", campaignId = "") {
  if (!campaignId) return;
  const current = await loadDismissals(userId);
  current[campaignId] = new Date().toISOString();
  await AsyncStorage.setItem(buildDismissKey(userId), JSON.stringify(current));
}

async function filterDismissed(campaigns = [], userId = "") {
  const dismissals = await loadDismissals(userId);
  const now = Date.now();
  return campaigns.filter((campaign) => {
    const dismissedAt = dismissals[campaign.id];
    if (!dismissedAt) return true;
    const dismissedTs = new Date(dismissedAt).getTime();
    if (!Number.isFinite(dismissedTs)) return true;
    return now - dismissedTs > LOCAL_DISMISS_TTL_MS;
  });
}

export async function loadCachedEligibleCampaigns(context = {}) {
  try {
    const raw = await AsyncStorage.getItem(buildCacheKey(context));
    if (!raw) {
      return { campaigns: [], cached: false, stale: false };
    }
    const parsed = JSON.parse(raw);
    const expiresAt = Number(parsed?.expiresAt || 0);
    const campaigns = applyLimit(await filterDismissed(
      normalizeCampaignList(parsed?.campaigns),
      context.userId,
    ), context);
    return {
      campaigns,
      cached: true,
      stale: !expiresAt || Date.now() > expiresAt,
      updatedAt: parsed?.updatedAt || null,
      disabled: parsed?.disabled === true,
    };
  } catch (_error) {
    return { campaigns: [], cached: false, stale: false };
  }
}

export async function refreshEligibleCampaigns(context = {}) {
  if (IS_TEST_ENV) {
    return {
      campaigns: applyLimit(await filterDismissed(resolveTestCampaigns(context), context.userId), context),
      cached: false,
      stale: false,
      test: true,
    };
  }

  const params = new URLSearchParams();
  params.append("surface", normalizeSlug(context.surface));
  params.append("placement", normalizeSlug(context.placement, "default"));
  params.append("role", normalizeSlug(context.role || context.userType, "all"));
  params.append("platform", normalizeSlug(context.platform || Platform.OS));
  params.append("limit", String(Math.max(1, Number(context.limit || 1) || 1)));
  if (context.appVersion) params.append("appVersion", String(context.appVersion));
  if (context.city) params.append("city", String(context.city));
  if (context.completedTrips !== undefined && context.completedTrips !== null) {
    params.append("completedTrips", String(context.completedTrips));
  }

  const response = await apiClient.get(
    `/api/campaign-center/eligible?${params.toString()}`,
    {
      validateStatus: (status) =>
        (status >= 200 && status < 300) || status === 503,
    },
  );
  const featureDisabled = isCampaignCenterDisabledResponse(response);
  if (featureDisabled) {
    const payload = {
      campaigns: [],
      disabled: true,
      updatedAt: new Date().toISOString(),
      expiresAt: Date.now() + CACHE_TTL_MS,
    };
    await AsyncStorage.setItem(buildCacheKey(context), JSON.stringify(payload));
    return { ...payload, cached: false, stale: false };
  }
  if (Number(response?.status || 0) >= 400) {
    const error = new Error(response?.data?.error || "Campaign Center indisponível");
    error.response = response;
    throw error;
  }
  const campaigns = applyLimit(await filterDismissed(
    normalizeCampaignList(response?.data?.campaigns),
    context.userId,
  ), context);
  const payload = {
    campaigns,
    updatedAt: new Date().toISOString(),
    expiresAt: Date.now() + CACHE_TTL_MS,
  };
  await AsyncStorage.setItem(buildCacheKey(context), JSON.stringify(payload));
  return { ...payload, cached: false, stale: false };
}

export async function resolveEligibleCampaigns(context = {}) {
  const cached = await loadCachedEligibleCampaigns(context);
  if (!cached.stale && (cached.campaigns.length > 0 || cached.disabled === true)) {
    return cached;
  }

  try {
    return await refreshEligibleCampaigns(context);
  } catch (_error) {
    return cached;
  }
}

export async function recordCampaignEvent(eventType, campaign = {}, context = {}, metadata = {}) {
  const campaignId = normalizeText(campaign.id || campaign.campaignId);
  if (!campaignId) return null;
  if (IS_TEST_ENV && !globalThis?.__LEAF_CAMPAIGN_ALLOW_TEST_TRACKING__) {
    return { skipped: true, eventType, campaignId };
  }

  try {
    const response = await apiClient.post("/api/campaign-center/events", {
      eventType,
      campaignId,
      surface: campaign.surface || context.surface,
      placement: campaign.placement || context.placement,
      role: context.role || context.userType,
      platform: context.platform || Platform.OS,
      appVersion: context.appVersion || "",
      metadata,
    });
    return response?.data?.event || null;
  } catch (_error) {
    return null;
  }
}

export async function dismissCampaign(campaign = {}, context = {}) {
  await saveDismissal(context.userId, campaign.id || campaign.campaignId);
  return recordCampaignEvent("dismiss", campaign, context);
}

export function isCampaignCenterDisabledResponse(response = {}) {
  return (
    Number(response?.status || 0) === 503 &&
    normalizeText(response?.data?.code).toUpperCase() === FEATURE_DISABLED_CODE
  );
}

export { normalizeCampaign };
