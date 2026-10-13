import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Text } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

const COUNT_DURATION_MS = 720;
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
// up to the new value with a small pulse instead of swapping text. The first
// value shown, non-amount labels and reduced-motion users get plain text.
export default function LeafAnimatedAmount({ label, style, ...textProps }) {
  const reduceMotion = useReducedMotion();
  const target = parseBrlAmount(label);
  const [shown, setShown] = useState(label);
  const previousRef = useRef(target);
  // While the screen is still loading, the first values replace each other
  // (cached figure, then the server's). Those are not earnings going up.
  const mountedAtRef = useRef(Date.now());
  const frameRef = useRef(null);
  const pulse = useRef(new Animated.Value(1)).current;

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
      Animated.timing(pulse, { toValue: 1.06, duration: 180, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.spring(pulse, { toValue: 1, friction: 6, tension: 120, useNativeDriver: true }),
    ]).start();

    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [label, pulse, reduceMotion, target]);

  return (
    <Animated.View style={{ transform: [{ scale: pulse }] }}>
      <Text {...textProps} style={style}>{shown}</Text>
    </Animated.View>
  );
}
