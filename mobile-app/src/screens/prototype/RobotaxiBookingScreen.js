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
const SHEET_BOTTOM_OFFSET = 18;
const FALLBACK_CARD_HEIGHT = 356;

function normalizeCoordinateParam(value) {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    try {
      return normalizeCoordinateParam(JSON.parse(value));
    } catch (_error) {
      return null;
    }
  }

  const latitude = Number(value.latitude ?? value.lat);
  const longitude = Number(value.longitude ?? value.lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return { latitude, longitude };
}

export default function RobotaxiBookingScreen({ navigation, route }) {
  const { selectedDestination, tripDurationMin, currentAddress } =
    usePrototypeRideRuntime();
  const insets = useSafeAreaInsets();
  const [selectedVehicle, setSelectedVehicle] = useState(VEHICLE_OPTIONS[0].id);
  const [cardHeight, setCardHeight] = useState(FALLBACK_CARD_HEIGHT);
  const sheetBottom = Math.max(insets.bottom + SHEET_BOTTOM_OFFSET, 28);

  const destination =
    route?.params?.destination ||
    route?.params?.initialSelectedDestination?.name ||
    selectedDestination?.name ||
    "Destino selecionado";
  const destinationAddress =
    route?.params?.destinationAddress ||
    route?.params?.initialSelectedDestination?.address ||
    selectedDestination?.address ||
    "";
  const destinationCoordinate =
    normalizeCoordinateParam(route?.params?.destinationCoordinate) ||
    normalizeCoordinateParam(route?.params?.initialSelectedDestination?.coordinate) ||
    normalizeCoordinateParam(selectedDestination?.coordinate) ||
    null;

  const selected = useMemo(() => {
    return (
      VEHICLE_OPTIONS.find((item) => item.id === selectedVehicle) ||
      VEHICLE_OPTIONS[0]
    );
  }, [selectedVehicle]);

  const originLabel =
    route?.params?.originAddress || currentAddress || "Local atual";

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
        <PrototypeCard
          style={[
            styles.routeIsland,
            {
              top: insets.top + 14,
            },
          ]}
        >
          <View style={styles.routeLineColumn} pointerEvents="none">
            <View style={styles.routeDotStart} />
            <View style={styles.routeLine} />
            <View style={styles.routeDotEnd} />
          </View>

          <View style={styles.routeContent}>
            <View style={styles.routeRow}>
              <Text style={styles.routeLabel}>Partida</Text>
              <Text numberOfLines={1} style={styles.routeValue}>
                {originLabel}
              </Text>
            </View>

            <View style={styles.routeSeparator} />

            <View style={styles.routeRow}>
              <Text style={styles.routeLabel}>Destino</Text>
              <Text numberOfLines={1} style={styles.routeValue}>
                {destination}
              </Text>
            </View>
          </View>
        </PrototypeCard>

        <PrototypeDismissibleSheet
          onClose={handleDismiss}
          dragEnabled={false}
          bottomGapFillColor="transparent"
          sheetStyle={[styles.sheetWrap, { bottom: sheetBottom }]}
        >
          <PrototypeCard onLayout={handleCardLayout} style={styles.sheet}>
            <CardHandle />

            <Text style={styles.sectionLabel}>Escolha a categoria</Text>

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
                    <Text style={styles.vehiclePrice}>{item.price}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.selectedSummary}>
              <View style={styles.selectedCopy}>
                <Text style={styles.selectedName}>{selected.name}</Text>
                <Text style={styles.selectedDescription}>
                  {selected.description}
                </Text>
                <Text style={styles.selectedMeta}>{selected.range}</Text>
              </View>

              <View style={styles.selectedFareWrap}>
                <Text style={styles.selectedFare}>{selected.price}</Text>
                <Text style={styles.selectedFareCaption}>valor da corrida</Text>
              </View>
            </View>

            <View style={styles.metricsGrid}>
              <View style={styles.metricItem}>
                <Text style={styles.metricLabel}>Tempo ate embarque</Text>
                <View style={styles.metricValueRow}>
                  <Ionicons
                    name="time-outline"
                    size={14}
                    color={color.text.primary}
                  />
                  <Text style={styles.metricValue}>{selected.eta}</Text>
                </View>
              </View>

              <View style={styles.metricItem}>
                <Text style={styles.metricLabel}>Chegada prevista</Text>
                <View style={styles.metricValueRow}>
                  <Ionicons
                    name="navigate-outline"
                    size={14}
                    color={color.text.primary}
                  />
                  <Text style={styles.metricValue}>
                    {selected.arrival || "--"}
                  </Text>
                </View>
              </View>

              <View style={styles.metricItem}>
                <Text style={styles.metricLabel}>Motorista a</Text>
                <View style={styles.metricValueRow}>
                  <Ionicons
                    name="car-outline"
                    size={14}
                    color={color.text.primary}
                  />
                  <Text style={styles.metricValue}>{selected.pickupDistance}</Text>
                </View>
              </View>

              <View style={styles.metricItem}>
                <Text style={styles.metricLabel}>Cancelamento gratis</Text>
                <View style={styles.metricValueRow}>
                  <Ionicons
                    name="shield-checkmark-outline"
                    size={14}
                    color={color.text.primary}
                  />
                  <Text style={styles.metricValue}>
                    {selected.cancellationWindow}
                  </Text>
                </View>
              </View>
            </View>

            <View style={styles.statusRow}>
              <View style={styles.statusPill}>
                <Text style={styles.statusPillText}>Tarifa normal</Text>
              </View>
              <View style={styles.statusPill}>
                <Text style={styles.statusPillText}>Leaf Delas disponivel</Text>
              </View>
            </View>

            <PrototypePrimaryButton
              label="Confirmar corrida"
              testID="passenger-booking-reserve-button"
              accessibilityLabel="passenger-booking-reserve-button"
              onPress={() =>
                navigation.navigate("RobotaxiPrototypePayment", {
                  destination,
                  destinationAddress,
                  destinationCoordinate,
                  initialSelectedDestination: {
                    name: destination,
                    address: destinationAddress || destination,
                    coordinate: destinationCoordinate,
                  },
                  originAddress: originLabel,
                  vehicle: selected.name,
                  fare: Number(selected.fare) || 22.43,
                  selectedFare: Number(selected.fare) || 22.43,
                  initialSelectedPlan: selected.id,
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
    left: 16,
    right: 16,
  },
  sheet: {
    borderRadius: 28,
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 24,
  },
  routeIsland: {
    position: "absolute",
    left: 16,
    right: 16,
    zIndex: 22,
    borderRadius: 28,
    paddingHorizontal: 18,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "stretch",
  },
  routeLineColumn: {
    width: 18,
    alignItems: "center",
    paddingTop: 11,
    paddingBottom: 11,
  },
  routeDotStart: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: color.text.primary,
  },
  routeLine: {
    width: 2,
    flex: 1,
    minHeight: 30,
    marginVertical: 5,
    borderRadius: 999,
    backgroundColor: color.border.strong,
  },
  routeDotEnd: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: color.accent.primary,
  },
  routeContent: {
    flex: 1,
    paddingLeft: 12,
  },
  routeRow: {
    minHeight: 46,
    justifyContent: "center",
  },
  routeSeparator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: color.border.separator,
  },
  routeLabel: {
    color: color.text.secondary,
    fontFamily: fonts.Medium,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight,
  },
  routeValue: {
    marginTop: 2,
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: typography.body.size,
    lineHeight: typography.body.lineHeight,
  },
  sectionLabel: {
    color: color.text.secondary,
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  vehicleRow: {
    marginTop: 12,
    flexDirection: "row",
    gap: 7,
  },
  vehicleCard: {
    flex: 1,
    minHeight: 70,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: color.border.subtle,
    backgroundColor: color.surface.primary,
    paddingHorizontal: 10,
    paddingVertical: 9,
    justifyContent: "space-between",
  },
  vehicleCardActive: {
    borderColor: "rgba(26,51,14,0.38)",
    backgroundColor: "#F7FAF5",
  },
  vehicleName: {
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight,
  },
  vehiclePrice: {
    marginTop: 8,
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight,
  },
  selectedSummary: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.border.separator,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  selectedCopy: {
    flex: 1,
  },
  selectedName: {
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: typography.body.size,
    lineHeight: typography.body.lineHeight,
  },
  selectedDescription: {
    marginTop: 2,
    color: color.text.secondary,
    fontFamily: fonts.Regular,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight,
  },
  selectedMeta: {
    color: color.text.secondary,
    fontFamily: fonts.Regular,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight,
  },
  selectedFareWrap: {
    alignItems: "flex-end",
    paddingTop: 1,
  },
  selectedFare: {
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: 18,
    lineHeight: 24,
  },
  selectedFareCaption: {
    marginTop: -1,
    color: color.text.secondary,
    fontFamily: fonts.Regular,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight,
  },
  metricsGrid: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.border.separator,
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: 10,
  },
  metricItem: {
    width: "50%",
  },
  metricLabel: {
    color: color.text.secondary,
    fontFamily: fonts.Regular,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight,
  },
  metricValueRow: {
    marginTop: 3,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  metricValue: {
    color: color.text.primary,
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight,
  },
  statusRow: {
    marginTop: 12,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  statusPill: {
    minHeight: 28,
    borderRadius: 999,
    paddingHorizontal: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(26,51,14,0.07)",
  },
  statusPillText: {
    color: color.accent.primary,
    fontFamily: fonts.Medium,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight,
  },
  reserveButton: {
    marginTop: 16,
  },
});
