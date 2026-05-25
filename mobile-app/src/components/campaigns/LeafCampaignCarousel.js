import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Image,
  ImageBackground,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { fonts } from "../../theme/runtimeTokens";
import {
  loadCachedEligibleCampaigns,
  recordCampaignEvent,
  refreshEligibleCampaigns,
} from "../../services/runtime/campaignCenterService";

const LEAF_GREEN = "#1A330E";
const CARD_BORDER = "#ECE5DC";
const TEXT_PRIMARY = "#171412";
const TEXT_MUTED = "#827B73";
const DEFAULT_ROTATE_SECONDS = 6;
const IS_TEST_ENV = typeof process !== "undefined" && process.env?.NODE_ENV === "test";

function normalizeSeconds(value, fallback = DEFAULT_ROTATE_SECONDS) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(3, Math.min(20, parsed));
}

function LeafCampaignCarousel({
  surface,
  placement = "default",
  role = "customer",
  userId = "",
  context = {},
  limit = 3,
  height = 188,
  borderRadius = 28,
  style,
  enabled = true,
  fallbackCampaigns = [],
  onCampaignAction,
  testID = "leaf-campaign-carousel",
}) {
  const [campaigns, setCampaigns] = useState([]);
  const [remoteHydrated, setRemoteHydrated] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loadedImageIds, setLoadedImageIds] = useState(() => new Set());
  const [failedImageIds, setFailedImageIds] = useState(() => new Set());
  const entrance = useRef(new Animated.Value(0)).current;
  const trackedImpressionsRef = useRef(new Set());
  const contextKey = JSON.stringify(context || {});

  const requestContext = useMemo(
    () => ({
      ...context,
      userId,
      surface,
      placement,
      role,
      limit,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [contextKey, limit, placement, role, surface, userId],
  );

  useEffect(() => {
    let mounted = true;
    if (!enabled || !surface) {
      setCampaigns([]);
      setRemoteHydrated(true);
      return undefined;
    }
    if (IS_TEST_ENV && !Array.isArray(globalThis?.__LEAF_CAMPAIGN_FIXTURES__)) {
      setCampaigns([]);
      setRemoteHydrated(true);
      return undefined;
    }

    setRemoteHydrated(false);
    loadCachedEligibleCampaigns(requestContext)
      .then((cached) => {
        if (mounted && cached.campaigns?.length) {
          setCampaigns(cached.campaigns.slice(0, limit));
          setActiveIndex(0);
        }
      })
      .catch(() => null);

    refreshEligibleCampaigns(requestContext)
      .then((fresh) => {
        if (!mounted) return;
        setCampaigns((fresh.campaigns || []).slice(0, limit));
        setActiveIndex(0);
      })
      .catch(() => null)
      .finally(() => {
        if (mounted) setRemoteHydrated(true);
      });

    return () => {
      mounted = false;
    };
  }, [enabled, limit, requestContext, surface]);

  const renderCampaigns = campaigns.length > 0
    ? campaigns
    : remoteHydrated
      ? fallbackCampaigns
      : [];
  const activeCampaign = renderCampaigns[activeIndex] || renderCampaigns[0] || null;
  const hasRemoteCampaigns = campaigns.length > 0;
  const rotateSeconds = normalizeSeconds(activeCampaign?.rules?.autoRotateSeconds);
  const activeContent = activeCampaign?.content || {};
  const activeImageUrl = activeContent.imageUrl;
  const activeImageKey = activeCampaign?.id || activeImageUrl || activeContent.title || "campaign";
  const activeImageFailed = failedImageIds.has(activeImageKey);
  const activeShouldRenderImage = Boolean(activeImageUrl && !activeImageFailed);
  const activeImageLoaded = loadedImageIds.has(activeImageKey);
  const activeImageReady = Boolean(activeShouldRenderImage && activeImageLoaded);
  const activeImageOnly = activeContent.displayMode === "image_only" || activeContent.hideTextOverlay === true;
  const activeCampaignVisible = Boolean(activeCampaign) && (
    !activeImageOnly || !activeShouldRenderImage || activeImageReady
  );

  useEffect(() => {
    if (activeIndex >= renderCampaigns.length) {
      setActiveIndex(0);
    }
  }, [activeIndex, renderCampaigns.length]);

  useEffect(() => {
    if (renderCampaigns.length <= 1) return undefined;
    const timer = setInterval(() => {
      setActiveIndex((current) => (current + 1) % renderCampaigns.length);
    }, rotateSeconds * 1000);
    return () => clearInterval(timer);
  }, [renderCampaigns.length, rotateSeconds]);

  useEffect(() => {
    if (
      !activeCampaign?.id ||
      !hasRemoteCampaigns ||
      !activeCampaignVisible ||
      trackedImpressionsRef.current.has(activeCampaign.id)
    ) {
      return;
    }
    trackedImpressionsRef.current.add(activeCampaign.id);
    recordCampaignEvent("impression", activeCampaign, requestContext);
  }, [activeCampaign, activeCampaignVisible, hasRemoteCampaigns, requestContext]);

  useEffect(() => {
    if ((!activeCampaign?.id && !activeCampaign?.content?.title) || !activeCampaignVisible) return undefined;
    entrance.setValue(0);
    const animation = Animated.timing(entrance, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [activeCampaign?.content?.title, activeCampaign?.id, activeCampaignVisible, entrance]);

  useEffect(() => {
    if (!activeImageOnly || !activeImageUrl || activeImageLoaded || activeImageFailed) {
      return undefined;
    }

    let cancelled = false;
    Image.prefetch(activeImageUrl)
      .then(() => {
        if (cancelled) return;
        setLoadedImageIds((current) => {
          const next = new Set(current);
          next.add(activeImageKey);
          return next;
        });
      })
      .catch(() => {
        if (cancelled) return;
        setFailedImageIds((current) => {
          const next = new Set(current);
          next.add(activeImageKey);
          return next;
        });
      });

    return () => {
      cancelled = true;
    };
  }, [
    activeImageFailed,
    activeImageKey,
    activeImageLoaded,
    activeImageOnly,
    activeImageUrl,
  ]);

  const handlePress = () => {
    if (!activeCampaign) return;
    if (hasRemoteCampaigns) {
      recordCampaignEvent("click", activeCampaign, requestContext, {
        action: activeCampaign.content?.cta?.action || "",
      });
    }
    if (typeof onCampaignAction === "function") {
      onCampaignAction(activeCampaign);
    }
  };

  if (!activeCampaign || !activeCampaignVisible) return null;

  const content = activeContent;
  const imageUrl = content.imageUrl;
  const imageKey = activeImageKey;
  const imageFailed = activeImageFailed;
  const shouldRenderImage = activeShouldRenderImage;
  const imageReady = activeImageReady;
  const backgroundColor = content.backgroundColor || "#FBFCF8";
  const textColor = content.textColor || TEXT_PRIMARY;
  const imageSource = shouldRenderImage ? { uri: imageUrl } : null;
  const imageOnly = activeImageOnly;
  const hideContentOverlay = shouldRenderImage && imageOnly;
  const textOnImage = imageReady && !imageOnly;

  const handleImageLoad = () => {
    setLoadedImageIds((current) => {
      const next = new Set(current);
      next.add(imageKey);
      return next;
    });
  };

  const handleImageError = () => {
    setFailedImageIds((current) => {
      const next = new Set(current);
      next.add(imageKey);
      return next;
    });
  };

  const cardContent = (
    <View style={styles.content}>
      <View style={styles.copy}>
        {content.eyebrow ? (
          <Text style={[styles.eyebrow, { color: textOnImage ? "rgba(255,255,255,0.86)" : TEXT_MUTED }]} numberOfLines={1}>
            {content.eyebrow}
          </Text>
        ) : null}
        <Text style={[styles.title, { color: textOnImage ? "#FFFFFF" : textColor }]} numberOfLines={2}>
          {content.title}
        </Text>
        {content.body ? (
          <Text style={[styles.body, { color: textOnImage ? "rgba(255,255,255,0.9)" : TEXT_MUTED }]} numberOfLines={3}>
            {content.body}
          </Text>
        ) : null}
      </View>
      <View style={styles.footer}>
        {content.cta?.label ? (
          <View style={[styles.ctaPill, textOnImage ? styles.ctaPillOnImage : null]}>
            <Text style={[styles.ctaText, textOnImage ? styles.ctaTextOnImage : null]} numberOfLines={1}>
              {content.cta.label}
            </Text>
          </View>
        ) : <View />}
        {renderCampaigns.length > 1 ? (
          <View style={styles.dots} pointerEvents="none">
            {renderCampaigns.map((campaign, index) => (
              <View
                // eslint-disable-next-line react/no-array-index-key
                key={`${campaign.id || "fallback"}-${index}`}
                style={[
                  styles.dot,
                  index === activeIndex ? styles.dotActive : null,
                  textOnImage && index !== activeIndex ? styles.dotOnImage : null,
                  textOnImage && index === activeIndex ? styles.dotActiveOnImage : null,
                ]}
              />
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );

  return (
    <Animated.View
      style={[
        styles.wrap,
        {
          height,
          borderRadius,
          opacity: entrance.interpolate({
            inputRange: [0, 1],
            outputRange: [0.96, 1],
          }),
          transform: [
            {
              translateY: entrance.interpolate({
                inputRange: [0, 1],
                outputRange: [5, 0],
              }),
            },
          ],
        },
        style,
      ]}
      testID={testID}
    >
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={handlePress}
        style={[styles.card, { height, borderRadius, backgroundColor }]}
        accessibilityRole="button"
        accessibilityLabel={content.imageAlt || content.title || activeCampaign.name || "Campanha Leaf"}
      >
        {imageSource ? (
          <ImageBackground
            source={imageSource}
            onLoad={handleImageLoad}
            onError={handleImageError}
            resizeMode="cover"
            imageStyle={{ borderRadius }}
            style={styles.imageBackground}
          >
            {textOnImage ? <View style={[styles.imageScrim, { borderRadius }]} /> : null}
            {hideContentOverlay ? null : cardContent}
          </ImageBackground>
        ) : (
          cardContent
        )}
      </TouchableOpacity>
    </Animated.View>
  );
}

export default memo(LeafCampaignCarousel);

const styles = StyleSheet.create({
  wrap: {
    overflow: "hidden",
    zIndex: 16,
  },
  card: {
    overflow: "hidden",
    borderWidth: 1,
    borderColor: CARD_BORDER,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.1,
    shadowRadius: 18,
    elevation: Platform.OS === "android" ? 0 : 10,
  },
  imageBackground: {
    flex: 1,
  },
  imageScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.22)",
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 22,
    paddingBottom: 18,
  },
  copy: {
    flex: 1,
  },
  eyebrow: {
    fontFamily: fonts.Medium,
    fontSize: 11,
    lineHeight: 15,
  },
  title: {
    marginTop: 7,
    fontFamily: fonts.SemiBold,
    fontSize: 22,
    lineHeight: 28,
  },
  body: {
    marginTop: 8,
    maxWidth: "88%",
    fontFamily: fonts.Regular,
    fontSize: 13,
    lineHeight: 18,
  },
  footer: {
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  ctaPill: {
    minHeight: 34,
    borderRadius: 17,
    backgroundColor: LEAF_GREEN,
    paddingHorizontal: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaPillOnImage: {
    backgroundColor: "rgba(255,255,255,0.94)",
  },
  ctaText: {
    color: "#FFFFFF",
    fontFamily: fonts.SemiBold,
    fontSize: 12,
    lineHeight: 16,
  },
  ctaTextOnImage: {
    color: LEAF_GREEN,
  },
  dots: {
    flexDirection: "row",
    alignItems: "center",
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginLeft: 6,
    backgroundColor: "#DDE6D9",
  },
  dotActive: {
    width: 18,
    backgroundColor: LEAF_GREEN,
  },
  dotOnImage: {
    backgroundColor: "rgba(255,255,255,0.52)",
  },
  dotActiveOnImage: {
    backgroundColor: "#FFFFFF",
  },
});
