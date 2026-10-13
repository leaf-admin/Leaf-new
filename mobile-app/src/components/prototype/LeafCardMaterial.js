import React, { useEffect, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path } from 'react-native-svg';
import Animated, { SensorType, useAnimatedReaction, useAnimatedSensor, useAnimatedStyle, useReducedMotion, useSharedValue } from 'react-native-reanimated';

export function LeafRouteMotif({ width = 140, height = 160, opacity = 0.055, style }) {
  return <Svg width={width} height={height} viewBox="0 0 140 160" style={style} accessible={false}>
    {Array.from({ length: 9 }, (_, index) => {
      const offset = -30 + index * 15;
      return <Path key={index} d={`M 140 ${offset} C 35 ${offset}, 119 112, ${offset} 160`} stroke="#222222" strokeOpacity={opacity} strokeWidth={1.2} strokeLinecap="round" fill="none" />;
    })}
  </Svg>;
}

function Reflection({ width, height, animatedStyle }) {
  return <Animated.View style={[{ position: 'absolute', left: -(width * 0.15), top: -(height * 0.7), width: width * 1.3, height: height * 2.4 }, animatedStyle]}>
    <LinearGradient colors={['transparent', 'rgba(255,255,255,0.04)', 'rgba(255,255,255,0.55)', 'rgba(255,255,255,0.12)', 'transparent']}
      locations={[0.18, 0.34, 0.49, 0.59, 0.78]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFill} />
  </Animated.View>;
}

function SensorReflection({ width, height }) {
  const gravity = useAnimatedSensor(SensorType.GRAVITY, { interval: 33, adjustToInterfaceOrientation: true });
  const origin = useSharedValue(null);
  const tilt = useSharedValue({ x: 0, y: 0 });
  useAnimatedReaction(() => gravity.sensor.value, reading => {
    const horizontal = Math.atan2(reading.x, Math.hypot(reading.y, reading.z));
    const vertical = Math.atan2(reading.z, -reading.y);
    if (!Number.isFinite(horizontal) || !Number.isFinite(vertical) || Math.hypot(reading.x, reading.y, reading.z) < 0.1) return;
    if (origin.value === null) { origin.value = { horizontal, vertical }; return; }
    const dx = horizontal - origin.value.horizontal;
    const dy = vertical - origin.value.vertical;
    const x = Math.max(-1, Math.min(1, Math.atan2(Math.sin(dx), Math.cos(dx)) / 0.44));
    const y = Math.max(-1, Math.min(1, Math.atan2(Math.sin(dy), Math.cos(dy)) / 0.44));
    tilt.value = { x: tilt.value.x + (x - tilt.value.x) * 0.14, y: tilt.value.y + (y - tilt.value.y) * 0.14 };
  });
  const reflectionStyle = useAnimatedStyle(() => ({ transform: [
    { translateX: tilt.value.x * width * 0.32 },
    { translateY: tilt.value.y * height * 0.14 },
    { rotate: `${-26 + tilt.value.y * 9}deg` },
  ] }));
  return <Reflection width={width} height={height} animatedStyle={reflectionStyle} />;
}

// Uses the Reanimated sensor support already in Leaf. Unmounting the reflection
// unregisters its sensor. Readings only affect light, never profile data.
export default function LeafCardMaterial({ width, height, motionEnabled = false }) {
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => setActive(state === 'active'));
    return () => subscription.remove();
  }, []);
  return <View pointerEvents="none" accessible={false} style={StyleSheet.absoluteFill}>
    <LinearGradient colors={['#F2F2F2', '#D9D9D9', '#F5F5F5', '#E0E0E0', '#EDEDED']} locations={[0, 0.22, 0.46, 0.73, 1]}
      start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
    <Svg width={width} height={height} style={StyleSheet.absoluteFill} accessible={false}>
      {Array.from({ length: Math.ceil(height / 0.85) }, (_, index) => {
        const seed = Math.abs(Math.sin(index * 12.9898));
        const y = index * 0.85;
        return <Path key={index} d={`M ${-8 + seed * 15} ${y} L ${width + 8} ${y + 0.4}`}
          stroke={index % 3 === 0 ? '#FFFFFF' : '#000000'} strokeOpacity={0.026 * (0.35 + seed)} strokeWidth={0.35} />;
      })}
    </Svg>
    {motionEnabled && active && !reduceMotion ? <SensorReflection width={width} height={height} /> :
      <Reflection width={width} height={height} animatedStyle={{ transform: [{ rotate: '-26deg' }] }} />}
    <LeafRouteMotif style={{ position: 'absolute', right: -26, bottom: -22 }} />
  </View>;
}
