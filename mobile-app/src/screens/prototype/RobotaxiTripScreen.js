import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { fonts } from '../../theme/runtimeTokens';
import PrototypeScreenTransition from '../../components/prototype/PrototypeScreenTransition';
import PrototypeDismissibleSheet from '../../components/prototype/PrototypeDismissibleSheet';
import PrototypeMapLayer from '../../components/prototype/PrototypeMapLayer';
import WooviPaymentModal from '../../components/payment/WooviPaymentModal';
import SecurePaymentBadge from '../../components/payment/SecurePaymentBadge';
import robotaxiPrototypeTokens from '../../components/design-system/robotaxiPrototypeTokens';
import {
  LeafButton,
  LeafDivider,
  LeafDriverIdentity,
  LeafRideSheet,
  LeafRouteProgress,
  leafRideColors,
} from '../../components/prototype/LeafRideUI';
import { usePrototypeMapOcclusion } from './prototypeMapOcclusion';
import { usePrototypeRideRuntime } from './prototypeRideRuntime';
import { useLiveRouteTiming } from './liveRouteTiming';
import { formatCurrencyBRL } from './tripFinancialSummary';
import { PROTOTYPE_ORIGIN_COORDINATE, PROTOTYPE_REGION } from './robotaxiPrototypeData';

const { color, typography } = robotaxiPrototypeTokens;
const SHEET_BOTTOM_OFFSET = 0;
const FALLBACK_CARD_HEIGHT = 292;

export const PASSENGER_TRIP_RENDERED_CARD_FIELDS = Object.freeze({
  accepted: Object.freeze([
    'driver_name',
    'driver_photo',
    'driver_rating',
    'vehicle_model',
    'vehicle_color',
    'vehicle_plate',
    'pickup_eta',
    'pickup_distance',
    'pickup_address',
    'destination_address',
    'fare',
    'vehicle_type',
    'contact_actions',
    'share_trip_action',
    'safety_action',
    'cancel_action',
  ]),
  arrived: Object.freeze([
    'driver_name',
    'driver_photo',
    'vehicle_model',
    'vehicle_color',
    'vehicle_plate',
    'boarding_timer',
    'boarding_timer_message',
    'pickup_address',
    'contact_actions',
    'safety_action',
    'cancel_action',
  ]),
  started: Object.freeze([
    'destination_address',
    'eta_final',
    'distance_remaining',
    'route_progress',
    'driver_name',
    'driver_photo',
    'vehicle_model',
    'vehicle_color',
    'vehicle_plate',
    'fare',
    'vehicle_type',
    'share_trip_action',
    'safety_action',
    'support_action',
    'change_destination_action',
    'end_early_action',
  ]),
});

function formatCurrency(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    return '--';
  }
  return formatCurrencyBRL(amount);
}

function formatDistanceLabel(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return '--';
  }

  if (numeric < 1) {
    const meters = Math.max(10, Math.round((numeric * 1000) / 10) * 10);
    return `${meters} m`;
  }

  return `${Math.max(1, Math.round(numeric))} km`;
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

function formatBoardingTimer(seconds) {
  const normalizedSeconds = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(normalizedSeconds / 60)}:${String(normalizedSeconds % 60).padStart(2, '0')}`;
}

function getFirstName(value, fallback = 'Motorista') {
  const firstName = String(value || '').trim().split(/\s+/).filter(Boolean)[0];
  return firstName || fallback;
}

function resolveVehicleColorLabel(...values) {
  const colorLabel = values
    .map(value => String(value || '').trim())
    .find(Boolean);
  return colorLabel || 'Cor a confirmar';
}

function normalizeMapCoordinate(value) {
  const latitude = Number(value?.latitude ?? value?.lat);
  const longitude = Number(value?.longitude ?? value?.lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }
  return { latitude, longitude };
}

function toPositiveNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function buildFallbackTripRegion(points = []) {
  const normalizedPoints = points
    .map(normalizeMapCoordinate)
    .filter(Boolean);

  if (normalizedPoints.length === 0) {
    return PROTOTYPE_REGION;
  }

  const latitudes = normalizedPoints.map(point => point.latitude);
  const longitudes = normalizedPoints.map(point => point.longitude);
  const minLatitude = Math.min(...latitudes);
  const maxLatitude = Math.max(...latitudes);
  const minLongitude = Math.min(...longitudes);
  const maxLongitude = Math.max(...longitudes);
  const latitudeDelta = Math.max(0.018, (maxLatitude - minLatitude) * 1.7);
  const longitudeDelta = Math.max(0.018, (maxLongitude - minLongitude) * 1.7);

  return {
    latitude: (minLatitude + maxLatitude) / 2,
    longitude: (minLongitude + maxLongitude) / 2,
    latitudeDelta,
    longitudeDelta,
  };
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

function IconActionButton({ icon, label, onPress, tone = 'ghost', testID, style }) {
  const isWarning = tone === 'warning';
  const isDanger = tone === 'danger';
  const displayLabel =
    label === 'Mensagem' ? 'Chat' : label === 'Cancelar corrida' ? 'Cancelar' : label;
  return (
    <TouchableOpacity
      activeOpacity={0.84}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      onPress={onPress}
      style={[
        styles.iconActionButton,
        isWarning && styles.iconActionButtonWarning,
        isDanger && styles.iconActionButtonDanger,
        style
      ]}
    >
      <Ionicons
        name={icon}
        size={16}
        color={
          isDanger
            ? leafRideColors.dangerText
            : isWarning
              ? leafRideColors.warningText
              : leafRideColors.leaf
        }
      />
      <Text
        style={[
          styles.iconActionLabel,
          isDanger && styles.iconActionLabelDanger,
          isWarning && styles.iconActionLabelWarning,
        ]}
        numberOfLines={1}
      >
        {displayLabel}
      </Text>
      {displayLabel !== label ? <Text style={styles.hiddenText}>{label}</Text> : null}
    </TouchableOpacity>
  );
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
    currentCoordinate,
    currentHeading,
    currentAddress,
    driverCoordinate,
    profileUid,
    riderProfile,
    endTripEarlyFlow,
    respondOperationalContinuationFlow
  } = usePrototypeRideRuntime();
  const insets = useSafeAreaInsets();
  const mapRef = useRef(null);
  const [cardHeight, setCardHeight] = useState(FALLBACK_CARD_HEIGHT);
  const [isBusy, setIsBusy] = useState(false);
  const [isExtensionPaymentVisible, setIsExtensionPaymentVisible] = useState(false);
  const [isTripExpanded, setIsTripExpanded] = useState(false);
  const qaAutoConfirmPix = true;
  const safeBottom = Math.max(0, Number(insets.bottom) || 0);
  const sheetBottom = SHEET_BOTTOM_OFFSET;

  const destination = route?.params?.destination || selectedDestination?.name || 'Destino';
  const destinationAddress = selectedDestination?.address || destination;
  const vehicle = route?.params?.vehicle || selectedVehicle || 'Leaf Plus';
  const fallbackDriverName =
    route?.params?.driverName || activeBooking?.driverName || driverActiveRide?.driverName || null;
  const fallbackVehicleModel = route?.params?.vehicleModel || vehicle;
  const fallbackVehiclePlate = route?.params?.vehiclePlate || '';
  const resolvedTripDistanceKm =
    toPositiveNumber(tripDistanceKm) ??
    toPositiveNumber(route?.params?.tripDistanceKm);
  const resolvedTripDurationMin =
    toPositiveNumber(tripDurationMin) ??
    toPositiveNumber(route?.params?.tripDurationMin);
  const resolvedTripArrivalText =
    tripArrivalText ||
    route?.params?.tripArrivalText ||
    (Number.isFinite(resolvedTripDurationMin) && resolvedTripDurationMin > 0
      ? `Chegada estimada em ${resolvedTripDurationMin} min`
      : '');
  const resolvedFare =
    toPositiveNumber(selectedFare) ??
    toPositiveNumber(route?.params?.selectedFare) ??
    toPositiveNumber(activeBooking?.estimatedFare);
  const driverName =
    String(driverInfo?.name || fallbackDriverName || 'Motorista Leaf').trim() || 'Motorista Leaf';
  const vehicleModel =
    String(driverInfo?.model || driverInfo?.vehicle?.model || fallbackVehicleModel || vehicle).trim() ||
    'Leaf Plus';
  const vehiclePlate =
    String(driverInfo?.plate || driverInfo?.vehicle?.plate || fallbackVehiclePlate || '').trim();
  const vehicleColorLabel = resolveVehicleColorLabel(
    driverInfo?.color,
    driverInfo?.vehicleColor,
    driverInfo?.vehicle?.color,
    activeBooking?.vehicleColor,
    activeBooking?.vehicle?.color,
    driverActiveRide?.vehicleColor,
    driverActiveRide?.vehicle?.color,
    route?.params?.vehicleColor,
  );
  const driverPhotoUri =
    String(
      driverInfo?.photo ||
        driverInfo?.photoURL ||
        driverInfo?.profileImage ||
        driverInfo?.avatar ||
        activeBooking?.driverPhoto ||
        activeBooking?.driver?.photo ||
        driverActiveRide?.driverPhoto ||
        route?.params?.driverPhoto ||
        '',
    ).trim() || null;
  const distanceLabel = formatDistanceLabel(resolvedTripDistanceKm);
  const fareLabel = Number.isFinite(resolvedFare) ? formatCurrency(resolvedFare) : '--';
  const routeQaStatus = String(route?.params?.qaStatus || '').trim();
  const normalizedStatus = String(
    routeQaStatus ||
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
  const extensionStatus = String(rideExtension?.status || 'idle').trim().toLowerCase();
  const operationalStatus = String(operationalContinuation?.status || 'idle').trim().toLowerCase();
  const isOperationalDecisionPending = operationalStatus === 'passenger_decision_pending';
  const isOperationalSearching = operationalStatus === 'searching_replacement_driver';
  const rawBoardingSeconds = Number(boardingRemainingSec);
  const boardingTimerSeconds = Number.isFinite(rawBoardingSeconds)
    ? Math.max(0, Math.round(rawBoardingSeconds))
    : isArrived
      ? 120
      : null;
  const boardingCountdownLabel =
    boardingTimerSeconds === null ? null : formatBoardingTimer(boardingTimerSeconds);
  const boardingTimerMessage =
    boardingTimerSeconds === null || boardingTimerSeconds > 30
      ? 'Prossiga para o embarque'
      : boardingTimerSeconds > 0
        ? 'Embarque urgente'
        : 'Uma taxa poderá ser aplicada';
  const isBoardingTimerUrgent =
    boardingTimerSeconds !== null && boardingTimerSeconds > 0 && boardingTimerSeconds <= 30;
  const isBoardingTimerExpired = boardingTimerSeconds === 0;
  const tripPickupCoordinate =
    normalizeMapCoordinate(activeBooking?.pickupLocation) ||
    normalizeMapCoordinate(driverActiveRide?.pickupCoordinate) ||
    normalizeMapCoordinate(currentCoordinate) ||
    PROTOTYPE_ORIGIN_COORDINATE;
  const tripDestinationCoordinate =
    normalizeMapCoordinate(selectedDestination?.coordinate) ||
    normalizeMapCoordinate(activeBooking?.destinationLocation) ||
    normalizeMapCoordinate(driverActiveRide?.destinationCoordinate) ||
    normalizeMapCoordinate(driverActiveRide?.dropoffCoordinate) ||
    null;
  const tripDriverCoordinate =
    normalizeMapCoordinate(driverCoordinate) ||
    normalizeMapCoordinate(driverInfo?.coordinate) ||
    null;
  const tripRouteCoordinates = useMemo(() => {
    const candidateRoute =
      activeBooking?.routeCoordinates ||
      activeBooking?.route ||
      driverActiveRide?.routeCoordinates ||
      driverActiveRide?.route;
    const normalizedCandidate = Array.isArray(candidateRoute)
      ? candidateRoute.map(normalizeMapCoordinate).filter(Boolean)
      : [];
    if (normalizedCandidate.length >= 2) {
      return normalizedCandidate;
    }

    const routeStart =
      isAccepted || isArrived
        ? tripDriverCoordinate || tripPickupCoordinate
        : normalizeMapCoordinate(currentCoordinate) || tripPickupCoordinate;
    const routeEnd =
      isAccepted || isArrived
        ? tripPickupCoordinate
        : tripDestinationCoordinate;

    return [routeStart, routeEnd].filter(Boolean);
  }, [
    activeBooking?.route,
    activeBooking?.routeCoordinates,
    currentCoordinate,
    driverActiveRide?.route,
    driverActiveRide?.routeCoordinates,
    isAccepted,
    isArrived,
    tripDestinationCoordinate,
    tripDriverCoordinate,
    tripPickupCoordinate,
  ]);
  const tripMapRegion = useMemo(
    () =>
      buildFallbackTripRegion([
        currentCoordinate,
        tripPickupCoordinate,
        tripDestinationCoordinate,
        tripDriverCoordinate,
        ...tripRouteCoordinates,
      ]),
    [
      currentCoordinate,
      tripDestinationCoordinate,
      tripDriverCoordinate,
      tripPickupCoordinate,
      tripRouteCoordinates,
    ]
  );
  const arrivalLabel =
    isOperationalDecisionPending
      ? 'Escolha como deseja seguir'
      : isOperationalSearching
        ? 'Procurando outro motorista'
      : isArrived
      ? `Encontre seu motorista em ${boardingCountdownLabel || '2:00'}`
      : Number.isFinite(resolvedTripDurationMin) && resolvedTripDurationMin > 0
        ? `Chegada em ${resolvedTripDurationMin} min`
        : isAccepted
          ? 'Pronto para iniciar a viagem'
          : 'Viagem em andamento';
  const extensionPaymentData = useMemo(
    () => buildExtensionPaymentData(rideExtension, activeBookingId),
    [activeBookingId, rideExtension]
  );
  const pickupLabel =
    String(
      activeBooking?.pickupLocation?.add ||
        activeBooking?.pickupAddress ||
        route?.params?.originAddress ||
        currentAddress ||
        '',
    ).trim() || 'Local combinado';
  const pickupPointLabel =
    pickupLabel.split(',').slice(0, 2).join(',').trim() || pickupLabel;
  const routeTotalMinutes =
    activeBooking?.initialTripDurationMin ||
    activeBooking?.estimatedTotalDurationMin ||
    activeBooking?.totalDurationMin ||
    route?.params?.initialTripDurationMin;
  const routeStartedAt =
    activeBooking?.startedAt ||
    activeBooking?.tripStartedAt ||
    route?.params?.startedAt;
  const liveRouteKey = [
    activeBookingId,
    activeBooking?.bookingId,
    activeBooking?.id,
    driverActiveRide?.bookingId,
    driverActiveRide?.id,
    normalizedStatus,
    routeStartedAt,
    pickupPointLabel,
    destination,
  ]
    .filter(Boolean)
    .join(':');
  const {
    routeProgress,
    arrivalClockLabel,
    displayEtaMinutes,
  } = useLiveRouteTiming({
    routeKey: liveRouteKey || 'passenger-trip-route',
    remainingMinutes: resolvedTripDurationMin,
    totalMinutes: routeTotalMinutes,
    startedAt: routeStartedAt,
    active: isStarted,
  });
  const stableEtaValue =
    Number.isFinite(displayEtaMinutes) && displayEtaMinutes > 0
      ? `${displayEtaMinutes} min`
      : null;
  const compactEtaValue =
    isArrived && boardingCountdownLabel
      ? boardingCountdownLabel
      : stableEtaValue ||
        (Number.isFinite(resolvedTripDurationMin) && resolvedTripDurationMin > 0
          ? `${resolvedTripDurationMin} min`
          : '--');
  const startedTripMeta = [
    distanceLabel && distanceLabel !== '--' ? `${distanceLabel} restante` : null,
    fareLabel ? `valor ${fareLabel}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const shouldUseCompactTripCard =
    (isAccepted || isArrived || isStarted) &&
    !isOperationalDecisionPending &&
    !isOperationalSearching &&
    !['driver_decision_pending', 'pending_payment', 'confirming', 'expired', 'rejected'].includes(extensionStatus);
  const driverInitial = String(driverName || 'C').trim().charAt(0).toUpperCase() || 'C';
  const driverRatingLabel = driverInfo?.rating
    ? `${Number(driverInfo.rating).toFixed(1).replace('.', ',')} · parceiro Leaf`
    : '4,9 · parceiro Leaf';
  const plateLabel = vehiclePlate || 'Placa pendente';
  const driverFirstName = getFirstName(driverName);
  const passengerHeaderTitle = isStarted
    ? `A caminho de ${destination}`
    : isArrived
      ? `${driverFirstName} chegou`
      : `${driverFirstName} está a caminho`;
  const boardingPinLabel =
    String(
      activeBooking?.boardingPin ||
        activeBooking?.boardingCode ||
        activeBooking?.pin ||
        route?.params?.boardingPin ||
        '',
    ).trim() || '----';
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

  const handleShareTrip = useCallback(() => {
    navigation.navigate('RobotaxiPrototypeShareTrip', {
      bookingId: activeBookingId,
      destination,
      driverName,
      vehicleModel,
      vehiclePlate,
      tripArrivalText: resolvedTripArrivalText,
    });
  }, [activeBookingId, destination, driverName, navigation, resolvedTripArrivalText, vehicleModel, vehiclePlate]);

  const handleCallDriver = useCallback(() => {
    Alert.alert(
      'Ligação pelo app',
      'A chamada direta ainda depende do telefone mascarado do motorista. Use a mensagem ou o suporte por enquanto.',
    );
  }, []);

  const handlePassengerOnWay = useCallback(() => {
    Alert.alert('Aviso registrado', 'Avise o motorista pelo chat se precisar de mais alguns instantes.');
  }, []);

  const renderPassengerCardStateHeader = () => (
    <>
      <View style={styles.cardStateHeader}>
        <Text style={styles.cardStateTitle} numberOfLines={2}>
          {passengerHeaderTitle}
        </Text>
        <IconActionButton
          icon="shield-checkmark-outline"
          label="SOS"
          tone="warning"
          onPress={() => navigation.navigate('RobotaxiPrototypeSupport')}
          testID="passenger-trip-sos-button"
        />
      </View>
      <LeafDivider style={styles.cardStateDivider} />
    </>
  );

  const renderCompactTripCard = () => (
    <View
      testID="passenger-trip-compact-summary"
      accessibilityLabel="passenger-trip-compact-summary"
    >
      <View style={styles.sheetHandle} />
      <Text
        style={styles.hiddenText}
        testID="passenger-trip-arrival-label"
        accessibilityLabel="passenger-trip-arrival-label"
      >
        {arrivalLabel}
      </Text>
      <View style={styles.rideHeader}>
        <View style={styles.rideHeaderCopy}>
          <Text style={styles.rideTitle} numberOfLines={2}>
            {isStarted ? `A caminho de ${destination}` : passengerHeaderTitle}
          </Text>
          {isStarted || isArrived ? (
            <Text style={styles.rideKicker} numberOfLines={1}>
              {isStarted
                ? arrivalClockLabel || resolvedTripArrivalText || compactEtaValue
                : 'Motorista no embarque'}
            </Text>
          ) : null}
          {!isStarted && !isArrived ? (
            <Text style={styles.hiddenText}>{`${compactEtaValue} até chegar`}</Text>
          ) : null}
        </View>
        {isStarted ? (
          <View style={styles.rideRight}>
            <Text style={styles.rideRightValue} numberOfLines={1}>
              {compactEtaValue}
            </Text>
            <Text style={styles.rideRightLabel} numberOfLines={1}>
              ETA
            </Text>
          </View>
        ) : isArrived ? null : (
          <View style={styles.rideRight}>
            <Text style={styles.rideRightValue} numberOfLines={1}>
              {compactEtaValue}
            </Text>
            <Text style={styles.rideRightLabel} numberOfLines={1}>
              chegada
            </Text>
          </View>
        )}
      </View>

      {isStarted ? (
        <>
          <LeafRouteProgress
            originLabel={pickupPointLabel}
            destinationLabel={destination}
            progress={routeProgress}
            progressKey={liveRouteKey || 'passenger-trip-route'}
            arrivalLabel={null}
            style={styles.tripRouteProgressCompact}
            testID="passenger-trip-route-progress"
          />
          {startedTripMeta ? (
            <Text style={styles.tripRouteMeta} numberOfLines={1}>
              {startedTripMeta}
            </Text>
          ) : null}
          <LeafDriverIdentity
            initial={driverInitial}
            photoUri={driverPhotoUri}
            name={driverName}
            rating={driverRatingLabel}
            vehicle={vehicleModel}
            plate={plateLabel}
            style={styles.startedIdentity}
            testID="passenger-trip-driver-identity"
          />
          <Text style={styles.vehicleColorText} numberOfLines={1}>
            {vehicleColorLabel}
          </Text>
          <View style={styles.passengerSecondaryActionsRow}>
            <IconActionButton
              icon="shield-checkmark-outline"
              label="SOS"
              onPress={() => navigation.navigate('RobotaxiPrototypeSupport')}
              style={styles.passengerSecondaryActionButton}
              testID="passenger-trip-support-button"
            />
            <IconActionButton
              icon="chatbubble-ellipses-outline"
              label="Mensagem"
              onPress={() => navigation.navigate('RobotaxiPrototypeChat')}
              style={styles.passengerSecondaryActionButton}
              testID="passenger-trip-message-button"
            />
          </View>
          <View style={styles.passengerPrimaryActionRow}>
            <LeafButton
              label="Compartilhar"
              tone="primary"
              onPress={handleShareTrip}
              style={styles.startedShareButton}
              testID="passenger-trip-share-button"
              accessibilityLabel="passenger-trip-share-button"
            />
          </View>
        </>
      ) : isArrived ? (
        <>
          <View style={styles.boardingTimerCompactPanel}>
            <Text style={styles.boardingTimerValue}>{boardingCountdownLabel || '0:00'}</Text>
            <Text
              style={[
                styles.boardingTimerMessage,
                isBoardingTimerUrgent && styles.boardingTimerMessageUrgent,
                isBoardingTimerExpired && styles.boardingTimerMessageExpired,
              ]}
              numberOfLines={1}
            >
              {boardingTimerMessage}
            </Text>
          </View>
          <LeafDriverIdentity
            initial={driverInitial}
            photoUri={driverPhotoUri}
            name={driverName}
            rating={`${vehicleModel}${vehiclePlate ? ` · ${vehiclePlate}` : ''}`}
            vehicle={vehicleModel}
            plate={plateLabel}
            style={styles.arrivedIdentity}
            testID="passenger-trip-driver-identity"
          />
          <Text style={styles.vehicleColorText} numberOfLines={1}>
            {vehicleColorLabel}
          </Text>
          <View style={styles.passengerSecondaryActionsRow}>
            <IconActionButton
              icon="call-outline"
              label="Ligar"
              onPress={handleCallDriver}
              style={styles.passengerSecondaryActionButton}
              testID="passenger-trip-call-button"
            />
            <IconActionButton
              icon="chatbubble-ellipses-outline"
              label="Mensagem"
              onPress={() => navigation.navigate('RobotaxiPrototypeChat')}
              style={styles.passengerSecondaryActionButton}
              testID="passenger-trip-message-button"
            />
            <IconActionButton
              icon="close-outline"
              label="Cancelar corrida"
              tone="danger"
              onPress={() => navigation.navigate('RobotaxiPrototypeCancellation', { source: 'trip' })}
              style={styles.passengerSecondaryActionButton}
              testID="passenger-trip-cancel-button"
            />
          </View>
          <View style={styles.passengerPrimaryActionRow}>
            <LeafButton
              label="Estou indo"
              tone="primary"
              onPress={handlePassengerOnWay}
              style={styles.arrivedPrimary}
            />
          </View>
        </>
      ) : (
        <>
          <LeafDriverIdentity
            initial={driverInitial}
            photoUri={driverPhotoUri}
            name={driverName}
            rating={driverRatingLabel}
            vehicle={vehicleModel}
            plate={plateLabel}
            style={styles.acceptedIdentity}
            testID="passenger-trip-driver-identity"
          />
          <Text style={styles.vehicleColorText} numberOfLines={1}>
            {vehicleColorLabel}
          </Text>
          <View
            style={styles.rideRouteTimeline}
            accessibilityLabel={`Embarque ${pickupPointLabel}. Destino ${destination}. Valor ${fareLabel}.`}
          >
            <View style={styles.rideRouteStep}>
              <View style={styles.rideRouteTrack}>
                <View style={styles.rideRouteDot} />
                <View style={styles.rideRouteLine} />
              </View>
              <View style={styles.rideRouteCopy}>
                <Text style={styles.rideRouteMeta} numberOfLines={1}>
                  {distanceLabel} até o embarque
                </Text>
                <Text style={styles.rideRouteAddress} numberOfLines={1}>
                  {pickupPointLabel}
                </Text>
              </View>
            </View>
            <View style={styles.rideRouteStep}>
              <View style={styles.rideRouteTrack}>
                <View style={[styles.rideRouteDot, styles.rideRouteDotDestination]} />
              </View>
              <View style={styles.rideRouteCopy}>
                <Text style={styles.rideRouteMeta} numberOfLines={1}>
                  {vehicle} · {fareLabel}
                </Text>
                <Text style={styles.rideRouteAddress} numberOfLines={1}>
                  {destination}
                </Text>
              </View>
            </View>
          </View>
          <View style={styles.passengerSecondaryActionsRow}>
            <IconActionButton
              icon="call-outline"
              label="Ligar"
              onPress={handleCallDriver}
              style={styles.passengerSecondaryActionButton}
              testID="passenger-trip-call-button"
            />
            <IconActionButton
              icon="chatbubble-ellipses-outline"
              label="Mensagem"
              onPress={() => navigation.navigate('RobotaxiPrototypeChat')}
              style={styles.passengerSecondaryActionButton}
              testID="passenger-trip-message-button"
            />
            <IconActionButton
              icon="close-outline"
              label="Cancelar corrida"
              tone="danger"
              onPress={() => navigation.navigate('RobotaxiPrototypeCancellation', { source: 'trip' })}
              style={styles.passengerSecondaryActionButton}
              testID="passenger-trip-cancel-button"
            />
          </View>
          <View style={styles.passengerPrimaryActionRow}>
            <LeafButton
              label="Compartilhar"
              tone="primary"
              onPress={handleShareTrip}
              style={styles.acceptedPrimary}
              testID="passenger-trip-share-button"
              accessibilityLabel="passenger-trip-share-button"
            />
          </View>
        </>
      )}
    </View>
  );
  return (
    <PrototypeScreenTransition>
      <View style={styles.container} pointerEvents="box-none">
        <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />
        <PrototypeMapLayer
          mapRef={mapRef}
          region={tripMapRegion}
          userCoordinate={normalizeMapCoordinate(currentCoordinate) || tripPickupCoordinate}
          userHeading={currentHeading}
          userAvatarLetter="L"
          driverCoordinate={tripDriverCoordinate}
          routeCoordinates={tripRouteCoordinates}
          destinationCoordinate={tripDestinationCoordinate || tripPickupCoordinate}
          destinationLabel={destination}
          destinationAddress={destinationAddress}
          originLabel="Partida"
          originAddress={currentAddress || 'Sua localização atual'}
          interactionEnabled={false}
          animateRoute
          driverMarkerMode="avatar"
          driverMarkerLetter={getFirstName(driverName, 'M')}
          destinationMarkerMode="place"
        />
        <PrototypeDismissibleSheet
          onClose={handleDismiss}
          sheetStyle={[styles.sheetWrap, { bottom: sheetBottom }]}
        >
          <LeafRideSheet
            onLayout={handleCardLayout}
            style={[
              styles.tripCard,
              shouldUseCompactTripCard && !isTripExpanded && styles.compactCard,
              { paddingBottom: 12 + safeBottom },
            ]}
            testID="passenger-trip-screen"
            accessibilityLabel="passenger-trip-screen"
          >
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

            {renderPassengerCardStateHeader()}

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
                      ? 'Pedido enviado'
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
                  <>
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
                    <SecurePaymentBadge style={styles.extensionSecurePaymentBadge} />
                  </>
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

              </>
            )}
          </LeafRideSheet>
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
    left: 0,
    right: 0
  },
  tripCard: {
    minHeight: 332,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    paddingTop: 16
  },
  compactCard: {
    minHeight: 332
  },
  sheetHandle: {
    width: 50,
    height: 4,
    borderRadius: 3,
    backgroundColor: '#D8D0C7',
    alignSelf: 'center',
    marginBottom: 24
  },
  hiddenText: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0
  },
  cardStateHeader: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12
  },
  cardStateTitle: {
    flex: 1,
    minWidth: 0,
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 20,
    lineHeight: 25
  },
  iconActionButton: {
    minWidth: 76,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    borderColor: leafRideColors.line,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 5,
    paddingHorizontal: 12
  },
  tripActionIcon: {
    minWidth: 76,
    height: 42
  },
  tripHeaderIconAction: {
    width: 66,
    height: 40
  },
  iconActionButtonWarning: {
    backgroundColor: leafRideColors.warning,
    borderColor: 'rgba(139,74,18,0.12)'
  },
  iconActionButtonDanger: {
    backgroundColor: leafRideColors.danger,
    borderColor: '#F5CBD2'
  },
  iconActionLabel: {
    color: leafRideColors.text,
    fontFamily: fonts.Medium,
    fontSize: 11,
    lineHeight: 16
  },
  iconActionLabelDanger: {
    color: leafRideColors.dangerText
  },
  iconActionLabelWarning: {
    color: leafRideColors.warningText
  },
  cardStateDivider: {
    marginTop: 14,
    marginBottom: 16
  },
  leafSheetHeader: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12
  },
  leafSheetTitle: {
    flex: 1,
    minWidth: 0,
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 18,
    lineHeight: 24
  },
  rideHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 14,
    marginBottom: 14
  },
  rideHeaderCopy: {
    flex: 1,
    minWidth: 0
  },
  rideKicker: {
    marginTop: 2,
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 11,
    lineHeight: 15
  },
  rideTitle: {
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 21,
    lineHeight: 27
  },
  rideRight: {
    minWidth: 58,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: leafRideColors.borderStrong,
    backgroundColor: '#FFFFFF',
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingHorizontal: 10,
    marginTop: 2
  },
  rideRightValue: {
    color: leafRideColors.text,
    fontFamily: fonts.Medium,
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center'
  },
  rideRightLabel: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 11,
    lineHeight: 14,
    textAlign: 'right'
  },
  rideRouteTimeline: {
    marginTop: 16,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: 'rgba(17,22,17,0.08)',
    paddingVertical: 12,
    gap: 12
  },
  rideRouteStep: {
    flexDirection: 'row',
    alignItems: 'flex-start'
  },
  rideRouteTrack: {
    width: 24,
    alignItems: 'center',
    paddingTop: 5,
    marginRight: 12
  },
  rideRouteDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: leafRideColors.text
  },
  rideRouteDotDestination: {
    backgroundColor: leafRideColors.leaf
  },
  rideRouteLine: {
    width: 1,
    height: 34,
    backgroundColor: 'rgba(17,22,17,0.16)',
    marginTop: 6
  },
  rideRouteCopy: {
    flex: 1,
    minWidth: 0
  },
  rideRouteMeta: {
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 10.5,
    lineHeight: 14
  },
  rideRouteAddress: {
    marginTop: 2,
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 14,
    lineHeight: 18
  },
  compactTitleRow: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 14
  },
  compactTitleRowStarted: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 4
  },
  compactTitleCopy: {
    flex: 1,
    minWidth: 0
  },
  compactTitle: {
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 20,
    lineHeight: 25
  },
  compactSubtitleStrong: {
    marginTop: 1,
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 15,
    lineHeight: 20
  },
  compactRightValue: {
    minWidth: 62,
    marginTop: 8,
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 18,
    lineHeight: 23,
    textAlign: 'right'
  },
  compactRightValueStarted: {
    marginTop: 0,
    minWidth: 0,
    textAlign: 'left'
  },
  sharePillButton: {
    height: 26,
    borderRadius: 13,
    paddingHorizontal: 12,
    borderColor: 'rgba(221,232,225,0.55)'
  },
  sharePillText: {
    color: leafRideColors.blueText,
    fontSize: 10.5,
    lineHeight: 14
  },
  driverIdentity: {
    marginTop: 0
  },
  acceptedIdentity: {
    marginTop: 12
  },
  vehicleColorText: {
    marginTop: 4,
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 11,
    lineHeight: 15
  },
  arrivedIdentity: {
    marginTop: 18
  },
  startedIdentity: {
    marginTop: 12
  },
  routeSummaryRow: {
    marginTop: 14,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center'
  },
  routeSummaryCopy: {
    flex: 1,
    minWidth: 0,
    marginLeft: 22
  },
  routeSummaryTitle: {
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 14,
    lineHeight: 18
  },
  routeSummaryMeta: {
    marginTop: 4,
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 10,
    lineHeight: 14
  },
  hiddenRouteProgress: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0
  },
  firstLeafRow: {
    marginTop: 0
  },
  leafDivider: {
    marginTop: 20,
    marginBottom: 20
  },
  pickupLeafRow: {
    marginTop: 22
  },
  startedShareRow: {
    marginTop: 22
  },
  passengerSecondaryActionsRow: {
    marginTop: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10
  },
  passengerSecondaryActionButton: {
    flex: 1,
    minWidth: 0
  },
  passengerPrimaryActionRow: {
    marginTop: 10
  },
  acceptedAction: {
    width: 94
  },
  acceptedCall: {
    width: 78
  },
  acceptedPrimary: {
    width: '100%',
    height: 46,
    borderRadius: 23
  },
  arrivedPrimary: {
    width: '100%',
    height: 46,
    borderRadius: 23
  },
  startedShareButton: {
    flex: 1,
    height: 42,
    borderRadius: 21
  },
  arrivedAction: {
    flex: 1
  },
  arrivedCancel: {
    width: 82
  },
  startedAction: {
    flex: 1,
    height: 44,
    borderRadius: 22
  },
  startedActionWide: {
    flex: 1.2,
    height: 44,
    borderRadius: 22
  },
  startedActionSmall: {
    width: 88,
    height: 44,
    borderRadius: 22
  },
  boardingTimerPanel: {
    marginTop: 12,
    alignItems: 'flex-start',
    paddingVertical: 0
  },
  boardingTimerCompactPanel: {
    marginTop: 2,
    marginBottom: 12,
    alignItems: 'center',
    paddingVertical: 4
  },
  boardingTimerValue: {
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 40,
    lineHeight: 46
  },
  boardingTimerMessage: {
    marginTop: 2,
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 13,
    lineHeight: 18
  },
  boardingTimerMessageUrgent: {
    color: leafRideColors.warningText
  },
  boardingTimerMessageExpired: {
    color: leafRideColors.dangerText
  },
  pinLeafRow: {
    marginTop: 18
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
    marginTop: 12,
    flexDirection: 'row',
    gap: 10,
    paddingTop: 2,
    paddingBottom: 2
  },
  metaBlock: {
    flex: 1,
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 5
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
  extensionSecurePaymentBadge: {
    marginTop: 6,
    alignSelf: 'center',
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
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(91,105,86,0.1)',
    paddingTop: 10
  },
  secondaryAction: {
    flex: 1,
    minHeight: 38,
    borderRadius: 19,
    backgroundColor: 'transparent',
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
    backgroundColor: 'rgba(255,244,245,0.58)'
  },
  warningActionText: {
    color: '#8A1F2B'
  },
  cancelAction: {
    marginTop: 6,
    minHeight: 38,
    borderRadius: 19,
    backgroundColor: 'transparent',
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
    marginTop: 0,
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 20,
    lineHeight: 25
  },
  tripCompactMetricRow: {
    marginTop: 14
  },
  tripCompactDivider: {
    marginTop: 12,
    marginBottom: 0
  },
  tripCompactInfoRow: {
    marginTop: 10
  },
  tripRouteProgress: {
    marginTop: 10
  },
  tripRouteProgressCompact: {
    marginTop: 4
  },
  tripRouteMeta: {
    marginTop: 8,
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 12,
    lineHeight: 16
  },
  tripCompactHeader: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12
  },
  tripCompactTitleCopy: {
    flex: 1,
    minWidth: 0
  },
  tripCompactEyebrow: {
    marginBottom: 2,
    color: leafRideColors.muted,
    fontFamily: fonts.SemiBold,
    fontSize: 10,
    lineHeight: 13,
    textTransform: 'uppercase',
    letterSpacing: 0.7
  },
  acceptedRoutePair: {
    marginTop: 12,
    minHeight: 52,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(207,216,205,0.74)',
    backgroundColor: 'rgba(242,244,239,0.62)',
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12
  },
  acceptedRouteStop: {
    flex: 1,
    minWidth: 0
  },
  acceptedRouteStopRight: {
    alignItems: 'flex-end'
  },
  acceptedRouteDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    backgroundColor: 'rgba(102,107,99,0.18)'
  },
  acceptedRouteLabel: {
    color: leafRideColors.muted,
    fontFamily: fonts.SemiBold,
    fontSize: 10,
    lineHeight: 13,
    textTransform: 'uppercase',
    letterSpacing: 0.6
  },
  acceptedRouteValue: {
    marginTop: 2,
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 13,
    lineHeight: 17
  },
  quietCancelAction: {
    marginTop: 10,
    minHeight: 30,
    alignSelf: 'center',
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5
  },
  quietCancelText: {
    color: leafRideColors.muted,
    fontFamily: fonts.Medium,
    fontSize: 12,
    lineHeight: 16
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
