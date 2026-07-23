import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import robotaxiPrototypeTokens from '../../../components/design-system/robotaxiPrototypeTokens';
import { fonts } from '../../../theme/runtimeTokens';
import { usePrototypeMapOcclusion } from '../prototypeMapOcclusion';

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

export default function LeafNativeNavigationBanner({
  routeKey,
  insetsTop = 0,
  navigationModel = null,
  onOpenNavigation,
  onHide,
}) {
  const isOffRoute = navigationModel?.isOffRoute === true;
  const isVisible = Boolean(navigationModel?.isVisible) && !isOffRoute;

  usePrototypeMapOcclusion({
    routeKey,
    layerId: `${routeKey || 'prototype-home'}-leaf-native-navigation`,
    occludedTop: isVisible ? insetsTop + 132 : 0,
  });

  if (!isVisible) {
    return null;
  }

  const title = navigationModel.currentInstruction;
  const subtitle = `${navigationModel.maneuverDistanceLabel} até ${
    navigationModel.maneuverDistanceTargetLabel || 'o destino'
  }`;
  const maneuverType = resolveManeuverType(title, isOffRoute);

  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrap, { top: insetsTop + 70 }]}
      testID="leaf-native-navigation-banner"
    >
      <View style={[styles.card, isOffRoute && styles.cardWarning]}>
        <View style={styles.iconWrap}>
          <ManeuverGlyph
            type={maneuverType}
            color={isOffRoute ? '#8A3A06' : '#173B2F'}
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
            <Text style={styles.hideButtonText}>Ocultar</Text>
          </Pressable>
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
    minHeight: 96,
    borderRadius: 22,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(248,250,247,0.97)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.76)',
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
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(65,210,116,0.15)',
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontFamily: fonts.SemiBold,
    fontSize: 18,
    lineHeight: 22,
    color: color.text.primary,
  },
  subtitle: {
    fontFamily: fonts.Regular,
    fontSize: 12,
    lineHeight: 16,
    color: '#667180',
    marginTop: 4,
  },
  meta: {
    width: 88,
    alignItems: 'flex-end',
    gap: 2,
  },
  metaDistance: {
    fontFamily: fonts.SemiBold,
    fontSize: 15,
    color: color.text.primary,
  },
  metaEta: {
    fontFamily: fonts.Regular,
    fontSize: 12,
    color: '#667180',
  },
  navigationButton: {
    marginTop: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 12,
    backgroundColor: '#111A27',
  },
  navigationButtonText: {
    fontFamily: fonts.SemiBold,
    fontSize: 11,
    color: '#FFFFFF',
  },
  hideButton: {
    marginTop: 3,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 12,
    backgroundColor: 'rgba(17,26,39,0.06)',
  },
  hideButtonText: {
    fontFamily: fonts.SemiBold,
    fontSize: 11,
    color: '#365A6D',
  },
});
