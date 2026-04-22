import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
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

function resolveDisplayNetAmount(activeRide, driverTripMeta) {
  const preferredPositiveAmount =
    [
      activeRide?.driverNetAmountLocked,
      activeRide?.lockedDriverNetAmount,
      activeRide?.estimatedDriverNetAmount,
      activeRide?.driverNetAmount,
      driverTripMeta?.fare,
      activeRide?.fare,
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
      driverTripMeta?.fare,
      activeRide?.fare,
    ].find((value) => Number.isFinite(Number(value))) ?? 0;

  return Number(firstKnownAmount || 0);
}

function formatDistanceKm(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "Em cálculo";
  }
  const fractionDigits = numeric >= 10 ? 0 : numeric >= 2 ? 1 : 2;
  return `${numeric.toFixed(fractionDigits).replace(".", ",")} km`;
}

function formatPaymentMethod(method, compact = false) {
  const normalized = String(method || "")
    .trim()
    .toLowerCase();
  if (normalized === "pix") {
    return compact ? "PIX" : "PIX confirmado";
  }
  if (
    normalized === "card" ||
    normalized === "cartao" ||
    normalized === "cartão"
  ) {
    return compact ? "Cartão" : "Cartão confirmado";
  }
  return compact ? "Pagamento" : "Pagamento confirmado";
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
      chip: "Aguardando",
      title: "Passageiro em embarque",
      subtitle: "Quando o passageiro entrar, inicie a corrida por aqui.",
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
      title: "Aguardando decisão do passageiro",
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

  return normalizedStatus === "accepted" || normalizedStatus === "started";
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
  markDriverArrived,
  startTripFlow,
  completeTripFlow,
  onOpenNavigation,
  onTripCompletedSuccess,
}) {
  const [busyAction, setBusyAction] = useState("");
  const [isTripExpanded, setIsTripExpanded] = useState(false);
  const { height: windowHeight } = useWindowDimensions();
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
  const fareLabel = hasActiveRide
    ? formatCurrency(resolveDisplayNetAmount(activeRide, driverTripMeta))
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
  const etaLabel = String(offer?.eta || "").trim();
  const distanceLabel = formatDistanceKm(offer?.distanceKm ?? tripDistanceKm);
  const activeDistanceLabel = formatDistanceKm(
    activeRide?.distanceKm ?? tripDistanceKm,
  );
  const pickupLocation = splitLocationLabel(pickupLabel);
  const dropoffLocation = splitLocationLabel(dropoffLabel);
  const paymentLabel = formatPaymentMethod(paymentMethod);
  const isContinuationOffer = Boolean(offer?.isOperationalContinuation);
  const maxCardHeight = Math.max(
    352,
    windowHeight - insetsTop - insetsBottom - bottomOffset - 84,
  );
  const normalizedActiveStatus = String(
    bookingStatus || activeRide?.status || "",
  )
    .trim()
    .toLowerCase();
  const normalizedExtensionStatus = String(driverExtensionRequest?.status || "")
    .trim()
    .toLowerCase();
  const liveDistanceLabel =
    driverTripAssist?.remainingDistanceLabel || activeDistanceLabel;
  const liveEtaLabel =
    driverTripAssist?.etaLabel ||
    (normalizedActiveStatus === "arrived" ? "2:00" : etaLabel || "Em cálculo");
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
  const showCompactNavigationButton = Boolean(
    showNavigationButton &&
      ["accepted", "started"].includes(normalizedActiveStatus),
  );
  const canInterruptOperational =
    typeof interruptRideOperationalFlow === "function" &&
    normalizedActiveStatus === "started";
  const showCompactProblemButton = Boolean(
    normalizedActiveStatus === "started" && canInterruptOperational,
  );
  const shouldStackCompactPrimaryAction = Boolean(
    showCompactNavigationButton && showCompactProblemButton,
  );
  const hasPendingExtensionDecision = [
    "driver_decision_pending",
    "pending_payment",
  ].includes(normalizedExtensionStatus);
  const shouldUseCompactTripCard =
    hasActiveRide &&
    isCompactTripStatus(normalizedActiveStatus) &&
    !hasPendingExtensionDecision;
  const activeTripTitle =
    normalizedActiveStatus === "accepted"
      ? `Dirija até o local de embarque de ${passengerLabel}`
      : normalizedActiveStatus === "started"
        ? "Viagem em andamento"
        : tripPhase.title;
  const activeTripSubtitle =
    normalizedActiveStatus === "accepted"
      ? "Mantenha o mapa visível, acompanhe a aproximação e confirme ao chegar."
      : normalizedActiveStatus === "started"
        ? "A rota continua no mapa enquanto você segue com a navegação externa."
        : tripPhase.subtitle;
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
        iconColor: "#1A7A3E",
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

  if (!hasActiveRide && !hasOffer) {
    return null;
  }

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
            <Text style={styles.eyebrow}>{tripPhase.chip}</Text>
            <Text style={styles.compactTitle} numberOfLines={3}>
              {activeTripTitle}
            </Text>
            <Text style={styles.compactSubtitle} numberOfLines={3}>
              {activeTripSubtitle}
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

        <View style={styles.compactRoutePreviewRow}>
          <View style={styles.compactRoutePreviewCard}>
            <Text style={styles.compactRoutePreviewLabel}>Embarque</Text>
            <Text style={styles.compactRoutePreviewValue} numberOfLines={2}>
              {pickupLocation.title}
            </Text>
          </View>

          <View style={styles.compactRoutePreviewCard}>
            <Text style={styles.compactRoutePreviewLabel}>Destino</Text>
            <Text style={styles.compactRoutePreviewValue} numberOfLines={2}>
              {dropoffLocation.title}
            </Text>
          </View>
        </View>

        <View style={styles.compactMetricRow}>
          {activeTripMetrics.map((metric) => (
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
            <PrototypePrimaryButton
              label="Navegar"
              icon="navigate-outline"
              onPress={onOpenNavigation}
              style={[styles.compactSecondaryButton, styles.compactHalfButton]}
            />
          ) : null}

          {showCompactProblemButton ? (
            <TouchableOpacity
              activeOpacity={0.82}
              style={[styles.compactProblemButton, styles.compactHalfButton]}
              onPress={handleInterruptOperational}
              disabled={busyAction === "interrupt"}
              testID="driver-live-trip-report-problem-button"
              accessibilityLabel="driver-live-trip-report-problem-button"
            >
              <Ionicons name="warning-outline" size={15} color="#8A1F2B" />
              <Text style={styles.compactProblemButtonText}>
                {busyAction === "interrupt" ? "Reportando..." : "Reportar problema"}
              </Text>
            </TouchableOpacity>
          ) : null}

          {primaryActionLabel && !shouldStackCompactPrimaryAction ? (
            <PrototypePrimaryButton
              label={busyAction === "trip" ? "Atualizando..." : primaryActionLabel}
              icon={
                normalizedActiveStatus === "started"
                  ? "flag-outline"
                  : "checkmark-circle-outline"
              }
              disabled={busyAction === "trip" || !primaryActionEnabled}
              onPress={handleTripPrimaryAction}
              style={[
                styles.tripPrimaryButton,
                styles.compactPrimaryButton,
                (showCompactNavigationButton || showCompactProblemButton)
                  ? styles.compactHalfButton
                  : styles.compactPrimaryButtonFull,
              ]}
              testID={primaryActionTestID}
              accessibilityLabel={
                busyAction === "trip" ? "Atualizando..." : primaryActionLabel
              }
            />
          ) : null}
        </View>

        {primaryActionLabel && shouldStackCompactPrimaryAction ? (
          <PrototypePrimaryButton
            label={busyAction === "trip" ? "Atualizando..." : primaryActionLabel}
            icon="flag-outline"
            disabled={busyAction === "trip" || !primaryActionEnabled}
            onPress={handleTripPrimaryAction}
            style={[
              styles.tripPrimaryButton,
              styles.compactPrimaryButton,
              styles.compactPrimaryButtonStacked,
              styles.compactPrimaryButtonFull,
            ]}
            testID={primaryActionTestID}
            accessibilityLabel={
              busyAction === "trip" ? "Atualizando..." : primaryActionLabel
            }
          />
        ) : null}
      </View>
    </>
  );

  return (
    <View
      pointerEvents="box-none"
      onLayout={onCardLayout}
      style={[styles.wrap, { bottom: insetsBottom + bottomOffset }]}
    >
      <PrototypeCard
        style={[
          styles.card,
          shouldUseCompactTripCard && !isTripExpanded
            ? styles.compactCard
            : { maxHeight: maxCardHeight },
        ]}
      >
        {shouldUseCompactTripCard && !isTripExpanded ? (
          renderCompactTripCard()
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
                    {isContinuationOffer ? "Continuidade" : "Nova solicitação"}
                  </Text>
                  <Text style={styles.title}>
                    {isContinuationOffer
                      ? "Retomar corrida"
                      : "Detalhes da corrida"}
                  </Text>
                  <Text style={styles.passengerCaption}>{passengerLabel}</Text>
                </View>
                <View style={styles.fareBadge}>
                  <Text style={styles.fareBadgeLabel}>Líquido</Text>
                  <Text style={styles.fareBadgeValue}>{fareLabel}</Text>
                </View>
              </View>

              <View style={styles.metricGrid}>
                <View style={styles.metricCard}>
                  <View
                    style={[styles.metricIconWrap, styles.metricIconDistance]}
                  >
                    <Ionicons
                      name="navigate-outline"
                      size={18}
                      color="#1A7A3E"
                    />
                  </View>
                  <View style={styles.metricCopy}>
                    <Text style={styles.metricLabel}>Distância</Text>
                    <Text style={styles.metricValue}>{distanceLabel}</Text>
                  </View>
                </View>

                <View style={styles.metricCard}>
                  <View style={[styles.metricIconWrap, styles.metricIconEta]}>
                    <Ionicons name="time-outline" size={18} color="#365A6D" />
                  </View>
                  <View style={styles.metricCopy}>
                    <Text style={styles.metricLabel}>ETA</Text>
                    <Text style={styles.metricValue}>
                      {etaLabel || "Em cálculo"}
                    </Text>
                  </View>
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

              <View style={styles.statusPill}>
                <Ionicons
                  name="checkmark-circle-outline"
                  size={16}
                  color="#6C651B"
                />
                <Text style={styles.statusPillText}>{paymentLabel}</Text>
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
                  <Text style={styles.eyebrow}>{tripPhase.chip}</Text>
                  <Text style={styles.title}>{activeTripTitle}</Text>
                  <Text style={styles.passengerCaption}>
                    {`Passageiro: ${passengerLabel}`}
                  </Text>
                </View>
                <View style={[styles.fareBadge, styles.fareBadgeSoft]}>
                  <Text style={styles.fareBadgeLabel}>Líquido</Text>
                  <Text style={styles.fareBadgeValue}>{fareLabel}</Text>
                </View>
              </View>

              <Text style={styles.tripSubtitle}>{activeTripSubtitle}</Text>

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
                          ? "#1A7A3E"
                          : color.text.primary
                      }
                    />
                    <Text style={styles.extensionHeaderText}>
                      {normalizedExtensionStatus === "driver_decision_pending"
                        ? "Passageiro pediu novo destino"
                        : normalizedExtensionStatus === "pending_payment"
                          ? "Aguardando complemento Pix"
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
                        ? "Você aprovou a alteração. Aguarde a confirmação do pagamento para mudar a rota."
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

              <View style={[styles.statusPill, styles.tripStatusPill]}>
                <Ionicons name="sparkles-outline" size={16} color="#365A6D" />
                <Text
                  style={[styles.statusPillText, styles.tripStatusPillText]}
                  numberOfLines={2}
                >
                  {driverTripAssist?.subtitle || tripPhase.subtitle}
                </Text>
              </View>

              {showNavigationButton ? (
                <PrototypePrimaryButton
                  label="Abrir navegação"
                  icon="navigate-outline"
                  onPress={onOpenNavigation}
                  style={styles.tripSecondaryButton}
                />
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
                  <Ionicons name="warning-outline" size={16} color="#8A1F2B" />
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
  );
}

export default memo(DriverLiveRideOverlay);

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    width: "90%",
    alignSelf: "center",
    zIndex: 18,
  },
  card: {
    borderRadius: 34,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 16,
    backgroundColor: "rgba(249,250,247,0.97)",
    borderColor: "rgba(255,255,255,0.72)",
    shadowOpacity: 0.2,
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
    fontFamily: fonts.Bold,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 1.8,
    color: "#1A7A3E",
    marginBottom: 6,
  },
  title: {
    fontFamily: fonts.Bold,
    fontSize: 22,
    color: color.text.primary,
  },
  passengerCaption: {
    marginTop: 6,
    fontFamily: fonts.Medium,
    fontSize: 13,
    color: color.text.secondary,
  },
  fareBadge: {
    minWidth: 108,
    borderRadius: 20,
    backgroundColor: "#F5EE9A",
    paddingHorizontal: 14,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#E3D86D",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.18,
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
    letterSpacing: 1.2,
    color: "#7A7340",
    marginBottom: 4,
  },
  fareBadgeValue: {
    fontFamily: fonts.Bold,
    fontSize: 18,
    color: "#4A4520",
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
    borderColor: "rgba(68,85,93,0.06)",
    backgroundColor: "rgba(255,255,255,0.72)",
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
    backgroundColor: "rgba(105, 198, 127, 0.22)",
  },
  metricIconEta: {
    backgroundColor: "rgba(112, 150, 175, 0.14)",
  },
  metricIconFare: {
    backgroundColor: "rgba(245, 238, 179, 0.84)",
  },
  metricCopy: {
    flex: 1,
    minWidth: 0,
  },
  metricLabel: {
    fontFamily: fonts.Bold,
    fontSize: 11,
    textTransform: "uppercase",
    color: "#6B7178",
    marginBottom: 4,
  },
  metricValue: {
    fontFamily: fonts.Bold,
    fontSize: 16,
    color: color.text.primary,
  },
  routePanel: {
    marginTop: 14,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(68,85,93,0.06)",
    backgroundColor: "rgba(255,255,255,0.74)",
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
    backgroundColor: "#1A7A3E",
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
    fontFamily: fonts.Bold,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 1.4,
    color: "#1A7A3E",
    marginBottom: 4,
  },
  routeStopLabelDestination: {
    color: "#4D6575",
  },
  routeStopTitle: {
    fontFamily: fonts.Bold,
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
  statusPill: {
    marginTop: 14,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 999,
    backgroundColor: "#F5EEB3",
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  statusPillText: {
    marginLeft: 6,
    fontFamily: fonts.Bold,
    fontSize: 13,
    color: "#6C651B",
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
    minHeight: 60,
    borderRadius: 24,
  },
  declineTextButton: {
    marginTop: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  declineText: {
    fontFamily: fonts.Bold,
    fontSize: 15,
    letterSpacing: 1.8,
    textTransform: "uppercase",
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
    backgroundColor: "#F4F9F5",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  extensionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  extensionHeaderText: {
    fontFamily: fonts.Bold,
    fontSize: 13,
    lineHeight: 17,
    color: color.text.primary,
  },
  extensionDestinationText: {
    marginTop: 8,
    fontFamily: fonts.Bold,
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
    minHeight: 44,
    borderRadius: 14,
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
    minHeight: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1A7A3E",
  },
  extensionPrimaryActionText: {
    fontFamily: fonts.Bold,
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
    minHeight: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(138,31,43,0.18)",
    backgroundColor: "#FFF4F5",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  tripInterruptButtonText: {
    fontFamily: fonts.SemiBold,
    fontSize: 13,
    color: "#8A1F2B",
  },
  compactCard: {
    borderRadius: 28,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 14,
  },
  compactSummaryPressable: {
    gap: 12,
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
    fontFamily: fonts.Bold,
    fontSize: 18,
    lineHeight: 23,
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
    borderColor: "rgba(68,85,93,0.06)",
    backgroundColor: "rgba(255,255,255,0.78)",
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  compactRoutePreviewLabel: {
    fontFamily: fonts.Bold,
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
    flexWrap: "wrap",
  },
  compactMetricPill: {
    flexGrow: 1,
    flexBasis: "48%",
    minWidth: 0,
    minHeight: 58,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(68,85,93,0.06)",
    backgroundColor: "rgba(255,255,255,0.78)",
    paddingHorizontal: 10,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
  },
  compactMetricIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
  },
  compactMetricCopy: {
    flex: 1,
    minWidth: 0,
  },
  compactMetricLabel: {
    fontFamily: fonts.Bold,
    fontSize: 10,
    textTransform: "uppercase",
    color: "#6B7178",
    marginBottom: 2,
    letterSpacing: 0.8,
  },
  compactMetricValue: {
    fontFamily: fonts.Bold,
    fontSize: 13,
    lineHeight: 16,
    color: color.text.primary,
  },
  compactActionsRow: {
    flexDirection: "row",
    gap: 10,
  },
  compactActionsGroup: {
    marginTop: 12,
    gap: 10,
  },
  compactHalfButton: {
    flex: 1,
  },
  compactPrimaryButton: {
    marginTop: 0,
    minHeight: 50,
    borderRadius: 18,
  },
  compactPrimaryButtonFull: {
    flex: 1,
  },
  compactPrimaryButtonStacked: {
    marginTop: 0,
  },
  compactSecondaryButton: {
    marginTop: 0,
    minHeight: 50,
    borderRadius: 18,
    backgroundColor: "#274A36",
  },
  compactProblemButton: {
    minHeight: 50,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(138,31,43,0.18)",
    backgroundColor: "#FFF4F5",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 12,
  },
  compactProblemButtonText: {
    fontFamily: fonts.SemiBold,
    fontSize: 12,
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
});
