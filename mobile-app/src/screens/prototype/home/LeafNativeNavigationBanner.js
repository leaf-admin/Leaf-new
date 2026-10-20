import leafTypography from '../../../components/prototype/LeafTypography';
import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import robotaxiPrototypeTokens from '../../../components/design-system/robotaxiPrototypeTokens';
import { usePrototypeMapOcclusion } from '../prototypeMapOcclusion';
import { compact } from '../../../components/prototype/RobotaxiLifecycleUI';
import LeafGlassSurface from '../../../components/design-system/LeafGlassSurface';

const { color } = robotaxiPrototypeTokens;

function normalizeInstruction(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function resolveManeuverType(instruction, isOffRoute) {
  if (isOffRoute) {
    return 'warning';
  }

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
        size={28}
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
        width={34}
        height={34}
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

  return <Ionicons name={fallbackIcon} size={30} color={glyphColor} />;
}

const BANNER_TOP_OFFSET = 70;
const BANNER_FALLBACK_HEIGHT = 96;
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
  const subtitle = navigationModel.hasArrived && navigationModel.arrivalHint
    ? navigationModel.arrivalHint
    : `${navigationModel.maneuverDistanceLabel} até ${
        navigationModel.maneuverDistanceTargetLabel || 'o destino'
      }`;
  const maneuverType = navigationModel.hasArrived && !isOffRoute
    ? 'arrived'
    : resolveManeuverType(title, isOffRoute);

  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrap, { top: insetsTop + BANNER_TOP_OFFSET }]}
      onLayout={handleBannerLayout}
      testID="leaf-native-navigation-banner"
    >
      <LeafGlassSurface tone="dark" style={[styles.card, isOffRoute && styles.cardWarning]}>
        <View style={styles.iconWrap}>
          <ManeuverGlyph
            type={maneuverType}
            color={isOffRoute ? '#8A3A06' : '#FFFFFF'}
          />
        </View>

        <View style={styles.copy}>
          <Text style={styles.title} numberOfLines={2}>
            {title}
          </Text>
          <Text style={styles.subtitle} numberOfLines={2}>
            {subtitle}
          </Text>
        </View>

        <View style={styles.meta}>
          <Text style={styles.metaDistance}>{navigationModel.remainingDistanceLabel}</Text>
          <Text style={styles.metaEta}>{navigationModel.etaLabel}</Text>
          <View style={styles.metaActions}>
          {typeof onOpenNavigation === 'function' ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Navegar com Waze ou Google Maps"
              hitSlop={10}
              onPress={onOpenNavigation}
              style={styles.navigationButton}
            >
              <Text style={styles.navigationButtonText}>Navegar</Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Ocultar navegação LEAF"
            hitSlop={10}
            onPress={onHide}
            style={styles.hideButton}
          >
            <Ionicons name="close" size={14} color="#FFFFFF" />
          </Pressable>
          </View>
        </View>
      </LeafGlassSurface>
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
    minHeight: compact(96, 76),
    borderRadius: 22,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    shadowColor: '#183026',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.16,
    shadowRadius: 22,
    elevation: 12,
  },
  cardWarning: {
    backgroundColor: 'rgba(255,247,237,0.98)',
    borderColor: 'rgba(251,146,60,0.36)',
  },
  iconWrap: {
    width: compact(52, 44),
    height: compact(52, 44),
    borderRadius: compact(26, 22),
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    ...leafTypography.semiBold,
    fontSize: compact(22, 18),
    lineHeight: compact(28, 23),
    color: '#FFFFFF',
  },
  subtitle: {
    ...leafTypography.regular,
    fontSize: 14,
    lineHeight: 20,
    color: 'rgba(255,255,255,0.78)',
    marginTop: 4,
  },
  meta: {
    width: compact(88, 96),
    alignItems: 'flex-end',
    gap: 2,
  },
  metaDistance: {
    ...leafTypography.semiBold,
    fontSize: 15,
    color: '#FFFFFF',
  },
  metaEta: {
    ...leafTypography.regular,
    fontSize: 12,
    color: 'rgba(255,255,255,0.72)',
  },
  metaActions: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  navigationButton: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  navigationButtonText: {
    ...leafTypography.semiBold,
    fontSize: 11,
    color: '#FFFFFF',
  },
  hideButton: {
    width: 26,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  hideButtonText: {
    ...leafTypography.semiBold,
    fontSize: 11,
    color: '#FFFFFF',
  },
});
