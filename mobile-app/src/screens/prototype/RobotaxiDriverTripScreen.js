import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActionSheetIOS,
  Alert,
  Linking,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fonts } from "../../theme/runtimeTokens";
import PrototypeScreenTransition from "../../components/prototype/PrototypeScreenTransition";
import PrototypeDismissibleSheet from "../../components/prototype/PrototypeDismissibleSheet";
import PrototypeConnectionStatusPill from "../../components/prototype/PrototypeConnectionStatusPill";
import {
  LeafAnimatedPressable,
  LeafButton,
  LeafDivider,
  LeafPersonIdentity,
  LeafRideSheet,
  LeafRouteProgress,
  LeafStateHeader,
  leafButtonMetrics,
  leafRideColors,
} from "../../components/prototype/LeafRideUI";
import { usePrototypeMapOcclusion } from "./prototypeMapOcclusion";
import { usePrototypeRideRuntime } from "./prototypeRideRuntime";
import { useLiveRouteTiming } from "./liveRouteTiming";
import {
  RIDE_CARD_ROLES,
  RIDE_CARD_STATES,
  createRideCardFieldTestIDs,
  defineRideCardRenderedFields,
} from "./rideCardContract";

const SHEET_BOTTOM_OFFSET = 0;
const FALLBACK_CARD_HEIGHT = 318;
const PROTECTED_DRIVER_TRIP_STATUSES = new Set([
  "accepted",
  "arrived",
  "started",
]);

const DRIVER_TO_PICKUP_RENDERED_CARD_FIELD_IDS = Object.freeze([
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
]);

const DRIVER_AT_PICKUP_RENDERED_CARD_FIELD_IDS = Object.freeze([
  "passenger_name",
  "passenger_photo",
  "boarding_pin",
  "boarding_timer",
  "pickup_address",
  "contact_actions",
  "no_show_action",
  "start_trip_action",
]);

const DRIVER_IN_TRIP_RENDERED_CARD_FIELD_IDS = Object.freeze([
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
]);

const DRIVER_TO_PICKUP_FIELD_TEST_ID_OVERRIDES = Object.freeze({
  arrived_action: "driver-live-primary-action-arrive-button",
  cancel_action: "driver-trip-cancel-button",
  contact_actions: "driver-trip-chat-button",
  navigation_action: "driver-trip-navigation-button",
});

const DRIVER_AT_PICKUP_FIELD_TEST_ID_OVERRIDES = Object.freeze({
  contact_actions: "driver-trip-chat-button",
  no_show_action: "driver-trip-no-show-button",
  start_trip_action: "driver-live-primary-action-start-button",
});

const DRIVER_IN_TRIP_FIELD_TEST_ID_OVERRIDES = Object.freeze({
  finish_trip_action: "driver-live-primary-action-complete-button",
  navigation_action: "driver-trip-navigation-button",
  report_problem_action: "driver-trip-report-button",
});

const DRIVER_TRIP_FIELD_TEST_IDS = Object.freeze({
  accepted: createRideCardFieldTestIDs(
    RIDE_CARD_ROLES.DRIVER,
    RIDE_CARD_STATES.DRIVER_TO_PICKUP,
    DRIVER_TO_PICKUP_RENDERED_CARD_FIELD_IDS,
    DRIVER_TO_PICKUP_FIELD_TEST_ID_OVERRIDES,
  ),
  arrived: createRideCardFieldTestIDs(
    RIDE_CARD_ROLES.DRIVER,
    RIDE_CARD_STATES.DRIVER_AT_PICKUP,
    DRIVER_AT_PICKUP_RENDERED_CARD_FIELD_IDS,
    DRIVER_AT_PICKUP_FIELD_TEST_ID_OVERRIDES,
  ),
  started: createRideCardFieldTestIDs(
    RIDE_CARD_ROLES.DRIVER,
    RIDE_CARD_STATES.DRIVER_IN_TRIP,
    DRIVER_IN_TRIP_RENDERED_CARD_FIELD_IDS,
    DRIVER_IN_TRIP_FIELD_TEST_ID_OVERRIDES,
  ),
});

export const DRIVER_TRIP_RENDERED_CARD_FIELDS = Object.freeze({
  accepted: defineRideCardRenderedFields(
    RIDE_CARD_ROLES.DRIVER,
    RIDE_CARD_STATES.DRIVER_TO_PICKUP,
    DRIVER_TO_PICKUP_RENDERED_CARD_FIELD_IDS,
    { testIDs: DRIVER_TO_PICKUP_FIELD_TEST_ID_OVERRIDES },
  ),
  arrived: defineRideCardRenderedFields(
    RIDE_CARD_ROLES.DRIVER,
    RIDE_CARD_STATES.DRIVER_AT_PICKUP,
    DRIVER_AT_PICKUP_RENDERED_CARD_FIELD_IDS,
    { testIDs: DRIVER_AT_PICKUP_FIELD_TEST_ID_OVERRIDES },
  ),
  started: defineRideCardRenderedFields(
    RIDE_CARD_ROLES.DRIVER,
    RIDE_CARD_STATES.DRIVER_IN_TRIP,
    DRIVER_IN_TRIP_RENDERED_CARD_FIELD_IDS,
    { testIDs: DRIVER_IN_TRIP_FIELD_TEST_ID_OVERRIDES },
  ),
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

function normalizeDriverStatusError(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function isActivationOrVehicleStatusError(message) {
  const normalized = normalizeDriverStatusError(message);
  if (!normalized) {
    return false;
  }

  return (
    normalized.includes("ativar seu status") ||
    normalized.includes("veiculo valido") ||
    normalized.includes("veiculo ativo") ||
    normalized.includes("vehicle_required") ||
    normalized.includes("driver_not_eligible") ||
    normalized.includes("ativacao do motorista pendente") ||
    normalized.includes("verificacao facial") ||
    normalized.includes("liveness") ||
    normalized.includes("kyc") ||
    normalized.includes("ficar online")
  );
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

function pickDriverTripMoney(...values) {
  const finiteValues = values
    .filter((value) => value !== null && value !== undefined && String(value).trim() !== "")
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));

  return finiteValues.find((value) => value > 0) ?? finiteValues[0] ?? null;
}

function roundDriverTripMoney(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }

  return Number(numeric.toFixed(2));
}

function resolveDriverTripFeeAmount(source = {}) {
  const totalFees = pickDriverTripMoney(
    source?.estimatedTotalFees,
    source?.totalFees,
    source?.retainedFeesInReais,
    source?.fareBreakdown?.estimatedTotalFees,
    source?.fareBreakdown?.totalFees,
    source?.paymentBreakdown?.estimatedTotalFees,
    source?.paymentBreakdown?.totalFees,
    source?.paymentDistribution?.retainedFeesInReais,
  );
  if (totalFees !== null) {
    return totalFees;
  }

  const operationalFee = pickDriverTripMoney(
    source?.estimatedOperationalFee,
    source?.operationalFee,
    source?.fareBreakdown?.estimatedOperationalFee,
    source?.fareBreakdown?.operationalFee,
    source?.paymentBreakdown?.estimatedOperationalFee,
    source?.paymentBreakdown?.operationalFee,
  );
  const paymentIntermediationFee = pickDriverTripMoney(
    source?.estimatedPaymentIntermediationFee,
    source?.paymentIntermediationFee,
    source?.fareBreakdown?.estimatedPaymentIntermediationFee,
    source?.fareBreakdown?.paymentIntermediationFee,
    source?.paymentBreakdown?.estimatedPaymentIntermediationFee,
    source?.paymentBreakdown?.paymentIntermediationFee,
  );

  if (operationalFee !== null || paymentIntermediationFee !== null) {
    return Number(operationalFee || 0) + Number(paymentIntermediationFee || 0);
  }

  return null;
}

function resolveDriverTripGrossAmount(request, driverTripMeta, selectedFare) {
  return pickDriverTripMoney(
    request?.grossFare,
    request?.grossAmount,
    request?.totalAmount,
    request?.finalFare,
    request?.fare,
    request?.amount,
    driverTripMeta?.grossFare,
    driverTripMeta?.grossAmount,
    selectedFare,
  );
}

function resolveDisplayPayoutAmount(request, driverTripMeta, selectedFare) {
  const explicitNetAmount = pickDriverTripMoney(
    request?.estimatedDriverNetAmount,
    request?.driverNetAmount,
    request?.driverNetAmountLocked,
    request?.lockedDriverNetAmount,
    request?.netAmount,
    request?.netAmountInReais,
    request?.driver_share,
    request?.fareBreakdown?.estimatedDriverNetAmount,
    request?.fareBreakdown?.driverNetAmount,
    request?.paymentBreakdown?.estimatedDriverNetAmount,
    request?.paymentBreakdown?.driverNetAmount,
    request?.paymentDistribution?.netAmountInReais,
    driverTripMeta?.estimatedDriverNetAmount,
    driverTripMeta?.driverNetAmount,
    driverTripMeta?.netAmount,
  );
  if (explicitNetAmount !== null) {
    return {
      value: explicitNetAmount,
      label: "líquido",
    };
  }

  const grossAmount = resolveDriverTripGrossAmount(
    request,
    driverTripMeta,
    selectedFare,
  );
  const feeAmount =
    resolveDriverTripFeeAmount(request) ??
    resolveDriverTripFeeAmount(driverTripMeta);
  if (grossAmount !== null && feeAmount !== null) {
    return {
      value: roundDriverTripMoney(Math.max(0, grossAmount - feeAmount)),
      label: "líquido",
    };
  }

  if (grossAmount !== null) {
    return {
      value: grossAmount,
      label: "bruto",
    };
  }

  return {
    value: null,
    label: "valor",
  };
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
  const shouldShowLabel = isPrimary;
  return (
    <LeafAnimatedPressable
      activeScale={0.978}
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
        !shouldShowLabel && styles.iconOnlyActionButton,
      ]}
    >
      <Ionicons
        name={icon}
        size={leafButtonMetrics.iconSize}
        color={isPrimary ? "#FFFFFF" : isDanger ? leafRideColors.dangerText : leafRideColors.leaf}
      />
      {shouldShowLabel ? (
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
      ) : null}
    </LeafAnimatedPressable>
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
    rideLocalSync,
    lastError,
  } = usePrototypeRideRuntime();
  const insets = useSafeAreaInsets();
  const [cardHeight, setCardHeight] = useState(FALLBACK_CARD_HEIGHT);
  const [busyAction, setBusyAction] = useState(false);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
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
  const isActiveTripSurface =
    hasActiveRide &&
    ["accepted", "arrived", "started"].includes(normalizedBookingStatus);
  const isCompactTripSurface = isActiveTripSurface && !detailsExpanded;
  const rideLocalSyncIndicator = useMemo(() => {
    const syncStatus = String(rideLocalSync?.status || "").toLowerCase();
    if (
      !PROTECTED_DRIVER_TRIP_STATUSES.has(normalizedBookingStatus) ||
      !["offline", "pending", "syncing", "error"].includes(syncStatus)
    ) {
      return null;
    }

    if (syncStatus === "offline") {
      return {
        tone: "danger",
        icon: "cloud-offline-outline",
        title: "Sem conexão",
        message:
          rideLocalSync?.message ||
          "Mantendo o último estado confirmado da corrida.",
      };
    }

    if (syncStatus === "syncing") {
      return {
        tone: "warning",
        icon: "sync-outline",
        title: "Sincronizando corrida",
        message:
          rideLocalSync?.message ||
          "Validando o estado da corrida com o servidor.",
      };
    }

    return {
      tone: syncStatus === "error" ? "danger" : "warning",
      icon: "sync-outline",
      title: "Atualização pendente",
      message:
        rideLocalSync?.message ||
        "Aguardando confirmação do servidor para mudar o estado da corrida.",
    };
  }, [normalizedBookingStatus, rideLocalSync]);
  const visibleLastError =
    isActiveTripSurface && isActivationOrVehicleStatusError(lastError)
      ? ""
      : lastError;
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
  const tripFareDisplay = resolveDisplayPayoutAmount(
    request,
    driverTripMeta,
    selectedFare,
  );
  const tripFareLabel = Number.isFinite(tripFareDisplay.value)
    ? formatCurrency(tripFareDisplay.value)
    : "--";
  const tripFareCaption = tripFareDisplay.label;
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
  const driverCardFieldTestIDs = normalizedBookingStatus === "started"
    ? DRIVER_TRIP_FIELD_TEST_IDS.started
    : normalizedBookingStatus === "arrived"
      ? DRIVER_TRIP_FIELD_TEST_IDS.arrived
      : DRIVER_TRIP_FIELD_TEST_IDS.accepted;
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
  const driverSheetTitle = !hasActiveRide
    ? "Sem corrida ativa"
    : normalizedBookingStatus === "started"
      ? "Progresso da viagem"
      : normalizedBookingStatus === "arrived"
        ? "Confirmar embarque"
        : normalizedBookingStatus === "accepted"
          ? "Ponto de embarque"
          : "Detalhes da corrida";
  const driverIslandSubtitle = normalizedBookingStatus === "started"
    ? `${distanceLabel} restantes`
    : normalizedBookingStatus === "arrived"
      ? pickupLabel
      : headerCopy.subtitle;
  const driverIslandRightLabel = normalizedBookingStatus === "started"
    ? "Em rota"
    : normalizedBookingStatus === "arrived"
      ? boardingCountdownLabel || "Embarque"
      : headerCopy.right;
  const compactTripTitle = normalizedBookingStatus === "started"
    ? `A caminho de ${dropoffTitle}`
    : normalizedBookingStatus === "arrived"
      ? "Confirmar embarque"
      : normalizedBookingStatus === "accepted"
        ? "Indo buscar"
        : driverSheetTitle;
  const compactTripMetaLabel = normalizedBookingStatus === "started"
    ? "restante"
    : normalizedBookingStatus === "arrived"
      ? "embarque"
      : "até o embarque";
  const compactTripEtaLabel = normalizedBookingStatus === "arrived"
    ? boardingCountdownLabel || "--"
    : etaLabel;
  const compactTripEtaCaption = normalizedBookingStatus === "arrived"
    ? "tempo grátis"
    : normalizedBookingStatus === "started"
      ? "ETA final"
      : "até chegar";

  useEffect(() => {
    if (bookingStatus === "completed") {
      navigation.navigate("RobotaxiPrototypeReceipt", { fromTrip: true });
    }
  }, [bookingStatus, navigation]);

  useEffect(() => {
    setDetailsExpanded(false);
  }, [request?.bookingId, request?.id, normalizedBookingStatus]);

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
            {driverSheetTitle}
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
        {tripFareCaption}
      </Text>
    </View>
  );

  const renderCompactMetric = (value, label, valueStyle = null, testID = undefined) => (
    <View style={styles.compactMetric}>
      <Text
        style={[styles.compactMetricValue, valueStyle]}
        numberOfLines={1}
        testID={testID}
      >
        {value}
      </Text>
      <Text style={styles.compactMetricLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );

  const renderCompactTripDetails = () => {
    if (!detailsExpanded) {
      return null;
    }

    if (normalizedBookingStatus === "started") {
      return (
        <>
          <LeafDivider style={styles.compactDetailsDivider} />
          <LeafRouteProgress
            originLabel={pickupLabel}
            destinationLabel={dropoffTitle}
            progress={routeProgress}
            progressKey={liveRouteKey || "driver-trip-route"}
            arrivalLabel={null}
            style={styles.driverRouteProgress}
            testID="driver-trip-route-progress"
            fieldTestIDs={{
              progress: driverCardFieldTestIDs.route_progress,
            }}
          />
          <Text
            style={styles.driverRouteSummaryText}
            numberOfLines={1}
          >
            {driverStartedSummary}
          </Text>
        </>
      );
    }

    if (normalizedBookingStatus === "accepted") {
      return (
        <>
          <LeafDivider style={styles.compactDetailsDivider} />
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
        </>
      );
    }

    return null;
  };

  const renderCompactDriverCard = () => {
    const passengerMeta = normalizedBookingStatus === "started"
      ? "A bordo"
      : normalizedBookingStatus === "arrived"
        ? "No ponto de encontro"
        : `${etaLabel} · ${distanceLabel} até o embarque`;
    const shouldShowPickupLine =
      normalizedBookingStatus === "accepted" || normalizedBookingStatus === "arrived";
    const secondaryActions = normalizedBookingStatus === "started"
      ? (
        <>
          <IconActionButton
            icon="navigate-outline"
            label="Navegar"
            onPress={handleOpenNavigation}
            style={styles.compactSecondaryButton}
            testID="driver-trip-navigation-button"
          />
          <IconActionButton
            icon="warning-outline"
            label="Reportar"
            tone="danger"
            onPress={() => navigation.navigate("RobotaxiPrototypeSupport")}
            style={styles.compactSecondaryButton}
            testID="driver-trip-report-button"
          />
          <LeafButton
            label={primaryLabel}
            tone="primary"
            disabled={busyAction}
            onPress={handlePrimaryAction}
            style={styles.compactPrimaryButton}
            testID={primaryActionTestID}
            accessibilityLabel={primaryActionTestID}
          />
        </>
      )
      : normalizedBookingStatus === "arrived"
        ? (
          <>
            <IconActionButton
              icon="chatbubble-outline"
              label="Chat"
              onPress={() => navigation.navigate("RobotaxiPrototypeChat")}
              style={styles.compactSecondaryButton}
              testID="driver-trip-chat-button"
            />
            <IconActionButton
              icon="person-remove-outline"
              label="No-show"
              tone="danger"
              onPress={handleNoShow}
              style={styles.compactSecondaryButton}
              testID="driver-trip-no-show-button"
            />
            <LeafButton
              label={primaryLabel}
              tone="primary"
              disabled={busyAction}
              onPress={handlePrimaryAction}
              style={styles.compactPrimaryButton}
              testID={primaryActionTestID}
              accessibilityLabel={primaryActionTestID}
            />
          </>
        )
        : (
          <>
            <IconActionButton
              icon="navigate-outline"
              label="Navegar"
              onPress={handleOpenNavigation}
              style={styles.compactSecondaryButton}
              testID="driver-trip-navigation-button"
            />
            <IconActionButton
              icon="chatbubble-outline"
              label="Chat"
              onPress={() => navigation.navigate("RobotaxiPrototypeChat")}
              style={styles.compactSecondaryButton}
              testID="driver-trip-chat-button"
            />
            <IconActionButton
              icon="close-circle-outline"
              label="Cancelar"
              tone="danger"
              onPress={() => navigation.navigate("RobotaxiPrototypeCancellation", { source: "driver-trip" })}
              style={styles.compactSecondaryButton}
              testID="driver-trip-cancel-button"
            />
            <LeafButton
              label={primaryLabel}
              tone="primary"
              disabled={busyAction}
              onPress={handlePrimaryAction}
              style={styles.compactPrimaryButton}
              testID={primaryActionTestID}
              accessibilityLabel={primaryActionTestID}
            />
          </>
        );

    return (
      <>
        <View style={styles.sheetHandle} />
        <View style={styles.compactHeaderRow}>
          <View style={styles.compactHeaderCopy}>
            <Text
              style={styles.compactTitle}
              numberOfLines={1}
              testID={
                normalizedBookingStatus === "started"
                  ? driverCardFieldTestIDs.destination_address
                  : undefined
              }
            >
              {compactTripTitle}
            </Text>
            {shouldShowPickupLine ? (
              <Text
                style={styles.compactSubtitle}
                numberOfLines={1}
                testID={driverCardFieldTestIDs.pickup_address}
              >
                {pickupLabel}
              </Text>
            ) : (
              <Text style={styles.compactSubtitle} numberOfLines={1}>
                {driverArrivalSummary}
              </Text>
            )}
          </View>
          <LeafAnimatedPressable
            activeScale={0.96}
            accessibilityRole="button"
            accessibilityLabel={detailsExpanded ? "Ocultar detalhes" : "Ver detalhes"}
            onPress={() => setDetailsExpanded(value => !value)}
            style={styles.compactDetailsButton}
          >
            <Text style={styles.compactDetailsLabel} numberOfLines={1}>
              {detailsExpanded ? "Menos" : "Detalhes"}
            </Text>
            <Ionicons
              name={detailsExpanded ? "chevron-down" : "chevron-up"}
              size={14}
              color={leafRideColors.text}
            />
          </LeafAnimatedPressable>
        </View>

        <LeafPersonIdentity
          initial={passengerInitial}
          photoUri={passengerPhotoUri}
          name={passengerLabel}
          meta={passengerMeta}
          compact
          style={styles.compactPassengerIdentity}
          testID="driver-trip-passenger-identity"
          fieldTestIDs={{
            avatar: driverCardFieldTestIDs.passenger_photo,
            name: driverCardFieldTestIDs.passenger_name,
          }}
        />

        {normalizedBookingStatus === "arrived" ? (
          <View style={styles.compactPinRow}>
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
            <Text
              style={styles.pinValue}
              numberOfLines={1}
              testID={driverCardFieldTestIDs.boarding_pin}
            >
              {boardingPin}
            </Text>
          </View>
        ) : null}

        <View style={styles.compactMetricRow}>
          {renderCompactMetric(
            compactTripEtaLabel,
            compactTripEtaCaption,
            null,
            normalizedBookingStatus === "started"
              ? driverCardFieldTestIDs.eta_final
              : normalizedBookingStatus === "arrived"
                ? driverCardFieldTestIDs.boarding_timer
                : driverCardFieldTestIDs.pickup_eta,
          )}
          {normalizedBookingStatus !== "arrived"
            ? renderCompactMetric(
                distanceLabel,
                compactTripMetaLabel,
                null,
                normalizedBookingStatus === "started"
                  ? driverCardFieldTestIDs.distance_remaining
                  : undefined,
              )
            : null}
          {renderCompactMetric(
            tripFareLabel,
            tripFareCaption,
            styles.compactMetricValueLeaf,
            normalizedBookingStatus === "started"
              ? driverCardFieldTestIDs.net_payout
              : undefined,
          )}
        </View>

        {normalizedBookingStatus === "accepted" ? (
          <Text style={styles.compactPreferenceText} numberOfLines={1}>
            {ridePreferenceSummary}
          </Text>
        ) : null}

        {renderCompactTripDetails()}

        <View style={styles.compactActionsRow}>
          {secondaryActions}
        </View>
      </>
    );
  };

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

    if (isActiveTripSurface) {
      return renderCompactDriverCard();
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
        <PrototypeConnectionStatusPill
          topOffset={insets.top + 18}
          visible={Boolean(rideLocalSyncIndicator)}
          tone={rideLocalSyncIndicator?.tone}
          icon={rideLocalSyncIndicator?.icon}
          title={rideLocalSyncIndicator?.title}
          message={rideLocalSyncIndicator?.message}
          testID="driver-trip-local-sync-pill"
        />
        {!isActiveTripSurface ? (
          <LeafStateHeader
            title={headerCopy.title}
            subtitle={driverIslandSubtitle}
            rightLabel={driverIslandRightLabel}
            rightTone={normalizedBookingStatus === "started" ? "dark" : headerCopy.rightTone}
            insetsTop={insets.top}
          />
        ) : null}

        <PrototypeDismissibleSheet
          onClose={handleDismiss}
          sheetStyle={[styles.sheetWrap, { bottom: sheetBottom }]}
        >
          <LeafRideSheet
            onLayout={handleCardLayout}
            style={[
              styles.tripCard,
              isCompactTripSurface && styles.compactTripCard,
              { paddingBottom: 12 + safeBottom },
            ]}
            testID="driver-live-trip-screen"
            accessibilityLabel="driver-live-trip-screen"
          >
            {renderDriverCard()}

            {visibleLastError ? (
              <Text style={styles.errorText}>{visibleLastError}</Text>
            ) : null}
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
    backgroundColor: "#FFFFFF",
    minHeight: 332,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    paddingTop: 14,
  },
  compactTripCard: {
    minHeight: 218,
    paddingTop: 12,
  },
  sheetHandle: {
    width: 50,
    height: 4,
    borderRadius: 3,
    backgroundColor: "#D8D0C7",
    alignSelf: "center",
    marginBottom: 18,
  },
  compactHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  compactHeaderCopy: {
    flex: 1,
    minWidth: 0,
  },
  compactTitle: {
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 21,
    lineHeight: 26,
  },
  compactSubtitle: {
    marginTop: 3,
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 13,
    lineHeight: 17,
  },
  compactDetailsButton: {
    minHeight: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: leafRideColors.line,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  compactDetailsLabel: {
    color: leafRideColors.text,
    fontFamily: fonts.Medium,
    fontSize: 11,
    lineHeight: 14,
  },
  compactPassengerIdentity: {
    marginTop: 14,
  },
  compactPinRow: {
    marginTop: 12,
    minHeight: 50,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(17,22,17,0.08)",
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 14,
  },
  compactMetricRow: {
    marginTop: 14,
    flexDirection: "row",
    alignItems: "stretch",
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: leafRideColors.line,
    paddingVertical: 10,
  },
  compactMetric: {
    flex: 1,
    minWidth: 0,
  },
  compactMetricValue: {
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 15,
    lineHeight: 20,
  },
  compactMetricValueLeaf: {
    color: leafRideColors.leaf,
  },
  compactMetricLabel: {
    marginTop: 1,
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 10.5,
    lineHeight: 14,
  },
  compactPreferenceText: {
    marginTop: 8,
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 12,
    lineHeight: 16,
  },
  compactDetailsDivider: {
    marginTop: 12,
    marginBottom: 12,
  },
  compactActionsRow: {
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  compactSecondaryButton: {
    flex: 0.72,
    minWidth: 74,
  },
  compactPrimaryButton: {
    flex: 1.22,
    minWidth: 112,
    minHeight: leafButtonMetrics.height,
    borderRadius: leafButtonMetrics.radius,
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
    fontSize: 20,
    lineHeight: 25,
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
    fontSize: 20,
    lineHeight: 25,
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
    flex: 0,
    width: leafButtonMetrics.height,
    minWidth: leafButtonMetrics.height,
    maxWidth: leafButtonMetrics.height,
  },
  primaryActionRow: {
    marginTop: 10,
  },
  iconActionButton: {
    minWidth: leafButtonMetrics.height,
    minHeight: leafButtonMetrics.height,
    borderRadius: leafButtonMetrics.radius,
    borderWidth: 1,
    borderColor: leafRideColors.line,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: leafButtonMetrics.iconGap,
    paddingHorizontal: 12,
  },
  iconOnlyActionButton: {
    flex: 0,
    width: leafButtonMetrics.height,
    minWidth: leafButtonMetrics.height,
    maxWidth: leafButtonMetrics.height,
    gap: 0,
    paddingHorizontal: 0,
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
    minHeight: leafButtonMetrics.height,
    borderRadius: leafButtonMetrics.radius,
  },
  emptyBackButton: {
    alignSelf: "flex-start",
  },
  emptyTitle: {
    marginTop: 18,
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 20,
    lineHeight: 25,
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
