import React, { useEffect, useRef } from 'react';
import Svg, { Circle, Path } from 'react-native-svg';
import Reanimated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

// Line icons drawn on a 24 pt grid. A 1.75 stroke matches the stem of Figtree
// Medium/SemiBold at 15-17 pt, so icons sit at the same visual weight as the
// labels beside them; round caps/joins echo the typeface's terminals.
export const LEAF_ICON_STROKE = 1.75;

const TAB_ICONS = new Set(['home', 'activity', 'account']);

// Duas camadas: o traço e um preenchimento suave por baixo (2026-10-14: o traço puro
// ficava simples demais). Selecionado, o preenchimento ganha o verde da Leaf.
export const LEAF_ICON_FILL_IDLE = 'rgba(26,51,14,0.08)';
export const LEAF_ICON_FILL_ACTIVE = 'rgba(132,201,76,0.42)';

const PATHS = {
  bell: (c, w, f) => (
    <>
      <Path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 1.75h-15z" fill={f} />
      <Path
        d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 1.75h-15z"
        stroke={c}
        strokeWidth={w}
        strokeLinejoin="round"
        fill="none"
      />
      <Path d="M10 20.5a2.1 2.1 0 0 0 4 0" stroke={c} strokeWidth={w} strokeLinecap="round" fill="none" />
      <Path d="M9 9.2a3.2 3.2 0 0 1 2.4-2.1" stroke={c} strokeWidth={w * 0.7} strokeLinecap="round" opacity={0.45} fill="none" />
    </>
  ),
  locate: (c, w, f) => (
    <>
      <Circle cx="12" cy="12" r="6.5" fill={f} />
      <Circle cx="12" cy="12" r="6.5" stroke={c} strokeWidth={w} fill="none" />
      <Circle cx="12" cy="12" r="2.4" fill={c} />
      <Path d="M12 2.75v2.5M12 18.75v2.5M2.75 12h2.5M18.75 12h2.5" stroke={c} strokeWidth={w} strokeLinecap="round" />
    </>
  ),
  back: (c, w) => (
    <Path
      d="M19 12H5.5M11 6l-6 6 6 6"
      stroke={c}
      strokeWidth={w}
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  ),
  home: (c, w, f) => (
    <>
      <Path d="M4.25 10.25 12 4l7.75 6.25V19a1.25 1.25 0 0 1-1.25 1.25H5.5A1.25 1.25 0 0 1 4.25 19z" fill={f} />
      <Path
        d="M4.25 10.25 12 4l7.75 6.25V19a1.25 1.25 0 0 1-1.25 1.25H14.5v-5.5h-5v5.5H5.5A1.25 1.25 0 0 1 4.25 19z"
        stroke={c}
        strokeWidth={w}
        strokeLinejoin="round"
        fill="none"
      />
      <Path d="M9.5 20.25v-5.5h5v5.5z" fill={c} opacity={0.9} />
    </>
  ),
  activity: (c, w, f) => (
    <>
      <Path d="M6 3.75h12v16.5l-2.4-1.5-2.4 1.5-1.2-.75-1.2.75-2.4-1.5L6 20.25z" fill={f} />
      <Path
        d="M6 3.75h12v16.5l-2.4-1.5-2.4 1.5-1.2-.75-1.2.75-2.4-1.5L6 20.25z"
        stroke={c}
        strokeWidth={w}
        strokeLinejoin="round"
        fill="none"
      />
      <Path d="M9.25 8.5h5.5M9.25 12h5.5" stroke={c} strokeWidth={w} strokeLinecap="round" />
      <Circle cx="10" cy="15.6" r="1.25" fill={c} />
      <Path d="M12.4 15.6h2.35" stroke={c} strokeWidth={w} strokeLinecap="round" />
    </>
  ),
  account: (c, w, f) => (
    <>
      <Circle cx="12" cy="12" r="8.75" fill={f} />
      <Circle cx="12" cy="12" r="8.75" stroke={c} strokeWidth={w} fill="none" />
      <Circle cx="12" cy="10" r="3" fill={c} opacity={0.92} />
      <Path d="M6.4 18.3a6.6 6.6 0 0 1 11.2 0" stroke={c} strokeWidth={w} strokeLinecap="round" fill="none" />
    </>
  ),
  close: (c, w) => (
    <Path d="M6.5 6.5l11 11M17.5 6.5l-11 11" stroke={c} strokeWidth={w} strokeLinecap="round" fill="none" />
  ),
};

/**
 * Animations (skipped with Reduce Motion):
 * - bell: swings when `signal` grows (a new unread notification arrives).
 * - locate: the reticle settles in (scale 0.82 -> 1) on every `signal` change (a tap).
 * - home/activity/account (tabs): a springy hop when the tab becomes selected
 *   (`signal` goes from 0 to 1).
 * - back/close: none; they are navigation, not state.
 */
// Shared by the line and soft-3D icon sets so both move the same way.
export function useLeafIconMotion(name, signal) {
  const reduceMotion = useReducedMotion();
  const rotation = useSharedValue(0);
  const scale = useSharedValue(1);
  const lift = useSharedValue(0);
  // Each root tab is its own screen, so the selected tab icon mounts already
  // selected; starting tabs from 0 lets it hop in on arrival.
  const previousSignal = useRef(TAB_ICONS.has(name) ? 0 : signal);

  useEffect(() => {
    const previous = previousSignal.current;
    previousSignal.current = signal;
    if (reduceMotion || signal === previous) return;
    if (name === 'bell' && signal > previous) {
      rotation.value = withSequence(
        withTiming(14, { duration: 90, easing: Easing.out(Easing.quad) }),
        withTiming(-11, { duration: 140 }),
        withTiming(7, { duration: 120 }),
        withTiming(-4, { duration: 110 }),
        withTiming(0, { duration: 100 }),
      );
    }
    if (TAB_ICONS.has(name) && signal > previous) {
      scale.value = withSequence(withTiming(0.86, { duration: 80 }), withSpring(1, { damping: 8, stiffness: 240 }));
      lift.value = withSequence(withTiming(-3, { duration: 120 }), withSpring(0, { damping: 10, stiffness: 200 }));
    }
    if (name === 'locate') {
      scale.value = withSequence(withTiming(0.82, { duration: 90 }), withSpring(1, { damping: 9, stiffness: 260 }));
    }
  }, [lift, name, reduceMotion, rotation, scale, signal]);

  return useAnimatedStyle(() => ({
    transform: [{ translateY: lift.value }, { rotate: `${rotation.value}deg` }, { scale: scale.value }],
  }));
}

export default function LeafLineIcon({ name, size = 22, color = '#111410', strokeWidth = LEAF_ICON_STROKE, signal = 0, active = false, fill }) {
  const animatedStyle = useLeafIconMotion(name, signal);

  const draw = PATHS[name] || PATHS.close;
  return (
    <Reanimated.View style={[{ width: size, height: size }, name === 'bell' && { transformOrigin: 'top' }, animatedStyle]}>
      <Svg width={size} height={size} viewBox="0 0 24 24">
        {draw(color, strokeWidth, fill || (active ? LEAF_ICON_FILL_ACTIVE : LEAF_ICON_FILL_IDLE))}
      </Svg>
    </Reanimated.View>
  );
}
