import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { fonts } from '../../theme/runtimeTokens';
import PrototypeScreenTransition from '../../components/prototype/PrototypeScreenTransition';
import PrototypeDismissibleSheet from '../../components/prototype/PrototypeDismissibleSheet';
import { CardHandle, PrototypeCard, PrototypePrimaryButton } from '../../components/prototype/PrototypeUI';
import WooviPaymentModal from '../../components/payment/WooviPaymentModal';
import robotaxiPrototypeTokens from '../../components/design-system/robotaxiPrototypeTokens';
import { usePrototypeMapOcclusion } from './prototypeMapOcclusion';
import { usePrototypeRideRuntime } from './prototypeRideRuntime';
import { formatCurrencyBRL } from './tripFinancialSummary';

const { color, typography } = robotaxiPrototypeTokens;
const SHEET_BOTTOM_OFFSET = 100;
const FALLBACK_CARD_HEIGHT = 300;

function formatCurrency(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    return '--';
  }
  return formatCurrencyBRL(amount);
}

function formatStatusLabel(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'accepted') {
    return 'A CAMINHO';
  }
  if (normalized === 'arrived') {
    return 'EMBARQUE';
  }
  if (normalized === 'started') {
    return 'EM VIAGEM';
  }
  if (normalized === 'operational_interrupted') {
    return 'INTERROMPIDA';
  }
  if (normalized === 'searching_replacement') {
    return 'CONTINUIDADE';
  }
  return 'VIAGEM';
}

function buildExtensionPaymentData(rideExtension, bookingId) {
  if (!rideExtension?.chargeId || !bookingId) {
    return null;
  }

  const qrCodeText =
    rideExtension?.brCode ||
    rideExtension?.pixQRCode ||
    rideExtension?.paymentLink ||
    '';

  return {
    chargeId: rideExtension.chargeId,
    rideId: bookingId,
    qrCodeImage: null,
    qrCodeText,
    paymentLink: rideExtension?.paymentLink || null,
    amount: Number(rideExtension?.diffFare || 0),
    amountInCents: Math.round(Number(rideExtension?.diffFare || 0) * 100),
    expiresAt: rideExtension?.expiresAt || null
  };
}

export default function RobotaxiTripScreen({ navigation, route }) {
  const {
    bookingStatus,
    activeBooking,
    selectedDestination,
    selectedVehicle,
    selectedFare,
    tripDistanceKm,
    tripDurationMin,
    tripArrivalText,
    boardingRemainingSec,
    driverInfo,
    driverActiveRide,
    rideExtension,
    operationalContinuation,
    paymentMethod,
    activeBookingId,
    currentAddress,
    profileUid,
    riderProfile,
    endTripEarlyFlow,
    respondOperationalContinuationFlow
  } = usePrototypeRideRuntime();
  const insets = useSafeAreaInsets();
  const [cardHeight, setCardHeight] = useState(FALLBACK_CARD_HEIGHT);
  const [isBusy, setIsBusy] = useState(false);
  const [isExtensionPaymentVisible, setIsExtensionPaymentVisible] = useState(false);
  const [isTripExpanded, setIsTripExpanded] = useState(false);
  const qaAutoConfirmPix = true;
  const sheetBottom = insets.bottom + SHEET_BOTTOM_OFFSET;

  const destination = route?.params?.destination || selectedDestination?.name || 'Destino';
  const destinationAddress = selectedDestination?.address || destination;
  const vehicle = route?.params?.vehicle || selectedVehicle || 'Leaf Plus';
  const fallbackDriverName =
    route?.params?.driverName || activeBooking?.driverName || driverActiveRide?.driverName || null;
  const fallbackVehicleModel = route?.params?.vehicleModel || vehicle;
  const fallbackVehiclePlate = route?.params?.vehiclePlate || '';
  const resolvedTripDistanceKm = Number.isFinite(Number(tripDistanceKm))
    ? Number(tripDistanceKm)
    : Number.isFinite(Number(route?.params?.tripDistanceKm))
      ? Number(route.params.tripDistanceKm)
      : null;
  const resolvedTripDurationMin = Number.isFinite(Number(tripDurationMin))
    ? Number(tripDurationMin)
    : Number.isFinite(Number(route?.params?.tripDurationMin))
      ? Number(route.params.tripDurationMin)
      : null;
  const resolvedTripArrivalText =
    tripArrivalText ||
    route?.params?.tripArrivalText ||
    (Number.isFinite(resolvedTripDurationMin) && resolvedTripDurationMin > 0
      ? `Chegada estimada em ${resolvedTripDurationMin} min`
      : '');
  const resolvedFare = Number.isFinite(Number(selectedFare))
    ? Number(selectedFare)
    : Number.isFinite(Number(route?.params?.selectedFare))
      ? Number(route.params.selectedFare)
      : Number.isFinite(Number(activeBooking?.estimatedFare))
        ? Number(activeBooking.estimatedFare)
        : null;
  const driverName =
    String(driverInfo?.name || fallbackDriverName || 'Motorista Leaf').trim() || 'Motorista Leaf';
  const vehicleModel =
    String(driverInfo?.model || fallbackVehicleModel || vehicle).trim() || 'Leaf Plus';
  const vehiclePlate = String(driverInfo?.plate || fallbackVehiclePlate || '').trim();
  const distanceLabel = Number.isFinite(resolvedTripDistanceKm)
    ? `${resolvedTripDistanceKm.toFixed(1)} km`
    : ' -- ';
  const fareLabel = Number.isFinite(resolvedFare) ? formatCurrency(resolvedFare) : '--';
  const normalizedStatus = String(
    bookingStatus ||
      driverActiveRide?.status ||
      activeBooking?.status ||
      route?.params?.status ||
      ''
  )
    .trim()
    .toLowerCase();
  const isAccepted = normalizedStatus === 'accepted' || normalizedStatus === 'arrived';
  const isArrived = normalizedStatus === 'arrived';
  const isStarted = normalizedStatus === 'started';
  const boardingCountdownLabel =
    Number.isFinite(boardingRemainingSec) && boardingRemainingSec > 0
      ? `${Math.floor(boardingRemainingSec / 60)}:${String(boardingRemainingSec % 60).padStart(2, '0')}`
      : null;
  const arrivalLabel =
    isOperationalDecisionPending
      ? 'Escolha como deseja seguir'
      : isOperationalSearching
        ? 'Procurando outro motorista'
      : isArrived
      ? `Embarque em até ${boardingCountdownLabel || '2:00'}`
      : Number.isFinite(resolvedTripDurationMin) && resolvedTripDurationMin > 0
        ? `Chegada em ${resolvedTripDurationMin} min`
        : isAccepted
          ? 'Aguardando início da viagem'
          : 'Viagem em andamento';
  const extensionStatus = String(rideExtension?.status || 'idle').trim().toLowerCase();
  const operationalStatus = String(operationalContinuation?.status || 'idle').trim().toLowerCase();
  const isOperationalDecisionPending = operationalStatus === 'passenger_decision_pending';
  const isOperationalSearching = operationalStatus === 'searching_replacement_driver';
  const extensionPaymentData = useMemo(
    () => buildExtensionPaymentData(rideExtension, activeBookingId),
    [activeBookingId, rideExtension]
  );
  const compactEtaValue =
    isArrived && boardingCountdownLabel
      ? boardingCountdownLabel
      : Number.isFinite(resolvedTripDurationMin) && resolvedTripDurationMin > 0
        ? `${resolvedTripDurationMin} min`
        : 'Em cálculo';
  const compactVehicleSummary = [vehicleModel, vehiclePlate].filter(Boolean).join(' • ');
  const compactStatusSummary = isStarted
    ? 'Corrida em andamento com suporte e status visiveis sem sair do mapa.'
    : isArrived
      ? 'Seu motorista chegou. Confira o veiculo antes de embarcar.'
      : 'Acompanhe a aproximacao e prepare-se para embarcar com seguranca.';
  const shouldUseCompactTripCard =
    (isAccepted || isStarted) &&
    !isOperationalDecisionPending &&
    !isOperationalSearching &&
    !['driver_decision_pending', 'pending_payment', 'confirming', 'expired', 'rejected'].includes(extensionStatus);
  const compactTitle = isStarted
    ? `A caminho de ${destination}`
    : isArrived
      ? 'Motorista no local de embarque'
      : 'Motorista a caminho do embarque';
  const interruptionPickupLabel = useMemo(() => {
    const interruptionPickup =
      operationalContinuation?.pickupLocation?.add ||
      operationalContinuation?.pickupLocation?.address ||
      operationalContinuation?.pickupLocation?.formattedAddress ||
      currentAddress ||
      'Ponto atual';
    return String(interruptionPickup || 'Ponto atual').trim();
  }, [currentAddress, operationalContinuation?.pickupLocation]);

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

  useEffect(() => {
    if (bookingStatus === 'completed') {
      navigation.navigate('RobotaxiPrototypeReceipt', { fromTrip: true });
    }
  }, [bookingStatus, navigation]);

  useEffect(() => {
    if (extensionStatus === 'pending_payment' && extensionPaymentData?.chargeId) {
      setIsExtensionPaymentVisible(true);
    }
  }, [extensionPaymentData?.chargeId, extensionStatus]);

  useEffect(() => {
    setIsTripExpanded(false);
  }, [activeBookingId, extensionStatus, normalizedStatus, operationalStatus]);

  const handleOpenExtensionFlow = useCallback(() => {
    navigation.navigate('RobotaxiPrototypeDestination', {
      mode: 'extension',
      returnRouteName: 'RobotaxiPrototypeTrip'
    });
  }, [navigation]);

  const handleEndTripEarly = useCallback(() => {
    if (isBusy) {
      return;
    }

    Alert.alert(
      'Encerrar corrida agora',
      'Vamos encerrar a corrida no ponto atual. O reembolso será calculado pelo backend com base no trecho executado e nos custos da corrida.',
      [
        { text: 'Voltar', style: 'cancel' },
        {
          text: 'Encerrar agora',
          style: 'destructive',
          onPress: async () => {
            try {
              setIsBusy(true);
              await endTripEarlyFlow();
            } catch (error) {
              Alert.alert('Não foi possível encerrar', error?.message || 'Falha ao encerrar a corrida agora.');
            } finally {
              setIsBusy(false);
            }
          }
        }
      ]
    );
  }, [endTripEarlyFlow, isBusy]);

  const handleContinueWithOtherDriver = useCallback(() => {
    if (isBusy) {
      return;
    }

    Alert.alert(
      'Continuar com outro motorista',
      'Vamos manter o pagamento já reservado e procurar outro parceiro para seguir do ponto atual.',
      [
        { text: 'Voltar', style: 'cancel' },
        {
          text: 'Continuar viagem',
          onPress: async () => {
            try {
              setIsBusy(true);
              await respondOperationalContinuationFlow(true);
            } catch (error) {
              Alert.alert('Não foi possível continuar', error?.message || 'Falha ao procurar outro motorista agora.');
            } finally {
              setIsBusy(false);
            }
          }
        }
      ]
    );
  }, [isBusy, respondOperationalContinuationFlow]);

  const handleEndAfterInterruption = useCallback(() => {
    if (isBusy) {
      return;
    }

    Alert.alert(
      'Encerrar no ponto atual',
      'Vamos encerrar a corrida aqui e calcular o reembolso líquido com base no trecho executado.',
      [
        { text: 'Voltar', style: 'cancel' },
        {
          text: 'Encerrar aqui',
          style: 'destructive',
          onPress: async () => {
            try {
              setIsBusy(true);
              await respondOperationalContinuationFlow(false);
            } catch (error) {
              Alert.alert('Não foi possível encerrar', error?.message || 'Falha ao encerrar a corrida agora.');
            } finally {
              setIsBusy(false);
            }
          }
        }
      ]
    );
  }, [isBusy, respondOperationalContinuationFlow]);

  const renderCompactTripCard = () => (
    <>
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={() => setIsTripExpanded(true)}
        style={styles.compactSummaryPressable}
        testID="passenger-trip-compact-summary"
        accessibilityLabel="passenger-trip-compact-summary"
      >
        <View style={styles.statusRow}>
          <View
            style={styles.statusChip}
            testID="passenger-trip-status-chip"
            accessibilityLabel="passenger-trip-status-chip"
          >
            <Text style={styles.statusChipText}>{formatStatusLabel(normalizedStatus)}</Text>
          </View>
          <Text
            style={styles.arrivalText}
            testID="passenger-trip-arrival-label"
            accessibilityLabel="passenger-trip-arrival-label"
          >
            {arrivalLabel}
          </Text>
        </View>

        <Text style={styles.compactTitle}>{compactTitle}</Text>
        <Text style={styles.compactSubtitle} numberOfLines={3}>
          {compactStatusSummary}
        </Text>

        <View style={styles.compactMetaRow}>
          <View style={styles.compactMetaChip}>
            <Ionicons name="person-outline" size={14} color="#365A6D" />
            <Text style={styles.compactMetaChipText} numberOfLines={1}>
              {driverName}
            </Text>
          </View>

          <View style={styles.compactMetaChip}>
            <Ionicons name="car-sport-outline" size={14} color={color.text.primary} />
            <Text style={styles.compactMetaChipText} numberOfLines={1}>
              {compactVehicleSummary}
            </Text>
          </View>
        </View>

        <View style={styles.compactMetricRow}>
          <View style={styles.compactMetricPill}>
            <Ionicons name="time-outline" size={15} color="#365A6D" />
            <View style={styles.compactMetricCopy}>
              <Text style={styles.compactMetricLabel}>Tempo</Text>
              <Text style={styles.compactMetricValue}>{compactEtaValue}</Text>
            </View>
          </View>

          <View style={styles.compactMetricPill}>
            <Ionicons name="speedometer-outline" size={15} color={color.text.primary} />
            <View style={styles.compactMetricCopy}>
              <Text style={styles.compactMetricLabel}>Distância</Text>
              <Text style={styles.compactMetricValue}>{distanceLabel}</Text>
            </View>
          </View>

          <View style={[styles.compactMetricPill, styles.compactMetricPillAccent]}>
            <Ionicons name="wallet-outline" size={15} color="#7A5D16" />
            <View style={styles.compactMetricCopy}>
              <Text style={styles.compactMetricLabel}>Valor da corrida</Text>
              <Text style={styles.compactMetricValue}>{fareLabel}</Text>
            </View>
          </View>
        </View>
      </TouchableOpacity>

      <View style={styles.compactActionsRow}>
        {isStarted ? (
          <TouchableOpacity
            style={styles.compactSecondaryAction}
            activeOpacity={0.86}
            onPress={() => navigation.navigate('RobotaxiPrototypeSupport')}
            testID="passenger-trip-support-button"
            accessibilityLabel="passenger-trip-support-button"
          >
            <Ionicons name="shield-checkmark-outline" size={15} color={color.text.primary} />
            <Text style={styles.compactSecondaryActionText}>Ver suporte</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.compactSecondaryAction, styles.compactCancelAction]}
            activeOpacity={0.86}
            onPress={() => navigation.navigate('RobotaxiPrototypeCancellation', { source: 'trip' })}
            testID="passenger-trip-cancel-button"
            accessibilityLabel="passenger-trip-cancel-button"
          >
            <Ionicons name="close-circle-outline" size={15} color={color.text.primary} />
            <Text style={styles.compactSecondaryActionText}>Cancelar corrida</Text>
          </TouchableOpacity>
        )}
      </View>
    </>
  );

  return (
    <PrototypeScreenTransition>
      <View style={styles.container} pointerEvents="box-none">
        <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />
        <PrototypeDismissibleSheet
          onClose={handleDismiss}
          sheetStyle={[styles.sheetWrap, { bottom: sheetBottom }]}
        >
          <PrototypeCard
            onLayout={handleCardLayout}
            style={[styles.tripCard, shouldUseCompactTripCard && !isTripExpanded && styles.compactCard]}
            testID="passenger-trip-screen"
            accessibilityLabel="passenger-trip-screen"
          >
            <CardHandle />

            {shouldUseCompactTripCard && !isTripExpanded ? (
              renderCompactTripCard()
            ) : (
              <>
            {shouldUseCompactTripCard ? (
              <TouchableOpacity
                activeOpacity={0.82}
                onPress={() => setIsTripExpanded(false)}
                style={styles.collapseControl}
                testID="passenger-trip-collapse-button"
                accessibilityLabel="passenger-trip-collapse-button"
              >
                <Ionicons name="chevron-down-outline" size={16} color={color.text.secondary} />
                <Text style={styles.collapseControlText}>Voltar ao resumo</Text>
              </TouchableOpacity>
            ) : null}

            <View style={styles.statusRow}>
              <View
                style={styles.statusChip}
                testID="passenger-trip-status-chip"
                accessibilityLabel="passenger-trip-status-chip"
              >
                <Text style={styles.statusChipText}>{formatStatusLabel(normalizedStatus)}</Text>
              </View>
              <Text
                style={styles.arrivalText}
                testID="passenger-trip-arrival-label"
                accessibilityLabel="passenger-trip-arrival-label"
              >
                {arrivalLabel}
              </Text>
            </View>

            <Text
              style={styles.destinationText}
              testID="passenger-trip-destination-label"
              accessibilityLabel="passenger-trip-destination-label"
            >
              {destination}
            </Text>
            {resolvedTripArrivalText ? (
              <Text style={styles.driverText}>{resolvedTripArrivalText}</Text>
            ) : null}
            <Text style={styles.driverText}>{`Motorista: ${driverName}`}</Text>
            <Text style={styles.driverText}>{`${vehicleModel}${vehiclePlate ? ` • ${vehiclePlate}` : ''}`}</Text>

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

            {isStarted ? (
              <View style={styles.extensionNotice}>
                <View style={styles.extensionNoticeHeader}>
                  <Ionicons
                    name={extensionStatus === 'confirmed' ? 'checkmark-circle-outline' : 'swap-horizontal-outline'}
                    size={16}
                    color={extensionStatus === 'confirmed' ? '#1A7A3E' : color.text.primary}
                  />
                  <Text style={styles.extensionTitle}>
                    {extensionStatus === 'driver_decision_pending'
                      ? 'Aguardando motorista'
                      : extensionStatus === 'pending_payment' || extensionStatus === 'confirming'
                        ? 'Complemento pendente'
                        : extensionStatus === 'expired'
                          ? 'Complemento expirado'
                        : extensionStatus === 'confirmed'
                          ? 'Novo destino confirmado'
                          : extensionStatus === 'rejected'
                            ? 'Alteração não aprovada'
                            : 'Durante a corrida'}
                  </Text>
                </View>
                <Text style={styles.extensionMessage}>
                  {extensionStatus === 'driver_decision_pending'
                    ? rideExtension?.message || 'Seu pedido de novo destino foi enviado ao motorista.'
                    : extensionStatus === 'pending_payment'
                      ? rideExtension?.message || 'O motorista aceitou. Pague o complemento Pix para seguir ao novo destino.'
                      : extensionStatus === 'confirming'
                        ? rideExtension?.message || 'Pagamento confirmado. Atualizando a corrida...'
                        : extensionStatus === 'expired'
                          ? rideExtension?.message || 'O tempo para pagamento do complemento expirou. O destino original foi mantido.'
                        : extensionStatus === 'confirmed'
                          ? `Novo destino: ${rideExtension?.destination?.name || destinationAddress}`
                          : extensionStatus === 'rejected'
                            ? rideExtension?.message || 'O motorista preferiu manter o destino original.'
                            : 'Você pode solicitar um novo destino ou encerrar a corrida no ponto atual.'}
                </Text>
                {extensionStatus === 'pending_payment' && Number(rideExtension?.diffFare) > 0 ? (
                  <TouchableOpacity
                    style={styles.extensionPayAction}
                    activeOpacity={0.86}
                    onPress={() => setIsExtensionPaymentVisible(true)}
                  >
                    <Ionicons name="qr-code-outline" size={16} color="#1A7A3E" />
                    <Text style={styles.extensionPayActionText}>
                      Pagar complemento de {formatCurrency(rideExtension?.diffFare)}
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : null}

            {isOperationalDecisionPending ? (
              <View style={[styles.extensionNotice, styles.operationalNotice]}>
                <View style={styles.extensionNoticeHeader}>
                  <Ionicons name="warning-outline" size={16} color="#8A1F2B" />
                  <Text style={styles.extensionTitle}>Seu motorista não consegue continuar</Text>
                </View>
                <Text style={styles.extensionMessage}>
                  {operationalContinuation?.message ||
                    'Você pode continuar com outro parceiro a partir do ponto atual ou encerrar a corrida aqui.'}
                </Text>
                <Text style={styles.operationalContextText}>Ponto atual: {interruptionPickupLabel}</Text>
                <View style={styles.operationalMetaRow}>
                  <Text style={styles.operationalMetaLabel}>
                    Reembolso estimado: {formatCurrency(operationalContinuation?.estimatedRefund)}
                  </Text>
                  <Text style={styles.operationalMetaLabel}>
                    Saldo reservado: {formatCurrency(operationalContinuation?.remainingReservedAmount)}
                  </Text>
                </View>
                <View style={styles.actionsRow}>
                  <TouchableOpacity
                    style={styles.secondaryAction}
                    activeOpacity={0.86}
                    onPress={handleContinueWithOtherDriver}
                    disabled={isBusy}
                    testID="passenger-trip-operational-continue-button"
                    accessibilityLabel="passenger-trip-operational-continue-button"
                  >
                    <Ionicons name="car-outline" size={15} color={color.text.primary} />
                    <Text style={styles.secondaryActionText}>
                      {isBusy ? 'Processando...' : 'Continuar com outro'}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.secondaryAction, styles.warningAction]}
                    activeOpacity={0.86}
                    onPress={handleEndAfterInterruption}
                    disabled={isBusy}
                    testID="passenger-trip-operational-end-button"
                    accessibilityLabel="passenger-trip-operational-end-button"
                  >
                    <Ionicons name="stop-circle-outline" size={15} color="#8A1F2B" />
                    <Text style={[styles.secondaryActionText, styles.warningActionText]}>
                      {isBusy ? 'Processando...' : 'Encerrar aqui'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}

            {isOperationalSearching ? (
              <View style={[styles.extensionNotice, styles.operationalNotice]}>
                <View style={styles.extensionNoticeHeader}>
                  <Ionicons name="search-outline" size={16} color="#365A6D" />
                  <Text style={styles.extensionTitle}>Procurando outro motorista</Text>
                </View>
                <Text style={styles.extensionMessage}>
                  {operationalContinuation?.message ||
                    'Já liberamos a continuidade da corrida. Você seguirá com outro parceiro assim que ele aceitar.'}
                </Text>
                <Text style={styles.operationalContextText}>Retomada a partir de: {interruptionPickupLabel}</Text>
              </View>
            ) : null}

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

            {isStarted ? (
              <View style={styles.actionsRow}>
                <TouchableOpacity
                  style={styles.secondaryAction}
                  activeOpacity={0.86}
                  onPress={handleOpenExtensionFlow}
                  testID="passenger-trip-change-destination-button"
                  accessibilityLabel="passenger-trip-change-destination-button"
                >
                  <Ionicons name="navigate-outline" size={15} color={color.text.primary} />
                  <Text style={styles.secondaryActionText}>Alterar destino</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.secondaryAction, styles.warningAction]}
                  activeOpacity={0.86}
                  onPress={handleEndTripEarly}
                  disabled={isBusy}
                  testID="passenger-trip-end-early-button"
                  accessibilityLabel="passenger-trip-end-early-button"
                >
                  <Ionicons name="flag-outline" size={15} color="#8A1F2B" />
                  <Text style={[styles.secondaryActionText, styles.warningActionText]}>
                    {isBusy ? 'Encerrando...' : 'Encerrar agora'}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.cancelAction}
                activeOpacity={0.86}
                onPress={() => navigation.navigate('RobotaxiPrototypeCancellation', { source: 'trip' })}
                testID="passenger-trip-cancel-button"
                accessibilityLabel="passenger-trip-cancel-button"
              >
                <Ionicons name="close-circle-outline" size={15} color={color.text.primary} />
                <Text style={styles.cancelActionText}>Cancelar corrida</Text>
              </TouchableOpacity>
            )}

            <PrototypePrimaryButton
              label="Ver suporte da corrida"
              icon="shield-checkmark-outline"
              onPress={() => navigation.navigate('RobotaxiPrototypeSupport')}
              style={styles.finishButton}
              testID="passenger-trip-support-button"
              accessibilityLabel="passenger-trip-support-button"
            />
              </>
            )}
          </PrototypeCard>
        </PrototypeDismissibleSheet>

        <WooviPaymentModal
          visible={isExtensionPaymentVisible}
          onClose={() => setIsExtensionPaymentVisible(false)}
          onPaymentConfirmed={() => {}}
          prefilledPaymentData={extensionPaymentData}
          preserveChargeOnClose
          paymentTitle="Complemento PIX"
          qaAutoConfirm={qaAutoConfirmPix}
          tripData={{
            pickup: {
              add: currentAddress || 'Origem atual'
            },
            drop: {
              add: rideExtension?.destination?.address || rideExtension?.destination?.name || destinationAddress
            },
            carType: vehicle,
            estimatedFare: Number(rideExtension?.diffFare || 0)
          }}
          estimates={{ estimateFare: Number(rideExtension?.diffFare || 0) }}
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
  tripCard: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 12
  },
  compactCard: {
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 14
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
  extensionNotice: {
    marginTop: 12,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: color.border.subtle,
    backgroundColor: color.surface.secondary
  },
  extensionNoticeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  extensionTitle: {
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  extensionMessage: {
    marginTop: 6,
    color: color.text.secondary,
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight + 2
  },
  extensionPayAction: {
    marginTop: 10,
    minHeight: 40,
    borderRadius: 12,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(65, 210, 116, 0.12)'
  },
  extensionPayActionText: {
    color: '#1A7A3E',
    fontFamily: fonts.SemiBold,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  operationalNotice: {
    backgroundColor: '#FFF8F3',
    borderColor: 'rgba(138,31,43,0.12)'
  },
  operationalContextText: {
    marginTop: 8,
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight + 2
  },
  operationalMetaRow: {
    marginTop: 8,
    gap: 2
  },
  operationalMetaLabel: {
    color: color.text.secondary,
    fontFamily: fonts.Medium,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight + 2
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
  warningAction: {
    borderColor: 'rgba(138,31,43,0.18)',
    backgroundColor: '#FFF4F5'
  },
  warningActionText: {
    color: '#8A1F2B'
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
  },
  compactSummaryPressable: {
    gap: 10
  },
  compactTitle: {
    marginTop: 2,
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: typography.subtitle.size,
    lineHeight: typography.subtitle.lineHeight
  },
  compactSubtitle: {
    color: color.text.secondary,
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight + 2
  },
  compactMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8
  },
  compactMetaChip: {
    flexGrow: 1,
    flexBasis: '48%',
    minWidth: 0,
    minHeight: 34,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: color.border.subtle,
    backgroundColor: color.surface.secondary,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6
  },
  compactMetaChipText: {
    flex: 1,
    minWidth: 0,
    color: color.text.primary,
    fontFamily: fonts.Medium,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight + 1
  },
  compactMetricRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap'
  },
  compactMetricPill: {
    flexGrow: 1,
    flexBasis: '48%',
    minWidth: 0,
    minHeight: 54,
    borderRadius: 14,
    backgroundColor: color.surface.secondary,
    borderWidth: 1,
    borderColor: color.border.subtle,
    paddingHorizontal: 10,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  compactMetricPillAccent: {
    flexBasis: '100%',
    minHeight: 58,
    backgroundColor: '#FFF9EA',
    borderColor: 'rgba(122,93,22,0.12)'
  },
  compactMetricCopy: {
    flex: 1,
    minWidth: 0
  },
  compactMetricLabel: {
    color: color.text.secondary,
    fontFamily: fonts.SemiBold,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight,
    textTransform: 'uppercase',
    letterSpacing: 0.7
  },
  compactMetricValue: {
    marginTop: 2,
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  compactActionsRow: {
    marginTop: 10,
    flexDirection: 'row',
    gap: 8
  },
  compactSecondaryAction: {
    flex: 1,
    minHeight: 46,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: color.border.subtle,
    backgroundColor: color.surface.secondary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8
  },
  compactSecondaryActionText: {
    color: color.text.primary,
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  compactCancelAction: {
    borderColor: color.border.strong
  },
  collapseControl: {
    alignSelf: 'flex-end',
    marginBottom: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: color.surface.secondary,
    borderWidth: 1,
    borderColor: color.border.subtle,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4
  },
  collapseControlText: {
    color: color.text.secondary,
    fontFamily: fonts.SemiBold,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight
  }
});
