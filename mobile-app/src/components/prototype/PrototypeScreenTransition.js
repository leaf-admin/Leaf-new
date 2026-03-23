import React from 'react';
import { StyleSheet } from 'react-native';
import Animated, { Easing, FadeIn, FadeOut } from 'react-native-reanimated';
import robotaxiPrototypeTokens from '../design-system/robotaxiPrototypeTokens';

const { motion } = robotaxiPrototypeTokens;
const enterEasing = Easing.bezier(...motion.bezier.smoothOut);
const exitEasing = Easing.bezier(...motion.bezier.smoothIn);

export default function PrototypeScreenTransition({ children, style }) {
  return (
    <Animated.View
      entering={FadeIn.duration(motion.timing.quick).easing(enterEasing)}
      exiting={FadeOut.duration(motion.timing.quick).easing(exitEasing)}
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
