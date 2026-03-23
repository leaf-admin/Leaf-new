import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { Easing, FadeInUp } from 'react-native-reanimated';
import robotaxiPrototypeTokens from '../design-system/robotaxiPrototypeTokens';

const { color, touch, motion } = robotaxiPrototypeTokens;
const islandEasing = Easing.bezier(...motion.bezier.snappy);

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
        <Ionicons name={leftIcon} size={25} color={color.text.primary} />
      </TouchableOpacity>

      <TouchableOpacity style={styles.topButton} activeOpacity={0.85} onPress={onPressRight}>
        <Ionicons name={rightIcon} size={25} color={color.text.primary} />
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
    left: 20,
    right: 20,
    zIndex: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  topButton: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: color.surface.primary,
    borderWidth: 1,
    borderColor: color.border.strong,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: color.shadow.base,
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.24,
    shadowRadius: 24,
    elevation: 13,
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
