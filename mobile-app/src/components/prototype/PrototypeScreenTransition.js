import React from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, FadeIn, FadeOut, Keyframe, useReducedMotion } from 'react-native-reanimated';
import robotaxiPrototypeTokens from '../design-system/robotaxiPrototypeTokens';

const { motion } = robotaxiPrototypeTokens;
const enterEasing = Easing.bezier(...motion.bezier.snappy);
const exitEasing = Easing.bezier(...motion.bezier.smoothIn);

function buildKeyframe(definitions, duration, easing) {
  return new Keyframe({
    ...definitions,
    100: {
      ...definitions[100],
      easing
    }
  }).duration(duration);
}

function buildEnterAnimation(direction) {
  if (direction === 'up') {
    return buildKeyframe({
      0: { opacity: 0, transform: [{ translateY: 28 }] },
      100: { opacity: 1, transform: [{ translateY: 0 }] }
    }, motion.timing.standard, enterEasing);
  }
  if (direction === 'left') {
    return buildKeyframe({
      0: { opacity: 0, transform: [{ translateX: 28 }] },
      100: { opacity: 1, transform: [{ translateX: 0 }] }
    }, motion.timing.standard, enterEasing);
  }
  if (direction === 'right') {
    return buildKeyframe({
      0: { opacity: 0, transform: [{ translateX: -28 }] },
      100: { opacity: 1, transform: [{ translateX: 0 }] }
    }, motion.timing.standard, enterEasing);
  }
  return FadeIn.duration(motion.timing.quick)
    .easing(enterEasing)
    .withInitialValues({ opacity: 0.96 });
}

function buildExitAnimation(direction) {
  if (direction === 'up') {
    return buildKeyframe({
      0: { opacity: 1, transform: [{ translateY: 0 }] },
      100: { opacity: 0, transform: [{ translateY: 16 }] }
    }, motion.timing.quick, exitEasing);
  }
  if (direction === 'left') {
    return buildKeyframe({
      0: { opacity: 1, transform: [{ translateX: 0 }] },
      100: { opacity: 0, transform: [{ translateX: -16 }] }
    }, motion.timing.quick, exitEasing);
  }
  if (direction === 'right') {
    return buildKeyframe({
      0: { opacity: 1, transform: [{ translateX: 0 }] },
      100: { opacity: 0, transform: [{ translateX: 16 }] }
    }, motion.timing.quick, exitEasing);
  }
  return FadeOut.duration(motion.timing.quick).easing(exitEasing);
}

export default function PrototypeScreenTransition({
  children,
  style,
  animated = true,
  direction = 'fade'
}) {
  const reduceMotion = useReducedMotion();

  if (!animated || reduceMotion) {
    return <View style={[styles.container, style]}>{children}</View>;
  }

  return (
    <Animated.View
      entering={buildEnterAnimation(direction)}
      exiting={buildExitAnimation(direction)}
      style={[styles.container, style]}
    >
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1
  }
});
