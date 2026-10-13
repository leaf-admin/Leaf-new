import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

const SWEEP_DURATION_MS = 1500;
const TEXT_SWAP_MS = 240;

// A thin line with a soft highlight travelling across it: "still working on
// it". Used while the passenger waits for a driver and while a driver is
// online waiting for rides. Native driver only (translate/opacity).
export function LeafSearchingLine({ color = '#1A330E', trackColor = 'rgba(26,51,14,0.12)', height = 3, style, testID }) {
  const reduceMotion = useReducedMotion();
  const [width, setWidth] = useState(0);
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion || width <= 0) return undefined;
    progress.setValue(0);
    const animation = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: SWEEP_DURATION_MS,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }),
    );
    animation.start();
    return () => animation.stop();
  }, [progress, reduceMotion, width]);

  const segmentWidth = Math.max(40, width * 0.34);
  return (
    <View
      style={[styles.line, { height, borderRadius: height / 2, backgroundColor: trackColor }, style]}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      testID={testID}
      accessibilityRole="progressbar"
      accessibilityLabel="Procurando"
    >
      {width > 0 ? (
        <Animated.View
          style={{
            width: segmentWidth,
            height,
            borderRadius: height / 2,
            backgroundColor: color,
            opacity: reduceMotion ? 0.5 : 1,
            transform: [
              {
                translateX: reduceMotion
                  ? (width - segmentWidth) / 2
                  : progress.interpolate({ inputRange: [0, 1], outputRange: [-segmentWidth, width] }),
              },
            ],
          }}
        />
      ) : null}
    </View>
  );
}

// Text that eases out and in when it changes, instead of swapping abruptly.
export function LeafStatusTicker({ text, style, numberOfLines = 1, testID }) {
  const reduceMotion = useReducedMotion();
  const [shown, setShown] = useState(text);
  const progress = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (text === shown) return undefined;
    if (reduceMotion) {
      setShown(text);
      return undefined;
    }
    const out = Animated.timing(progress, {
      toValue: 0,
      duration: TEXT_SWAP_MS / 2,
      easing: Easing.in(Easing.quad),
      useNativeDriver: true,
    });
    out.start(({ finished }) => {
      if (!finished) return;
      setShown(text);
      Animated.timing(progress, {
        toValue: 1,
        duration: TEXT_SWAP_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    });
    return () => out.stop();
  }, [progress, reduceMotion, shown, text]);

  return (
    <Animated.Text
      style={[
        style,
        {
          opacity: progress,
          transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }],
        },
      ]}
      numberOfLines={numberOfLines}
      testID={testID}
    >
      {shown}
    </Animated.Text>
  );
}

const styles = StyleSheet.create({
  line: {
    width: '100%',
    overflow: 'hidden',
  },
});
