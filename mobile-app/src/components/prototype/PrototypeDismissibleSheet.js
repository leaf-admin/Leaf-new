import React, { useCallback, useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import robotaxiPrototypeTokens from '../design-system/robotaxiPrototypeTokens';

const { motion } = robotaxiPrototypeTokens;
const CLOSE_DISTANCE = 116;
const CLOSE_VELOCITY = 960;
const CLOSE_TRANSLATE_Y = 640;
const OPEN_TRANSLATE_Y = 8;
const MAX_PULL_UP = 16;
const closeEasing = Easing.bezier(...motion.bezier.smoothIn);
const openEasing = Easing.bezier(...motion.bezier.smoothOut);
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export default function PrototypeDismissibleSheet({
  onClose,
  children,
  sheetStyle,
  backdropColor = 'transparent',
  bottomGapFillColor = '#FFFFFF',
  dragFromTopOnly = true,
  dragHandleZoneHeight = 88,
  dragEnabled = true,
  backdropDismissEnabled = true
}) {
  const translateY = useSharedValue(OPEN_TRANSLATE_Y);
  const backdropOpacity = useSharedValue(0);
  const surfaceOpacity = useSharedValue(0.96);
  const bottomGapHeight = React.useMemo(() => {
    const flattenedStyle = StyleSheet.flatten(sheetStyle) || {};
    const bottom = Number(flattenedStyle.bottom);
    return Number.isFinite(bottom) && bottom > 0 ? bottom : 0;
  }, [sheetStyle]);

  useEffect(() => {
    translateY.value = withSpring(0, motion.spring.sheet);
    backdropOpacity.value = withTiming(1, {
      duration: motion.timing.standard,
      easing: openEasing
    });
    surfaceOpacity.value = withTiming(1, {
      duration: motion.timing.quick,
      easing: openEasing
    });
  }, [backdropOpacity, surfaceOpacity, translateY]);

  const closeSheet = useCallback((velocityY = 0) => {
    const closeDuration = velocityY > 1450 ? motion.timing.quick : motion.timing.standard;
    backdropOpacity.value = withTiming(0, { duration: closeDuration, easing: closeEasing });
    surfaceOpacity.value = withTiming(0, { duration: closeDuration, easing: closeEasing });
    translateY.value = withTiming(CLOSE_TRANSLATE_Y, { duration: closeDuration, easing: closeEasing }, finished => {
      if (finished && onClose) {
        runOnJS(onClose)();
      }
    });
  }, [backdropOpacity, onClose, surfaceOpacity, translateY]);

  const handleBackdropPress = useCallback(() => {
    if (!backdropDismissEnabled) {
      return;
    }

    closeSheet(0);
  }, [backdropDismissEnabled, closeSheet]);

  const panGesture = Gesture.Pan()
    .onUpdate(event => {
      if (event.translationY < 0) {
        translateY.value = Math.max(event.translationY * 0.18, -MAX_PULL_UP);
        return;
      }

      translateY.value = event.translationY;
    })
    .onEnd(event => {
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
      opacity: surfaceOpacity.value,
      transform: [
        { translateY: translateY.value },
        { scale: 0.992 + surfaceOpacity.value * 0.008 }
      ]
    };
  });

  const animatedBackdropStyle = useAnimatedStyle(() => {
    return {
      opacity: backdropOpacity.value
    };
  });

  const animatedBottomFillStyle = useAnimatedStyle(() => {
    return {
      opacity: surfaceOpacity.value,
      transform: [{ translateY: translateY.value }]
    };
  });

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      <AnimatedPressable
        pointerEvents={backdropDismissEnabled ? 'auto' : 'none'}
        style={[styles.backdrop, { backgroundColor: backdropColor }, animatedBackdropStyle]}
        onPress={handleBackdropPress}
      />
      {bottomGapHeight > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.bottomGapFill,
            {
              height: bottomGapHeight,
              backgroundColor: bottomGapFillColor
            },
            animatedBottomFillStyle
          ]}
        />
      ) : null}
      <Animated.View
        style={[styles.sheetLayer, animatedSheetStyle, sheetStyle]}
      >
        {children}
        {dragEnabled
          ? dragFromTopOnly
            ? (
              <GestureDetector gesture={panGesture}>
                <View style={[styles.dragHandleZone, { height: dragHandleZoneHeight }]} />
              </GestureDetector>
            )
            : (
              <GestureDetector gesture={panGesture}>
                <View style={styles.fullSheetGestureLayer} />
              </GestureDetector>
            )
          : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 18
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1
  },
  sheetLayer: {
    zIndex: 2
  },
  bottomGapFill: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 2
  },
  dragHandleZone: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 4
  },
  fullSheetGestureLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 4
  }
});
