import React, { useEffect, useMemo } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming
} from 'react-native-reanimated';
import robotaxiPrototypeTokens from '../design-system/robotaxiPrototypeTokens';

const { color } = robotaxiPrototypeTokens;

function RadarRing({ progress, offset }) {
  const ringStyle = useAnimatedStyle(() => {
    const normalized = (progress.value + offset) % 1;
    const scale = 0.35 + normalized * 1.55;
    const opacity = 0.36 * (1 - normalized);

    return {
      transform: [{ scale }],
      opacity
    };
  });

  return <Animated.View style={[styles.ring, ringStyle]} />;
}

export default function DriverSearchRadar() {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withRepeat(withTiming(1, { duration: 2800, easing: Easing.linear }), -1, false);
  }, [progress]);

  const rings = useMemo(() => [0, 0.24, 0.48], []);

  return (
    <View style={styles.container} pointerEvents="none">
      <View style={styles.radarWrap}>
        {rings.map(offset => (
          <RadarRing key={offset} progress={progress} offset={offset} />
        ))}

        <View style={styles.centerCore}>
          <Image source={{ uri: 'https://i.pravatar.cc/96?img=47' }} style={styles.centerAvatar} />
          <View style={styles.centerBadge}>
            <Ionicons name="car-sport" size={10} color={color.accent.contrast} />
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center'
  },
  radarWrap: {
    width: 210,
    height: 210,
    borderRadius: 105,
    alignItems: 'center',
    justifyContent: 'center'
  },
  ring: {
    position: 'absolute',
    width: 192,
    height: 192,
    borderRadius: 96,
    borderWidth: 2,
    borderColor: 'rgba(26,51,14,0.42)',
    backgroundColor: 'rgba(26,51,14,0.08)'
  },
  centerCore: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderWidth: 1,
    borderColor: 'rgba(20,24,31,0.14)',
    shadowColor: color.shadow.accent,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.42,
    shadowRadius: 18,
    elevation: 14
  },
  centerAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26
  },
  centerBadge: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.accent.primary,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.84)'
  }
});
