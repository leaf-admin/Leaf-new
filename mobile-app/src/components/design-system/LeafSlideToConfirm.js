import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Reanimated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { leafInk, leafTouch } from './leafTypeScale';
import leafTypography from '../prototype/LeafTypography';

const KNOB_SIZE = 48;
const TRACK_PADDING = 5;
const CONFIRM_RATIO = 0.85;
// No overshoot: a bouncy return carried the knob over the button to its left.
const RELEASE_SPRING = { damping: 18, stiffness: 220, overshootClamping: true };

// Slide-to-confirm for irreversible ride actions (ending a trip): a stray tap
// can't trigger it. Screen readers confirm through the "activate" action.
export default function LeafSlideToConfirm({
  label,
  busyLabel,
  busy = false,
  disabled = false,
  onConfirm,
  testID,
  accessibilityLabel,
}) {
  const [trackWidth, setTrackWidth] = useState(0);
  // The action went through: the knob stays at the end with the busy label
  // until the screen changes (a device recording showed it springing back
  // under "Encerrando..." and past the start of the track).
  const [held, setHeld] = useState(false);
  const offset = useSharedValue(0);
  const maxOffset = Math.max(0, trackWidth - KNOB_SIZE - TRACK_PADDING * 2);
  const locked = disabled || busy || held;

  // When the action does not go through (the user backs out of a follow-up
  // question, or it fails) the knob returns, so the control is usable again
  // instead of staying parked at the end of the track. onConfirm resolving
  // `true` means it went through.
  const confirm = useCallback(() => {
    if (locked) {
      return;
    }
    const release = () => {
      offset.value = withSpring(0, RELEASE_SPRING);
    };
    Promise.resolve()
      .then(() => onConfirm?.())
      .then((outcome) => {
        if (outcome === true) {
          setHeld(true);
          return;
        }
        release();
      }, release);
  }, [locked, offset, onConfirm]);

  const pan = Gesture.Pan()
    .enabled(!locked && maxOffset > 0)
    .onUpdate((event) => {
      offset.value = Math.min(maxOffset, Math.max(0, event.translationX));
    })
    .onEnd(() => {
      if (offset.value >= maxOffset * CONFIRM_RATIO) {
        offset.value = withTiming(maxOffset, { duration: 120 });
        runOnJS(confirm)();
      } else {
        offset.value = withSpring(0, RELEASE_SPRING);
      }
    });

  const knobStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offset.value }],
  }));
  const labelStyle = useAnimatedStyle(() => ({
    opacity: maxOffset > 0 ? 1 - Math.min(1, offset.value / maxOffset) * 0.9 : 1,
  }));

  return (
    <View
      style={[styles.track, locked && styles.trackLocked]}
      onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
      testID={testID}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel || label}
      accessibilityHint="Deslize para a direita para confirmar"
      accessibilityState={{ disabled: locked, busy: busy || held }}
      accessibilityActions={[{ name: 'activate', label }]}
      onAccessibilityAction={(event) => {
        if (event?.nativeEvent?.actionName === 'activate') confirm();
      }}
    >
      <Reanimated.Text style={[styles.label, labelStyle]} numberOfLines={1}>
        {busy || held ? busyLabel || label : label}
      </Reanimated.Text>
      <GestureDetector gesture={pan}>
        <Reanimated.View style={[styles.knob, knobStyle]}>
          <Ionicons name="chevron-forward" size={22} color={leafInk.brand} />
        </Reanimated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: leafTouch.primaryHeight + 2,
    borderRadius: 20,
    backgroundColor: leafInk.brand,
    justifyContent: 'center',
    paddingHorizontal: TRACK_PADDING,
  },
  trackLocked: {
    opacity: 0.55,
  },
  label: {
    ...leafTypography.semiBold,
    position: 'absolute',
    left: KNOB_SIZE + 16,
    right: 16,
    textAlign: 'center',
    fontSize: 17,
    color: '#FFFFFF',
  },
  knob: {
    width: KNOB_SIZE,
    height: KNOB_SIZE,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
