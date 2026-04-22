import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActionSheetIOS,
  Alert,
  Linking,
  Platform,
  ScrollView,
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

const { color } = robotaxiPrototypeTokens;
const SHEET_TOP_OFFSET = 8;
const SHEET_BOTTOM_OFFSET = 8;
const FALLBACK_CARD_HEIGHT = 384;

function resolveDriverTripPrimaryActionTestID(status) {
  const normalizedStatus = String(status || "")
    .trim()
    .toLowerCase();

  if (normalizedStatus === "accepted") {
    return "driver-live-primary-action-arrive-button";
  }

  if (normalizedStatus === "arrived") {
    return "driver-live-primary-action-start-button";
  }

  if (normalizedStatus === "started") {
    return "driver-live-primary-action-complete-button";
  }

  return "driver-live-primary-action-button";
}

function formatCurrency(value) {
  return `R$ ${Number(value || 0)
    .toFixed(2)
    .replace(".", ",")}`;
}

function formatDistanceLabel(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "--";
  }

  const fractionDigits = numeric >= 10 ? 0 : numeric >= 2 ? 1 : 2;
  return `${numeric.toFixed(fractionDigits).replace(".", ",")} km`;
}

function resolveDisplayNetAmount(request, driverTripMeta, selectedFare) {
  const preferredPositiveAmount =
    [
      request?.estimatedDriverNetAmount,
      request?.driverNetAmount,
      driverTripMeta?.fare,
      selectedFare,
      request?.fare,
    ].find((value) => Number.isFinite(Number(value)) && Number(value) > 0) ?? null;

  if (preferredPositiveAmount !== null) {
    return Number(preferredPositiveAmount);
  }

  const firstKnownAmount =
    [
      request?.estimatedDriverNetAmount,
      request?.driverNetAmount,
      driverTripMeta?.fare,
      selectedFare,
      request?.fare,
    ].find((value) => Number.isFinite(Number(value))) ?? null;

  return firstKnownAmount === null ? null : Number(firstKnownAmount);
}

export default function RobotaxiDriverTripScreen({ navigation, route }) {
  const {
    bookingStatus,
    driverActiveRide,
    driverTripMeta,
    selectedDestination,
    selectedFare,
    currentAddress,
    tripDistanceKm,
    tripDurationMin,
    tripArrivalText,
    boardingRemainingSec,
    markDriverArrived,
    startTripFlow,
    completeTripFlow,
    lastError,
  } = usePrototypeRideRuntime();
  const insets = useSafeAreaInsets();
  const [cardHeight, setCardHeight] = useState(FALLBACK_CARD_HEIGHT);
  const [busyAction, setBusyAction] = useState(false);
  const sheetTop = insets.top + SHEET_TOP_OFFSET;
  const sheetBottom = insets.bottom + SHEET_BOTTOM_OFFSET;

  const request = useMemo(() => {
    if (route?.params?.request?.bookingId || route?.params?.request?.id) {
      return route.params.request;
    }

    if (driverActiveRide?.bookingId || driverActiveRide?.id) {
      return driverActiveRide;
    }

    return null;
  }, [driverActiveRide, route?.params?.request]);
  const hasActiveRide = Boolean(request?.bookingId || request?.id);
  const normalizedBookingStatus = String(bookingStatus || request?.status || "")
    .trim()
    .toLowerCase();
  const pickupLabel =
    String(
      request?.pickup || request?.pickupAddress || currentAddress || "",
    ).trim() || "Embarque indisponível";
  const dropoffLabel =
    String(
      request?.dropoff ||
        request?.dropoffAddress ||
        selectedDestination?.name ||
        "",
    ).trim() || "Destino indisponível";
  const tripFareValue = resolveDisplayNetAmount(
    request,
    driverTripMeta,
    selectedFare,
  );
  const tripFareLabel = Number.isFinite(tripFareValue)
    ? formatCurrency(tripFareValue)
    : "--";
  const passengerLabel =
    String(
      request?.passengerName ||
        request?.passenger ||
        request?.customerName ||
        request?.customer?.name ||
        "Passageiro Leaf",
    ).trim() || "Passageiro Leaf";

  const phase = useMemo(() => {
    if (!hasActiveRide) {
      return {
        chip: "Sem corrida",
        title: "Nenhuma corrida ativa",
        subtitle: "Volte ao painel para aguardar novas solicitações.",
        primaryLabel: "Voltar ao painel",
      };
    }
    if (normalizedBookingStatus === "accepted") {
      return {
        chip: "Embarque",
        title: `Dirija até o local de embarque de ${passengerLabel}`,
        subtitle: `Tempo estimado até o embarque: ${Math.max(2, Number(tripDurationMin || 4))} min`,
        primaryLabel: "Cheguei ao embarque",
      };
    }
    if (normalizedBookingStatus === "arrived") {
      return {
        chip: "Aguardando",
        title: "Passageiro em embarque",
        subtitle: "Confirme o embarque e inicie a corrida.",
        primaryLabel: "Iniciar viagem",
      };
    }
    if (normalizedBookingStatus === "started") {
      return {
        chip: "Em rota",
        title: "Viagem em andamento",
        subtitle: "Siga para o destino e finalize ao desembarque.",
        primaryLabel: "Finalizar corrida",
      };
    }
    return {
      chip: "Status",
      title: "Corrida em atualização",
      subtitle: "Sincronizando estado atual da viagem.",
      primaryLabel: "Voltar ao painel",
    };
  }, [hasActiveRide, normalizedBookingStatus, passengerLabel, tripDurationMin]);

  const boardingCountdownLabel =
    Number.isFinite(boardingRemainingSec) && boardingRemainingSec > 0
      ? `${Math.floor(boardingRemainingSec / 60)}:${String(boardingRemainingSec % 60).padStart(2, "0")}`
      : null;
  const primaryActionTestID =
    resolveDriverTripPrimaryActionTestID(normalizedBookingStatus);

  useEffect(() => {
    if (bookingStatus === "completed") {
      navigation.navigate("RobotaxiPrototypeReceipt", { fromTrip: true });
    }
  }, [bookingStatus, navigation]);

  usePrototypeMapOcclusion({
    routeKey: route?.key,
    layerId: route?.key || "prototype-driver-trip",
    occludedBottom: sheetBottom + cardHeight,
  });

  const handleDismiss = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
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

  const handlePrimaryAction = useCallback(async () => {
    if (busyAction) {
      return;
    }

    if (!hasActiveRide) {
      navigation.navigate("RobotaxiPrototype");
      return;
    }

    try {
      setBusyAction(true);

      if (normalizedBookingStatus === "accepted") {
        await markDriverArrived();
        return;
      }

      if (normalizedBookingStatus === "arrived") {
        await startTripFlow();
        return;
      }

      if (normalizedBookingStatus === "started") {
        await completeTripFlow();
        navigation.navigate("RobotaxiPrototypeReceipt", { fromTrip: true });
        return;
      }

      navigation.navigate("RobotaxiPrototype");
    } catch (error) {
      Alert.alert(
        "Não foi possível atualizar",
        error?.message || "Falha ao atualizar corrida.",
      );
    } finally {
      setBusyAction(false);
    }
  }, [
    busyAction,
    completeTripFlow,
    hasActiveRide,
    markDriverArrived,
    navigation,
    normalizedBookingStatus,
    startTripFlow,
  ]);

  const handleOpenNavigation = useCallback(async () => {
    if (!hasActiveRide) {
      Alert.alert(
        "Nenhuma corrida ativa",
        "Aguarde uma nova solicitação antes de abrir a navegação.",
      );
      return;
    }

    const destinationCoordinate =
      request?.destinationCoordinate || selectedDestination?.coordinate || null;

    if (
      !destinationCoordinate ||
      !Number.isFinite(
        Number(destinationCoordinate.latitude ?? destinationCoordinate.lat),
      ) ||
      !Number.isFinite(
        Number(destinationCoordinate.longitude ?? destinationCoordinate.lng),
      )
    ) {
      Alert.alert(
        "Destino indisponível",
        "Não foi possível localizar o destino desta corrida no momento.",
      );
      return;
    }

    const latitude = Number(
      destinationCoordinate.latitude ?? destinationCoordinate.lat,
    );
    const longitude = Number(
      destinationCoordinate.longitude ?? destinationCoordinate.lng,
    );
    const googleAppUrl = `comgooglemaps://?daddr=${latitude},${longitude}&directionsmode=driving`;
    const googleWebUrl = `https://maps.google.com/?daddr=${latitude},${longitude}&directionsmode=driving`;
    const wazeAppUrl = `waze://?ll=${latitude},${longitude}&navigate=yes`;
    const wazeWebUrl = `https://waze.com/ul?ll=${latitude},${longitude}&navigate=yes`;

    const openGoogleMaps = async () => {
      const canOpenNative = await Linking.canOpenURL(googleAppUrl);
      await Linking.openURL(canOpenNative ? googleAppUrl : googleWebUrl);
    };

    const openWaze = async () => {
      const canOpenNative = await Linking.canOpenURL(wazeAppUrl);
      await Linking.openURL(canOpenNative ? wazeAppUrl : wazeWebUrl);
    };

    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ["Cancelar", "Google Maps", "Waze"],
          cancelButtonIndex: 0,
        },
        async (selectedIndex) => {
          try {
            if (selectedIndex === 1) {
              await openGoogleMaps();
            } else if (selectedIndex === 2) {
              await openWaze();
            }
          } catch (error) {
            Alert.alert(
              "Não foi possível abrir a navegação",
              error?.message || "Tente novamente.",
            );
          }
        },
      );
      return;
    }

    Alert.alert("Escolher navegação", "Selecione o app para abrir a rota.", [
      { text: "Cancelar", style: "cancel" },
      { text: "Google Maps", onPress: () => openGoogleMaps().catch(() => {}) },
      { text: "Waze", onPress: () => openWaze().catch(() => {}) },
    ]);
  }, [
    hasActiveRide,
    request?.destinationCoordinate,
    selectedDestination?.coordinate,
  ]);

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
          sheetStyle={[
            styles.sheetWrap,
            { top: sheetTop, bottom: sheetBottom },
          ]}
        >
          <PrototypeCard onLayout={handleCardLayout} style={styles.tripCard}>
            <CardHandle />
            <ScrollView
              bounces={false}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.scrollContent}
            >
              {hasActiveRide ? (
                <>
                  <View style={styles.headerRow}>
                    <View style={styles.phaseChip}>
                      <Text style={styles.phaseChipText}>{phase.chip}</Text>
                    </View>
                    <Text style={styles.phaseEta}>
                      {Math.max(2, Number(tripDurationMin || 4))} min
                    </Text>
                  </View>

                  <Text style={styles.phaseTitle}>{phase.title}</Text>
                  <Text style={styles.phasePassengerCaption}>
                    {`Passageiro: ${passengerLabel}`}
                  </Text>
                  <Text style={styles.phaseSubtitle}>
                    {normalizedBookingStatus === "arrived" &&
                    boardingCountdownLabel
                      ? `Embarque em até ${boardingCountdownLabel}`
                      : phase.subtitle}
                  </Text>
                  {tripArrivalText ? (
                    <Text style={styles.phaseHint}>{tripArrivalText}</Text>
                  ) : null}

                  <View style={styles.routeCard}>
                    <View style={styles.routeRow}>
                      <View style={[styles.routeDot, styles.routeDotPickup]} />
                      <View style={styles.routeTextWrap}>
                        <Text style={styles.routeLabel}>Embarque</Text>
                        <Text style={styles.routeValue}>{pickupLabel}</Text>
                      </View>
                    </View>

                    <View style={styles.routeDivider} />

                    <View style={styles.routeRow}>
                      <View style={[styles.routeDot, styles.routeDotDropoff]} />
                      <View style={styles.routeTextWrap}>
                        <Text style={styles.routeLabel}>Destino</Text>
                        <Text style={styles.routeValue}>{dropoffLabel}</Text>
                      </View>
                    </View>
                  </View>

                  <View style={styles.summaryRow}>
                    <View style={styles.summaryBox}>
                      <Text style={styles.summaryLabel}>Líquido</Text>
                      <Text style={styles.summaryValue}>{tripFareLabel}</Text>
                    </View>
                    <View style={styles.summaryBox}>
                      <Text style={styles.summaryLabel}>Distância</Text>
                      <Text style={styles.summaryValue}>
                        {formatDistanceLabel(tripDistanceKm)}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.actionsRow}>
                    <TouchableOpacity
                      style={styles.secondaryButton}
                      activeOpacity={0.86}
                      onPress={() =>
                        navigation.navigate("RobotaxiPrototypeChat")
                      }
                    >
                      <Ionicons
                        name="chatbubble-ellipses-outline"
                        size={16}
                        color={color.text.primary}
                      />
                      <Text style={styles.secondaryButtonText}>Chat</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.secondaryButton}
                      activeOpacity={0.86}
                      onPress={handleOpenNavigation}
                    >
                      <Ionicons
                        name="navigate-outline"
                        size={16}
                        color={color.text.primary}
                      />
                      <Text style={styles.secondaryButtonText}>Navegar</Text>
                    </TouchableOpacity>
                  </View>
                </>
              ) : (
                <View style={styles.emptyWrap}>
                  <Text style={styles.emptyTitle}>{phase.title}</Text>
                  <Text style={styles.emptyText}>{phase.subtitle}</Text>
                </View>
              )}

              <PrototypePrimaryButton
                label={busyAction ? "Atualizando..." : phase.primaryLabel}
                icon="arrow-forward"
                testID={primaryActionTestID}
                accessibilityLabel={primaryActionTestID}
                onPress={busyAction ? undefined : handlePrimaryAction}
                style={styles.primaryButton}
              />

              {lastError ? (
                <Text style={styles.errorText}>{lastError}</Text>
              ) : null}
            </ScrollView>
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
  tripCard: {
    flex: 1,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 12,
  },
  scrollContent: {
    paddingBottom: 8,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  phaseChip: {
    minHeight: 30,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(26,127,55,0.25)",
    backgroundColor: "rgba(26,127,55,0.12)",
    paddingHorizontal: 10,
    justifyContent: "center",
  },
  phaseChipText: {
    color: "#1A7F37",
    fontFamily: fonts.SemiBold,
    fontSize: 12,
    lineHeight: 15,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  phaseEta: {
    color: color.text.secondary,
    fontFamily: fonts.Medium,
    fontSize: 13,
    lineHeight: 16,
  },
  phaseTitle: {
    marginTop: 8,
    color: color.text.primary,
    fontFamily: fonts.Bold,
    fontSize: 22,
    lineHeight: 26,
    letterSpacing: -0.55,
  },
  phaseSubtitle: {
    marginTop: 2,
    color: color.text.secondary,
    fontFamily: fonts.Medium,
    fontSize: 13,
    lineHeight: 17,
  },
  phasePassengerCaption: {
    marginTop: 6,
    color: color.text.secondary,
    fontFamily: fonts.Medium,
    fontSize: 13,
    lineHeight: 17,
  },
  phaseHint: {
    marginTop: 4,
    color: color.text.secondary,
    fontFamily: fonts.Regular,
    fontSize: 12.5,
    lineHeight: 16,
  },
  routeCard: {
    marginTop: 10,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: color.border.subtle,
    backgroundColor: color.surface.secondary,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  routeRow: {
    flexDirection: "row",
    gap: 10,
  },
  routeDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 3,
    marginTop: 1,
  },
  routeDotPickup: {
    borderColor: "#1A7F37",
    backgroundColor: "rgba(26,127,55,0.12)",
  },
  routeDotDropoff: {
    borderColor: "#5D7382",
    backgroundColor: "rgba(93,115,130,0.14)",
  },
  routeTextWrap: {
    flex: 1,
  },
  routeLabel: {
    color: "#3E5F4A",
    fontFamily: fonts.SemiBold,
    fontSize: 11.5,
    lineHeight: 14,
    letterSpacing: 0.9,
    textTransform: "uppercase",
  },
  routeValue: {
    marginTop: 2,
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: 15,
    lineHeight: 19,
  },
  routeDivider: {
    marginLeft: 8,
    width: 2,
    height: 32,
    backgroundColor: "rgba(172,184,192,0.74)",
    marginVertical: 6,
  },
  summaryRow: {
    marginTop: 10,
    flexDirection: "row",
    gap: 8,
  },
  summaryBox: {
    flex: 1,
    minHeight: 74,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: color.border.subtle,
    backgroundColor: color.surface.secondary,
    paddingHorizontal: 10,
    paddingVertical: 10,
    justifyContent: "center",
  },
  summaryLabel: {
    color: color.text.secondary,
    fontFamily: fonts.SemiBold,
    fontSize: 11.5,
    lineHeight: 14,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  summaryValue: {
    marginTop: 3,
    color: color.text.primary,
    fontFamily: fonts.Bold,
    fontSize: 20,
    lineHeight: 24,
  },
  actionsRow: {
    marginTop: 10,
    flexDirection: "row",
    gap: 8,
  },
  secondaryButton: {
    flex: 1,
    minHeight: 48,
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
    fontSize: 13.5,
    lineHeight: 17,
  },
  primaryButton: {
    minHeight: 48,
    marginTop: 10,
  },
  emptyWrap: {
    marginTop: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: color.border.subtle,
    backgroundColor: color.surface.secondary,
    paddingHorizontal: 12,
    paddingVertical: 14,
  },
  emptyTitle: {
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: 16,
    lineHeight: 20,
  },
  emptyText: {
    marginTop: 4,
    color: color.text.secondary,
    fontFamily: fonts.Regular,
    fontSize: 13,
    lineHeight: 17,
  },
  errorText: {
    marginTop: 8,
    color: "#8A1F2B",
    fontFamily: fonts.Medium,
    fontSize: 13,
    lineHeight: 17,
  },
});
