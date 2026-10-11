import { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, LayoutAnimation, Platform } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

const RIDE_CARD_RESIZE = {
  duration: 260,
  update: { type: LayoutAnimation.Types.easeInEaseOut },
};
const STEP_ENTER_OFFSET = 18;

// Ride cards swap their content when the ride moves to its next step (offer,
// on the way, at pickup, in trip). A recording on Android showed the swap as a
// hard cut, so the step change is animated explicitly: the card settles in from
// slightly below (fading in on iOS). `layoutKey` covers size-only changes of the
// same step (peek/expanded), which only need the resize eased.
//
//   const cardMotion = useRideCardTransition(stepKey, layoutKey);
//   <Animated.View style={cardMotion}>…</Animated.View>
export default function useRideCardTransition(stepKey, layoutKey = '') {
  const reduceMotion = useReducedMotion();
  const progress = useRef(new Animated.Value(1)).current;
  const previousStepRef = useRef(stepKey);
  const previousLayoutRef = useRef(layoutKey);

  if (previousLayoutRef.current !== layoutKey) {
    previousLayoutRef.current = layoutKey;
    // LayoutAnimation is unreliable on Android's new renderer; iOS only.
    if (!reduceMotion && Platform.OS === 'ios' && previousStepRef.current === stepKey) {
      LayoutAnimation.configureNext(RIDE_CARD_RESIZE);
    }
  }

  useEffect(() => {
    if (previousStepRef.current === stepKey) return undefined;
    previousStepRef.current = stepKey;
    // No step means no card on screen: nothing to animate.
    if (reduceMotion || !stepKey) {
      progress.setValue(1);
      return undefined;
    }
    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: 320,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [progress, reduceMotion, stepKey]);

  return useMemo(
    () => ({
      // Android draws the card's elevation shadow as a grey box while the
      // card is translucent (seen in a recording), so it only slides there.
      ...(Platform.OS === 'ios'
        ? { opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }) }
        : null),
      transform: [
        {
          translateY: progress.interpolate({
            inputRange: [0, 1],
            outputRange: [STEP_ENTER_OFFSET, 0],
          }),
        },
      ],
    }),
    [progress],
  );
}
