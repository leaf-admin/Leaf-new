import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fonts } from '../../theme/runtimeTokens';
import robotaxiPrototypeTokens from '../design-system/robotaxiPrototypeTokens';

const { color, typography, elevation } = robotaxiPrototypeTokens;

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
          {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>

        {headerAccessory ? (
          <View style={styles.headerAccessoryWrap}>{headerAccessory}</View>
        ) : badgeLabel ? (
          <View style={styles.badgePill}>
            <Text style={styles.badgePillText}>{badgeLabel}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.headerDivider} />
      <View style={[styles.body, fullScreen && styles.bodyFullScreen, bodyStyle]}>{children}</View>

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
      <Text style={styles.sectionTitle}>{title}</Text>
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
  trailing,
  active = false,
  last = false,
  testID,
  accessibilityLabel,
}) {
  const RowComponent = onPress ? TouchableOpacity : View;

  return (
    <RowComponent
      style={[styles.row, active && styles.rowActive, last && styles.rowLast]}
      onPress={onPress}
      activeOpacity={onPress ? 0.78 : 1}
      testID={testID}
      accessibilityLabel={accessibilityLabel}
    >
      <View style={styles.rowIconSlot}>
        {icon ? <Ionicons name={icon} size={18} color={active ? color.accent.strong : color.text.primary} /> : null}
      </View>

      <View style={styles.rowCopyWrap}>
        <Text style={[styles.rowTitle, active && styles.rowTitleActive]}>{title}</Text>
        {subtitle ? <Text style={styles.rowSubtitle}>{subtitle}</Text> : null}
      </View>

      {badge ? <View style={styles.inlineBadge}><Text style={styles.inlineBadgeText}>{badge}</Text></View> : null}
      {trailing === null ? null : trailing ? trailing : <Ionicons name="chevron-forward" size={15} color={color.text.muted} />}
    </RowComponent>
  );
}

export function PrototypeMenuInfoRow({ label, value, last = false }) {
  return (
    <View style={[styles.infoRow, last && styles.infoRowLast]}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

export function PrototypeMenuStatRow({ items }) {
  return (
    <View style={styles.statsRow}>
      {items.map((item, index) => (
        <React.Fragment key={item.key || item.label}>
          <View style={styles.statBlock}>
            <Text style={styles.statLabel}>{item.label}</Text>
            <Text style={styles.statValue}>{item.value}</Text>
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
    borderRadius: 30,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 16,
    backgroundColor: 'rgba(247,250,252,0.97)',
    borderWidth: 1,
    borderColor: 'rgba(17,26,39,0.08)',
    shadowColor: color.shadow.base,
    ...elevation.panel,
  },
  surfaceFullScreen: {
    alignSelf: 'stretch',
    flex: 1,
    width: '100%',
    borderRadius: 0,
    paddingHorizontal: 22,
    paddingTop: 18,
    paddingBottom: 18,
    backgroundColor: 'rgba(247,250,247,0.985)',
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
    color: '#667180',
    fontFamily: fonts.Medium,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight,
    textTransform: 'uppercase',
    letterSpacing: 1.4,
  },
  title: {
    color: '#0A1320',
    fontFamily: fonts.Bold,
    fontSize: 32,
    lineHeight: 36,
  },
  subtitle: {
    marginTop: 4,
    color: '#445062',
    fontFamily: fonts.Regular,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight,
  },
  badgePill: {
    minHeight: 28,
    borderRadius: 999,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(230,237,244,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(17,26,39,0.08)',
  },
  badgePillText: {
    color: color.text.secondary,
    fontFamily: fonts.Medium,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight,
  },
  headerDivider: {
    height: 1,
    backgroundColor: 'rgba(17,26,39,0.11)',
    marginTop: 14,
  },
  body: {
    paddingTop: 10,
  },
  bodyFullScreen: {
    flex: 1,
  },
  footerDivider: {
    height: 1,
    backgroundColor: 'rgba(17,26,39,0.08)',
    marginTop: 12,
  },
  footer: {
    paddingTop: 12,
  },
  sectionBlock: {
    marginBottom: 16,
  },
  sectionTitle: {
    color: color.text.muted,
    fontFamily: fonts.Medium,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: 8,
  },
  sectionDivider: {
    height: 1,
    backgroundColor: 'rgba(17,26,39,0.08)',
    marginBottom: 2,
  },
  row: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(17,26,39,0.08)',
  },
  rowActive: {
    backgroundColor: 'rgba(42,77,29,0.05)',
  },
  rowLast: {
    borderBottomWidth: 0,
    paddingBottom: 4,
  },
  rowIconSlot: {
    width: 28,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  rowCopyWrap: {
    flex: 1,
    paddingRight: 8,
  },
  rowTitle: {
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: 16,
    lineHeight: 22,
  },
  rowTitleActive: {
    color: color.accent.strong,
  },
  rowSubtitle: {
    marginTop: 1,
    color: color.text.secondary,
    fontFamily: fonts.Regular,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight,
  },
  inlineBadge: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F26672',
    marginRight: 8,
  },
  inlineBadgeText: {
    color: '#FFFFFF',
    fontFamily: fonts.Bold,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight,
  },
  infoRow: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(17,26,39,0.08)',
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
    letterSpacing: 1.1,
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
    letterSpacing: 1.1,
  },
  statValue: {
    marginTop: 4,
    color: color.text.primary,
    fontFamily: fonts.Bold,
    fontSize: typography.subtitle.size,
    lineHeight: typography.subtitle.lineHeight,
  },
  closeButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(230,237,244,0.9)',
    borderWidth: 1,
    borderColor: 'rgba(17,26,39,0.08)',
  },
});
