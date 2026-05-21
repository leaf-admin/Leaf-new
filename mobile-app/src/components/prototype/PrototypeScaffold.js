import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { Easing, FadeInUp } from 'react-native-reanimated';
import robotaxiPrototypeTokens from '../design-system/robotaxiPrototypeTokens';

const { color, touch, motion } = robotaxiPrototypeTokens;
const islandEasing = Easing.bezier(...motion.bezier.snappy);

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
        <View style={[styles.locateGlyphOuter, { borderColor: tintColor }]} />
        <View style={[styles.locateGlyphInner, { backgroundColor: tintColor }]} />
      </View>
    );
  }

  if (name === 'arrow-back') {
    return (
      <View style={styles.chevronGlyphWrap}>
        <View style={[styles.chevronGlyphStroke, styles.chevronGlyphStrokeTop, { backgroundColor: tintColor }]} />
        <View style={[styles.chevronGlyphStroke, styles.chevronGlyphStrokeBottom, { backgroundColor: tintColor }]} />
      </View>
    );
  }

  return <View style={[styles.glyphFallbackDot, { backgroundColor: tintColor }]} />;
}

export function PrototypeTopControls({
  insets,
  onPressLeft,
  onPressRight,
  leftIcon = 'locate',
  rightIcon = 'menu',
  showRightBadge = false
}) {
  return (
    <View style={[styles.topRow, { top: insets.top + 8 }]}>
      <TouchableOpacity style={styles.topButton} activeOpacity={0.85} onPress={onPressLeft}>
        <PrototypeTopControlGlyph name={leftIcon} tintColor={color.text.primary} />
      </TouchableOpacity>

      <TouchableOpacity style={styles.topButton} activeOpacity={0.85} onPress={onPressRight}>
        <PrototypeTopControlGlyph name={rightIcon} tintColor={color.text.primary} />
        {showRightBadge ? <View style={styles.notificationDot} /> : null}
      </TouchableOpacity>
    </View>
  );
}

export function PrototypeBottomIsland({ insets, active = 'home', onPressProfile, onPressHome, onPressSettings }) {
  return (
    <View style={[styles.islandWrap, { bottom: insets.bottom + 10 }]} pointerEvents="box-none">
      <Animated.View
        entering={FadeInUp.duration(motion.timing.standard)
          .easing(islandEasing)
          .withInitialValues({ transform: [{ translateY: 14 }], opacity: 0.95 })}
        style={styles.island}
      >
        <TouchableOpacity
          style={[styles.islandAction, active === 'profile' && styles.islandActionActive]}
          onPress={onPressProfile}
          activeOpacity={0.85}
        >
          <Ionicons name="person-outline" size={22} color={active === 'profile' ? color.accent.contrast : color.text.primary} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.islandAction, active === 'home' && styles.islandActionActive]}
          onPress={onPressHome}
          activeOpacity={0.85}
        >
          <Ionicons name="location" size={22} color={active === 'home' ? color.accent.contrast : color.text.primary} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.islandAction, active === 'settings' && styles.islandActionActive]}
          onPress={onPressSettings}
          activeOpacity={0.85}
        >
          <Ionicons
            name="settings-outline"
            size={22}
            color={active === 'settings' ? color.accent.contrast : color.text.primary}
          />
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
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
    width: 40,
    height: 40,
    borderRadius: 20,
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
    top: 15,
    right: 15,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#D61F2D',
    borderWidth: 1,
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
    width: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
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
    width: 236,
    minHeight: touch.large + 12,
    borderRadius: 37,
    backgroundColor: color.surface.primary,
    borderWidth: 1,
    borderColor: color.border.strong,
    paddingHorizontal: 14,
    paddingVertical: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    shadowColor: color.shadow.base,
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.24,
    shadowRadius: 26,
    elevation: 13
  },
  islandAction: {
    width: touch.comfortable,
    height: touch.comfortable,
    borderRadius: touch.comfortable / 2,
    alignItems: 'center',
    justifyContent: 'center'
  },
  islandActionActive: {
    backgroundColor: color.accent.primary,
    shadowColor: color.shadow.accent,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.26,
    shadowRadius: 12,
    elevation: 7
  }
});
