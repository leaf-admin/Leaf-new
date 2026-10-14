import React, { useEffect, useState } from 'react';
import { StyleSheet, TurboModuleRegistry, useWindowDimensions, View } from 'react-native';
import Reanimated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { LEAF_SPLASH_GREEN } from './LeafBootSplash';

// Saída do splash na abertura (aprovada no motion lab): o splash fica parado e o mapa
// sobe de baixo por uma borda convexa que engole o verde e o logo. Sem Skia no build,
// ou com "reduzir movimento", o splash só esmaece.

let SkiaLib = null;
try {
  if (TurboModuleRegistry.get?.('RNSkiaModule')) {
    SkiaLib = require('@shopify/react-native-skia');
  }
} catch (_error) {
  SkiaLib = null;
}

const LOGO = require('../../../assets/images/splash_android_icon.png');
const LOGO_SIZE = 288;
export const LEAF_SPLASH_REVEAL_MS = 760;
// Começo lento (a curva aparece), meio rápido, pouso suave.
const RISE = Easing.bezier(0.55, 0, 0.2, 1);
// Tempo com a capa parada antes de revelar: o canvas desenha o primeiro quadro e o
// mapa (que no Android só pinta depois de montado) termina de aparecer por baixo.
// Sem isso a home aparecia crua por ~0,35 s e a curva só surgia no fim.
const REVEAL_WARMUP_MS = 280;

function ConvexReveal({ progress, width, height, onReady }) {
  const { Canvas, Group, Rect, Image: SkImage, Skia, useImage, FillType } = SkiaLib;
  const logo = useImage(LOGO);
  useEffect(() => {
    if (logo && typeof onReady === 'function') onReady();
  }, [logo, onReady]);
  const radius = Math.max(width * 1.3, height * 0.62);
  const evenOdd = FillType.EvenOdd;
  const clip = useDerivedValue(() => {
    // O topo do círculo vai de baixo da tela até acima dela; no fim ele cobre os
    // quatro cantos e não sobra nada do splash.
    const edge = height + 6 - progress.value * height * 1.2;
    const path = Skia.Path.Make();
    path.addRect(Skia.XYWHRect(0, 0, width, height));
    path.addCircle(width / 2, edge + radius, radius);
    path.setFillType(evenOdd);
    return path;
  });
  return (
    <Canvas style={{ width, height }} pointerEvents="none">
      <Group clip={clip}>
        <Rect x={0} y={0} width={width} height={height} color={LEAF_SPLASH_GREEN} />
        {logo ? (
          <SkImage
            image={logo}
            x={(width - LOGO_SIZE) / 2}
            y={(height - LOGO_SIZE) / 2}
            width={LOGO_SIZE}
            height={LOGO_SIZE}
            fit="contain"
          />
        ) : null}
      </Group>
    </Canvas>
  );
}

export default function LeafSplashReveal({ onDone, style, testID = 'leaf-splash-reveal' }) {
  const { width, height } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(0);
  const opacity = useSharedValue(1);
  const convex = Boolean(SkiaLib) && !reduceMotion;
  const [canvasReady, setCanvasReady] = useState(!convex);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    if (!canvasReady || started) return undefined;
    const timer = setTimeout(() => setStarted(true), convex ? REVEAL_WARMUP_MS : 0);
    return () => clearTimeout(timer);
  }, [canvasReady, convex, started]);

  useEffect(() => {
    if (!started) return;
    const finish = () => {
      if (typeof onDone === 'function') onDone();
    };
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (convex) {
      progress.value = withTiming(1, { duration: LEAF_SPLASH_REVEAL_MS, easing: RISE }, (finished) => {
        if (finished) runOnJS(finish)();
      });
    } else {
      opacity.value = withTiming(0, { duration: reduceMotion ? 160 : 320 }, (finished) => {
        if (finished) runOnJS(finish)();
      });
    }
    // Uma vez, quando começa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started]);

  const fadeStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const handleCanvasReady = React.useCallback(() => setCanvasReady(true), []);

  return (
    <View style={[StyleSheet.absoluteFill, style]} pointerEvents="none" testID={testID}>
      {convex ? (
        <ConvexReveal progress={progress} width={width} height={height} onReady={handleCanvasReady} />
      ) : null}
      {/* Capa idêntica ao splash enquanto a revelação não começa (ou o fade, sem Skia). */}
      {!convex || !started ? (
        <Reanimated.View style={[StyleSheet.absoluteFill, styles.flat, convex ? null : fadeStyle]}>
          <Reanimated.Image source={LOGO} style={styles.logo} resizeMode="contain" />
        </Reanimated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flat: {
    backgroundColor: LEAF_SPLASH_GREEN,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    width: LOGO_SIZE,
    height: LOGO_SIZE,
  },
});
