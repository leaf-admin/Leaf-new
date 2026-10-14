import React, { useEffect } from 'react';
import { TurboModuleRegistry } from 'react-native';
import {
  Easing,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

// Esfera de rede da Leaf (aprovada no motion lab): pontos ligados girando devagar,
// nós que acendem um a um enquanto a busca fala com motoristas, e que se fecha num
// ponto quando um motorista aceita. Sem Skia no build, não desenha nada.

let SkiaLib = null;
try {
  if (TurboModuleRegistry.get?.('RNSkiaModule')) {
    SkiaLib = require('@shopify/react-native-skia');
  }
} catch (_error) {
  SkiaLib = null;
}

export function isLeafNetworkSphereAvailable() {
  return Boolean(SkiaLib);
}

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


const LIT_STEP_MS = 900;

/**
 * @param {number} size lado do quadrado em dp
 * @param {boolean} active buscando: aparece, cresce e acende nós aos poucos
 * @param {boolean} converged motorista encontrado: a esfera se fecha e some
 */
export default function LeafNetworkSphereView({ size = 280, active = false, converged = false }) {
  const reduceMotion = useReducedMotion();
  const radius = useSharedValue(12);
  const opacity = useSharedValue(0);
  const collapse = useSharedValue(0);
  const litCount = useSharedValue(0);

  useEffect(() => {
    if (!active || converged) return undefined;
    collapse.value = 0;
    opacity.value = withTiming(1, { duration: 500 });
    radius.value = reduceMotion ? size * 0.4 : withSpring(size * 0.4, { damping: 12, stiffness: 90 });
    litCount.value = 0;
    const timer = setInterval(() => {
      litCount.value = litCount.value >= LIT_ORDER.length ? 1 : litCount.value + 1;
    }, LIT_STEP_MS);
    return () => clearInterval(timer);
  }, [active, collapse, converged, litCount, opacity, radius, reduceMotion, size]);

  useEffect(() => {
    if (converged) {
      collapse.value = withTiming(1, { duration: 480, easing: Easing.in(Easing.quad) });
      opacity.value = withTiming(0, { duration: 520 });
    } else if (!active) {
      opacity.value = withTiming(0, { duration: 260 });
    }
  }, [active, collapse, converged, opacity]);

  return (
    <LeafNetworkSphere
      size={size}
      radius={radius}
      opacity={opacity}
      collapse={collapse}
      litCount={litCount}
      reduceMotion={reduceMotion}
    />
  );
}
