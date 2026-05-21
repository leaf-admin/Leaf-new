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
import robotaxiPrototypeTokens from "../../components/design-system/robotaxiPrototypeTokens";
import { usePrototypeMapOcclusion } from "./prototypeMapOcclusion";
import { usePrototypeRideRuntime } from "./prototypeRideRuntime";
import { resolvePassengerAutoRoute } from "./passengerFlowRouting";

const { color, typography } = robotaxiPrototypeTokens;
const SHEET_BOTTOM_OFFSET = 98;
const FALLBACK_CARD_HEIGHT = 286;

export default function RobotaxiNoDriversScreen({ navigation, route }) {
  const {
    bookingStatus,
    selectedDestination,
    selectedVehicle,
    driverInfo,
    clearFlowPreview,
  } =
    usePrototypeRideRuntime();
  const insets = useSafeAreaInsets();
  const [cardHeight, setCardHeight] = useState(FALLBACK_CARD_HEIGHT);
  const sheetBottom = insets.bottom + SHEET_BOTTOM_OFFSET;
  const reason =
    route?.params?.reason || "Nenhum motorista disponivel no momento.";
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
    bookingStatus === "searching" || bookingStatus === "requesting";

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
      navigation.replace("RobotaxiPrototypeReceipt", { fromTrip: true });
      return;
    }

    if (passengerAutoRoute === "RobotaxiPrototypeDriverSearch") {
      navigation.replace("RobotaxiPrototypeDriverSearch", {
        destination,
        vehicle,
      });
      return;
    }

    if (passengerAutoRoute === "RobotaxiPrototypeTrip") {
      navigation.replace("RobotaxiPrototypeTrip", {
        destination,
        vehicle,
        driverName: driverInfo?.name || "Motorista",
      });
    }
  }, [destination, driverInfo?.name, navigation, passengerAutoRoute, vehicle]);

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
            />

            <View style={styles.rowButtons}>
              <TouchableOpacity
                style={styles.secondaryButton}
                activeOpacity={0.86}
                onPress={() => navigation.navigate("RobotaxiPrototypeSupport")}
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
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    paddingHorizontal: 28,
    paddingTop: 16,
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
    fontSize: typography.subtitle.size,
    lineHeight: typography.subtitle.lineHeight,
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
    minHeight: 46,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: color.border.strong,
    backgroundColor: color.surface.secondary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  secondaryButtonText: {
    color: color.text.primary,
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight,
  },
});
