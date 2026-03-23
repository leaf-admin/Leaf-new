import React, { useCallback, useEffect, useState } from 'react';
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
const SHEET_BOTTOM_OFFSET = 100;
const FALLBACK_CARD_HEIGHT = 258;

export default function RobotaxiTripScreen({ navigation, route }) {
  const { bookingStatus, selectedDestination, selectedVehicle, selectedFare, tripDistanceKm, tripDurationMin, driverInfo, startTripFlow, completeTripFlow } =
    usePrototypeRideRuntime();
  const insets = useSafeAreaInsets();
  const [cardHeight, setCardHeight] = useState(FALLBACK_CARD_HEIGHT);
  const sheetBottom = insets.bottom + SHEET_BOTTOM_OFFSET;

  const destination = route?.params?.destination || selectedDestination?.name || 'Destino';
  const vehicle = route?.params?.vehicle || selectedVehicle || 'Leaf Plus';
  const distanceLabel = Number.isFinite(tripDistanceKm) ? `${tripDistanceKm.toFixed(1)} km` : ' -- ';
  const fareLabel = Number.isFinite(selectedFare) ? `R$ ${Number(selectedFare).toFixed(2)}` : '--';
  const isAccepted = bookingStatus === 'accepted';
  const primaryActionLabel = isAccepted ? 'Iniciar viagem' : 'Finalizar corrida';
  const arrivalLabel =
    Number.isFinite(tripDurationMin) && tripDurationMin > 0
      ? `Chegada em ${tripDurationMin} min`
      : isAccepted
        ? 'Aguardando início da viagem'
        : 'Viagem em andamento';

  const handleDismiss = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('RobotaxiPrototype');
  };

  usePrototypeMapOcclusion({
    routeKey: route?.key,
    layerId: route?.key || 'prototype-trip',
    occludedBottom: sheetBottom + cardHeight
  });

  const handleCardLayout = useCallback(event => {
    const nextHeight = event?.nativeEvent?.layout?.height;
    if (Number.isFinite(nextHeight) && nextHeight > 0) {
      setCardHeight(nextHeight);
    }
  }, []);

  const handlePrimaryAction = useCallback(async () => {
    try {
      if (isAccepted) {
        await startTripFlow();
        return;
      }

      await completeTripFlow();
      navigation.navigate('RobotaxiPrototypeReceipt', { fromTrip: true });
    } catch (error) {
      Alert.alert('Não foi possível concluir', error?.message || 'Falha ao atualizar o status da viagem.');
    }
  }, [completeTripFlow, isAccepted, navigation, startTripFlow]);

  useEffect(() => {
    if (bookingStatus === 'completed') {
      navigation.navigate('RobotaxiPrototypeReceipt', { fromTrip: true });
    }
  }, [bookingStatus, navigation]);

  return (
    <PrototypeScreenTransition>
      <View style={styles.container} pointerEvents="box-none">
        <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />
        <PrototypeDismissibleSheet
          onClose={handleDismiss}
          sheetStyle={[styles.sheetWrap, { bottom: sheetBottom }]}
        >
          <PrototypeCard onLayout={handleCardLayout} style={styles.tripCard}>
            <CardHandle />

            <View style={styles.statusRow}>
              <View style={styles.statusChip}>
                <Text style={styles.statusChipText}>{isAccepted ? 'A CAMINHO' : 'EM VIAGEM'}</Text>
              </View>
              <Text style={styles.arrivalText}>{arrivalLabel}</Text>
            </View>

            <Text style={styles.destinationText}>{destination}</Text>
            {driverInfo?.name ? <Text style={styles.driverText}>Motorista: {driverInfo.name}</Text> : null}

            <View style={styles.metaRow}>
              <View style={styles.metaBlock}>
                <Ionicons name="car-sport-outline" size={15} color={color.text.primary} />
                <Text style={styles.metaLabel}>{vehicle}</Text>
              </View>

              <View style={styles.metaBlock}>
                <Ionicons name="speedometer-outline" size={15} color={color.text.primary} />
                <Text style={styles.metaLabel}>{distanceLabel}</Text>
              </View>

              <View style={styles.metaBlock}>
                <Ionicons name="cash-outline" size={15} color={color.text.primary} />
                <Text style={styles.metaLabel}>{fareLabel}</Text>
              </View>
            </View>

            <View style={styles.actionsRow}>
              <TouchableOpacity
                style={styles.secondaryAction}
                activeOpacity={0.86}
                onPress={() => navigation.navigate('RobotaxiPrototypeChat')}
              >
                <Ionicons name="chatbubble-ellipses-outline" size={15} color={color.text.primary} />
                <Text style={styles.secondaryActionText}>Chat</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.secondaryAction}
                activeOpacity={0.86}
                onPress={() => navigation.navigate('RobotaxiPrototypeSupport')}
              >
                <Ionicons name="shield-checkmark-outline" size={15} color={color.text.primary} />
                <Text style={styles.secondaryActionText}>Suporte</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={styles.cancelAction}
              activeOpacity={0.86}
              onPress={() => navigation.navigate('RobotaxiPrototypeCancellation', { source: 'trip' })}
            >
              <Ionicons name="close-circle-outline" size={15} color={color.text.primary} />
              <Text style={styles.cancelActionText}>Cancelar corrida</Text>
            </TouchableOpacity>

            <PrototypePrimaryButton
              label={primaryActionLabel}
              icon="flag-outline"
              onPress={handlePrimaryAction}
              style={styles.finishButton}
            />
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
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  statusChip: {
    minHeight: 26,
    borderRadius: 13,
    paddingHorizontal: 10,
    justifyContent: 'center',
    backgroundColor: color.surface.activeSoft,
    borderWidth: 1,
    borderColor: color.border.strong
  },
  statusChipText: {
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight,
    letterSpacing: 0.5
  },
  arrivalText: {
    color: color.text.secondary,
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  destinationText: {
    marginTop: 8,
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: typography.subtitle.size,
    lineHeight: typography.subtitle.lineHeight
  },
  driverText: {
    marginTop: 2,
    color: color.text.secondary,
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  metaRow: {
    marginTop: 10,
    flexDirection: 'row',
    gap: 8
  },
  metaBlock: {
    flex: 1,
    minHeight: 42,
    borderRadius: 12,
    backgroundColor: color.surface.secondary,
    borderWidth: 1,
    borderColor: color.border.subtle,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6
  },
  metaLabel: {
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
  secondaryAction: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: color.border.subtle,
    backgroundColor: color.surface.secondary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6
  },
  secondaryActionText: {
    color: color.text.primary,
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  cancelAction: {
    marginTop: 8,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: color.border.strong,
    backgroundColor: color.surface.secondary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6
  },
  cancelActionText: {
    color: color.text.primary,
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  finishButton: {
    marginTop: 10
  }
});
