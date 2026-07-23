import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { Easing, FadeInUp } from 'react-native-reanimated';
import { fonts } from '../../theme/runtimeTokens';
import robotaxiPrototypeTokens from '../design-system/robotaxiPrototypeTokens';

const { color, typography, elevation, motion } = robotaxiPrototypeTokens;
const contentEnterEasing = Easing.bezier(...motion.bezier.smoothOut);
const LEAF_CARD_SURFACE = 'rgba(255,255,255,0.96)';
const LEAF_CARD_BORDER = '#ECE5DC';
const LEAF_BG = '#F8F6F1';
const LEAF_TEXT = '#171412';
const LEAF_MUTED = '#827B73';
const LEAF_SECONDARY = '#756F68';
const TEXT_SCALE_CAP = 1.35;

function isLoadingValue(value) {
  return value === null || value === undefined || String(value).trim() === '';
}

function PrototypeMenuSkeletonLine({ width = 48 }) {
  return (
    <View
      style={[
        styles.skeletonLine,
        {
          width,
        },
      ]}
      accessibilityLabel="Carregando"
    />
  );
}

export function PrototypeMenuSurface({
  eyebrow,
  title,
  subtitle,
  badgeLabel,
  headerAccessory,
  footer,
  onLayout,
  children,
  bodyStyle,
  fullScreen = false,
  style,
}) {
  const { width } = useWindowDimensions();
  const panelWidth = Math.min(Math.max(width * 0.84, 292), 340);

  return (
    <View
      onLayout={onLayout}
      style={[
        styles.surface,
        fullScreen ? styles.surfaceFullScreen : { width: panelWidth },
        style,
      ]}
    >
      <View style={styles.headerRow}>
        <View style={styles.headerCopyWrap}>
          {eyebrow && !fullScreen ? <Text maxFontSizeMultiplier={TEXT_SCALE_CAP} style={styles.eyebrow}>{eyebrow}</Text> : null}
          {eyebrow && fullScreen ? <Text maxFontSizeMultiplier={TEXT_SCALE_CAP} style={styles.hiddenText}>{eyebrow}</Text> : null}
          <Text maxFontSizeMultiplier={TEXT_SCALE_CAP} style={styles.title}>{title}</Text>
          {subtitle ? <Text maxFontSizeMultiplier={TEXT_SCALE_CAP} style={styles.subtitle}>{subtitle}</Text> : null}
        </View>

        {headerAccessory ? (
          <View style={styles.headerAccessoryWrap}>{headerAccessory}</View>
        ) : badgeLabel ? (
          <View style={styles.badgePill}>
            <Text maxFontSizeMultiplier={TEXT_SCALE_CAP} style={styles.badgePillText}>{badgeLabel}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.headerDivider} />
      <Animated.View
        entering={FadeInUp.duration(motion.timing.quick)
          .easing(contentEnterEasing)
          .withInitialValues({ opacity: 0.98, transform: [{ translateY: 5 }] })}
        style={[styles.body, fullScreen && styles.bodyFullScreen, bodyStyle]}
      >
        {children}
      </Animated.View>

      {footer ? (
        <>
          <View style={styles.footerDivider} />
          <View style={styles.footer}>{footer}</View>
        </>
      ) : null}
    </View>
  );
}

export function PrototypeMenuSection({ title, children, style }) {
  return (
    <View style={[styles.sectionBlock, style]}>
      <Text maxFontSizeMultiplier={TEXT_SCALE_CAP} style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionDivider} />
      {children}
    </View>
  );
}

export function PrototypeMenuRow({
  icon,
  title,
  subtitle,
  onPress,
  badge,
  badgeTone = 'neutral',
  trailing,
  active = false,
  compact = false,
  last = false,
  testID,
  accessibilityLabel,
  accessibilityHint,
  disabled = false,
}) {
  const isInteractiveRow = Boolean(onPress) || disabled;
  const RowComponent = isInteractiveRow ? TouchableOpacity : View;
  const iconName = typeof icon === 'string' ? icon : null;

  return (
    <RowComponent
      style={[
        styles.row,
        compact && styles.rowCompact,
        active && styles.rowActive,
        disabled && styles.rowDisabled,
        last && styles.rowLast,
      ]}
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      activeOpacity={!disabled && onPress ? 0.78 : 1}
      testID={testID}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityRole={isInteractiveRow ? 'button' : undefined}
      accessibilityState={isInteractiveRow ? { disabled } : undefined}
    >
      <View style={[styles.rowIconSlot, compact && styles.rowIconSlotCompact]}>
        {iconName ? (
          <Ionicons
            name={iconName}
            size={compact ? 16 : 17}
            color={disabled ? color.text.muted : active ? color.accent.strong : '#4F5C54'}
          />
        ) : null}
      </View>

      <View style={styles.rowCopyWrap}>
        <Text
          maxFontSizeMultiplier={TEXT_SCALE_CAP}
          style={[styles.rowTitle, active && styles.rowTitleActive, disabled && styles.rowTitleDisabled]}
        >
          {title}
        </Text>
        {subtitle ? <Text maxFontSizeMultiplier={TEXT_SCALE_CAP} style={styles.rowSubtitle}>{subtitle}</Text> : null}
      </View>

      {badge ? (
        <View
          style={[
            styles.inlineBadge,
            badgeTone === 'success' && styles.inlineBadgeSuccess,
            badgeTone === 'warning' && styles.inlineBadgeWarning,
            badgeTone === 'danger' && styles.inlineBadgeDanger,
          ]}
        >
          <Text
            maxFontSizeMultiplier={TEXT_SCALE_CAP}
            style={[
              styles.inlineBadgeText,
              badgeTone === 'success' && styles.inlineBadgeTextSuccess,
              badgeTone === 'warning' && styles.inlineBadgeTextWarning,
              badgeTone === 'danger' && styles.inlineBadgeTextDanger,
            ]}
          >
            {badge}
          </Text>
        </View>
      ) : null}
      {trailing === null ? null : trailing ? trailing : <Ionicons name="chevron-forward" size={15} color={color.text.muted} />}
    </RowComponent>
  );
}

export function PrototypeMenuInfoRow({ label, value, last = false, loading = false }) {
  const showLoading = loading || isLoadingValue(value);

  return (
    <View style={[styles.infoRow, last && styles.infoRowLast]}>
      <Text maxFontSizeMultiplier={TEXT_SCALE_CAP} style={styles.infoLabel}>{label}</Text>
      {showLoading ? (
        <PrototypeMenuSkeletonLine width={72} />
      ) : (
        <Text maxFontSizeMultiplier={TEXT_SCALE_CAP} style={styles.infoValue}>{value}</Text>
      )}
    </View>
  );
}

export function PrototypeMenuStatRow({ items }) {
  return (
    <View style={styles.statsRow}>
      {items.map((item, index) => (
        <React.Fragment key={item.key || item.label}>
          <View style={styles.statBlock}>
            <Text maxFontSizeMultiplier={TEXT_SCALE_CAP} style={styles.statLabel} numberOfLines={1}>{item.label}</Text>
            {item.loading || isLoadingValue(item.value) ? (
              <PrototypeMenuSkeletonLine width={item.skeletonWidth || 44} />
            ) : (
              <Text maxFontSizeMultiplier={TEXT_SCALE_CAP} style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.78}>
                {item.value}
              </Text>
            )}
          </View>
          {index < items.length - 1 ? <View style={styles.statDivider} /> : null}
        </React.Fragment>
      ))}
    </View>
  );
}

export function PrototypeMenuCloseButton({
  onPress,
  accessibilityLabel = 'Fechar',
  testID,
}) {
  return (
    <TouchableOpacity
      style={styles.closeButton}
      activeOpacity={0.78}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
    >
      <Ionicons name="close" size={18} color={color.text.primary} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  surface: {
    alignSelf: 'flex-start',
    borderRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    backgroundColor: LEAF_CARD_SURFACE,
    borderWidth: 1,
    borderColor: LEAF_CARD_BORDER,
    shadowColor: color.shadow.base,
    shadowOffset: elevation.soft.shadowOffset,
    shadowOpacity: 0.08,
    shadowRadius: 22,
    elevation: 3,
  },
  surfaceFullScreen: {
    alignSelf: 'stretch',
    flex: 1,
    width: '100%',
    borderRadius: 0,
    paddingHorizontal: 24,
    paddingTop: 42,
    paddingBottom: 18,
    backgroundColor: LEAF_BG,
    borderWidth: 0,
    shadowOpacity: 0,
    elevation: 0,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  headerCopyWrap: {
    flex: 1,
    paddingRight: 10,
  },
  headerAccessoryWrap: {
    paddingTop: 2,
  },
  eyebrow: {
    marginBottom: 2,
    color: LEAF_MUTED,
    fontFamily: fonts.Medium,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  title: {
    color: LEAF_TEXT,
    fontFamily: fonts.SemiBold,
    fontSize: 20,
    lineHeight: 26,
  },
  subtitle: {
    marginTop: 5,
    color: LEAF_SECONDARY,
    fontFamily: fonts.Regular,
    fontSize: 12.5,
    lineHeight: 17,
  },
  badgePill: {
    minHeight: 28,
    borderRadius: 999,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: LEAF_BG,
    borderWidth: 1,
    borderColor: LEAF_CARD_BORDER,
  },
  badgePillText: {
    color: color.text.secondary,
    fontFamily: fonts.Medium,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight,
  },
  headerDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: LEAF_CARD_BORDER,
    marginTop: 20,
  },
  body: {
    paddingTop: 14,
  },
  bodyFullScreen: {
    flex: 1,
  },
  footerDivider: {
    height: 1,
    backgroundColor: LEAF_CARD_BORDER,
    marginTop: 12,
  },
  footer: {
    paddingTop: 12,
  },
  sectionBlock: {
    marginBottom: 14,
  },
  sectionTitle: {
    color: LEAF_MUTED,
    fontFamily: fonts.Medium,
    fontSize: 11,
    lineHeight: 15,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 7,
  },
  sectionDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: LEAF_CARD_BORDER,
    marginBottom: 2,
  },
  row: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: LEAF_CARD_BORDER,
  },
  rowCompact: {
    minHeight: 54,
    paddingVertical: 7,
  },
  rowActive: {
    backgroundColor: 'transparent',
  },
  rowDisabled: {
    opacity: 0.64,
  },
  rowLast: {
    borderBottomWidth: 0,
    paddingBottom: 4,
  },
  rowIconSlot: {
    width: 25,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  rowIconSlotCompact: {
    width: 24,
  },
  rowCopyWrap: {
    flex: 1,
    paddingRight: 8,
  },
  rowTitle: {
    color: LEAF_TEXT,
    fontFamily: fonts.Medium,
    fontSize: 13,
    lineHeight: 17,
  },
  rowTitleActive: {
    color: color.accent.strong,
  },
  rowTitleDisabled: {
    color: color.text.secondary,
  },
  rowSubtitle: {
    marginTop: 3,
    color: LEAF_SECONDARY,
    fontFamily: fonts.Regular,
    fontSize: 10,
    lineHeight: 13,
  },
  inlineBadge: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.surface.tertiary,
    borderWidth: 1,
    borderColor: color.border.subtle,
    marginRight: 8,
  },
  inlineBadgeText: {
    color: color.text.secondary,
    fontFamily: fonts.SemiBold,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight,
  },
  inlineBadgeSuccess: {
    backgroundColor: color.surface.activeStrong,
    borderColor: color.accent.soft,
  },
  inlineBadgeWarning: {
    backgroundColor: '#F7F2E8',
    borderColor: '#E5D9BD',
  },
  inlineBadgeDanger: {
    backgroundColor: '#FFF1F2',
    borderColor: '#F2C8CE',
  },
  inlineBadgeTextSuccess: {
    color: color.accent.primary,
  },
  inlineBadgeTextWarning: {
    color: color.feedback.warning,
  },
  inlineBadgeTextDanger: {
    color: color.feedback.danger,
  },
  infoRow: {
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: LEAF_CARD_BORDER,
  },
  infoRowLast: {
    borderBottomWidth: 0,
    paddingBottom: 4,
  },
  infoLabel: {
    color: color.text.muted,
    fontFamily: fonts.Medium,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  infoValue: {
    marginTop: 4,
    color: color.text.primary,
    fontFamily: fonts.Medium,
    fontSize: typography.body.size,
    lineHeight: typography.body.lineHeight,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    marginBottom: 14,
  },
  statBlock: {
    flex: 1,
    paddingRight: 10,
  },
  statDivider: {
    width: 1,
    backgroundColor: 'rgba(17,26,39,0.08)',
    marginHorizontal: 8,
  },
  statLabel: {
    color: color.text.muted,
    fontFamily: fonts.Medium,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  statValue: {
    marginTop: 4,
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: typography.subtitle.size,
    lineHeight: typography.subtitle.lineHeight,
  },
  skeletonLine: {
    marginTop: 7,
    height: 11,
    borderRadius: 999,
    backgroundColor: 'rgba(130,123,115,0.16)',
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: LEAF_BG,
    borderWidth: 0,
    borderColor: 'transparent',
  },
  hiddenText: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
  },
});
