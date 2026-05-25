import { useEffect, useMemo, useRef, useState } from 'react';
import { Image, Platform } from 'react-native';
import {
  loadCachedEligibleCampaigns,
  recordCampaignEvent,
  refreshEligibleCampaigns,
} from '../services/runtime/campaignCenterService';

const IS_TEST_ENV = typeof process !== 'undefined' && process.env?.NODE_ENV === 'test';

function normalizeUrl(value) {
  return String(value || '').trim();
}

function selectCampaignWithAsset(campaigns = []) {
  return Array.isArray(campaigns)
    ? campaigns.find((campaign) => normalizeUrl(campaign?.content?.imageUrl))
    : null;
}

export default function useCampaignAssetOverride({
  enabled = true,
  surface,
  placement = 'default',
  role = 'all',
  userId = '',
  context = {},
  limit = 1,
  eventMetadata = {},
} = {}) {
  const [campaign, setCampaign] = useState(null);
  const [readyImageUrl, setReadyImageUrl] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const trackedAssetImpressionsRef = useRef(new Set());
  const contextKey = JSON.stringify(context || {});
  const eventMetadataKey = JSON.stringify(eventMetadata || {});

  const requestContext = useMemo(
    () => ({
      ...context,
      userId,
      surface,
      placement,
      role,
      limit,
      platform: context.platform || Platform.OS,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [contextKey, limit, placement, role, surface, userId],
  );

  useEffect(() => {
    let mounted = true;

    if (!enabled || !surface) {
      setCampaign(null);
      setReadyImageUrl('');
      setHydrated(true);
      return undefined;
    }
    if (IS_TEST_ENV && !Array.isArray(globalThis?.__LEAF_CAMPAIGN_FIXTURES__)) {
      setCampaign(null);
      setReadyImageUrl('');
      setHydrated(true);
      return undefined;
    }

    setHydrated(false);

    loadCachedEligibleCampaigns(requestContext)
      .then((cached) => {
        if (!mounted) return;
        const cachedCampaign = selectCampaignWithAsset(cached.campaigns);
        if (cachedCampaign) {
          setCampaign(cachedCampaign);
        }
      })
      .catch(() => null);

    refreshEligibleCampaigns(requestContext)
      .then((fresh) => {
        if (!mounted) return;
        setCampaign(selectCampaignWithAsset(fresh.campaigns) || null);
      })
      .catch(() => null)
      .finally(() => {
        if (mounted) {
          setHydrated(true);
        }
      });

    return () => {
      mounted = false;
    };
  }, [enabled, requestContext, surface]);

  const imageUrl = normalizeUrl(campaign?.content?.imageUrl);

  useEffect(() => {
    let cancelled = false;

    if (!imageUrl) {
      setReadyImageUrl('');
      return undefined;
    }

    const prefetchImage =
      typeof Image.prefetch === 'function'
        ? Image.prefetch(imageUrl)
        : Promise.resolve(true);

    prefetchImage
      .then((loaded) => {
        if (!cancelled && loaded !== false) {
          setReadyImageUrl(imageUrl);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setReadyImageUrl('');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [imageUrl]);

  useEffect(() => {
    if (!readyImageUrl || !campaign?.id) {
      return;
    }

    const trackingKey = `${campaign.id}:${readyImageUrl}`;
    if (trackedAssetImpressionsRef.current.has(trackingKey)) {
      return;
    }

    trackedAssetImpressionsRef.current.add(trackingKey);
    recordCampaignEvent('impression', campaign, requestContext, {
      assetType: 'map_vehicle_marker',
      imageUrl: readyImageUrl,
      ...eventMetadata,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaign, eventMetadataKey, readyImageUrl, requestContext]);

  return {
    campaign,
    imageUrl: readyImageUrl,
    hydrated,
  };
}
