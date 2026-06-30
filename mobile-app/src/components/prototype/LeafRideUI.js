import React from "react";
import { ActivityIndicator, Animated, Easing, Image, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { fonts } from "../../theme/runtimeTokens";

const AnimatedTouchableOpacity = Animated.createAnimatedComponent(TouchableOpacity);

export const leafRideColors = {
  bg: "#F7F8F4",
  sheet: "#FFFFFF",
  sheetTranslucent: "#FFFFFF",
  text: "#171412",
  secondary: "#756F68",
  muted: "#827B73",
  line: "#E9E2D8",
  borderStrong: "#E2DAD0",
  field: "#F7F8F4",
  leaf: "#1A330E",
  leafLight: "#EEF3EA",
  accent: "#1A330E",
  accentDark: "#102307",
  accentSoft: "#EEF3EA",
  accentBorder: "#D9E3D3",
  blue: "#F3F5F2",
  blueText: "#514B45",
  warning: "#F7F8F4",
  warningText: "#7A6337",
  danger: "#FFF1F2",
  dangerText: "#D7153A",
};

export const leafButtonMetrics = Object.freeze({
  height: 48,
  radius: 24,
  iconSize: 16,
  iconGap: 6,
});

const toneConfig = {
  leaf: {
    fill: leafRideColors.leafLight,
    text: leafRideColors.leaf,
    border: leafRideColors.line,
  },
  dark: {
    fill: leafRideColors.leaf,
    text: "#FFFFFF",
    border: leafRideColors.leaf,
  },
  blue: {
    fill: leafRideColors.blue,
    text: leafRideColors.blueText,
    border: leafRideColors.line,
  },
  warning: {
    fill: leafRideColors.warning,
    text: leafRideColors.warningText,
    border: leafRideColors.line,
  },
  danger: {
    fill: leafRideColors.danger,
    text: leafRideColors.dangerText,
    border: leafRideColors.danger,
  },
  ghost: {
    fill: "#FFFFFF",
    text: leafRideColors.text,
    border: leafRideColors.line,
  },
};

function resolveTone(tone = "leaf") {
  return toneConfig[tone] || toneConfig.leaf;
}

function resolveAvatarSource(photoUri) {
  const uri = String(photoUri || "").trim();
  return uri ? { uri } : null;
}

function useLeafPressScale(disabled = false, pressedScale = 0.982) {
  const scale = React.useRef(new Animated.Value(1)).current;

  const settle = React.useCallback(
    (toValue) => {
      scale.stopAnimation();
      Animated.spring(scale, {
        toValue,
        stiffness: 420,
        damping: 34,
        mass: 0.72,
        overshootClamping: true,
        useNativeDriver: true,
      }).start();
    },
    [scale],
  );

  const onPressIn = React.useCallback(() => {
    if (!disabled) {
      settle(pressedScale);
    }
  }, [disabled, pressedScale, settle]);

  const onPressOut = React.useCallback(() => {
    settle(1);
  }, [settle]);

  React.useEffect(() => {
    if (disabled) {
      settle(1);
    }
  }, [disabled, settle]);

  return { scale, onPressIn, onPressOut };
}

export function LeafStateHeader({
  title,
  subtitle,
  rightLabel,
  rightTone = "leaf",
  insetsTop = 0,
  onLayout,
}) {
  const top = insetsTop + 50;
  const entrance = React.useRef(new Animated.Value(0)).current;
  const settle = React.useRef(new Animated.Value(1)).current;
  const stateKey = `${title || ""}|${subtitle || ""}|${rightLabel || ""}|${rightTone || ""}`;
  const previousStateKeyRef = React.useRef(stateKey);

  React.useEffect(() => {
    const animation = Animated.spring(entrance, {
      toValue: 1,
      stiffness: 260,
      damping: 24,
      mass: 0.82,
      overshootClamping: true,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [entrance]);

  React.useEffect(() => {
    if (previousStateKeyRef.current === stateKey) {
      return undefined;
    }
    previousStateKeyRef.current = stateKey;
    settle.stopAnimation();
    settle.setValue(0.986);
    const animation = Animated.spring(settle, {
      toValue: 1,
      stiffness: 360,
      damping: 30,
      mass: 0.76,
      overshootClamping: true,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [settle, stateKey]);

  const animatedStyle = {
    opacity: entrance.interpolate({
      inputRange: [0, 1],
      outputRange: [0.96, 1],
    }),
    transform: [
      {
        translateY: entrance.interpolate({
          inputRange: [0, 1],
          outputRange: [-8, 0],
        }),
      },
      {
        scale: entrance.interpolate({
          inputRange: [0, 1],
          outputRange: [0.985, 1],
        }),
      },
      { scale: settle },
    ],
  };

  return (
    <Animated.View
      pointerEvents="box-none"
      onLayout={onLayout}
      style={[styles.stateHeader, { top }, animatedStyle]}
    >
      <View style={styles.stateHeaderCopy}>
        <Text style={styles.stateHeaderTitle} numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.stateHeaderSubtitle} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {rightLabel ? (
        <LeafPill label={rightLabel} tone={rightTone} style={styles.headerPill} />
      ) : null}
    </Animated.View>
  );
}

export function LeafRideSheet({
  children,
  style,
  onLayout,
  testID,
  accessibilityLabel,
  scrollEnabled = false,
  scrollStyle,
  scrollContentContainerStyle,
  showsVerticalScrollIndicator = false,
}) {
  const entrance = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    const animation = Animated.spring(entrance, {
      toValue: 1,
      stiffness: 250,
      damping: 25,
      mass: 0.86,
      overshootClamping: true,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [entrance]);

  const animatedStyle = {
    opacity: entrance.interpolate({
      inputRange: [0, 1],
      outputRange: [0.98, 1],
    }),
    transform: [
      {
        translateY: entrance.interpolate({
          inputRange: [0, 1],
          outputRange: [14, 0],
        }),
      },
      {
        scale: entrance.interpolate({
          inputRange: [0, 1],
          outputRange: [0.99, 1],
        }),
      },
    ],
  };

  return (
    <Animated.View
      onLayout={onLayout}
      style={[styles.sheet, animatedStyle, style]}
      testID={testID}
      accessibilityLabel={accessibilityLabel}
    >
      {scrollEnabled ? (
        <ScrollView
          bounces={false}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
          showsVerticalScrollIndicator={showsVerticalScrollIndicator}
          style={[styles.sheetScroll, scrollStyle]}
          contentContainerStyle={[styles.sheetScrollContent, scrollContentContainerStyle]}
        >
          {children}
        </ScrollView>
      ) : (
        children
      )}
    </Animated.View>
  );
}

export function LeafPill({ label, tone = "leaf", style, testID }) {
  const palette = resolveTone(tone);
  const settle = React.useRef(new Animated.Value(1)).current;
  const pillKey = `${label || ""}|${tone || ""}`;
  const previousPillKeyRef = React.useRef(pillKey);

  React.useEffect(() => {
    if (previousPillKeyRef.current === pillKey) {
      return undefined;
    }
    previousPillKeyRef.current = pillKey;
    settle.stopAnimation();
    settle.setValue(0.97);
    const animation = Animated.spring(settle, {
      toValue: 1,
      stiffness: 380,
      damping: 32,
      mass: 0.7,
      overshootClamping: true,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [pillKey, settle]);

  return (
    <Animated.View
      style={[
        styles.pill,
        {
          backgroundColor: palette.fill,
          borderColor: palette.border,
        },
        { transform: [{ scale: settle }] },
        style,
      ]}
      testID={testID}
    >
      <Text style={[styles.pillText, { color: palette.text }]} numberOfLines={1}>
        {label}
      </Text>
    </Animated.View>
  );
}

export function LeafAnimatedPressable({
  children,
  style,
  disabled = false,
  activeScale = 0.982,
  onPressIn,
  onPressOut,
  activeOpacity = 1,
  ...props
}) {
  const press = useLeafPressScale(disabled, activeScale);

  const handlePressIn = React.useCallback(
    (event) => {
      press.onPressIn();
      onPressIn?.(event);
    },
    [onPressIn, press],
  );

  const handlePressOut = React.useCallback(
    (event) => {
      press.onPressOut();
      onPressOut?.(event);
    },
    [onPressOut, press],
  );

  return (
    <AnimatedTouchableOpacity
      activeOpacity={activeOpacity}
      disabled={disabled}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[style, { transform: [{ scale: press.scale }] }]}
      {...props}
    >
      {children}
    </AnimatedTouchableOpacity>
  );
}

export function LeafProgressBar({ progress = 0, tone = "leaf", fillTestID }) {
  const normalizedProgress = Math.max(0, Math.min(1, Number(progress) || 0));
  return (
    <View style={styles.progressRail}>
      <View
        testID={fillTestID}
        style={[
          styles.progressFill,
          {
            width: `${Math.round(normalizedProgress * 100)}%`,
            backgroundColor: tone === "warning" ? "#E97522" : leafRideColors.accent,
          },
        ]}
      />
    </View>
  );
}

export function LeafRouteProgress({
  originLabel = "Partida",
  destinationLabel = "Chegada",
  progress = 0,
  progressKey,
  arrivalLabel,
  style,
  testID,
  fieldTestIDs = {},
}) {
  const pulse = React.useRef(new Animated.Value(0)).current;
  const numericProgress = Number(progress);
  const normalizedProgress = Number.isFinite(numericProgress)
    ? Math.max(0, Math.min(0.94, numericProgress))
    : 0;
  const routeIdentity = String(progressKey || `${originLabel}|${destinationLabel}`);
  const progressAnim = React.useRef(new Animated.Value(normalizedProgress)).current;
  const previousRouteIdentityRef = React.useRef(routeIdentity);
  const maxProgressRef = React.useRef(normalizedProgress);

  React.useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          useNativeDriver: false,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 900,
          useNativeDriver: false,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  React.useEffect(() => {
    if (previousRouteIdentityRef.current !== routeIdentity) {
      previousRouteIdentityRef.current = routeIdentity;
      maxProgressRef.current = normalizedProgress;
      progressAnim.setValue(normalizedProgress);
      return undefined;
    }

    const nextProgress = Math.max(maxProgressRef.current, normalizedProgress);
    maxProgressRef.current = nextProgress;

    const animation = Animated.timing(progressAnim, {
      toValue: nextProgress,
      duration: 1200,
      easing: Easing.linear,
      useNativeDriver: false,
    });

    animation.start();
    return () => animation.stop();
  }, [normalizedProgress, progressAnim, routeIdentity]);

  const pulseScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.34],
  });
  const pulseOpacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.88, 0.34],
  });
  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0%", "100%"],
  });

  return (
    <View style={[styles.routeProgress, style]} testID={testID}>
      <View style={styles.routeEndpointRow}>
        <View style={styles.routeEndpoint}>
          <Text style={styles.routeEndpointLabel}>PARTIDA</Text>
          <Text
            style={styles.routeEndpointValue}
            numberOfLines={1}
            testID={fieldTestIDs.origin}
          >
            {originLabel}
          </Text>
        </View>
        <View style={[styles.routeEndpoint, styles.routeEndpointRight]}>
          <Text style={styles.routeEndpointLabel}>CHEGADA</Text>
          <Text
            style={styles.routeEndpointValue}
            numberOfLines={1}
            testID={fieldTestIDs.destination}
          >
            {destinationLabel}
          </Text>
        </View>
      </View>

      <View style={styles.routeLineWrap} testID={fieldTestIDs.progress}>
        <View style={styles.routeLineRail} />
        <Animated.View style={[styles.routeLineFill, { width: progressWidth }]} />
        <View style={[styles.routeEndpointDot, styles.routeStartDot]} />
        <View style={[styles.routeEndpointDot, styles.routeEndDot]} />
        <Animated.View
          style={[
            styles.routeCurrentDot,
            {
              left: progressWidth,
              opacity: pulseOpacity,
              transform: [{ translateX: -6 }, { scale: pulseScale }],
            },
          ]}
        />
      </View>

      {arrivalLabel ? (
        <Text style={styles.routeArrivalText} numberOfLines={1}>
          {arrivalLabel}
        </Text>
      ) : null}
    </View>
  );
}

export function LeafMetric({ value, label, style }) {
  return (
    <View style={[styles.metric, style]}>
      <Text style={styles.metricValue} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.metricLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

export function LeafMetricRow({ metrics = [], style }) {
  return (
    <View style={[styles.metricRow, style]}>
      {metrics.map((metric) => (
        <LeafMetric
          key={`${metric.label}-${metric.value}`}
          value={metric.value}
          label={metric.label}
        />
      ))}
    </View>
  );
}

export function LeafInfoRow({
  marker = "A",
  markerTone = "leaf",
  eyebrow,
  title,
  subtitle,
  right,
  style,
  titleLines = 1,
  subtitleLines = 1,
  showMarker = false,
}) {
  const palette = resolveTone(markerTone);
  return (
    <View style={[styles.infoRow, !showMarker && styles.infoRowWithoutMarker, style]}>
      {showMarker ? (
        <View
          style={[
            styles.infoMarker,
            {
              backgroundColor: palette.fill,
              borderColor: palette.border,
            },
          ]}
        >
          <Text style={[styles.infoMarkerText, { color: palette.text }]} numberOfLines={1}>
            {marker}
          </Text>
        </View>
      ) : null}
      <View style={[styles.infoCopy, !showMarker && styles.infoCopyWithoutMarker]}>
        {eyebrow ? (
          <Text style={styles.infoEyebrow} numberOfLines={1}>
            {eyebrow}
          </Text>
        ) : null}
        <Text style={styles.infoTitle} numberOfLines={titleLines}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.infoSubtitle} numberOfLines={subtitleLines}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right ? (
        <Text style={styles.infoRight} numberOfLines={1}>
          {right}
        </Text>
      ) : null}
    </View>
  );
}

export function LeafDriverIdentity({
  initial = "C",
  photoUri,
  name,
  rating,
  vehicle,
  plate,
  style,
  testID,
  fieldTestIDs = {},
}) {
  return (
    <View style={[styles.identityRow, style]} testID={testID}>
      <LeafAvatar initial={initial} photoUri={photoUri} testID={fieldTestIDs.avatar} />
      <View style={styles.identityCopy}>
        <Text
          style={styles.identityName}
          numberOfLines={1}
          testID={fieldTestIDs.name}
        >
          {name}
        </Text>
        <Text
          style={styles.identityMeta}
          numberOfLines={1}
          testID={fieldTestIDs.meta}
        >
          {rating}
        </Text>
      </View>
      <View style={styles.vehicleCopy}>
        <Text
          style={styles.plateText}
          numberOfLines={1}
          testID={fieldTestIDs.plate}
        >
          {plate || "--"}
        </Text>
        <Text
          style={styles.vehicleText}
          numberOfLines={1}
          testID={fieldTestIDs.vehicle}
        >
          {vehicle}
        </Text>
      </View>
    </View>
  );
}

export function LeafPersonIdentity({
  initial = "P",
  photoUri,
  name,
  meta,
  right,
  compact = false,
  style,
  testID,
  fieldTestIDs = {},
}) {
  return (
    <View style={[styles.identityRow, style]} testID={testID}>
      <LeafAvatar
        initial={initial}
        photoUri={photoUri}
        compact={compact}
        testID={fieldTestIDs.avatar}
      />
      <View style={styles.identityCopy}>
        <Text
          style={[styles.identityName, compact && styles.identityNameCompact]}
          numberOfLines={1}
          testID={fieldTestIDs.name}
        >
          {name}
        </Text>
        {meta ? (
          <Text
            style={[styles.identityMeta, compact && styles.identityMetaCompact]}
            numberOfLines={1}
            testID={fieldTestIDs.meta}
          >
            {meta}
          </Text>
        ) : null}
      </View>
      {right ? (
        <Text
          style={styles.identityRight}
          numberOfLines={1}
          testID={fieldTestIDs.right}
        >
          {right}
        </Text>
      ) : null}
    </View>
  );
}

function LeafAvatar({ initial, photoUri, compact = false, testID }) {
  const source = resolveAvatarSource(photoUri);
  return (
    <View
      style={[styles.identityAvatar, compact && styles.identityAvatarCompact]}
      testID={testID}
    >
      {source ? (
        <Image source={source} style={styles.identityAvatarImage} />
      ) : (
        <Text style={[styles.identityAvatarText, compact && styles.identityAvatarTextCompact]}>
          {initial}
        </Text>
      )}
    </View>
  );
}

export function LeafButton({
  label,
  onPress,
  tone = "ghost",
  style,
  textStyle,
  disabled = false,
  icon,
  testID,
  accessibilityLabel,
}) {
  const palette = resolveTone(tone === "primary" ? "dark" : tone);

  return (
    <LeafAnimatedPressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      activeScale={tone === "primary" ? 0.984 : 0.978}
      style={[
        styles.button,
        {
          backgroundColor: palette.fill,
          borderColor: tone === "primary" ? leafRideColors.leaf : palette.border,
        },
        disabled && styles.buttonDisabled,
        style,
      ]}
      testID={testID}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
    >
      {icon ? (
        <Ionicons
          name={icon}
          size={leafButtonMetrics.iconSize}
          color={palette.text}
          style={styles.buttonIcon}
        />
      ) : null}
      <Text style={[styles.buttonText, { color: palette.text }, textStyle]} numberOfLines={1}>
        {label}
      </Text>
    </LeafAnimatedPressable>
  );
}

export function LeafDivider({ style }) {
  return <View style={[styles.divider, style]} />;
}

export function LeafEmptyState({
  title,
  message,
  icon = "leaf-outline",
  loading = false,
  actionLabel,
  onAction,
  testID,
}) {
  const pulse = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    if (!loading) {
      pulse.stopAnimation();
      pulse.setValue(0);
      return undefined;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [loading, pulse]);

  const iconOpacity = loading
    ? pulse.interpolate({
        inputRange: [0, 1],
        outputRange: [0.72, 1],
      })
    : 1;

  return (
    <View style={styles.emptyState} testID={testID} accessibilityLabel={testID}>
      <Animated.View style={[styles.emptyIcon, { opacity: iconOpacity }]}>
        {loading ? (
          <ActivityIndicator size="small" color={leafRideColors.leaf} />
        ) : (
          <Ionicons name={icon} size={20} color={leafRideColors.leaf} />
        )}
      </Animated.View>
      <Text style={styles.emptyTitle} numberOfLines={2}>
        {title}
      </Text>
      {message ? (
        <Text style={styles.emptyMessage} numberOfLines={4}>
          {message}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <LeafButton
          label={actionLabel}
          tone="primary"
          onPress={onAction}
          style={styles.emptyAction}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stateHeader: {
    position: "absolute",
    left: 28,
    right: 28,
    zIndex: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    minHeight: 62,
    borderRadius: 31,
    borderWidth: 1,
    borderColor: "rgba(26,51,14,0.10)",
    backgroundColor: Platform.OS === "android" ? "#FFFFFF" : "rgba(255,255,255,0.985)",
    paddingHorizontal: 16,
    paddingVertical: 10,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.08,
    shadowRadius: 18,
    elevation: 8,
  },
  stateHeaderCopy: {
    flex: 1,
    minWidth: 0,
  },
  stateHeaderTitle: {
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 15,
    lineHeight: 19,
  },
  stateHeaderSubtitle: {
    marginTop: 2,
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 11,
    lineHeight: 14,
  },
  headerPill: {
    minWidth: 58,
    height: 28,
    paddingHorizontal: 10,
  },
  sheet: {
    backgroundColor: leafRideColors.sheetTranslucent,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: leafRideColors.line,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 20,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: -10 },
    shadowOpacity: 0.07,
    shadowRadius: 24,
    elevation: Platform.OS === "android" ? 1 : 10,
  },
  sheetScroll: {
    flexGrow: 0,
  },
  sheetScrollContent: {
    flexGrow: 0,
  },
  pill: {
    height: 26,
    minWidth: 48,
    borderRadius: 13,
    borderWidth: 1,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  pillText: {
    fontFamily: fonts.SemiBold,
    fontSize: 10.5,
    lineHeight: 14,
  },
  progressRail: {
    height: 4,
    borderRadius: 2,
    overflow: "hidden",
    backgroundColor: leafRideColors.line,
  },
  progressFill: {
    height: "100%",
    borderRadius: 2,
  },
  routeProgress: {
    gap: 9,
  },
  routeEndpointRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 18,
  },
  routeEndpoint: {
    flex: 1,
    minWidth: 0,
  },
  routeEndpointRight: {
    alignItems: "flex-end",
  },
  routeEndpointLabel: {
    color: leafRideColors.muted,
    fontFamily: fonts.SemiBold,
    fontSize: 10,
    lineHeight: 13,
  },
  routeEndpointValue: {
    marginTop: 2,
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 12.5,
    lineHeight: 17,
  },
  routeLineWrap: {
    height: 18,
    justifyContent: "center",
  },
  routeLineRail: {
    height: 4,
    borderRadius: 2,
    backgroundColor: leafRideColors.line,
  },
  routeLineFill: {
    position: "absolute",
    left: 0,
    height: 4,
    borderRadius: 2,
    backgroundColor: leafRideColors.text,
  },
  routeEndpointDot: {
    position: "absolute",
    top: 5,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: leafRideColors.sheet,
    borderWidth: 2,
    borderColor: leafRideColors.text,
  },
  routeStartDot: {
    left: 0,
  },
  routeEndDot: {
    right: 0,
    borderColor: leafRideColors.accent,
  },
  routeCurrentDot: {
    position: "absolute",
    top: 3,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: leafRideColors.accent,
  },
  routeArrivalText: {
    color: leafRideColors.secondary,
    fontFamily: fonts.SemiBold,
    fontSize: 12,
    lineHeight: 16,
    textAlign: "center",
  },
  metricRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  metric: {
    flex: 1,
    minWidth: 0,
  },
  metricValue: {
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 18,
    lineHeight: 23,
  },
  metricLabel: {
    marginTop: 1,
    color: leafRideColors.muted,
    fontFamily: fonts.Regular,
    fontSize: 10,
    lineHeight: 14,
  },
  infoRow: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
  },
  infoRowWithoutMarker: {
    minHeight: 38,
  },
  infoMarker: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  infoMarkerText: {
    fontFamily: fonts.SemiBold,
    fontSize: 13,
    lineHeight: 17,
  },
  infoCopy: {
    flex: 1,
    minWidth: 0,
    marginLeft: 12,
  },
  infoCopyWithoutMarker: {
    marginLeft: 0,
  },
  infoEyebrow: {
    marginBottom: 2,
    color: leafRideColors.muted,
    fontFamily: fonts.SemiBold,
    fontSize: 10,
    lineHeight: 13,
    textTransform: "uppercase",
  },
  infoTitle: {
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 13,
    lineHeight: 17,
  },
  infoSubtitle: {
    marginTop: 1,
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 11,
    lineHeight: 15,
  },
  infoRight: {
    marginLeft: 8,
    width: 76,
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 12.5,
    lineHeight: 17,
    textAlign: "right",
  },
  identityRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  identityAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#EFEAE2",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#E5DCD2",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  identityAvatarImage: {
    width: "100%",
    height: "100%",
  },
  identityAvatarCompact: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  identityAvatarText: {
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 20,
    lineHeight: 27,
  },
  identityAvatarTextCompact: {
    fontSize: 15,
    lineHeight: 20,
  },
  identityCopy: {
    flex: 1,
    minWidth: 0,
    marginLeft: 14,
  },
  identityName: {
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 15,
    lineHeight: 20,
  },
  identityMeta: {
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 11,
    lineHeight: 15,
  },
  identityNameCompact: {
    fontSize: 13.5,
    lineHeight: 18,
  },
  identityMetaCompact: {
    fontSize: 10.5,
    lineHeight: 14,
  },
  vehicleCopy: {
    width: 116,
    alignItems: "flex-end",
  },
  plateText: {
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 15,
    lineHeight: 20,
  },
  vehicleText: {
    color: leafRideColors.secondary,
    fontFamily: fonts.Medium,
    fontSize: 11,
    lineHeight: 15,
  },
  identityRight: {
    maxWidth: 104,
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 13,
    lineHeight: 18,
    textAlign: "right",
  },
  button: {
    minHeight: leafButtonMetrics.height,
    borderRadius: leafButtonMetrics.radius,
    borderWidth: 1,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    minWidth: 0,
  },
  buttonDisabled: {
    opacity: 0.56,
  },
  buttonIcon: {
    marginRight: leafButtonMetrics.iconGap,
    flexShrink: 0,
  },
  buttonText: {
    fontFamily: fonts.SemiBold,
    fontSize: 13,
    lineHeight: 17,
    flexShrink: 1,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: leafRideColors.line,
  },
  emptyState: {
    minHeight: 148,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: leafRideColors.line,
    backgroundColor: leafRideColors.sheet,
    paddingHorizontal: 18,
    paddingVertical: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: leafRideColors.leafLight,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  emptyTitle: {
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 15,
    lineHeight: 20,
    textAlign: "center",
  },
  emptyMessage: {
    marginTop: 6,
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 12,
    lineHeight: 17,
    textAlign: "center",
  },
  emptyAction: {
    marginTop: 14,
    minWidth: 144,
  },
});
