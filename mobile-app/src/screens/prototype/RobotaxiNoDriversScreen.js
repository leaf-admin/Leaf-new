import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { fonts } from "../../theme/runtimeTokens";
import PrototypeScreenTransition from "../../components/prototype/PrototypeScreenTransition";
import PrototypeDismissibleSheet from "../../components/prototype/PrototypeDismissibleSheet";
import {
  RobotaxiLifecycleButton,
  RobotaxiLifecycleCard,
  RobotaxiLifecycleDisclosure,
  robotaxiLifecycleMetrics,
} from "../../components/prototype/RobotaxiLifecycleUI";
import robotaxiPrototypeTokens from "../../components/design-system/robotaxiPrototypeTokens";
import { usePrototypeMapOcclusion } from "./prototypeMapOcclusion";
import { usePrototypeRideRuntime } from "./prototypeRideRuntime";
import { resolvePassengerAutoRoute } from "./passengerFlowRouting";

const { color, typography } = robotaxiPrototypeTokens;
const SHEET_BOTTOM_OFFSET = 0;
const FALLBACK_CARD_HEIGHT = 286;
const DEFAULT_NO_DRIVERS_MESSAGE =
  "Ainda não encontramos um motorista disponível perto de você.";

function formatNoDriversReason(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return DEFAULT_NO_DRIVERS_MESSAGE;
  }

  const normalized = raw.toLowerCase();
  if (
    [
      "no_drivers",
      "no_drivers_available",
      "driver_unavailable",
      "search_timeout",
      "driver_search_timeout",
    ].includes(normalized)
  ) {
    return DEFAULT_NO_DRIVERS_MESSAGE;
  }

  if (/^[a-z0-9_-]+$/i.test(raw)) {
    return "Não foi possível encontrar um motorista agora. Tente outro destino ou volte ao mapa.";
  }

  return raw;
}

export default function RobotaxiNoDriversScreen({ navigation, route }) {
  const {
    bookingStatus,
    activeBooking,
    activeBookingId,
    lastRideBookingId,
    selectedDestination,
    selectedFare,
    selectedVehicle,
    tripDistanceKm,
    tripDurationMin,
    tripArrivalText,
    driverInfo,
    clearFlowPreview,
  } =
    usePrototypeRideRuntime();
  const insets = useSafeAreaInsets();
  const [cardHeight, setCardHeight] = useState(FALLBACK_CARD_HEIGHT);
  const [secondaryActionsVisible, setSecondaryActionsVisible] = useState(false);
  const sheetBottom =
    insets.bottom + SHEET_BOTTOM_OFFSET + robotaxiLifecycleMetrics.cardBottomGap;
  const reason = formatNoDriversReason(route?.params?.reason);
  const refundStatus = String(route?.params?.refundStatus || "")
    .trim()
    .toUpperCase();
  const refundAmount = Number(route?.params?.refundAmount || 0);
  const hasRefundInfo =
    refundStatus === "REFUNDED" || refundStatus === "REFUND_PENDING";
  const refundMessage =
    refundStatus === "REFUNDED"
      ? `Estorno de R$ ${refundAmount.toFixed(2).replace(".", ",")} iniciado automaticamente.`
      : refundStatus === "REFUND_PENDING"
        ? "Pagamento confirmado. O estorno será processado automaticamente pelo sistema."
        : "";
  const destination = useMemo(
    () => selectedDestination?.name || route?.params?.destination || "Destino",
    [route?.params?.destination, selectedDestination?.name],
  );
  const vehicle = useMemo(
    () => selectedVehicle || route?.params?.vehicle || "Leaf Plus",
    [route?.params?.vehicle, selectedVehicle],
  );
  const passengerAutoRoute = useMemo(
    () => resolvePassengerAutoRoute(bookingStatus),
    [bookingStatus],
  );
  const isSearchStillActive =
    passengerAutoRoute === "RobotaxiPrototypeDriverSearch";
  const routeBookingId = String(
    route?.params?.bookingId ||
      route?.params?.rideId ||
      route?.params?.tripId ||
      activeBookingId ||
      activeBooking?.bookingId ||
      activeBooking?.id ||
      lastRideBookingId ||
      "",
  ).trim();
  const routeFare = Number(
    route?.params?.fare ||
      route?.params?.grossAmount ||
      route?.params?.selectedFare ||
      activeBooking?.grossFare ||
      activeBooking?.fare ||
      activeBooking?.amount ||
      selectedFare,
  );
  const terminalRouteParams = useMemo(() => ({
    ...(routeBookingId
      ? {
          bookingId: routeBookingId,
          rideId: routeBookingId,
          tripId: routeBookingId,
        }
      : {}),
    destination,
    destinationAddress:
      route?.params?.destinationAddress ||
      selectedDestination?.address ||
      activeBooking?.destinationLocation?.add ||
      destination,
    originAddress:
      route?.params?.originAddress ||
      activeBooking?.pickupLocation?.add ||
      route?.params?.pickupAddress ||
      "",
    vehicle,
    status: bookingStatus || null,
    tripDistanceKm: Number.isFinite(Number(tripDistanceKm)) ? Number(tripDistanceKm) : null,
    tripDurationMin: Number.isFinite(Number(tripDurationMin)) ? Number(tripDurationMin) : null,
    tripArrivalText: tripArrivalText || null,
    selectedFare: Number.isFinite(routeFare) && routeFare > 0 ? routeFare : null,
    driverName: driverInfo?.name || null,
    vehicleModel: driverInfo?.model || null,
    vehiclePlate: driverInfo?.plate || null,
  }), [
    activeBooking?.destinationLocation?.add,
    activeBooking?.pickupLocation?.add,
    bookingStatus,
    destination,
    driverInfo?.model,
    driverInfo?.name,
    driverInfo?.plate,
    route?.params?.destinationAddress,
    route?.params?.originAddress,
    route?.params?.pickupAddress,
    routeBookingId,
    routeFare,
    selectedDestination?.address,
    tripArrivalText,
    tripDistanceKm,
    tripDurationMin,
    vehicle,
  ]);

  usePrototypeMapOcclusion({
    routeKey: route?.key,
    layerId: route?.key || "prototype-no-drivers",
    occludedBottom: sheetBottom + cardHeight,
  });

  useEffect(() => {
    if (
      !passengerAutoRoute ||
      passengerAutoRoute === "RobotaxiPrototypeNoDrivers"
    ) {
      return;
    }

    if (passengerAutoRoute === "RobotaxiPrototypeReceipt") {
      navigation.replace("RobotaxiPrototypeReceipt", {
        ...terminalRouteParams,
        fromTrip: true,
        ...(Number.isFinite(routeFare) && routeFare > 0
          ? {
              fare: routeFare,
              grossAmount: routeFare,
            }
          : {}),
      });
      return;
    }

    if (passengerAutoRoute === "RobotaxiPrototypeDriverSearch") {
      navigation.replace("RobotaxiPrototypeDriverSearch", {
        ...terminalRouteParams,
      });
      return;
    }

    if (passengerAutoRoute === "RobotaxiPrototypeTrip") {
      navigation.replace("RobotaxiPrototypeTrip", {
        ...terminalRouteParams,
        driverName: driverInfo?.name || "Motorista",
      });
    }
  }, [
    driverInfo?.name,
    navigation,
    passengerAutoRoute,
    routeFare,
    terminalRouteParams,
  ]);

  const handleCardLayout = useCallback((event) => {
    const nextHeight = event?.nativeEvent?.layout?.height;
    if (Number.isFinite(nextHeight) && nextHeight > 0) {
      setCardHeight(nextHeight);
    }
  }, []);

  const handleDismiss = () => {
    clearFlowPreview();
    navigation.navigate("RobotaxiPrototype");
  };

  const handleRetryDestination = () => {
    clearFlowPreview();
    navigation.replace("RobotaxiPrototype");
  };

  if (isSearchStillActive) {
    return null;
  }

  return (
    <PrototypeScreenTransition animated={false}>
      <View
        style={styles.container}
        pointerEvents="box-none"
        testID="passenger-no-drivers-screen"
        accessibilityLabel="passenger-no-drivers-screen"
      >
        <StatusBar
          translucent
          backgroundColor="transparent"
          barStyle="dark-content"
        />

        <PrototypeDismissibleSheet
          onClose={handleDismiss}
          sheetStyle={[styles.sheetWrap, { bottom: sheetBottom }]}
        >
          <RobotaxiLifecycleCard onLayout={handleCardLayout} style={styles.card}>

            <View style={styles.iconWrap}>
              <Ionicons
                name="car-outline"
                size={30}
                color={color.text.primary}
              />
            </View>

            <Text style={styles.title}>Nenhum motorista encontrado</Text>
            <Text style={styles.subtitle}>{reason}</Text>

            {hasRefundInfo ? (
              <View style={styles.refundBox}>
                <Ionicons
                  name="wallet-outline"
                  size={16}
                  color={color.accent.primary}
                />
                <Text style={styles.refundText}>{refundMessage}</Text>
              </View>
            ) : null}

            <RobotaxiLifecycleButton
              label="Tentar com outro destino"
              icon="search-outline"
              tone="primary"
              onPress={handleRetryDestination}
              style={styles.primaryButton}
              testID="passenger-no-drivers-retry-button"
              accessibilityLabel="passenger-no-drivers-retry-button"
            />

            <RobotaxiLifecycleDisclosure
              expanded={secondaryActionsVisible}
              onPress={() => setSecondaryActionsVisible((visible) => !visible)}
              label="Mais opções"
              expandedLabel="Ocultar opções"
              style={styles.moreOptionsButton}
              testID="passenger-no-drivers-more-options-button"
              accessibilityLabel="passenger-no-drivers-more-options-button"
            />

            {secondaryActionsVisible ? (
              <View style={styles.rowButtons}>
              <RobotaxiLifecycleButton
                label="Suporte"
                icon="help-circle-outline"
                style={styles.secondaryButton}
                onPress={() => navigation.navigate("RobotaxiPrototypeSupport")}
                testID="passenger-no-drivers-support-button"
                accessibilityLabel="passenger-no-drivers-support-button"
              />

              <RobotaxiLifecycleButton
                label="Voltar ao mapa"
                icon="map-outline"
                style={styles.secondaryButton}
                onPress={handleDismiss}
                testID="passenger-no-drivers-back-to-map-button"
                accessibilityLabel="passenger-no-drivers-back-to-map-button"
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
  card: {
    marginHorizontal: robotaxiLifecycleMetrics.cardHorizontalMargin,
  },
  iconWrap: {
    alignSelf: "center",
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.surface.secondary,
    borderWidth: 1,
    borderColor: color.border.strong,
  },
  title: {
    marginTop: 10,
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: 15.5,
    lineHeight: 20,
    textAlign: "center",
  },
  subtitle: {
    marginTop: 4,
    color: color.text.secondary,
    fontFamily: fonts.Regular,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight,
    textAlign: "center",
  },
  refundBox: {
    marginTop: 10,
    paddingHorizontal: 10,
    minHeight: 42,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: color.border.strong,
    backgroundColor: color.surface.secondary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  refundText: {
    flex: 1,
    color: color.text.primary,
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight,
    textAlign: "center",
  },
  primaryButton: {
    marginTop: 12,
  },
  moreOptionsButton: {
    marginTop: 10,
    width: "100%",
  },
  rowButtons: {
    marginTop: 8,
    flexDirection: "row",
    gap: 8,
  },
  secondaryButton: {
    flex: 1,
    minWidth: 0,
  },
});
