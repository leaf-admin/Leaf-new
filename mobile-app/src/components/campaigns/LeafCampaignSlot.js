import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { fonts } from "../../theme/runtimeTokens";
import {
  dismissCampaign,
  loadCachedEligibleCampaigns,
  recordCampaignEvent,
  refreshEligibleCampaigns,
} from "../../services/runtime/campaignCenterService";

const LEAF_GREEN = "#1A330E";
const SURFACE = "rgba(250, 251, 248, 0.94)";
const LINE = "rgba(216, 226, 213, 0.82)";
const TEXT = "#111611";
const MUTED = "#677064";
const IS_TEST_ENV = typeof process !== "undefined" && process.env?.NODE_ENV === "test";

function LeafCampaignSlot({
  surface,
  placement = "default",
  role = "customer",
  userId = "",
  context = {},
  style,
  enabled = true,
  dismissible = true,
  onCampaignAction,
  testID = "leaf-campaign-slot",
}) {
  const [campaign, setCampaign] = useState(null);
  const [loadingCached, setLoadingCached] = useState(false);
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
      limit: 1,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [contextKey, placement, role, surface, userId],
  );

  useEffect(() => {
    let mounted = true;
    if (!enabled || !surface) {
      setCampaign(null);
      return undefined;
    }
    if (IS_TEST_ENV && !Array.isArray(globalThis?.__LEAF_CAMPAIGN_FIXTURES__)) {
      setCampaign(null);
      return undefined;
    }

    setLoadingCached(true);
    loadCachedEligibleCampaigns(requestContext)
      .then((cached) => {
        if (mounted && cached.campaigns?.[0]) {
          setCampaign(cached.campaigns[0]);
        }
      })
      .catch(() => null)
      .finally(() => {
        if (mounted) setLoadingCached(false);
      });

    refreshEligibleCampaigns(requestContext)
      .then((fresh) => {
        if (!mounted) return;
        setCampaign(fresh.campaigns?.[0] || null);
      })
      .catch(() => null);

    return () => {
      mounted = false;
    };
  }, [enabled, requestContext, surface]);

  useEffect(() => {
    if (!campaign?.id || trackedImpressionsRef.current.has(campaign.id)) return;
    trackedImpressionsRef.current.add(campaign.id);
    recordCampaignEvent("impression", campaign, requestContext);
  }, [campaign, requestContext]);

  useEffect(() => {
    if (!campaign?.id) return undefined;
    entrance.setValue(0);
    const animation = Animated.timing(entrance, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [campaign?.id, entrance]);

  const handlePress = () => {
    if (!campaign) return;
    recordCampaignEvent("click", campaign, requestContext, {
      action: campaign.content?.cta?.action || "",
    });
    if (typeof onCampaignAction === "function") {
      onCampaignAction(campaign);
    }
  };

  const handleDismiss = async () => {
    if (!campaign) return;
    await dismissCampaign(campaign, requestContext);
    setCampaign(null);
  };

  if (!campaign) {
    if (!loadingCached) return null;
    return null;
  }

  const ctaLabel = campaign.content?.cta?.label;

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.wrap,
        style,
        {
          opacity: entrance.interpolate({
            inputRange: [0, 1],
            outputRange: [0.92, 1],
          }),
          transform: [
            {
              translateY: entrance.interpolate({
                inputRange: [0, 1],
                outputRange: [6, 0],
              }),
            },
          ],
        },
      ]}
      testID={testID}
    >
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={handlePress}
        style={styles.card}
        accessibilityRole="button"
        accessibilityLabel={campaign.content?.title || campaign.name || "Campanha Leaf"}
      >
        <View style={styles.accentRail} />
        <View style={styles.copy}>
          {campaign.content?.eyebrow ? (
            <Text style={styles.eyebrow} numberOfLines={1}>
              {campaign.content.eyebrow}
            </Text>
          ) : null}
          <Text style={styles.title} numberOfLines={1}>
            {campaign.content?.title}
          </Text>
          <Text style={styles.body} numberOfLines={2}>
            {campaign.content?.body}
          </Text>
        </View>
        {ctaLabel ? (
          <View style={styles.ctaPill}>
            <Text style={styles.ctaText} numberOfLines={1}>
              {ctaLabel}
            </Text>
          </View>
        ) : (
          <View style={styles.iconPill}>
            <Ionicons name="leaf-outline" size={15} color={LEAF_GREEN} />
          </View>
        )}
        {dismissible ? (
          <TouchableOpacity
            activeOpacity={0.78}
            onPress={handleDismiss}
            style={styles.dismiss}
            accessibilityLabel="Dispensar campanha"
            testID={`${testID}-dismiss`}
          >
            <Ionicons name="close" size={13} color={MUTED} />
          </TouchableOpacity>
        ) : null}
      </TouchableOpacity>
    </Animated.View>
  );
}

export default memo(LeafCampaignSlot);

export function LeafCampaignLoadingPreview({ style }) {
  return (
    <View style={[styles.card, styles.previewCard, style]}>
      <ActivityIndicator size="small" color={LEAF_GREEN} />
      <Text style={styles.previewText}>Carregando campanha</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 23,
    right: 23,
    zIndex: 15,
  },
  card: {
    minHeight: 82,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: LINE,
    backgroundColor: SURFACE,
    paddingVertical: 13,
    paddingLeft: 16,
    paddingRight: 14,
    flexDirection: "row",
    alignItems: "center",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: Platform.OS === "android" ? 0 : 8,
  },
  accentRail: {
    width: 4,
    height: 46,
    borderRadius: 999,
    backgroundColor: LEAF_GREEN,
    marginRight: 12,
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  eyebrow: {
    color: MUTED,
    fontFamily: fonts.Medium,
    fontSize: 10,
    lineHeight: 13,
    textTransform: "uppercase",
  },
  title: {
    marginTop: 1,
    color: TEXT,
    fontFamily: fonts.SemiBold,
    fontSize: 14,
    lineHeight: 18,
  },
  body: {
    marginTop: 3,
    color: MUTED,
    fontFamily: fonts.Regular,
    fontSize: 12,
    lineHeight: 16,
  },
  ctaPill: {
    marginLeft: 10,
    maxWidth: 104,
    minHeight: 32,
    borderRadius: 999,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#EAF1E6",
  },
  ctaText: {
    color: LEAF_GREEN,
    fontFamily: fonts.SemiBold,
    fontSize: 11,
    lineHeight: 14,
  },
  iconPill: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#EAF1E6",
  },
  dismiss: {
    position: "absolute",
    top: 7,
    right: 7,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 255, 255, 0.72)",
  },
  previewCard: {
    gap: 8,
    justifyContent: "center",
  },
  previewText: {
    color: MUTED,
    fontFamily: fonts.Medium,
    fontSize: 12,
  },
});
