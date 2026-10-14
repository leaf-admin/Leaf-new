import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, TurboModuleRegistry, useWindowDimensions, View } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import Reanimated, {
  Easing,
  FadeInDown,
  ZoomIn,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import Svg, { Path as SvgPath, SvgXml } from 'react-native-svg';
import LeafVehicleMarker from '../../../components/prototype/LeafVehicleMarker';
import { VEHICLE_CONCEPTS } from './labVehicleConcepts';
import mapStyleAppleLike from '../../../components/prototype/mapStyleAppleLike';
import leafTypography from '../../../components/prototype/LeafTypography';

// Development-only motion lab: the approved micro-interaction concept played on
// the real map, fonts and haptics with sample data. No backend, no ride.
// Nothing here is used by the real ride flow; approved pieces get ported.

let SkiaLib = null;
try {
  if (TurboModuleRegistry.get?.('RNSkiaModule')) {
    SkiaLib = require('@shopify/react-native-skia');
  }
} catch (_error) {
  SkiaLib = null;
}

const LOGO = require('../../../../assets/images/splash_android_icon.png');
const BRAND = '#1A330E';
const ROUTE_COLOR = '#2B5B21';
const COMET_GLOW = 'rgba(95,195,126,0.42)';
const COMET_CORE = '#EAF8EE';

const PICKUP = { latitude: -22.9208, longitude: -43.40605 };
const DESTINATION = { latitude: -22.9848, longitude: -43.365 };
const TRIP_ROUTE = densify([
  PICKUP,
  { latitude: -22.9233, longitude: -43.4041 },
  { latitude: -22.9282, longitude: -43.399 },
  { latitude: -22.9342, longitude: -43.3912 },
  { latitude: -22.943, longitude: -43.3801 },
  { latitude: -22.9515, longitude: -43.3732 },
  { latitude: -22.959, longitude: -43.3685 },
  { latitude: -22.967, longitude: -43.3655 },
  { latitude: -22.9745, longitude: -43.3645 },
  { latitude: -22.98, longitude: -43.3642 },
  DESTINATION,
], 22);
const DRIVER_START = { latitude: -22.9136, longitude: -43.4121 };
const DRIVER_ROUTE = densify([
  DRIVER_START,
  { latitude: -22.9161, longitude: -43.4099 },
  { latitude: -22.9186, longitude: -43.4081 },
  PICKUP,
], 30);
const CATEGORIES = [
  { id: 'plus', label: 'PLUS', detail: 'Confortável e acessível', price: 48.52, arrival: '10:37', cars: [[0.004, -0.006], [-0.005, 0.004], [0.007, 0.006], [-0.003, -0.007], [0.002, 0.009]] },
  { id: 'elite', label: 'ELITE', detail: 'Mais conforto para sua viagem', price: 67.6, arrival: '10:41', cars: [[0.008, -0.003], [-0.007, 0.007]] },
  { id: 'moto', label: 'MOTO', detail: 'Mais rápido para ir sozinho', price: 32.05, arrival: '10:34', cars: [[0.002, -0.003], [-0.003, 0.002], [0.004, 0.004], [-0.004, -0.003], [0.001, 0.005], [0.005, -0.001]] },
];
const ROW_HEIGHT = 58;
// Cars around the region, seen faintly behind the search veil.
const REGION_CARS = [
  [0.031, -0.024, 40, 'white'], [-0.036, 0.019, 200, 'black'], [0.044, 0.021, 120, 'silver'],
  [-0.022, -0.028, 300, 'gray'], [0.012, 0.03, 80, 'white'], [-0.041, -0.012, 170, 'black'],
  [0.024, -0.031, 260, 'silver'], [-0.009, 0.027, 15, 'red'], [0.05, -0.006, 330, 'white'],
  [-0.03, 0.03, 95, 'gray'], [0.004, -0.029, 210, 'black'], [-0.05, 0.004, 60, 'white'],
];
const CAR_COLORS = ['white', 'black', 'silver', 'gray', 'white', 'black'];
const SPHERE_SIZE = 300;
const SPLASH_GREEN = '#003002';

function densify(points, perSegment) {
  const out = [points[0]];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    for (let k = 1; k <= perSegment; k += 1) {
      const t = k / perSegment;
      out.push({ latitude: a.latitude + (b.latitude - a.latitude) * t, longitude: a.longitude + (b.longitude - a.longitude) * t });
    }
  }
  return out;
}
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const brl = (v) => `R$ ${v.toFixed(2).replace('.', ',')}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// JS-driven tween (map polylines must be updated from JS anyway).
function runTween(ms, onFrame, easing = easeInOut, reduceMotion = false) {
  return new Promise((resolve) => {
    if (reduceMotion) { onFrame(1); resolve(); return; }
    const start = Date.now();
    const step = () => {
      const t = Math.min(1, (Date.now() - start) / ms);
      onFrame(easing(t));
      if (t < 1) requestAnimationFrame(step); else resolve();
    };
    requestAnimationFrame(step);
  });
}

/* ---------------- Leaf network sphere (Skia) ---------------- */
const SPHERE_POINTS = (() => {
  const n = 120;
  const pts = [];
  for (let i = 0; i < n; i += 1) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const th = i * 2.399963;
    pts.push([Math.cos(th) * r, y, Math.sin(th) * r]);
  }
  return pts;
})();
const SPHERE_PAIRS = (() => {
  const pairs = [];
  for (let i = 0; i < SPHERE_POINTS.length; i += 1) {
    for (let j = i + 1; j < SPHERE_POINTS.length; j += 1) {
      const a = SPHERE_POINTS[i];
      const b = SPHERE_POINTS[j];
      if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 0.34) pairs.push([i, j]);
    }
  }
  return pairs;
})();
const LIT_ORDER = [3, 47, 88, 21, 66, 109, 35, 74];

function LeafNetworkSphere({ size, radius, opacity, collapse, litCount, reduceMotion }) {
  if (!SkiaLib) return null;
  const { Canvas, Path, Skia, BlurMask, useClock } = SkiaLib;
  return (
    <SphereCanvas
      Canvas={Canvas}
      Path={Path}
      Skia={Skia}
      BlurMask={BlurMask}
      useClock={useClock}
      size={size}
      radius={radius}
      opacity={opacity}
      collapse={collapse}
      litCount={litCount}
      reduceMotion={reduceMotion}
    />
  );
}

function SphereCanvas({ Canvas, Path, Skia, BlurMask, useClock, size, radius, opacity, collapse, litCount, reduceMotion }) {
  const clock = useClock();
  const points = SPHERE_POINTS;
  const pairs = SPHERE_PAIRS;
  const litOrder = LIT_ORDER;
  const project = (now) => {
    'worklet';
    const rot = reduceMotion ? 0.6 : now * 0.00035;
    const tilt = 0.38;
    const ct = Math.cos(tilt); const st = Math.sin(tilt); const cr = Math.cos(rot); const sr = Math.sin(rot);
    const R = radius.value * (1 - collapse.value * 0.92);
    const c = size / 2;
    const out = [];
    for (let i = 0; i < points.length; i += 1) {
      const [x, y, z] = points[i];
      const x1 = x * cr + z * sr; const z1 = -x * sr + z * cr;
      const y2 = y * ct - z1 * st; const z2 = y * st + z1 * ct;
      out.push([c + x1 * R, c + y2 * R, z2]);
    }
    return out;
  };
  const frontLines = useDerivedValue(() => {
    const proj = project(clock.value); const p = Skia.Path.Make();
    for (let k = 0; k < pairs.length; k += 1) { const a = proj[pairs[k][0]]; const b = proj[pairs[k][1]]; if (a[2] + b[2] > 0) { p.moveTo(a[0], a[1]); p.lineTo(b[0], b[1]); } }
    return p;
  });
  const backLines = useDerivedValue(() => {
    const proj = project(clock.value); const p = Skia.Path.Make();
    for (let k = 0; k < pairs.length; k += 1) { const a = proj[pairs[k][0]]; const b = proj[pairs[k][1]]; if (a[2] + b[2] <= 0) { p.moveTo(a[0], a[1]); p.lineTo(b[0], b[1]); } }
    return p;
  });
  const dots = useDerivedValue(() => {
    const proj = project(clock.value); const p = Skia.Path.Make();
    for (let i = 0; i < proj.length; i += 1) { const d = (proj[i][2] + 1) / 2; p.addCircle(proj[i][0], proj[i][1], 0.8 + 1.4 * d); }
    return p;
  });
  const lit = useDerivedValue(() => {
    const proj = project(clock.value); const p = Skia.Path.Make();
    const n = Math.min(litOrder.length, Math.floor(litCount.value));
    for (let k = 0; k < n; k += 1) { const q = proj[litOrder[k]]; p.addCircle(q[0], q[1], 3); }
    return p;
  });
  const litGlow = useDerivedValue(() => {
    const proj = project(clock.value); const p = Skia.Path.Make();
    const n = Math.min(litOrder.length, Math.floor(litCount.value));
    const pulse = reduceMotion ? 1 : 0.8 + 0.2 * Math.sin(clock.value / 260);
    for (let k = 0; k < n; k += 1) { const q = proj[litOrder[k]]; p.addCircle(q[0], q[1], 9 * pulse); }
    return p;
  });
  const groupOpacity = useDerivedValue(() => opacity.value);
  return (
    <Canvas style={{ width: size, height: size }} pointerEvents="none">
      <Path path={backLines} style="stroke" strokeWidth={0.8} color="rgba(26,51,14,0.10)" opacity={groupOpacity} />
      <Path path={frontLines} style="stroke" strokeWidth={0.9} color="rgba(26,51,14,0.28)" opacity={groupOpacity} />
      <Path path={dots} color="rgba(17,20,16,0.55)" opacity={groupOpacity} />
      <Path path={litGlow} color="rgba(46,139,74,0.45)" opacity={groupOpacity}>
        <BlurMask blur={6} style="normal" />
      </Path>
      <Path path={lit} color="#2E8B4A" opacity={groupOpacity} />
    </Canvas>
  );
}

/* ---------------- splash reveal (Skia) ---------------- */
// The current splash stays as is. On exit the map rises from the bottom
// through a convex edge (a big circle) that swallows the splash and its logo.
function SplashReveal({ progress, width, height }) {
  if (!SkiaLib) return null;
  return <SplashRevealCanvas lib={SkiaLib} progress={progress} width={width} height={height} />;
}

function SplashRevealCanvas({ lib, progress, width, height }) {
  const { Canvas, Group, Rect, Image: SkImage, Skia, useImage, FillType } = lib;
  const logo = useImage(LOGO);
  const radius = Math.max(width * 1.3, height * 0.62);
  const evenOdd = FillType.EvenOdd;
  const clip = useDerivedValue(() => {
    // Top of the circle travels from below the screen to above it; at the end
    // the circle covers every corner, so nothing of the splash is left.
    const edge = height + 6 - progress.value * height * 1.2;
    const p = Skia.Path.Make();
    p.addRect(Skia.XYWHRect(0, 0, width, height));
    p.addCircle(width / 2, edge + radius, radius);
    p.setFillType(evenOdd);
    return p;
  });
  return (
    <Canvas style={{ width, height }} pointerEvents="none">
      <Group clip={clip}>
        <Rect x={0} y={0} width={width} height={height} color={SPLASH_GREEN} />
        {logo ? <SkImage image={logo} x={(width - 288) / 2} y={(height - 288) / 2} width={288} height={288} fit="contain" /> : null}
      </Group>
    </Canvas>
  );
}

/* ---------------- small icons ---------------- */
function Bolt({ size = 12, color = '#F5C400' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <SvgPath d="M13.5 2L4 13.5h6.5L9.5 22 20 9.5h-6.6L13.5 2z" fill={color} />
    </Svg>
  );
}

function Shield({ size = 14, color = BRAND }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <SvgPath d="M12 2l8 3v6c0 5-3.4 9.4-8 11-4.6-1.6-8-6-8-11V5l8-3z" fill={color} />
      <SvgPath d="M8.5 12.2l2.4 2.4 4.6-4.8" fill="none" stroke="#FFFFFF" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function ConceptCar({ concept, color, size = 42 }) {
  const entry = VEHICLE_CONCEPTS.find((c) => c.key === concept);
  const xml = useMemo(() => (entry ? entry.build({ colorToken: color, id: `${concept}-${color}` }) : null), [color, concept, entry]);
  if (!xml) return <LeafVehicleMarker colorToken={color} screenHeading={0} />;
  return <SvgXml xml={xml} width={size} height={size} />;
}

function MapCar({ coordinate, heading, color, visible, settled, concept }) {
  return (
    <Marker coordinate={coordinate} anchor={{ x: 0.5, y: 0.5 }} flat rotation={heading} opacity={visible ? 1 : 0} tracksViewChanges={!settled}>
      <ConceptCar concept={concept} color={color} />
    </Marker>
  );
}

/* ---------------- rolling price ---------------- */
// Price rolls up to its value whenever a quote arrives (rollKey changes).
function RollingPrice({ value, rollKey, style, reduceMotion }) {
  const [shown, setShown] = useState(value);
  useEffect(() => {
    const from = value * 0.82;
    let cancelled = false;
    runTween(520, (t) => { if (!cancelled) setShown(from + (value - from) * t); }, (t) => 1 - Math.pow(1 - t, 3), reduceMotion);
    return () => { cancelled = true; };
  }, [value, rollKey, reduceMotion]);
  return <Text style={style}>{brl(shown)}</Text>;
}

/* ---------------- lab screen ---------------- */
export default function LeafMotionLab({ navigation }) {
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const mapRef = useRef(null);
  const runRef = useRef(0);
  const [routeCount, setRouteCount] = useState(0);
  const [routeDrawing, setRouteDrawing] = useState(false);
  const [showOrigin, setShowOrigin] = useState(false);
  const [showDestination, setShowDestination] = useState(false);
  const [driverCount, setDriverCount] = useState(0);
  const [driverVisible, setDriverVisible] = useState(false);
  const [category, setCategory] = useState('plus');
  const [carsVisible, setCarsVisible] = useState(false);
  const [rollKey, setRollKey] = useState(0);
  const [status, setStatus] = useState('Procurando motoristas por perto');
  const [elapsed, setElapsed] = useState(0);
  const [eta, setEta] = useState(4);
  const [active, setActive] = useState('');
  const [regionCarsVisible, setRegionCarsVisible] = useState(false);
  const [markersSettled, setMarkersSettled] = useState(false);
  const [splashOn, setSplashOn] = useState(false);
  const [foundKey, setFoundKey] = useState(0);
  const [vehicleConcept, setVehicleConcept] = useState('current');
  const [carsPickerOn, setCarsPickerOn] = useState(false);
  const [foundIn, setFoundIn] = useState(0);
  const elapsedRef = useRef(0);

  const catCardY = useSharedValue(520);
  const searchCardY = useSharedValue(520);
  const foundCardY = useSharedValue(520);
  const veil = useSharedValue(0);
  const sphereRadius = useSharedValue(10);
  const sphereOpacity = useSharedValue(0);
  const sphereCollapse = useSharedValue(0);
  const litCount = useSharedValue(0);
  const barY = useSharedValue(0);
  const splashProgress = useSharedValue(0);
  const splashFade = useSharedValue(1);

  const catStyle = useAnimatedStyle(() => ({ transform: [{ translateY: catCardY.value }] }));
  const searchStyle = useAnimatedStyle(() => ({ transform: [{ translateY: searchCardY.value }] }));
  const foundStyle = useAnimatedStyle(() => ({ transform: [{ translateY: foundCardY.value }] }));
  const veilStyle = useAnimatedStyle(() => ({ opacity: veil.value }));
  const barStyle = useAnimatedStyle(() => ({ transform: [{ translateY: barY.value }] }));
  // Without Skia the splash simply fades.
  const splashFallbackStyle = useAnimatedStyle(() => ({ opacity: splashFade.value }));

  // Firm spring: settles without a visible bounce (cards are big surfaces).
  const spring = { damping: 26, stiffness: 220, overshootClamping: true };
  const slideIn = (sv) => { sv.value = reduceMotion ? 0 : withSpring(0, spring); };
  const slideOut = (sv) => { sv.value = reduceMotion ? 520 : withTiming(520, { duration: 320, easing: Easing.in(Easing.cubic) }); };

  const fit = useCallback((coords, bottom, animated = true) => {
    mapRef.current?.fitToCoordinates(coords, { edgePadding: { top: insets.top + 110, right: 48, bottom, left: 48 }, animated });
  }, [insets.top]);

  const resetAll = useCallback(() => {
    runRef.current += 1;
    setRouteCount(0); setRouteDrawing(false); setShowOrigin(false); setShowDestination(false);
    setDriverCount(0); setDriverVisible(false); setCarsVisible(false); setCategory('plus');
    setElapsed(0); elapsedRef.current = 0; setEta(3); setStatus('Procurando motoristas por perto');
    setRegionCarsVisible(false); setSplashOn(false); setFoundIn(0); setCarsPickerOn(false);
    catCardY.value = 520; searchCardY.value = 520; foundCardY.value = 520; veil.value = 0;
    sphereOpacity.value = 0; sphereCollapse.value = 0; litCount.value = 0; barY.value = 0;
    splashProgress.value = 0; splashFade.value = 1;
    return runRef.current;
  }, [barY, catCardY, foundCardY, litCount, searchCardY, sphereCollapse, sphereOpacity, splashFade, splashProgress, veil]);

  const alive = (id) => id === runRef.current;

  /* scene: opening exit (current splash stays; only its exit animates) */
  const sceneOpening = useCallback(async (id) => {
    splashProgress.value = 0; splashFade.value = 1; setSplashOn(true);
    mapRef.current?.animateToRegion({ ...PICKUP, latitudeDelta: 0.03, longitudeDelta: 0.03 }, 0);
    await sleep(900); if (!alive(id)) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    // Slow start (the bump appears), fast middle, soft landing: like the reference.
    const rise = { duration: 760, easing: Easing.bezier(0.55, 0, 0.2, 1) };
    splashProgress.value = reduceMotion ? 1 : withTiming(1, rise);
    splashFade.value = withTiming(0, { duration: 500 });
    mapRef.current?.animateToRegion({ ...PICKUP, latitudeDelta: 0.012, longitudeDelta: 0.012 }, 1500);
    await sleep(820); if (!alive(id)) return;
    setSplashOn(false);
  }, [reduceMotion, splashFade, splashProgress]);

  /* scene: route traced point to point */
  const sceneRoute = useCallback(async (id) => {
    setRouteCount(0); setShowDestination(false); setCarsVisible(false);
    fit(TRIP_ROUTE, 380 + insets.bottom);
    await sleep(700); if (!alive(id)) return;
    setShowOrigin(true);
    Haptics.selectionAsync().catch(() => {});
    await sleep(220); if (!alive(id)) return;
    setRouteDrawing(true);
    await runTween(1200, (t) => { if (alive(id)) setRouteCount(Math.max(2, Math.round(t * TRIP_ROUTE.length))); }, easeInOut, reduceMotion);
    if (!alive(id)) return;
    setRouteDrawing(false); setShowDestination(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }, [fit, insets.bottom, reduceMotion]);

  /* scene: current price card with micro-interactions */
  const selectCategory = useCallback((id, fromUser) => {
    const index = CATEGORIES.findIndex((c) => c.id === id);
    setCategory(id);
    // Glides, no bounce: the bar is a small accent, not a toy.
    barY.value = reduceMotion ? index * ROW_HEIGHT : withTiming(index * ROW_HEIGHT, { duration: 220, easing: Easing.out(Easing.cubic) });
    if (fromUser) Haptics.selectionAsync().catch(() => {});
    setCarsVisible(false);
    setTimeout(() => setCarsVisible(true), 180);
  }, [barY, reduceMotion]);

  const sceneCategory = useCallback(async (id) => {
    if (routeCount < TRIP_ROUTE.length) { setShowOrigin(true); setShowDestination(true); setRouteCount(TRIP_ROUTE.length); fit(TRIP_ROUTE, 380 + insets.bottom, false); }
    slideIn(catCardY); setRollKey((k) => k + 1);
    await sleep(420); if (!alive(id)) return;
    setCarsVisible(true);
    await sleep(1100); if (!alive(id)) return;
    selectCategory('moto', true);
    await sleep(1400); if (!alive(id)) return;
    selectCategory('plus', true);
  }, [catCardY, fit, insets.bottom, routeCount, selectCategory]);

  /* scene: search with the Leaf network */
  const sceneSearch = useCallback(async (id) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    slideOut(catCardY);
    setCarsVisible(false);
    // The trip line would cross the sphere: fade it out with the map.
    setShowDestination(false);
    runTween(420, (t) => { if (alive(id)) setRouteCount(Math.round((1 - t) * TRIP_ROUTE.length)); }, easeInOut, reduceMotion);
    // Pull back to the neighbourhood: the region's cars stay faintly visible.
    mapRef.current?.animateToRegion({ ...PICKUP, latitudeDelta: 0.07, longitudeDelta: 0.07 }, 900);
    veil.value = withTiming(0.8, { duration: 500 });
    setTimeout(() => { if (alive(id)) setRegionCarsVisible(true); }, 350);
    await sleep(240); if (!alive(id)) return;
    slideIn(searchCardY);
    sphereCollapse.value = 0; sphereRadius.value = 12;
    sphereOpacity.value = withTiming(1, { duration: 500 });
    sphereRadius.value = reduceMotion ? 120 : withSpring(120, { damping: 12, stiffness: 90 });
    const start = Date.now();
    const timer = setInterval(() => {
      if (!alive(id)) { clearInterval(timer); return; }
      elapsedRef.current = Math.floor((Date.now() - start) / 1000);
      setElapsed(elapsedRef.current);
    }, 250);
    const messages = ['Procurando motoristas por perto', '5 motoristas Plus a até 6 min', 'Falando com o mais próximo'];
    for (let k = 0; k < messages.length; k += 1) {
      setStatus(messages[k]);
      for (let j = 0; j < 2; j += 1) { litCount.value += 1; await sleep(480); }
      await sleep(320); if (!alive(id)) { clearInterval(timer); return; }
    }
    clearInterval(timer);
  }, [catCardY, litCount, reduceMotion, searchCardY, sphereCollapse, sphereOpacity, sphereRadius, veil]);


  /* scene: driver found -> sphere converges, driver card takes over */
  const sceneFound = useCallback(async (id) => {
    if (sphereOpacity.value < 0.5) {
      veil.value = 0.8; slideIn(searchCardY); sphereOpacity.value = 1; sphereRadius.value = 120; litCount.value = 6;
      elapsedRef.current = 12; setElapsed(12); setRegionCarsVisible(true);
      mapRef.current?.animateToRegion({ ...PICKUP, latitudeDelta: 0.07, longitudeDelta: 0.07 }, 0);
      await sleep(700); if (!alive(id)) return;
    }
    setFoundIn(Math.max(1, elapsedRef.current));
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    litCount.value = 8;
    sphereCollapse.value = withTiming(1, { duration: 480, easing: Easing.in(Easing.quad) });
    sphereOpacity.value = withTiming(0, { duration: 520 });
    await sleep(260); if (!alive(id)) return;
    slideOut(searchCardY);
    setRegionCarsVisible(false);
    await sleep(240); if (!alive(id)) return;
    setEta(3); setFoundKey((k) => k + 1);
    slideIn(foundCardY);
    veil.value = withTiming(0, { duration: 450 });
    setRouteCount(0); setShowDestination(false);
    fit([...DRIVER_ROUTE, PICKUP], 430 + insets.bottom);
    await sleep(650); if (!alive(id)) return;
    setDriverVisible(true); setShowOrigin(true);
    await runTween(1100, (t) => { if (alive(id)) setDriverCount(Math.max(2, Math.round(t * DRIVER_ROUTE.length))); }, easeInOut, reduceMotion);
    for (let e = 2; e >= 1; e -= 1) { await sleep(260); if (!alive(id)) return; setEta(e); }
    Haptics.selectionAsync().catch(() => {});
  }, [fit, foundCardY, insets.bottom, litCount, reduceMotion, searchCardY, sphereCollapse, sphereOpacity, sphereRadius, veil]);

  /* scene: vehicle marker concepts on the real map */
  const chooseConcept = useCallback((key) => {
    setVehicleConcept(key);
    // SVG markers must re-render natively before tracking is switched off again.
    setMarkersSettled(false);
    setTimeout(() => setMarkersSettled(true), 900);
    Haptics.selectionAsync().catch(() => {});
  }, []);
  const sceneCars = useCallback(async (id) => {
    setRouteCount(0); setShowDestination(false); setShowOrigin(true); setDriverVisible(false);
    setCategory('plus'); setCarsVisible(true); setRegionCarsVisible(false); setCarsPickerOn(true);
    mapRef.current?.animateToRegion({ latitude: PICKUP.latitude - 0.0035, longitude: PICKUP.longitude, latitudeDelta: 0.026, longitudeDelta: 0.026 }, 700);
    setMarkersSettled(false);
    await sleep(900); if (!alive(id)) return;
    setMarkersSettled(true);
  }, []);

  const scenes = useMemo(() => [
    { key: 'opening', label: 'Abertura', run: sceneOpening },
    { key: 'route', label: 'Rota', run: sceneRoute },
    { key: 'category', label: 'Categoria', run: sceneCategory },
    { key: 'search', label: 'Busca', run: sceneSearch },
    { key: 'found', label: 'Encontrou', run: sceneFound },
    { key: 'cars', label: 'Carros', run: sceneCars, solo: true },
  ], [sceneCars, sceneCategory, sceneFound, sceneOpening, sceneRoute, sceneSearch]);

  const playOne = async (scene) => {
    const id = scene.key === 'opening' || scene.key === 'route' || scene.solo ? resetAll() : ++runRef.current;
    setActive(scene.key);
    await scene.run(id);
  };
  const playAll = async () => {
    const id = resetAll();
    for (const scene of scenes.filter((item) => !item.solo)) { if (!alive(id)) return; setActive(scene.key); await scene.run(id); await sleep(700); }
  };

  useEffect(() => { fit([PICKUP], 300, false); }, [fit]);
  // SVG markers need a few frames to draw before tracking can be switched off.
  useEffect(() => { const t = setTimeout(() => setMarkersSettled(true), 1200); return () => clearTimeout(t); }, []);

  const selected = CATEGORIES.find((c) => c.id === category) || CATEGORIES[0];
  const categoryName = selected.label.charAt(0) + selected.label.slice(1).toLowerCase();
  const quickPickup = eta < 2;
  const fastMatch = foundIn > 0 && foundIn < 30;
  const comet = routeDrawing && routeCount > 4 ? TRIP_ROUTE.slice(Math.max(0, routeCount - 14), routeCount) : null;
  const cometCore = routeDrawing && routeCount > 3 ? TRIP_ROUTE.slice(Math.max(0, routeCount - 4), routeCount) : null;

  return (
    <View style={styles.root} testID="leaf-motion-lab">
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        provider={PROVIDER_GOOGLE}
        customMapStyle={mapStyleAppleLike}
        initialRegion={{ ...PICKUP, latitudeDelta: 0.03, longitudeDelta: 0.03 }}
        showsUserLocation={false}
        toolbarEnabled={false}
        pitchEnabled={false}
      >
        {routeCount >= 2 ? (
          <>
            <Polyline coordinates={TRIP_ROUTE.slice(0, routeCount)} strokeColor="#FFFFFF" strokeColors={["#FFFFFF", "#FFFFFF"]} strokeWidth={8} lineCap="round" lineJoin="round" />
            <Polyline coordinates={TRIP_ROUTE.slice(0, routeCount)} strokeColor={ROUTE_COLOR} strokeColors={[ROUTE_COLOR, ROUTE_COLOR]} strokeWidth={4.5} lineCap="round" lineJoin="round" />
          </>
        ) : null}
        {comet ? <Polyline coordinates={comet} strokeColor={COMET_GLOW} strokeColors={[COMET_GLOW, COMET_GLOW]} strokeWidth={13} lineCap="round" lineJoin="round" /> : null}
        {cometCore ? <Polyline coordinates={cometCore} strokeColor={COMET_CORE} strokeColors={[COMET_CORE, COMET_CORE]} strokeWidth={5} lineCap="round" lineJoin="round" /> : null}
        {driverCount >= 2 ? (
          <Polyline coordinates={DRIVER_ROUTE.slice(0, driverCount)} strokeColor="#2E8B4A" strokeColors={["#2E8B4A", "#2E8B4A"]} strokeWidth={4.5} lineCap="round" lineJoin="round" />
        ) : null}
        <Marker coordinate={PICKUP} anchor={{ x: 0.5, y: 0.5 }} opacity={showOrigin ? 1 : 0} tracksViewChanges={false}>
          <View style={styles.originOuter}><View style={styles.originInner} /></View>
        </Marker>
        <Marker coordinate={DESTINATION} anchor={{ x: 0.5, y: 0.5 }} opacity={showDestination ? 1 : 0} tracksViewChanges={false}>
          <View style={styles.destOuter}><View style={styles.destInner} /></View>
        </Marker>
        <MapCar coordinate={DRIVER_START} heading={140} color="white" visible={driverVisible} settled={markersSettled} concept={vehicleConcept} />
        {CATEGORIES.map((c) => c.cars.map(([dLat, dLng], i) => (
          <MapCar
            key={`${c.id}-${i}`}
            coordinate={{ latitude: PICKUP.latitude + dLat, longitude: PICKUP.longitude + dLng }}
            heading={(i * 67 + 25) % 360}
            color={CAR_COLORS[i % CAR_COLORS.length]}
            visible={carsVisible && c.id === category}
            settled={markersSettled} concept={vehicleConcept}
          />
        )))}
        {REGION_CARS.map(([dLat, dLng, heading, color], i) => (
          <MapCar
            key={`region-${i}`}
            coordinate={{ latitude: PICKUP.latitude + dLat, longitude: PICKUP.longitude + dLng }}
            heading={heading}
            color={color}
            visible={regionCarsVisible}
            settled={markersSettled} concept={vehicleConcept}
          />
        ))}
      </MapView>

      <Reanimated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.veil, veilStyle]} />

      <View pointerEvents="none" style={[styles.sphereWrap, { top: (screenHeight - SPHERE_SIZE) / 2 }]}>
        <LeafNetworkSphere size={SPHERE_SIZE} radius={sphereRadius} opacity={sphereOpacity} collapse={sphereCollapse} litCount={litCount} reduceMotion={reduceMotion} />
      </View>

      {/* current price card structure */}
      <Reanimated.View style={[styles.card, { bottom: insets.bottom + 12 }, catStyle]}>
        <View style={styles.routePair}>
          <View style={styles.routeRow}><View style={styles.dot} /><Text style={styles.routeText}>R. das Pastorinhas, 4 - Jacarepaguá</Text></View>
          <View style={styles.routeRow}><View style={styles.square} /><Text style={styles.routeText}>Av. das Américas, 4666</Text></View>
        </View>
        <View>
          <Reanimated.View style={[styles.marker, barStyle]} />
          {CATEGORIES.map((c) => (
            <Pressable key={c.id} onPress={() => selectCategory(c.id, true)} style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
              <View style={styles.rowCopy}>
                <Text style={styles.rowName}>{c.label}</Text>
                <Text style={styles.rowDetail} numberOfLines={1}>{c.detail}</Text>
              </View>
              <View style={styles.rowValue}>
                <RollingPrice value={c.price} rollKey={rollKey} style={styles.rowPrice} reduceMotion={reduceMotion} />
                <Text style={styles.rowDetail}>Chegada ~{c.arrival}</Text>
              </View>
            </Pressable>
          ))}
        </View>
        <View style={styles.breakdown}><Text style={styles.rowDetail}>Composição do valor</Text><Text style={styles.rowDetail}>›</Text></View>
        <Pressable onPress={() => playOne(scenes[3])} style={({ pressed }) => [styles.confirm, pressed && { transform: [{ scale: 0.97 }] }]}>
          <Text style={styles.confirmText}>Confirmar</Text>
        </Pressable>
      </Reanimated.View>

      <Reanimated.View style={[styles.card, { bottom: insets.bottom + 12 }, searchStyle]}>
        <View style={styles.paidRow}>
          <Shield />
          <Text style={styles.paidLabel}>Valor protegido</Text>
          <Text style={styles.paidValue}>{brl(selected.price)} · Pix</Text>
        </View>
        <Text style={styles.searchTitle}>Encontrando seu motorista</Text>
        <Text style={styles.status}>{status}</Text>
        <View style={styles.track}><Shimmer reduceMotion={reduceMotion} /></View>
        <View style={styles.between}><Text style={styles.rowDetail}>Tempo de busca</Text><Text style={styles.timer}>00:{String(elapsed).padStart(2, '0')}</Text></View>
      </Reanimated.View>

      <Reanimated.View style={[styles.card, { bottom: insets.bottom + 12 }, foundStyle]}>
        <View key={foundKey}>
          <Reanimated.View entering={FadeInDown.duration(280)} style={styles.between}>
            <Text style={styles.eyebrow}>Motorista a caminho</Text>
            {fastMatch ? (
              <Reanimated.View entering={ZoomIn.delay(260).duration(260)} style={styles.fastChip}>
                <Bolt />
                <Text style={styles.fastChipText}>Encontrado em {foundIn} s</Text>
              </Reanimated.View>
            ) : null}
          </Reanimated.View>
          <Reanimated.View entering={FadeInDown.delay(50).duration(280)} style={styles.titleRow}>
            <Text style={styles.foundTitle} numberOfLines={1}>Chega em {eta} min</Text>
            {quickPickup ? (
              <Reanimated.View entering={ZoomIn.duration(240)} style={styles.quickChip}>
                <Text style={styles.quickChipText}>Embarque rápido</Text>
              </Reanimated.View>
            ) : null}
          </Reanimated.View>
          <Reanimated.View entering={FadeInDown.delay(110).duration(280)} style={styles.driverRow}>
            <View style={styles.avatar}><Text style={styles.avatarText}>C</Text></View>
            <View style={styles.driverCopy}>
              <Text style={styles.driverName}>Carlos Henrique</Text>
              <Text style={styles.rowDetailSmall}>★ 4,9 · 1.240 corridas · na Leaf desde 2025</Text>
            </View>
          </Reanimated.View>
          <Reanimated.View entering={FadeInDown.delay(160).duration(280)} style={styles.vehicleRow}>
            <View style={styles.driverCopy}>
              <Text style={styles.vehicleName}>Chevrolet Onix</Text>
              <Text style={styles.rowDetailSmall}>Branco · {categoryName}</Text>
            </View>
            <View style={styles.plate}>
              <View style={styles.plateBand}><Text style={styles.plateBandText}>BRASIL</Text></View>
              <Text style={styles.plateText}>RIO2A19</Text>
            </View>
          </Reanimated.View>
          <Reanimated.View entering={FadeInDown.delay(210).duration(280)} style={styles.paidRowFound}>
            <Shield />
            <Text style={styles.paidLabel}>Valor protegido</Text>
            <Text style={styles.paidValue}>{brl(selected.price)} · Pix</Text>
          </Reanimated.View>
          <Reanimated.View entering={FadeInDown.delay(260).duration(280)} style={styles.actions}>
            {['Mensagem', 'Compartilhar', 'Segurança'].map((label) => (
              <Pressable key={label} style={({ pressed }) => [styles.action, pressed && { transform: [{ scale: 0.96 }] }]}>
                <Text style={styles.actionText}>{label}</Text>
              </Pressable>
            ))}
          </Reanimated.View>
        </View>
      </Reanimated.View>

      {carsPickerOn ? (
        <View style={[styles.card, { bottom: insets.bottom + 12 }]}>
          <Text style={styles.eyebrow}>Marcador do carro no mapa</Text>
          <View style={styles.conceptRow}>
            {[{ key: 'current', label: 'Atual' }, ...VEHICLE_CONCEPTS].map((c) => (
              <Pressable key={c.key} onPress={() => chooseConcept(c.key)} style={[styles.conceptTile, vehicleConcept === c.key && styles.conceptTileOn]} testID={`leaf-motion-lab-car-${c.key}`}>
                <ConceptCar concept={c.key} color="white" size={64} />
                <Text style={styles.conceptLabel} numberOfLines={1}>{c.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      {/* current splash, only its exit animates */}
      {splashOn ? (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {SkiaLib ? (
            <SplashReveal progress={splashProgress} width={screenWidth} height={screenHeight} />
          ) : (
            <Reanimated.View style={[StyleSheet.absoluteFill, styles.splashFallback, splashFallbackStyle]}>
              <Image source={LOGO} style={styles.logo} resizeMode="contain" />
            </Reanimated.View>
          )}
        </View>
      ) : null}

      <View style={[styles.controls, { top: insets.top + 8 }]}>
        <Pressable onPress={() => navigation?.goBack?.()} style={styles.chip}><Text style={styles.chipText}>✕</Text></Pressable>
        <Pressable onPress={playAll} style={[styles.chip, styles.chipPrimary]}><Text style={[styles.chipText, styles.chipPrimaryText]}>Tudo</Text></Pressable>
        {scenes.map((s) => (
          <Pressable key={s.key} onPress={() => playOne(s)} style={[styles.chip, active === s.key && styles.chipOn]} testID={`leaf-motion-lab-${s.key}`}>
            <Text style={styles.chipText}>{s.label}</Text>
          </Pressable>
        ))}
      </View>
      {!SkiaLib ? <Text style={[styles.warn, { top: insets.top + 56 }]}>Este build não tem Skia: a esfera não aparece.</Text> : null}
    </View>
  );
}

function Shimmer({ reduceMotion }) {
  const x = useSharedValue(-1);
  useEffect(() => {
    if (reduceMotion) return undefined;
    let alive = true;
    const loop = () => { if (!alive) return; x.value = -1; x.value = withTiming(2.6, { duration: 1400, easing: Easing.linear }); setTimeout(loop, 1400); };
    loop();
    return () => { alive = false; };
  }, [reduceMotion, x]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.value * 120 }] }));
  return <Reanimated.View style={[styles.shimmer, style]} />;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#ECEEE9' },
  veil: { backgroundColor: 'rgba(244,245,241,0.78)' },
  sphereWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', justifyContent: 'center', height: SPHERE_SIZE },
  originOuter: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  originInner: { width: 11, height: 11, borderRadius: 6, backgroundColor: '#111410' },
  destOuter: { width: 22, height: 22, borderRadius: 6, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  destInner: { width: 11, height: 11, borderRadius: 3, backgroundColor: BRAND },
  card: { position: 'absolute', left: 12, right: 12, backgroundColor: '#FFFFFF', borderRadius: 28, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 16, shadowColor: '#0B120A', shadowOpacity: 0.14, shadowRadius: 24, shadowOffset: { width: 0, height: 10 }, elevation: 12 },
  routePair: { backgroundColor: '#F4F5F1', borderRadius: 16, padding: 12, gap: 8, marginBottom: 6 },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#111410' },
  square: { width: 8, height: 8, borderRadius: 2, backgroundColor: BRAND },
  routeText: { ...leafTypography.medium, fontSize: 15, color: '#222222' },
  marker: { position: 'absolute', left: 0, top: (ROW_HEIGHT - 30) / 2, width: 3, height: 30, borderRadius: 2, backgroundColor: BRAND },
  row: { height: ROW_HEIGHT, paddingLeft: 12, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E5E5' },
  rowPressed: { transform: [{ scale: 0.985 }] },
  rowCopy: { flex: 1, minWidth: 0 },
  rowName: { ...leafTypography.bold, fontSize: 20, lineHeight: 26, letterSpacing: -0.3, color: '#222222' },
  rowDetail: { ...leafTypography.regular, fontSize: 15, lineHeight: 22, color: '#6A6A6A' },
  rowDetailSmall: { ...leafTypography.regular, fontSize: 13, color: '#6A6A6A' },
  rowValue: { width: 128, alignItems: 'flex-end' },
  rowPrice: { ...leafTypography.semiBold, fontSize: 17, lineHeight: 24, fontVariant: ['tabular-nums'], color: '#222222' },
  breakdown: { minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  confirm: { height: 54, borderRadius: 16, backgroundColor: '#111410', alignItems: 'center', justifyContent: 'center' },
  confirmText: { ...leafTypography.semiBold, fontSize: 17, color: '#FFFFFF' },
  eyebrow: { ...leafTypography.medium, fontSize: 13, color: '#5F665B' },
  searchTitle: { ...leafTypography.bold, fontSize: 26, lineHeight: 32, color: '#111410', marginTop: 2 },
  status: { ...leafTypography.medium, fontSize: 15, color: '#5F665B', marginTop: 2 },
  track: { height: 4, borderRadius: 2, backgroundColor: '#E7EBE3', marginVertical: 14, overflow: 'hidden' },
  shimmer: { width: 120, height: 4, borderRadius: 2, backgroundColor: '#2E8B4A', opacity: 0.85 },
  between: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  timer: { ...leafTypography.bold, fontSize: 16, fontVariant: ['tabular-nums'], color: '#111410' },
  foundTitle: { ...leafTypography.bold, fontSize: 30, lineHeight: 36, color: '#111410', fontVariant: ['tabular-nums'], flexShrink: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 2 },
  fastChip: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 24, paddingHorizontal: 9, borderRadius: 12, backgroundColor: '#111410' },
  fastChipText: { ...leafTypography.semiBold, fontSize: 12, color: '#FFFFFF', fontVariant: ['tabular-nums'] },
  quickChip: { height: 26, paddingHorizontal: 10, borderRadius: 13, backgroundColor: '#E3F1E6', justifyContent: 'center' },
  quickChipText: { ...leafTypography.semiBold, fontSize: 13, color: '#1F6B36' },
  driverRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#E5E5E5' },
  driverCopy: { flex: 1, minWidth: 0 },
  vehicleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12 },
  vehicleName: { ...leafTypography.semiBold, fontSize: 16, color: '#111410' },
  paidRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  paidRowFound: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#E5E5E5' },
  paidLabel: { ...leafTypography.medium, fontSize: 13, color: '#1F4D17', flex: 1 },
  paidValue: { ...leafTypography.semiBold, fontSize: 13, color: '#111410', fontVariant: ['tabular-nums'] },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  action: { flex: 1, height: 42, borderRadius: 14, backgroundColor: '#F1F3EE', alignItems: 'center', justifyContent: 'center' },
  actionText: { ...leafTypography.semiBold, fontSize: 14, color: '#111410' },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#E3EADD', alignItems: 'center', justifyContent: 'center' },
  avatarText: { ...leafTypography.bold, fontSize: 16, color: BRAND },
  driverName: { ...leafTypography.bold, fontSize: 16, color: '#111410' },
  plate: { borderWidth: 1.5, borderColor: '#111410', borderRadius: 7, overflow: 'hidden', alignItems: 'center', minWidth: 96 },
  plateBand: { alignSelf: 'stretch', backgroundColor: '#1B3F8B', alignItems: 'center', paddingVertical: 1 },
  plateBandText: { ...leafTypography.bold, fontSize: 7, letterSpacing: 1.2, color: '#FFFFFF' },
  plateText: { ...leafTypography.bold, fontSize: 15, letterSpacing: 1.6, color: '#111410', paddingHorizontal: 8, paddingVertical: 2 },
  conceptRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  conceptTile: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 14, backgroundColor: '#F1F3EE', borderWidth: 1.5, borderColor: 'transparent' },
  conceptTileOn: { borderColor: BRAND, backgroundColor: '#FFFFFF' },
  conceptLabel: { ...leafTypography.semiBold, fontSize: 12, color: '#111410', marginTop: 2 },
  splashFallback: { backgroundColor: SPLASH_GREEN, alignItems: 'center', justifyContent: 'center' },
  logo: { width: 288, height: 288 },
  controls: { position: 'absolute', left: 12, right: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 12, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.92)', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(17,20,16,0.12)' },
  chipOn: { borderColor: BRAND, borderWidth: 1.5 },
  chipPrimary: { backgroundColor: '#111410' },
  chipText: { ...leafTypography.semiBold, fontSize: 13, color: '#111410' },
  chipPrimaryText: { color: '#FFFFFF' },
  warn: { position: 'absolute', left: 16, right: 16, ...leafTypography.medium, fontSize: 13, color: '#A3263A' },
});

