import React, { useCallback, useEffect, useState } from 'react';
import { Alert, StatusBar, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fonts } from '../../common-local/font';
import PrototypeScreenTransition from '../../components/prototype/PrototypeScreenTransition';
import PrototypeDismissibleSheet from '../../components/prototype/PrototypeDismissibleSheet';
import { CardHandle, PrototypeCard, PrototypePrimaryButton } from '../../components/prototype/PrototypeUI';
import WooviPaymentModal from '../../components/payment/WooviPaymentModal';
import robotaxiPrototypeTokens from '../../components/design-system/robotaxiPrototypeTokens';
import { usePrototypeMapOcclusion } from './prototypeMapOcclusion';
import { usePrototypeRideRuntime } from './prototypeRideRuntime';

const { color, typography } = robotaxiPrototypeTokens;
const SHEET_BOTTOM_OFFSET = 98;
const FALLBACK_CARD_HEIGHT = 284;

export default function RobotaxiPaymentScreen({ navigation, route }) {
  const {
    selectedDestination,
    currentAddress,
    currentCoordinate,
    profileUid,
    riderProfile,
    paymentState,
    requestRide
  } = usePrototypeRideRuntime();
  const insets = useSafeAreaInsets();
  const [cardHeight, setCardHeight] = useState(FALLBACK_CARD_HEIGHT);
  const [isPixModalVisible, setPixModalVisible] = useState(Boolean(route?.params?.autoOpenPix));
  const [submitting, setSubmitting] = useState(false);
  const sheetBottom = insets.bottom + SHEET_BOTTOM_OFFSET;

  const destination = route?.params?.destination || 'Destino';
  const destinationAddress = route?.params?.destinationAddress || selectedDestination?.address || '';
  const destinationCoordinate = route?.params?.destinationCoordinate || selectedDestination?.coordinate || null;
  const originAddress = route?.params?.originAddress || currentAddress || 'Origem atual';
  const vehicle = route?.params?.vehicle || 'Leaf Plus';
  const fare = route?.params?.fare || 22.43;
  const canRequestRide = Boolean(
    destinationCoordinate &&
      Number.isFinite(destinationCoordinate?.latitude) &&
      Number.isFinite(destinationCoordinate?.longitude)
  );

  usePrototypeMapOcclusion({
    routeKey: route?.key,
    layerId: route?.key || 'prototype-payment',
    occludedBottom: sheetBottom + cardHeight
  });

  const handleDismiss = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('RobotaxiPrototype');
  };

  const handleCardLayout = useCallback(event => {
    const nextHeight = event?.nativeEvent?.layout?.height;
    if (Number.isFinite(nextHeight) && nextHeight > 0) {
      setCardHeight(nextHeight);
    }
  }, []);

  useEffect(() => {
    if (!route?.params?.autoOpenPix) {
      return;
    }

    if (!canRequestRide) {
      return;
    }

    setPixModalVisible(true);
  }, [canRequestRide, route?.params?.autoOpenPix]);

  const handleOpenPixModal = useCallback(() => {
    if (!canRequestRide) {
      Alert.alert('Selecione um destino', 'Defina um destino válido antes de confirmar o pagamento.');
      return;
    }

    setPixModalVisible(true);
  }, [canRequestRide]);

  const handleClosePixModal = useCallback(() => {
    if (submitting) {
      return;
    }
    setPixModalVisible(false);
  }, [submitting]);

  const handlePixPaymentConfirmed = useCallback(async () => {
    if (!canRequestRide) {
      Alert.alert('Selecione um destino', 'Defina um destino válido antes de confirmar o pagamento.');
      return;
    }

    try {
      setSubmitting(true);
      setPixModalVisible(false);
      await requestRide({
        destination: {
          name: destination,
          address: destinationAddress,
          coordinate: destinationCoordinate
        },
        vehicle,
        fare,
        paymentMethod: 'pix'
      });

      navigation.replace('RobotaxiPrototypePaymentSuccess', {
        destination,
        vehicle,
        autoAdvance: true
      });
    } catch (error) {
      navigation.replace('RobotaxiPrototypePaymentFailed', {
        errorMessage: error?.message || 'Falha ao enviar a corrida para o servidor.',
        retryRouteName: 'RobotaxiPrototypePayment',
        retryParams: {
          ...route?.params,
          destination,
          destinationAddress,
          destinationCoordinate,
          originAddress,
          vehicle,
          fare,
          autoOpenPix: true
        }
      });
    } finally {
      setSubmitting(false);
    }
  }, [
    canRequestRide,
    destination,
    destinationAddress,
    destinationCoordinate,
    fare,
    navigation,
    originAddress,
    requestRide,
    route?.params,
    vehicle
  ]);

  return (
    <PrototypeScreenTransition>
      <View style={styles.container} pointerEvents="box-none">
        <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />

        <PrototypeDismissibleSheet onClose={handleDismiss} sheetStyle={[styles.sheetWrap, { bottom: sheetBottom }]}>
          <PrototypeCard onLayout={handleCardLayout} style={styles.paymentCard}>
            <CardHandle />

            <Text style={styles.title}>Pagamento PIX</Text>
            <Text style={styles.subtitle}>PIX é o único método disponível neste fluxo</Text>

            <View style={styles.summaryBox}>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Destino</Text>
                <Text style={styles.summaryValue}>{destination}</Text>
              </View>
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Categoria</Text>
                <Text style={styles.summaryValue}>{vehicle}</Text>
              </View>
              <View style={[styles.summaryRow, styles.summaryRowLast]}>
                <Text style={styles.summaryLabelStrong}>Total</Text>
                <Text style={styles.summaryValueStrong}>R$ {Number(fare).toFixed(2)}</Text>
              </View>
            </View>

            <Text style={styles.pixHint}>A cobrança será gerada em QR Code PIX para confirmação imediata.</Text>

            <PrototypePrimaryButton
              label={submitting ? 'Enviando solicitação...' : canRequestRide ? 'Pagar com PIX' : 'Selecione um destino'}
              icon="shield-checkmark-outline"
              onPress={submitting ? undefined : handleOpenPixModal}
              style={styles.ctaButton}
            />

            {!canRequestRide ? <Text style={styles.pendingText}>Abra “Para onde?” e escolha o destino antes de pagar.</Text> : null}

            {paymentState?.status === 'pending' && paymentState?.error ? (
              <Text style={styles.pendingText}>Pagamento pendente de confirmação: {paymentState.error}</Text>
            ) : null}
          </PrototypeCard>
        </PrototypeDismissibleSheet>

        <WooviPaymentModal
          visible={isPixModalVisible}
          onClose={handleClosePixModal}
          onPaymentConfirmed={handlePixPaymentConfirmed}
          tripData={{
            pickup: {
              add: originAddress,
              lat: currentCoordinate?.latitude,
              lng: currentCoordinate?.longitude
            },
            drop: {
              add: destinationAddress || destination,
              lat: destinationCoordinate?.latitude,
              lng: destinationCoordinate?.longitude
            },
            carType: vehicle,
            estimatedFare: Number(fare)
          }}
          estimates={{ estimateFare: Number(fare) }}
          passengerId={profileUid || 'prototype-passenger'}
          passengerName={riderProfile?.name || 'Passageira Leaf'}
          passengerEmail={riderProfile?.email || 'passageiro@leaf.app.br'}
        />
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
  paymentCard: {
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
  summaryBox: {
    marginTop: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: color.border.subtle,
    backgroundColor: color.surface.secondary,
    overflow: 'hidden'
  },
  summaryRow: {
    minHeight: 42,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.border.separator
  },
  summaryRowLast: {
    borderBottomWidth: 0
  },
  summaryLabel: {
    color: color.text.secondary,
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  summaryValue: {
    color: color.text.primary,
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  summaryLabelStrong: {
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: typography.body.size,
    lineHeight: typography.body.lineHeight
  },
  summaryValueStrong: {
    color: color.accent.primary,
    fontFamily: fonts.SemiBold,
    fontSize: typography.body.size,
    lineHeight: typography.body.lineHeight
  },
  pixHint: {
    marginTop: 10,
    color: color.text.secondary,
    fontFamily: fonts.Regular,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  ctaButton: {
    marginTop: 10
  },
  pendingText: {
    marginTop: 8,
    color: color.text.secondary,
    fontFamily: fonts.Regular,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  }
});
