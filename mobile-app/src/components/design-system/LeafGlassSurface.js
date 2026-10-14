import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Platform, StyleSheet, View } from 'react-native';
import Skia from './leafSkia';
import { getGlassBackdrop, subscribeGlassBackdrop } from './leafGlassBackdrop';
import { LinearGradient } from 'expo-linear-gradient';

// iOS 26+: native Liquid Glass. Android: real-time blur (expo-blur) with a
// light tint, the closest match. Older iOS, binaries without the native
// module, tests and "Reduce transparency" get a near-opaque solid with the
// same shape, so floating controls stay readable over the map.
let GlassView = null;
let liquidGlassAvailable = false;
let AndroidBlurView = null;
// O blur ao vivo (dimezis) recalcula o desfoque a cada redesenho da janela: com a barra de
// "Procurando corridas" animando, eram ~60 desfoques por segundo por superfície (o app do
// motorista passava de 100% de CPU parado). A lente Skia já refrata uma foto estática do
// mapa; por baixo dela fica um branco mais denso, que lê bem mesmo sem a foto.
const ANDROID_LIVE_BLUR = false;
if (Platform.OS === 'android') {
  try {
    const { requireOptionalNativeModule } = require('expo-modules-core');
    // Only use the blur view when this app binary actually ships it.
    if (requireOptionalNativeModule?.('ExpoBlurView')) {
      AndroidBlurView = require('expo-blur').BlurView;
    }
  } catch (_error) {
    AndroidBlurView = null;
  }
}
// Lens: samples the map snapshot behind the surface and, near the rim, pulls
// in content from just outside the shape (convex-glass refraction) with a
// slight chromatic split. The core stays almost undistorted, as in iOS 26.
const LENS_SKSL = `
uniform shader image;
uniform float2 size;
uniform float radius;
uniform float2 origin;
uniform float scale;
uniform float strength;

float sdRoundRect(float2 p, float2 b, float r) {
  float2 q = abs(p) - b + float2(r);
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

half4 main(float2 xy) {
  float2 c = size * 0.5;
  float2 p = xy - c;
  float d = sdRoundRect(p, c, radius);
  float band = min(size.x, size.y) * 0.45;
  float t = clamp(1.0 + d / band, 0.0, 1.0);
  float bend = t * t * t * strength;
  float e = 0.5;
  float2 n = normalize(float2(
    sdRoundRect(p + float2(e, 0.0), c, radius) - sdRoundRect(p - float2(e, 0.0), c, radius),
    sdRoundRect(p + float2(0.0, e), c, radius) - sdRoundRect(p - float2(0.0, e), c, radius)
  ) + float2(0.00001));
  float2 base = (origin + xy + n * bend) * scale;
  float split = t * t * 1.5 * scale;
  half red = image.eval(base + n * split).r;
  half green = image.eval(base).g;
  half blue = image.eval(base - n * split).b;
  return half4(red, green, blue, 1.0);
}
`;
const lensEffect = Skia ? Skia.Skia.RuntimeEffect.Make(LENS_SKSL) : null;

function useGlassBackdrop(enabled) {
  const [backdrop, setBackdrop] = useState(enabled ? getGlassBackdrop() : null);
  useEffect(() => (enabled ? subscribeGlassBackdrop(setBackdrop) : undefined), [enabled]);
  return backdrop;
}

function SkiaGlassLens({ width, height, r, dark, backdrop, windowOrigin }) {
  const image = backdrop?.image;
  const frame = backdrop?.frame;
  if (!lensEffect || !image || !frame || !windowOrigin) return null;
  const { Fill, Shader, ImageShader, RoundedRect, Blur } = Skia;
  const scale = image.width() / frame.width;
  const origin = [windowOrigin.x - frame.x, windowOrigin.y - frame.y];
  return (
    <>
      <Fill>
        <Shader
          source={lensEffect}
          uniforms={{ size: [width, height], radius: r, origin, scale, strength: Math.min(width, height) * 0.32 }}
        >
          <ImageShader image={image} x={0} y={0} width={image.width()} height={image.height()} fit="none" tx="clamp" ty="clamp" />
        </Shader>
        <Blur blur={1.2} mode="clamp" />
      </Fill>
      {/* Frost keeps text legible over a busy map. */}
      <RoundedRect x={0} y={0} width={width} height={height} r={r} color={dark ? 'rgba(17,20,16,0.5)' : 'rgba(255,255,255,0.34)'} />
    </>
  );
}

function SkiaGlassMaterial({ width, height, radius, dark, backdrop, windowOrigin }) {
  if (!Skia || !width || !height) return null;
  const { Canvas, Group, RoundedRect, LinearGradient: SkLinearGradient, BlurMask, Oval, vec, rrect, rect } = Skia;
  const r = Math.min(radius ?? 24, width / 2, height / 2);
  const clip = rrect(rect(0, 0, width, height), r, r);
  const edge = Math.max(5, Math.min(width, height) * 0.14);
  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      <Group clip={clip}>
        <SkiaGlassLens width={width} height={height} r={r} dark={dark} backdrop={backdrop} windowOrigin={windowOrigin} />
        {/* Thick-glass edge: light gathering inside the rim (lensing cue). */}
        <RoundedRect x={0} y={0} width={width} height={height} r={r} style="stroke" strokeWidth={edge} color={dark ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.55)'}>
          <BlurMask blur={edge * 0.7} style="normal" />
        </RoundedRect>
        {/* Specular rim: bright where the light source hits (top), faint
            caustic where it exits (bottom). */}
        <RoundedRect x={0.75} y={0.75} width={width - 1.5} height={height - 1.5} r={r - 0.75} style="stroke" strokeWidth={1.5}>
          <SkLinearGradient
            start={vec(0, 0)}
            end={vec(0, height)}
            colors={dark
              ? ['rgba(255,255,255,0.45)', 'rgba(255,255,255,0.04)', 'rgba(255,255,255,0.18)']
              : ['rgba(255,255,255,1)', 'rgba(255,255,255,0.15)', 'rgba(255,255,255,0.7)']}
            positions={[0, 0.55, 1]}
          />
        </RoundedRect>
        {/* Specular highlight on the upper-left shoulder. */}
        <Oval x={width * 0.08} y={-height * 0.18} width={width * 0.5} height={height * 0.5} color={dark ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.42)'}>
          <BlurMask blur={Math.max(6, height * 0.18)} style="normal" />
        </Oval>
        {/* Soft shade toward the lower edge gives the surface volume. */}
        <RoundedRect x={0} y={0} width={width} height={height} r={r}>
          <SkLinearGradient
            start={vec(0, height * 0.55)}
            end={vec(0, height)}
            colors={['rgba(17,20,16,0)', dark ? 'rgba(0,0,0,0.18)' : 'rgba(17,20,16,0.05)']}
          />
        </RoundedRect>
      </Group>
    </Canvas>
  );
}
if (Platform.OS === 'ios') {
  try {
    const glass = require('expo-glass-effect');
    liquidGlassAvailable = Boolean(glass?.isLiquidGlassAvailable?.());
    GlassView = liquidGlassAvailable ? glass.GlassView : null;
  } catch (_error) {
    GlassView = null;
    liquidGlassAvailable = false;
  }
}

export function isLeafGlassAvailable() {
  return Boolean(GlassView && liquidGlassAvailable);
}

function useReduceTransparency() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceTransparencyEnabled?.()
      .then((value) => {
        if (active) setEnabled(Boolean(value));
      })
      .catch(() => {});
    const subscription = AccessibilityInfo.addEventListener?.(
      'reduceTransparencyChanged',
      (value) => setEnabled(Boolean(value)),
    );
    return () => {
      active = false;
      subscription?.remove?.();
    };
  }, []);

  return enabled;
}

export default function LeafGlassSurface({
  tone = 'light',
  interactive = false,
  style,
  children,
  testID,
  ...viewProps
}) {
  const reduceTransparency = useReduceTransparency();
  const isDark = tone === 'dark';
  const [layout, setLayout] = useState({ width: 0, height: 0 });
  // Dark surfaces (navigation banner) are solid enough to read at a glance;
  // they never refract, so nothing on them changes while driving.
  const androidLens = Platform.OS === 'android' && Boolean(Skia) && !reduceTransparency && !isDark;
  const backdrop = useGlassBackdrop(androidLens);
  const surfaceRef = useRef(null);
  const [windowOrigin, setWindowOrigin] = useState(null);
  // Window position is what maps the surface onto the map snapshot; measure
  // whenever a new snapshot arrives (surfaces may have moved since).
  useEffect(() => {
    if (!androidLens || !backdrop?.image) return;
    surfaceRef.current?.measureInWindow?.((x, y) => {
      setWindowOrigin((prev) => (prev && prev.x === x && prev.y === y ? prev : { x, y }));
    });
  }, [androidLens, backdrop, layout.width, layout.height]);

  if (GlassView && liquidGlassAvailable && !reduceTransparency) {
    return (
      <GlassView
        glassEffectStyle="regular"
        colorScheme={isDark ? 'dark' : 'light'}
        tintColor={isDark ? 'rgba(17,20,16,0.55)' : undefined}
        isInteractive={interactive}
        style={[styles.base, styles.glassClip, style]}
        testID={testID}
        {...viewProps}
      >
        {children}
      </GlassView>
    );
  }

  if (AndroidBlurView && !reduceTransparency) {
    // The blur draws its own bitmap and ignores the parent's rounded clip, so
    // it gets the same radius (otherwise circles show a faint polygon edge).
    const { borderRadius } = StyleSheet.flatten(style) || {};
    const handleLayout = (event) => {
      const { width, height } = event.nativeEvent.layout;
      setLayout((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
      viewProps.onLayout?.(event);
    };
    return (
      <View style={[styles.base, styles.glassClip, isDark ? styles.androidGlassDark : styles.androidGlassLight, !ANDROID_LIVE_BLUR && (isDark ? styles.androidGlassDarkSolid : styles.androidGlassLightSolid), style]} testID={testID} {...viewProps} ref={surfaceRef} onLayout={handleLayout}>
        {ANDROID_LIVE_BLUR ? (
          <AndroidBlurView
            intensity={isDark ? 60 : 70}
            tint={isDark ? 'dark' : 'light'}
            experimentalBlurMethod="dimezisBlurView"
            blurReductionFactor={4}
            style={[StyleSheet.absoluteFill, borderRadius != null && { borderRadius, overflow: 'hidden' }]}
            pointerEvents="none"
          />
        ) : null}
        {/* Glass cues the blur alone lacks: a sheen falling from the top edge
            and a bright inner rim, so the surface reads as a lens, not paint. */}
        {Skia ? (
          <SkiaGlassMaterial
            width={layout.width}
            height={layout.height}
            radius={borderRadius}
            dark={isDark}
            backdrop={backdrop}
            windowOrigin={windowOrigin}
          />
        ) : !isDark ? (
          <LinearGradient
            colors={['rgba(255,255,255,0.62)', 'rgba(255,255,255,0.1)', 'rgba(255,255,255,0)']}
            locations={[0, 0.5, 1]}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
        ) : null}
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, styles.androidRim, borderRadius != null && { borderRadius }, isDark && styles.androidRimDark]}
        />
        {children}
      </View>
    );
  }

  return (
    <View
      style={[styles.base, isDark ? styles.fallbackDark : styles.fallbackLight, style]}
      testID={testID}
      {...viewProps}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {},
  glassClip: {
    overflow: 'hidden',
  },
  // Tint over the blur keeps text contrast on busy map areas.
  // No elevation: Android draws the shadow through a translucent fill as a
  // grey polygon. A dark hairline outside and a bright rim inside separate the
  // surface from a light map; the light tint lets the blurred map show through.
  androidGlassLight: {
    backgroundColor: 'rgba(255,255,255,0.4)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(17,20,16,0.14)',
  },
  androidGlassLightSolid: {
    backgroundColor: 'rgba(255,255,255,0.86)',
  },
  androidGlassDarkSolid: {
    backgroundColor: 'rgba(17,20,16,0.82)',
  },
  androidRim: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.75)',
  },
  androidRimDark: {
    borderColor: 'rgba(255,255,255,0.16)',
  },
  androidGlassDark: {
    backgroundColor: 'rgba(17,20,16,0.55)',
    elevation: 8,
  },
  fallbackLight: {
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(17,20,16,0.08)',
    shadowColor: '#111410',
    shadowOpacity: 0.14,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  fallbackDark: {
    backgroundColor: 'rgba(17,20,16,0.9)',
    shadowColor: '#111410',
    shadowOpacity: 0.22,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
});
