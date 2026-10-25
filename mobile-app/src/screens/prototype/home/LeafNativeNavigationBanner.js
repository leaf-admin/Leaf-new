import leafTypography from '../../../components/prototype/LeafTypography';
import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import robotaxiPrototypeTokens from '../../../components/design-system/robotaxiPrototypeTokens';
import { usePrototypeMapOcclusion } from '../prototypeMapOcclusion';

const { color } = robotaxiPrototypeTokens;

function normalizeInstruction(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function resolveManeuverType(instruction, isOffRoute, maneuver) {
  if (isOffRoute) {
    return 'warning';
  }

  const providerManeuver = String(maneuver || '').toUpperCase();
  if (providerManeuver.includes('UTURN')) return 'uturn';
  if (providerManeuver.includes('ROUNDABOUT')) return 'roundabout';
  if (providerManeuver.includes('RIGHT')) return 'turn-right';
  if (providerManeuver.includes('LEFT')) return 'turn-left';
  if (providerManeuver === 'STRAIGHT') return 'straight';
  const normalized = normalizeInstruction(instruction);
  if (normalized.includes('direita')) {
    return 'turn-right';
  }
  if (normalized.includes('esquerda')) {
    return 'turn-left';
  }
  if (
    normalized.includes('retorno') ||
    normalized.includes('meia volta') ||
    normalized.includes('meia-volta')
  ) {
    return 'uturn';
  }
  if (normalized.includes('rotatoria') || normalized.includes('rotunda')) {
    return 'roundabout';
  }
  if (
    normalized.includes('continue') ||
    normalized.includes('siga') ||
    normalized.includes('mantenha')
  ) {
    return 'straight';
  }

  return 'navigate';
}

function ManeuverGlyph({ type, color: glyphColor }) {
  if (type === 'arrived') {
    return (
      <Ionicons
        name="flag"
        size={22}
        color={glyphColor}
        testID="leaf-native-arrived-glyph"
        accessibilityLabel="Chegada"
      />
    );
  }
  if (type === 'turn-right' || type === 'turn-left') {
    const isRight = type === 'turn-right';
    const turnPath =
      'M12 34 H20 V20 C20 16.7 22.7 14 26 14 H28 V21 L39 10 L28 -1 V6 H26 C18.3 6 12 12.3 12 20 V34 Z';

    return (
      <Svg
        width={22}
        height={22}
        viewBox="0 0 40 36"
        testID={`leaf-native-${type}-glyph`}
        accessibilityLabel={isRight ? 'Virar à direita' : 'Virar à esquerda'}
      >
        <Path
          d={turnPath}
          fill={glyphColor}
          stroke="none"
          transform={isRight ? undefined : 'translate(40 0) scale(-1 1)'}
        />
      </Svg>
    );
  }

  const fallbackIcon =
    type === 'warning'
      ? 'warning-outline'
      : type === 'uturn'
        ? 'refresh-outline'
        : type === 'roundabout'
          ? 'sync-outline'
          : type === 'straight'
            ? 'arrow-up-outline'
            : 'navigate-outline';

  return <Ionicons name={fallbackIcon} size={22} color={glyphColor} />;
}

const BANNER_TOP_OFFSET = 70;
const BANNER_FALLBACK_HEIGHT = 120;
const BANNER_MAP_GAP = 12;

export default function LeafNativeNavigationBanner({
  routeKey,
  insetsTop = 0,
  navigationModel = null,
  onOpenNavigation,
  onHide,
}) {
  const isOffRoute = navigationModel?.isOffRoute === true;
  const isVisible = Boolean(navigationModel?.isVisible) && !isOffRoute;

  // The map keeps the car and route below the banner, so the occlusion must be
  // the banner's real bottom edge: its height grows with a two-line instruction.
  const [bannerHeight, setBannerHeight] = useState(BANNER_FALLBACK_HEIGHT);
  const handleBannerLayout = useCallback((event) => {
    const height = Math.round(Number(event?.nativeEvent?.layout?.height) || 0);
    if (height > 0) {
      setBannerHeight((previous) => (Math.abs(previous - height) > 2 ? height : previous));
    }
  }, []);

  usePrototypeMapOcclusion({
    routeKey,
    layerId: `${routeKey || 'prototype-home'}-leaf-native-navigation`,
    occludedTop: isVisible ? insetsTop + BANNER_TOP_OFFSET + bannerHeight + BANNER_MAP_GAP : 0,
  });

  if (!isVisible) {
    return null;
  }

  const title = navigationModel.currentInstruction;
  const distanceTarget = navigationModel.hasArrived
    ? 'você chegou'
    : String(navigationModel.maneuverDistanceTargetLabel || 'o destino').replace(/^(a|o)\s+/i, '');
  const maneuverType = navigationModel.hasArrived && !isOffRoute
    ? 'arrived'
    : resolveManeuverType(title, isOffRoute, navigationModel.maneuver);
  const phaseLabel = navigationModel.hasArrived
    ? 'VOCÊ CHEGOU'
    : navigationModel.phase === 'destination' ? 'ATÉ O DESTINO' : 'ATÉ O EMBARQUE';
  const mainDistance = navigationModel.hasArrived
    ? 'Chegou'
    : navigationModel.maneuverDistanceLabel;

  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrap, { top: insetsTop + BANNER_TOP_OFFSET }]}
      onLayout={handleBannerLayout}
      testID="leaf-native-navigation-banner"
    >
      <View style={styles.card}>
        <View style={styles.main}>
          <View style={styles.metric}>
            <Text style={styles.distance} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{mainDistance}</Text>
            <Text style={styles.metricLabel} numberOfLines={2}>{distanceTarget}</Text>
          </View>
          <View style={styles.copy}>
            <Text style={styles.phase}>{phaseLabel}</Text>
            <View style={styles.instruction}>
              <View style={styles.iconWrap}>
                <ManeuverGlyph type={maneuverType} color={color.accent.primary} />
              </View>
              <Text style={styles.title} numberOfLines={2}>{title}</Text>
            </View>
            {navigationModel.hasArrived && navigationModel.arrivalHint ? (
              <Text style={styles.subtitle} numberOfLines={2}>{navigationModel.arrivalHint}</Text>
            ) : null}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Ocultar navegação LEAF"
            onPress={onHide}
            style={styles.hideButton}
          >
            <Ionicons name="close" size={18} color={color.text.secondary} />
          </Pressable>
        </View>
        <View style={styles.footer}>
          <View style={styles.summary}>
            {!navigationModel.hasArrived ? (
              <Text style={styles.metaDistance} numberOfLines={2}>
                {navigationModel.remainingDistanceLabel}{navigationModel.etaLabel ? ` · ${navigationModel.etaLabel}` : ''}
              </Text>
            ) : null}
          </View>
          {typeof onOpenNavigation === 'function' ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Navegar com Waze ou Google Maps"
              onPress={onOpenNavigation}
              style={styles.navigationButton}
            >
              <Text style={styles.navigationButtonText}>Abrir navegador</Text>
              <Ionicons name="open-outline" size={15} color={color.accent.primary} />
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 28,
    alignItems: 'center',
  },
  card: {
    width: '92%',
    maxWidth: 480,
    borderRadius: 20,
    backgroundColor: color.bg.panelSolid,
    shadowColor: color.shadow.base,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 8,
  },
  main: {
    minHeight: 72,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconWrap: {
    width: 24,
    height: 30,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  metric: {
    width: 76,
    alignSelf: 'stretch',
    justifyContent: 'center',
    paddingRight: 8,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: color.border.separator,
  },
  metricLabel: {
    ...leafTypography.regular,
    fontSize: 11,
    lineHeight: 15,
    color: color.text.secondary,
    marginTop: 4,
  },
  instruction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 4,
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    flex: 1,
    ...leafTypography.semiBold,
    fontSize: 14,
    lineHeight: 18,
    color: color.text.primary,
  },
  phase: {
    ...leafTypography.semiBold,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 1,
    color: color.text.secondary,
  },
  distance: {
    ...leafTypography.bold,
    fontSize: 24,
    lineHeight: 29,
    color: color.accent.primary,
  },
  subtitle: {
    ...leafTypography.regular,
    fontSize: 12,
    lineHeight: 17,
    color: color.text.secondary,
  },
  footer: {
    paddingHorizontal: 14,
    paddingVertical: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.border.separator,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  summary: {
    flexGrow: 1,
    flexBasis: 96,
    minWidth: 0,
  },
  metaDistance: {
    ...leafTypography.regular,
    fontSize: 12,
    lineHeight: 17,
    color: color.text.primary,
  },
  navigationButton: {
    minHeight: 44,
    paddingHorizontal: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  navigationButtonText: {
    ...leafTypography.semiBold,
    fontSize: 12,
    color: color.accent.primary,
  },
  hideButton: {
    width: 44,
    marginLeft: -6,
    height: 44,
    alignSelf: 'flex-start',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
  },
});
