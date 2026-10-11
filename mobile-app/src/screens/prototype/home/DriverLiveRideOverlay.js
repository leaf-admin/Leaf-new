import leafTypography from '../../../components/prototype/LeafTypography';
import LeafSlideToConfirm from "../../../components/design-system/LeafSlideToConfirm";
import { confirmDriverEarlyEnd } from "./driverEarlyEndConfirm";
import useRideCardTransition from "../../../components/design-system/useRideCardTransition";
import useRideStepHaptics from "../../../hooks/useRideStepHaptics";
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { Ionicons } from "@expo/vector-icons";
import robotaxiPrototypeTokens from "../../../components/design-system/robotaxiPrototypeTokens";
import {
  PrototypeCard,
  PrototypePrimaryButton,
} from "../../../components/prototype/PrototypeUI";
import {
  LeafPersonIdentity,
  LeafJourneyRoute,
  LeafStateHeader,
  leafButtonMetrics,
} from "../../../components/prototype/LeafRideUI";
import {
  RobotaxiLifecycleButton,
  RobotaxiLifecycleDisclosure,
  RobotaxiLifecycleIdentity,
  RobotaxiLifecycleMetric,
  RobotaxiLifecycleSection,
  RobotaxiLifecycleSummary,
  robotaxiLifecycleMetrics,
  compact as compactSize,
} from "../../../components/prototype/RobotaxiLifecycleUI";
import SecurePaymentBadge from "../../../components/payment/SecurePaymentBadge";
import {
  getDriverOfferPayoutLabel,
  selectDisplayableDriverOffer,
} from "../driverOfferPricingSnapshot";
import { useDriverOfferCountdown } from "../driverOfferCountdown";
import { shortTripAddressLabel } from "../tripAddressPresentation";
import { normalizeRuntimeRideStatus } from "../rideLifecycleContract";
import { useHapticFeedback } from "../../../hooks/useHapticFeedback";

const { color } = robotaxiPrototypeTokens;

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function formatCurrency(value) {
  return `R$ ${toNumber(value, 0).toFixed(2).replace(".", ",")}`;
}

function isPlaceholderMetric(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return !normalized || normalized === "em calculo";
}

function formatDistanceMeters(value, fallback = "--") {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return fallback;
  }

  if (numeric < 1000) {
    const roundedMeters =
      numeric <= 0 ? 0 : Math.max(10, Math.round(numeric / 10) * 10);
    return `${roundedMeters} m`;
  }

  return `${Math.max(1, Math.round(numeric / 1000))} km`;
}

function formatDurationMinutes(value, fallback = "--") {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallback;
  }
  return `${Math.max(1, Math.round(numeric))} min`;
}

function resolveFirstUsableLabel(...values) {
  return values.find((value) => !isPlaceholderMetric(value)) || "";
}

function resolveDisplayNetAmount(activeRide, driverTripMeta) {
  const preferredPositiveAmount =
    [
      activeRide?.driverNetAmountLocked,
      activeRide?.lockedDriverNetAmount,
      activeRide?.estimatedDriverNetAmount,
      activeRide?.driverNetAmount,
      activeRide?.netAmount,
      activeRide?.paymentBreakdown?.driverNetAmount,
      activeRide?.paymentDistribution?.netAmountInReais,
      driverTripMeta?.driverNetAmount,
      driverTripMeta?.estimatedDriverNetAmount,
      driverTripMeta?.lockedDriverNetAmount,
    ].find((value) => Number.isFinite(Number(value)) && Number(value) > 0) ?? null;

  if (preferredPositiveAmount !== null) {
    return Number(preferredPositiveAmount);
  }

  const firstKnownAmount =
    [
      activeRide?.driverNetAmountLocked,
      activeRide?.lockedDriverNetAmount,
      activeRide?.estimatedDriverNetAmount,
      activeRide?.driverNetAmount,
      activeRide?.netAmount,
      activeRide?.paymentBreakdown?.driverNetAmount,
      activeRide?.paymentDistribution?.netAmountInReais,
      driverTripMeta?.driverNetAmount,
      driverTripMeta?.estimatedDriverNetAmount,
      driverTripMeta?.lockedDriverNetAmount,
    ].find((value) => Number.isFinite(Number(value))) ?? null;

  return firstKnownAmount === null ? null : Number(firstKnownAmount);
}

function resolveOperationalLegNetAmount(operationalContinuation) {
  const rideLegs = Array.isArray(operationalContinuation?.rideLegs)
    ? operationalContinuation.rideLegs
    : operationalContinuation?.closedRideLeg
      ? [operationalContinuation.closedRideLeg]
      : [];
  const lastLeg = rideLegs[rideLegs.length - 1];

  if (!lastLeg || typeof lastLeg !== "object") {
    return null;
  }

  const authoritativeAmount = [
    lastLeg.driverNetAmount,
    lastLeg.settlement?.driverNetAmount,
    lastLeg.financialSettlement?.driverNetAmount,
  ].find((value) => Number.isFinite(Number(value)));

  return authoritativeAmount === undefined
    ? null
    : Number(authoritativeAmount);
}

function formatDistanceKm(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "--";
  }
  return formatDistanceMeters(numeric * 1000);
}

function pickPositiveNumber(...values) {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric;
    }
  }
  return null;
}

function formatPaymentMethod(method, compact = false) {
  const normalized = String(method || "")
    .trim()
    .toLowerCase();
  if (normalized === "pix") {
    return compact ? "PIX" : "PIX confirmado";
  }
  return compact ? "PIX" : "PIX confirmado";
}

function splitLocationLabel(label = "") {
  const clean = String(label || "").trim();
  if (!clean) {
    return {
      title: "Endereço indisponível",
      subtitle: "",
    };
  }

  const separator = clean.indexOf(",");
  if (separator > 0 && separator < clean.length - 1) {
    return {
      title: clean.slice(0, separator).trim(),
      subtitle: clean.slice(separator + 1).trim(),
    };
  }

  return {
    title: clean,
    subtitle: "",
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
    temperatureLabel
      ? {
          key: "temperature",
          icon: "snow-outline",
          label: temperatureLabel,
        }
      : null,
    soundLabel
      ? {
          key: "sound",
          icon: "volume-low-outline",
          label: soundLabel,
        }
      : null,
  ].filter(Boolean);
}

// Booking plus the moment this particular offer was issued or expires.
export function resolveOfferInstanceKey(offer) {
  const bookingId = offer?.bookingId || offer?.id || "";
  if (!bookingId) {
    return "";
  }
  const issued = offer?.expiresAt || offer?.responseDeadlineAt || offer?.timestamp || offer?.receivedAt || "";
  return `${bookingId}|${issued}`;
}

function resolveOffer(driverOffers = []) {
  return selectDisplayableDriverOffer(driverOffers);
}

function resolveTripPhase(activeRide, bookingStatus) {
  const normalizedStatus = resolveDriverOverlayStatus(activeRide, bookingStatus);

  if (normalizedStatus === "accepted") {
    return {
      chip: "Embarque",
      title: "A caminho do passageiro",
      subtitle: "Permaneça no mapa e confirme quando chegar ao embarque.",
      primaryLabel: "Cheguei ao embarque",
    };
  }

  if (normalizedStatus === "arrived") {
    return {
      chip: "No ponto",
      title: "Passageiro embarcando",
      subtitle: "Valide o código do passageiro e inicie a corrida por aqui.",
      primaryLabel: "Iniciar viagem",
    };
  }

  if (normalizedStatus === "started") {
    return {
      chip: "Em rota",
      title: "Viagem em andamento",
      subtitle: "Siga até o destino e finalize a corrida sem sair do mapa.",
      primaryLabel: "Finalizar corrida",
    };
  }

  if (normalizedStatus === "operational_interrupted") {
    return {
      chip: "Interrompida",
      title: "Passageiro decidindo",
      subtitle:
        "Mantivemos a corrida pausada enquanto o passageiro decide se quer continuar com outro parceiro.",
      primaryLabel: "",
    };
  }

  if (normalizedStatus === "searching_replacement") {
    return {
      chip: "Transferida",
      title: "Continuidade em busca",
      subtitle:
        "O passageiro optou por continuar com outro parceiro. Você já foi liberado desta corrida.",
      primaryLabel: "",
    };
  }

  return {
    chip: "Status",
    title: "Corrida em sincronização",
    subtitle: "Estamos atualizando o estado atual da viagem.",
    primaryLabel: "",
  };
}

function resolveTripPrimaryActionTestID(status) {
  const normalizedStatus = normalizeRuntimeRideStatus(status);

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

function isCompactTripStatus(status) {
  const normalizedStatus = normalizeRuntimeRideStatus(status);

  return (
    normalizedStatus === "accepted" ||
    normalizedStatus === "arrived" ||
    normalizedStatus === "started"
  );
}

// Tactile cue per driver step: a strong tap for a new offer, success on the
// match, a firm tap on arriving and on starting the trip.
const DRIVER_STEP_HAPTICS = {
  offer: "heavy",
  accepted: "success",
  arrived: "medium",
  started: "medium",
};

function resolveDriverOverlayStatus(activeRide, bookingStatus) {
  const normalizedBookingStatus = normalizeRuntimeRideStatus(bookingStatus);
  const normalizedRideStatus = normalizeRuntimeRideStatus(activeRide?.status);

  if (normalizedBookingStatus && normalizedBookingStatus !== "idle") {
    return normalizedBookingStatus;
  }

  return normalizedRideStatus || normalizedBookingStatus;
}

function isCompetitiveAcceptLossMessage(message) {
  return String(message || "")
    .trim()
    .toLowerCase()
    .includes("outro motorista aceitou");
}

const DRIVER_OFFER_EXPIRED_GRACE_MS = 1500;
const DRIVER_OFFER_DEFAULT_TIMEOUT_SECONDS = 20;
// Pinned Recusar/Aceitar row: 12 margin + button height.
const DRIVER_OFFER_ACTIONS_HEIGHT = 84;
// Pinned trip actions: "Mais opções" + primary step button.
const DRIVER_TRIP_ACTIONS_HEIGHT = 140;

function isExpiredAcceptMessage(message) {
  return String(message || "")
    .trim()
    .toLowerCase()
    .includes("oferta expirada");
}

function DriverLiveRideOverlay({
  insetsTop = 0,
  insetsBottom = 0,
  bottomOffset = 0,
  onCardLayout,
  driverOffers = [],
  driverActiveRide = null,
  driverTripMeta = null,
  bookingStatus = "",
  tripDistanceKm = null,
  paymentMethod = "pix",
  driverExtensionRequest = null,
  driverTripAssist = null,
  operationalContinuation = null,
  acceptDriverOffer,
  rejectDriverOffer,
  expireDriverOffer,
  respondToDriverExtension,
  interruptRideOperationalFlow,
  cancelActiveRideFlow,
  markDriverArrived,
  startTripFlow,
  completeTripFlow,
  onOpenNavigation,
  onOpenChat,
  onTripCompletedSuccess,
  nativeNavigationVisible = false,
}) {
  const [busyAction, setBusyAction] = useState("");
  const triggerHaptic = useHapticFeedback();
  const [isTripExpanded, setIsTripExpanded] = useState(false);
  // Third height: only the status line and the main action, map gets the rest.
  const [isTripPeek, setIsTripPeek] = useState(false);
  const [isOfferExpanded, setIsOfferExpanded] = useState(false);
  const [dismissedOfferIdentity, setDismissedOfferIdentity] = useState("");
  const [showCancelPrompt, setShowCancelPrompt] = useState(false);
  const { height: windowHeight } = useWindowDimensions();
  const safeBottom = Math.max(0, Number(insetsBottom) || 0);
  const activeRide = useMemo(() => {
    if (driverActiveRide?.bookingId || driverActiveRide?.id) {
      return driverActiveRide;
    }
    return null;
  }, [driverActiveRide]);
  const candidateOffer = useMemo(() => resolveOffer(driverOffers), [driverOffers]);
  const candidateOfferIdentity =
    candidateOffer?.bookingId || candidateOffer?.id || "";
  // A dismissal belongs to one offer, not to the booking. The server offers
  // the same ride again after a cooldown; keyed by booking alone, a re-offer
  // stayed hidden forever (route on the map, no card to accept).
  const candidateOfferInstance = resolveOfferInstanceKey(candidateOffer);
  const offer =
    candidateOfferInstance && candidateOfferInstance === dismissedOfferIdentity
      ? null
      : candidateOffer;
  const hasActiveRide = Boolean(activeRide);
  const hasOffer = Boolean(!hasActiveRide && (offer?.bookingId || offer?.id));
  const offerCountdown = useDriverOfferCountdown(hasOffer ? offer : null);
  const offerExpired = Boolean(hasOffer && offerCountdown.expired);
  const offerTotalSeconds = Math.max(
    1,
    Number(offer?.expiresInSec || offer?.timeout || offer?.responseTimeoutSeconds || 0) ||
      DRIVER_OFFER_DEFAULT_TIMEOUT_SECONDS,
  );
  const offerTimeRatio = offerExpired
    ? 0
    : Math.min(1, Math.max(0, Number(offerCountdown.remainingSeconds || 0) / offerTotalSeconds));
  const offerIdentity = resolveOfferInstanceKey(offer);

  useEffect(() => {
    setIsOfferExpanded(false);
    setDismissedOfferIdentity((previousIdentity) =>
      candidateOfferInstance && candidateOfferInstance !== previousIdentity
        ? ""
        : previousIdentity,
    );
  }, [candidateOfferInstance]);

  // The server clears timed-out offers, but if that event is lost the sheet
  // would keep showing a dead offer. Drop it locally after a short grace.
  useEffect(() => {
    if (!offerExpired || !offerIdentity || busyAction) {
      return undefined;
    }
    const timer = setTimeout(() => {
      setDismissedOfferIdentity(offerIdentity);
      expireDriverOffer?.(offer);
    }, DRIVER_OFFER_EXPIRED_GRACE_MS);
    return () => clearTimeout(timer);
  }, [busyAction, expireDriverOffer, offer, offerExpired, offerIdentity]);
  const tripPhase = useMemo(
    () => resolveTripPhase(activeRide, bookingStatus),
    [activeRide, bookingStatus],
  );

  const handleAcceptOffer = useCallback(async () => {
    if (!offer || busyAction || offerExpired) {
      return;
    }

    try {
      setBusyAction("accept");
      await acceptDriverOffer(offer);
    } catch (error) {
      // The runtime already shows a card for lost or expired offers.
      if (
        isCompetitiveAcceptLossMessage(error?.message || error) ||
        isExpiredAcceptMessage(error?.message || error)
      ) {
        return;
      }
      Alert.alert(
        "Não foi possível aceitar",
        error?.message || "Falha ao aceitar corrida.",
      );
    } finally {
      setBusyAction("");
    }
  }, [acceptDriverOffer, busyAction, offer, offerExpired]);

  const handleRejectOffer = useCallback(async () => {
    if (!offer || busyAction || offerExpired) {
      return;
    }

    try {
      setBusyAction("reject");
      setDismissedOfferIdentity(offerIdentity);
      await rejectDriverOffer(offer, "Recusada pelo motorista.");
    } catch (error) {
      setDismissedOfferIdentity((currentIdentity) =>
        currentIdentity === offerIdentity ? "" : currentIdentity,
      );
      Alert.alert(
        "Não foi possível recusar",
        error?.message || "Falha ao recusar corrida.",
      );
    } finally {
      setBusyAction("");
    }
  }, [busyAction, offer, offerExpired, offerIdentity, rejectDriverOffer]);

  const handleTripPrimaryAction = useCallback(async () => {
    if (!activeRide || busyAction) {
      return;
    }

    const normalizedStatus = resolveDriverOverlayStatus(activeRide, bookingStatus);

    try {
      setBusyAction("trip");

      if (normalizedStatus === "accepted") {
        await markDriverArrived();
        return;
      }

      if (normalizedStatus === "arrived") {
        await startTripFlow();
        return;
      }

      if (normalizedStatus === "started") {
        // Ending far from the destination is allowed, but it is a deliberate
        // act: the driver states why, and the passenger is asked about it.
        const earlyEnd = await confirmDriverEarlyEnd(driverTripAssist?.remainingMeters);
        if (earlyEnd?.cancelled) {
          return;
        }
        const result = await completeTripFlow(earlyEnd ? { earlyEnd } : {});
        if (result?.success !== false) {
          onTripCompletedSuccess?.(result);
        }
      }
    } catch (error) {
      Alert.alert(
        "Não foi possível atualizar",
        error?.message || "Falha ao atualizar a corrida.",
      );
    } finally {
      setBusyAction("");
    }
  }, [
    activeRide,
    bookingStatus,
    busyAction,
    completeTripFlow,
    driverTripAssist?.remainingMeters,
    markDriverArrived,
    onTripCompletedSuccess,
    startTripFlow,
  ]);

  const pickupLabel =
    shortTripAddressLabel(String(
      activeRide?.pickup ||
        activeRide?.pickupAddress ||
        offer?.pickup ||
        offer?.pickupAddress ||
        "",
    ).trim()) || "Origem indisponível";
  const dropoffLabel =
    shortTripAddressLabel(String(
      activeRide?.dropoff ||
        activeRide?.dropoffAddress ||
        offer?.dropoff ||
        offer?.dropoffAddress ||
        "",
    ).trim()) || "Destino indisponível";
  const normalizedActiveStatus = resolveDriverOverlayStatus(
    activeRide,
    bookingStatus,
  );
  const cardStepMotion = useRideCardTransition(
    hasOffer ? "offer" : hasActiveRide ? normalizedActiveStatus : null,
    isTripExpanded ? "expanded" : isTripPeek ? "peek" : "compact",
  );
  // Says what is happening instead of a generic "updating".
  const tripBusyLabel =
    normalizedActiveStatus === "accepted"
      ? "Confirmando chegada..."
      : normalizedActiveStatus === "arrived"
        ? "Iniciando corrida..."
        : normalizedActiveStatus === "started"
          ? "Encerrando..."
          : "Atualizando...";
  const isOperationalInterrupted =
    normalizedActiveStatus === "operational_interrupted";
  const isSearchingReplacement =
    normalizedActiveStatus === "searching_replacement";
  // A new offer is its own step, keyed by booking so each offer taps once.
  const driverStepKey = hasOffer ? `offer:${candidateOfferIdentity}` : normalizedActiveStatus;
  useRideStepHaptics(driverStepKey, {
    [driverStepKey]: DRIVER_STEP_HAPTICS[hasOffer ? "offer" : normalizedActiveStatus],
  });
  const activeRideNetAmount = isOperationalInterrupted
    ? resolveOperationalLegNetAmount(operationalContinuation)
    : resolveDisplayNetAmount(activeRide, driverTripMeta);
  const fareLabel = hasActiveRide
    ? Number.isFinite(activeRideNetAmount)
      ? formatCurrency(activeRideNetAmount)
      : "--"
    : getDriverOfferPayoutLabel(offer) || "--";
  const passengerFullName = String(
    offer?.passenger ||
      offer?.passengerName ||
      offer?.customerName ||
      offer?.customer?.name ||
      activeRide?.passenger ||
      activeRide?.passengerName ||
      activeRide?.customerName ||
      activeRide?.customer?.name ||
      "Passageiro Leaf",
  ).trim();
  // Ride apps address the passenger by first name only.
  const passengerLabel =
    passengerFullName === "Passageiro Leaf"
      ? passengerFullName
      : passengerFullName.split(/\s+/)[0] || passengerFullName;
  const passengerInitial = passengerLabel.trim().charAt(0).toUpperCase() || "P";
  const passengerPhotoUri =
    String(
      offer?.passengerPhoto ||
        offer?.passenger?.photo ||
        offer?.customerPhoto ||
        offer?.customer?.photo ||
        offer?.customer?.profileImage ||
        activeRide?.passengerPhoto ||
        activeRide?.passenger?.photo ||
        activeRide?.customerPhoto ||
        activeRide?.customer?.photo ||
        activeRide?.customer?.profileImage ||
        "",
    ).trim() || null;
  const etaLabel = String(offer?.eta || "").trim();
  const offerTripDistanceKm = pickPositiveNumber(
    offer?.distanceKm,
    offer?.tripDistanceKm,
    offer?.estimatedTripDistanceKm,
    offer?.routeDistanceKm,
    offer?.estimatedDistanceKm,
    tripDistanceKm,
  );
  const offerTripDurationMin = pickPositiveNumber(
    offer?.tripDurationMin,
    offer?.estimatedTripDurationMin,
    offer?.durationMin,
    offer?.durationMinutes,
  );
  const distanceLabel = formatDistanceKm(offerTripDistanceKm);
  const offerPickupEtaLabel =
    resolveFirstUsableLabel(
      formatDurationMinutes(
        offer?.pickupEtaMin || offer?.pickupDurationMin || offer?.etaMin,
        "",
      ),
      etaLabel,
    ) || "--";
  const offerTripDurationLabel = formatDurationMinutes(
    offerTripDurationMin,
    "--",
  );
  const activeDistanceLabel = formatDistanceKm(
    pickPositiveNumber(
      activeRide?.distanceKm,
      activeRide?.tripDistanceKm,
      activeRide?.estimatedTripDistanceKm,
      activeRide?.routeDistanceKm,
      tripDistanceKm,
    ),
  );
  const pickupLocation = splitLocationLabel(pickupLabel);
  const dropoffLocation = splitLocationLabel(dropoffLabel);
  const paymentLabel = formatPaymentMethod(paymentMethod);
  const isPixPayment =
    String(paymentMethod || "").trim().toLowerCase() === "pix";
  const ridePreferenceItems = resolveRidePreferenceItems(hasOffer ? offer : activeRide);
  const isContinuationOffer = Boolean(offer?.isOperationalContinuation);
  const maxCardHeight = Math.max(
    352,
    windowHeight - insetsTop - bottomOffset - 84,
  );
  const offerCardMaxHeight = Math.max(
    352,
    Math.min(maxCardHeight, Math.round(windowHeight * 0.66)),
  );
  const normalizedExtensionStatus = String(driverExtensionRequest?.status || "")
    .trim()
    .toLowerCase();
  const liveDistanceLabel = resolveFirstUsableLabel(
    formatDistanceMeters(driverTripAssist?.remainingMeters, ""),
    driverTripAssist?.remainingDistanceLabel,
    formatDistanceMeters(activeRide?.remainingDistanceMeters, ""),
    formatDistanceMeters(activeRide?.distanceMeters, ""),
    activeDistanceLabel,
  ) || "--";
  const liveEtaLabel =
    normalizedActiveStatus === "arrived"
      ? resolveFirstUsableLabel(driverTripAssist?.etaLabel, "2:00") || "2:00"
      : resolveFirstUsableLabel(
          formatDurationMinutes(driverTripAssist?.etaMinutes, ""),
          driverTripAssist?.etaLabel,
          formatDurationMinutes(driverTripMeta?.initialEtaMinutes, ""),
          formatDurationMinutes(activeRide?.estimatedDurationMinutes, ""),
          formatDurationMinutes(activeRide?.durationMinutes, ""),
          etaLabel,
        ) || "--";
  const primaryActionLabel =
    driverTripAssist?.primaryActionLabel || tripPhase.primaryLabel;
  const primaryActionTestID = resolveTripPrimaryActionTestID(
    normalizedActiveStatus,
  );
  const primaryActionEnabled =
    typeof driverTripAssist?.primaryActionEnabled === "boolean"
      ? driverTripAssist.primaryActionEnabled
      : true;
  const showNavigationButton = Boolean(
    onOpenNavigation &&
    ["accepted", "arrived", "started"].includes(normalizedActiveStatus),
  );
  const canInterruptOperational =
    typeof interruptRideOperationalFlow === "function" &&
    normalizedActiveStatus === "started";
  const canCancelActiveRide = Boolean(
    hasActiveRide &&
      typeof cancelActiveRideFlow === "function" &&
      ["accepted", "arrived"].includes(normalizedActiveStatus),
  );
  const showCompactProblemButton = Boolean(
    normalizedActiveStatus === "started" && canInterruptOperational,
  );
  const hasPendingExtensionDecision = [
    "driver_decision_pending",
    "pending_payment",
  ].includes(normalizedExtensionStatus);
  const isDriverNavigationMode = Boolean(
    nativeNavigationVisible &&
      hasActiveRide &&
      ["accepted", "arrived", "started"].includes(normalizedActiveStatus) &&
      !hasPendingExtensionDecision,
  );
  const showNavigationActionInSheet = Boolean(
    showNavigationButton && !isDriverNavigationMode,
  );
  const showCompactNavigationButton = Boolean(
    showNavigationActionInSheet &&
      ["accepted", "arrived", "started"].includes(normalizedActiveStatus),
  );
  const shouldUseCompactTripCard =
    hasActiveRide &&
    (isDriverNavigationMode ||
      ((isCompactTripStatus(normalizedActiveStatus) ||
        isOperationalInterrupted) &&
        !hasPendingExtensionDecision));
  const activeTripTitle =
    normalizedActiveStatus === "accepted"
      ? "A caminho do embarque"
      : normalizedActiveStatus === "started"
        ? `A caminho de ${dropoffLocation.title}`
        : tripPhase.title;
  const activeTripSubtitle =
    ["accepted", "started"].includes(normalizedActiveStatus)
      ? ""
      : tripPhase.subtitle;
  const driverIslandTitle = hasOffer
    ? isContinuationOffer
      ? "Retomar corrida"
      : "Nova corrida"
    : activeTripTitle;
  const driverIslandSubtitle = hasOffer
    ? `${pickupLocation.title} → ${dropoffLocation.title}`
    : normalizedActiveStatus === "started"
      ? `${liveDistanceLabel} restantes`
      : normalizedActiveStatus === "accepted"
        ? pickupLocation.title
        : activeTripSubtitle || passengerLabel;
  const driverIslandRightLabel = hasOffer
    ? fareLabel
    : normalizedActiveStatus === "started"
      ? "Em rota"
      : liveEtaLabel;
  const driverTripSheetTitle =
    normalizedActiveStatus === "started"
      ? "Progresso da viagem"
      : normalizedActiveStatus === "arrived"
        ? "Confirmar embarque"
        : normalizedActiveStatus === "accepted"
          ? "Ponto de embarque"
          : activeTripTitle;
  const activeTripMetrics = useMemo(
    () => [
      {
        key: "time",
        // At pickup this value is the boarding countdown, not a travel time.
        label: normalizedActiveStatus === "arrived" ? "Espera" : "Tempo",
        value: liveEtaLabel,
        icon: "time-outline",
        toneStyle: styles.metricIconEta,
        iconColor: "#365A6D",
      },
      {
        key: "distance",
        label: "Distância",
        value: liveDistanceLabel,
        icon: "map-outline",
        toneStyle: styles.metricIconDistance,
        iconColor: "#1A330E",
      },
      {
        key: "net",
        label: "Líquido",
        value: fareLabel,
        icon: "wallet-outline",
        toneStyle: styles.metricIconFare,
        iconColor: "#7A5D16",
      },
    ].filter((metric) => !(normalizedActiveStatus === "arrived" && metric.key === "distance")),
    [fareLabel, liveDistanceLabel, liveEtaLabel, normalizedActiveStatus],
  );
  const compactTripMetrics = useMemo(
    () =>
      isOperationalInterrupted
        ? activeTripMetrics.filter((metric) => metric.key === "net")
        : activeTripMetrics.filter((metric) => metric.key !== "net"),
    [activeTripMetrics, isOperationalInterrupted],
  );
  const navigationModeLabel =
    normalizedActiveStatus === "started"
      ? "Em viagem"
      : normalizedActiveStatus === "arrived"
        ? "Embarque"
        : "Até o passageiro";
  const passengerMetaLabel =
    normalizedActiveStatus === "started"
      ? "A bordo"
      : normalizedActiveStatus === "arrived"
        ? "No ponto"
        : resolveFirstUsableLabel(
            pickupLocation.subtitle,
            pickupLocation.title,
            "Ponto de embarque",
          );
  const lifecyclePassengerMeta =
    isOperationalInterrupted
      ? "Decisão pendente"
      : normalizedActiveStatus === "started"
      ? "A bordo"
      : normalizedActiveStatus === "arrived"
        ? "No ponto"
        : "Aguardando no embarque";
  const tripStatusMessage =
    ["accepted", "started"].includes(normalizedActiveStatus)
      ? ""
      : driverTripAssist?.subtitle || tripPhase.subtitle;

  useEffect(() => {
    setIsTripPeek(false);
    setIsTripExpanded(false);
  }, [activeRide?.bookingId, activeRide?.id, normalizedActiveStatus]);

  const handleAcceptExtension = useCallback(async () => {
    if (
      !driverExtensionRequest ||
      busyAction ||
      typeof respondToDriverExtension !== "function"
    ) {
      return;
    }

    try {
      setBusyAction("extension_accept");
      await respondToDriverExtension(true);
    } catch (error) {
      Alert.alert(
        "Não foi possível aprovar",
        error?.message || "Falha ao aprovar o novo destino.",
      );
    } finally {
      setBusyAction("");
    }
  }, [busyAction, driverExtensionRequest, respondToDriverExtension]);

  const handleRejectExtension = useCallback(async () => {
    if (
      !driverExtensionRequest ||
      busyAction ||
      typeof respondToDriverExtension !== "function"
    ) {
      return;
    }

    try {
      setBusyAction("extension_reject");
      await respondToDriverExtension(false);
    } catch (error) {
      Alert.alert(
        "Não foi possível recusar",
        error?.message || "Falha ao recusar o novo destino.",
      );
    } finally {
      setBusyAction("");
    }
  }, [busyAction, driverExtensionRequest, respondToDriverExtension]);

  const handleInterruptOperational = useCallback(() => {
    if (!canInterruptOperational || busyAction) {
      return;
    }

    Alert.alert(
      "Reportar problema",
      "Use esta opção apenas quando realmente houver um problema operacional. O passageiro poderá seguir com outro parceiro ou encerrar a corrida.",
      [
        { text: "Voltar", style: "cancel" },
        {
          text: "Reportar agora",
          style: "destructive",
          onPress: async () => {
            try {
              setBusyAction("interrupt");
              await interruptRideOperationalFlow({
                reason: "VEHICLE_BREAKDOWN",
              });
            } catch (error) {
              Alert.alert(
                "Não foi possível interromper",
                error?.message ||
                  "Falha ao registrar a interrupção operacional.",
              );
            } finally {
              setBusyAction("");
            }
          },
        },
      ],
    );
  }, [busyAction, canInterruptOperational, interruptRideOperationalFlow]);

  const handleOpenCancelPrompt = useCallback(() => {
    if (!canCancelActiveRide || busyAction) {
      return;
    }
    setShowCancelPrompt(true);
  }, [busyAction, canCancelActiveRide]);

  // The driver waited the whole boarding time at the pickup. Cancelling now is
  // a no-show, which the server needs to tell apart from a driver giving up.
  const passengerNoShow =
    normalizedActiveStatus === "arrived" && liveEtaLabel === "0:00";

  const handleConfirmCancelRide = useCallback(async () => {
    if (!canCancelActiveRide || busyAction) {
      return;
    }

    try {
      setShowCancelPrompt(false);
      setBusyAction("cancel");
      await cancelActiveRideFlow({
        reason: passengerNoShow
          ? "Passageiro não compareceu ao embarque."
          : "Cancelado pelo motorista.",
      });
    } catch (error) {
      Alert.alert(
        "Não foi possível cancelar",
        error?.message || "Falha ao cancelar a corrida.",
      );
    } finally {
      setBusyAction("");
    }
  }, [busyAction, canCancelActiveRide, cancelActiveRideFlow, passengerNoShow]);

  if (!hasActiveRide && !hasOffer) {
    return null;
  }

  const renderCompactActionButton = ({
    label,
    icon,
    onPress,
    disabled = false,
    variant = "secondary",
    testID,
    accessibilityLabel,
  }) => (
    <RobotaxiLifecycleButton
      label={label}
      icon={icon}
      tone={variant === "primary" ? "primary" : variant === "danger" ? "danger" : "secondary"}
      onPress={onPress}
      disabled={disabled}
      testID={testID}
      accessibilityLabel={accessibilityLabel || label}
    />
  );

  // Three heights: peek ⇄ compact ⇄ expanded. Drag the handle up/down, or tap
  // it to step (peek → compact → expanded → peek).
  // Plain functions (not hooks): this part of the component runs after an
  // early return, so hooks here would change the hook order.
  const stepTripSheet = (direction) => {
    if (direction > 0) {
      if (isTripPeek) setIsTripPeek(false);
      else setIsTripExpanded(true);
      return;
    }
    if (isTripExpanded) setIsTripExpanded(false);
    else setIsTripPeek(true);
  };
  const handleTripSheetStep = () => {
    if (isTripPeek) setIsTripPeek(false);
    else if (!isTripExpanded) setIsTripExpanded(true);
    else {
      setIsTripExpanded(false);
      setIsTripPeek(true);
    }
  };
  const tripSheetPan = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetY([-12, 12])
    .onEnd((event) => {
      if (event.translationY < -36 || event.velocityY < -700) stepTripSheet(1);
      else if (event.translationY > 36 || event.velocityY > 700) stepTripSheet(-1);
    });

  const renderCompactTripCard = () => (
    <>
      <View
        style={styles.lifecycleTripSummary}
        testID="driver-live-trip-compact-summary"
        accessibilityLabel="Resumo da corrida do motorista"
      >
        <RobotaxiLifecycleSummary
          eyebrow={isOperationalInterrupted
            ? "INTERRUPÇÃO REGISTRADA"
            : navigationModeLabel.toUpperCase()}
          object={isOperationalInterrupted ? 'help' : normalizedActiveStatus === 'arrived' ? 'privacy' : normalizedActiveStatus === 'started' ? 'activity' : 'places'}
          title={isOperationalInterrupted
            ? "Aguardando decisão do passageiro"
            : normalizedActiveStatus === "started"
              ? dropoffLabel
              : normalizedActiveStatus === "arrived"
                ? "Aguardando o passageiro"
                : pickupLabel}
          subtitle={isOperationalInterrupted
            ? "Você já está liberado de novas ações nesta corrida."
            : normalizedActiveStatus === "arrived"
              ? pickupLabel
              : null}
          titleTestID={isOperationalInterrupted
            ? "driver-live-operational-hold-title"
            : isSearchingReplacement
              ? "driver-live-searching-replacement-title"
              : undefined}
        />

        {!isTripPeek ? (
          <>
        <RobotaxiLifecycleIdentity
          initial={passengerInitial}
          photoUri={passengerPhotoUri}
          name={passengerLabel}
          meta={lifecyclePassengerMeta}
          style={styles.lifecycleTripIdentity}
          testID="driver-live-passenger-identity"
        />

        <View style={styles.lifecycleTripMetricRow}>
          {(isOperationalInterrupted ? compactTripMetrics : activeTripMetrics).map((metric) => (
            <RobotaxiLifecycleMetric
              key={metric.key}
              label={metric.label}
              value={metric.value}
            />
          ))}
        </View>
          </>
        ) : null}
      </View>

    </>
  );

  const renderCompactTripActions = () => (
    <>
      {/* Options sit beside the step button, not on a row of their own: that
          row cost the map about 60pt in every ride state. */}
      <View style={[styles.lifecycleTripActionStack, styles.lifecycleTripActionRow]} testID="driver-live-trip-actions">
        {!isTripPeek ? (
          <TouchableOpacity
            style={styles.lifecycleTripMoreButton}
            onPress={() => setIsTripExpanded(true)}
            accessibilityRole="button"
            accessibilityLabel="Mais opções"
            activeOpacity={0.7}
            testID="driver-live-trip-details-button"
          >
            <Ionicons name="ellipsis-horizontal" size={22} color="#222222" />
          </TouchableOpacity>
        ) : null}
        <View style={styles.lifecycleTripPrimaryAction}>
        {primaryActionLabel && normalizedActiveStatus === "started" ? (
          // Ending the trip is irreversible: slide, not tap.
          <LeafSlideToConfirm
            label="Deslize para encerrar"
            busyLabel="Encerrando..."
            busy={busyAction === "trip"}
            disabled={!primaryActionEnabled}
            onConfirm={handleTripPrimaryAction}
            testID={primaryActionTestID}
            accessibilityLabel={busyAction === "trip" ? "Atualizando etapa da corrida" : primaryActionLabel}
          />
        ) : primaryActionLabel ? (
          <RobotaxiLifecycleButton
            label={busyAction === "trip" ? tripBusyLabel : primaryActionLabel}
            icon={normalizedActiveStatus === "started"
              ? "flag-outline"
              : normalizedActiveStatus === "arrived"
                ? "play-outline"
                : "checkmark-circle-outline"}
            tone="primary"
            disabled={busyAction === "trip" || !primaryActionEnabled}
            onPress={handleTripPrimaryAction}
            testID={primaryActionTestID}
            accessibilityLabel={busyAction === "trip" ? "Atualizando etapa da corrida" : primaryActionLabel}
          />
        ) : null}
        </View>
      </View>
    </>
  );

  const renderExpandedTripCard = () => (
    <>
      <View style={styles.expandedTripHeaderRow}>
        <View style={styles.expandedTripHeaderCopy}>
          <Text style={styles.expandedTripTitle} numberOfLines={2}>
            {driverTripSheetTitle}
          </Text>
          <LeafPersonIdentity
            compact
            initial={passengerInitial}
            photoUri={passengerPhotoUri}
            name={passengerLabel}
            meta={passengerMetaLabel}
            style={styles.expandedTripPassengerIdentity}
            testID="driver-live-passenger-identity"
          />
        </View>

        <View style={styles.expandedTripSide}>
          <Text style={styles.expandedTripFareLabel}>Líquido</Text>
          <Text
            style={styles.expandedTripFareValue}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.78}
          >
            {fareLabel}
          </Text>
          <TouchableOpacity
            activeOpacity={0.82}
            onPress={() => setIsTripExpanded(false)}
            style={styles.expandedCollapseButton}
            testID="driver-live-trip-collapse-button"
            accessibilityLabel="Voltar ao resumo da corrida"
          >
            <Ionicons
              name="chevron-down-outline"
              size={17}
              color={color.text.secondary}
            />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.expandedMetricRow}>
        {activeTripMetrics.map((metric) => (
          <View key={metric.key} style={styles.expandedMetricPill}>
            <View style={[styles.expandedMetricIconWrap, metric.toneStyle]}>
              <Ionicons
                name={metric.icon}
                size={14}
                color={metric.iconColor}
              />
            </View>
            <Text style={styles.expandedMetricLabel}>{metric.label}</Text>
            <Text
              style={styles.expandedMetricValue}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.78}
            >
              {metric.value}
            </Text>
          </View>
        ))}
      </View>

      <View style={styles.expandedRoutePanel}>
        <View style={styles.expandedRouteStop}>
          <Text style={styles.expandedRouteLabel}>Embarque</Text>
          <Text style={styles.expandedRouteTitle} numberOfLines={1}>
            {pickupLocation.title}
          </Text>
        </View>

        <View style={styles.expandedRouteArrow}>
          <Ionicons name="arrow-forward" size={15} color="#60707A" />
        </View>

        <View style={styles.expandedRouteStop}>
          <Text
            style={[
              styles.expandedRouteLabel,
              styles.expandedRouteLabelDestination,
            ]}
          >
            Destino
          </Text>
          <Text style={styles.expandedRouteTitle} numberOfLines={1}>
            {dropoffLocation.title}
          </Text>
        </View>
      </View>

      {tripStatusMessage ? (
        <View style={styles.expandedStatusPill}>
          <Ionicons name="sparkles-outline" size={14} color="#365A6D" />
          <Text style={styles.expandedStatusText} numberOfLines={1}>
            {tripStatusMessage}
          </Text>
        </View>
      ) : null}

      <View style={styles.compactActionsGroup}>
        <View style={styles.compactActionsRow}>
          {showCompactNavigationButton ? (
            renderCompactActionButton({
              label: "Navegar",
              icon: "navigate-outline",
              onPress: onOpenNavigation,
              testID: "driver-live-trip-navigation-button",
              accessibilityLabel: "Abrir navegação",
            })
          ) : null}

          {canCancelActiveRide
            ? renderCompactActionButton({
                label: busyAction === "cancel" ? "Cancelando" : "Cancelar",
                icon: "close-circle-outline",
                onPress: handleOpenCancelPrompt,
                disabled: busyAction === "cancel",
                variant: "danger",
                testID: "driver-live-trip-cancel-button-expanded",
                accessibilityLabel: "Cancelar corrida",
              })
            : null}

          {showCompactProblemButton ? (
            renderCompactActionButton({
              label: busyAction === "interrupt" ? "Reportando" : "Problema",
              icon: "warning-outline",
              onPress: handleInterruptOperational,
              disabled: busyAction === "interrupt",
              variant: "danger",
              testID: "driver-live-trip-report-problem-button",
              accessibilityLabel: "Reportar problema",
            })
          ) : null}

          {primaryActionLabel
            ? renderCompactActionButton({
                label:
                  busyAction === "trip"
                    ? "Atualizando"
                    : normalizedActiveStatus === "started"
                      ? "Encerrar"
                      : normalizedActiveStatus === "accepted"
                        ? "Cheguei"
                        : primaryActionLabel,
                icon:
                  normalizedActiveStatus === "started"
                    ? "flag-outline"
                    : "checkmark-circle-outline",
                disabled: busyAction === "trip" || !primaryActionEnabled,
                onPress: handleTripPrimaryAction,
                variant: "primary",
                testID: primaryActionTestID,
                accessibilityLabel:
                  busyAction === "trip" ? tripBusyLabel : primaryActionLabel,
              })
            : null}
        </View>
      </View>
    </>
  );

  const renderLifecycleExpandedTripCard = () => (
    <>
      <RobotaxiLifecycleSummary
        eyebrow={isOperationalInterrupted
          ? "INTERRUPÇÃO REGISTRADA"
          : navigationModeLabel.toUpperCase()}
        object={isOperationalInterrupted ? 'help' : normalizedActiveStatus === 'arrived' ? 'privacy' : normalizedActiveStatus === 'started' ? 'activity' : 'places'}
        title={isOperationalInterrupted
          ? "Aguardando decisão do passageiro"
          : normalizedActiveStatus === "started"
            ? dropoffLabel
            : normalizedActiveStatus === "arrived"
              ? "Aguardando o passageiro"
              : pickupLabel}
        subtitle={isOperationalInterrupted ? null : tripStatusMessage || null}
        titleTestID={isOperationalInterrupted
          ? "driver-live-operational-hold-title"
          : undefined}
      />

      <RobotaxiLifecycleIdentity
        initial={passengerInitial}
        photoUri={passengerPhotoUri}
        name={passengerLabel}
        meta={lifecyclePassengerMeta}
        style={styles.lifecycleTripIdentity}
        testID="driver-live-passenger-identity"
      />

      <View style={styles.lifecycleTripMetricRow}>
        {(isOperationalInterrupted ? compactTripMetrics : activeTripMetrics).map((metric) => (
          <RobotaxiLifecycleMetric
            key={metric.key}
            label={metric.label}
            value={metric.value}
            tone={metric.key === "net" ? "accent" : "default"}
          />
        ))}
      </View>

      <RobotaxiLifecycleSection
        title={isOperationalInterrupted ? "TRECHO ENCERRADO" : "ROTA E AÇÕES"}
      >
        <LeafJourneyRoute origin={pickupLabel} destination={dropoffLabel} />

        <View style={styles.lifecycleTripSecondaryGrid}>
          {typeof onOpenChat === "function" ? (
            <RobotaxiLifecycleButton
              label="Chat"
              icon="chatbubble-ellipses-outline"
              onPress={onOpenChat}
              style={styles.lifecycleTripSecondaryButton}
              testID="driver-live-trip-chat-button"
              accessibilityLabel="Abrir chat da corrida"
            />
          ) : null}

          {showCompactNavigationButton ? (
            <RobotaxiLifecycleButton
              label="Navegar"
              icon="navigate-outline"
              onPress={onOpenNavigation}
              style={styles.lifecycleTripSecondaryButton}
              testID="driver-live-trip-navigation-button"
              accessibilityLabel="Abrir navegação"
            />
          ) : null}

          {canCancelActiveRide ? (
            <RobotaxiLifecycleButton
              label={busyAction === "cancel" ? "Cancelando..." : "Cancelar"}
              icon="close-circle-outline"
              tone="danger"
              onPress={handleOpenCancelPrompt}
              disabled={busyAction === "cancel"}
              style={styles.lifecycleTripSecondaryButton}
              testID="driver-live-trip-cancel-button-expanded"
              accessibilityLabel="Cancelar corrida"
            />
          ) : null}

          {showCompactProblemButton ? (
            <RobotaxiLifecycleButton
              label={busyAction === "interrupt" ? "Reportando..." : "Reportar"}
              icon="warning-outline"
              tone="danger"
              onPress={handleInterruptOperational}
              disabled={busyAction === "interrupt"}
              style={styles.lifecycleTripSecondaryButton}
              testID="driver-live-trip-report-problem-button"
              accessibilityLabel="Reportar problema"
            />
          ) : null}
        </View>
      </RobotaxiLifecycleSection>

      <View style={styles.lifecycleTripActionStack}>
        <RobotaxiLifecycleDisclosure
          expanded
          onPress={() => setIsTripExpanded(false)}
          expandedLabel="Ocultar opções"
          testID="driver-live-trip-collapse-button"
        />
        {primaryActionLabel ? (
          <RobotaxiLifecycleButton
            label={busyAction === "trip" ? tripBusyLabel : primaryActionLabel}
            icon={normalizedActiveStatus === "started"
              ? "flag-outline"
              : normalizedActiveStatus === "arrived"
                ? "play-outline"
                : "checkmark-circle-outline"}
            tone="primary"
            disabled={busyAction === "trip" || !primaryActionEnabled}
            onPress={handleTripPrimaryAction}
            testID={primaryActionTestID}
            accessibilityLabel={busyAction === "trip" ? "Atualizando etapa da corrida" : primaryActionLabel}
          />
        ) : null}
      </View>
    </>
  );

  const cardBottomPadding =
    hasOffer
      ? 16
      : shouldUseCompactTripCard
        ? robotaxiLifecycleMetrics.cardPaddingBottom
        : 16;

  return (
    <>
      {!hasOffer && !isDriverNavigationMode && !shouldUseCompactTripCard ? (
        <LeafStateHeader
          title={driverIslandTitle}
          subtitle={driverIslandSubtitle}
          rightLabel={driverIslandRightLabel}
          rightTone={hasOffer || normalizedActiveStatus === "started" ? "dark" : "leaf"}
          insetsTop={insetsTop}
        />
      ) : null}
      <Animated.View
        pointerEvents="box-none"
        onLayout={onCardLayout}
        testID="driver-live-ride-overlay-wrap"
        style={[
          styles.wrap,
          {
            // Same lift for offer and trip cards: above the home indicator.
            bottom: safeBottom + robotaxiLifecycleMetrics.cardBottomGap + (hasOffer || shouldUseCompactTripCard ? 0 : bottomOffset),
          },
          cardStepMotion,
        ]}
      >
        <PrototypeCard
          style={[
            styles.card,
            hasOffer && styles.offerLifecycleCard,
            shouldUseCompactTripCard && !isTripExpanded
              ? [
                  styles.compactCard,
                  isDriverNavigationMode && styles.navigationModeCard,
                ]
              : shouldUseCompactTripCard
                ? styles.expandedTripCard
                : { maxHeight: hasOffer ? offerCardMaxHeight : maxCardHeight },
            shouldUseCompactTripCard && styles.tripLifecycleCard,
            { paddingBottom: cardBottomPadding, maxHeight: hasOffer || shouldUseCompactTripCard ? offerCardMaxHeight : maxCardHeight },
          ]}
          testID={hasOffer
            ? "driver-live-offer-card"
            : shouldUseCompactTripCard
              ? "driver-live-trip-card"
              : undefined}
        >
        {shouldUseCompactTripCard ? (
          <GestureDetector gesture={tripSheetPan}>
            <Pressable
              onPress={handleTripSheetStep}
              style={styles.lifecycleHandleArea}
              accessibilityRole="adjustable"
              accessibilityLabel="Altura do cartão da corrida"
              accessibilityHint="Toque para alternar entre resumo, padrão e detalhes"
              testID="driver-live-trip-sheet-handle"
            >
              <View style={styles.lifecycleHandle} />
            </Pressable>
          </GestureDetector>
        ) : null}
        {shouldUseCompactTripCard ? (
          <ScrollView
            bounces={false}
            nestedScrollEnabled
            showsVerticalScrollIndicator={isTripExpanded}
            style={{ maxHeight: Math.max(1, offerCardMaxHeight - cardBottomPadding - 40 - (isTripExpanded ? 0 : DRIVER_TRIP_ACTIONS_HEIGHT)), flexGrow: 0 }}
            contentContainerStyle={styles.scrollContent}
          >
            {isTripExpanded ? renderLifecycleExpandedTripCard() : renderCompactTripCard()}
          </ScrollView>
        ) : (
          <ScrollView
            bounces={false}
            showsVerticalScrollIndicator={false}
            nestedScrollEnabled
            style={{ maxHeight: Math.max(1, (hasOffer ? offerCardMaxHeight : maxCardHeight) - cardBottomPadding - (hasOffer ? 18 + DRIVER_OFFER_ACTIONS_HEIGHT : 16)), flexGrow: 0 }}
            contentContainerStyle={styles.scrollContent}
          >
          {hasOffer ? (
            <>
              <View style={styles.offerHeader}>
                <Text style={styles.offerEyebrow}>
                  {isContinuationOffer ? "Continuidade de corrida" : "Nova corrida"}
                </Text>
                {offerCountdown.label !== "--:--" || offerExpired ? (
                <View
                  style={[styles.offerTimerPill, offerExpired && styles.offerTimerPillExpired]}
                  accessibilityLabel={offerExpired ? "Tempo de resposta esgotado" : `${offerCountdown.label} para responder`}
                >
                  <Ionicons name="time-outline" size={13} color={offerExpired ? "#8A1F2B" : "#1A330E"} />
                  <Text
                    style={[styles.offerTimerText, offerExpired && styles.offerTimerTextExpired]}
                    testID="driver-live-offer-response-timer"
                  >
                    {offerExpired ? "Tempo de resposta esgotado" : offerCountdown.label}
                  </Text>
                </View>
                ) : null}
              </View>

              <View style={styles.offerFareRow}>
                <Text style={styles.offerFareValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{fareLabel}</Text>
                <Text style={styles.offerFareLabel}>Líquido</Text>
              </View>
              <Text style={styles.offerTripLine} numberOfLines={1}>
                {offerPickupEtaLabel} até o embarque · {distanceLabel} · {offerTripDurationLabel}
              </Text>

              {/* The offer has seconds to be read: fare, how far, where. One
                  line per stop, and the passenger and details share a row. */}
              <LeafJourneyRoute origin={pickupLabel} destination={dropoffLabel} style={styles.offerRoute} dense />

              <View style={styles.offerPassengerRow}>
                <RobotaxiLifecycleIdentity
                  initial={passengerInitial}
                  photoUri={passengerPhotoUri}
                  name={passengerLabel}
                  meta="Passageiro verificado"
                  style={[styles.offerPassengerIdentity, styles.offerPassengerIdentityInline]}
                  testID="driver-live-passenger-identity"
                />
                <TouchableOpacity
                  onPress={() => setIsOfferExpanded((current) => !current)}
                  style={styles.offerDetailsLink}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: isOfferExpanded }}
                  accessibilityLabel={isOfferExpanded ? "Ocultar detalhes" : "Ver detalhes"}
                  testID="driver-live-offer-details-button"
                >
                  <Text style={styles.offerDetailsLinkText}>
                    {isOfferExpanded ? "Ocultar" : "Detalhes"}
                  </Text>
                  <Ionicons name={isOfferExpanded ? "chevron-up" : "chevron-down"} size={16} color="#222222" />
                </TouchableOpacity>
              </View>

              {isOfferExpanded ? (
                <RobotaxiLifecycleSection title="DETALHES DA CORRIDA">
                  {isContinuationOffer ? (
                    <View style={[styles.statusPill, styles.tripStatusPill]}>
                      <Ionicons name="repeat-outline" size={16} color="#365A6D" />
                      <Text
                        style={[styles.statusPillText, styles.tripStatusPillText]}
                        numberOfLines={2}
                      >
                        {offer?.continuationMessage ||
                          "Corrida em continuidade a partir do ponto de interrupção."}
                      </Text>
                    </View>
                  ) : null}

                  {ridePreferenceItems.length > 0 ? (
                    <View
                      style={styles.offerPreferenceSummary}
                      testID="driver-live-offer-preferences"
                      accessibilityLabel="Preferências do passageiro"
                    >
                      <Text style={styles.offerDetailLabel}>PREFERÊNCIAS</Text>
                      <Text style={styles.offerDetailValue}>
                        {ridePreferenceItems.map((item) => item.label).join(" · ")}
                      </Text>
                    </View>
                  ) : null}

                  <View style={styles.offerPaymentSummary}>
                    <Ionicons
                      name="checkmark-circle-outline"
                      size={17}
                      color="#1A330E"
                    />
                    <Text style={styles.offerPaymentText}>
                      Pagamento {paymentLabel.toLowerCase()} confirmado
                    </Text>
                    {isPixPayment ? (
                      <SecurePaymentBadge
                        style={styles.offerSecurePaymentBadge}
                        color="#6E7D72"
                      />
                    ) : null}
                  </View>

                </RobotaxiLifecycleSection>
              ) : null}

            </>
          ) : (
            <>
              {shouldUseCompactTripCard ? (
                <TouchableOpacity
                  activeOpacity={0.82}
                  onPress={() => setIsTripExpanded(false)}
                  style={styles.collapseControl}
                  testID="driver-live-trip-collapse-button"
                  accessibilityLabel="Voltar ao resumo da corrida"
                >
                  <Ionicons
                    name="chevron-down-outline"
                    size={16}
                    color={color.text.secondary}
                  />
                  <Text style={styles.collapseControlText}>Voltar ao resumo</Text>
                </TouchableOpacity>
              ) : null}

              <View style={styles.headerRow}>
                <View style={styles.headerCopy}>
                  <Text style={styles.eyebrow}>Detalhes</Text>
                  <Text
                    style={styles.title}
                    testID={
                      normalizedActiveStatus === "operational_interrupted"
                        ? "driver-live-operational-hold-title"
                        : normalizedActiveStatus === "searching_replacement"
                          ? "driver-live-searching-replacement-title"
                          : undefined
                    }
                    accessibilityLabel={
                      normalizedActiveStatus === "operational_interrupted"
                        ? driverTripSheetTitle
                        : normalizedActiveStatus === "searching_replacement"
                          ? driverTripSheetTitle
                          : undefined
                    }
                  >
                    {driverTripSheetTitle}
                  </Text>
                  <LeafPersonIdentity
                    compact
                    initial={passengerInitial}
                    photoUri={passengerPhotoUri}
                    name={passengerLabel}
                    meta={passengerMetaLabel}
                    style={styles.headerPassengerIdentity}
                    testID="driver-live-passenger-identity"
                  />
                </View>
                <View style={[styles.fareBadge, styles.fareBadgeSoft]}>
                  <Text style={styles.fareBadgeLabel}>Líquido</Text>
                  <Text style={styles.fareBadgeValue}>{fareLabel}</Text>
                </View>
              </View>

              {activeTripSubtitle ? (
                <Text style={styles.tripSubtitle}>{activeTripSubtitle}</Text>
              ) : null}

              {normalizedExtensionStatus &&
              normalizedExtensionStatus !== "idle" ? (
                <View style={styles.extensionPanel}>
                  <View style={styles.extensionHeader}>
                    <Ionicons
                      name={
                        normalizedExtensionStatus === "confirmed"
                          ? "checkmark-circle-outline"
                          : normalizedExtensionStatus === "pending_payment"
                            ? "time-outline"
                            : "swap-horizontal-outline"
                      }
                      size={16}
                      color={
                        normalizedExtensionStatus === "confirmed"
                          ? "#1A330E"
                          : color.text.primary
                      }
                    />
                    <Text style={styles.extensionHeaderText}>
                      {normalizedExtensionStatus === "driver_decision_pending"
                        ? "Passageiro pediu novo destino"
                        : normalizedExtensionStatus === "pending_payment"
                          ? "Complemento Pix pendente"
                          : normalizedExtensionStatus === "confirmed"
                            ? "Novo destino confirmado"
                            : normalizedExtensionStatus === "rejected"
                              ? "Alteração recusada"
                              : "Atualização de destino"}
                    </Text>
                  </View>

                  {driverExtensionRequest?.destination?.name ? (
                    <Text style={styles.extensionDestinationText}>
                      {driverExtensionRequest.destination.name}
                    </Text>
                  ) : null}

                  <Text style={styles.extensionMessageText}>
                    {normalizedExtensionStatus === "driver_decision_pending"
                      ? `Complemento do passageiro: ${formatCurrency(driverExtensionRequest?.diffFare)}${
                          Number(driverExtensionRequest?.extensionOperationalCost) > 0
                            ? " com custos operacionais"
                            : ""
                        }`
                      : normalizedExtensionStatus === "pending_payment"
                        ? "Você aprovou a alteração. A rota muda quando o pagamento for confirmado."
                        : driverExtensionRequest?.message ||
                          "O novo destino já foi refletido na corrida."}
                  </Text>

                  {normalizedExtensionStatus === "driver_decision_pending" ? (
                    <View style={styles.extensionActions}>
                      <TouchableOpacity
                        activeOpacity={0.82}
                        style={[
                          styles.extensionSecondaryAction,
                          styles.extensionRejectAction,
                        ]}
                        onPress={handleRejectExtension}
                        testID="driver-live-extension-reject-button"
                        accessibilityRole="button"
                        accessibilityLabel="Recusar novo destino"
                      >
                        <Text style={styles.extensionRejectActionText}>
                          {busyAction === "extension_reject"
                            ? "Recusando..."
                            : "Recusar"}
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        activeOpacity={0.82}
                        style={styles.extensionPrimaryAction}
                        onPress={handleAcceptExtension}
                        testID="driver-live-extension-accept-button"
                        accessibilityRole="button"
                        accessibilityLabel="Aceitar novo destino"
                      >
                        <Text style={styles.extensionPrimaryActionText}>
                          {busyAction === "extension_accept"
                            ? "Aprovando..."
                            : "Aceitar novo destino"}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  ) : null}
                </View>
              ) : null}

              <View style={styles.metricGrid}>
                {activeTripMetrics.map((metric, index) => (
                  <View
                    key={metric.key}
                    style={[
                      styles.metricCard,
                      activeTripMetrics.length % 2 === 1 &&
                      index === activeTripMetrics.length - 1
                        ? styles.metricCardFullWidth
                        : null,
                    ]}
                  >
                    <View style={[styles.metricIconWrap, metric.toneStyle]}>
                      <Ionicons
                        name={metric.icon}
                        size={18}
                        color={metric.iconColor}
                      />
                    </View>
                    <View style={styles.metricCopy}>
                      <Text style={styles.metricLabel}>{metric.label}</Text>
                      <Text style={styles.metricValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{metric.value}</Text>
                    </View>
                  </View>
                ))}
              </View>

              <View style={styles.routePanel}>
                <View style={styles.routeTimeline}>
                  <View style={styles.timelineNodeOuter}>
                    <View
                      style={[styles.timelineNodeInner, styles.pickupDot]}
                    />
                  </View>
                  <View style={styles.timelineLine} />
                  <View style={styles.timelineNodeOuter}>
                    <View
                      style={[styles.timelineNodeInner, styles.dropoffDot]}
                    />
                  </View>
                </View>

                <View style={styles.routePanelContent}>
                  <View style={styles.routeStop}>
                    <Text style={styles.routeStopLabel}>Embarque</Text>
                    <Text style={styles.routeStopTitle}>
                      {pickupLocation.title}
                    </Text>
                    {pickupLocation.subtitle ? (
                      <Text style={styles.routeStopSubtitle}>
                        {pickupLocation.subtitle}
                      </Text>
                    ) : null}
                  </View>

                  <View style={styles.routeStopDivider} />

                  <View style={styles.routeStop}>
                    <Text
                      style={[
                        styles.routeStopLabel,
                        styles.routeStopLabelDestination,
                      ]}
                    >
                      Destino
                    </Text>
                    <Text style={styles.routeStopTitle}>
                      {dropoffLocation.title}
                    </Text>
                    {dropoffLocation.subtitle ? (
                      <Text style={styles.routeStopSubtitle}>
                        {dropoffLocation.subtitle}
                      </Text>
                    ) : null}
                  </View>
                </View>
              </View>

              {tripStatusMessage ? (
                <View style={[styles.statusPill, styles.tripStatusPill]}>
                  <Ionicons name="sparkles-outline" size={16} color="#365A6D" />
                  <Text
                    style={[styles.statusPillText, styles.tripStatusPillText]}
                    numberOfLines={2}
                  >
                    {tripStatusMessage}
                  </Text>
                </View>
              ) : null}

              {showNavigationActionInSheet ? (
                <PrototypePrimaryButton
                  label="Abrir navegação"
                  icon="navigate-outline"
                  onPress={onOpenNavigation}
                  style={styles.tripSecondaryButton}
                />
              ) : null}

              {canCancelActiveRide ? (
                <TouchableOpacity
                  activeOpacity={0.82}
                  style={styles.tripCancelButton}
                  onPress={handleOpenCancelPrompt}
                  disabled={busyAction === "cancel"}
                  testID="driver-live-trip-cancel-button-expanded"
                  accessibilityLabel="Cancelar corrida"
                >
                  <Ionicons
                    name="close-circle-outline"
                    size={leafButtonMetrics.iconSize}
                    color="#8A1F2B"
                  />
                  <Text style={styles.tripCancelButtonText}>
                    {busyAction === "cancel" ? "Cancelando..." : "Cancelar"}
                  </Text>
                </TouchableOpacity>
              ) : null}

              {primaryActionLabel ? (
                <PrototypePrimaryButton
                  label={
                    busyAction === "trip"
                      ? tripBusyLabel
                      : primaryActionLabel
                  }
                  icon={
                    normalizedActiveStatus === "started"
                      ? "flag-outline"
                      : normalizedActiveStatus === "arrived"
                        ? "play-outline"
                        : "checkmark-circle-outline"
                  }
                  disabled={busyAction === "trip" || !primaryActionEnabled}
                  onPress={handleTripPrimaryAction}
                  style={styles.tripPrimaryButton}
                  testID={primaryActionTestID}
                  accessibilityLabel={
                    busyAction === "trip" ? "Atualizando etapa da corrida" : primaryActionLabel
                  }
                />
              ) : null}

              {canInterruptOperational ? (
                <TouchableOpacity
                  activeOpacity={0.82}
                  style={styles.tripInterruptButton}
                  onPress={handleInterruptOperational}
                  disabled={busyAction === "interrupt"}
                  testID="driver-live-trip-interrupt-button"
                  accessibilityRole="button"
                  accessibilityLabel={busyAction === "interrupt"
                    ? "Reportando problema com a corrida"
                    : "Reportar problema com a corrida"}
                >
                  <Ionicons
                    name="warning-outline"
                    size={leafButtonMetrics.iconSize}
                    color="#8A1F2B"
                  />
                  <Text style={styles.tripInterruptButtonText}>
                    {busyAction === "interrupt"
                      ? "Reportando..."
                      : "Reportar problema"}
                  </Text>
                </TouchableOpacity>
              ) : null}
            </>
          )}
          </ScrollView>
        )}
        {shouldUseCompactTripCard && !isTripExpanded ? renderCompactTripActions() : null}
        {hasOffer ? (
              <View style={styles.offerActions} testID="driver-live-offer-actions">
              <TouchableOpacity
                activeOpacity={0.82}
                disabled={Boolean(busyAction) || offerExpired}
                onPress={handleRejectOffer}
                style={[styles.offerDeclineButton, (Boolean(busyAction) || offerExpired) && styles.offerButtonDisabled]}
                testID="driver-live-offer-reject-button"
                accessibilityRole="button"
                accessibilityLabel="Recusar corrida"
                accessibilityState={{ disabled: Boolean(busyAction) || offerExpired }}
              >
                <Ionicons name="close" size={24} color="#222222" />
              </TouchableOpacity>
              <View style={styles.offerAcceptWrap}>
                <RobotaxiLifecycleButton
                  label={
                    busyAction === "accept" ? "Aceitando..." : "Aceitar corrida"
                  }
                  icon="checkmark-outline"
                  tone="primary"
                  style={styles.offerAction}
                  testID="driver-live-offer-accept-button"
                  accessibilityLabel={
                    busyAction === "accept" ? "Aceitando..." : "Aceitar corrida"
                  }
                  disabled={Boolean(busyAction) || offerExpired}
                  onPress={handleAcceptOffer}
                />
                <View style={styles.offerTimeTrack} pointerEvents="none">
                  <View
                    style={[styles.offerTimeFill, { width: `${Math.round(offerTimeRatio * 100)}%` }]}
                    testID="driver-live-offer-time-bar"
                  />
                </View>
              </View>
              </View>
        ) : null}
        </PrototypeCard>
      </Animated.View>

      <Modal
        transparent
        visible={showCancelPrompt}
        animationType="fade"
        onRequestClose={() => setShowCancelPrompt(false)}
      >
        <View style={styles.cancelPromptScrim}>
          <View style={styles.cancelPromptCard}>
            <Text style={styles.cancelPromptTitle}>
              {passengerNoShow ? "Passageiro não apareceu?" : "Cancelar corrida?"}
            </Text>
            <Text style={styles.cancelPromptMessage}>
              {passengerNoShow
                ? "O tempo de espera terminou. Ao cancelar, registramos que o passageiro não compareceu ao embarque."
                : "O passageiro será avisado. Cancelar depois de aceitar pode gerar cobrança."}
            </Text>
            <View style={styles.cancelPromptActions}>
              <TouchableOpacity
                activeOpacity={0.82}
                style={styles.cancelPromptYesButton}
                onPress={handleConfirmCancelRide}
                testID="driver-live-trip-cancel-confirm-button"
                accessibilityLabel="Confirmar cancelamento"
              >
                <Text style={styles.cancelPromptYesText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.86}
                style={styles.cancelPromptNoButton}
                onPress={() => setShowCancelPrompt(false)}
                testID="driver-live-trip-cancel-dismiss-button"
                accessibilityLabel="Continuar corrida"
              >
                <Text style={styles.cancelPromptNoText}>Continuar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

export default memo(DriverLiveRideOverlay);

const styles = StyleSheet.create({
  lifecycleHandleArea: { height: 30, alignItems: 'center', justifyContent: 'flex-start' },
  lifecycleHandle: { width: 32, height: 3, borderRadius: 2, backgroundColor: '#E5E5E5' },
  lifecycleJourneyRoute: { marginTop: 16 },
  offerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  offerEyebrow: { ...leafTypography.semiBold, fontSize: 13, letterSpacing: 0.2, color: '#5C6159' },
  offerTimerPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, height: 26, borderRadius: 13, backgroundColor: '#EEF3EA' },
  offerTimerPillExpired: { backgroundColor: '#FBECEE' },
  offerTimerText: { ...leafTypography.semiBold, fontSize: 13, color: '#1A330E', fontVariant: ['tabular-nums'] },
  offerTimerTextExpired: { color: '#8A1F2B' },
  offerFareRow: { marginTop: 10, flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  offerFareValue: { ...leafTypography.semiBold, fontSize: compactSize(30, 26), lineHeight: compactSize(36, 31), color: '#111410', fontVariant: ['tabular-nums'] },
  offerFareLabel: { ...leafTypography.medium, fontSize: 15, color: '#6A6A6A' },
  offerTripLine: { ...leafTypography.regular, marginTop: 2, fontSize: 15, lineHeight: 20, color: '#4B5148' },
  offerRoute: { marginTop: 12 },
  offerActions: { marginTop: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  offerAction: { width: '100%', minWidth: 0, paddingHorizontal: 12 },
  offerAcceptWrap: { flex: 1, minWidth: 0 },
  offerDeclineButton: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F2F3F0' },
  offerButtonDisabled: { opacity: 0.45 },
  offerTimeTrack: { position: 'absolute', left: 18, right: 18, bottom: 6, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.22)', overflow: 'hidden' },
  offerTimeFill: { height: 3, borderRadius: 2, backgroundColor: '#FFFFFF' },
  wrap: {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 18,
  },
  // Every driver card floats: inset from the sides, lifted off the bottom edge.
  card: {
    marginHorizontal: robotaxiLifecycleMetrics.cardHorizontalMargin,
    borderRadius: robotaxiLifecycleMetrics.cardRadius,
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 16,
    backgroundColor: Platform.OS === "android" ? "#FFFFFF" : "rgba(255,255,255,0.96)",
    borderColor: "#E5E5E5",
    shadowColor: '#0B120A',
    shadowOpacity: 0.14,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  // Floating offer card: inset from every edge so the map stays visible around it.
  offerLifecycleCard: {
    marginHorizontal: 12,
    borderRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 18,
    backgroundColor: color.bg.panelSolid,
    shadowColor: '#0B120A',
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 14,
  },
  tripLifecycleCard: {
    marginHorizontal: robotaxiLifecycleMetrics.cardHorizontalMargin,
    borderRadius: robotaxiLifecycleMetrics.cardRadius,
    paddingHorizontal: robotaxiLifecycleMetrics.cardPaddingHorizontal,
    paddingTop: robotaxiLifecycleMetrics.cardPaddingTop,
    paddingBottom: robotaxiLifecycleMetrics.cardPaddingBottom,
    backgroundColor: color.bg.panelSolid,
  },
  lifecycleTripSummary: {
    minWidth: 0,
  },
  lifecycleTripIdentity: {
    marginTop: 14,
  },
  lifecycleTripMetricRow: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.border.subtle,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 20,
  },
  lifecycleTripRouteRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  lifecycleTripRouteStop: {
    flex: 1,
    minWidth: 0,
  },
  lifecycleTripRouteLabel: {
    color: color.text.muted,
    ...leafTypography.medium,
    fontSize: 11,
    lineHeight: 13,
    letterSpacing: 0.5,
  },
  lifecycleTripRouteValue: {
    marginTop: 3,
    color: color.text.primary,
    ...leafTypography.semiBold,
    fontSize: 13,
    lineHeight: 17,
  },
  lifecycleTripSecondaryGrid: {
    marginTop: 14,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  lifecycleTripSecondaryButton: {
    flexGrow: 1,
    flexBasis: "46%",
  },
  lifecycleTripActionStack: {
    marginTop: 16,
    gap: 10,
  },
  offerPassengerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  offerPassengerIdentityInline: {
    flex: 1,
    minWidth: 0,
  },
  offerDetailsLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 8,
    paddingLeft: 8,
  },
  offerDetailsLinkText: {
    fontSize: 14,
    fontFamily: "Figtree-SemiBold",
    color: "#222222",
  },
  lifecycleTripActionRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  lifecycleTripMoreButton: {
    width: 54,
    height: 54,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E5E5E5",
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  lifecycleTripPrimaryAction: {
    flex: 1,
    minWidth: 0,
  },
  scrollContent: {
    paddingBottom: 2,
  },
  offerPassengerIdentity: {
    marginTop: 14,
  },
  offerRouteSummary: {
    marginTop: 14,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: color.border.subtle,
    gap: 8,
  },
  offerRouteRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  offerRouteLabel: {
    width: 64,
    color: color.text.muted,
    ...leafTypography.medium,
    fontSize: 11,
    lineHeight: 13,
    letterSpacing: 0.5,
  },
  offerRouteValue: {
    flex: 1,
    minWidth: 0,
    color: color.text.primary,
    ...leafTypography.regular,
    fontSize: 13,
    lineHeight: 18,
  },
  offerDisclosure: {
    marginTop: 14,
  },
  offerPreferenceSummary: {
    marginBottom: 14,
  },
  offerDetailLabel: {
    color: color.text.muted,
    ...leafTypography.medium,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.5,
  },
  offerDetailValue: {
    marginTop: 3,
    color: color.text.primary,
    ...leafTypography.regular,
    fontSize: 13,
    lineHeight: 16,
  },
  offerPaymentSummary: {
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  offerPaymentText: {
    flex: 1,
    minWidth: 0,
    color: color.text.secondary,
    ...leafTypography.medium,
    fontSize: 13,
    lineHeight: 16,
  },
  offerSecurePaymentBadge: {
    marginLeft: "auto",
  },
  offerRejectButton: {
    marginTop: 12,
    width: "100%",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  headerCopy: {
    flex: 1,
    paddingRight: 6,
  },
  eyebrow: {
    ...leafTypography.medium,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    color: "#1A330E",
    marginBottom: 6,
  },
  title: {
    ...leafTypography.semiBold,
    fontSize: 22,
    lineHeight: 28,
    color: color.text.primary,
  },
  passengerCaption: {
    marginTop: 6,
    ...leafTypography.medium,
    fontSize: 13,
    color: color.text.secondary,
  },
  headerPassengerIdentity: {
    marginTop: 10,
  },
  fareBadge: {
    minWidth: 108,
    borderRadius: 20,
    backgroundColor: "#EEF3EA",
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(26,51,14,0.14)",
    shadowColor: "#C8D7BF",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.08,
    shadowRadius: 18,
    elevation: 6,
  },
  fareBadgeSoft: {
    backgroundColor: "#F2F4E1",
    shadowColor: "#DDE5BC",
  },
  fareBadgeLabel: {
    ...leafTypography.medium,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    color: "#53634D",
    marginBottom: 4,
  },
  fareBadgeValue: {
    ...leafTypography.semiBold,
    fontSize: 17,
    color: "#1A330E",
  },
  offerResponseTimer: {
    alignSelf: "flex-start",
    marginTop: 12,
    minHeight: 30,
    borderRadius: 15,
    paddingHorizontal: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#EEF3EA",
  },
  offerResponseTimerText: {
    ...leafTypography.semiBold,
    fontSize: 13,
    lineHeight: 18,
    color: "#365A6D",
  },
  offerMetaStrip: {
    marginTop: 14,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#E5E5E5',
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
  },
  offerMetaItem: {
    flex: 1,
    minWidth: 0,
    paddingRight: 10,
  },
  offerMetaLabel: {
    ...leafTypography.medium,
    fontSize: 11,
    lineHeight: 14,
    textTransform: "uppercase",
    letterSpacing: 0.9,
    color: "#6B7178",
  },
  offerMetaValue: {
    marginTop: 3,
    ...leafTypography.semiBold,
    fontSize: 15,
    lineHeight: 20,
    color: color.text.primary,
  },
  metricGrid: {
    marginTop: 14,
    flexDirection: "row",
    gap: 10,
    flexWrap: "wrap",
  },
  metricCard: {
    flexGrow: 1,
    flexBasis: "48%",
    minWidth: 0,
    minHeight: 68,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#E5E5E5",
    backgroundColor: "#F7F8F4",
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
  },
  metricCardFullWidth: {
    flexBasis: "100%",
  },
  metricIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  metricIconDistance: {
    backgroundColor: "#EEF3EA",
  },
  metricIconEta: {
    backgroundColor: "#F3F5F2",
  },
  metricIconFare: {
    backgroundColor: "#F7F8F4",
  },
  metricCopy: {
    flex: 1,
    minWidth: 0,
  },
  metricLabel: {
    ...leafTypography.medium,
    fontSize: 11,
    textTransform: "uppercase",
    color: "#6B7178",
    marginBottom: 4,
  },
  metricValue: {
    ...leafTypography.semiBold,
    fontSize: 17,
    color: color.text.primary,
  },
  routePanel: {
    marginTop: 14,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "#E5E5E5",
    backgroundColor: "#F7F8F4",
    paddingHorizontal: 15,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "stretch",
  },
  routeTimeline: {
    width: 24,
    alignItems: "center",
    paddingTop: 6,
    paddingBottom: 6,
  },
  timelineNodeOuter: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(33,53,46,0.08)",
    backgroundColor: "rgba(245,248,246,0.95)",
    alignItems: "center",
    justifyContent: "center",
  },
  timelineNodeInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  timelineLine: {
    flex: 1,
    width: 3,
    borderRadius: 999,
    backgroundColor: "rgba(148,170,158,0.45)",
    marginVertical: 6,
  },
  pickupDot: {
    backgroundColor: "#1A330E",
  },
  dropoffDot: {
    backgroundColor: "#4D6575",
  },
  routePanelContent: {
    flex: 1,
    paddingLeft: 12,
  },
  routeStop: {
    justifyContent: "center",
  },
  routeStopLabel: {
    ...leafTypography.medium,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    color: "#1A330E",
    marginBottom: 4,
  },
  routeStopLabelDestination: {
    color: "#4D6575",
  },
  routeStopTitle: {
    ...leafTypography.semiBold,
    fontSize: 15,
    lineHeight: 20,
    flexShrink: 1,
    color: color.text.primary,
  },
  routeStopSubtitle: {
    marginTop: 3,
    ...leafTypography.medium,
    fontSize: 13,
    lineHeight: 17,
    flexShrink: 1,
    color: color.text.secondary,
  },
  routeStopDivider: {
    height: 1,
    backgroundColor: "rgba(68,85,93,0.08)",
    marginVertical: 10,
  },
  preferencePanel: {
    marginTop: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#E5E5E5",
    backgroundColor: "#F7F8F4",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  preferencePanelTitle: {
    ...leafTypography.semiBold,
    fontSize: 13,
    lineHeight: 16,
    color: color.text.primary,
  },
  preferenceChipRow: {
    marginTop: 9,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  preferenceChip: {
    minHeight: 30,
    borderRadius: 15,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "rgba(39,74,54,0.1)",
    gap: 6,
  },
  preferenceChipText: {
    flexShrink: 1,
    ...leafTypography.semiBold,
    fontSize: 11,
    lineHeight: 15,
    color: "#1A330E",
  },
  statusPill: {
    marginTop: 14,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 999,
    backgroundColor: "#F7F8F4",
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  paymentStatusBlock: {
    alignItems: "center",
  },
  statusSecurePaymentBadge: {
    marginTop: 4,
  },
  statusPillText: {
    marginLeft: 6,
    ...leafTypography.semiBold,
    fontSize: 13,
    color: "#6A6A6A",
  },
  tripStatusPill: {
    alignSelf: "stretch",
    justifyContent: "center",
    backgroundColor: "rgba(208,225,236,0.52)",
  },
  tripStatusPillText: {
    color: "#365A6D",
  },
  offerPrimaryButton: {
    marginTop: 18,
    minHeight: leafButtonMetrics.height,
    borderRadius: leafButtonMetrics.radius,
  },
  declineTextButton: {
    marginTop: 12,
    minHeight: leafButtonMetrics.height,
    borderRadius: leafButtonMetrics.radius,
    borderWidth: 1,
    borderColor: "rgba(92,100,107,0.18)",
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  declineText: {
    ...leafTypography.semiBold,
    fontSize: 13,
    lineHeight: 20,
    color: "#5C646B",
  },
  tripSubtitle: {
    marginTop: 8,
    ...leafTypography.medium,
    fontSize: 15,
    lineHeight: 18,
    color: color.text.secondary,
  },
  extensionPanel: {
    marginTop: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(39,74,54,0.12)",
    backgroundColor: "#F7F8F4",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  extensionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  extensionHeaderText: {
    ...leafTypography.semiBold,
    fontSize: 13,
    lineHeight: 22,
    color: color.text.primary,
  },
  extensionDestinationText: {
    marginTop: 8,
    ...leafTypography.semiBold,
    fontSize: 17,
    lineHeight: 22,
    color: color.text.primary,
  },
  extensionMessageText: {
    marginTop: 4,
    ...leafTypography.medium,
    fontSize: 13,
    lineHeight: 18,
    color: color.text.secondary,
  },
  extensionActions: {
    marginTop: 12,
    flexDirection: "row",
    gap: 10,
  },
  extensionSecondaryAction: {
    flex: 1,
    minHeight: leafButtonMetrics.height,
    borderRadius: leafButtonMetrics.radius,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  extensionRejectAction: {
    borderColor: "rgba(92,100,107,0.18)",
    backgroundColor: "#FFFFFF",
  },
  extensionRejectActionText: {
    ...leafTypography.semiBold,
    fontSize: 13,
    color: "#5C646B",
  },
  extensionPrimaryAction: {
    flex: 1.35,
    minHeight: leafButtonMetrics.height,
    borderRadius: leafButtonMetrics.radius,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1A330E",
  },
  extensionPrimaryActionText: {
    ...leafTypography.semiBold,
    fontSize: 13,
    color: "#FFFFFF",
  },
  tripPrimaryButton: {
    marginTop: 14,
  },
  tripSecondaryButton: {
    marginTop: 14,
    backgroundColor: "#274A36",
  },
  tripInterruptButton: {
    marginTop: 10,
    minHeight: leafButtonMetrics.height,
    borderRadius: leafButtonMetrics.radius,
    borderWidth: 1,
    borderColor: "rgba(138,31,43,0.18)",
    backgroundColor: "#FFF4F5",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: leafButtonMetrics.iconGap,
  },
  tripInterruptButtonText: {
    ...leafTypography.semiBold,
    fontSize: 13,
    color: "#8A1F2B",
  },
  tripCancelButton: {
    marginTop: 10,
    minHeight: leafButtonMetrics.height,
    borderRadius: leafButtonMetrics.radius,
    borderWidth: 1,
    borderColor: "rgba(138,31,43,0.18)",
    backgroundColor: "#FFF7F7",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: leafButtonMetrics.iconGap,
  },
  tripCancelButtonText: {
    ...leafTypography.semiBold,
    fontSize: 13,
    color: "#8A1F2B",
  },
  navigationSummaryPressable: {
    borderRadius: 22,
  },
  navigationSummaryTopRow: {
    minHeight: 62,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  navigationPassengerIdentity: {
    flex: 1,
    minWidth: 0,
  },
  navigationMetaCluster: {
    minWidth: 76,
    alignItems: "flex-end",
  },
  navigationModeLabel: {
    ...leafTypography.medium,
    fontSize: 11,
    lineHeight: 14,
    textTransform: "uppercase",
    letterSpacing: 0.7,
    color: "#6B7178",
  },
  navigationMetaPrimary: {
    marginTop: 3,
    ...leafTypography.semiBold,
    fontSize: 17,
    lineHeight: 20,
    color: color.text.primary,
  },
  navigationMetaSecondary: {
    marginTop: 1,
    ...leafTypography.medium,
    fontSize: 13,
    lineHeight: 17,
    color: color.text.secondary,
  },
  navigationExpandButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(244,246,243,0.92)",
    borderWidth: 1,
    borderColor: "rgba(68,85,93,0.08)",
  },
  navigationActionsRow: {
    flexDirection: "row",
    gap: 8,
  },
  compactCard: {
    borderRadius: robotaxiLifecycleMetrics.cardRadius,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
  },
  navigationModeCard: {
    paddingTop: 14,
    backgroundColor:
      Platform.OS === "android" ? "#FFFFFF" : "rgba(255,255,255,0.97)",
  },
  expandedTripCard: {
    borderRadius: robotaxiLifecycleMetrics.cardRadius,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 14,
  },
  expandedTripHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  expandedTripHeaderCopy: {
    flex: 1,
    minWidth: 0,
  },
  expandedTripTitle: {
    ...leafTypography.semiBold,
    fontSize: 20,
    lineHeight: 26,
    color: color.text.primary,
  },
  expandedTripPassenger: {
    marginTop: 4,
    ...leafTypography.medium,
    fontSize: 13,
    lineHeight: 16,
    color: color.text.secondary,
  },
  expandedTripPassengerIdentity: {
    marginTop: 10,
  },
  expandedTripSide: {
    width: 92,
    alignItems: "flex-end",
  },
  expandedTripFareLabel: {
    ...leafTypography.semiBold,
    fontSize: 11,
    lineHeight: 14,
    textTransform: "uppercase",
    letterSpacing: 0.9,
    color: "#767676",
  },
  expandedTripFareValue: {
    marginTop: 2,
    ...leafTypography.semiBold,
    fontSize: 15,
    lineHeight: 18,
    color: "#222222",
  },
  expandedCollapseButton: {
    marginTop: 8,
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(244,246,243,0.94)",
    borderWidth: 1,
    borderColor: "rgba(68,85,93,0.08)",
  },
  expandedMetricRow: {
    marginTop: 12,
    flexDirection: "row",
    gap: 8,
  },
  expandedMetricPill: {
    flex: 1,
    minWidth: 0,
    minHeight: 72,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E5E5E5",
    backgroundColor: "#F7F8F4",
    paddingHorizontal: 9,
    paddingVertical: 8,
  },
  expandedMetricIconWrap: {
    width: 26,
    height: 26,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  expandedMetricLabel: {
    ...leafTypography.medium,
    fontSize: 11,
    lineHeight: 14,
    textTransform: "uppercase",
    color: "#6B7178",
    letterSpacing: 0.7,
  },
  expandedMetricValue: {
    marginTop: 2,
    ...leafTypography.semiBold,
    fontSize: 15,
    lineHeight: 20,
    color: color.text.primary,
  },
  expandedRoutePanel: {
    marginTop: 10,
    minHeight: 62,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#E5E5E5",
    backgroundColor: "#F7F8F4",
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  expandedRouteStop: {
    flex: 1,
    minWidth: 0,
  },
  expandedRouteLabel: {
    ...leafTypography.medium,
    fontSize: 11,
    lineHeight: 14,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    color: "#1A330E",
  },
  expandedRouteLabelDestination: {
    color: "#4D6575",
  },
  expandedRouteTitle: {
    marginTop: 4,
    ...leafTypography.semiBold,
    fontSize: 13,
    lineHeight: 16,
    color: color.text.primary,
  },
  expandedRouteArrow: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(244,246,243,0.96)",
    borderWidth: 1,
    borderColor: "rgba(68,85,93,0.08)",
  },
  expandedStatusPill: {
    marginTop: 10,
    minHeight: 34,
    borderRadius: 17,
    paddingHorizontal: 12,
    backgroundColor: "rgba(208,225,236,0.52)",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  expandedStatusText: {
    flex: 1,
    ...leafTypography.semiBold,
    fontSize: 13,
    color: "#365A6D",
  },
  compactSummaryPressable: {
    gap: 9,
  },
  compactPassengerIdentity: {
    marginTop: 12,
  },
  compactHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  compactHeaderCopy: {
    flex: 1,
  },
  compactTitle: {
    ...leafTypography.semiBold,
    fontSize: 17,
    lineHeight: 21,
    color: color.text.primary,
  },
  compactSubtitle: {
    marginTop: 4,
    ...leafTypography.medium,
    fontSize: 13,
    lineHeight: 17,
    color: color.text.secondary,
  },
  compactChevronWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(244,246,243,0.92)",
    borderWidth: 1,
    borderColor: "rgba(68,85,93,0.08)",
  },
  compactRoutePreviewRow: {
    flexDirection: "row",
    gap: 8,
  },
  compactRoutePreviewCard: {
    flex: 1,
    minWidth: 0,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E5E5E5",
    backgroundColor: "#F7F8F4",
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  compactRoutePreviewLabel: {
    ...leafTypography.medium,
    fontSize: 11,
    lineHeight: 13,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    color: "#6B7178",
  },
  compactRoutePreviewValue: {
    marginTop: 4,
    ...leafTypography.semiBold,
    fontSize: 13,
    lineHeight: 17,
    color: color.text.primary,
  },
  compactMetricRow: {
    flexDirection: "row",
    gap: 8,
  },
  compactMetricPill: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: "#E5E5E5",
    backgroundColor: "#F7F8F4",
    paddingHorizontal: 9,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
  },
  compactMetricIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
  },
  compactMetricCopy: {
    flex: 1,
    minWidth: 0,
  },
  compactMetricLabel: {
    ...leafTypography.medium,
    fontSize: 11,
    textTransform: "uppercase",
    color: "#6B7178",
    marginBottom: 2,
    letterSpacing: 0.8,
  },
  compactMetricValue: {
    ...leafTypography.semiBold,
    fontSize: 15,
    lineHeight: 20,
    color: color.text.primary,
  },
  compactActionsRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  compactActionsGroup: {
    marginTop: 10,
  },
  compactActionButton: {
    flex: 1,
    minWidth: 0,
    minHeight: leafButtonMetrics.height,
    borderRadius: leafButtonMetrics.radius,
    borderWidth: 1,
    borderColor: "rgba(39,74,54,0.14)",
    backgroundColor: "#F7F8F4",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: leafButtonMetrics.iconGap,
    paddingHorizontal: 8,
  },
  compactActionButtonIconOnly: {
    flex: 0,
    width: leafButtonMetrics.height,
    minWidth: leafButtonMetrics.height,
    maxWidth: leafButtonMetrics.height,
    gap: 0,
    paddingHorizontal: 0,
  },
  compactActionButtonPrimary: {
    backgroundColor: "#1A330E",
    borderColor: "#1A330E",
  },
  compactActionButtonDanger: {
    backgroundColor: "#FFF4F5",
    borderColor: "rgba(138,31,43,0.18)",
  },
  compactActionButtonDisabled: {
    opacity: 0.54,
  },
  compactActionButtonText: {
    ...leafTypography.semiBold,
    fontSize: 13,
    lineHeight: 17,
    color: "#274A36",
  },
  compactActionButtonTextPrimary: {
    color: "#FFFFFF",
  },
  compactActionButtonTextDanger: {
    color: "#8A1F2B",
  },
  collapseControl: {
    alignSelf: "flex-end",
    marginBottom: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(244,246,243,0.94)",
    borderWidth: 1,
    borderColor: "rgba(68,85,93,0.08)",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  collapseControlText: {
    ...leafTypography.semiBold,
    fontSize: 13,
    color: color.text.secondary,
  },
  cancelPromptScrim: {
    flex: 1,
    backgroundColor: "rgba(14,24,20,0.42)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  cancelPromptCard: {
    width: "100%",
    maxWidth: 360,
    borderRadius: 26,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.76)",
    paddingHorizontal: 20,
    paddingVertical: 20,
    shadowColor: "#183026",
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.22,
    shadowRadius: 28,
    elevation: 18,
  },
  cancelPromptTitle: {
    ...leafTypography.semiBold,
    fontSize: 20,
    lineHeight: 25,
    color: color.text.primary,
  },
  cancelPromptMessage: {
    marginTop: 8,
    ...leafTypography.medium,
    fontSize: 15,
    lineHeight: 20,
    color: color.text.secondary,
  },
  cancelPromptActions: {
    marginTop: 18,
    flexDirection: "row",
    gap: 10,
  },
  cancelPromptYesButton: {
    flex: 1,
    minHeight: leafButtonMetrics.height,
    borderRadius: leafButtonMetrics.radius,
    borderWidth: 1,
    borderColor: "rgba(138,31,43,0.22)",
    backgroundColor: "#FFF7F7",
    alignItems: "center",
    justifyContent: "center",
  },
  cancelPromptYesText: {
    ...leafTypography.semiBold,
    fontSize: 15,
    color: "#8A1F2B",
  },
  cancelPromptNoButton: {
    flex: 1.2,
    minHeight: leafButtonMetrics.height,
    borderRadius: leafButtonMetrics.radius,
    backgroundColor: "#1A330E",
    alignItems: "center",
    justifyContent: "center",
  },
  cancelPromptNoText: {
    ...leafTypography.semiBold,
    fontSize: 15,
    color: "#FFFFFF",
  },
});
