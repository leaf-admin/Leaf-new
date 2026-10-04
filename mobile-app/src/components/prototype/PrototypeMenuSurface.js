import leafTypography from './LeafTypography';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { Easing, FadeInUp, useReducedMotion } from 'react-native-reanimated';
import { LeafObjectIcon } from './LeafVisualElements';
import robotaxiPrototypeTokens from '../design-system/robotaxiPrototypeTokens';

const { color, typography, elevation, motion } = robotaxiPrototypeTokens;
const contentEnterEasing = Easing.bezier(...motion.bezier.smoothOut);
const LEAF_CARD_SURFACE = 'rgba(255,255,255,0.96)';
const LEAF_CARD_BORDER = '#E5E5E5';
const LEAF_BG = '#FFFFFF';
const LEAF_TEXT = '#222222';
const LEAF_MUTED = '#767676';
const LEAF_SECONDARY = '#6A6A6A';
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
  pageTitle = false,
  style,
}) {
  const { width } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
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
        {headerAccessory && !pageTitle ? <View style={styles.headerLeading}>{headerAccessory}</View> : null}
        <View style={styles.headerCopyWrap}>
          {eyebrow && !fullScreen ? <Text maxFontSizeMultiplier={TEXT_SCALE_CAP} style={styles.eyebrow}>{eyebrow}</Text> : null}
          {eyebrow && fullScreen ? <Text maxFontSizeMultiplier={TEXT_SCALE_CAP} style={styles.hiddenText}>{eyebrow}</Text> : null}
          <Text maxFontSizeMultiplier={TEXT_SCALE_CAP} style={[styles.title, pageTitle && styles.pageTitle]}>{title}</Text>
          {subtitle && !fullScreen ? <Text maxFontSizeMultiplier={TEXT_SCALE_CAP} style={styles.subtitle}>{subtitle}</Text> : null}
        </View>

        {headerAccessory && pageTitle ? (
          <View style={styles.headerAccessoryWrap}>{headerAccessory}</View>
        ) : !headerAccessory && badgeLabel ? (
          <View style={styles.badgePill}>
            <Text maxFontSizeMultiplier={TEXT_SCALE_CAP} style={styles.badgePillText}>{badgeLabel}</Text>
          </View>
        ) : null}
      </View>

      {subtitle && fullScreen ? <Text maxFontSizeMultiplier={TEXT_SCALE_CAP} style={[styles.subtitle, styles.pageDescription]}>{subtitle}</Text> : null}

      {!fullScreen ? <View style={styles.headerDivider} /> : null}
      <Animated.View
        entering={reduceMotion ? undefined : FadeInUp.duration(motion.timing.quick)
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
  expanded,
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
      accessibilityState={isInteractiveRow ? { disabled, ...(expanded === undefined ? {} : { expanded }) } : undefined}
    >
      <View style={[styles.rowIconSlot, compact && styles.rowIconSlotCompact]}>
        {iconName ? (
          <LeafObjectIcon symbol={iconName} size={40} />
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
  accessibilityLabel = 'Voltar',
  icon = 'arrow-back',
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
      <Ionicons name={icon} size={18} color={color.text.primary} />
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
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  headerLeading: { marginRight: 2 },
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
    ...leafTypography.medium,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  title: {
    color: LEAF_TEXT,
    ...leafTypography.semiBold,
    fontSize: 22,
    lineHeight: 28,
  },
  subtitle: {
    // SF hierarchy mirrors the approved native canvas.
    marginTop: 5,
    color: LEAF_SECONDARY,
    ...leafTypography.regular,
    fontSize: 14,
    lineHeight: 20,
  },
  pageDescription: { marginTop: 14 },
  pageTitle: { fontSize: 26, lineHeight: 33, letterSpacing: -0.6 },
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
    ...leafTypography.medium,
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
    ...leafTypography.medium,
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
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: LEAF_CARD_BORDER,
  },
  rowCompact: {
    minHeight: 68,
    paddingVertical: 0,
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
    width: 48,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  rowIconSlotCompact: {
    width: 48,
  },
  rowCopyWrap: {
    flex: 1,
    paddingRight: 8,
  },
  rowTitle: {
    color: LEAF_TEXT,
    ...leafTypography.medium,
    fontSize: 16,
    lineHeight: 21,
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
    ...leafTypography.regular,
    fontSize: 13,
    lineHeight: 18,
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
    ...leafTypography.semiBold,
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
    ...leafTypography.medium,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  infoValue: {
    marginTop: 4,
    color: color.text.primary,
    ...leafTypography.medium,
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
    ...leafTypography.medium,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  statValue: {
    marginTop: 4,
    color: color.text.primary,
    ...leafTypography.semiBold,
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
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F5F5F5',
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
