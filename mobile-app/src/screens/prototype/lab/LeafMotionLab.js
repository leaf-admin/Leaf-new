import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, TurboModuleRegistry, useWindowDimensions, View } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import Reanimated, {
  Easing,
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

const CAR = require('../../../../assets/leaf-ui/leafAVehicle.png');
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
  const { height: screenHeight } = useWindowDimensions();
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

  const catCardY = useSharedValue(520);
  const searchCardY = useSharedValue(520);
  const foundCardY = useSharedValue(520);
  const veil = useSharedValue(0);
  const sphereRadius = useSharedValue(10);
  const sphereOpacity = useSharedValue(0);
  const sphereCollapse = useSharedValue(0);
  const litCount = useSharedValue(0);
  const carScale = useSharedValue(0.2);
  const carOpacity = useSharedValue(0);
  const barY = useSharedValue(0);
  const curtainY = useSharedValue(0);
  const curtainOn = useSharedValue(0);

  const catStyle = useAnimatedStyle(() => ({ transform: [{ translateY: catCardY.value }] }));
  const searchStyle = useAnimatedStyle(() => ({ transform: [{ translateY: searchCardY.value }] }));
  const foundStyle = useAnimatedStyle(() => ({ transform: [{ translateY: foundCardY.value }] }));
  const veilStyle = useAnimatedStyle(() => ({ opacity: veil.value }));
  const carStyle = useAnimatedStyle(() => ({ opacity: carOpacity.value, transform: [{ scale: carScale.value }] }));
  const barStyle = useAnimatedStyle(() => ({ transform: [{ translateY: barY.value }] }));
  const curtainStyle = useAnimatedStyle(() => ({ opacity: curtainOn.value, transform: [{ translateY: curtainY.value }] }));

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
    setElapsed(0); setEta(6); setStatus('Procurando motoristas por perto');
    catCardY.value = 520; searchCardY.value = 520; foundCardY.value = 520; veil.value = 0;
    sphereOpacity.value = 0; sphereCollapse.value = 0; litCount.value = 0; carOpacity.value = 0; carScale.value = 0.2; barY.value = 0;
    curtainOn.value = 0; curtainY.value = 0;
    return runRef.current;
  }, [barY, carOpacity, carScale, catCardY, curtainOn, curtainY, foundCardY, litCount, searchCardY, sphereCollapse, sphereOpacity, veil]);

  const alive = (id) => id === runRef.current;

  /* scene: opening exit (current splash stays; only its exit animates) */
  const sceneOpening = useCallback(async (id) => {
    curtainOn.value = 1; curtainY.value = 0;
    mapRef.current?.animateToRegion({ ...PICKUP, latitudeDelta: 0.03, longitudeDelta: 0.03 }, 0);
    await sleep(900); if (!alive(id)) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    curtainY.value = reduceMotion ? -screenHeight * 1.4 : withTiming(-screenHeight * 1.4, { duration: 760, easing: Easing.bezier(0.22, 0.9, 0.24, 1) });
    await sleep(500); if (!alive(id)) return;
    mapRef.current?.animateToRegion({ ...PICKUP, latitudeDelta: 0.012, longitudeDelta: 0.012 }, 1400);
    await sleep(800); curtainOn.value = 0;
  }, [curtainOn, curtainY, reduceMotion, screenHeight]);

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
    barY.value = reduceMotion ? index * ROW_HEIGHT : withSpring(index * ROW_HEIGHT, { damping: 16, stiffness: 220 });
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
    veil.value = withTiming(1, { duration: 500 });
    await sleep(240); if (!alive(id)) return;
    slideIn(searchCardY);
    sphereCollapse.value = 0; sphereRadius.value = 12;
    sphereOpacity.value = withTiming(1, { duration: 500 });
    sphereRadius.value = reduceMotion ? 120 : withSpring(120, { damping: 12, stiffness: 90 });
    const start = Date.now();
    const timer = setInterval(() => { if (!alive(id)) { clearInterval(timer); return; } setElapsed(Math.floor((Date.now() - start) / 1000)); }, 250);
    const messages = ['Procurando motoristas por perto', '5 motoristas Plus a até 6 min', 'Falando com o mais próximo'];
    for (let k = 0; k < messages.length; k += 1) {
      setStatus(messages[k]);
      for (let j = 0; j < 2; j += 1) { litCount.value += 1; await sleep(480); }
      await sleep(320); if (!alive(id)) { clearInterval(timer); return; }
    }
    clearInterval(timer);
  }, [catCardY, litCount, reduceMotion, searchCardY, sphereCollapse, sphereOpacity, sphereRadius, veil]);

  /* scene: driver found */
  const sceneFound = useCallback(async (id) => {
    if (sphereOpacity.value < 0.5) { veil.value = 1; slideIn(searchCardY); sphereOpacity.value = 1; sphereRadius.value = 120; litCount.value = 6; await sleep(700); }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    sphereCollapse.value = withTiming(1, { duration: 520, easing: Easing.in(Easing.quad) });
    await sleep(380); if (!alive(id)) return;
    carOpacity.value = withTiming(1, { duration: 300 });
    carScale.value = reduceMotion ? 1 : withSpring(1, { damping: 11, stiffness: 160 });
    sphereOpacity.value = withTiming(0, { duration: 300 });
    slideOut(searchCardY);
    await sleep(900); if (!alive(id)) return;
    slideIn(foundCardY);
    veil.value = withTiming(0, { duration: 450 });
    carScale.value = withTiming(0.15, { duration: 600, easing: Easing.inOut(Easing.cubic) });
    carOpacity.value = withTiming(0, { duration: 600 });
    setRouteCount(0); setShowDestination(false);
    fit([...DRIVER_ROUTE, PICKUP], 330 + insets.bottom);
    await sleep(650); if (!alive(id)) return;
    setDriverVisible(true); setShowOrigin(true);
    await runTween(1100, (t) => { if (alive(id)) setDriverCount(Math.max(2, Math.round(t * DRIVER_ROUTE.length))); }, easeInOut, reduceMotion);
    for (let e = 6; e >= 4; e -= 1) { if (!alive(id)) return; setEta(e); await sleep(150); }
  }, [carOpacity, carScale, fit, foundCardY, insets.bottom, litCount, reduceMotion, searchCardY, sphereCollapse, sphereOpacity, sphereRadius, veil]);

  const scenes = useMemo(() => [
    { key: 'opening', label: 'Abertura', run: sceneOpening },
    { key: 'route', label: 'Rota', run: sceneRoute },
    { key: 'category', label: 'Categoria', run: sceneCategory },
    { key: 'search', label: 'Busca', run: sceneSearch },
    { key: 'found', label: 'Encontrou', run: sceneFound },
  ], [sceneCategory, sceneFound, sceneOpening, sceneRoute, sceneSearch]);

  const playOne = async (scene) => {
    const id = scene.key === 'opening' || scene.key === 'route' ? resetAll() : ++runRef.current;
    setActive(scene.key);
    await scene.run(id);
  };
  const playAll = async () => {
    const id = resetAll();
    for (const scene of scenes) { if (!alive(id)) return; setActive(scene.key); await scene.run(id); await sleep(700); }
  };

  useEffect(() => { fit([PICKUP], 300, false); }, [fit]);

  const selected = CATEGORIES.find((c) => c.id === category) || CATEGORIES[0];
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
        <Marker coordinate={DRIVER_START} anchor={{ x: 0.5, y: 0.5 }} opacity={driverVisible ? 1 : 0}>
          <Image source={CAR} style={styles.mapCar} />
        </Marker>
        {CATEGORIES.map((c) => c.cars.map(([dLat, dLng], i) => (
          <Marker
            key={`${c.id}-${i}`}
            coordinate={{ latitude: PICKUP.latitude + dLat, longitude: PICKUP.longitude + dLng }}
            anchor={{ x: 0.5, y: 0.5 }}
            opacity={carsVisible && c.id === category ? 1 : 0}
          >
            <Image source={CAR} style={styles.nearCar} />
          </Marker>
        )))}
      </MapView>

      <Reanimated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.veil, veilStyle]} />

      <View pointerEvents="none" style={[styles.sphereWrap, { top: insets.top + 90 }]}>
        <LeafNetworkSphere size={300} radius={sphereRadius} opacity={sphereOpacity} collapse={sphereCollapse} litCount={litCount} reduceMotion={reduceMotion} />
        <Reanimated.Image source={CAR} style={[styles.bigCar, carStyle]} resizeMode="contain" />
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
        <Text style={styles.eyebrow}>{selected.label.charAt(0) + selected.label.slice(1).toLowerCase()} · valor protegido</Text>
        <Text style={styles.searchTitle}>Encontrando seu motorista</Text>
        <Text style={styles.status}>{status}</Text>
        <View style={styles.track}><Shimmer reduceMotion={reduceMotion} /></View>
        <View style={styles.between}><Text style={styles.rowDetail}>Tempo de busca</Text><Text style={styles.timer}>00:{String(elapsed).padStart(2, '0')}</Text></View>
      </Reanimated.View>

      <Reanimated.View style={[styles.card, { bottom: insets.bottom + 12 }, foundStyle]}>
        <Text style={styles.eyebrow}>Motorista a caminho</Text>
        <Text style={styles.foundTitle} numberOfLines={1} adjustsFontSizeToFit>Chega em {eta} min</Text>
        <View style={styles.between}><Text style={styles.rowDetail}>Plus · Onix branco</Text><Text style={styles.timer}>R$ 48,52</Text></View>
        <View style={styles.driverRow}>
          <View style={styles.avatar}><Text style={styles.avatarText}>C</Text></View>
          <View style={{ flex: 1 }}><Text style={styles.driverName}>Carlos</Text><Text style={styles.rowDetailSmall}>★ 4,9 · 1.240 corridas</Text></View>
          <View style={styles.plate}><Text style={styles.plateText}>RIO2A19</Text></View>
        </View>
      </Reanimated.View>

      {/* current splash, only its exit animates */}
      {/* Taller than the screen so the curved bottom edge is only seen once it lifts. */}
      <Reanimated.View pointerEvents="none" style={[styles.curtain, { height: screenHeight * 1.35 }, curtainStyle]}>
        <View style={[styles.curtainFace, { height: screenHeight }]}>
          <Image source={LOGO} style={styles.logo} resizeMode="contain" />
        </View>
      </Reanimated.View>

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
  sphereWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', justifyContent: 'center', height: 300 },
  bigCar: { position: 'absolute', width: 230, height: 200 },
  mapCar: { width: 34, height: 30 },
  nearCar: { width: 26, height: 23 },
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
  foundTitle: { ...leafTypography.bold, fontSize: 32, lineHeight: 38, color: '#111410', fontVariant: ['tabular-nums'] },
  driverRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#E5E5E5' },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#E3EADD', alignItems: 'center', justifyContent: 'center' },
  avatarText: { ...leafTypography.bold, fontSize: 16, color: BRAND },
  driverName: { ...leafTypography.bold, fontSize: 16, color: '#111410' },
  plate: { borderWidth: 1.5, borderColor: '#111410', borderRadius: 9, paddingHorizontal: 8, paddingVertical: 4 },
  plateText: { ...leafTypography.bold, fontSize: 15, letterSpacing: 1.6, color: '#111410' },
  curtain: { position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: '#003002', borderBottomLeftRadius: 260, borderBottomRightRadius: 260 },
  curtainFace: { alignItems: 'center', justifyContent: 'center' },
  logo: { width: 288, height: 288 },
  controls: { position: 'absolute', left: 12, right: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 12, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.92)', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(17,20,16,0.12)' },
  chipOn: { borderColor: BRAND, borderWidth: 1.5 },
  chipPrimary: { backgroundColor: '#111410' },
  chipText: { ...leafTypography.semiBold, fontSize: 13, color: '#111410' },
  chipPrimaryText: { color: '#FFFFFF' },
  warn: { position: 'absolute', left: 16, right: 16, ...leafTypography.medium, fontSize: 13, color: '#A3263A' },
});

