import React, { useCallback, useEffect, useState } from "react";
import { StatusBar, StyleSheet, Text, View } from "react-native";
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
import robotaxiPrototypeTokens from "../../components/design-system/robotaxiPrototypeTokens";
import { usePrototypeMapOcclusion } from "./prototypeMapOcclusion";
import { usePrototypeRideRuntime } from "./prototypeRideRuntime";
import { resolveMeaningfulAddress } from "./addressLabelUtils";
import { normalizePassengerBookingStatus } from "./passengerFlowRouting";

const { color, typography } = robotaxiPrototypeTokens;
const SHEET_BOTTOM_OFFSET = 0;
const FALLBACK_CARD_HEIGHT = 250;

export default function RobotaxiPaymentSuccessScreen({ navigation, route }) {
  const {
    activeBooking,
    bookingStatus,
    selectedDestination,
    selectedVehicle,
    currentAddress,
    driverInfo,
  } = usePrototypeRideRuntime();
  const insets = useSafeAreaInsets();
  const [cardHeight, setCardHeight] = useState(FALLBACK_CARD_HEIGHT);
  const sheetBottom = insets.bottom + SHEET_BOTTOM_OFFSET;

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
  const normalizedBookingStatus = normalizePassengerBookingStatus(bookingStatus);
  const isRideLifecycleLocked = [
    "requesting",
    "searching",
    "accepted",
    "arrived",
    "started",
    "operational_interrupted",
    "searching_replacement",
  ].includes(normalizedBookingStatus);

  usePrototypeMapOcclusion({
    routeKey: route?.key,
    layerId: route?.key || "prototype-payment-success",
    occludedBottom: sheetBottom + cardHeight,
  });

  useEffect(() => {
    if (
      normalizedBookingStatus === "accepted" ||
      normalizedBookingStatus === "arrived" ||
      normalizedBookingStatus === "started"
    ) {
      navigation.replace("RobotaxiPrototypeTrip", {
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
    normalizedBookingStatus,
    destination,
    destinationAddress,
    destinationCoordinate,
    driverInfo?.name,
    navigation,
    originAddress,
    route?.params?.fare,
    route?.params?.initialSelectedDestination,
    route?.params?.selectedFare,
    vehicle,
  ]);

  useEffect(() => {
    if (route?.params?.autoAdvance === false) {
      return;
    }

    if (
      normalizedBookingStatus !== "searching" &&
      normalizedBookingStatus !== "requesting"
    ) {
      return;
    }

    const timer = setTimeout(() => {
      navigation.replace("RobotaxiPrototypeDriverSearch", {
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
    normalizedBookingStatus,
    destination,
    destinationAddress,
    destinationCoordinate,
    navigation,
    originAddress,
    route?.params?.autoAdvance,
    route?.params?.fare,
    route?.params?.initialSelectedDestination,
    route?.params?.selectedFare,
    vehicle,
  ]);

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
          <PrototypeCard onLayout={handleCardLayout} style={styles.card}>
            <CardHandle />

            <View style={styles.iconWrap}>
              <Ionicons name="checkmark" size={30} color="#FFFFFF" />
            </View>

            <Text style={styles.title}>Pagamento confirmado</Text>
            <Text style={styles.subtitle}>
              Corrida criada com sucesso. Agora vamos buscar seu motorista.
            </Text>

            <PrototypePrimaryButton
              label="Continuar para busca"
              icon="car-sport-outline"
              onPress={() =>
                navigation.replace("RobotaxiPrototypeDriverSearch", {
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
                })
              }
              style={styles.primaryButton}
              testID="passenger-payment-success-continue-button"
              accessibilityLabel="passenger-payment-success-continue-button"
            />

            {isRideLifecycleLocked ? null : (
              <PrototypePrimaryButton
                label="Voltar ao mapa"
                icon="map-outline"
                onPress={() => navigation.navigate("RobotaxiPrototype")}
                style={styles.secondaryButton}
              />
            )}
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
  primaryButton: {
    marginTop: 12,
  },
  secondaryButton: {
    marginTop: 8,
    backgroundColor: color.surface.secondary,
    borderColor: color.border.strong,
  },
});
