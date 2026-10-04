import leafTypography from '../../components/prototype/LeafTypography';
import { RobotaxiLifecycleSummary } from '../../components/prototype/RobotaxiLifecycleUI';
import React, { useCallback, useRef, useState } from 'react';
import { StatusBar, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import PrototypeScreenTransition from '../../components/prototype/PrototypeScreenTransition';
import PrototypeDismissibleSheet from '../../components/prototype/PrototypeDismissibleSheet';
import {
  RobotaxiLifecycleButton,
  RobotaxiLifecycleCard,
  robotaxiLifecycleMetrics,
} from '../../components/prototype/RobotaxiLifecycleUI';
import robotaxiPrototypeTokens from '../../components/design-system/robotaxiPrototypeTokens';
import { clearRidePaymentSession } from '../../services/RidePaymentSessionService';
import { usePrototypeMapOcclusion } from './prototypeMapOcclusion';
import { usePrototypeRideRuntime } from './prototypeRideRuntime';

const { color, typography } = robotaxiPrototypeTokens;
const SHEET_BOTTOM_OFFSET = 0;
const FALLBACK_CARD_HEIGHT = 244;

export default function RobotaxiPaymentFailedScreen({ navigation, route }) {
  const {
    confirmedBookingRetryAvailable,
    retryConfirmedBookingMaterialization,
  } = usePrototypeRideRuntime();
  const insets = useSafeAreaInsets();
  const [cardHeight, setCardHeight] = useState(FALLBACK_CARD_HEIGHT);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState('');
  const retryGuardRef = useRef(false);
  const sheetBottom =
    SHEET_BOTTOM_OFFSET + robotaxiLifecycleMetrics.cardBottomGap;

  const title = route?.params?.title || 'Pagamento não confirmado';
  const errorMessage = route?.params?.errorMessage || 'Não conseguimos confirmar o pagamento desta vez.';
  const requestedRetryRouteName = route?.params?.retryRouteName || 'RobotaxiPrototype';
  const retryRouteName = requestedRetryRouteName === 'RobotaxiPrototype'
    ? requestedRetryRouteName
    : 'RobotaxiPrototype';
  const retryParams =
    retryRouteName === 'RobotaxiPrototype' ? {} : route?.params?.retryParams || {};
  const confirmedRetryRequested = route?.params?.retryConfirmedBooking === true;
  const confirmedRetryReady = Boolean(
    confirmedRetryRequested &&
      confirmedBookingRetryAvailable &&
      typeof retryConfirmedBookingMaterialization === 'function',
  );
  const confirmedRetryUnavailable = confirmedRetryRequested && !confirmedRetryReady;
  const visibleMessage = retrying
    ? 'Pagamento já confirmado. Estamos reenviando somente a solicitação da corrida.'
    : retryError ||
      (confirmedRetryUnavailable
        ? 'Não foi possível recuperar com segurança a confirmação deste Pix. Não iniciaremos uma nova cobrança.'
        : errorMessage);

  usePrototypeMapOcclusion({
    routeKey: route?.key,
    layerId: route?.key || 'prototype-payment-failed',
    occludedBottom: sheetBottom + cardHeight
  });

  const handleCardLayout = useCallback(event => {
    const nextHeight = event?.nativeEvent?.layout?.height;
    if (Number.isFinite(nextHeight) && nextHeight > 0) {
      setCardHeight(nextHeight);
    }
  }, []);

  const handleDismiss = () => {
    if (confirmedRetryRequested) {
      return;
    }
    navigation.navigate('RobotaxiPrototype');
  };

  const handleRetry = useCallback(async () => {
    if (!confirmedRetryRequested) {
      navigation.replace(retryRouteName, retryParams);
      return;
    }

    if (!confirmedRetryReady || retryGuardRef.current) {
      return;
    }

    retryGuardRef.current = true;
    setRetrying(true);
    setRetryError('');
    try {
      const retryResult = await retryConfirmedBookingMaterialization();
      const bookingPayload = retryResult?.bookingPayload || {};
      const destination = bookingPayload?.destination || {};
      const fare = Number(bookingPayload?.fare);
      const paymentSession = retryResult?.paymentSession || {};

      await clearRidePaymentSession({
        passengerId: retryResult?.passengerId || '',
        paymentSessionId: paymentSession.paymentSessionId,
        contextKey: paymentSession.contextKey,
        chargeId: paymentSession.chargeId,
      }).catch(() => false);

      navigation.replace('RobotaxiPrototypePaymentSuccess', {
        destination: destination.name || 'Destino',
        destinationAddress: destination.address || destination.name || 'Destino',
        destinationCoordinate: destination.coordinate || null,
        initialSelectedDestination: destination,
        selectedFare: Number.isFinite(fare) && fare > 0 ? fare : undefined,
        fare: Number.isFinite(fare) && fare > 0 ? fare : undefined,
        originAddress: bookingPayload.originAddress || 'Origem atual',
        vehicle: bookingPayload.vehicle || 'Leaf Plus',
        autoAdvance: true,
      });
    } catch (error) {
      setRetryError(
        error?.message ||
          'Não foi possível solicitar a corrida. Nenhum novo Pix foi iniciado.',
      );
    } finally {
      retryGuardRef.current = false;
      setRetrying(false);
    }
  }, [
    confirmedRetryReady,
    confirmedRetryRequested,
    navigation,
    retryConfirmedBookingMaterialization,
    retryParams,
    retryRouteName,
  ]);

  return (
    <PrototypeScreenTransition direction="up">
      <View
        style={styles.container}
        pointerEvents="box-none"
        testID="passenger-payment-failed-screen"
        accessibilityLabel={title}
      >
        <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />

        <PrototypeDismissibleSheet
          onClose={handleDismiss}
          sheetStyle={[styles.sheetWrap, { bottom: sheetBottom }]}
          dragEnabled={!confirmedRetryRequested}
          backdropDismissEnabled={!confirmedRetryRequested}
        >
          <RobotaxiLifecycleCard onLayout={handleCardLayout} style={[styles.card, { paddingBottom: robotaxiLifecycleMetrics.cardPaddingBottom + insets.bottom }]}>

            <RobotaxiLifecycleSummary title={title} subtitle={visibleMessage} object="payment" />

            <RobotaxiLifecycleButton
              label={retrying ? 'Reenviando corrida' : 'Tentar novamente'}
              icon={retrying ? 'time-outline' : 'refresh-outline'}
              tone="primary"
              disabled={retrying || confirmedRetryUnavailable}
              onPress={handleRetry}
              style={styles.primaryButton}
              testID="payment-failed-button-Tentar novamente"
            />

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
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.text.primary,
    shadowColor: color.shadow.base,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.14,
    shadowRadius: 14,
    elevation: 8
  },
  title: {
    marginTop: 10,
    color: color.text.primary,
    ...leafTypography.semiBold,
    fontSize: 22,
    lineHeight: 28,
    textAlign: 'left'
  },
  subtitle: {
    marginTop: 4,
    color: color.text.secondary,
    ...leafTypography.regular,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'left'
  },
  primaryButton: {
    marginTop: 12
  }
});
