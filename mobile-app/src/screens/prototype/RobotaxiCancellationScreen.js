import React, { useCallback, useMemo, useState } from 'react';
import { Alert, StatusBar, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { fonts } from '../../theme/runtimeTokens';
import PrototypeScreenTransition from '../../components/prototype/PrototypeScreenTransition';
import PrototypeDismissibleSheet from '../../components/prototype/PrototypeDismissibleSheet';
import {
  RobotaxiLifecycleButton,
  RobotaxiLifecycleCard,
  RobotaxiLifecycleDisclosure,
  robotaxiLifecycleMetrics,
} from '../../components/prototype/RobotaxiLifecycleUI';
import robotaxiPrototypeTokens from '../../components/design-system/robotaxiPrototypeTokens';
import { usePrototypeMapOcclusion } from './prototypeMapOcclusion';
import { usePrototypeRideRuntime } from './prototypeRideRuntime';
import { isTerminalRideStatus, normalizeRuntimeRideStatus } from './rideLifecycleContract';
import { formatCurrencyBRL } from './tripFinancialSummary';

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
    paymentState,
  } = runtime;
  const insets = useSafeAreaInsets();
  const [cardHeight, setCardHeight] = useState(FALLBACK_CARD_HEIGHT);
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancellationActionsVisible, setCancellationActionsVisible] = useState(false);
  const sheetBottom =
    insets.bottom + SHEET_BOTTOM_OFFSET + robotaxiLifecycleMetrics.cardBottomGap;
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
  const cancellationOutcome = route?.params?.cancellationOutcome || {};
  const firstFiniteMoney = (...values) => {
    for (const value of values) {
      const numeric = Number(value);
      if (Number.isFinite(numeric) && numeric >= 0) {
        return numeric;
      }
    }
    return null;
  };
  const originalPaidAmount = firstFiniteMoney(
    cancellationOutcome?.originalPaidAmount,
    route?.params?.originalPaidAmount,
    paymentState?.originalPaidAmount,
    paymentState?.amount,
  );
  const refundAmount = firstFiniteMoney(
    cancellationOutcome?.refundAmount,
    route?.params?.refundAmount,
    paymentState?.refundAmount,
  );
  const cancellationFee = firstFiniteMoney(
    cancellationOutcome?.cancellationFee,
    route?.params?.cancellationFee,
    paymentState?.cancellationFee,
  );
  const refundStatus = String(
    cancellationOutcome?.refundStatus ||
      route?.params?.refundStatus ||
      paymentState?.refundStatus ||
      '',
  ).trim().toUpperCase();
  const hasFinancialOutcome =
    (originalPaidAmount !== null && originalPaidAmount > 0) ||
    (refundAmount !== null && refundAmount > 0) ||
    (cancellationFee !== null && cancellationFee > 0);
  const isIntegralRefund =
    ['REFUNDED', 'REFUNDED_FULL', 'ALREADY_REFUNDED'].includes(refundStatus) &&
    Number(cancellationFee || 0) === 0 &&
    Number(refundAmount || 0) > 0;
  const terminalSubtitle = isIntegralRefund
    ? refundStatus === 'ALREADY_REFUNDED'
      ? 'O reembolso integral já foi registrado no mesmo Pix usado no pagamento.'
      : 'O reembolso integral foi registrado no mesmo Pix usado no pagamento.'
    : hasFinancialOutcome
      ? 'Os valores abaixo refletem a política aplicada ao momento do cancelamento.'
      : 'A solicitação foi encerrada. Você pode pedir uma nova corrida quando quiser.';

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
      isDriverCancellation ? 'RobotaxiPrototype' : 'RobotaxiPrototypeTrip',
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
          <RobotaxiLifecycleCard onLayout={handleCardLayout} style={styles.card}>

            <View style={styles.iconWrap}>
              <Ionicons name="close-circle-outline" size={30} color="#FFFFFF" />
            </View>

            <Text style={styles.title}>
              {isTerminalCancellation ? terminalCancellationTitle : 'Cancelar corrida'}
            </Text>
            <Text style={styles.subtitle}>
              {isTerminalCancellation
                ? terminalSubtitle
                : isPassengerCancellation
                  ? 'Ao cancelar agora, encerramos esta solicitação e você volta para o mapa.'
                  : 'Confirme o cancelamento para voltar ao estado inicial.'}
            </Text>

            {isTerminalCancellation && hasFinancialOutcome ? (
              <View style={styles.financialSummary} testID="cancellation-financial-summary">
                {originalPaidAmount !== null && originalPaidAmount > 0 ? (
                  <View style={styles.financialRow}>
                    <Text style={styles.financialLabel}>Pix pago</Text>
                    <Text style={styles.financialValue}>{formatCurrencyBRL(originalPaidAmount)}</Text>
                  </View>
                ) : null}
                {refundAmount !== null && refundAmount > 0 ? (
                  <View style={styles.financialRow}>
                    <Text style={styles.financialLabel}>Reembolso</Text>
                    <Text style={styles.financialValue}>{formatCurrencyBRL(refundAmount)}</Text>
                  </View>
                ) : null}
                {cancellationFee !== null ? (
                  <View style={[styles.financialRow, styles.financialRowLast]}>
                    <Text style={styles.financialLabel}>Taxa de cancelamento</Text>
                    <Text style={styles.financialValue}>{formatCurrencyBRL(cancellationFee)}</Text>
                  </View>
                ) : null}
              </View>
            ) : (
              <View style={styles.warningBox}>
                <Text style={styles.warningText}>Você pode pedir uma nova corrida logo depois, se precisar.</Text>
              </View>
            )}

            {isTerminalCancellation ? (
              <RobotaxiLifecycleButton
                label="Voltar ao mapa"
                icon="map-outline"
                tone="primary"
                onPress={handleConfirmCancellation}
                style={styles.keepButton}
                testID="passenger-cancellation-keep-button"
                accessibilityLabel="Voltar ao mapa"
              />
            ) : (
              <>
                <RobotaxiLifecycleButton
                  label="Continuar corrida"
                  icon="arrow-back-outline"
                  tone="primary"
                  onPress={handleDismiss}
                  style={styles.keepButton}
                  testID="passenger-cancellation-keep-button"
                  accessibilityLabel="Continuar corrida"
                />
                <RobotaxiLifecycleDisclosure
                  expanded={cancellationActionsVisible}
                  onPress={() => setCancellationActionsVisible((visible) => !visible)}
                  label="Cancelar mesmo"
                  expandedLabel="Ocultar cancelamento"
                  style={styles.cancellationDisclosure}
                  testID="passenger-cancellation-more-options-button"
                />
                {cancellationActionsVisible ? (
                  <RobotaxiLifecycleButton
                    label={isCancelling ? 'Cancelando...' : 'Confirmar cancelamento'}
                    icon="close-outline"
                    tone="danger"
                    disabled={isCancelling}
                    onPress={handleConfirmCancellation}
                    style={styles.cancelButton}
                    testID="passenger-cancellation-confirm-button"
                    accessibilityLabel="Confirmar cancelamento"
                  />
                ) : null}
              </>
            )}
          </RobotaxiLifecycleCard>
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
    marginHorizontal: robotaxiLifecycleMetrics.cardHorizontalMargin,
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
    fontSize: 15.5,
    lineHeight: 20,
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
  financialSummary: {
    marginTop: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: color.border.subtle,
    backgroundColor: color.surface.secondary,
    paddingHorizontal: 12,
  },
  financialRow: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.border.subtle,
  },
  financialRowLast: {
    borderBottomWidth: 0,
  },
  financialLabel: {
    flex: 1,
    color: color.text.secondary,
    fontFamily: fonts.Regular,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight,
  },
  financialValue: {
    marginLeft: 12,
    color: color.text.primary,
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight,
  },
  cancelButton: {
    marginTop: 8,
    width: '100%'
  },
  keepButton: {
    marginTop: 10,
    width: '100%'
  },
  cancellationDisclosure: {
    marginTop: 8,
    width: '100%'
  }
});
