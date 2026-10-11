import leafTypography from './LeafTypography';
import React from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import robotaxiPrototypeTokens from '../design-system/robotaxiPrototypeTokens';

const TEXT_SCALE_CAP = 1.35;
const { color } = robotaxiPrototypeTokens;

// Narrow phones (e.g. 360 dp Android) get a tighter scale (design-system).
import { compact, leafType } from '../design-system/leafTypeScale';

export { compact };

export const robotaxiLifecycleMetrics = Object.freeze({
  // Floating cards (not edge-to-edge sheets): inset from the sides and lifted
  // above the home indicator, so the map reads around them.
  cardHorizontalMargin: 12,
  cardBottomGap: 12,
  cardRadius: 28,
  cardPaddingHorizontal: compact(24, 20),
  cardPaddingTop: 10,
  cardPaddingBottom: compact(18, 14),
  buttonHeight: compact(54, 50),
  buttonRadius: 12,
  buttonIconSize: 16,
  buttonIconGap: 6,
});

const buttonTones = Object.freeze({
  primary: {
    backgroundColor: robotaxiPrototypeTokens.action.primary,
    borderColor: robotaxiPrototypeTokens.action.primary,
    foregroundColor: robotaxiPrototypeTokens.action.contrast,
  },
  secondary: {
    backgroundColor: color.surface.primary,
    borderColor: color.border.strong,
    foregroundColor: color.text.primary,
  },
  safety: {
    backgroundColor: color.surface.primary,
    borderColor: color.border.strong,
    foregroundColor: color.feedback.warning,
  },
  danger: {
    backgroundColor: color.feedback.dangerSoft,
    borderColor: color.feedback.dangerBorder,
    foregroundColor: color.feedback.danger,
  },
});

function resolveButtonTone(tone) {
  return buttonTones[tone] || buttonTones.secondary;
}

export function RobotaxiLifecycleCard({
  children,
  onLayout,
  style,
  testID,
  accessibilityLabel,
  showHandle = true,
  scrollEnabled = false,
  scrollStyle,
  contentContainerStyle,
  showsVerticalScrollIndicator = false,
  onHandlePress,
  onHandleSwipe,
  handleTestID,
}) {
  const content = scrollEnabled ? (
    <ScrollView
      bounces={false}
      nestedScrollEnabled
      showsVerticalScrollIndicator={showsVerticalScrollIndicator}
      style={scrollStyle}
      contentContainerStyle={contentContainerStyle}
    >
      {children}
    </ScrollView>
  ) : children;

  return (
    <View
      onLayout={onLayout}
      style={[styles.card, style]}
      testID={testID}
      accessibilityLabel={accessibilityLabel}
    >
      {showHandle && (onHandlePress || onHandleSwipe) ? (
        // Interactive handle: tap or swipe to change the card height.
        <GestureDetector
          gesture={Gesture.Pan()
            .runOnJS(true)
            .activeOffsetY([-12, 12])
            .onEnd((event) => {
              if (event.translationY < -36 || event.velocityY < -700) onHandleSwipe?.(1);
              else if (event.translationY > 36 || event.velocityY > 700) onHandleSwipe?.(-1);
            })}
        >
          <Pressable
            onPress={onHandlePress}
            style={styles.handleArea}
            accessibilityRole="adjustable"
            accessibilityLabel="Altura do cartão"
            accessibilityHint="Toque para alternar entre resumo, padrão e detalhes"
            testID={handleTestID}
          >
            <View style={styles.handle} />
          </Pressable>
        </GestureDetector>
      ) : showHandle ? <View style={styles.handleArea} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><View style={styles.handle} /></View> : null}
      {content}
    </View>
  );
}

export function RobotaxiLifecycleButton({
  label,
  icon,
  tone = 'secondary',
  disabled = false,
  onPress,
  style,
  textStyle,
  testID,
  accessibilityLabel,
}) {
  const palette = resolveButtonTone(tone);

  return (
    <TouchableOpacity
      activeOpacity={disabled ? 1 : 0.86}
      disabled={disabled}
      onPress={disabled ? undefined : onPress}
      accessible
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityLabel={accessibilityLabel || label}
      testID={testID}
      style={[
        styles.button,
        {
          backgroundColor: palette.backgroundColor,
          borderColor: palette.borderColor,
        },
        disabled && styles.buttonDisabled,
        style,
      ]}
    >
      {icon ? (
        <Ionicons
          name={icon}
          size={robotaxiLifecycleMetrics.buttonIconSize}
          color={palette.foregroundColor}
        />
      ) : null}
      <Text
        numberOfLines={2}
        style={[styles.buttonText, { color: palette.foregroundColor }, textStyle]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

export function RobotaxiLifecycleDisclosure({
  expanded,
  onPress,
  label = 'Mais opções',
  expandedLabel = 'Ocultar opções',
  style,
  testID,
  accessibilityLabel,
}) {
  return (
    <RobotaxiLifecycleButton
      label={expanded ? expandedLabel : label}
      icon={expanded ? 'chevron-up-outline' : 'ellipsis-horizontal'}
      tone="secondary"
      onPress={onPress}
      style={style}
      testID={testID}
      accessibilityLabel={accessibilityLabel || (expanded ? expandedLabel : label)}
    />
  );
}

export function RobotaxiLifecycleMetric({ label, value, tone = 'default', style, testID }) {
  return (
    <View style={[styles.metric, style]} testID={testID}>
      <Text
        style={[
          styles.metricValue,
          tone === 'accent' && styles.metricValueAccent,
          tone === 'danger' && styles.metricValueDanger,
        ]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.6}
      >
        {value}
      </Text>
      <Text maxFontSizeMultiplier={TEXT_SCALE_CAP} style={styles.metricLabel} numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

// Section labels read as sentence case ("Motorista a caminho"), never shouted.
function toSentenceCase(value) {
  const text = String(value || '').trim();
  if (!text || text !== text.toUpperCase()) return text;
  // Plain toLowerCase: Hermes on Android ignores locale-tagged variants.
  const lower = text.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export function RobotaxiLifecycleSummary({
  eyebrow,
  hero = false,
  title,
  subtitle,
  value,
  valueLabel,
  style,
  titleTestID,
  subtitleTestID,
  valueTestID,
  valueLabelTestID,
}) {
  return (
    <View style={[styles.summary, style]}>
      <View style={styles.summaryCopy}>
        {eyebrow ? <Text maxFontSizeMultiplier={TEXT_SCALE_CAP} style={styles.eyebrow}>{toSentenceCase(eyebrow)}</Text> : null}
        {/* Hero values ("Chegada às 10:36", "Chega em 4 min") stay on one line and
            shrink to fit; plain titles (addresses) may wrap to two. */}
        <Text
          maxFontSizeMultiplier={TEXT_SCALE_CAP}
          style={[styles.summaryTitle, hero && styles.summaryHero]}
          numberOfLines={hero ? 1 : 2}
          adjustsFontSizeToFit={hero}
          minimumFontScale={0.6}
          testID={titleTestID}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text maxFontSizeMultiplier={TEXT_SCALE_CAP} style={styles.summarySubtitle} numberOfLines={2} testID={subtitleTestID}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? (
        <View style={styles.summaryValueWrap}>
          <Text maxFontSizeMultiplier={TEXT_SCALE_CAP} style={styles.summaryValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} testID={valueTestID}>
            {value}
          </Text>
          {valueLabel ? <Text maxFontSizeMultiplier={TEXT_SCALE_CAP} style={styles.summaryValueLabel} testID={valueLabelTestID}>{valueLabel}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

// Only a real plate gets the plate badge; placeholders ("Placa não informada")
// stay plain text so they never look like a plate to check.
function looksLikePlate(value) {
  return typeof value === 'string' && /^[A-Z0-9-]{5,8}$/i.test(value.trim());
}

export function RobotaxiLifecycleIdentity({
  name,
  meta,
  trailing,
  photoUri,
  initial,
  style,
  testID,
  fieldTestIDs = {},
}) {
  return (
    <View style={[styles.identity, style]} testID={testID}>
      <View style={styles.avatar} testID={fieldTestIDs.avatar}>
        {photoUri ? (
          <Image source={{ uri: photoUri }} style={styles.avatarImage} />
        ) : (
          <Text maxFontSizeMultiplier={TEXT_SCALE_CAP} style={styles.avatarInitial}>{initial}</Text>
        )}
      </View>
      <View style={styles.identityCopy}>
        <Text maxFontSizeMultiplier={TEXT_SCALE_CAP} style={styles.identityName} numberOfLines={1} testID={fieldTestIDs.name}>
          {name}
        </Text>
        {meta ? (
          <Text maxFontSizeMultiplier={TEXT_SCALE_CAP} style={styles.identityMeta} numberOfLines={2} testID={fieldTestIDs.meta}>
            {meta}
          </Text>
        ) : null}
      </View>
      {trailing ? (
        <Text maxFontSizeMultiplier={TEXT_SCALE_CAP} style={looksLikePlate(trailing) ? styles.identityTrailing : styles.identityTrailingPlain} numberOfLines={1} testID={fieldTestIDs.trailing}>
          {trailing}
        </Text>
      ) : null}
    </View>
  );
}

export function RobotaxiLifecycleSection({ title, children, style }) {
  return (
    <View style={[styles.section, style]}>
      {title ? <Text maxFontSizeMultiplier={TEXT_SCALE_CAP} style={styles.sectionTitle}>{toSentenceCase(title)}</Text> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  handleArea: { height: 22, alignItems: 'center', justifyContent: 'flex-start' },
  handle: { width: 32, height: 3, borderRadius: 2, backgroundColor: '#E5E5E5' },
  card: {
    borderRadius: robotaxiLifecycleMetrics.cardRadius,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.border.subtle,
    backgroundColor: color.bg.panelSolid,
    paddingHorizontal: robotaxiLifecycleMetrics.cardPaddingHorizontal,
    paddingTop: robotaxiLifecycleMetrics.cardPaddingTop,
    paddingBottom: robotaxiLifecycleMetrics.cardPaddingBottom,
    shadowColor: color.shadow.base,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.12,
    shadowRadius: 28,
    elevation: 12,
  },
  button: {
    minHeight: robotaxiLifecycleMetrics.buttonHeight,
    borderRadius: robotaxiLifecycleMetrics.buttonRadius,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: robotaxiLifecycleMetrics.buttonIconGap,
    minWidth: 0,
  },
  buttonDisabled: {
    opacity: 0.56,
  },
  buttonText: {
    ...leafTypography.semiBold,
    fontSize: compact(16, 15),
    lineHeight: compact(22, 20),
    flexShrink: 1,
    textAlign: 'center',
  },
  metric: {
    flex: 1,
    minWidth: 0,
  },
  metricLabel: {
    marginTop: 4,
    color: color.text.muted,
    ...leafTypography.regular,
    fontSize: 12,
    lineHeight: 17,
  },
  metricValue: {
    color: color.text.primary,
    ...leafTypography.semiBold,
    fontSize: compact(20, 18),
    lineHeight: compact(25, 23),
    fontVariant: ['tabular-nums'],
  },
  metricValueAccent: {
    color: color.accent.primary,
  },
  metricValueDanger: {
    color: color.feedback.danger,
  },
  summary: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
  },
  summaryCopy: {
    flex: 1,
    minWidth: 0,
  },
  eyebrow: {
    ...leafType.caption,
  },
  summaryHero: {
    ...leafType.display,
  },
  summaryTitle: {
    marginTop: 2,
    color: color.text.primary,
    ...leafTypography.semiBold,
    fontSize: compact(24, 20),
    lineHeight: compact(29, 25),
  },
  summarySubtitle: {
    marginTop: 2,
    color: color.text.secondary,
    ...leafTypography.regular,
    fontSize: 14,
    lineHeight: 20,
  },
  summaryValueWrap: {
    alignItems: 'flex-end',
  },
  summaryValue: {
    color: color.text.primary,
    ...leafTypography.semiBold,
    fontSize: compact(20, 18),
    lineHeight: compact(25, 23),
  },
  summaryValueLabel: {
    color: color.text.muted,
    ...leafTypography.regular,
    fontSize: 12,
    lineHeight: 17,
  },
  identity: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    overflow: 'hidden',
    backgroundColor: '#EEF0EC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarInitial: {
    color: color.text.primary,
    ...leafTypography.semiBold,
    fontSize: 16,
    lineHeight: 22,
  },
  identityCopy: {
    flex: 1,
    minWidth: 0,
  },
  identityName: {
    color: color.text.primary,
    ...leafTypography.semiBold,
    fontSize: 16,
    lineHeight: 22,
  },
  identityMeta: {
    color: color.text.secondary,
    ...leafTypography.regular,
    fontSize: 14,
    lineHeight: 20,
  },
  identityTrailingPlain: {
    ...leafType.caption,
    maxWidth: 110,
    textAlign: 'right',
  },
  // Vehicle plate as a badge, like the physical plate the rider looks for.
  identityTrailing: {
    ...leafType.plate,
    fontSize: compact(16, 15),
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderWidth: 1.5,
    borderColor: color.text.primary,
    borderRadius: 9,
    overflow: 'hidden',
    textAlign: 'center',
  },
  section: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.border.subtle,
  },
  sectionTitle: {
    marginBottom: 10,
    ...leafType.caption,
    fontSize: 14,
  },
});

export default {
  RobotaxiLifecycleButton,
  RobotaxiLifecycleCard,
  RobotaxiLifecycleDisclosure,
  RobotaxiLifecycleIdentity,
  RobotaxiLifecycleMetric,
  RobotaxiLifecycleSection,
  RobotaxiLifecycleSummary,
  robotaxiLifecycleMetrics,
};
