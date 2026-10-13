import leafTypography from './LeafTypography';
import React from 'react';
import { useIsFocused } from '@react-navigation/native';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import LeafMaterialSurface from './LeafMaterialSurface';
import LeafGlassSurface from '../design-system/LeafGlassSurface';
import LeafLineIcon from '../design-system/LeafLineIcon';
import LeafSoftIcon from '../design-system/LeafSoftIcon';
import { useLeafNativeTabBar } from './LeafNativeTabBar';
import { navigateLeafRootTab } from '../../navigation/leafRootTabNavigation';
import robotaxiPrototypeTokens from '../design-system/robotaxiPrototypeTokens';

const { color, touch, motion } = robotaxiPrototypeTokens;
// Line icons in the same weight as the header; the selected tab takes the brand
// green so state reads from colour, not from a grey pill alone.
const TAB_ACTIVE_COLOR = '#1A330E';
const TAB_IDLE_COLOR = '#3A4037';

function PrototypeTopControlGlyph({ name, tintColor, signal }) {
  if (name === 'menu') {
    return (
      <View style={styles.menuGlyphWrap}>
        <View style={[styles.menuGlyphBar, { backgroundColor: tintColor }]} />
        <View style={[styles.menuGlyphBar, styles.menuGlyphBarShort, { backgroundColor: tintColor }]} />
        <View style={[styles.menuGlyphBar, { backgroundColor: tintColor }]} />
      </View>
    );
  }
  if (name === 'locate' || name === 'bell') {
    return <LeafSoftIcon name={name} size={30} signal={signal} />;
  }
  if (name === 'arrow-back') {
    return <LeafLineIcon name="back" size={22} color={tintColor} />;
  }
  return <View style={[styles.glyphFallbackDot, { backgroundColor: tintColor }]} />;
}

const TOP_CONTROL_LABELS = {
  'arrow-back': 'Voltar',
  bell: 'Notificações',
  locate: 'Centralizar mapa',
  menu: 'Abrir menu',
};

export function PrototypeTopControls({
  insets,
  onPressLeft,
  onPressRight,
  leftIcon = 'locate',
  rightIcon = 'menu',
  showRightBadge = false,
  rightBadgeCount = 0,
  leftSignal = 0,
  leftAccessibilityLabel,
  rightAccessibilityLabel,
  leftTestID = 'prototype-top-left-control',
  rightTestID = 'prototype-top-right-control',
}) {
  const resolvedLeftLabel = leftAccessibilityLabel || TOP_CONTROL_LABELS[leftIcon] || 'Centralizar mapa';
  const baseRightLabel = rightAccessibilityLabel || TOP_CONTROL_LABELS[rightIcon] || 'Centralizar mapa';
  const resolvedRightLabel =
    rightIcon === 'bell' && rightBadgeCount > 0
      ? `${baseRightLabel}, ${rightBadgeCount} ${rightBadgeCount === 1 ? 'nova' : 'novas'}`
      : baseRightLabel;

  return (
    <View pointerEvents="box-none" style={[styles.topRow, { top: insets.top + 18 }]}>
      <TouchableOpacity
        style={styles.topButton}
        activeOpacity={0.85}
        onPress={onPressLeft}
        accessibilityRole="button"
        accessibilityLabel={resolvedLeftLabel}
        testID={leftTestID}
      >
        <LeafGlassSurface interactive pointerEvents="none" style={styles.topButtonGlass} />
        <PrototypeTopControlGlyph name={leftIcon} tintColor={color.text.primary} signal={leftSignal} />
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.topButton}
        activeOpacity={0.85}
        onPress={onPressRight}
        accessibilityRole="button"
        accessibilityLabel={resolvedRightLabel}
        testID={rightTestID}
      >
        <LeafGlassSurface interactive pointerEvents="none" style={styles.topButtonGlass} />
        <PrototypeTopControlGlyph name={rightIcon} tintColor={color.text.primary} signal={rightBadgeCount} />
        {showRightBadge ? <View style={styles.notificationDot} testID={`${rightTestID}-badge`} /> : null}
      </TouchableOpacity>
    </View>
  );
}

export function PrototypeBottomIsland({ insets = {}, active = 'home', onPressProfile, onPressHome, onPressSettings, onPressActivity }) {
  const focused = useIsFocused();
  const native = useLeafNativeTabBar({ active, focused, onPressProfile, onPressHome, onPressSettings, onPressActivity });
  if (native || !focused) return null;
  const items = [
    { key: 'home', title: 'Início', icon: 'home', onPress: onPressHome },
    { key: 'activity', title: 'Atividade', icon: 'activity', onPress: onPressActivity || onPressSettings },
    { key: 'account', title: 'Conta', icon: 'account', onPress: onPressProfile },
  ];
  return (
    <View style={[styles.islandWrap, { bottom: (insets.bottom || 0) + 8 }]} pointerEvents="box-none">
      <LeafMaterialSurface style={styles.island}>
        {items.map(item => (
          <TouchableOpacity key={item.key} style={[styles.islandAction, active === item.key && styles.islandActionActive]}
            onPress={item.onPress} activeOpacity={0.85} accessibilityRole="tab"
            accessibilityLabel={item.title} accessibilityState={{ selected: active === item.key }} testID={`leaf-root-tab-${item.key}`}>
            <LeafSoftIcon
              name={item.icon}
              size={30}
              active={active === item.key}
              signal={active === item.key ? 1 : 0}
            />
            <Text style={[styles.tabLabel, active === item.key && styles.tabLabelActive]}>{item.title}</Text>
          </TouchableOpacity>
        ))}
      </LeafMaterialSurface>
    </View>
  );
}

export function LeafRootTabs({ navigation, active, insets }) {
  const focused = useIsFocused();
  if (!focused) return null;
  return <PrototypeBottomIsland insets={insets} active={active}
    onPressHome={() => navigateLeafRootTab(navigation, 'home')}
    onPressActivity={() => navigateLeafRootTab(navigation, 'activity', { rootTab: true })}
    onPressProfile={() => navigateLeafRootTab(navigation, 'account')} />;
}

const styles = StyleSheet.create({
  topRow: {
    position: 'absolute',
    left: 24,
    right: 24,
    zIndex: 80,
    elevation: 80,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  topButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative'
  },
  // Glass (iOS 26) or solid fallback behind the glyph; same 48 pt circle.
  topButtonGlass: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 24,
  },
  notificationDot: {
    position: 'absolute',
    top: 12,
    right: 13,
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: '#D61F2D',
    borderWidth: 1.5,
    borderColor: '#FFFFFF'
  },
  menuGlyphWrap: {
    width: 20,
    height: 15,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  menuGlyphBar: {
    width: 18,
    height: 2.5,
    borderRadius: 2,
  },
  menuGlyphBarShort: {
    width: 13,
  },
  locateGlyphWrap: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  locateGlyphCrosshairVertical: {
    position: 'absolute',
    width: 2,
    height: 22,
    borderRadius: 1,
    opacity: 0.58,
  },
  locateGlyphCrosshairHorizontal: {
    position: 'absolute',
    width: 22,
    height: 2,
    borderRadius: 1,
    opacity: 0.58,
  },
  locateGlyphOuter: {
    width: 17,
    height: 17,
    borderRadius: 8.5,
    borderWidth: 2.4,
  },
  locateGlyphInner: {
    position: 'absolute',
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  chevronGlyphWrap: {
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chevronGlyphStroke: {
    position: 'absolute',
    width: 14,
    height: 3.5,
    borderRadius: 2,
    left: 2,
  },
  chevronGlyphStrokeTop: {
    transform: [{ rotate: '-45deg' }],
    top: 5,
  },
  chevronGlyphStrokeBottom: {
    transform: [{ rotate: '45deg' }],
    bottom: 5,
  },
  glyphFallbackDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  islandWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 20
  },
  island: {
    width: 274,
    minHeight: 64,
    borderRadius: 34,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.8)',
    paddingHorizontal: 4,
    paddingVertical: 4,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    shadowColor: color.shadow.base,
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.09,
    shadowRadius: 26,
    elevation: 4
  },
  islandAction: {
    flex: 1,
    minHeight: 54,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center'
  },
  islandActionActive: {
    backgroundColor: 'rgba(26,51,14,0.08)',
  },
  tabLabel: { ...leafTypography.medium, fontSize: 11, lineHeight: 14, color: TAB_IDLE_COLOR, marginTop: 3 },
  tabLabelActive: { color: TAB_ACTIVE_COLOR, ...leafTypography.semiBold },
});
