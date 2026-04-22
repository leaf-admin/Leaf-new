import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StatusBar, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fonts } from "../../theme/runtimeTokens";
import PrototypeScreenTransition from "../../components/prototype/PrototypeScreenTransition";
import PrototypeDismissibleSheet from "../../components/prototype/PrototypeDismissibleSheet";
import {
  CardHandle,
  PrototypeCard,
  PrototypePrimaryButton,
} from "../../components/prototype/PrototypeUI";
import DriverSearchRadar from "../../components/prototype/DriverSearchRadar";
import robotaxiPrototypeTokens from "../../components/design-system/robotaxiPrototypeTokens";
import { usePrototypeMapOcclusion } from "./prototypeMapOcclusion";
import {
  getSearchPresentation,
  SEARCH_STATUS_MESSAGES,
} from "./searchPresentation";
import { usePrototypeRideRuntime } from "./prototypeRideRuntime";
import useSearchElapsedClock from "./useSearchElapsedClock";
import { resolveMeaningfulAddress } from "./addressLabelUtils";

const { color, typography } = robotaxiPrototypeTokens;
const SHEET_BOTTOM_OFFSET = 96;
const FALLBACK_CARD_HEIGHT = 308;

function compactPlaceLabel(value, fallback) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return fallback;
  }

  const [firstChunk] = normalized.split(",");
  return String(firstChunk || normalized).trim() || fallback;
}

export default function RobotaxiDriverSearchScreen({ navigation, route }) {
  const {
    activeBooking,
    bookingStatus,
    searchingElapsedSeconds,
    selectedVehicle,
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
  const isSearchActive =
    bookingStatus === "searching" || bookingStatus === "requesting";
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
  const searchMilestoneLabel = searchPresentation.isMaxRadius
    ? "Buscando no maior raio disponível para esta corrida"
    : `Buscando em ${searchPresentation.diameterLabel} neste momento`;

  useEffect(() => {
    if (
      bookingStatus === "accepted" ||
      bookingStatus === "arrived" ||
      bookingStatus === "started"
    ) {
      navigation.navigate("RobotaxiPrototypeTrip", {
        destination,
        vehicle,
        elapsed,
        driverName: driverInfo?.name || "Motorista",
      });
    }
  }, [
    bookingStatus,
    destination,
    driverInfo?.name,
    elapsed,
    navigation,
    vehicle,
  ]);

  useEffect(() => {
    if (bookingStatus === "searching" || bookingStatus === "requesting") {
      terminalRouteHandledRef.current = false;
      return;
    }

    if (terminalRouteHandledRef.current) {
      return;
    }

    if (bookingStatus === "idle" && lastError) {
      terminalRouteHandledRef.current = true;
      if (/pagamento|payment/i.test(lastError)) {
        navigation.replace("RobotaxiPrototypePaymentFailed", {
          errorMessage: lastError,
          retryRouteName: "RobotaxiPrototypeDestination",
          retryParams: {},
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
  }, [bookingStatus, lastError, navigation]);

  const handleDismiss = () => {
    if (bookingStatus === "searching" || bookingStatus === "requesting") {
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

        <View pointerEvents="none" style={styles.radarWrap}>
          <DriverSearchRadar />
        </View>

        <PrototypeDismissibleSheet
          onClose={handleDismiss}
          sheetStyle={[styles.sheetWrap, { bottom: sheetBottom }]}
        >
          <PrototypeCard onLayout={handleCardLayout} style={styles.searchingCard}>
            <CardHandle />

            <View style={styles.headerRow}>
              <View style={styles.headerCopy}>
                <Text style={styles.eyebrow}>Busca ativa</Text>
                <Text style={styles.title}>Procurando motorista</Text>
              </View>

              <View style={styles.metaPill}>
                <Text style={styles.metaPillText}>{vehicle}</Text>
              </View>
            </View>

            <View style={styles.timerCard}>
              <Text
                style={styles.timerValue}
                testID="passenger-driver-search-elapsed"
              >
                {searchPresentation.elapsedLabel}
              </Text>
              <Text style={styles.timerTotal}>
                de {searchPresentation.totalElapsedLabel} de janela ativa
              </Text>

              <View style={styles.progressTrack}>
                <View
                  testID="passenger-driver-search-progress-fill"
                  style={[
                    styles.progressFill,
                    {
                      width: `${Math.max(
                        0,
                        Math.round(searchPresentation.progress * 100),
                      )}%`,
                    },
                  ]}
                />
              </View>

              <View style={styles.progressLabelsRow}>
                <Text style={styles.progressLabelStrong}>
                  {searchPresentation.elapsedLabel}
                </Text>
                <Text style={styles.progressLabelMuted}>
                  {searchPresentation.totalElapsedLabel}
                </Text>
              </View>
            </View>

            <View style={styles.searchContextRow}>
              <Ionicons
                name="scan-outline"
                size={16}
                color="#0F766E"
                style={styles.searchContextIcon}
              />
              <Text style={styles.searchContextText}>{searchMilestoneLabel}</Text>
            </View>

            <View
              style={styles.messageCard}
              testID="passenger-driver-search-message-box"
            >
              <View style={styles.messageRow}>
                <View style={styles.messageBadge}>
                  <Ionicons
                    name="sparkles-outline"
                    size={16}
                    color="#0F766E"
                  />
                </View>

                <View style={styles.messageContent}>
                  <Text style={styles.messageLabel}>Atualização da busca</Text>
                  <Text
                    style={styles.messageText}
                    testID="passenger-driver-search-status-message"
                  >
                    {searchPresentation.statusMessage}
                  </Text>
                </View>
              </View>

              <View style={styles.messageDotsRow}>
                {SEARCH_STATUS_MESSAGES.map((message, index) => (
                  <View
                    key={message}
                    testID={`passenger-driver-search-message-dot-${index}`}
                    style={[
                      styles.messageDot,
                      index === searchPresentation.statusMessageIndex &&
                        styles.messageDotActive,
                    ]}
                  />
                ))}
              </View>
            </View>

            <View style={styles.routeCard}>
              <View style={styles.routeRow}>
                <View style={styles.routeIconWrap}>
                  <View style={styles.originDot} />
                </View>
                <View style={styles.routeTextWrap}>
                  <Text style={styles.routeCaption}>Partida</Text>
                  <Text style={styles.routeValue} numberOfLines={2}>
                    {originLabel}
                  </Text>
                </View>
              </View>

              <View style={styles.routeDivider} />

              <View style={styles.routeRow}>
                <View style={styles.routeIconWrap}>
                  <Ionicons
                    name="flag-outline"
                    size={14}
                    color="#0F766E"
                  />
                </View>
                <View style={styles.routeTextWrap}>
                  <Text style={styles.routeCaption}>Chegada</Text>
                  <Text style={styles.routeValue} numberOfLines={2}>
                    {destinationLabel}
                  </Text>
                </View>
              </View>
            </View>

            {lastError ? <Text style={styles.errorText}>{lastError}</Text> : null}

            <PrototypePrimaryButton
              label={
                bookingStatus === "requesting"
                  ? "Criando corrida..."
                  : "Cancelar busca"
              }
              onPress={
                bookingStatus === "requesting" ? undefined : handleDismiss
              }
              icon={
                bookingStatus === "requesting"
                  ? "time-outline"
                  : "close-circle-outline"
              }
              style={styles.actionButton}
              testID="passenger-driver-search-cancel-button"
              accessibilityLabel="passenger-driver-search-cancel-button"
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
  radarWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetWrap: {
    position: "absolute",
    left: 10,
    right: 10,
  },
  searchingCard: {
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 14,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  headerCopy: {
    flex: 1,
  },
  eyebrow: {
    color: "#0F766E",
    fontFamily: fonts.Medium,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  title: {
    marginTop: 2,
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: typography.title.size,
    lineHeight: typography.title.lineHeight,
  },
  metaPill: {
    minHeight: 30,
    paddingHorizontal: 12,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0F172A",
  },
  metaPillText: {
    color: "#F8FAFC",
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight,
  },
  timerCard: {
    marginTop: 14,
    borderRadius: 22,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 12,
    backgroundColor: "rgba(255,255,255,0.74)",
    borderWidth: 1,
    borderColor: "rgba(17,26,39,0.08)",
  },
  timerValue: {
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: 36,
    lineHeight: 40,
    textAlign: "center",
  },
  timerTotal: {
    marginTop: 2,
    color: color.text.secondary,
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight,
    textAlign: "center",
  },
  progressTrack: {
    marginTop: 12,
    height: 12,
    borderRadius: 999,
    overflow: "hidden",
    backgroundColor: "rgba(15,23,42,0.08)",
  },
  progressFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: "#0F766E",
  },
  progressLabelsRow: {
    marginTop: 8,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  progressLabelStrong: {
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight,
  },
  progressLabelMuted: {
    color: color.text.muted,
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight,
  },
  searchContextRow: {
    marginTop: 12,
    paddingHorizontal: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  searchContextIcon: {
    marginRight: 7,
  },
  searchContextText: {
    color: "#0F766E",
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight,
    textAlign: "center",
  },
  messageCard: {
    marginTop: 14,
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#F0FDFA",
    borderWidth: 1,
    borderColor: "rgba(13,148,136,0.16)",
  },
  messageRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  messageBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(13,148,136,0.12)",
  },
  messageContent: {
    flex: 1,
    marginLeft: 10,
  },
  messageLabel: {
    color: "#0F766E",
    fontFamily: fonts.Medium,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  messageText: {
    marginTop: 2,
    color: color.text.primary,
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: 18,
  },
  messageDotsRow: {
    marginTop: 10,
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
  },
  messageDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: "rgba(15,118,110,0.18)",
  },
  messageDotActive: {
    width: 18,
    backgroundColor: "#0F766E",
  },
  routeCard: {
    marginTop: 14,
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "rgba(255,255,255,0.72)",
    borderWidth: 1,
    borderColor: "rgba(17,26,39,0.08)",
  },
  routeRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  routeIconWrap: {
    width: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  originDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#0F766E",
  },
  routeTextWrap: {
    flex: 1,
    marginLeft: 8,
    minWidth: 0,
  },
  routeCaption: {
    color: color.text.muted,
    fontFamily: fonts.Medium,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  routeValue: {
    marginTop: 2,
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight,
  },
  routeDivider: {
    marginVertical: 9,
    marginLeft: 11,
    height: 18,
    width: 1,
    backgroundColor: "rgba(15,23,42,0.12)",
  },
  errorText: {
    marginTop: 8,
    color: "#8A1F2B",
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight,
    textAlign: "center",
  },
  actionButton: {
    marginTop: 10,
  },
});
