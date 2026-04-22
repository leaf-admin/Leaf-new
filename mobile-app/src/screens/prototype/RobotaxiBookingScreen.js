import React, { useCallback, useMemo, useState } from "react";
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
import robotaxiPrototypeTokens from "../../components/design-system/robotaxiPrototypeTokens";
import { VEHICLE_OPTIONS } from "./robotaxiPrototypeData";
import { usePrototypeMapOcclusion } from "./prototypeMapOcclusion";
import { usePrototypeRideRuntime } from "./prototypeRideRuntime";

const { color, typography } = robotaxiPrototypeTokens;
const SHEET_BOTTOM_OFFSET = 98;
const FALLBACK_CARD_HEIGHT = 338;

export default function RobotaxiBookingScreen({ navigation, route }) {
  const { selectedDestination, tripDurationMin, currentAddress } =
    usePrototypeRideRuntime();
  const insets = useSafeAreaInsets();
  const [selectedVehicle, setSelectedVehicle] = useState(VEHICLE_OPTIONS[0].id);
  const [cardHeight, setCardHeight] = useState(FALLBACK_CARD_HEIGHT);
  const sheetBottom = insets.bottom + SHEET_BOTTOM_OFFSET;

  const destination =
    route?.params?.destination ||
    selectedDestination?.name ||
    "Destino selecionado";
  const destinationAddress =
    route?.params?.destinationAddress || selectedDestination?.address || "";
  const destinationCoordinate =
    route?.params?.destinationCoordinate ||
    selectedDestination?.coordinate ||
    null;

  const selected = useMemo(() => {
    return (
      VEHICLE_OPTIONS.find((item) => item.id === selectedVehicle) ||
      VEHICLE_OPTIONS[0]
    );
  }, [selectedVehicle]);

  const handleDismiss = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate("RobotaxiPrototype");
  };

  usePrototypeMapOcclusion({
    routeKey: route?.key,
    layerId: route?.key || "prototype-booking",
    occludedBottom: sheetBottom + cardHeight,
  });

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
          sheetStyle={[styles.sheetWrap, { bottom: sheetBottom }]}
        >
          <PrototypeCard onLayout={handleCardLayout} style={styles.sheet}>
            <CardHandle />

            <Text style={styles.sectionLabel}>Reserva</Text>
            <Text numberOfLines={1} style={styles.destinationTitle}>
              {destination}
            </Text>

            <View style={styles.vehicleRow}>
              {VEHICLE_OPTIONS.map((item) => {
                const active = selectedVehicle === item.id;

                return (
                  <TouchableOpacity
                    key={item.id}
                    style={[
                      styles.vehicleCard,
                      active && styles.vehicleCardActive,
                    ]}
                    activeOpacity={0.86}
                    onPress={() => setSelectedVehicle(item.id)}
                  >
                    <Text style={styles.vehicleName}>{item.name}</Text>
                    <Text style={styles.vehicleMeta}>
                      {item.seats} assentos
                    </Text>
                    <Text style={styles.vehicleMeta}>{item.range}</Text>
                    <Text style={styles.vehiclePrice}>{item.price}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.footerMetaRow}>
              <View style={styles.metaChip}>
                <Ionicons
                  name="time-outline"
                  size={14}
                  color={color.text.primary}
                />
                <Text style={styles.metaChipText}>Partida {selected.eta}</Text>
              </View>

              <View style={styles.metaChip}>
                <Ionicons
                  name="flash-outline"
                  size={14}
                  color={color.text.primary}
                />
                <Text style={styles.metaChipText}>100% elétrico</Text>
              </View>
            </View>

            <PrototypePrimaryButton
              label="Reservar veículo"
              icon="car-sport-outline"
              testID="passenger-booking-reserve-button"
              accessibilityLabel="passenger-booking-reserve-button"
              onPress={() =>
                navigation.navigate("RobotaxiPrototypePayment", {
                  destination,
                  destinationAddress,
                  destinationCoordinate,
                  originAddress: currentAddress || "Origem atual",
                  vehicle: selected.name,
                  fare:
                    Number.parseFloat(
                      String(selected.price).replace("$", ""),
                    ) || 22.43,
                  autoOpenPix: true,
                  durationMin: Number.isFinite(tripDurationMin)
                    ? tripDurationMin
                    : undefined,
                })
              }
              style={styles.reserveButton}
            />
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
    left: 10,
    right: 10,
  },
  sheet: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 12,
  },
  sectionLabel: {
    color: color.text.secondary,
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  destinationTitle: {
    marginTop: 2,
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: typography.subtitle.size,
    lineHeight: typography.subtitle.lineHeight,
  },
  vehicleRow: {
    marginTop: 12,
    flexDirection: "row",
    gap: 8,
  },
  vehicleCard: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: color.border.subtle,
    backgroundColor: color.surface.secondary,
    paddingHorizontal: 8,
    paddingVertical: 10,
  },
  vehicleCardActive: {
    borderColor: "rgba(26,51,14,0.34)",
    backgroundColor: color.surface.activeSoft,
  },
  vehicleName: {
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: typography.body.size,
    lineHeight: typography.body.lineHeight,
  },
  vehicleMeta: {
    marginTop: 1,
    color: color.text.secondary,
    fontFamily: fonts.Regular,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight,
  },
  vehiclePrice: {
    marginTop: 4,
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight,
  },
  footerMetaRow: {
    marginTop: 10,
    flexDirection: "row",
    gap: 8,
  },
  metaChip: {
    flex: 1,
    minHeight: 36,
    borderRadius: 12,
    backgroundColor: color.surface.secondary,
    borderWidth: 1,
    borderColor: color.border.subtle,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
  },
  metaChipText: {
    color: color.text.primary,
    fontFamily: fonts.Medium,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight,
  },
  reserveButton: {
    marginTop: 10,
  },
});
