import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { fonts } from '../../common-local/font';
import PrototypeScreenTransition from '../../components/prototype/PrototypeScreenTransition';
import PrototypeDismissibleSheet from '../../components/prototype/PrototypeDismissibleSheet';
import { CardHandle, PrototypeCard, PrototypePrimaryButton } from '../../components/prototype/PrototypeUI';
import robotaxiPrototypeTokens from '../../components/design-system/robotaxiPrototypeTokens';
import { usePrototypeMapOcclusion } from './prototypeMapOcclusion';
import { usePrototypeRideRuntime } from './prototypeRideRuntime';

const { color, typography } = robotaxiPrototypeTokens;
const SHEET_BOTTOM_OFFSET = 96;
const FALLBACK_CARD_HEIGHT = 326;

function formatCurrency(value) {
  return `R$ ${Number(value || 0).toFixed(2).replace('.', ',')}`;
}

export default function RobotaxiDriverTripScreen({ navigation, route }) {
  const {
    bookingStatus,
    driverActiveRide,
    selectedDestination,
    selectedFare,
    currentAddress,
    tripDistanceKm,
    tripDurationMin,
    startTripFlow,
    completeTripFlow,
    lastError
  } = usePrototypeRideRuntime();
  const insets = useSafeAreaInsets();
  const [cardHeight, setCardHeight] = useState(FALLBACK_CARD_HEIGHT);
  const [busyAction, setBusyAction] = useState(false);
  const sheetBottom = insets.bottom + SHEET_BOTTOM_OFFSET;

  const request = useMemo(() => {
    if (route?.params?.request) {
      return route.params.request;
    }

    if (driverActiveRide) {
      return driverActiveRide;
    }

    return {
      passenger: 'Passageiro Leaf',
      pickup: currentAddress || 'Origem atual',
      dropoff: selectedDestination?.name || 'Destino',
      payout: formatCurrency(selectedFare || 0)
    };
  }, [currentAddress, driverActiveRide, route?.params?.request, selectedDestination?.name, selectedFare]);

  const phase = useMemo(() => {
    if (bookingStatus === 'accepted') {
      return {
        title: 'A caminho do embarque',
        eta: `Chegada em ${Math.max(2, Number(tripDurationMin || 4))} min`,
        primaryLabel: 'Iniciar viagem'
      };
    }
    if (bookingStatus === 'started') {
      return {
        title: 'Viagem em andamento',
        eta: 'Trajeto ativo para o destino',
        primaryLabel: 'Finalizar corrida'
      };
    }
    return {
      title: 'Status da corrida',
      eta: 'Aguardando atualização',
      primaryLabel: 'Voltar ao painel'
    };
  }, [bookingStatus, tripDurationMin]);

  useEffect(() => {
    if (bookingStatus === 'completed') {
      navigation.navigate('RobotaxiPrototypeReceipt', { fromTrip: true });
    }
  }, [bookingStatus, navigation]);

  usePrototypeMapOcclusion({
    routeKey: route?.key,
    layerId: route?.key || 'prototype-driver-trip',
    occludedBottom: sheetBottom + cardHeight
  });

  const handleDismiss = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('RobotaxiPrototypeDriverPanel');
  };

  const handleCardLayout = useCallback(event => {
    const nextHeight = event?.nativeEvent?.layout?.height;
    if (Number.isFinite(nextHeight) && nextHeight > 0) {
      setCardHeight(nextHeight);
    }
  }, []);

  const handlePrimaryAction = useCallback(async () => {
    if (busyAction) {
      return;
    }

    try {
      setBusyAction(true);

      if (bookingStatus === 'accepted') {
        await startTripFlow();
        return;
      }

      if (bookingStatus === 'started') {
        await completeTripFlow();
        navigation.navigate('RobotaxiPrototypeReceipt', { fromTrip: true });
        return;
      }

      navigation.navigate('RobotaxiPrototypeDriverPanel');
    } catch (error) {
      Alert.alert('Não foi possível atualizar', error?.message || 'Falha ao atualizar corrida.');
    } finally {
      setBusyAction(false);
    }
  }, [bookingStatus, busyAction, completeTripFlow, navigation, startTripFlow]);

  return (
    <PrototypeScreenTransition>
      <View style={styles.container} pointerEvents="box-none">
        <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />

        <PrototypeDismissibleSheet onClose={handleDismiss} sheetStyle={[styles.sheetWrap, { bottom: sheetBottom }]}>
          <PrototypeCard onLayout={handleCardLayout} style={styles.tripCard}>
            <CardHandle />

            <View style={styles.statusRow}>
              <View style={styles.statusChip}>
                <Text style={styles.statusChipText}>MOTORISTA</Text>
              </View>
              <Text style={styles.statusEta}>{phase.eta}</Text>
            </View>

            <Text style={styles.phaseTitle}>{phase.title}</Text>

            <View style={styles.infoBox}>
              <View style={styles.infoRow}>
                <Ionicons name="person-outline" size={15} color={color.text.primary} />
                <Text style={styles.infoText}>{request.passenger}</Text>
              </View>
              <View style={styles.infoRow}>
                <Ionicons name="navigate-outline" size={15} color={color.text.primary} />
                <Text style={styles.infoText}>{request.pickup}</Text>
              </View>
              <View style={styles.infoRow}>
                <Ionicons name="flag-outline" size={15} color={color.text.primary} />
                <Text style={styles.infoText}>{request.dropoff}</Text>
              </View>
              <View style={[styles.infoRow, styles.infoRowLast]}>
                <Ionicons name="cash-outline" size={15} color={color.text.primary} />
                <Text style={styles.infoText}>
                  {formatCurrency(selectedFare || request.fare || 0)}
                  {Number.isFinite(tripDistanceKm) ? ` • ${tripDistanceKm.toFixed(1)} km` : ''}
                </Text>
              </View>
            </View>

            <View style={styles.actionsRow}>
              <TouchableOpacity
                style={styles.secondaryButton}
                activeOpacity={0.86}
                onPress={() => navigation.navigate('RobotaxiPrototypeChat')}
              >
                <Ionicons name="chatbubble-ellipses-outline" size={15} color={color.text.primary} />
                <Text style={styles.secondaryButtonText}>Chat</Text>
              </TouchableOpacity>

              <PrototypePrimaryButton
                label={busyAction ? 'Atualizando...' : phase.primaryLabel}
                icon="arrow-forward"
                onPress={busyAction ? undefined : handlePrimaryAction}
                style={styles.primaryInlineButton}
              />
            </View>

            {lastError ? <Text style={styles.errorText}>{lastError}</Text> : null}
          </PrototypeCard>
        </PrototypeDismissibleSheet>
      </View>
    </PrototypeScreenTransition>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent'
  },
  sheetWrap: {
    position: 'absolute',
    left: 10,
    right: 10
  },
  tripCard: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 12
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  statusChip: {
    minHeight: 26,
    borderRadius: 13,
    paddingHorizontal: 10,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: color.border.strong,
    backgroundColor: color.surface.activeSoft
  },
  statusChipText: {
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight,
    letterSpacing: 0.4
  },
  statusEta: {
    color: color.text.secondary,
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  phaseTitle: {
    marginTop: 8,
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: typography.subtitle.size,
    lineHeight: typography.subtitle.lineHeight
  },
  infoBox: {
    marginTop: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: color.border.subtle,
    backgroundColor: color.surface.secondary,
    overflow: 'hidden'
  },
  infoRow: {
    minHeight: 40,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.border.separator
  },
  infoRowLast: {
    borderBottomWidth: 0
  },
  infoText: {
    flex: 1,
    color: color.text.primary,
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  actionsRow: {
    marginTop: 10,
    flexDirection: 'row',
    gap: 8
  },
  secondaryButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: color.border.strong,
    backgroundColor: color.surface.secondary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 10
  },
  secondaryButtonText: {
    color: color.text.primary,
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  primaryInlineButton: {
    flex: 1,
    minHeight: 48,
    marginTop: 0
  },
  errorText: {
    marginTop: 8,
    color: '#8A1F2B',
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  }
});
