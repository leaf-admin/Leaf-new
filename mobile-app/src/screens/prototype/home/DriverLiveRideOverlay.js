import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import robotaxiPrototypeTokens from "../../../components/design-system/robotaxiPrototypeTokens";
import {
  PrototypeCard,
  PrototypePrimaryButton,
} from "../../../components/prototype/PrototypeUI";
import {
  LeafAnimatedPressable,
  LeafPersonIdentity,
  LeafStateHeader,
  leafButtonMetrics,
} from "../../../components/prototype/LeafRideUI";
import SecurePaymentBadge from "../../../components/payment/SecurePaymentBadge";
import { fonts } from "../../../theme/runtimeTokens";
import {
  getDriverOfferPayoutLabel,
  selectDisplayableDriverOffer,
} from "../driverOfferPricingSnapshot";

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

function formatDistanceKm(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "--";
  }
  return formatDistanceMeters(numeric * 1000);
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

function resolveOffer(driverOffers = []) {
  return selectDisplayableDriverOffer(driverOffers);
}

function resolveTripPhase(activeRide, bookingStatus) {
  const normalizedStatus = String(bookingStatus || activeRide?.status || "")
    .trim()
    .toLowerCase();

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

function isCompactTripStatus(status) {
  const normalizedStatus = String(status || "")
    .trim()
    .toLowerCase();

  return (
    normalizedStatus === "accepted" ||
    normalizedStatus === "arrived" ||
    normalizedStatus === "started"
  );
}

function isCompetitiveAcceptLossMessage(message) {
  return String(message || "")
    .trim()
    .toLowerCase()
    .includes("outro motorista aceitou");
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
  acceptDriverOffer,
  rejectDriverOffer,
  respondToDriverExtension,
  interruptRideOperationalFlow,
  cancelActiveRideFlow,
  markDriverArrived,
  startTripFlow,
  completeTripFlow,
  onOpenNavigation,
  onTripCompletedSuccess,
  nativeNavigationVisible = false,
}) {
  const [busyAction, setBusyAction] = useState("");
  const [isTripExpanded, setIsTripExpanded] = useState(false);
  const [showCancelPrompt, setShowCancelPrompt] = useState(false);
  const { height: windowHeight } = useWindowDimensions();
  const safeBottom = Math.max(0, Number(insetsBottom) || 0);
  const activeRide = useMemo(() => {
    if (driverActiveRide?.bookingId || driverActiveRide?.id) {
      return driverActiveRide;
    }
    return null;
  }, [driverActiveRide]);
  const offer = useMemo(() => resolveOffer(driverOffers), [driverOffers]);
  const hasActiveRide = Boolean(activeRide);
  const hasOffer = Boolean(!hasActiveRide && (offer?.bookingId || offer?.id));
  const tripPhase = useMemo(
    () => resolveTripPhase(activeRide, bookingStatus),
    [activeRide, bookingStatus],
  );

  const handleAcceptOffer = useCallback(async () => {
    if (!offer || busyAction) {
      return;
    }

    try {
      setBusyAction("accept");
      await acceptDriverOffer(offer);
    } catch (error) {
      if (isCompetitiveAcceptLossMessage(error?.message || error)) {
        return;
      }
      Alert.alert(
        "Não foi possível aceitar",
        error?.message || "Falha ao aceitar corrida.",
      );
    } finally {
      setBusyAction("");
    }
  }, [acceptDriverOffer, busyAction, offer]);

  const handleRejectOffer = useCallback(async () => {
    if (!offer || busyAction) {
      return;
    }

    try {
      setBusyAction("reject");
      await rejectDriverOffer(offer, "Recusada pelo motorista.");
    } catch (error) {
      Alert.alert(
        "Não foi possível recusar",
        error?.message || "Falha ao recusar corrida.",
      );
    } finally {
      setBusyAction("");
    }
  }, [busyAction, offer, rejectDriverOffer]);

  const handleTripPrimaryAction = useCallback(async () => {
    if (!activeRide || busyAction) {
      return;
    }

    const normalizedStatus = String(bookingStatus || activeRide?.status || "")
      .trim()
      .toLowerCase();

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
        const result = await completeTripFlow();
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
    markDriverArrived,
    onTripCompletedSuccess,
    startTripFlow,
  ]);

  const pickupLabel =
    String(
      activeRide?.pickup ||
        activeRide?.pickupAddress ||
        offer?.pickup ||
        offer?.pickupAddress ||
        "",
    ).trim() || "Origem indisponível";
  const dropoffLabel =
    String(
      activeRide?.dropoff ||
        activeRide?.dropoffAddress ||
        offer?.dropoff ||
        offer?.dropoffAddress ||
        "",
    ).trim() || "Destino indisponível";
  const activeRideNetAmount = resolveDisplayNetAmount(activeRide, driverTripMeta);
  const fareLabel = hasActiveRide
    ? Number.isFinite(activeRideNetAmount)
      ? formatCurrency(activeRideNetAmount)
      : "--"
    : getDriverOfferPayoutLabel(offer) || "--";
  const passengerLabel = String(
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
  const distanceLabel = formatDistanceKm(offer?.distanceKm ?? tripDistanceKm);
  const offerPickupEtaLabel =
    resolveFirstUsableLabel(
      formatDurationMinutes(
        offer?.pickupEtaMin || offer?.pickupDurationMin || offer?.etaMin,
        "",
      ),
      etaLabel,
    ) || "--";
  const offerTripDurationLabel = formatDurationMinutes(
    offer?.tripDurationMin || offer?.durationMin || offer?.durationMinutes,
    "--",
  );
  const activeDistanceLabel = formatDistanceKm(
    activeRide?.distanceKm ?? tripDistanceKm,
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
  const normalizedActiveStatus = String(
    bookingStatus || activeRide?.status || "",
  )
    .trim()
    .toLowerCase();
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
      (isCompactTripStatus(normalizedActiveStatus) &&
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
        label: "Tempo",
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
    ],
    [fareLabel, liveDistanceLabel, liveEtaLabel],
  );
  const compactTripMetrics = useMemo(
    () => activeTripMetrics.filter((metric) => metric.key !== "net"),
    [activeTripMetrics],
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
        : "Local combinado";
  const tripStatusMessage =
    ["accepted", "started"].includes(normalizedActiveStatus)
      ? ""
      : driverTripAssist?.subtitle || tripPhase.subtitle;

  useEffect(() => {
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

  const handleConfirmCancelRide = useCallback(async () => {
    if (!canCancelActiveRide || busyAction) {
      return;
    }

    try {
      setShowCancelPrompt(false);
      setBusyAction("cancel");
      await cancelActiveRideFlow({
        reason: "Cancelado pelo motorista.",
      });
    } catch (error) {
      Alert.alert(
        "Não foi possível cancelar",
        error?.message || "Falha ao cancelar a corrida.",
      );
    } finally {
      setBusyAction("");
    }
  }, [busyAction, canCancelActiveRide, cancelActiveRideFlow]);

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
  }) => {
    const shouldShowLabel = variant === "primary";

    return (
      <LeafAnimatedPressable
        activeScale={variant === "primary" ? 0.984 : 0.978}
        style={[
          styles.compactActionButton,
          variant === "primary" && styles.compactActionButtonPrimary,
          variant === "danger" && styles.compactActionButtonDanger,
          disabled && styles.compactActionButtonDisabled,
          !shouldShowLabel && styles.compactActionButtonIconOnly,
        ]}
        onPress={onPress}
        disabled={disabled}
        testID={testID}
        accessibilityLabel={accessibilityLabel || label}
      >
        <Ionicons
          name={icon}
          size={leafButtonMetrics.iconSize}
          color={
            variant === "primary"
              ? "#FFFFFF"
              : variant === "danger"
                ? "#8A1F2B"
                : "#274A36"
          }
        />
        {shouldShowLabel ? (
          <Text
            style={[
              styles.compactActionButtonText,
              styles.compactActionButtonTextPrimary,
            ]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.82}
          >
            {label}
          </Text>
        ) : null}
      </LeafAnimatedPressable>
    );
  };

  const renderNavigationTripCard = () => (
    <>
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={() => setIsTripExpanded(true)}
        style={styles.navigationSummaryPressable}
        testID="driver-live-trip-compact-summary"
        accessibilityLabel="driver-live-trip-compact-summary"
      >
        <View style={styles.navigationSummaryTopRow}>
          <LeafPersonIdentity
            compact
            initial={passengerInitial}
            photoUri={passengerPhotoUri}
            name={passengerLabel}
            meta={passengerMetaLabel}
            style={styles.navigationPassengerIdentity}
            testID="driver-live-passenger-identity"
          />

          <View style={styles.navigationMetaCluster}>
            <Text style={styles.navigationModeLabel} numberOfLines={1}>
              {navigationModeLabel}
            </Text>
            <Text
              style={styles.navigationMetaPrimary}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
            >
              {liveEtaLabel}
            </Text>
            <Text style={styles.navigationMetaSecondary} numberOfLines={1}>
              {liveDistanceLabel}
            </Text>
          </View>

          <View style={styles.navigationExpandButton}>
            <Ionicons
              name="chevron-up-outline"
              size={18}
              color={color.text.secondary}
            />
          </View>
        </View>
      </TouchableOpacity>

      <View style={styles.compactActionsGroup}>
        <View style={styles.navigationActionsRow}>
          {canCancelActiveRide
            ? renderCompactActionButton({
                label: busyAction === "cancel" ? "Cancelando" : "Cancelar",
                icon: "close-circle-outline",
                onPress: handleOpenCancelPrompt,
                disabled: busyAction === "cancel",
                variant: "danger",
                testID: "driver-live-trip-cancel-button",
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
                    : normalizedActiveStatus === "arrived"
                      ? "play-outline"
                      : "checkmark-circle-outline",
                disabled: busyAction === "trip" || !primaryActionEnabled,
                onPress: handleTripPrimaryAction,
                variant: "primary",
                testID: primaryActionTestID,
                accessibilityLabel:
                  busyAction === "trip" ? "Atualizando..." : primaryActionLabel,
              })
            : null}
        </View>
      </View>
    </>
  );

  const renderCompactTripCard = () => (
    <>
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={() => setIsTripExpanded(true)}
        style={styles.compactSummaryPressable}
        testID="driver-live-trip-compact-summary"
        accessibilityLabel="driver-live-trip-compact-summary"
      >
        <View style={styles.compactHeaderRow}>
          <View style={styles.compactHeaderCopy}>
            <Text style={styles.compactTitle} numberOfLines={2}>
              {driverTripSheetTitle}
            </Text>
          </View>

          <View style={styles.compactChevronWrap}>
            <Ionicons
              name="chevron-up-outline"
              size={18}
              color={color.text.secondary}
            />
          </View>
        </View>

        <LeafPersonIdentity
          compact
          initial={passengerInitial}
          photoUri={passengerPhotoUri}
          name={passengerLabel}
          meta={passengerMetaLabel}
          style={styles.compactPassengerIdentity}
          testID="driver-live-passenger-identity"
        />

        <View style={styles.compactMetricRow}>
          {compactTripMetrics.map((metric) => (
            <View key={metric.key} style={styles.compactMetricPill}>
              <View style={[styles.compactMetricIconWrap, metric.toneStyle]}>
                <Ionicons
                  name={metric.icon}
                  size={14}
                  color={metric.iconColor}
                />
              </View>
              <View style={styles.compactMetricCopy}>
                <Text style={styles.compactMetricLabel}>{metric.label}</Text>
                <Text style={styles.compactMetricValue} numberOfLines={2}>
                  {metric.value}
                </Text>
              </View>
            </View>
          ))}
        </View>
      </TouchableOpacity>

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
                testID: "driver-live-trip-cancel-button",
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
                  busyAction === "trip" ? "Atualizando..." : primaryActionLabel,
              })
            : null}
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
            meta={normalizedActiveStatus === "started" ? "A bordo" : "Local combinado"}
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
            accessibilityLabel="driver-live-trip-collapse-button"
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
                  busyAction === "trip" ? "Atualizando..." : primaryActionLabel,
              })
            : null}
        </View>
      </View>
    </>
  );

  const cardBottomPadding =
    (shouldUseCompactTripCard
      ? isTripExpanded
        ? 14
        : 12
      : 16) + safeBottom;

  return (
    <>
      {!isDriverNavigationMode ? (
        <LeafStateHeader
          title={driverIslandTitle}
          subtitle={driverIslandSubtitle}
          rightLabel={driverIslandRightLabel}
          rightTone={hasOffer || normalizedActiveStatus === "started" ? "dark" : "leaf"}
          insetsTop={insetsTop}
        />
      ) : null}
      <View
        pointerEvents="box-none"
        onLayout={onCardLayout}
        style={[styles.wrap, { bottom: bottomOffset }]}
      >
        <PrototypeCard
          style={[
            styles.card,
            shouldUseCompactTripCard && !isTripExpanded
              ? [
                  styles.compactCard,
                  isDriverNavigationMode && styles.navigationModeCard,
                ]
              : shouldUseCompactTripCard
                ? styles.expandedTripCard
                : { maxHeight: maxCardHeight },
            { paddingBottom: cardBottomPadding },
          ]}
        >
        {shouldUseCompactTripCard && !isTripExpanded ? (
          isDriverNavigationMode ? renderNavigationTripCard() : renderCompactTripCard()
        ) : shouldUseCompactTripCard ? (
          renderExpandedTripCard()
        ) : (
          <ScrollView
            bounces={false}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
          >
          {hasOffer ? (
            <>
              <View style={styles.headerRow}>
                <View style={styles.headerCopy}>
                  <Text style={styles.eyebrow}>
                    {isContinuationOffer ? "Continuidade" : "Detalhes"}
                  </Text>
                  <Text style={styles.title}>
                    {isContinuationOffer
                      ? "Retomar corrida"
                      : "Detalhes da corrida"}
                  </Text>
                  <LeafPersonIdentity
                    compact
                    initial={passengerInitial}
                    photoUri={passengerPhotoUri}
                    name={passengerLabel}
                    meta="Local combinado"
                    style={styles.headerPassengerIdentity}
                    testID="driver-live-passenger-identity"
                  />
                </View>
                <View style={styles.fareBadge}>
                  <Text style={styles.fareBadgeLabel}>Líquido</Text>
                  <Text style={styles.fareBadgeValue}>{fareLabel}</Text>
                </View>
              </View>

              <View style={styles.offerMetaStrip}>
                <View style={styles.offerMetaItem}>
                  <Text style={styles.offerMetaLabel}>Embarque</Text>
                  <Text style={styles.offerMetaValue} numberOfLines={1}>
                    {offerPickupEtaLabel}
                  </Text>
                </View>
                <View style={styles.offerMetaItem}>
                  <Text style={styles.offerMetaLabel}>Distância</Text>
                  <Text style={styles.offerMetaValue} numberOfLines={1}>
                    {distanceLabel}
                  </Text>
                </View>
                <View style={styles.offerMetaItem}>
                  <Text style={styles.offerMetaLabel}>Viagem</Text>
                  <Text style={styles.offerMetaValue} numberOfLines={1}>
                    {offerTripDurationLabel}
                  </Text>
                </View>
              </View>

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

              {ridePreferenceItems.length > 0 ? (
                <View
                  style={styles.preferencePanel}
                  testID="driver-live-offer-preferences"
                  accessibilityLabel="Preferências do passageiro"
                >
                  <Text style={styles.preferencePanelTitle}>
                    Preferências do passageiro
                  </Text>
                  <View style={styles.preferenceChipRow}>
                    {ridePreferenceItems.map((item) => (
                      <View key={item.key} style={styles.preferenceChip}>
                        <Ionicons name={item.icon} size={14} color="#1A330E" />
                        <Text style={styles.preferenceChipText} numberOfLines={1}>
                          {item.label}
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}

              <View style={styles.paymentStatusBlock}>
                <View style={styles.statusPill}>
                  <Ionicons
                    name="checkmark-circle-outline"
                    size={16}
                    color="#6C651B"
                  />
                  <Text style={styles.statusPillText}>{paymentLabel}</Text>
                </View>
                {isPixPayment ? (
                  <SecurePaymentBadge style={styles.statusSecurePaymentBadge} color="#6E7D72" />
                ) : null}
              </View>

              <PrototypePrimaryButton
                label={
                  busyAction === "accept" ? "Aceitando..." : "Aceitar corrida"
                }
                icon="chevron-forward"
                style={styles.offerPrimaryButton}
                testID="driver-live-offer-accept-button"
                accessibilityLabel={
                  busyAction === "accept" ? "Aceitando..." : "Aceitar corrida"
                }
                onPress={handleAcceptOffer}
              />

              <TouchableOpacity
                activeOpacity={0.78}
                onPress={handleRejectOffer}
                disabled={busyAction === "accept" || busyAction === "reject"}
                style={styles.declineTextButton}
                testID="driver-live-offer-reject-button"
                accessibilityLabel="driver-live-offer-reject-button"
              >
                <Text style={styles.declineText}>
                  {busyAction === "reject" ? "Recusando..." : "Recusar"}
                </Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              {shouldUseCompactTripCard ? (
                <TouchableOpacity
                  activeOpacity={0.82}
                  onPress={() => setIsTripExpanded(false)}
                  style={styles.collapseControl}
                  testID="driver-live-trip-collapse-button"
                  accessibilityLabel="driver-live-trip-collapse-button"
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
                  <Text style={styles.title}>{driverTripSheetTitle}</Text>
                  <LeafPersonIdentity
                    compact
                    initial={passengerInitial}
                    photoUri={passengerPhotoUri}
                    name={passengerLabel}
                    meta={normalizedActiveStatus === "started" ? "A bordo" : "Local combinado"}
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
                      ? `Complemento do passageiro: ${formatCurrency(driverExtensionRequest?.diffFare)}`
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
                        accessibilityLabel="driver-live-extension-reject-button"
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
                        accessibilityLabel="driver-live-extension-accept-button"
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
                      <Text style={styles.metricValue}>{metric.value}</Text>
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
                      ? "Atualizando..."
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
                    busyAction === "trip" ? "Atualizando..." : primaryActionLabel
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
                  accessibilityLabel="driver-live-trip-interrupt-button"
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
        </PrototypeCard>
      </View>

      <Modal
        transparent
        visible={showCancelPrompt}
        animationType="fade"
        onRequestClose={() => setShowCancelPrompt(false)}
      >
        <View style={styles.cancelPromptScrim}>
          <View style={styles.cancelPromptCard}>
            <Text style={styles.cancelPromptTitle}>Cancelar corrida?</Text>
            <Text style={styles.cancelPromptMessage}>
              Ao cancelar a corrida cobranças podem ser aplicadas, deseja cancelar?
            </Text>
            <View style={styles.cancelPromptActions}>
              <TouchableOpacity
                activeOpacity={0.82}
                style={styles.cancelPromptYesButton}
                onPress={handleConfirmCancelRide}
                testID="driver-live-trip-cancel-confirm-button"
                accessibilityLabel="Sim"
              >
                <Text style={styles.cancelPromptYesText}>Sim</Text>
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.86}
                style={styles.cancelPromptNoButton}
                onPress={() => setShowCancelPrompt(false)}
                testID="driver-live-trip-cancel-dismiss-button"
                accessibilityLabel="Não"
              >
                <Text style={styles.cancelPromptNoText}>Não</Text>
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
  wrap: {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 18,
  },
  card: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 16,
    backgroundColor: Platform.OS === "android" ? "#FFFFFF" : "rgba(255,255,255,0.96)",
    borderColor: "#ECE5DC",
    shadowOpacity: 0.1,
  },
  scrollContent: {
    paddingBottom: 2,
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
    fontFamily: fonts.Medium,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    color: "#1A330E",
    marginBottom: 6,
  },
  title: {
    fontFamily: fonts.SemiBold,
    fontSize: 20,
    lineHeight: 25,
    color: color.text.primary,
  },
  passengerCaption: {
    marginTop: 6,
    fontFamily: fonts.Medium,
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
    fontFamily: fonts.Medium,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    color: "#53634D",
    marginBottom: 4,
  },
  fareBadgeValue: {
    fontFamily: fonts.SemiBold,
    fontSize: 17,
    color: "#1A330E",
  },
  offerMetaStrip: {
    marginTop: 14,
    minHeight: 58,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: "rgba(91,105,86,0.13)",
    flexDirection: "row",
    alignItems: "center",
  },
  offerMetaItem: {
    flex: 1,
    minWidth: 0,
    paddingRight: 10,
  },
  offerMetaLabel: {
    fontFamily: fonts.Medium,
    fontSize: 10,
    lineHeight: 14,
    textTransform: "uppercase",
    letterSpacing: 0.9,
    color: "#6B7178",
  },
  offerMetaValue: {
    marginTop: 3,
    fontFamily: fonts.SemiBold,
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
    borderColor: "#E9E2D8",
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
    fontFamily: fonts.Medium,
    fontSize: 11,
    textTransform: "uppercase",
    color: "#6B7178",
    marginBottom: 4,
  },
  metricValue: {
    fontFamily: fonts.SemiBold,
    fontSize: 16,
    color: color.text.primary,
  },
  routePanel: {
    marginTop: 14,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "#E9E2D8",
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
    fontFamily: fonts.Medium,
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
    fontFamily: fonts.SemiBold,
    fontSize: 15,
    lineHeight: 20,
    flexShrink: 1,
    color: color.text.primary,
  },
  routeStopSubtitle: {
    marginTop: 3,
    fontFamily: fonts.Medium,
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
    borderColor: "#E9E2D8",
    backgroundColor: "#F7F8F4",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  preferencePanelTitle: {
    fontFamily: fonts.SemiBold,
    fontSize: 12,
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
    fontFamily: fonts.SemiBold,
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
    fontFamily: fonts.SemiBold,
    fontSize: 13,
    color: "#756F68",
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
    fontFamily: fonts.SemiBold,
    fontSize: 13,
    lineHeight: 17,
    color: "#5C646B",
  },
  tripSubtitle: {
    marginTop: 8,
    fontFamily: fonts.Medium,
    fontSize: 14,
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
    fontFamily: fonts.SemiBold,
    fontSize: 13,
    lineHeight: 17,
    color: color.text.primary,
  },
  extensionDestinationText: {
    marginTop: 8,
    fontFamily: fonts.SemiBold,
    fontSize: 16,
    lineHeight: 20,
    color: color.text.primary,
  },
  extensionMessageText: {
    marginTop: 4,
    fontFamily: fonts.Medium,
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
    fontFamily: fonts.SemiBold,
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
    fontFamily: fonts.SemiBold,
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
    fontFamily: fonts.SemiBold,
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
    fontFamily: fonts.SemiBold,
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
    fontFamily: fonts.Medium,
    fontSize: 10,
    lineHeight: 12,
    textTransform: "uppercase",
    letterSpacing: 0.7,
    color: "#6B7178",
  },
  navigationMetaPrimary: {
    marginTop: 3,
    fontFamily: fonts.SemiBold,
    fontSize: 17,
    lineHeight: 20,
    color: color.text.primary,
  },
  navigationMetaSecondary: {
    marginTop: 1,
    fontFamily: fonts.Medium,
    fontSize: 12,
    lineHeight: 15,
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
    borderRadius: 28,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
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
    borderRadius: 28,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
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
    fontFamily: fonts.SemiBold,
    fontSize: 18,
    lineHeight: 22,
    color: color.text.primary,
  },
  expandedTripPassenger: {
    marginTop: 4,
    fontFamily: fonts.Medium,
    fontSize: 12,
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
    fontFamily: fonts.SemiBold,
    fontSize: 10,
    lineHeight: 12,
    textTransform: "uppercase",
    letterSpacing: 0.9,
    color: "#827B73",
  },
  expandedTripFareValue: {
    marginTop: 2,
    fontFamily: fonts.SemiBold,
    fontSize: 15,
    lineHeight: 18,
    color: "#171412",
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
    borderColor: "#E9E2D8",
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
    fontFamily: fonts.Medium,
    fontSize: 9,
    lineHeight: 11,
    textTransform: "uppercase",
    color: "#6B7178",
    letterSpacing: 0.7,
  },
  expandedMetricValue: {
    marginTop: 2,
    fontFamily: fonts.SemiBold,
    fontSize: 14,
    lineHeight: 17,
    color: color.text.primary,
  },
  expandedRoutePanel: {
    marginTop: 10,
    minHeight: 62,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#E9E2D8",
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
    fontFamily: fonts.Medium,
    fontSize: 9,
    lineHeight: 11,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    color: "#1A330E",
  },
  expandedRouteLabelDestination: {
    color: "#4D6575",
  },
  expandedRouteTitle: {
    marginTop: 4,
    fontFamily: fonts.SemiBold,
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
    fontFamily: fonts.SemiBold,
    fontSize: 12,
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
    fontFamily: fonts.SemiBold,
    fontSize: 17,
    lineHeight: 21,
    color: color.text.primary,
  },
  compactSubtitle: {
    marginTop: 4,
    fontFamily: fonts.Medium,
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
    borderColor: "#E9E2D8",
    backgroundColor: "#F7F8F4",
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  compactRoutePreviewLabel: {
    fontFamily: fonts.Medium,
    fontSize: 10,
    lineHeight: 13,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    color: "#6B7178",
  },
  compactRoutePreviewValue: {
    marginTop: 4,
    fontFamily: fonts.SemiBold,
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
    borderColor: "#E9E2D8",
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
    fontFamily: fonts.Medium,
    fontSize: 10,
    textTransform: "uppercase",
    color: "#6B7178",
    marginBottom: 2,
    letterSpacing: 0.8,
  },
  compactMetricValue: {
    fontFamily: fonts.SemiBold,
    fontSize: 14,
    lineHeight: 16,
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
    fontFamily: fonts.SemiBold,
    fontSize: 12,
    lineHeight: 15,
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
    fontFamily: fonts.SemiBold,
    fontSize: 12,
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
    fontFamily: fonts.SemiBold,
    fontSize: 20,
    lineHeight: 25,
    color: color.text.primary,
  },
  cancelPromptMessage: {
    marginTop: 8,
    fontFamily: fonts.Medium,
    fontSize: 14,
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
    fontFamily: fonts.SemiBold,
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
    fontFamily: fonts.SemiBold,
    fontSize: 15,
    color: "#FFFFFF",
  },
});
