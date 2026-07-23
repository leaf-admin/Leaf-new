import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StatusBar, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { fonts } from "../../theme/runtimeTokens";
import PrototypeScreenTransition from "../../components/prototype/PrototypeScreenTransition";
import PrototypeDismissibleSheet from "../../components/prototype/PrototypeDismissibleSheet";
import {
  RobotaxiLifecycleButton,
  RobotaxiLifecycleCard,
  robotaxiLifecycleMetrics,
} from "../../components/prototype/RobotaxiLifecycleUI";
import robotaxiPrototypeTokens from "../../components/design-system/robotaxiPrototypeTokens";
import { usePrototypeMapOcclusion } from "./prototypeMapOcclusion";
import { usePrototypeRideRuntime } from "./prototypeRideRuntime";
import { resolveMeaningfulAddress } from "./addressLabelUtils";
import {
  normalizePassengerBookingStatus,
  resolvePassengerAutoRoute,
} from "./passengerFlowRouting";

const { color, typography } = robotaxiPrototypeTokens;
const SHEET_BOTTOM_OFFSET = 0;
const FALLBACK_CARD_HEIGHT = 250;

export default function RobotaxiPaymentSuccessScreen({ navigation, route }) {
  const {
    activeBooking,
    activeBookingId,
    bookingStatus,
    selectedDestination,
    selectedVehicle,
    currentAddress,
    driverInfo,
  } = usePrototypeRideRuntime();
  const insets = useSafeAreaInsets();
  const [cardHeight, setCardHeight] = useState(FALLBACK_CARD_HEIGHT);
  const protectedPaymentSuccessExitRef = useRef(false);
  const sheetBottom =
    insets.bottom + SHEET_BOTTOM_OFFSET + robotaxiLifecycleMetrics.cardBottomGap;

  const destination =
    route?.params?.destination || selectedDestination?.name || "Destino";
  const destinationAddress =
    resolveMeaningfulAddress(
      route?.params?.destinationAddress,
      selectedDestination?.address,
      activeBooking?.destinationLocation?.add,
    ) ||
    destination;
  const originAddress =
    resolveMeaningfulAddress(
      route?.params?.originAddress,
      activeBooking?.pickupLocation?.add,
      currentAddress,
    ) ||
    "Origem atual";
  const destinationCoordinate =
    route?.params?.destinationCoordinate ||
    route?.params?.initialSelectedDestination?.coordinate ||
    selectedDestination?.coordinate ||
    activeBooking?.destinationLocation ||
    null;
  const vehicle = route?.params?.vehicle || selectedVehicle || "Leaf Plus";
  const receiptBookingId = String(
    route?.params?.bookingId ||
      route?.params?.rideId ||
      route?.params?.tripId ||
      activeBookingId ||
      activeBooking?.bookingId ||
      activeBooking?.id ||
      "",
  ).trim();
  const receiptFare = Number(
    route?.params?.selectedFare ||
      route?.params?.fare ||
      activeBooking?.grossFare ||
      activeBooking?.fare ||
      activeBooking?.amount,
  );
  const completedReceiptParams = useMemo(() => ({
    fromTrip: true,
    ...(receiptBookingId
      ? { bookingId: receiptBookingId, rideId: receiptBookingId, tripId: receiptBookingId }
      : {}),
    ...(Number.isFinite(receiptFare) && receiptFare > 0
      ? { fare: receiptFare, grossAmount: receiptFare }
      : {}),
    pickupAddress: originAddress,
    destinationAddress,
    driverId: driverInfo?.id || null,
    driverName: driverInfo?.name || null,
    vehicleLabel: vehicle,
    vehiclePlate: driverInfo?.plate || null,
  }), [
    destinationAddress,
    driverInfo?.id,
    driverInfo?.name,
    driverInfo?.plate,
    originAddress,
    receiptBookingId,
    receiptFare,
    vehicle,
  ]);
  const normalizedBookingStatus = normalizePassengerBookingStatus(bookingStatus);
  const passengerAutoRoute = resolvePassengerAutoRoute(bookingStatus);
  const isRideLifecycleLocked = [
    "requesting",
    "searching",
    "accepted",
    "arrived",
    "started",
    "operational_interrupted",
    "searching_replacement",
    "completed",
    "canceled",
    "no_drivers",
    "rejected",
  ].includes(normalizedBookingStatus);
  const replaceAfterPaymentSuccess = useCallback((routeName, params) => {
    protectedPaymentSuccessExitRef.current = routeName;
    if (typeof navigation.replace === "function") {
      navigation.replace(routeName, params);
      return;
    }

    navigation.navigate(routeName, params);
  }, [navigation]);

  usePrototypeMapOcclusion({
    routeKey: route?.key,
    layerId: route?.key || "prototype-payment-success",
    occludedBottom: sheetBottom + cardHeight,
  });

  useEffect(() => {
    if (passengerAutoRoute === "RobotaxiPrototypeTrip") {
      replaceAfterPaymentSuccess("RobotaxiPrototypeTrip", {
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
        originAddress,
        vehicle,
        driverName: driverInfo?.name || "Motorista",
      });
    }
  }, [
    destination,
    destinationAddress,
    destinationCoordinate,
    driverInfo?.name,
    passengerAutoRoute,
    replaceAfterPaymentSuccess,
    originAddress,
    route?.params?.fare,
    route?.params?.initialSelectedDestination,
    route?.params?.selectedFare,
    vehicle,
  ]);

  useEffect(() => {
    if (passengerAutoRoute === "RobotaxiPrototypeReceipt") {
      replaceAfterPaymentSuccess("RobotaxiPrototypeReceipt", completedReceiptParams);
      return;
    }

    if (passengerAutoRoute === "RobotaxiPrototypeCancellation") {
      replaceAfterPaymentSuccess("RobotaxiPrototypeCancellation", {
        completed: true,
        bookingStatus: normalizedBookingStatus,
        source: "payment_success",
      });
      return;
    }

    if (passengerAutoRoute === "RobotaxiPrototypeNoDrivers") {
      replaceAfterPaymentSuccess("RobotaxiPrototypeNoDrivers", {
        reason: "Não há motoristas disponíveis para essa corrida agora.",
      });
    }
  }, [
    completedReceiptParams,
    normalizedBookingStatus,
    passengerAutoRoute,
    replaceAfterPaymentSuccess,
  ]);

  useEffect(() => {
    if (route?.params?.autoAdvance === false) {
      return;
    }

    if (passengerAutoRoute !== "RobotaxiPrototypeDriverSearch") {
      return;
    }

    const timer = setTimeout(() => {
      replaceAfterPaymentSuccess("RobotaxiPrototypeDriverSearch", {
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
        originAddress,
        vehicle,
      });
    }, 760);

    return () => clearTimeout(timer);
  }, [
    destination,
    destinationAddress,
    destinationCoordinate,
    passengerAutoRoute,
    replaceAfterPaymentSuccess,
    originAddress,
    route?.params?.autoAdvance,
    route?.params?.fare,
    route?.params?.initialSelectedDestination,
    route?.params?.selectedFare,
    vehicle,
  ]);

  useEffect(() => {
    if (
      !isRideLifecycleLocked ||
      typeof navigation?.addListener !== "function"
    ) {
      return undefined;
    }

    // The successful Pix state is part of the active ride lifecycle. It can
    // only leave through its next canonical screen, never through back/pop.
    const unsubscribe = navigation.addListener("beforeRemove", event => {
      const expectedRouteName = protectedPaymentSuccessExitRef.current;
      const actionRouteName = event?.data?.action?.payload?.name;
      if (expectedRouteName && actionRouteName === expectedRouteName) {
        protectedPaymentSuccessExitRef.current = null;
        return;
      }

      event?.preventDefault?.();
    });

    return typeof unsubscribe === "function" ? unsubscribe : undefined;
  }, [isRideLifecycleLocked, navigation]);

  const handleDismiss = () => {
    if (isRideLifecycleLocked) {
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
          backdropDismissEnabled={!isRideLifecycleLocked}
          dragEnabled={!isRideLifecycleLocked}
          sheetStyle={[styles.sheetWrap, { bottom: sheetBottom }]}
        >
          <RobotaxiLifecycleCard onLayout={handleCardLayout} style={styles.card}>

            <View style={styles.iconWrap}>
              <Ionicons name="checkmark" size={30} color="#FFFFFF" />
            </View>

            <Text style={styles.title}>Pagamento confirmado</Text>
            <Text style={styles.subtitle}>
              Corrida criada com sucesso. Agora vamos buscar seu motorista.
            </Text>

            <RobotaxiLifecycleButton
              label="Continuar para busca"
              icon="car-sport-outline"
              tone="primary"
              onPress={() => {
                const targetRoute = passengerAutoRoute || "RobotaxiPrototypeDriverSearch";
                if (targetRoute === "RobotaxiPrototypeReceipt") {
                  replaceAfterPaymentSuccess("RobotaxiPrototypeReceipt", completedReceiptParams);
                  return;
                }
                if (targetRoute === "RobotaxiPrototypeCancellation") {
                  replaceAfterPaymentSuccess("RobotaxiPrototypeCancellation", {
                    completed: true,
                    bookingStatus: normalizedBookingStatus,
                    source: "payment_success",
                  });
                  return;
                }
                if (targetRoute === "RobotaxiPrototypeNoDrivers") {
                  replaceAfterPaymentSuccess("RobotaxiPrototypeNoDrivers", {
                    reason: "Não há motoristas disponíveis para essa corrida agora.",
                  });
                  return;
                }

                replaceAfterPaymentSuccess(targetRoute, {
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
                });
              }}
              style={styles.primaryButton}
              testID="passenger-payment-success-continue-button"
              accessibilityLabel="passenger-payment-success-continue-button"
            />

            {isRideLifecycleLocked ? null : (
              <RobotaxiLifecycleButton
                label="Voltar ao mapa"
                icon="map-outline"
                onPress={() => navigation.navigate("RobotaxiPrototype")}
                style={styles.secondaryButton}
              />
            )}
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
    backgroundColor: color.accent.primary,
    shadowColor: color.shadow.accent,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.18,
    shadowRadius: 14,
    elevation: 8,
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
  primaryButton: {
    marginTop: 12,
  },
  secondaryButton: {
    marginTop: 8,
    backgroundColor: color.surface.secondary,
    borderColor: color.border.strong,
  },
});
