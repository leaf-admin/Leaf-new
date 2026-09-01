import React from 'react';
import {
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fonts } from '../../theme/runtimeTokens';
import robotaxiPrototypeTokens from '../design-system/robotaxiPrototypeTokens';

const TEXT_SCALE_CAP = 1.35;
const { color } = robotaxiPrototypeTokens;

export const robotaxiLifecycleMetrics = Object.freeze({
  cardHorizontalMargin: 24,
  cardBottomGap: 16,
  cardRadius: 28,
  cardPaddingHorizontal: 18,
  cardPaddingTop: 10,
  cardPaddingBottom: 18,
  buttonHeight: 48,
  buttonRadius: 24,
  buttonIconSize: 16,
  buttonIconGap: 6,
});

const buttonTones = Object.freeze({
  primary: {
    backgroundColor: color.accent.primary,
    borderColor: color.border.strong,
    foregroundColor: color.accent.contrast,
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
    backgroundColor: '#FFF1F2',
    borderColor: '#F3CDD4',
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
  scrollEnabled = false,
  scrollStyle,
  contentContainerStyle,
  showsVerticalScrollIndicator = false,
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
        numberOfLines={1}
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
      <Text maxFontSizeMultiplier={TEXT_SCALE_CAP} style={styles.metricLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text
        style={[
          styles.metricValue,
          tone === 'accent' && styles.metricValueAccent,
          tone === 'danger' && styles.metricValueDanger,
        ]}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

export function RobotaxiLifecycleSummary({
  eyebrow,
  title,
  subtitle,
  value,
  valueLabel,
  style,
  titleTestID,
  subtitleTestID,
  valueTestID,
}) {
  return (
    <View style={[styles.summary, style]}>
      <View style={styles.summaryCopy}>
        {eyebrow ? <Text maxFontSizeMultiplier={TEXT_SCALE_CAP} style={styles.eyebrow}>{eyebrow}</Text> : null}
        <Text maxFontSizeMultiplier={TEXT_SCALE_CAP} style={styles.summaryTitle} numberOfLines={1} testID={titleTestID}>
          {title}
        </Text>
        {subtitle ? (
          <Text maxFontSizeMultiplier={TEXT_SCALE_CAP} style={styles.summarySubtitle} numberOfLines={1} testID={subtitleTestID}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? (
        <View style={styles.summaryValueWrap}>
          <Text maxFontSizeMultiplier={TEXT_SCALE_CAP} style={styles.summaryValue} numberOfLines={1} testID={valueTestID}>
            {value}
          </Text>
          {valueLabel ? <Text maxFontSizeMultiplier={TEXT_SCALE_CAP} style={styles.summaryValueLabel}>{valueLabel}</Text> : null}
        </View>
      ) : null}
    </View>
  );
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
          <Text maxFontSizeMultiplier={TEXT_SCALE_CAP} style={styles.identityMeta} numberOfLines={1} testID={fieldTestIDs.meta}>
            {meta}
          </Text>
        ) : null}
      </View>
      {trailing ? (
        <Text maxFontSizeMultiplier={TEXT_SCALE_CAP} style={styles.identityTrailing} numberOfLines={1} testID={fieldTestIDs.trailing}>
          {trailing}
        </Text>
      ) : null}
    </View>
  );
}

export function RobotaxiLifecycleSection({ title, children, style }) {
  return (
    <View style={[styles.section, style]}>
      {title ? <Text maxFontSizeMultiplier={TEXT_SCALE_CAP} style={styles.sectionTitle}>{title}</Text> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: robotaxiLifecycleMetrics.cardRadius,
    borderWidth: 1,
    borderColor: color.border.subtle,
    backgroundColor: color.bg.panelSolid,
    paddingHorizontal: robotaxiLifecycleMetrics.cardPaddingHorizontal,
    paddingTop: robotaxiLifecycleMetrics.cardPaddingTop,
    paddingBottom: robotaxiLifecycleMetrics.cardPaddingBottom,
    shadowColor: color.shadow.base,
    shadowOffset: { width: 0, height: -10 },
    shadowOpacity: 0.07,
    shadowRadius: 24,
    elevation: 10,
  },
  button: {
    minHeight: robotaxiLifecycleMetrics.buttonHeight,
    borderRadius: robotaxiLifecycleMetrics.buttonRadius,
    borderWidth: 1,
    paddingHorizontal: 18,
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
    fontFamily: fonts.SemiBold,
    fontSize: 13,
    lineHeight: 17,
    flexShrink: 1,
  },
  metric: {
    flex: 1,
    minWidth: 0,
  },
  metricLabel: {
    color: color.text.muted,
    fontFamily: fonts.Regular,
    fontSize: 10.5,
    lineHeight: 14,
  },
  metricValue: {
    marginTop: 2,
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: 12,
    lineHeight: 16,
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
    color: color.text.muted,
    fontFamily: fonts.SemiBold,
    fontSize: 11,
    lineHeight: 15,
  },
  summaryTitle: {
    marginTop: 2,
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: 17,
    lineHeight: 22,
  },
  summarySubtitle: {
    marginTop: 2,
    color: color.text.secondary,
    fontFamily: fonts.Regular,
    fontSize: 11,
    lineHeight: 15,
  },
  summaryValueWrap: {
    alignItems: 'flex-end',
  },
  summaryValue: {
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: 17,
    lineHeight: 22,
  },
  summaryValueLabel: {
    color: color.text.muted,
    fontFamily: fonts.Regular,
    fontSize: 10,
    lineHeight: 13,
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
    backgroundColor: color.bg.app,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarInitial: {
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: 15.5,
    lineHeight: 20,
  },
  identityCopy: {
    flex: 1,
    minWidth: 0,
  },
  identityName: {
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: 15.5,
    lineHeight: 20,
  },
  identityMeta: {
    color: color.text.secondary,
    fontFamily: fonts.Regular,
    fontSize: 11,
    lineHeight: 15,
  },
  identityTrailing: {
    maxWidth: 116,
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: 12,
    lineHeight: 16,
    textAlign: 'right',
  },
  section: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: color.border.subtle,
  },
  sectionTitle: {
    marginBottom: 10,
    color: color.text.muted,
    fontFamily: fonts.SemiBold,
    fontSize: 10,
    lineHeight: 13,
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
