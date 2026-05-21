import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActionSheetIOS,
  Alert,
  Linking,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fonts } from "../../theme/runtimeTokens";
import PrototypeScreenTransition from "../../components/prototype/PrototypeScreenTransition";
import PrototypeDismissibleSheet from "../../components/prototype/PrototypeDismissibleSheet";
import {
  LeafButton,
  LeafDivider,
  LeafPersonIdentity,
  LeafRideSheet,
  LeafRouteProgress,
  leafRideColors,
} from "../../components/prototype/LeafRideUI";
import { usePrototypeMapOcclusion } from "./prototypeMapOcclusion";
import { usePrototypeRideRuntime } from "./prototypeRideRuntime";
import { useLiveRouteTiming } from "./liveRouteTiming";

const SHEET_BOTTOM_OFFSET = 0;
const FALLBACK_CARD_HEIGHT = 318;

export const DRIVER_TRIP_RENDERED_CARD_FIELDS = Object.freeze({
  accepted: Object.freeze([
    "passenger_name",
    "passenger_photo",
    "pickup_address",
    "pickup_eta",
    "pickup_distance",
    "destination_preview",
    "ride_preferences",
    "navigation_action",
    "contact_actions",
    "arrived_action",
    "cancel_action",
  ]),
  arrived: Object.freeze([
    "passenger_name",
    "passenger_photo",
    "boarding_pin",
    "boarding_timer",
    "pickup_address",
    "contact_actions",
    "no_show_action",
    "start_trip_action",
  ]),
  started: Object.freeze([
    "destination_address",
    "eta_final",
    "distance_remaining",
    "route_progress",
    "net_payout",
    "passenger_name",
    "passenger_photo",
    "navigation_action",
    "report_problem_action",
    "finish_trip_action",
  ]),
});

function resolveDriverTripPrimaryActionTestID(status) {
  const normalizedStatus = String(status || "")
    .trim()
    .toLowerCase();

  if (normalizedStatus === "accepted") {
    return "driver-live-primary-action-arrive-button";
  }

  if (normalizedStatus === "arrived") {
    return "driver-live-primary-action-start-button";
  }

  if (normalizedStatus === "started") {
    return "driver-live-primary-action-complete-button";
  }

  return "driver-live-primary-action-button";
}

function formatCurrency(value) {
  return `R$ ${Number(value || 0)
    .toFixed(2)
    .replace(".", ",")}`;
}

function formatDistanceLabel(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "--";
  }

  const fractionDigits = numeric >= 10 ? 0 : numeric >= 2 ? 1 : 2;
  return `${numeric.toFixed(fractionDigits).replace(".", ",")} km`;
}

function formatBoardingTimer(seconds) {
  const normalizedSeconds = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(normalizedSeconds / 60)}:${String(normalizedSeconds % 60).padStart(2, "0")}`;
}

function resolveDisplayNetAmount(request, driverTripMeta, selectedFare) {
  const preferredPositiveAmount =
    [
      request?.estimatedDriverNetAmount,
      request?.driverNetAmount,
      driverTripMeta?.fare,
      selectedFare,
      request?.fare,
    ].find((value) => Number.isFinite(Number(value)) && Number(value) > 0) ?? null;

  if (preferredPositiveAmount !== null) {
    return Number(preferredPositiveAmount);
  }

  const firstKnownAmount =
    [
      request?.estimatedDriverNetAmount,
      request?.driverNetAmount,
      driverTripMeta?.fare,
      selectedFare,
      request?.fare,
    ].find((value) => Number.isFinite(Number(value))) ?? null;

  return firstKnownAmount === null ? null : Number(firstKnownAmount);
}

function getFirstName(value) {
  return String(value || "")
    .trim()
    .split(/\s+/)[0];
}

function toRouteNumber(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildDriverTripRequestFromRouteParams(params = {}) {
  if (!params || typeof params !== "object") {
    return null;
  }

  if (params.request && typeof params.request === "object") {
    return params.request;
  }

  if (typeof params.request === "string") {
    try {
      const parsed = JSON.parse(params.request);
      if (parsed && typeof parsed === "object") {
        return parsed;
      }
    } catch (_error) {
      // Continue with scalar deep-link params.
    }
  }

  const bookingId = String(params.bookingId || params.qaBookingId || params.id || "").trim();
  if (!bookingId) {
    return null;
  }

  const driverNetAmount = toRouteNumber(params.driverNetAmount ?? params.estimatedDriverNetAmount, null);
  const fare = toRouteNumber(params.fare ?? params.grossFare ?? params.amount, null);

  return {
    bookingId,
    id: bookingId,
    status: String(params.status || params.qaStatus || "accepted").trim().toLowerCase(),
    passengerName: String(params.passengerName || params.passenger || "Passageiro Leaf").trim(),
    passenger: String(params.passengerName || params.passenger || "Passageiro Leaf").trim(),
    pickupAddress: String(params.pickupAddress || params.pickup || "Embarque indisponível").trim(),
    pickup: String(params.pickupAddress || params.pickup || "Embarque indisponível").trim(),
    dropoffAddress: String(params.dropoffAddress || params.dropoff || "Destino indisponível").trim(),
    dropoff: String(params.dropoffAddress || params.dropoff || "Destino indisponível").trim(),
    ...(fare !== null ? { fare, grossFare: fare } : {}),
    ...(driverNetAmount !== null
      ? {
          driverNetAmount,
          estimatedDriverNetAmount: driverNetAmount,
        }
      : {}),
    distanceKm: toRouteNumber(params.distanceKm, undefined),
    pickupEtaMin: toRouteNumber(params.pickupEtaMin, undefined),
    tripDurationMin: toRouteNumber(params.tripDurationMin, undefined),
    pricingSnapshotLocked: String(params.pricingSnapshotLocked || "true") !== "false",
  };
}

function resolveRidePreferenceItems(source = {}) {
  const preferences =
    source?.preferences ||
    source?.ridePreferences ||
    source?.comfortPreferences ||
    {};
  if (!preferences || typeof preferences !== "object") {
    return [];
  }

  const temperatureLabel = String(
    preferences.temperatureLabel ||
      preferences.temperaturePreferenceLabel ||
      preferences.comfort?.temperature?.label ||
      "",
  ).trim();
  const soundLabel = String(
    preferences.soundLabel ||
      preferences.soundPreferenceLabel ||
      preferences.comfort?.sound?.label ||
      "",
  ).trim();

  return [
    temperatureLabel ? { key: "temperature", label: temperatureLabel } : null,
    soundLabel ? { key: "sound", label: soundLabel } : null,
  ].filter(Boolean);
}

function IconActionButton({
  icon,
  label,
  onPress,
  disabled = false,
  tone = "ghost",
  style,
  testID,
}) {
  const isDanger = tone === "danger";
  const isPrimary = tone === "primary";
  return (
    <TouchableOpacity
      activeOpacity={0.82}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.iconActionButton,
        isDanger && styles.iconActionButtonDanger,
        isPrimary && styles.iconActionButtonPrimary,
        disabled && styles.iconActionButtonDisabled,
        style,
      ]}
    >
      <Ionicons
        name={icon}
        size={16}
        color={isPrimary ? "#FFFFFF" : isDanger ? leafRideColors.dangerText : leafRideColors.leaf}
      />
      <Text
        style={[
          styles.iconActionLabel,
          isPrimary && styles.iconActionLabelPrimary,
          isDanger && styles.iconActionLabelDanger,
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

export default function RobotaxiDriverTripScreen({ navigation, route }) {
  const {
    bookingStatus,
    driverActiveRide,
    driverTripMeta,
    selectedDestination,
    selectedFare,
    currentAddress,
    tripDistanceKm,
    tripDurationMin,
    tripArrivalText,
    boardingRemainingSec,
    markDriverArrived,
    startTripFlow,
    completeTripFlow,
    lastError,
  } = usePrototypeRideRuntime();
  const insets = useSafeAreaInsets();
  const [cardHeight, setCardHeight] = useState(FALLBACK_CARD_HEIGHT);
  const [busyAction, setBusyAction] = useState(false);
  const safeBottom = Math.max(0, Number(insets.bottom) || 0);
  const sheetBottom = SHEET_BOTTOM_OFFSET;

  const request = useMemo(() => {
    if (driverActiveRide?.bookingId || driverActiveRide?.id) {
      return driverActiveRide;
    }

    if (route?.params?.request?.bookingId || route?.params?.request?.id) {
      return route.params.request;
    }

    return buildDriverTripRequestFromRouteParams(route?.params);
  }, [driverActiveRide, route?.params]);
  const hasActiveRide = Boolean(request?.bookingId || request?.id);
  const normalizedBookingStatus = String(
    (hasActiveRide && (request?.status || driverActiveRide?.status)) ||
      bookingStatus ||
      "",
  )
    .trim()
    .toLowerCase();
  const pickupLabel =
    String(
      request?.pickup || request?.pickupAddress || currentAddress || "",
    ).trim() || "Embarque indisponível";
  const dropoffLabel =
    String(
      request?.dropoff ||
        request?.dropoffAddress ||
        selectedDestination?.name ||
        "",
    ).trim() || "Destino indisponível";
  const dropoffTitle =
    String(selectedDestination?.name || dropoffLabel.split(",")[0] || dropoffLabel).trim() ||
    dropoffLabel;
  const tripFareValue = resolveDisplayNetAmount(
    request,
    driverTripMeta,
    selectedFare,
  );
  const tripFareLabel = Number.isFinite(tripFareValue)
    ? formatCurrency(tripFareValue)
    : "--";
  const passengerLabel =
    String(
      request?.passengerName ||
        request?.passenger ||
        request?.customerName ||
        request?.customer?.name ||
        "Passageiro Leaf",
    ).trim() || "Passageiro Leaf";
  const passengerFirstName = getFirstName(passengerLabel) || "Passageiro";
  const passengerInitial =
    passengerFirstName.trim().charAt(0).toUpperCase() || "P";
  const passengerPhotoUri =
    String(
      request?.passengerPhoto ||
        request?.passenger?.photo ||
        request?.passenger?.photoURL ||
        request?.customerPhoto ||
        request?.customer?.photo ||
        request?.customer?.profileImage ||
        driverTripMeta?.passengerPhoto ||
        route?.params?.passengerPhoto ||
        "",
    ).trim() || null;
  const ridePreferenceItems = resolveRidePreferenceItems(request);
  const ridePreferenceSummary = ridePreferenceItems.length > 0
    ? ridePreferenceItems.map(item => item.label).join(" · ")
    : "Preferências padrão";
  const etaMin = Math.max(2, Number(tripDurationMin || request?.pickupEtaMin || 4));
  const effectiveDistanceKm =
    Number.isFinite(Number(tripDistanceKm)) && Number(tripDistanceKm) > 0
      ? Number(tripDistanceKm)
      : normalizedBookingStatus === "accepted" || normalizedBookingStatus === "arrived"
        ? request?.pickupDistanceKm || request?.distanceKm || request?.tripDistanceKm
        : request?.tripDistanceKm || request?.distanceKm;
  const distanceLabel = formatDistanceLabel(effectiveDistanceKm);
  const routeTotalMinutes =
    request?.initialTripDurationMin ||
    request?.estimatedTotalDurationMin ||
    request?.totalDurationMin ||
    driverTripMeta?.initialEtaMinutes;
  const routeStartedAt =
    request?.startedAt ||
    request?.tripStartedAt ||
    driverActiveRide?.startedAt ||
    driverActiveRide?.tripStartedAt;
  const liveRouteKey = [
    request?.bookingId,
    request?.id,
    normalizedBookingStatus,
    routeStartedAt,
    pickupLabel,
    dropoffTitle,
  ]
    .filter(Boolean)
    .join(":");
  const {
    routeProgress,
    arrivalClockLabel,
    displayEtaMinutes,
  } = useLiveRouteTiming({
    routeKey: liveRouteKey || "driver-trip-route",
    remainingMinutes: etaMin,
    totalMinutes: routeTotalMinutes,
    startedAt: routeStartedAt,
    active: normalizedBookingStatus === "started",
  });
  const etaLabel =
    Number.isFinite(displayEtaMinutes) && displayEtaMinutes > 0
      ? `${displayEtaMinutes} min`
      : `${etaMin} min`;
  const driverArrivalSummary = arrivalClockLabel || `chegada ${etaLabel}`;
  const driverStartedSummary = [
    distanceLabel && distanceLabel !== "--" ? `${distanceLabel} restante` : null,
    driverArrivalSummary,
  ]
    .filter(Boolean)
    .join(" · ");
  const boardingPin =
    String(
      request?.boardingPin ||
        request?.boardingCode ||
        request?.pin ||
        route?.params?.boardingPin ||
        "",
    ).trim() || "4821";
  const rawBoardingSeconds = Number(boardingRemainingSec);
  const boardingTimerSeconds = Number.isFinite(rawBoardingSeconds)
    ? Math.max(0, Math.round(rawBoardingSeconds))
    : normalizedBookingStatus === "arrived"
      ? 120
      : null;
  const boardingCountdownLabel =
    boardingTimerSeconds === null ? null : formatBoardingTimer(boardingTimerSeconds);
  const boardingTimerMessage =
    boardingTimerSeconds === null || boardingTimerSeconds > 30
      ? "Inicie quando estiver tudo certo"
      : boardingTimerSeconds > 0
        ? "Embarque urgente"
        : "Uma taxa poderá ser aplicada";
  const isBoardingTimerUrgent =
    boardingTimerSeconds !== null && boardingTimerSeconds > 0 && boardingTimerSeconds <= 30;
  const isBoardingTimerExpired = boardingTimerSeconds === 0;
  const primaryActionTestID =
    resolveDriverTripPrimaryActionTestID(normalizedBookingStatus);
  const primaryLabel = busyAction
    ? "Atualizando..."
    : normalizedBookingStatus === "accepted"
      ? "Cheguei"
      : normalizedBookingStatus === "arrived"
        ? "Iniciar"
        : normalizedBookingStatus === "started"
          ? "Finalizar"
          : "Voltar";
  const headerCopy = useMemo(() => {
    if (!hasActiveRide) {
      return {
        title: "Sem corrida ativa",
        subtitle: "Volte ao painel para receber novas solicitações.",
        right: null,
        rightTone: "leaf",
      };
    }

    if (normalizedBookingStatus === "accepted") {
      return {
        title: "Indo buscar",
        subtitle: "Siga até o ponto e confirme quando chegar.",
        right: "Rota",
        rightTone: "blue",
      };
    }

    if (normalizedBookingStatus === "arrived") {
      return {
        title: "No ponto de encontro",
        subtitle: "Confirme o código e inicie a viagem.",
        right: "Ajuda",
        rightTone: "leaf",
      };
    }

    if (normalizedBookingStatus === "started") {
      return {
        title: `A caminho de ${dropoffTitle}`,
        subtitle: "Destino, rota e ações críticas sempre visíveis.",
        right: "SOS",
        rightTone: "warning",
      };
    }

    return {
      title: "Corrida em atualização",
      subtitle: "Sincronizando estado atual da viagem.",
      right: null,
      rightTone: "leaf",
    };
  }, [dropoffTitle, hasActiveRide, normalizedBookingStatus]);

  useEffect(() => {
    if (bookingStatus === "completed") {
      navigation.navigate("RobotaxiPrototypeReceipt", { fromTrip: true });
    }
  }, [bookingStatus, navigation]);

  usePrototypeMapOcclusion({
    routeKey: route?.key,
    layerId: route?.key || "prototype-driver-trip",
    occludedBottom: sheetBottom + cardHeight,
  });

  const handleDismiss = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate("RobotaxiPrototype");
  };

  const handleCardLayout = useCallback((event) => {
    const nextHeight = event?.nativeEvent?.layout?.height;
    if (Number.isFinite(nextHeight) && nextHeight > 0) {
      setCardHeight(nextHeight);
    }
  }, []);

  const handlePrimaryAction = useCallback(async () => {
    if (busyAction) {
      return;
    }

    if (!hasActiveRide) {
      navigation.navigate("RobotaxiPrototype");
      return;
    }

    try {
      setBusyAction(true);

      if (normalizedBookingStatus === "accepted") {
        await markDriverArrived();
        return;
      }

      if (normalizedBookingStatus === "arrived") {
        await startTripFlow();
        return;
      }

      if (normalizedBookingStatus === "started") {
        await completeTripFlow();
        navigation.navigate("RobotaxiPrototypeReceipt", { fromTrip: true });
        return;
      }

      navigation.navigate("RobotaxiPrototype");
    } catch (error) {
      Alert.alert(
        "Não foi possível atualizar",
        error?.message || "Falha ao atualizar corrida.",
      );
    } finally {
      setBusyAction(false);
    }
  }, [
    busyAction,
    completeTripFlow,
    hasActiveRide,
    markDriverArrived,
    navigation,
    normalizedBookingStatus,
    startTripFlow,
  ]);

  const handleOpenNavigation = useCallback(async () => {
    if (!hasActiveRide) {
      Alert.alert(
        "Nenhuma corrida ativa",
        "Receba uma nova solicitação antes de abrir a navegação.",
      );
      return;
    }

    const destinationCoordinate =
      request?.destinationCoordinate || selectedDestination?.coordinate || null;

    if (
      !destinationCoordinate ||
      !Number.isFinite(
        Number(destinationCoordinate.latitude ?? destinationCoordinate.lat),
      ) ||
      !Number.isFinite(
        Number(destinationCoordinate.longitude ?? destinationCoordinate.lng),
      )
    ) {
      Alert.alert(
        "Destino indisponível",
        "Não foi possível localizar o destino desta corrida no momento.",
      );
      return;
    }

    const latitude = Number(
      destinationCoordinate.latitude ?? destinationCoordinate.lat,
    );
    const longitude = Number(
      destinationCoordinate.longitude ?? destinationCoordinate.lng,
    );
    const googleAppUrl = `comgooglemaps://?daddr=${latitude},${longitude}&directionsmode=driving`;
    const googleWebUrl = `https://maps.google.com/?daddr=${latitude},${longitude}&directionsmode=driving`;
    const wazeAppUrl = `waze://?ll=${latitude},${longitude}&navigate=yes`;
    const wazeWebUrl = `https://waze.com/ul?ll=${latitude},${longitude}&navigate=yes`;
    const appleMapsUrl = `http://maps.apple.com/?daddr=${latitude},${longitude}&dirflg=d`;

    const openGoogleMaps = async () => {
      const canOpenNative = await Linking.canOpenURL(googleAppUrl);
      await Linking.openURL(canOpenNative ? googleAppUrl : googleWebUrl);
    };

    const openAppleMaps = async () => {
      await Linking.openURL(appleMapsUrl);
    };

    const openWaze = async () => {
      const canOpenNative = await Linking.canOpenURL(wazeAppUrl);
      await Linking.openURL(canOpenNative ? wazeAppUrl : wazeWebUrl);
    };

    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ["Cancelar", "Mapas da Apple", "Google Maps", "Waze"],
          cancelButtonIndex: 0,
        },
        async (selectedIndex) => {
          try {
            if (selectedIndex === 1) {
              await openAppleMaps();
            } else if (selectedIndex === 2) {
              await openGoogleMaps();
            } else if (selectedIndex === 3) {
              await openWaze();
            }
          } catch (error) {
            Alert.alert(
              "Não foi possível abrir a navegação",
              error?.message || "Tente novamente.",
            );
          }
        },
      );
      return;
    }

    Alert.alert("Escolher navegação", "Selecione o app para abrir a rota.", [
      { text: "Cancelar", style: "cancel" },
      { text: "Google Maps", onPress: () => openGoogleMaps().catch(() => {}) },
      { text: "Waze", onPress: () => openWaze().catch(() => {}) },
    ]);
  }, [
    hasActiveRide,
    request?.destinationCoordinate,
    selectedDestination?.coordinate,
  ]);

  const handleCallPassenger = useCallback(() => {
    Alert.alert(
      "Ligação pelo app",
      "A chamada direta ainda depende do telefone mascarado do passageiro.",
    );
  }, []);

  const handleNoShow = useCallback(() => {
    Alert.alert(
      "No-show pendente",
      "O design já prevê a ação, mas a confirmação de no-show ainda precisa ser ligada ao runtime principal.",
    );
  }, []);

  const renderCardStateHeader = (rightContent = null) => (
    <>
      <View style={styles.cardStateHeader}>
        <View style={styles.cardStateCopy}>
          <Text style={styles.cardStateTitle} numberOfLines={2}>
            {headerCopy.title}
          </Text>
        </View>
        {rightContent}
      </View>
      <LeafDivider style={styles.cardStateDivider} />
    </>
  );

  const renderPayoutBlock = () => (
    <View style={styles.driverPayout}>
      <Text style={styles.driverPayoutValue} numberOfLines={1}>
        {tripFareLabel}
      </Text>
      <Text style={styles.driverPayoutLabel} numberOfLines={1}>
        líquido
      </Text>
    </View>
  );

  const renderDriverCard = () => {
    if (!hasActiveRide) {
      return (
        <>
          <View style={styles.sheetHandle} />
          <LeafButton
            label="Voltar"
            tone="primary"
            onPress={handlePrimaryAction}
            style={styles.emptyBackButton}
            testID={primaryActionTestID}
            accessibilityLabel={primaryActionTestID}
          />
          <Text style={styles.emptyTitle}>Nenhuma corrida ativa</Text>
          <Text style={styles.emptyText}>
            Volte ao painel para receber novas solicitações.
          </Text>
        </>
      );
    }

    if (normalizedBookingStatus === "arrived") {
      return (
        <>
          <View style={styles.sheetHandle} />
          {renderCardStateHeader(
            <View style={styles.driverPayout}>
              <Text style={styles.driverPayoutValue} numberOfLines={1}>
                {boardingCountdownLabel || "0:00"}
              </Text>
              <Text style={styles.driverPayoutLabel} numberOfLines={1}>
                embarque
              </Text>
            </View>,
          )}
          <LeafPersonIdentity
            initial={passengerInitial}
            photoUri={passengerPhotoUri}
            name={passengerLabel}
            meta="Confirme antes de iniciar"
            compact
            style={styles.passengerIdentity}
            testID="driver-trip-passenger-identity"
          />

          <View style={styles.pinPanel}>
            <View style={styles.pinCopy}>
              <Text style={styles.pinLabel} numberOfLines={1}>
                Código da corrida
              </Text>
              <Text
                style={[
                  styles.pinHint,
                  isBoardingTimerUrgent && styles.boardingTimerMessageUrgent,
                  isBoardingTimerExpired && styles.boardingTimerMessageExpired,
                ]}
                numberOfLines={1}
              >
                {boardingTimerMessage}
              </Text>
            </View>
            <Text style={styles.pinValue} numberOfLines={1}>
              {boardingPin}
            </Text>
          </View>

          <View style={styles.driverRouteTimeline}>
            <View style={styles.driverRouteStep}>
              <View style={styles.driverRouteTrack}>
                <View style={styles.driverRouteDot} />
              </View>
              <View style={styles.driverRouteCopy}>
                <Text style={styles.driverRouteMeta} numberOfLines={1}>
                  Ponto de encontro
                </Text>
                <Text style={styles.driverRouteAddress} numberOfLines={1}>
                  {pickupLabel}
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.secondaryActionsRow}>
            <IconActionButton
              icon="call-outline"
              label="Ligar"
              onPress={handleCallPassenger}
              style={styles.secondaryActionButton}
              testID="driver-trip-call-button"
            />
            <IconActionButton
              icon="chatbubble-outline"
              label="Chat"
              onPress={() => navigation.navigate("RobotaxiPrototypeChat")}
              style={styles.secondaryActionButton}
              testID="driver-trip-chat-button"
            />
            <IconActionButton
              icon="person-remove-outline"
              label="No-show"
              tone="danger"
              onPress={handleNoShow}
              style={styles.secondaryActionButton}
              testID="driver-trip-no-show-button"
            />
          </View>
          <View style={styles.primaryActionRow}>
            <LeafButton
              label={primaryLabel}
              tone="primary"
              disabled={busyAction}
              onPress={handlePrimaryAction}
              style={styles.primaryAction}
              testID={primaryActionTestID}
              accessibilityLabel={primaryActionTestID}
            />
          </View>
        </>
      );
    }

    if (normalizedBookingStatus === "started") {
      return (
        <>
          <View style={styles.sheetHandle} />
          {renderCardStateHeader(renderPayoutBlock())}

          <LeafRouteProgress
            originLabel={pickupLabel}
            destinationLabel={dropoffTitle}
            progress={routeProgress}
            progressKey={liveRouteKey || "driver-trip-route"}
            arrivalLabel={null}
            style={styles.driverRouteProgress}
            testID="driver-trip-route-progress"
          />
          <Text style={styles.driverRouteSummaryText} numberOfLines={1}>
            {driverStartedSummary}
          </Text>
          <LeafPersonIdentity
            initial={passengerInitial}
            photoUri={passengerPhotoUri}
            name={passengerLabel}
            meta="A bordo"
            compact
            style={styles.infoRow}
            testID="driver-trip-passenger-identity"
          />

          <View style={styles.secondaryActionsRow}>
            <IconActionButton
              icon="navigate-outline"
              label="Navegar"
              onPress={handleOpenNavigation}
              style={styles.secondaryActionButton}
              testID="driver-trip-navigation-button"
            />
            <IconActionButton
              icon="warning-outline"
              label="Reportar"
              tone="danger"
              onPress={() => navigation.navigate("RobotaxiPrototypeSupport")}
              style={styles.secondaryActionButton}
              testID="driver-trip-report-button"
            />
          </View>
          <View style={styles.primaryActionRow}>
            <LeafButton
              label={primaryLabel}
              tone="primary"
              disabled={busyAction}
              onPress={handlePrimaryAction}
              style={styles.primaryAction}
              testID={primaryActionTestID}
              accessibilityLabel={primaryActionTestID}
            />
          </View>
        </>
      );
    }

    return (
      <>
        <View style={styles.sheetHandle} />
        {renderCardStateHeader(renderPayoutBlock())}

        <LeafPersonIdentity
          initial={passengerInitial}
          photoUri={passengerPhotoUri}
          name={passengerLabel}
          meta={`${etaLabel} · ${distanceLabel} até o embarque`}
          compact
          style={styles.passengerIdentity}
          testID="driver-trip-passenger-identity"
        />

        <View style={styles.driverRouteTimeline}>
          <View style={styles.driverRouteStep}>
            <View style={styles.driverRouteTrack}>
              <View style={styles.driverRouteDot} />
              <View style={styles.driverRouteLine} />
            </View>
            <View style={styles.driverRouteCopy}>
              <Text style={styles.driverRouteMeta} numberOfLines={1}>
                Embarque
              </Text>
              <Text style={styles.driverRouteAddress} numberOfLines={1}>
                {pickupLabel}
              </Text>
            </View>
          </View>
          <View style={styles.driverRouteStep}>
            <View style={styles.driverRouteTrack}>
              <View style={[styles.driverRouteDot, styles.driverRouteDotDestination]} />
            </View>
            <View style={styles.driverRouteCopy}>
              <Text style={styles.driverRouteMeta} numberOfLines={1}>
                Destino · {ridePreferenceSummary}
              </Text>
              <Text style={styles.driverRouteAddress} numberOfLines={1}>
                {dropoffLabel}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.secondaryActionsRow}>
          <IconActionButton
            icon="chatbubble-outline"
            label="Chat"
            onPress={() => navigation.navigate("RobotaxiPrototypeChat")}
            style={styles.secondaryActionButton}
            testID="driver-trip-chat-button"
          />
          <IconActionButton
            icon="navigate-outline"
            label="Navegar"
            onPress={handleOpenNavigation}
            style={styles.secondaryActionButton}
            testID="driver-trip-navigation-button"
          />
          <IconActionButton
            icon="close-circle-outline"
            label="Cancelar"
            tone="danger"
            onPress={() => navigation.navigate("RobotaxiPrototypeCancellation", { source: "driver-trip" })}
            style={styles.secondaryActionButton}
            testID="driver-trip-cancel-button"
          />
        </View>
        <View style={styles.primaryActionRow}>
          <LeafButton
            label={primaryLabel}
            tone="primary"
            disabled={busyAction}
            onPress={handlePrimaryAction}
            style={styles.primaryAction}
            testID={primaryActionTestID}
            accessibilityLabel={primaryActionTestID}
          />
        </View>
      </>
    );
  };

  return (
    <PrototypeScreenTransition>
      <View style={styles.container} pointerEvents="box-none">
        <StatusBar
          translucent
          backgroundColor="transparent"
          barStyle="dark-content"
        />

        <PrototypeDismissibleSheet
          onClose={handleDismiss}
          sheetStyle={[styles.sheetWrap, { bottom: sheetBottom }]}
        >
          <LeafRideSheet
            onLayout={handleCardLayout}
            style={[styles.tripCard, { paddingBottom: 12 + safeBottom }]}
            testID="driver-live-trip-screen"
            accessibilityLabel="driver-live-trip-screen"
          >
            {renderDriverCard()}

            {lastError ? <Text style={styles.errorText}>{lastError}</Text> : null}
          </LeafRideSheet>
        </PrototypeDismissibleSheet>
      </View>
    </PrototypeScreenTransition>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "transparent",
  },
  sheetWrap: {
    position: "absolute",
    left: 0,
    right: 0,
  },
  tripCard: {
    minHeight: 332,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    paddingTop: 14,
  },
  sheetHandle: {
    width: 50,
    height: 4,
    borderRadius: 3,
    backgroundColor: "#D8D0C7",
    alignSelf: "center",
    marginBottom: 24,
  },
  cardStateHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  cardStateCopy: {
    flex: 1,
    minWidth: 0,
  },
  cardStateTitle: {
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 21,
    lineHeight: 27,
  },
  driverPayout: {
    minWidth: 82,
    alignItems: "flex-end",
    paddingTop: 2,
  },
  driverPayoutValue: {
    color: leafRideColors.leaf,
    fontFamily: fonts.SemiBold,
    fontSize: 16,
    lineHeight: 21,
    textAlign: "right",
  },
  driverPayoutLabel: {
    marginTop: 1,
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 11,
    lineHeight: 14,
    textAlign: "right",
  },
  cardHeaderPill: {
    minWidth: 62,
    marginTop: 2,
  },
  cardStateDivider: {
    marginTop: 8,
    marginBottom: 10,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  sheetHeaderCopy: {
    flex: 1,
    minWidth: 0,
  },
  sheetTitle: {
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 18,
    lineHeight: 24,
  },
  sheetSubtitle: {
    marginTop: 2,
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 11,
    lineHeight: 15,
  },
  boardingTimerPanel: {
    marginTop: 8,
    alignItems: "flex-start",
    paddingVertical: 2,
  },
  boardingTimerValue: {
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 34,
    lineHeight: 39,
  },
  boardingTimerMessage: {
    marginTop: 3,
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 13,
    lineHeight: 18,
  },
  boardingTimerMessageUrgent: {
    color: leafRideColors.warningText,
  },
  boardingTimerMessageExpired: {
    color: leafRideColors.dangerText,
  },
  pinPanel: {
    marginTop: 14,
    minHeight: 54,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(17,22,17,0.08)",
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 14,
  },
  pinCopy: {
    flex: 1,
    minWidth: 0,
  },
  pinLabel: {
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 14,
    lineHeight: 18,
  },
  pinHint: {
    marginTop: 2,
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 12,
    lineHeight: 16,
  },
  pinValue: {
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 22,
    lineHeight: 28,
  },
  driverRouteTimeline: {
    marginTop: 14,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: leafRideColors.line,
    paddingVertical: 12,
    gap: 12,
  },
  driverRouteStep: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  driverRouteTrack: {
    width: 24,
    alignItems: "center",
    paddingTop: 5,
    marginRight: 12,
  },
  driverRouteDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: leafRideColors.text,
  },
  driverRouteDotDestination: {
    backgroundColor: leafRideColors.leaf,
  },
  driverRouteLine: {
    width: 1,
    height: 34,
    backgroundColor: "rgba(17,22,17,0.16)",
    marginTop: 6,
  },
  driverRouteCopy: {
    flex: 1,
    minWidth: 0,
  },
  driverRouteMeta: {
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 10.5,
    lineHeight: 14,
  },
  driverRouteAddress: {
    marginTop: 2,
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 14,
    lineHeight: 18,
  },
  driverRouteProgress: {
    marginTop: 0,
  },
  driverRouteSummaryText: {
    marginTop: 8,
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 12,
    lineHeight: 16,
  },
  firstMetricRow: {
    marginTop: 0,
  },
  firstInfoRow: {
    marginTop: 0,
  },
  passengerIdentity: {
    marginTop: 0,
  },
  pinInfoRow: {
    marginTop: 10,
  },
  infoRow: {
    marginTop: 10,
  },
  divider: {
    marginTop: 12,
    marginBottom: 0,
  },
  secondaryActionsRow: {
    marginTop: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  secondaryActionButton: {
    flex: 1,
    minWidth: 0,
  },
  primaryActionRow: {
    marginTop: 10,
  },
  iconActionButton: {
    minWidth: 76,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    borderColor: leafRideColors.line,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 5,
    paddingHorizontal: 12,
  },
  iconActionButtonDanger: {
    backgroundColor: leafRideColors.danger,
    borderColor: leafRideColors.danger,
  },
  iconActionButtonPrimary: {
    backgroundColor: leafRideColors.leaf,
    borderColor: leafRideColors.leaf,
  },
  iconActionLabel: {
    color: leafRideColors.text,
    fontFamily: fonts.Medium,
    fontSize: 11,
    lineHeight: 16,
  },
  iconActionLabelPrimary: {
    color: "#FFFFFF",
  },
  iconActionLabelDanger: {
    color: leafRideColors.dangerText,
  },
  iconActionButtonDisabled: {
    opacity: 0.52,
  },
  primaryAction: {
    flex: 1,
    width: "100%",
    height: 46,
    borderRadius: 23,
  },
  emptyBackButton: {
    alignSelf: "flex-start",
  },
  emptyTitle: {
    marginTop: 18,
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 22,
    lineHeight: 27,
  },
  emptyText: {
    marginTop: 6,
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 13,
    lineHeight: 17,
  },
  errorText: {
    marginTop: 10,
    color: leafRideColors.dangerText,
    fontFamily: fonts.Medium,
    fontSize: 13,
    lineHeight: 17,
    textAlign: "center",
  },
});
