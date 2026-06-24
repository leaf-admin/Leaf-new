import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { fonts } from "../../theme/runtimeTokens";
import PrototypeScreenTransition from "../../components/prototype/PrototypeScreenTransition";
import PrototypeDismissibleSheet from "../../components/prototype/PrototypeDismissibleSheet";
import {
  CardHandle,
  PrototypeCard,
  PrototypePrimaryButton,
} from "../../components/prototype/PrototypeUI";
import { leafButtonMetrics } from "../../components/prototype/LeafRideUI";
import robotaxiPrototypeTokens from "../../components/design-system/robotaxiPrototypeTokens";
import { usePrototypeMapOcclusion } from "./prototypeMapOcclusion";
import { usePrototypeRideRuntime } from "./prototypeRideRuntime";
import { resolvePassengerAutoRoute } from "./passengerFlowRouting";

const { color, typography } = robotaxiPrototypeTokens;
const SHEET_BOTTOM_OFFSET = 0;
const FALLBACK_CARD_HEIGHT = 286;

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
  const sheetBottom = insets.bottom + SHEET_BOTTOM_OFFSET;
  const reason =
    route?.params?.reason || "Ainda não encontramos um motorista disponível perto de você.";
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
    navigation.replace("RobotaxiPrototypeDestination");
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
          <PrototypeCard onLayout={handleCardLayout} style={styles.card}>
            <CardHandle />

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

            <PrototypePrimaryButton
              label="Tentar com outro destino"
              icon="search-outline"
              onPress={handleRetryDestination}
              style={styles.primaryButton}
              testID="passenger-no-drivers-retry-button"
              accessibilityLabel="passenger-no-drivers-retry-button"
            />

            <View style={styles.rowButtons}>
              <TouchableOpacity
                style={styles.secondaryButton}
                activeOpacity={0.86}
                onPress={() => navigation.navigate("RobotaxiPrototypeSupport")}
                testID="passenger-no-drivers-support-button"
                accessibilityLabel="passenger-no-drivers-support-button"
              >
                <Ionicons
                  name="help-circle-outline"
                  size={16}
                  color={color.text.primary}
                />
                <Text style={styles.secondaryButtonText}>Suporte</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.secondaryButton}
                activeOpacity={0.86}
                onPress={handleDismiss}
                testID="passenger-no-drivers-back-to-map-button"
                accessibilityLabel="passenger-no-drivers-back-to-map-button"
              >
                <Ionicons
                  name="map-outline"
                  size={16}
                  color={color.text.primary}
                />
                <Text style={styles.secondaryButtonText}>Voltar ao mapa</Text>
              </TouchableOpacity>
            </View>
          </PrototypeCard>
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
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    paddingHorizontal: 24,
    paddingTop: 14,
    paddingBottom: 16,
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
    fontSize: 18,
    lineHeight: 24,
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
  rowButtons: {
    marginTop: 8,
    flexDirection: "row",
    gap: 8,
  },
  secondaryButton: {
    flex: 1,
    minHeight: leafButtonMetrics.height,
    borderRadius: leafButtonMetrics.radius,
    borderWidth: 1,
    borderColor: color.border.strong,
    backgroundColor: color.surface.secondary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: leafButtonMetrics.iconGap,
  },
  secondaryButtonText: {
    color: color.text.primary,
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight,
  },
});
