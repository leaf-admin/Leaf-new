import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StatusBar, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fonts } from "../../theme/runtimeTokens";
import PrototypeScreenTransition from "../../components/prototype/PrototypeScreenTransition";
import PrototypeDismissibleSheet from "../../components/prototype/PrototypeDismissibleSheet";
import {
  LeafProgressBar,
  leafRideColors,
} from "../../components/prototype/LeafRideUI";
import {
  RobotaxiLifecycleButton,
  RobotaxiLifecycleCard,
  RobotaxiLifecycleDisclosure,
  RobotaxiLifecycleSection,
  RobotaxiLifecycleSummary,
  robotaxiLifecycleMetrics,
} from "../../components/prototype/RobotaxiLifecycleUI";
import { usePrototypeMapOcclusion } from "./prototypeMapOcclusion";
import { getSearchPresentation } from "./searchPresentation";
import { usePrototypeRideRuntime } from "./prototypeRideRuntime";
import useSearchElapsedClock from "./useSearchElapsedClock";
import { resolveMeaningfulAddress } from "./addressLabelUtils";
import { formatCurrencyBRL } from "./tripFinancialSummary";
import {
  normalizePassengerBookingStatus,
  resolvePassengerAutoRoute,
} from "./passengerFlowRouting";
import { isNoDriversBookingError } from "./bookingErrorPolicy";

const SHEET_BOTTOM_OFFSET = 0;
const FALLBACK_CARD_HEIGHT = 258;

function compactPlaceLabel(value, fallback) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return fallback;
  }

  const [firstChunk] = normalized.split(",");
  return String(firstChunk || normalized).trim() || fallback;
}

function formatFareLabel(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "--";
  }
  return formatCurrencyBRL(numeric);
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

function pickPositiveDurationMinutes(...values) {
  for (const value of values) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      continue;
    }
    return numeric > 180 ? numeric / 60 : numeric;
  }
  return null;
}

function secondsToMinutes(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  return numeric / 60;
}

function formatClockFromMinutes(minutes) {
  const numericMinutes = Number(minutes);
  if (!Number.isFinite(numericMinutes) || numericMinutes <= 0) {
    return "--";
  }
  const arrivalDate = new Date(Date.now() + Math.round(numericMinutes) * 60 * 1000);
  return arrivalDate.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function compactArrivalClockLabel(value) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "";
  }
  const clockMatch = normalized.match(/\b\d{1,2}:\d{2}\b/);
  return clockMatch ? clockMatch[0] : normalized;
}

function toPositiveMoney(value) {
  if (typeof value === "string") {
    const sanitized = value.replace(/[^\d,.-]/g, "").trim();
    if (!sanitized) {
      return null;
    }
    const normalized = sanitized.includes(",")
      ? sanitized.replace(/\./g, "").replace(",", ".")
      : sanitized;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function pickPaidSearchAmount(source = {}) {
  if (!source || typeof source !== "object") {
    return null;
  }

  const nestedPayment =
    source.payment ||
    source.paymentState ||
    source.paymentData ||
    source.paymentBreakdown ||
    {};
  const candidates = [
    source.passengerPaidAmount,
    source.totalPaid,
    source.totalAmount,
    source.totalFare,
    source.paymentAmount,
    source.chargedAmount,
    source.amountPaid,
    source.customerPaid,
    source.customer_paid,
    source.grossAmount,
    source.grossFare,
    nestedPayment.passengerPaidAmount,
    nestedPayment.totalPaid,
    nestedPayment.totalAmount,
    nestedPayment.totalFare,
    nestedPayment.paymentAmount,
    nestedPayment.chargedAmount,
    nestedPayment.amountPaid,
    nestedPayment.customerPaid,
    nestedPayment.amount,
    nestedPayment.grossAmount,
    nestedPayment.grossFare,
  ];

  for (const candidate of candidates) {
    const amount = toPositiveMoney(candidate);
    if (amount !== null) {
      return amount;
    }
  }

  const cents = [
    source.paymentAmountCents,
    source.amountPaidCents,
    source.totalAmountCents,
    source.grossAmountInCents,
    nestedPayment.paymentAmountCents,
    nestedPayment.amountPaidCents,
    nestedPayment.totalAmountCents,
    nestedPayment.grossAmountInCents,
  ].find(value => Number.isFinite(Number(value)) && Number(value) > 0);

  return cents ? Number((Number(cents) / 100).toFixed(2)) : null;
}

function resolveProtectedSearchFareAmount({
  routeParams,
  paymentState,
  activeBooking,
  selectedFare,
} = {}) {
  return (
    pickPaidSearchAmount(routeParams) ??
    pickPaidSearchAmount(paymentState) ??
    pickPaidSearchAmount(activeBooking) ??
    toPositiveMoney(routeParams?.selectedFare) ??
    toPositiveMoney(routeParams?.fare) ??
    toPositiveMoney(selectedFare) ??
    toPositiveMoney(activeBooking?.estimatedFare) ??
    toPositiveMoney(activeBooking?.fare) ??
    null
  );
}

function isConfirmedPaymentState(paymentState) {
  const status = String(paymentState?.status || "").trim().toLowerCase();
  return (
    ["processing", "confirmed", "paid", "settled", "completed", "approved"].includes(status) ||
    Boolean(paymentState?.confirmedAt || paymentState?.processedAt || paymentState?.paymentId || paymentState?.chargeId)
  );
}

const TERMINAL_SEARCH_STATUSES = new Set([
  "completed",
  "cancelled",
  "canceled",
  "cancelada",
  "rejected",
  "expired",
  "no_drivers",
]);

export default function RobotaxiDriverSearchScreen({ navigation, route }) {
  const {
    activeBooking,
    activeBookingId,
    bookingStatus,
    paymentState,
    searchingElapsedSeconds,
    selectedVehicle,
    selectedFare,
    selectedDestination,
    currentAddress,
    driverInfo,
    lastError,
    confirmedBookingRetryAvailable,
    cancelRideSearch,
  } = usePrototypeRideRuntime();
  const insets = useSafeAreaInsets();
  const [cardHeight, setCardHeight] = useState(FALLBACK_CARD_HEIGHT);
  const [cancelPending, setCancelPending] = useState(false);
  const [cancelError, setCancelError] = useState("");
  const [timeoutDecisionDismissed, setTimeoutDecisionDismissed] = useState(false);
  const [tripDetailsVisible, setTripDetailsVisible] = useState(false);
  const terminalRouteHandledRef = useRef(false);
  const protectedSearchExitRef = useRef(false);
  const sheetBottom =
    insets.bottom + SHEET_BOTTOM_OFFSET + robotaxiLifecycleMetrics.cardBottomGap;
  const normalizedBookingStatus = normalizePassengerBookingStatus(bookingStatus);
  const passengerAutoRoute = resolvePassengerAutoRoute(bookingStatus);
  const noDriversRefundParams = useMemo(() => {
    const refundAmount = Number(paymentState?.refundAmount || 0);
    return {
      refundStatus: paymentState?.refundStatus || null,
      refundAmount:
        Number.isFinite(refundAmount) && refundAmount >= 0 ? refundAmount : 0,
    };
  }, [paymentState?.refundAmount, paymentState?.refundStatus]);
  const isBookingFinalizing = normalizedBookingStatus === "requesting";
  const isCanonicalSearchActive = normalizedBookingStatus === "searching";
  const resolvedActiveBookingId = String(
    activeBooking?.bookingId ||
      activeBooking?.id ||
      activeBookingId ||
      route?.params?.bookingId ||
      "",
  ).trim();
  const searchCancellationContext = useMemo(
    () => ({
      ...(resolvedActiveBookingId
        ? {
            bookingId: resolvedActiveBookingId,
            rideId: resolvedActiveBookingId,
            tripId: resolvedActiveBookingId,
          }
        : {}),
      bookingStatus: normalizedBookingStatus,
      source: "search",
    }),
    [normalizedBookingStatus, resolvedActiveBookingId],
  );
  const hasPaidOrActiveBookingEvidence =
    Boolean(resolvedActiveBookingId) ||
    Boolean(activeBooking && typeof activeBooking === "object") ||
    isConfirmedPaymentState(paymentState) ||
    Boolean(activeBooking?.paymentData?.confirmedAt);
  const isTerminalSearchStatus = TERMINAL_SEARCH_STATUSES.has(
    normalizedBookingStatus,
  );
  const isSearchReconciling =
    !isBookingFinalizing &&
    !isCanonicalSearchActive &&
    !isTerminalSearchStatus &&
    !lastError &&
    hasPaidOrActiveBookingEvidence;
  const isSearchActive =
    isBookingFinalizing || isCanonicalSearchActive || isSearchReconciling;
  const searchAnchorTimestamp =
    activeBooking?.timestamp ||
    activeBooking?.createdAt ||
    activeBooking?.requestedAt ||
    activeBooking?.paymentData?.confirmedAt ||
    null;
  const elapsed = useSearchElapsedClock(
    searchingElapsedSeconds,
    isCanonicalSearchActive || isSearchReconciling,
    searchAnchorTimestamp,
  );
  const searchPresentation = useMemo(
    () => getSearchPresentation(elapsed),
    [elapsed],
  );
  const hasSearchReachedTimeout =
    isCanonicalSearchActive && searchPresentation.remainingSeconds === 0;
  const showSearchTimeoutDecision =
    hasSearchReachedTimeout &&
    !timeoutDecisionDismissed &&
    !cancelPending &&
    !cancelError;

  const routeOriginAddress = resolveMeaningfulAddress(
    route?.params?.originAddress,
  );
  const routeDestinationAddress = resolveMeaningfulAddress(
    route?.params?.destinationAddress,
  );
  const routeDestinationLabel = resolveMeaningfulAddress(
    route?.params?.destination,
  );
  const bookingPickupAddress = String(
    activeBooking?.pickupLocation?.add || "",
  ).trim();
  const bookingDestinationAddress = String(
    activeBooking?.destinationLocation?.add || "",
  ).trim();
  const destination =
    routeDestinationLabel ||
    routeDestinationAddress ||
    selectedDestination?.name ||
    selectedDestination?.address ||
    bookingDestinationAddress ||
    "Destino";
  const destinationCoordinate =
    route?.params?.destinationCoordinate ||
    route?.params?.initialSelectedDestination?.coordinate ||
    selectedDestination?.coordinate ||
    activeBooking?.destinationLocation ||
    null;
  const vehicle = route?.params?.vehicle || selectedVehicle || "Leaf Plus";
  const originLabel = compactPlaceLabel(
    routeOriginAddress || bookingPickupAddress || currentAddress,
    "Sua localização atual",
  );
  const destinationLabel = compactPlaceLabel(
    routeDestinationLabel ||
      routeDestinationAddress ||
      selectedDestination?.name ||
      selectedDestination?.address ||
      bookingDestinationAddress ||
      destination,
    "Destino",
  );
  const protectedFareAmount = resolveProtectedSearchFareAmount({
    routeParams: route?.params,
    paymentState,
    activeBooking,
    selectedFare,
  });
  const completedReceiptParams = useMemo(() => ({
    fromTrip: true,
    ...(resolvedActiveBookingId
      ? {
          bookingId: resolvedActiveBookingId,
          rideId: resolvedActiveBookingId,
          tripId: resolvedActiveBookingId,
        }
      : {}),
    ...(Number.isFinite(Number(protectedFareAmount)) && Number(protectedFareAmount) > 0
      ? {
          fare: Number(protectedFareAmount),
          grossAmount: Number(protectedFareAmount),
        }
      : {}),
    pickupAddress: routeOriginAddress || bookingPickupAddress || currentAddress,
    destinationAddress: routeDestinationAddress || bookingDestinationAddress || destination,
    driverId: driverInfo?.id || null,
    driverName: driverInfo?.name || null,
    vehicleLabel: vehicle,
  }), [
    bookingDestinationAddress,
    bookingPickupAddress,
    currentAddress,
    destination,
    driverInfo?.id,
    driverInfo?.name,
    protectedFareAmount,
    resolvedActiveBookingId,
    routeDestinationAddress,
    routeOriginAddress,
    vehicle,
  ]);
  const fareLabel = formatFareLabel(protectedFareAmount);
  const estimatedTripDurationMin = pickPositiveDurationMinutes(
    route?.params?.tripDurationMin,
    route?.params?.durationMin,
    secondsToMinutes(route?.params?.tripDurationSecs),
    secondsToMinutes(route?.params?.durationSecs),
    secondsToMinutes(route?.params?.routeDurationSecs),
    activeBooking?.tripDurationMin,
    activeBooking?.durationMin,
    secondsToMinutes(activeBooking?.tripDurationSecs),
    secondsToMinutes(activeBooking?.durationSecs),
    secondsToMinutes(activeBooking?.routeDurationSecs),
    secondsToMinutes(activeBooking?.duration),
  );
  const estimatedArrivalLabel =
    compactArrivalClockLabel(
      route?.params?.arrivalLabel ||
        route?.params?.arrivalTime ||
        activeBooking?.arrivalLabel ||
        activeBooking?.arrivalTime ||
        activeBooking?.estimatedArrivalTime,
    ) || formatClockFromMinutes(estimatedTripDurationMin);
  const sheetTestID = "passenger-driver-search-sheet";
  const progressPrimaryText = searchPresentation.elapsedLabel;
  const progressMetaText = isSearchReconciling
      ? "sincronizando estado"
      : "tempo de busca";
  const replaceAfterProtectedSearch = useCallback((routeName, params) => {
    protectedSearchExitRef.current = routeName;
    if (typeof navigation.replace === "function") {
      navigation.replace(routeName, params);
      return;
    }

    navigation.navigate(routeName, params);
  }, [navigation]);

  useEffect(() => {
    if (passengerAutoRoute === "RobotaxiPrototypeTrip") {
      replaceAfterProtectedSearch("RobotaxiPrototypeTrip", {
        destination,
        destinationAddress: routeDestinationAddress || bookingDestinationAddress,
        destinationCoordinate,
        initialSelectedDestination:
          route?.params?.initialSelectedDestination || {
            name: destination,
            address: routeDestinationAddress || bookingDestinationAddress || destination,
            coordinate: destinationCoordinate,
          },
        selectedFare: protectedFareAmount,
        vehicle,
        elapsed,
        driverName: driverInfo?.name || "Motorista",
      });
    }
  }, [
    bookingDestinationAddress,
    destination,
    destinationCoordinate,
    driverInfo?.name,
    elapsed,
    passengerAutoRoute,
    protectedFareAmount,
    replaceAfterProtectedSearch,
    route?.params?.initialSelectedDestination,
    routeDestinationAddress,
    vehicle,
  ]);

  useEffect(() => {
    if (isSearchActive) {
      terminalRouteHandledRef.current = false;
      return;
    }

    if (terminalRouteHandledRef.current) {
      return;
    }

    if (passengerAutoRoute === "RobotaxiPrototypeReceipt") {
      terminalRouteHandledRef.current = true;
      replaceAfterProtectedSearch("RobotaxiPrototypeReceipt", completedReceiptParams);
      return;
    }

    if (passengerAutoRoute === "RobotaxiPrototypeNoDrivers") {
      terminalRouteHandledRef.current = true;
      replaceAfterProtectedSearch("RobotaxiPrototypeNoDrivers", {
        reason:
          lastError ||
          "Não há motoristas disponíveis para essa corrida agora.",
        ...noDriversRefundParams,
      });
      return;
    }

    if (passengerAutoRoute === "RobotaxiPrototypeCancellation") {
      terminalRouteHandledRef.current = true;
      replaceAfterProtectedSearch(
        "RobotaxiPrototypeCancellation",
        {
          ...searchCancellationContext,
          completed: true,
        },
      );
      return;
    }

    if (normalizedBookingStatus === "idle" && lastError) {
      terminalRouteHandledRef.current = true;
      if (
        isNoDriversBookingError({
          code: paymentState?.errorCode,
          message: lastError,
        })
      ) {
        replaceAfterProtectedSearch("RobotaxiPrototypeNoDrivers", {
          reason: lastError,
          ...noDriversRefundParams,
        });
        return;
      }

      if (/pagamento|payment/i.test(lastError)) {
        replaceAfterProtectedSearch("RobotaxiPrototypePaymentFailed", {
          errorMessage: lastError,
          retryConfirmedBooking: Boolean(confirmedBookingRetryAvailable),
          retryRouteName: "RobotaxiPrototype",
          retryParams: {},
        });
        return;
      }

      if (/cancelad|cancelled|cancelada/i.test(lastError)) {
        replaceAfterProtectedSearch(
          "RobotaxiPrototypeCancellation",
          {
            ...searchCancellationContext,
            completed: true,
          },
        );
        return;
      }

      replaceAfterProtectedSearch("RobotaxiPrototypePaymentFailed", {
        title: "Corrida não solicitada",
        errorMessage: lastError,
        retryConfirmedBooking: Boolean(confirmedBookingRetryAvailable),
        retryRouteName: "RobotaxiPrototype",
        retryParams: {},
      });
    }
  }, [
    bookingDestinationAddress,
    bookingPickupAddress,
    completedReceiptParams,
    confirmedBookingRetryAvailable,
    destination,
    destinationCoordinate,
    isSearchActive,
    lastError,
    normalizedBookingStatus,
    noDriversRefundParams,
    paymentState?.errorCode,
    passengerAutoRoute,
    protectedFareAmount,
    replaceAfterProtectedSearch,
    route?.params?.initialSelectedDestination,
    routeDestinationAddress,
    routeOriginAddress,
    searchCancellationContext,
    vehicle,
  ]);

  useEffect(() => {
    if (
      !isSearchActive ||
      typeof navigation?.addListener !== "function"
    ) {
      return undefined;
    }

    // A confirmed payment/search must remain visible until a canonical
    // transition (acceptance, cancellation ACK, timeout or no-driver result).
    const unsubscribe = navigation.addListener("beforeRemove", event => {
      const expectedRouteName = protectedSearchExitRef.current;
      const actionRouteName = event?.data?.action?.payload?.name;
      if (expectedRouteName && actionRouteName === expectedRouteName) {
        protectedSearchExitRef.current = null;
        return;
      }

      event?.preventDefault?.();
    });

    return typeof unsubscribe === "function" ? unsubscribe : undefined;
  }, [isSearchActive, navigation]);

  const handleProtectedDismiss = useCallback(() => {}, []);

  useEffect(() => {
    setTimeoutDecisionDismissed(false);
  }, [resolvedActiveBookingId]);

  useEffect(() => {
    if (!hasSearchReachedTimeout) {
      setTimeoutDecisionDismissed(false);
    }
  }, [hasSearchReachedTimeout]);

  const handleCancelSearch = async () => {
    if (!isCanonicalSearchActive || cancelPending) {
      return;
    }

    setCancelPending(true);
    setCancelError("");
    try {
      const cancellationResponse = await cancelRideSearch(searchCancellationContext);
      terminalRouteHandledRef.current = true;
      replaceAfterProtectedSearch(
        "RobotaxiPrototypeCancellation",
        {
          ...searchCancellationContext,
          completed: true,
          cancellationOutcome: cancellationResponse?.data || null,
        },
      );
    } catch (error) {
      setCancelError(
        error?.message ||
          "Não foi possível cancelar no servidor. A corrida continua ativa.",
      );
    } finally {
      setCancelPending(false);
    }
  };

  const handleContinueSearchAfterTimeout = useCallback(() => {
    setCancelError("");
    setTimeoutDecisionDismissed(true);
  }, []);

  const handleCancelSearchAfterTimeout = async () => {
    if (!isCanonicalSearchActive || cancelPending) {
      return;
    }

    setCancelPending(true);
    setCancelError("");
    try {
      await cancelRideSearch({
        ...searchCancellationContext,
        source: "search_timeout_prompt",
        reason: "Passageiro desistiu após o tempo de busca.",
        suppressReason: "passenger_search_timeout_prompt",
        clearLastError: true,
      });
      terminalRouteHandledRef.current = true;
      replaceAfterProtectedSearch("RobotaxiPrototype", {
        source: "driver_search_timeout_cancelled",
        searchCancelled: true,
        refundRequested: true,
      });
    } catch (error) {
      setCancelError(
        error?.message ||
          "Não foi possível cancelar no servidor. A corrida continua ativa.",
      );
    } finally {
      setCancelPending(false);
    }
  };

  const handleOpenSupport = () => {
    navigation.navigate("RobotaxiMenuHelp", {
      source: "driver_search",
      bookingId: resolvedActiveBookingId || null,
    });
  };

  usePrototypeMapOcclusion({
    routeKey: route?.key,
    layerId: route?.key || "prototype-driver-search",
    occludedBottom: sheetBottom + cardHeight,
  });

  const handleCardLayout = useCallback((event) => {
    const nextHeight = event?.nativeEvent?.layout?.height;
    if (Number.isFinite(nextHeight) && nextHeight > 0) {
      setCardHeight(nextHeight);
    }
  }, []);

  if (!isSearchActive) {
    return null;
  }

  return (
    <PrototypeScreenTransition animated={false}>
      <View style={styles.container} pointerEvents="box-none">
        <StatusBar
          translucent
          backgroundColor="transparent"
          barStyle="dark-content"
        />
        <PrototypeDismissibleSheet
          onClose={handleProtectedDismiss}
          backdropDismissEnabled={false}
          dragEnabled={false}
          sheetStyle={[styles.sheetWrap, { bottom: sheetBottom }]}
        >
          <RobotaxiLifecycleCard
            onLayout={handleCardLayout}
            style={styles.searchingCard}
            testID={sheetTestID}
            accessibilityLabel={sheetTestID}
          >
            <RobotaxiLifecycleSummary
              eyebrow={showSearchTimeoutDecision ? "BUSCA MAIS LONGA" : "BUSCANDO MOTORISTA"}
              title={showSearchTimeoutDecision ? "Continuar busca?" : progressPrimaryText}
              subtitle={showSearchTimeoutDecision ? "Ainda procurando motoristas próximos." : progressMetaText}
              value={fareLabel}
              valueLabel="valor protegido"
              titleTestID="passenger-driver-search-elapsed"
            />

            <View style={styles.searchProgress}>
              <LeafProgressBar
                progress={searchPresentation.progress}
                fillTestID="passenger-driver-search-progress-fill"
              />
            </View>

            <RobotaxiLifecycleDisclosure
              expanded={tripDetailsVisible}
              onPress={() => setTripDetailsVisible((current) => !current)}
              label="Ver detalhes"
              expandedLabel="Ocultar detalhes"
              style={styles.tripDetailsToggle}
              testID="passenger-driver-search-details-toggle"
              accessibilityLabel={
                tripDetailsVisible ? "Ocultar detalhes da viagem" : "Ver detalhes da viagem"
              }
            />

            {tripDetailsVisible ? (
              <RobotaxiLifecycleSection
                title="DETALHES DA VIAGEM"
                style={styles.routeSummaryBlock}
              >
                <View testID="passenger-driver-search-route-details">
                  <Text style={styles.routeSummaryLabel}>PARTIDA</Text>
                  <Text style={styles.routeSummaryValue} numberOfLines={1}>
                    {originLabel}
                  </Text>
                  <Text style={[styles.routeSummaryLabel, styles.destinationLabel]}>DESTINO</Text>
                  <Text style={styles.routeSummaryValue} numberOfLines={1}>
                    {destinationLabel}
                  </Text>
                  <Text style={styles.routeSummaryMeta}>Chegada estimada {estimatedArrivalLabel}</Text>
                </View>
                {cancelError || lastError ? (
                  <Text style={styles.errorText}>{cancelError || lastError}</Text>
                ) : null}
                <RobotaxiLifecycleButton
                  label={cancelPending ? "Cancelando..." : "Cancelar busca"}
                  onPress={cancelPending ? undefined : showSearchTimeoutDecision
                    ? handleCancelSearchAfterTimeout
                    : handleCancelSearch}
                  disabled={cancelPending || isSearchReconciling || isBookingFinalizing}
                  tone="danger"
                  style={styles.actionButton}
                  testID={showSearchTimeoutDecision
                    ? "passenger-driver-search-timeout-cancel-button"
                    : "passenger-driver-search-cancel-button"}
                  accessibilityLabel={showSearchTimeoutDecision
                    ? "passenger-driver-search-timeout-cancel-button"
                    : "passenger-driver-search-cancel-button"}
                />
                {isSearchReconciling || cancelError ||
                (!cancelPending && searchPresentation.remainingSeconds === 0) ? (
                  <RobotaxiLifecycleButton
                    label="Falar com suporte"
                    onPress={handleOpenSupport}
                    icon="chatbubble-ellipses-outline"
                    style={styles.supportButton}
                    testID="passenger-driver-search-support-button"
                    accessibilityLabel="passenger-driver-search-support-button"
                  />
                ) : null}
              </RobotaxiLifecycleSection>
            ) : null}

            {showSearchTimeoutDecision ? (
              <View
                testID="passenger-driver-search-timeout-decision"
                accessibilityLabel="passenger-driver-search-timeout-decision"
              >
                  <RobotaxiLifecycleButton
                    label="Continuar buscando"
                    onPress={handleContinueSearchAfterTimeout}
                    tone="primary"
                    style={styles.continueButton}
                    testID="passenger-driver-search-timeout-continue-button"
                    accessibilityLabel="passenger-driver-search-timeout-continue-button"
                  />
              </View>
            ) : null}
          </RobotaxiLifecycleCard>
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
  searchingCard: {
    marginHorizontal: robotaxiLifecycleMetrics.cardHorizontalMargin,
  },
  searchProgress: {
    marginTop: 16,
  },
  tripDetailsToggle: {
    marginTop: 16,
  },
  routeSummaryBlock: {
    marginTop: 16,
  },
  routeSummaryLabel: {
    color: leafRideColors.secondary,
    fontFamily: fonts.Medium,
    fontSize: 10,
    lineHeight: 13,
    letterSpacing: 0.5,
  },
  routeSummaryValue: {
    marginTop: 2,
    color: leafRideColors.text,
    fontFamily: fonts.Medium,
    fontSize: 12,
    lineHeight: 16,
  },
  routeSummaryMeta: {
    marginTop: 2,
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 12,
    lineHeight: 16,
  },
  destinationLabel: {
    marginTop: 12,
  },
  errorText: {
    marginTop: 12,
    color: leafRideColors.dangerText,
    fontFamily: fonts.Medium,
    fontSize: 13,
    lineHeight: 17,
    textAlign: "center",
  },
  actionButton: {
    marginTop: 16,
    width: "100%",
  },
  supportButton: {
    marginTop: 10,
    width: "100%",
  },
  continueButton: {
    marginTop: 12,
    width: "100%",
  },
});
