import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Image, Platform } from 'react-native';
import {
  loadCachedEligibleCampaigns,
  recordCampaignEvent,
  refreshEligibleCampaigns,
} from '../services/runtime/campaignCenterService';
import { resolveVehicleMarkerShapeKey } from '../components/prototype/leafVehicleArtwork';

const IS_TEST_ENV = typeof process !== 'undefined' && process.env?.NODE_ENV === 'test';
const normalizeUrl = value => String(value || '').trim();

export function campaignAssetIsInWindow(campaign, now = Date.now()) {
  const start = campaign?.startAt ? Date.parse(campaign.startAt) : null;
  const end = campaign?.endAt ? Date.parse(campaign.endAt) : null;
  if ((start !== null && !Number.isFinite(start)) || (end !== null && !Number.isFinite(end))) return false;
  return (!Number.isFinite(start) || now >= start) && (!Number.isFinite(end) || now < end);
}

export function selectCampaignWithAsset(campaigns = []) {
  return Array.isArray(campaigns)
    ? campaigns.find(campaign => campaignAssetIsInWindow(campaign) && (
        normalizeUrl(campaign?.content?.imageUrl) || resolveVehicleMarkerShapeKey(campaign?.content?.assetKey)
      )) || null
    : null;
}

export default function useCampaignAssetOverride({
  enabled = true, surface, placement = 'default', role = 'all', userId = '',
  context = {}, limit = 1, eventMetadata = {},
} = {}) {
  const [assetState, setAssetState] = useState({ requestKey: '', campaign: null, hydrated: false });
  const [readyImageUrl, setReadyImageUrl] = useState('');
  const trackedAssetImpressionsRef = useRef(new Set());
  const contextKey = JSON.stringify(context || {});
  const eventMetadataKey = JSON.stringify(eventMetadata || {});
  const requestContext = useMemo(() => ({
    ...context, userId, surface, placement, role, limit, platform: context.platform || Platform.OS,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [contextKey, limit, placement, role, surface, userId]);
  const requestKey = JSON.stringify(requestContext);

  useEffect(() => {
    let mounted = true;
    let freshResolved = false;
    let latestRefresh = 0;
    if (!enabled || !surface || (IS_TEST_ENV && !Array.isArray(globalThis?.__LEAF_CAMPAIGN_FIXTURES__))) {
      setAssetState({ requestKey, campaign: null, hydrated: true });
      return undefined;
    }
    setAssetState({ requestKey, campaign: null, hydrated: false });
    loadCachedEligibleCampaigns(requestContext).then(cached => {
      if (mounted && !freshResolved && !cached.stale && !cached.disabled) {
        const cachedCampaign = selectCampaignWithAsset(cached.campaigns);
        if (cachedCampaign) setAssetState({ requestKey, campaign: cachedCampaign, hydrated: false });
      }
    }).catch(() => null);
    const refresh = () => {
      const refreshVersion = ++latestRefresh;
      return refreshEligibleCampaigns(requestContext).then(fresh => {
        if (mounted && refreshVersion === latestRefresh) {
          freshResolved = true;
          setAssetState({ requestKey, campaign: selectCampaignWithAsset(fresh.campaigns), hydrated: true });
        }
      }).catch(() => {
        if (mounted && refreshVersion === latestRefresh) setAssetState(current => ({ ...current, hydrated: true }));
      });
    };
    refresh();
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') refresh();
    });
    return () => { mounted = false; subscription?.remove?.(); };
  }, [enabled, requestContext, requestKey, surface]);

  const campaign = enabled && assetState.requestKey === requestKey && campaignAssetIsInWindow(assetState.campaign)
    ? assetState.campaign : null;
  const imageUrl = normalizeUrl(campaign?.content?.imageUrl);
  const shapeKey = resolveVehicleMarkerShapeKey(campaign?.content?.assetKey);

  useEffect(() => {
    if (!campaign?.endAt) return undefined;
    let timer;
    const expire = () => {
      const remaining = Date.parse(campaign.endAt) - Date.now();
      if (remaining <= 0) {
        setAssetState(current => current.campaign === campaign ? { ...current, campaign: null } : current);
      } else {
        timer = setTimeout(expire, Math.min(remaining, 2147483647));
      }
    };
    expire();
    return () => clearTimeout(timer);
  }, [campaign]);

  useEffect(() => {
    let cancelled = false;
    setReadyImageUrl('');
    if (!imageUrl) return undefined;
    Promise.resolve().then(() => typeof Image.prefetch === 'function' ? Image.prefetch(imageUrl) : true)
      .then(loaded => { if (!cancelled && loaded !== false) setReadyImageUrl(imageUrl); })
      .catch(() => null);
    return () => { cancelled = true; };
  }, [imageUrl]);

  // Never leak a previous campaign's ready image across account or role changes.
  const visibleImageUrl = readyImageUrl === imageUrl ? readyImageUrl : '';
  const visibleAsset = visibleImageUrl || shapeKey;
  useEffect(() => {
    if (!visibleAsset || !campaign?.id) return;
    // A vector may be visible while its custom image loads. That transition is
    // one campaign impression, not a second paid creative impression.
    const trackingKey = `${userId}:${campaign.id}:${imageUrl || shapeKey}`;
    if (trackedAssetImpressionsRef.current.has(trackingKey)) return;
    trackedAssetImpressionsRef.current.add(trackingKey);
    recordCampaignEvent('impression', campaign, requestContext, {
      ...eventMetadata, assetType: 'map_vehicle_marker', imageUrl: visibleImageUrl, assetKey: shapeKey,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaign, eventMetadataKey, visibleAsset, visibleImageUrl, imageUrl, shapeKey, requestContext, userId]);

  return { campaign, imageUrl: visibleImageUrl, shapeKey, hydrated: assetState.requestKey === requestKey && assetState.hydrated };
}
