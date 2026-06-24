import React, { useCallback, useMemo, useState } from 'react';
import { Alert, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { fonts } from '../../theme/runtimeTokens';
import PrototypeScreenTransition from '../../components/prototype/PrototypeScreenTransition';
import PrototypeDismissibleSheet from '../../components/prototype/PrototypeDismissibleSheet';
import { CardHandle, PrototypeCard, PrototypePrimaryButton } from '../../components/prototype/PrototypeUI';
import { leafButtonMetrics } from '../../components/prototype/LeafRideUI';
import robotaxiPrototypeTokens from '../../components/design-system/robotaxiPrototypeTokens';
import { usePrototypeMapOcclusion } from './prototypeMapOcclusion';
import { usePrototypeRideRuntime } from './prototypeRideRuntime';
import { isTerminalRideStatus, normalizeRuntimeRideStatus } from './rideLifecycleContract';

const { color, typography } = robotaxiPrototypeTokens;
const SHEET_BOTTOM_OFFSET = 0;
const FALLBACK_CARD_HEIGHT = 274;

export default function RobotaxiCancellationScreen({ navigation, route }) {
  const runtime = usePrototypeRideRuntime() || {};
  const {
    activeBooking,
    activeBookingId,
    bookingStatus,
    cancelActiveRideFlow,
    cancelRideSearch,
    driverActiveRide,
  } = runtime;
  const insets = useSafeAreaInsets();
  const [cardHeight, setCardHeight] = useState(FALLBACK_CARD_HEIGHT);
  const [isCancelling, setIsCancelling] = useState(false);
  const sheetBottom = insets.bottom + SHEET_BOTTOM_OFFSET;
  const source = route?.params?.source || 'passenger-trip';
  const isDriverCancellation = source === 'driver-trip' || source === 'driver';
  const isPassengerCancellation = source === 'trip' || source === 'passenger-trip' || source === 'search';
  const cancellationContext = useMemo(() => {
    const bookingId = String(
      route?.params?.bookingId ||
        route?.params?.rideId ||
        route?.params?.tripId ||
        activeBookingId ||
        activeBooking?.bookingId ||
        activeBooking?.id ||
        driverActiveRide?.bookingId ||
        driverActiveRide?.id ||
        '',
    ).trim();
    const normalizedStatus = normalizeRuntimeRideStatus(
      route?.params?.bookingStatus ||
        route?.params?.status ||
        bookingStatus ||
        driverActiveRide?.status ||
        activeBooking?.status ||
        '',
    );

    return {
      ...(bookingId ? { bookingId, rideId: bookingId, tripId: bookingId } : {}),
      ...(normalizedStatus ? { bookingStatus: normalizedStatus } : {}),
      source,
    };
  }, [
    activeBooking?.bookingId,
    activeBooking?.id,
    activeBooking?.status,
    activeBookingId,
    bookingStatus,
    driverActiveRide?.bookingId,
    driverActiveRide?.id,
    driverActiveRide?.status,
    route?.params?.bookingId,
    route?.params?.bookingStatus,
    route?.params?.rideId,
    route?.params?.status,
    route?.params?.tripId,
    source,
  ]);
  const isTerminalCancellation = route?.params?.completed === true || source === 'search' || isTerminalRideStatus(cancellationContext.bookingStatus);
  const terminalCancellationTitle = cancellationContext.bookingStatus === 'completed' ? 'Corrida encerrada' : 'Corrida cancelada';

  const replaceOrNavigate = useCallback((routeName, params) => {
    if (typeof navigation.replace === 'function') {
      if (params === undefined) {
        navigation.replace(routeName);
      } else {
        navigation.replace(routeName, params);
      }
      return;
    }

    if (params === undefined) {
      navigation.navigate(routeName);
    } else {
      navigation.navigate(routeName, params);
    }
  }, [navigation]);

  usePrototypeMapOcclusion({
    routeKey: route?.key,
    layerId: route?.key || 'prototype-cancellation',
    occludedBottom: sheetBottom + cardHeight
  });

  const handleCardLayout = useCallback(event => {
    const nextHeight = event?.nativeEvent?.layout?.height;
    if (Number.isFinite(nextHeight) && nextHeight > 0) {
      setCardHeight(nextHeight);
    }
  }, []);

  const handleDismiss = () => {
    if (isTerminalCancellation) {
      replaceOrNavigate('RobotaxiPrototype');
      return;
    }

    if (navigation.canGoBack?.()) {
      navigation.goBack();
      return;
    }
    replaceOrNavigate(
      isDriverCancellation ? 'RobotaxiPrototypeDriverTrip' : 'RobotaxiPrototypeTrip',
      cancellationContext,
    );
  };

  const handleConfirmCancellation = useCallback(async () => {
    if (isCancelling) {
      return;
    }

    if (isTerminalCancellation) {
      replaceOrNavigate('RobotaxiPrototype');
      return;
    }

    try {
      setIsCancelling(true);
      if (isDriverCancellation && typeof cancelActiveRideFlow === 'function') {
        await cancelActiveRideFlow({
          ...cancellationContext,
          reason: 'Cancelado pelo motorista.',
        });
      } else {
        await cancelRideSearch({
          ...cancellationContext,
          reason: 'Cancelado pelo passageiro.',
        });
      }
      replaceOrNavigate('RobotaxiPrototype');
    } catch (error) {
      Alert.alert('Não conseguimos cancelar', error?.message || 'Tente novamente em instantes.');
    } finally {
      setIsCancelling(false);
    }
  }, [
    cancelActiveRideFlow,
    cancelRideSearch,
    cancellationContext,
    isCancelling,
    isDriverCancellation,
    isTerminalCancellation,
    replaceOrNavigate,
  ]);

  return (
    <PrototypeScreenTransition>
      <View style={styles.container} pointerEvents="box-none">
        <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />

        <PrototypeDismissibleSheet onClose={handleDismiss} sheetStyle={[styles.sheetWrap, { bottom: sheetBottom }]}>
          <PrototypeCard onLayout={handleCardLayout} style={styles.card}>
            <CardHandle />

            <View style={styles.iconWrap}>
              <Ionicons name="close-circle-outline" size={30} color="#FFFFFF" />
            </View>

            <Text style={styles.title}>
              {isTerminalCancellation ? terminalCancellationTitle : 'Cancelar corrida'}
            </Text>
            <Text style={styles.subtitle}>
              {isTerminalCancellation
                ? 'A solicitação foi encerrada. Você pode voltar ao mapa e pedir uma nova corrida quando quiser.'
                : isPassengerCancellation
                  ? 'Ao cancelar agora, encerramos esta solicitação e você volta para o mapa.'
                  : 'Confirme o cancelamento para voltar ao estado inicial.'}
            </Text>

            <View style={styles.warningBox}>
              <Text style={styles.warningText}>Você pode pedir uma nova corrida logo depois, se precisar.</Text>
            </View>

            <PrototypePrimaryButton
              label={
                isTerminalCancellation
                  ? 'Voltar ao mapa'
                  : isCancelling
                    ? 'Cancelando...'
                    : 'Confirmar cancelamento'
              }
              icon={isTerminalCancellation ? 'map-outline' : 'close-outline'}
              onPress={isCancelling ? undefined : handleConfirmCancellation}
              style={styles.cancelButton}
              testID="passenger-cancellation-confirm-button"
              accessibilityLabel="passenger-cancellation-confirm-button"
            />

            {!isTerminalCancellation ? (
              <TouchableOpacity
                style={styles.keepButton}
                activeOpacity={0.86}
                onPress={handleDismiss}
                testID="passenger-cancellation-keep-button"
                accessibilityLabel="passenger-cancellation-keep-button"
              >
                <Text style={styles.keepButtonText}>Continuar corrida</Text>
              </TouchableOpacity>
            ) : null}
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
    left: 0,
    right: 0
  },
  card: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    paddingHorizontal: 24,
    paddingTop: 14,
    paddingBottom: 16
  },
  iconWrap: {
    alignSelf: 'center',
    width: 62,
    height: 62,
    borderRadius: 31,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.text.primary
  },
  title: {
    marginTop: 10,
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: 18,
    lineHeight: 24,
    textAlign: 'center'
  },
  subtitle: {
    marginTop: 4,
    color: color.text.secondary,
    fontFamily: fonts.Regular,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight,
    textAlign: 'center'
  },
  warningBox: {
    marginTop: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: color.border.subtle,
    backgroundColor: color.surface.secondary,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  warningText: {
    color: color.text.secondary,
    fontFamily: fonts.Regular,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight,
    textAlign: 'center'
  },
  cancelButton: {
    marginTop: 10,
    backgroundColor: '#3B4553',
    borderColor: '#303945'
  },
  keepButton: {
    marginTop: 8,
    minHeight: leafButtonMetrics.height,
    borderRadius: leafButtonMetrics.radius,
    borderWidth: 1,
    borderColor: color.border.strong,
    backgroundColor: color.surface.secondary,
    alignItems: 'center',
    justifyContent: 'center'
  },
  keepButtonText: {
    color: color.text.primary,
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  }
});
