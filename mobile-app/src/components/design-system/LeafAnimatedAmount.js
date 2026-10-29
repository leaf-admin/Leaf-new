import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import leafTypography from '../prototype/LeafTypography';
import { LEAF_MOTION_DURATION, LEAF_MOTION_EASING } from './leafMotion';

// Motion level 3 (milestone): the driver's money going up after a ride.
const COUNT_DURATION_MS = LEAF_MOTION_DURATION.milestone;
const DELTA_VISIBLE_MS = 1600;
const SETTLE_WINDOW_MS = 6000;

// "R$ 1.234,56" -> 1234.56. Returns null when the label is not a plain amount.
export function parseBrlAmount(label) {
  const match = /^\s*R\$\s*(-?[\d.]+,\d{2})\s*$/.exec(String(label || ''));
  if (!match) return null;
  const value = Number(match[1].replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

export function formatBrlAmount(value) {
  const fixed = Math.abs(value).toFixed(2);
  const [integer, cents] = fixed.split('.');
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${value < 0 ? '-' : ''}R$ ${grouped},${cents}`;
}

// Money that changes while the user is looking (earnings after a ride) counts
// up to the new value instead of swapping text, calmly (no bounce). With
// showDelta, a rise also floats a "+ R$ x" chip up and tints the value lime
// once. The first value shown, non-amount labels and reduced-motion users get
// plain text.
export default function LeafAnimatedAmount({ label, style, showDelta = false, deltaPlacement = 'above', ...textProps }) {
  const reduceMotion = useReducedMotion();
  const target = parseBrlAmount(label);
  const [shown, setShown] = useState(label);
  const previousRef = useRef(target);
  // While the screen is still loading, the first values replace each other
  // (cached figure, then the server's). Those are not earnings going up.
  const mountedAtRef = useRef(Date.now());
  const frameRef = useRef(null);
  const pulse = useRef(new Animated.Value(1)).current;
  const deltaProgress = useRef(new Animated.Value(0)).current;
  const [delta, setDelta] = useState(null);

  useEffect(() => {
    const from = previousRef.current;
    previousRef.current = target;
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    const settling = Date.now() - mountedAtRef.current < SETTLE_WINDOW_MS;
    if (reduceMotion || settling || target === null || from === null || from === target) {
      setShown(label);
      return undefined;
    }

    const startedAt = Date.now();
    const step = () => {
      const progress = Math.min(1, (Date.now() - startedAt) / COUNT_DURATION_MS);
      const eased = 1 - (1 - progress) ** 3;
      if (progress >= 1) {
        setShown(label);
        frameRef.current = null;
        return;
      }
      setShown(formatBrlAmount(from + (target - from) * eased));
      frameRef.current = requestAnimationFrame(step);
    };
    frameRef.current = requestAnimationFrame(step);

    pulse.setValue(1);
    Animated.sequence([
      Animated.timing(pulse, { toValue: 1.03, duration: LEAF_MOTION_DURATION.standard, easing: LEAF_MOTION_EASING, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1, duration: LEAF_MOTION_DURATION.enter, easing: LEAF_MOTION_EASING, useNativeDriver: true }),
    ]).start();

    if (showDelta && target > from) {
      setDelta(formatBrlAmount(target - from));
      deltaProgress.setValue(0);
      Animated.timing(deltaProgress, { toValue: 1, duration: DELTA_VISIBLE_MS, easing: LEAF_MOTION_EASING, useNativeDriver: true })
        .start(({ finished }) => { if (finished) setDelta(null); });
    }

    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [deltaProgress, label, pulse, reduceMotion, showDelta, target]);

  return (
    <View>
      <Animated.View style={{ transform: [{ scale: pulse }] }}>
        <Text {...textProps} style={style}>{shown}</Text>
      </Animated.View>
      {delta ? (
        <Animated.View
          pointerEvents="none"
          accessibilityLiveRegion="polite"
          testID="leaf-animated-amount-delta"
          style={[
            amountStyles.delta,
            deltaPlacement === 'below' ? amountStyles.deltaBelow : amountStyles.deltaAbove,
            {
              opacity: deltaProgress.interpolate({ inputRange: [0, 0.15, 0.7, 1], outputRange: [0, 1, 1, 0] }),
              transform: [{ translateY: deltaProgress.interpolate({ inputRange: [0, 1], outputRange: deltaPlacement === 'below' ? [-6, 18] : [6, -22] }) }],
            },
          ]}
        >
          <Text style={amountStyles.deltaText}>{`+ ${delta}`}</Text>
        </Animated.View>
      ) : null}
    </View>
  );
}

const amountStyles = StyleSheet.create({
  delta: { position: 'absolute', alignSelf: 'center', borderRadius: 999, backgroundColor: '#D4E84A', paddingHorizontal: 10, paddingVertical: 3 },
  deltaAbove: { bottom: '100%' },
  deltaBelow: { top: '100%' },
  deltaText: { ...leafTypography.bold, fontSize: 13, lineHeight: 18, color: '#003002' },
});
