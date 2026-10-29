import React, { forwardRef, useCallback, useRef } from 'react';
import { Animated, Pressable, StyleSheet } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { LEAF_MOTION_DURATION, LEAF_MOTION_EASING, LEAF_PRESS } from './leafMotion';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// Toque calmo (motion nível 1) para os botões que eram TouchableOpacity: cede um pouco
// sob o dedo e volta sem quicar, o mesmo toque dos botões dos cards.
// Mesma API do TouchableOpacity; activeOpacity é aceito e ignorado.
const LeafTouchable = forwardRef(function LeafTouchable(
  { activeOpacity: _activeOpacity, disabled, onPressIn, onPressOut, style, children, ...rest },
  ref,
) {
  const reduceMotion = useReducedMotion();
  const pressProgress = useRef(new Animated.Value(0)).current;
  const animatePress = useCallback((toValue) => {
    Animated.timing(pressProgress, {
      toValue,
      duration: LEAF_MOTION_DURATION.tap,
      easing: LEAF_MOTION_EASING,
      useNativeDriver: true,
    }).start();
  }, [pressProgress]);
  const handlePressIn = useCallback((event) => {
    animatePress(1);
    onPressIn?.(event);
  }, [animatePress, onPressIn]);
  const handlePressOut = useCallback((event) => {
    animatePress(0);
    onPressOut?.(event);
  }, [animatePress, onPressOut]);
  // A button that already has its own transform (a rotated chevron) keeps it: only the opacity gives.
  // Like TouchableOpacity, the press dims from the button's own opacity, not from 1.
  const flatStyle = StyleSheet.flatten(style) || {};
  const ownsTransform = Boolean(flatStyle.transform);
  const baseOpacity = Number.isFinite(flatStyle.opacity) ? flatStyle.opacity : 1;
  const pressStyle = disabled ? null : {
    opacity: pressProgress.interpolate({ inputRange: [0, 1], outputRange: [baseOpacity, baseOpacity * LEAF_PRESS.opacity] }),
    ...(reduceMotion || ownsTransform
      ? {}
      : { transform: [{ scale: pressProgress.interpolate({ inputRange: [0, 1], outputRange: [1, LEAF_PRESS.scale] }) }] }),
  };

  return (
    <AnimatedPressable
      ref={ref}
      disabled={disabled}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      style={[style, pressStyle]}
      {...rest}
    >
      {children}
    </AnimatedPressable>
  );
});

export default LeafTouchable;
