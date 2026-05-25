import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PrototypePrimaryButton } from '../../../components/prototype/PrototypeUI';
import { leafButtonMetrics } from '../../../components/prototype/LeafRideUI';
import robotaxiPrototypeTokens from '../../../components/design-system/robotaxiPrototypeTokens';
import { fonts } from '../../../theme/runtimeTokens';
import { usePrototypeMapOcclusion } from '../prototypeMapOcclusion';

const { color } = robotaxiPrototypeTokens;

export default function DriverTripStatusBanner({
  routeKey,
  insetsTop = 0,
  tripAssist = null,
  onPrimaryAction,
  onOpenNavigation
}) {
  const isVisible = Boolean(tripAssist?.status);

  usePrototypeMapOcclusion({
    routeKey,
    layerId: `${routeKey || 'prototype-home'}-driver-trip-banner`,
    occludedTop: isVisible ? insetsTop + 134 : 0
  });

  if (!isVisible) {
    return null;
  }

  const showNavigationButton =
    tripAssist?.navigationPhase === 'pickup' || tripAssist?.navigationPhase === 'destination';

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { top: insetsTop + 72 }]}>
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>{tripAssist.title}</Text>
            <Text style={styles.subtitle}>{tripAssist.subtitle}</Text>
          </View>
          <View style={styles.metaPill}>
            <Ionicons name="time-outline" size={14} color="#365A6D" />
            <Text style={styles.metaPillText}>{tripAssist.etaLabel}</Text>
          </View>
        </View>

        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.max(4, Math.round((tripAssist.progressRatio || 0) * 100))}%` }]} />
        </View>

        <View style={styles.infoRow}>
          <Text style={styles.infoText}>{tripAssist.navigationPhase === 'pickup' ? 'Restante até o embarque' : 'Restante até o destino'}</Text>
          <Text style={styles.infoValue}>{tripAssist.remainingDistanceLabel}</Text>
        </View>

        <View style={styles.actionsRow}>
          {showNavigationButton ? (
            <PrototypePrimaryButton
              label="Abrir navegação"
              icon="navigate-outline"
              style={styles.secondaryButton}
              onPress={onOpenNavigation}
            />
          ) : null}

          <PrototypePrimaryButton
            label={tripAssist.primaryActionLabel}
            icon={
              tripAssist.status === 'accepted'
                ? 'checkmark-circle-outline'
                : tripAssist.status === 'arrived'
                  ? 'play-outline'
                  : 'flag-outline'
            }
            disabled={!tripAssist.primaryActionEnabled}
            style={[styles.primaryButton, !showNavigationButton && styles.primaryButtonFull]}
            onPress={onPrimaryAction}
          />
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
    alignItems: 'center',
    zIndex: 20
  },
  card: {
    width: '92%',
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: 'rgba(248,250,247,0.96)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.74)',
    shadowColor: '#183026',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.16,
    shadowRadius: 22,
    elevation: 12
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12
  },
  headerCopy: {
    flex: 1
  },
  eyebrow: {
    fontFamily: fonts.SemiBold,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    color: '#1A330E'
  },
  subtitle: {
    marginTop: 4,
    fontFamily: fonts.Medium,
    fontSize: 13,
    lineHeight: 18,
    color: color.text.secondary
  },
  metaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 999,
    backgroundColor: 'rgba(208,225,236,0.52)',
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  metaPillText: {
    marginLeft: 6,
    fontFamily: fonts.SemiBold,
    fontSize: 12,
    color: '#365A6D'
  },
  progressTrack: {
    marginTop: 12,
    height: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(26,122,62,0.12)',
    overflow: 'hidden'
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#1A330E'
  },
  infoRow: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12
  },
  infoText: {
    flex: 1,
    fontFamily: fonts.Medium,
    fontSize: 12,
    color: color.text.secondary
  },
  infoValue: {
    fontFamily: fonts.SemiBold,
    fontSize: 13,
    color: color.text.primary
  },
  actionsRow: {
    marginTop: 12,
    flexDirection: 'row',
    gap: 10
  },
  secondaryButton: {
    flex: 1,
    minHeight: leafButtonMetrics.height,
    borderRadius: leafButtonMetrics.radius,
    backgroundColor: '#274A36'
  },
  primaryButton: {
    flex: 1.15,
    minHeight: leafButtonMetrics.height,
    borderRadius: leafButtonMetrics.radius
  },
  primaryButtonFull: {
    flex: 1
  }
});
