import React, { useCallback, useMemo, useState } from 'react';
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
const FALLBACK_CARD_HEIGHT = 312;

function buildFallbackRequest(runtimeState) {
  return {
    bookingId: runtimeState.activeBookingId || `fallback-${Date.now()}`,
    passenger: runtimeState.profileName || 'Passageiro Leaf',
    pickup: runtimeState.currentAddress || 'Origem atual',
    dropoff: runtimeState.selectedDestination?.name || 'Destino',
    eta: `${Math.max(2, Number(runtimeState.tripDurationMin || 6))} min`,
    payout: `R$ ${Number(runtimeState.selectedFare || 0).toFixed(2).replace('.', ',')}`
  };
}

export default function RobotaxiDriverOfferScreen({ navigation, route }) {
  const runtime = usePrototypeRideRuntime();
  const { driverOffers, acceptDriverOffer, rejectDriverOffer, lastError } = runtime;
  const insets = useSafeAreaInsets();
  const [cardHeight, setCardHeight] = useState(FALLBACK_CARD_HEIGHT);
  const [busyAction, setBusyAction] = useState('');
  const sheetBottom = insets.bottom + SHEET_BOTTOM_OFFSET;

  const request = useMemo(() => {
    const routeRequest = route?.params?.request;
    if (routeRequest?.bookingId || routeRequest?.id) {
      return routeRequest;
    }
    if (Array.isArray(driverOffers) && driverOffers.length > 0) {
      return driverOffers[0];
    }
    return buildFallbackRequest(runtime);
  }, [driverOffers, route?.params?.request, runtime]);

  usePrototypeMapOcclusion({
    routeKey: route?.key,
    layerId: route?.key || 'prototype-driver-offer',
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

  const handleAccept = useCallback(async () => {
    try {
      setBusyAction('accept');
      await acceptDriverOffer(request);
      navigation.navigate('RobotaxiPrototypeDriverTrip', { request });
    } catch (error) {
      Alert.alert('Não foi possível aceitar', error?.message || 'Falha ao aceitar corrida.');
    } finally {
      setBusyAction('');
    }
  }, [acceptDriverOffer, navigation, request]);

  const handleReject = useCallback(async () => {
    try {
      setBusyAction('reject');
      await rejectDriverOffer(request, 'Recusada pelo motorista no protótipo.');
      navigation.goBack();
    } catch (error) {
      Alert.alert('Não foi possível recusar', error?.message || 'Falha ao recusar corrida.');
    } finally {
      setBusyAction('');
    }
  }, [navigation, rejectDriverOffer, request]);

  return (
    <PrototypeScreenTransition>
      <View style={styles.container} pointerEvents="box-none">
        <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />

        <PrototypeDismissibleSheet onClose={handleDismiss} sheetStyle={[styles.sheetWrap, { bottom: sheetBottom }]}>
          <PrototypeCard onLayout={handleCardLayout} style={styles.offerCard}>
            <CardHandle />
            <Text style={styles.title}>Nova corrida disponível</Text>
            <Text style={styles.subtitle}>Revise detalhes antes de aceitar</Text>

            <View style={styles.offerBox}>
              <View style={styles.offerRow}>
                <Text style={styles.offerLabel}>Passageiro</Text>
                <Text style={styles.offerValue}>{request.passenger}</Text>
              </View>
              <View style={styles.offerRow}>
                <Text style={styles.offerLabel}>Embarque</Text>
                <Text style={styles.offerValue}>{request.pickup}</Text>
              </View>
              <View style={styles.offerRow}>
                <Text style={styles.offerLabel}>Destino</Text>
                <Text style={styles.offerValue}>{request.dropoff}</Text>
              </View>
              <View style={[styles.offerRow, styles.offerRowLast]}>
                <Text style={styles.offerLabel}>Estimativa</Text>
                <Text style={styles.offerValue}>
                  {request.eta} - {request.payout}
                </Text>
              </View>
            </View>

            <View style={styles.actionsRow}>
              <TouchableOpacity style={styles.rejectButton} activeOpacity={0.86} onPress={busyAction ? undefined : handleReject}>
                <Ionicons name="close-outline" size={16} color={color.text.primary} />
                <Text style={styles.rejectText}>{busyAction === 'reject' ? 'Recusando...' : 'Recusar'}</Text>
              </TouchableOpacity>

              <PrototypePrimaryButton
                label={busyAction === 'accept' ? 'Aceitando...' : 'Aceitar corrida'}
                icon="checkmark-outline"
                onPress={busyAction ? undefined : handleAccept}
                style={styles.acceptButton}
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
  offerCard: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 12
  },
  title: {
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: typography.subtitle.size,
    lineHeight: typography.subtitle.lineHeight
  },
  subtitle: {
    marginTop: 1,
    color: color.text.secondary,
    fontFamily: fonts.Regular,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  offerBox: {
    marginTop: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: color.border.subtle,
    backgroundColor: color.surface.secondary,
    overflow: 'hidden'
  },
  offerRow: {
    minHeight: 42,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.border.separator
  },
  offerRowLast: {
    borderBottomWidth: 0
  },
  offerLabel: {
    color: color.text.secondary,
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  offerValue: {
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  actionsRow: {
    marginTop: 10,
    flexDirection: 'row',
    gap: 8
  },
  rejectButton: {
    flex: 1,
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: color.border.strong,
    backgroundColor: color.surface.secondary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6
  },
  rejectText: {
    color: color.text.primary,
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  acceptButton: {
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
