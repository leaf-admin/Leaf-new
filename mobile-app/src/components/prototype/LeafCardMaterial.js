import React, { useEffect, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path } from 'react-native-svg';
import Animated, {
  SensorType,
  useAnimatedReaction,
  useAnimatedSensor,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

export function LeafRouteMotif({ width = 140, height = 160, opacity = 0.055, style }) {
  return <Svg width={width} height={height} viewBox="0 0 140 160" style={style} accessible={false}>
    {Array.from({ length: 9 }, (_, index) => {
      const offset = -30 + index * 15;
      return <Path key={index} d={`M 140 ${offset} C 35 ${offset}, 119 112, ${offset} 160`} stroke="#222222" strokeOpacity={opacity} strokeWidth={1.2} strokeLinecap="round" fill="none" />;
    })}
  </Svg>;
}

// Inclinação do aparelho em -1..1 (x: lados, y: frente/trás). A primeira leitura é o
// ponto neutro, que acompanha devagar a posição em que a pessoa segura o celular.
function TiltSensor({ tilt }) {
  const gravity = useAnimatedSensor(SensorType.GRAVITY, { interval: 33, adjustToInterfaceOrientation: true });
  const origin = useSharedValue(null);
  useAnimatedReaction(() => gravity.sensor.value, reading => {
    const horizontal = Math.atan2(reading.x, Math.hypot(reading.y, reading.z));
    const vertical = Math.atan2(reading.z, -reading.y);
    if (!Number.isFinite(horizontal) || !Number.isFinite(vertical) || Math.hypot(reading.x, reading.y, reading.z) < 0.1) return;
    if (origin.value === null) { origin.value = { horizontal, vertical }; return; }
    const dx = Math.atan2(Math.sin(horizontal - origin.value.horizontal), Math.cos(horizontal - origin.value.horizontal));
    const dy = Math.atan2(Math.sin(vertical - origin.value.vertical), Math.cos(vertical - origin.value.vertical));
    origin.value = { horizontal: origin.value.horizontal + dx * 0.004, vertical: origin.value.vertical + dy * 0.004 };
    const x = Math.max(-1, Math.min(1, dx / 0.4));
    const y = Math.max(-1, Math.min(1, dy / 0.4));
    tilt.value = { x: tilt.value.x + (x - tilt.value.x) * 0.16, y: tilt.value.y + (y - tilt.value.y) * 0.16 };
  });
  useEffect(() => () => { tilt.value = withTiming({ x: 0, y: 0 }, { duration: 420 }); }, [tilt]);
  return null;
}

// Liga o sensor só com a tela em foco, o app em primeiro plano e sem "reduzir movimento".
// Desmontar o sensor o desregistra; as leituras só mexem em luz e sombra.
export function useLeafCardTilt(enabled) {
  const tilt = useSharedValue({ x: 0, y: 0 });
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => setActive(state === 'active'));
    return () => subscription.remove();
  }, []);
  const sensor = enabled && active && !reduceMotion ? <TiltSensor tilt={tilt} /> : null;
  return { tilt, sensor };
}

// Faixas iridescentes estreitas: lidas como foil, não como uma cor só.
const HOLO_COLORS = ['#FFC4E1', '#BDF4DA', '#B5DBFF', '#D8C4FF', '#FFE7A3', '#BDF4DA', '#FFC4E1', '#B5DBFF', '#D8C4FF'];

export default function LeafCardMaterial({ width, height, tilt }) {
  const holoStyle = useAnimatedStyle(() => {
    const t = tilt?.value || { x: 0, y: 0 };
    return {
      opacity: 0.3 + Math.min(1, Math.hypot(t.x, t.y)) * 0.3,
      transform: [{ translateX: -t.x * width * 0.28 }, { translateY: -t.y * height * 0.22 }],
    };
  });
  const sheenStyle = useAnimatedStyle(() => {
    const t = tilt?.value || { x: 0, y: 0 };
    return { transform: [
      { translateX: t.x * width * 0.42 },
      { translateY: t.y * height * 0.18 },
      { rotate: `${-26 + t.y * 9}deg` },
    ] };
  });
  const glintStyle = useAnimatedStyle(() => {
    const t = tilt?.value || { x: 0, y: 0 };
    return {
      opacity: 0.35 + Math.min(1, Math.abs(t.x)) * 0.5,
      transform: [{ translateX: t.x * width * 0.7 - width * 0.18 }, { rotate: '-26deg' }],
    };
  });
  return <View pointerEvents="none" accessible={false} style={StyleSheet.absoluteFill}>
    <LinearGradient colors={['#F4F4F4', '#D6D6D6', '#F7F7F7', '#DCDCDC', '#EFEFEF']} locations={[0, 0.22, 0.46, 0.73, 1]}
      start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
    <Animated.View style={[{ position: 'absolute', left: -width * 0.5, top: -height * 0.5, width: width * 2, height: height * 2 }, holoStyle]}>
      <LinearGradient colors={HOLO_COLORS} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0.55 }} style={StyleSheet.absoluteFill} />
    </Animated.View>
    <Svg width={width} height={height} style={StyleSheet.absoluteFill} accessible={false}>
      {Array.from({ length: Math.ceil(height / 0.85) }, (_, index) => {
        const seed = Math.abs(Math.sin(index * 12.9898));
        const y = index * 0.85;
        return <Path key={index} d={`M ${-8 + seed * 15} ${y} L ${width + 8} ${y + 0.4}`}
          stroke={index % 3 === 0 ? '#FFFFFF' : '#000000'} strokeOpacity={0.03 * (0.35 + seed)} strokeWidth={0.35} />;
      })}
    </Svg>
    <Animated.View style={[{ position: 'absolute', left: -(width * 0.15), top: -(height * 0.7), width: width * 1.3, height: height * 2.4 }, sheenStyle]}>
      <LinearGradient colors={['transparent', 'rgba(255,255,255,0.05)', 'rgba(255,255,255,0.7)', 'rgba(255,255,255,0.14)', 'transparent']}
        locations={[0.18, 0.34, 0.49, 0.59, 0.78]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} />
    </Animated.View>
    <Animated.View style={[{ position: 'absolute', left: width * 0.4, top: -height * 0.6, width: width * 0.12, height: height * 2.2 }, glintStyle]}>
      <LinearGradient colors={['transparent', 'rgba(255,255,255,0.85)', 'transparent']} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} />
    </Animated.View>
    <LeafRouteMotif style={{ position: 'absolute', right: -26, bottom: -22 }} />
  </View>;
}
