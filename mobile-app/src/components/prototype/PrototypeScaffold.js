import leafTypography from './LeafTypography';
import React from 'react';
import { useIsFocused } from '@react-navigation/native';
import { Animated, Easing, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import LeafLineIcon from '../design-system/LeafLineIcon';
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
    return <LeafLineIcon name={name} size={22} color={tintColor} signal={signal} />;
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
      <LeafFloatingButton
        onPress={onPressLeft}
        accessibilityLabel={resolvedLeftLabel}
        testID={leftTestID}
      >
        <PrototypeTopControlGlyph name={leftIcon} tintColor={color.text.primary} signal={leftSignal} />
      </LeafFloatingButton>

      <LeafFloatingButton
        onPress={onPressRight}
        accessibilityLabel={resolvedRightLabel}
        testID={rightTestID}
      >
        <PrototypeTopControlGlyph name={rightIcon} tintColor={color.text.primary} signal={rightBadgeCount} />
        {showRightBadge ? <View style={styles.notificationDot} testID={`${rightTestID}-badge`} /> : null}
      </LeafFloatingButton>
    </View>
  );
}

const ISLAND_WIDTH = 274;
const ISLAND_PADDING = 4;
const ISLAND_ITEM_WIDTH = (ISLAND_WIDTH - ISLAND_PADDING * 2) / 3;
const ISLAND_KEYS = ['home', 'activity', 'account'];
// A tab bar é montada de novo a cada tela; lembrar onde o destaque estava deixa ele
// deslizar até a aba nova em vez de aparecer pronto.
let lastIslandIndex = 0;

export function PrototypeBottomIsland({ insets = {}, active = 'home', onPressProfile, onPressHome, onPressSettings, onPressActivity }) {
  const focused = useIsFocused();
  const native = useLeafNativeTabBar({ active, focused, onPressProfile, onPressHome, onPressSettings, onPressActivity });
  const activeIndex = Math.max(0, ISLAND_KEYS.indexOf(active));
  const highlightX = React.useRef(new Animated.Value(lastIslandIndex * ISLAND_ITEM_WIDTH)).current;
  React.useEffect(() => {
    Animated.timing(highlightX, {
      toValue: activeIndex * ISLAND_ITEM_WIDTH,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    lastIslandIndex = activeIndex;
  }, [activeIndex, highlightX]);
  if (native || !focused) return null;
  const items = [
    { key: 'home', title: 'Início', icon: 'home', onPress: onPressHome },
    { key: 'activity', title: 'Atividade', icon: 'activity', onPress: onPressActivity || onPressSettings },
    { key: 'account', title: 'Conta', icon: 'account', onPress: onPressProfile },
  ];
  return (
    <View style={[styles.islandWrap, { bottom: (insets.bottom || 0) + 8 }]} pointerEvents="box-none">
      <View style={styles.island}>
        <Animated.View
          pointerEvents="none"
          style={[styles.islandHighlight, { transform: [{ translateX: highlightX }] }]}
        />
        {items.map(item => {
          const selected = active === item.key;
          return (
            <LeafPressScale key={item.key} style={styles.islandAction}
              onPress={() => {
                if (!selected) Haptics.selectionAsync().catch(() => {});
                item.onPress?.();
              }}
              accessibilityRole="tab"
              accessibilityLabel={item.title} accessibilityState={{ selected }} testID={`leaf-root-tab-${item.key}`}>
              <LeafLineIcon
                name={item.icon}
                size={22}
                color={selected ? TAB_ACTIVE_COLOR : TAB_IDLE_COLOR}
                strokeWidth={selected ? 2 : 1.75}
                active={selected}
                fill="none"
                signal={selected ? 1 : 0}
              />
              <Text style={[styles.tabLabel, selected && styles.tabLabelActive]}>{item.title}</Text>
            </LeafPressScale>
          );
        })}
      </View>
    </View>
  );
}

// Toque com resposta física leve: encolhe um pouco e volta com mola curta.
function LeafPressScale({ children, style, onPress, ...props }) {
  const scale = React.useRef(new Animated.Value(1)).current;
  const to = (value) => Animated.spring(scale, {
    toValue: value,
    speed: value < 1 ? 50 : 24,
    bounciness: value < 1 ? 0 : 5,
    useNativeDriver: true,
  }).start();
  return (
    <Pressable onPress={onPress} onPressIn={() => to(0.94)} onPressOut={() => to(1)} {...props}>
      <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
    </Pressable>
  );
}

// Botão redondo flutuante sobre o mapa: branco, linha bem sutil e sombra leve.
export function LeafFloatingButton({ children, onPress, accessibilityLabel, testID, style }) {
  return (
    <LeafPressScale
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        onPress?.();
      }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      style={[styles.floatingButton, style]}
    >
      {children}
    </LeafPressScale>
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
    width: ISLAND_WIDTH,
    minHeight: 62,
    borderRadius: 31,
    backgroundColor: 'rgba(255,255,255,0.97)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(17,20,16,0.08)',
    padding: ISLAND_PADDING,
    flexDirection: 'row',
    alignItems: 'center',
    // Sombra em duas medidas: perto (contorno) e longe (profundidade).
    shadowColor: '#0E1F12',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 12,
  },
  islandHighlight: {
    position: 'absolute',
    left: ISLAND_PADDING,
    top: ISLAND_PADDING,
    bottom: ISLAND_PADDING,
    width: ISLAND_ITEM_WIDTH,
    borderRadius: 27,
    backgroundColor: 'rgba(26,51,14,0.08)',
  },
  islandAction: {
    width: ISLAND_ITEM_WIDTH,
    minHeight: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center'
  },
  floatingButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.97)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(17,20,16,0.08)',
    shadowColor: '#0E1F12',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 18,
    elevation: 9,
  },
  tabLabel: { ...leafTypography.medium, fontSize: 11, lineHeight: 14, color: TAB_IDLE_COLOR, marginTop: 3 },
  tabLabelActive: { color: TAB_ACTIVE_COLOR, ...leafTypography.semiBold },
});
