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
import { normalizePassengerBookingStatus } from "./passengerFlowRouting";

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

export default function RobotaxiDriverSearchScreen({ navigation, route }) {
  const {
    activeBooking,
    bookingStatus,
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
  const terminalRouteHandledRef = useRef(false);
  const sheetBottom = insets.bottom + SHEET_BOTTOM_OFFSET;
  const normalizedBookingStatus = normalizePassengerBookingStatus(bookingStatus);
  const isSearchActive =
    normalizedBookingStatus === "searching" ||
    normalizedBookingStatus === "requesting";
  const searchAnchorTimestamp =
    activeBooking?.timestamp ||
    activeBooking?.createdAt ||
    activeBooking?.requestedAt ||
    activeBooking?.paymentData?.confirmedAt ||
    null;
  const elapsed = useSearchElapsedClock(
    searchingElapsedSeconds,
    isSearchActive,
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
  const fareLabel = formatFareLabel(
    selectedFare ||
      activeBooking?.estimatedFare ||
      activeBooking?.fare ||
      route?.params?.selectedFare,
  );
  const searchMilestoneLabel = searchPresentation.isMaxRadius
    ? "Buscando no maior raio disponível para esta corrida"
    : `Buscando em ${searchPresentation.diameterLabel} neste momento`;

  useEffect(() => {
    if (
      normalizedBookingStatus === "accepted" ||
      normalizedBookingStatus === "arrived" ||
      normalizedBookingStatus === "started"
    ) {
      navigation.navigate("RobotaxiPrototypeTrip", {
        destination,
        destinationAddress: routeDestinationAddress || bookingDestinationAddress,
        destinationCoordinate,
        initialSelectedDestination:
          route?.params?.initialSelectedDestination || {
            name: destination,
            address: routeDestinationAddress || bookingDestinationAddress || destination,
            coordinate: destinationCoordinate,
          },
        selectedFare:
          route?.params?.selectedFare ||
          selectedFare ||
          activeBooking?.estimatedFare ||
          activeBooking?.fare,
        vehicle,
        elapsed,
        driverName: driverInfo?.name || "Motorista",
      });
    }
  }, [
    activeBooking?.estimatedFare,
    activeBooking?.fare,
    bookingDestinationAddress,
    destination,
    destinationCoordinate,
    driverInfo?.name,
    elapsed,
    navigation,
    normalizedBookingStatus,
    route?.params?.initialSelectedDestination,
    route?.params?.selectedFare,
    routeDestinationAddress,
    selectedFare,
    vehicle,
  ]);

  useEffect(() => {
    if (
      normalizedBookingStatus === "searching" ||
      normalizedBookingStatus === "requesting"
    ) {
      terminalRouteHandledRef.current = false;
      return;
    }

    if (terminalRouteHandledRef.current) {
      return;
    }

    if (normalizedBookingStatus === "idle" && lastError) {
      terminalRouteHandledRef.current = true;
      if (/pagamento|payment/i.test(lastError)) {
        navigation.replace("RobotaxiPrototypePaymentFailed", {
          errorMessage: lastError,
          retryRouteName: "RobotaxiPrototypeDestination",
          retryParams: {
            destination,
            destinationAddress,
            destinationCoordinate,
            initialSelectedDestination:
              route?.params?.initialSelectedDestination || {
                name: destination,
                address: destinationAddress,
                coordinate: destinationCoordinate,
              },
            selectedFare: route?.params?.selectedFare || route?.params?.fare,
            fare: route?.params?.fare,
            originAddress,
            vehicle,
          },
        });
        return;
      }

      if (/cancelad|cancelled|cancelada/i.test(lastError)) {
        navigation.replace("RobotaxiPrototypeCancellation", {
          source: "search",
        });
        return;
      }

      navigation.replace("RobotaxiPrototypeNoDrivers", {
        reason: lastError,
      });
    }
  }, [lastError, navigation, normalizedBookingStatus]);

  const handleDismiss = () => {
    if (
      normalizedBookingStatus === "searching" ||
      normalizedBookingStatus === "requesting"
    ) {
      cancelRideSearch();
    }
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate("RobotaxiPrototype");
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
          title="Buscando motorista"
          subtitle="Pagamento confirmado"
          rightLabel="Ativo"
          rightTone="dark"
          insetsTop={insets.top}
        />

        <PrototypeDismissibleSheet
          onClose={handleDismiss}
          sheetStyle={[styles.sheetWrap, { bottom: sheetBottom }]}
        >
          <LeafRideSheet
            onLayout={handleCardLayout}
            style={styles.searchingCard}
            testID="passenger-driver-search-sheet"
            accessibilityLabel="passenger-driver-search-sheet"
          >
            <View style={styles.sheetHandle} />
            <View style={styles.cardHeaderRow}>
              <Text style={styles.cardTitle}>Detalhes da corrida</Text>
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
              {searchPresentation.elapsedLabel}
            </Text>
            <Text style={styles.elapsedMetaText}>tempo de busca</Text>

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

            {lastError ? <Text style={styles.errorText}>{lastError}</Text> : null}

            <LeafButton
              label={
                normalizedBookingStatus === "requesting"
                  ? "Criando corrida..."
                  : "Cancelar"
              }
              onPress={
                normalizedBookingStatus === "requesting" ? undefined : handleDismiss
              }
              icon={
                normalizedBookingStatus === "requesting"
                  ? "time-outline"
                  : "close-circle-outline"
              }
              tone="ghost"
              style={styles.actionButton}
              testID="passenger-driver-search-cancel-button"
              accessibilityLabel="passenger-driver-search-cancel-button"
            />
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
});
