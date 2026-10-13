import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

// "Looking for a driver" on the map: a radar. A beam sweeps the search area,
// soft rings travel outwards from the pickup and the pickup itself breathes.
// Everything runs on the native driver (transform/opacity only).
const SWEEP_DURATION_MS = 3200;
const RING_DURATION_MS = 2800;
const RING_DELAYS_MS = [0, 930, 1860];
const CORE_DURATION_MS = 1400;
const LEAF_GREEN = '42,77,29';

function useLoop(durationMs, { delay = 0, easing = Easing.linear, yoyo = false } = {}) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let animation;
    const timeout = setTimeout(() => {
      const forward = Animated.timing(progress, {
        toValue: 1,
        duration: durationMs,
        easing,
        useNativeDriver: true,
      });
      animation = Animated.loop(
        yoyo
          ? Animated.sequence([
              forward,
              Animated.timing(progress, {
                toValue: 0,
                duration: durationMs,
                easing,
                useNativeDriver: true,
              }),
            ])
          : forward,
      );
      animation.start();
    }, delay);

    return () => {
      clearTimeout(timeout);
      if (animation) animation.stop();
    };
  }, [delay, durationMs, easing, progress, yoyo]);

  return progress;
}

function RadarRing({ delay, radius }) {
  const progress = useLoop(RING_DURATION_MS, { delay, easing: Easing.out(Easing.quad) });
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.ring,
        {
          width: radius * 2,
          height: radius * 2,
          borderRadius: radius,
          opacity: progress.interpolate({
            inputRange: [0, 0.12, 0.7, 1],
            outputRange: [0, 0.55, 0.18, 0],
          }),
          transform: [
            { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.1, 1] }) },
          ],
        },
      ]}
    />
  );
}

function RadarSweep({ radius }) {
  const progress = useLoop(SWEEP_DURATION_MS);
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.sweep,
        {
          width: radius * 2,
          height: radius * 2,
          borderRadius: radius,
          transform: [
            { rotate: progress.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) },
          ],
        },
      ]}
    >
      {/* The quadrant behind the leading edge, fading backwards, reads as a
          beam. Rotation is clockwise, so the leading edge is its bottom side. */}
      <LinearGradient
        colors={[`rgba(${LEAF_GREEN},0.24)`, `rgba(${LEAF_GREEN},0.07)`, `rgba(${LEAF_GREEN},0)`]}
        locations={[0, 0.4, 0.85]}
        start={{ x: 0.6, y: 1 }}
        end={{ x: 0.25, y: 0 }}
        style={{ position: 'absolute', left: radius, top: 0, width: radius, height: radius }}
      />
      <View style={[styles.sweepEdge, { left: radius, top: radius - 0.75, width: radius }]} />
    </Animated.View>
  );
}

function RadarCore() {
  const progress = useLoop(CORE_DURATION_MS, { easing: Easing.inOut(Easing.quad), yoyo: true });
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.core,
        {
          opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0.34, 0.12] }),
          transform: [
            { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.35] }) },
          ],
        },
      ]}
    />
  );
}

function SearchRadarPulse({ centerX, centerY, radius }) {
  if (!(radius > 0)) {
    return null;
  }
  return (
    <View
      pointerEvents="none"
      style={[
        styles.layer,
        { left: centerX - radius, top: centerY - radius, width: radius * 2, height: radius * 2 },
      ]}
      testID="map-search-radar-pulse"
    >
      <RadarSweep radius={radius} />
      {RING_DELAYS_MS.map((delay) => (
        <RadarRing key={delay} delay={delay} radius={radius} />
      ))}
      <View style={styles.coreAnchor}>
        <RadarCore />
      </View>
    </View>
  );
}

const CORE_SIZE = 72;

const styles = StyleSheet.create({
  layer: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    left: 0,
    top: 0,
    borderWidth: 1.5,
    borderColor: `rgba(${LEAF_GREEN},0.55)`,
    backgroundColor: `rgba(${LEAF_GREEN},0.05)`,
  },
  sweep: {
    position: 'absolute',
    left: 0,
    top: 0,
    overflow: 'hidden',
  },
  sweepEdge: {
    position: 'absolute',
    height: 1.5,
    backgroundColor: `rgba(${LEAF_GREEN},0.34)`,
  },
  coreAnchor: {
    position: 'absolute',
    width: CORE_SIZE,
    height: CORE_SIZE,
  },
  core: {
    width: CORE_SIZE,
    height: CORE_SIZE,
    borderRadius: CORE_SIZE / 2,
    backgroundColor: `rgba(${LEAF_GREEN},1)`,
  },
});

export default React.memo(SearchRadarPulse);
