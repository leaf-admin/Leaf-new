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
// A malha é calculada uma vez por busca; os carros (que chegam a cada poucos segundos) só
// aparecem quando a onda alcança a rua deles.

const BAND_COUNT = 10;
const BAND_STEP_MS = 230;
const BAND_FADE_IN_MS = 260;
const TRAIL_OPACITY = 0.32;
const WAVE_PAUSE_MS = 1600;
const STREET_COLOR = '#2E8B4A';
const WAVE_MS = BAND_COUNT * BAND_STEP_MS;
// A faixa leva BAND_FADE_IN_MS para acender; o carro surge na metade disso.
const carRevealDelayMs = (band) => band * BAND_STEP_MS + BAND_FADE_IN_MS * 0.5;

export default function LeafStreetSearch({
  graph,
  pickup,
  cars = [],
  region,
  width,
  height,
  maxDistanceM = 4000,
  strokeWidth = 1.6,
  active = true,
  repeat = true,
  onCarRevealed,
  testID = 'leaf-street-search',
}) {
  const reduceMotion = useReducedMotion();
  const pickupLat = Number(pickup?.latitude);
  const pickupLng = Number(pickup?.longitude);

  const streets = useMemo(() => {
    if (!graph?.nodes?.length || !Number.isFinite(pickupLat) || !region || !width || !height) return null;
    const start = nearestNodeIndex(graph.nodes, [pickupLat, pickupLng]).index;
    const dist = streetDistances(graph, start);
    const project = (lat, lng) => projectMapPoint(region, { latitude: lat, longitude: lng }, width, height);
    const bands = buildStreetBands({ graph, dist, maxDistanceM, bandCount: BAND_COUNT, project })
      .map(segmentsToSvgPath);
    return { dist, bands, project };
  }, [graph, height, maxDistanceM, pickupLat, pickupLng, region, width]);

  const visibleCars = useMemo(() => {
    if (!streets) return [];
    return carRevealDistances({ graph, dist: streets.dist, cars })
      .filter((car) => car.revealM <= maxDistanceM)
      .map((car) => ({
        ...car,
        band: Math.min(BAND_COUNT - 1, Math.floor((car.revealM / maxDistanceM) * BAND_COUNT)),
        point: streets.project(car.latitude, car.longitude),
      }))
      .filter((car) => car.point);
  }, [cars, graph, maxDistanceM, streets]);

  const bandOpacity = useRef(Array.from({ length: BAND_COUNT }, () => new Animated.Value(0))).current;
  const carScales = useRef(new Map()).current;
  const shownCars = useRef(new Set()).current;
  const waveStartRef = useRef(0);
  const scaleFor = (id) => {
    if (!carScales.has(id)) carScales.set(id, new Animated.Value(reduceMotion ? 1 : 0));
    return carScales.get(id);
  };
  const revealCar = (car) => {
    if (shownCars.has(car.id)) return;
    shownCars.add(car.id);
    Animated.spring(scaleFor(car.id), {
      toValue: 1, damping: 11, stiffness: 220, mass: 0.7, useNativeDriver: true,
    }).start();
    onCarRevealed?.(car);
  };

  // A onda: acende faixa por faixa, segura, apaga e recomeça.
  useEffect(() => {
    if (!streets || !active) return undefined;
    bandOpacity.forEach((value) => value.setValue(reduceMotion ? 1 : 0));
    waveStartRef.current = Date.now();
    if (reduceMotion) return undefined;
    let stopped = false;
    let current = null;
    const runCycle = () => {
      waveStartRef.current = Date.now();
      current = Animated.sequence([
        Animated.parallel(bandOpacity.map((value, i) => Animated.sequence([
          Animated.delay(i * BAND_STEP_MS),
          Animated.timing(value, {
            toValue: 1, duration: BAND_FADE_IN_MS, easing: Easing.out(Easing.quad), useNativeDriver: true,
          }),
          Animated.timing(value, {
            toValue: TRAIL_OPACITY, duration: BAND_STEP_MS * 2.5, easing: Easing.inOut(Easing.quad), useNativeDriver: true,
          }),
        ]))),
        Animated.delay(WAVE_PAUSE_MS),
        Animated.parallel(bandOpacity.map((value) => Animated.timing(value, {
          toValue: 0, duration: 500, useNativeDriver: true,
        }))),
        Animated.delay(250),
      ]);
      current.start(({ finished }) => {
        if (finished && repeat && !stopped) runCycle();
      });
    };
    runCycle();
    return () => {
      stopped = true;
      current?.stop();
    };
  }, [active, reduceMotion, repeat, streets]);

  // Carros: cada um aparece quando a onda chega à faixa dele (ou na hora, se a onda já passou).
  useEffect(() => {
    if (!streets || !active) return undefined;
    const timers = [];
    for (const car of visibleCars) {
      if (shownCars.has(car.id)) continue;
      if (reduceMotion) {
        revealCar(car);
        continue;
      }
      const elapsed = Date.now() - waveStartRef.current;
      const wait = carRevealDelayMs(car.band) - elapsed;
      if (wait <= 0) revealCar(car);
      else timers.push(setTimeout(() => revealCar(car), wait));
    }
    return () => timers.forEach(clearTimeout);
  }, [active, reduceMotion, streets, visibleCars]);

  if (!streets) return null;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { width, height }]} testID={testID}>
      {streets.bands.map((d, i) => (d ? (
        <Animated.View
          key={`band-${i}`}
          style={[StyleSheet.absoluteFill, { opacity: bandOpacity[i] }]}
          // Android: textura de GPU para a opacidade não redesenhar o SVG a cada quadro. No iOS a
          // camada já guarda o desenho; rasterizar de novo custava ~14 MB por faixa.
          renderToHardwareTextureAndroid
        >
          <Svg width={width} height={height}>
            <Path d={d} stroke={STREET_COLOR} strokeWidth={strokeWidth} strokeLinecap="round" fill="none" />
          </Svg>
        </Animated.View>
      ) : null))}
      {visibleCars.map((car) => (
        <Animated.View
          key={car.id}
          style={[styles.car, {
            left: car.point.x - 21,
            top: car.point.y - 21,
            opacity: scaleFor(car.id),
            transform: [{ scale: scaleFor(car.id) }, { rotate: `${Number(car.heading) || 0}deg` }],
          }]}
        >
          <LeafVehicleMarker colorToken={car.colorToken || 'black'} shapeKey={car.shapeKey || ''} screenHeading={0} />
        </Animated.View>
      ))}
    </View>
  );
}

export const STREET_SEARCH_WAVE_MS = WAVE_MS;

const styles = StyleSheet.create({
  car: {
    position: 'absolute',
    width: 42,
    height: 42,
  },
});
