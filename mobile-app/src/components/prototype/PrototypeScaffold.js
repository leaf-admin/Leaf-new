import leafTypography from './LeafTypography';
import React from 'react';
import { useIsFocused } from '@react-navigation/native';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LeafObjectIcon } from './LeafVisualElements';
import LeafMaterialSurface from './LeafMaterialSurface';
import { useLeafNativeTabBar } from './LeafNativeTabBar';
import robotaxiPrototypeTokens from '../design-system/robotaxiPrototypeTokens';

const { color, touch, motion } = robotaxiPrototypeTokens;

function PrototypeTopControlGlyph({ name, tintColor }) {
  if (name === 'menu') {
    return (
      <View style={styles.menuGlyphWrap}>
        <View style={[styles.menuGlyphBar, { backgroundColor: tintColor }]} />
        <View style={[styles.menuGlyphBar, styles.menuGlyphBarShort, { backgroundColor: tintColor }]} />
        <View style={[styles.menuGlyphBar, { backgroundColor: tintColor }]} />
      </View>
    );
  }

  if (name === 'locate') {
    return (
      <View style={styles.locateGlyphWrap}>
        <View style={[styles.locateGlyphCrosshairVertical, { backgroundColor: tintColor }]} />
        <View style={[styles.locateGlyphCrosshairHorizontal, { backgroundColor: tintColor }]} />
        <View style={[styles.locateGlyphOuter, { borderColor: tintColor }]} />
        <View style={[styles.locateGlyphInner, { backgroundColor: tintColor }]} />
      </View>
    );
  }

  if (name === 'arrow-back') {
    return <Ionicons name="arrow-back" size={20} color={tintColor} />;
  }

  return <View style={[styles.glyphFallbackDot, { backgroundColor: tintColor }]} />;
}

export function PrototypeTopControls({
  insets,
  onPressLeft,
  onPressRight,
  leftIcon = 'locate',
  rightIcon = 'menu',
  showRightBadge = false,
  leftAccessibilityLabel,
  rightAccessibilityLabel,
  leftTestID = 'prototype-top-left-control',
  rightTestID = 'prototype-top-right-control',
}) {
  const resolvedLeftLabel = leftAccessibilityLabel || (leftIcon === 'arrow-back' ? 'Voltar' : 'Centralizar mapa');
  const resolvedRightLabel = rightAccessibilityLabel || (rightIcon === 'menu' ? 'Abrir menu' : 'Centralizar mapa');

  return (
    <View style={[styles.topRow, { top: insets.top + 18 }]}>
      <TouchableOpacity
        style={styles.topButton}
        activeOpacity={0.85}
        onPress={onPressLeft}
        accessibilityRole="button"
        accessibilityLabel={resolvedLeftLabel}
        testID={leftTestID}
      >
        <PrototypeTopControlGlyph name={leftIcon} tintColor={color.text.primary} />
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.topButton}
        activeOpacity={0.85}
        onPress={onPressRight}
        accessibilityRole="button"
        accessibilityLabel={resolvedRightLabel}
        testID={rightTestID}
      >
        <PrototypeTopControlGlyph name={rightIcon} tintColor={color.text.primary} />
        {showRightBadge ? <View style={styles.notificationDot} /> : null}
      </TouchableOpacity>
    </View>
  );
}

export function PrototypeBottomIsland({ insets = {}, active = 'home', onPressProfile, onPressHome, onPressSettings, onPressActivity }) {
  const focused = useIsFocused();
  const native = useLeafNativeTabBar({ active, focused, onPressProfile, onPressHome, onPressSettings, onPressActivity });
  if (native || !focused) return null;
  const items = [
    { key: 'home', title: 'Início', object: 'home', onPress: onPressHome },
    { key: 'activity', title: 'Atividade', object: 'tabActivity', onPress: onPressActivity || onPressSettings },
    { key: 'account', title: 'Conta', object: 'tabAccount', onPress: onPressProfile },
  ];
  return (
    <View style={[styles.islandWrap, { bottom: (insets.bottom || 0) + 8 }]} pointerEvents="box-none">
      <LeafMaterialSurface style={styles.island}>
        {items.map(item => (
          <TouchableOpacity key={item.key} style={[styles.islandAction, active === item.key && styles.islandActionActive]}
            onPress={item.onPress} activeOpacity={0.85} accessibilityRole="tab"
            accessibilityLabel={item.title} accessibilityState={{ selected: active === item.key }} testID={`leaf-root-tab-${item.key}`}>
            <LeafObjectIcon name={item.object} size={32} />
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
    onPressHome={() => navigation.navigate('RobotaxiPrototype')}
    onPressActivity={() => navigation.navigate('RobotaxiMenuTripHistory', { rootTab: true })}
    onPressProfile={() => navigation.navigate('RobotaxiPrototypeMenu')} />;
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
    backgroundColor: color.surface.primary,
    borderWidth: 1,
    borderColor: color.border.strong,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: color.shadow.base,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 6,
    position: 'relative'
  },
  notificationDot: {
    position: 'absolute',
    top: -1,
    right: -1,
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
    backgroundColor: 'rgba(222,222,222,0.58)',
  },
  tabLabel: { ...leafTypography.medium, fontSize: 10, lineHeight: 14, color: '#222222', marginTop: 1 },
  tabLabelActive: { color: '#1A330E', ...leafTypography.semiBold },
});
