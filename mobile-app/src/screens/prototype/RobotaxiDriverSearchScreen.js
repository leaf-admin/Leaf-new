import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StatusBar, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { fonts } from "../../theme/runtimeTokens";
import PrototypeScreenTransition from "../../components/prototype/PrototypeScreenTransition";
import PrototypeDismissibleSheet from "../../components/prototype/PrototypeDismissibleSheet";
import {
  LeafButton,
  LeafInfoRow,
  LeafProgressBar,
  LeafRideSheet,
  LeafPill,
  LeafStateHeader,
  leafButtonMetrics,
  leafRideColors,
} from "../../components/prototype/LeafRideUI";
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

const SHEET_BOTTOM_OFFSET = 0;
const FALLBACK_CARD_HEIGHT = 302;

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
    cancelRideSearch,
  } = usePrototypeRideRuntime();
  const insets = useSafeAreaInsets();
  const [cardHeight, setCardHeight] = useState(FALLBACK_CARD_HEIGHT);
  const [cancelPending, setCancelPending] = useState(false);
  const [cancelError, setCancelError] = useState("");
  const terminalRouteHandledRef = useRef(false);
  const protectedSearchExitRef = useRef(false);
  const sheetBottom = insets.bottom + SHEET_BOTTOM_OFFSET;
  const normalizedBookingStatus = normalizePassengerBookingStatus(bookingStatus);
  const passengerAutoRoute = resolvePassengerAutoRoute(bookingStatus);
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
  const sheetTestID = isBookingFinalizing
    ? "passenger-booking-finalizing-sheet"
    : "passenger-driver-search-sheet";
  const headerTitle = isBookingFinalizing
    ? "Criando corrida"
    : "Buscando motorista";
  const cardTitle = isBookingFinalizing
    ? "Solicitação em andamento"
    : "Detalhes da corrida";
  const progressPrimaryText = isBookingFinalizing
    ? "Criando corrida"
    : searchPresentation.elapsedLabel;
  const progressMetaText = isBookingFinalizing
    ? "Pagamento confirmado. Estamos criando sua corrida com segurança."
    : isSearchReconciling
      ? "sincronizando estado"
      : "tempo de busca";
  const searchMilestoneLabel = searchPresentation.isMaxRadius
    ? "Buscando no maior raio disponível para esta corrida"
    : `Buscando em ${searchPresentation.diameterLabel} neste momento`;
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
      if (/pagamento|payment/i.test(lastError)) {
        replaceAfterProtectedSearch("RobotaxiPrototypePaymentFailed", {
          errorMessage: lastError,
          retryRouteName: "RobotaxiPrototypeDestination",
          retryParams: {
            destination,
            destinationAddress:
              routeDestinationAddress || bookingDestinationAddress,
            destinationCoordinate,
            initialSelectedDestination:
              route?.params?.initialSelectedDestination || {
                name: destination,
                address:
                  routeDestinationAddress || bookingDestinationAddress,
                coordinate: destinationCoordinate,
              },
            selectedFare: protectedFareAmount,
            fare: protectedFareAmount,
            originAddress: routeOriginAddress || bookingPickupAddress,
            vehicle,
          },
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

      replaceAfterProtectedSearch("RobotaxiPrototypeNoDrivers", {
        reason: lastError,
      });
    }
  }, [
    bookingDestinationAddress,
    bookingPickupAddress,
    completedReceiptParams,
    destination,
    destinationCoordinate,
    isSearchActive,
    lastError,
    normalizedBookingStatus,
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

  const handleCancelSearch = async () => {
    if (!isCanonicalSearchActive || cancelPending) {
      return;
    }

    setCancelPending(true);
    setCancelError("");
    try {
      await cancelRideSearch(searchCancellationContext);
      terminalRouteHandledRef.current = true;
      replaceAfterProtectedSearch(
        "RobotaxiPrototypeCancellation",
        {
          ...searchCancellationContext,
          completed: true,
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
        <LeafStateHeader
          title={headerTitle}
          subtitle="Pagamento confirmado"
          rightLabel="Ativo"
          rightTone="dark"
          insetsTop={insets.top}
        />

        <PrototypeDismissibleSheet
          onClose={handleProtectedDismiss}
          backdropDismissEnabled={false}
          dragEnabled={false}
          sheetStyle={[styles.sheetWrap, { bottom: sheetBottom }]}
        >
          <LeafRideSheet
            onLayout={handleCardLayout}
            style={styles.searchingCard}
            testID={sheetTestID}
            accessibilityLabel={sheetTestID}
          >
            <View style={styles.sheetHandle} />
            <View style={styles.cardHeaderRow}>
              <Text style={styles.cardTitle}>{cardTitle}</Text>
              <LeafPill label={fareLabel} tone="ghost" />
            </View>

            <View style={styles.hiddenMeasurement}>
              <LeafProgressBar
                progress={searchPresentation.progress}
                fillTestID="passenger-driver-search-progress-fill"
              />
            </View>

            <Text
              style={styles.visibleElapsedText}
              testID="passenger-driver-search-elapsed"
              accessibilityLabel="passenger-driver-search-elapsed"
            >
              {progressPrimaryText}
            </Text>
              <Text style={styles.elapsedMetaText}>
                {progressMetaText}
              </Text>

            <View style={styles.routeSummaryRow}>
              <Ionicons name="location-outline" size={19} color={leafRideColors.accent} />
              <View style={styles.routeSummaryCopy}>
                <Text style={styles.routeSummaryTitle} numberOfLines={1}>
                  {destinationLabel}
                </Text>
                <Text style={styles.routeSummaryMeta} numberOfLines={1}>
                  Partida: {originLabel}
                </Text>
              </View>
            </View>

            <View style={styles.hiddenLegacyRows}>
              <Text>Busca ativa</Text>
              <LeafInfoRow title="Raio de busca expandido" subtitle={searchMilestoneLabel} />
              <LeafInfoRow title="Preço protegido" subtitle={`${fareLabel} confirmado até encontrar motorista`} />
              <LeafInfoRow title="Ponto de partida" subtitle={originLabel} />
              <LeafInfoRow title="Destino" />
            </View>

            {cancelError || lastError ? (
              <Text style={styles.errorText}>{cancelError || lastError}</Text>
            ) : null}

            <LeafButton
              label={
                isSearchReconciling
                  ? "Sincronizando..."
                  : isBookingFinalizing
                    ? "Criando corrida..."
                    : cancelPending
                    ? "Cancelando..."
                  : "Cancelar"
              }
              onPress={
                isSearchReconciling ||
                isBookingFinalizing ||
                cancelPending
                  ? undefined
                  : handleCancelSearch
              }
              icon={
                isSearchReconciling ||
                isBookingFinalizing ||
                cancelPending
                  ? "time-outline"
                  : "close-circle-outline"
              }
              disabled={
                isSearchReconciling ||
                isBookingFinalizing ||
                cancelPending
              }
              tone="ghost"
              style={styles.actionButton}
              testID="passenger-driver-search-cancel-button"
              accessibilityLabel="passenger-driver-search-cancel-button"
            />
            {cancelError || searchPresentation.remainingSeconds === 0 ? (
              <LeafButton
                label="Falar com suporte"
                onPress={handleOpenSupport}
                icon="chatbubble-ellipses-outline"
                tone="ghost"
                style={styles.supportButton}
                testID="passenger-driver-search-support-button"
                accessibilityLabel="passenger-driver-search-support-button"
              />
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
  searchingCard: {
    backgroundColor: "#FFFFFF",
    minHeight: FALLBACK_CARD_HEIGHT,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    paddingTop: 14,
    paddingBottom: 14,
  },
  sheetHandle: {
    width: 50,
    height: 4,
    borderRadius: 3,
    backgroundColor: "#D8D0C7",
    alignSelf: "center",
    marginBottom: 25,
  },
  cardHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  cardTitle: {
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 20,
    lineHeight: 25,
  },
  hiddenMeasurement: {
    position: "absolute",
    width: 1,
    height: 1,
    opacity: 0,
  },
  visibleElapsedText: {
    marginTop: 2,
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 26,
    lineHeight: 32,
  },
  elapsedMetaText: {
    marginTop: 0,
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 11,
    lineHeight: 15,
  },
  routeSummaryRow: {
    marginTop: 24,
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
  },
  routeSummaryCopy: {
    flex: 1,
    minWidth: 0,
    marginLeft: 22,
  },
  routeSummaryTitle: {
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 14,
    lineHeight: 18,
  },
  routeSummaryMeta: {
    marginTop: 4,
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 10,
    lineHeight: 14,
  },
  hiddenLegacyRows: {
    position: "absolute",
    width: 1,
    height: 1,
    opacity: 0,
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
    marginTop: 30,
    width: 154,
    minHeight: leafButtonMetrics.height,
    borderRadius: leafButtonMetrics.radius,
  },
  supportButton: {
    marginTop: 10,
    width: 190,
    minHeight: leafButtonMetrics.height,
    borderRadius: leafButtonMetrics.radius,
  },
});
