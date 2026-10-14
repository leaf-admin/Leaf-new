import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useReducedMotion } from 'react-native-reanimated';
import { projectMapPoint } from '../../screens/prototype/home/projectMapPoint';
import LeafVehicleMarker from './LeafVehicleMarker';
import {
  buildStreetBands,
  carRevealDistances,
  nearestNodeIndex,
  segmentsToSvgPath,
  streetDistances,
} from './streetSearchGraph';

// Busca pelas ruas, desenhada por cima do mapa (não dentro dele: polylines no Google Maps fazem o
// mapa redesenhar). Cada faixa de distância é um SVG estático que acende com opacidade nativa:
// a frente fica forte e o que ficou para trás esmaece. Sem Skia e sem trabalho por quadro.

const BAND_COUNT = 10;
const BAND_STEP_MS = 230;
const BAND_FADE_IN_MS = 260;
const TRAIL_OPACITY = 0.32;
const WAVE_PAUSE_MS = 1600;
const STREET_COLOR = '#2E8B4A';

export default function LeafStreetSearch({
  graph,
  pickup,
  cars = [],
  region,
  width,
  height,
  maxDistanceM = 1200,
  active = true,
  repeat = true,
  onCarRevealed,
  testID = 'leaf-street-search',
}) {
  const reduceMotion = useReducedMotion();

  const prepared = useMemo(() => {
    if (!graph?.nodes?.length || !pickup || !region || !width || !height) return null;
    const start = nearestNodeIndex(graph.nodes, [pickup.latitude, pickup.longitude]).index;
    const dist = streetDistances(graph, start);
    const project = (lat, lng) => projectMapPoint(region, { latitude: lat, longitude: lng }, width, height);
    const bands = buildStreetBands({ graph, dist, maxDistanceM, bandCount: BAND_COUNT, project })
      .map(segmentsToSvgPath);
    const revealed = carRevealDistances({ graph, dist, cars })
      .filter((car) => car.revealM <= maxDistanceM)
      .map((car) => ({ ...car, point: project(car.latitude, car.longitude) }))
      .filter((car) => car.point);
    return { bands, cars: revealed };
  }, [cars, graph, height, maxDistanceM, pickup, region, width]);

  const bandOpacity = useRef(Array.from({ length: BAND_COUNT }, () => new Animated.Value(0))).current;
  const carScale = useRef(new Map()).current;
  const scaleFor = (id) => {
    if (!carScale.has(id)) carScale.set(id, new Animated.Value(0));
    return carScale.get(id);
  };

  useEffect(() => {
    if (!prepared || !active) return undefined;
    bandOpacity.forEach((value) => value.setValue(reduceMotion ? 1 : 0));
    prepared.cars.forEach((car) => scaleFor(car.id).setValue(reduceMotion ? 1 : 0));
    if (reduceMotion) return undefined;

    const waveMs = BAND_COUNT * BAND_STEP_MS;
    const wave = Animated.parallel([
      ...bandOpacity.map((value, i) => Animated.sequence([
        Animated.delay(i * BAND_STEP_MS),
        Animated.timing(value, {
          toValue: 1, duration: BAND_FADE_IN_MS, easing: Easing.out(Easing.quad), useNativeDriver: true,
        }),
        Animated.timing(value, {
          toValue: TRAIL_OPACITY, duration: BAND_STEP_MS * 2.5, easing: Easing.inOut(Easing.quad), useNativeDriver: true,
        }),
      ])),
      ...prepared.cars.map((car) => Animated.sequence([
        Animated.delay(Math.min(waveMs, (car.revealM / maxDistanceM) * waveMs)),
        Animated.spring(scaleFor(car.id), {
          toValue: 1, damping: 11, stiffness: 220, mass: 0.7, useNativeDriver: true,
        }),
      ])),
    ]);
    const fadeOut = Animated.parallel(bandOpacity.map((value) => Animated.timing(value, {
      toValue: 0, duration: 500, useNativeDriver: true,
    })));
    const cycle = repeat
      ? Animated.loop(Animated.sequence([wave, Animated.delay(WAVE_PAUSE_MS), fadeOut, Animated.delay(250)]))
      : wave;
    const revealTimers = prepared.cars.map((car) => setTimeout(
      () => onCarRevealed?.(car),
      Math.min(waveMs, (car.revealM / maxDistanceM) * waveMs),
    ));
    cycle.start();
    return () => {
      cycle.stop();
      revealTimers.forEach(clearTimeout);
    };
  }, [active, maxDistanceM, prepared, reduceMotion, repeat]);

  if (!prepared) return null;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { width, height }]} testID={testID}>
      {prepared.bands.map((d, i) => (d ? (
        <Animated.View
          key={`band-${i}`}
          style={[StyleSheet.absoluteFill, { opacity: bandOpacity[i] }]}
          renderToHardwareTextureAndroid
          shouldRasterizeIOS
        >
          <Svg width={width} height={height}>
            <Path d={d} stroke={STREET_COLOR} strokeWidth={2.4} strokeLinecap="round" fill="none" />
          </Svg>
        </Animated.View>
      ) : null))}
      {prepared.cars.map((car) => (
        <Animated.View
          key={car.id}
          style={[styles.car, {
            left: car.point.x - 21,
            top: car.point.y - 21,
            opacity: scaleFor(car.id),
            transform: [{ scale: scaleFor(car.id) }, { rotate: `${Number(car.heading) || 0}deg` }],
          }]}
        >
          <LeafVehicleMarker colorToken={car.colorToken || 'black'} screenHeading={0} />
        </Animated.View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  car: {
    position: 'absolute',
    width: 42,
    height: 42,
  },
});
