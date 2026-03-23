import React, { useCallback } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import robotaxiPrototypeTokens from '../design-system/robotaxiPrototypeTokens';

const { motion } = robotaxiPrototypeTokens;
const CLOSE_DISTANCE = 116;
const CLOSE_VELOCITY = 960;
const CLOSE_TRANSLATE_Y = 640;
const MAX_PULL_UP = 16;
const closeEasing = Easing.bezier(...motion.bezier.smoothIn);

export default function PrototypeDismissibleSheet({
  onClose,
  children,
  sheetStyle,
  backdropColor = 'transparent',
  dragFromTopOnly = true,
  dragHandleZoneHeight = 88
}) {
  const translateY = useSharedValue(0);
  const canDrag = useSharedValue(!dragFromTopOnly);

  const closeSheet = useCallback((velocityY = 0) => {
    const closeDuration = velocityY > 1450 ? motion.timing.quick : motion.timing.standard;
    translateY.value = withTiming(CLOSE_TRANSLATE_Y, { duration: closeDuration, easing: closeEasing }, finished => {
      if (finished && onClose) {
        runOnJS(onClose)();
      }
    });
  }, [onClose, translateY]);

  const panGesture = Gesture.Pan()
    .onStart(event => {
      canDrag.value = dragFromTopOnly ? event.y <= dragHandleZoneHeight : true;
    })
    .onUpdate(event => {
      if (!canDrag.value) {
        return;
      }

      if (event.translationY < 0) {
        translateY.value = Math.max(event.translationY * 0.18, -MAX_PULL_UP);
        return;
      }

      translateY.value = event.translationY;
    })
    .onEnd(event => {
      if (!canDrag.value) {
        translateY.value = withSpring(0, motion.spring.sheet);
        return;
      }

      const shouldClose = event.translationY > CLOSE_DISTANCE || event.velocityY > CLOSE_VELOCITY;

      if (shouldClose) {
        translateY.value = withTiming(
          CLOSE_TRANSLATE_Y,
          {
            duration: event.velocityY > 1450 ? motion.timing.quick : motion.timing.standard,
            easing: closeEasing
          },
          finished => {
            if (finished && onClose) {
              runOnJS(onClose)();
            }
          }
        );
        return;
      }

      translateY.value = withSpring(0, motion.spring.sheet);
    });

  const animatedSheetStyle = useAnimatedStyle(() => {
    return {
      transform: [{ translateY: translateY.value }]
    };
  });

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      <Pressable style={[styles.backdrop, { backgroundColor: backdropColor }]} onPress={() => closeSheet(0)} />
      <GestureDetector gesture={panGesture}>
        <Animated.View style={[animatedSheetStyle, sheetStyle]}>
          {children}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 18
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject
  }
});
