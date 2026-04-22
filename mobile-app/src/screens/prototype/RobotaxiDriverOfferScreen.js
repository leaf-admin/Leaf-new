import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
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
import {
  getDriverOfferPayoutLabel,
  hasAuthoritativeDriverOfferPricing,
  selectDisplayableDriverOffer,
} from "./driverOfferPricingSnapshot";

const { color } = robotaxiPrototypeTokens;
const SHEET_TOP_OFFSET = 8;
const SHEET_BOTTOM_OFFSET = 8;
const FALLBACK_CARD_HEIGHT = 474;

function isCompetitiveAcceptLossMessage(message) {
  return String(message || "")
    .trim()
    .toLowerCase()
    .includes("outro motorista aceitou");
}

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function formatCurrency(value) {
  return `R$ ${toNumber(value, 0).toFixed(2).replace(".", ",")}`;
}

export default function RobotaxiDriverOfferScreen({ navigation, route }) {
  const { driverOffers, acceptDriverOffer, rejectDriverOffer, lastError } =
    usePrototypeRideRuntime();
  const insets = useSafeAreaInsets();
  const [cardHeight, setCardHeight] = useState(FALLBACK_CARD_HEIGHT);
  const [busyAction, setBusyAction] = useState("");
  const sheetTop = insets.top + SHEET_TOP_OFFSET;
  const sheetBottom = insets.bottom + SHEET_BOTTOM_OFFSET;
  const routeRequest = useMemo(() => {
    const candidate = route?.params?.request;
    if (
      (candidate?.bookingId || candidate?.id) &&
      hasAuthoritativeDriverOfferPricing(candidate)
    ) {
      return candidate;
    }
    return null;
  }, [route?.params?.request]);
  const [allowRouteFallback, setAllowRouteFallback] = useState(
    Boolean(routeRequest),
  );
  const hadVisibleRequestRef = useRef(false);

  const liveRequest = useMemo(
    () => selectDisplayableDriverOffer(driverOffers),
    [driverOffers],
  );

  const request = useMemo(() => {
    return liveRequest || (allowRouteFallback ? routeRequest : null);
  }, [allowRouteFallback, liveRequest, routeRequest]);

  const hasRequest = Boolean(request?.bookingId || request?.id);

  const distanceMi = useMemo(() => {
    if (!hasRequest) {
      return null;
    }

    const directMiles = toNumber(request?.distanceMi ?? request?.distance, NaN);
    if (Number.isFinite(directMiles) && directMiles > 0) {
      return directMiles;
    }

    const distanceKm = toNumber(request?.distanceKm, NaN);
    if (Number.isFinite(distanceKm) && distanceKm > 0) {
      return distanceKm * 0.621371;
    }

    return null;
  }, [hasRequest, request?.distance, request?.distanceKm, request?.distanceMi]);

  const passengerRating = useMemo(() => {
    if (!hasRequest) {
      return null;
    }

    const rating = toNumber(request?.passengerRating ?? request?.rating, NaN);
    if (!Number.isFinite(rating)) {
      return null;
    }

    return Math.min(5, Math.max(0, rating));
  }, [hasRequest, request?.passengerRating, request?.rating]);

  const fareLabel = useMemo(() => {
    if (!hasRequest) {
      return "--";
    }

    return getDriverOfferPayoutLabel(request) || "--";
  }, [hasRequest, request]);

  const estimatedFees = useMemo(() => {
    const operational = toNumber(request?.estimatedOperationalFee, NaN);
    const intermediation = toNumber(
      request?.estimatedPaymentIntermediationFee,
      NaN,
    );
    const total = toNumber(request?.estimatedTotalFees, NaN);
    const net = toNumber(request?.estimatedDriverNetAmount, NaN);
    return {
      operational,
      intermediation,
      total,
      net,
      hasAny:
        Number.isFinite(operational) ||
        Number.isFinite(intermediation) ||
        Number.isFinite(total) ||
        Number.isFinite(net),
    };
  }, [
    request?.estimatedDriverNetAmount,
    request?.estimatedOperationalFee,
    request?.estimatedPaymentIntermediationFee,
    request?.estimatedTotalFees,
  ]);
  const fareBadgeLabel = Number.isFinite(estimatedFees.net)
    ? "Líquido"
    : "Tarifa";
  const pickupLabel =
    String(request?.pickup || request?.pickupAddress || "").trim() ||
    "Origem indisponível";
  const dropoffLabel =
    String(request?.dropoff || request?.dropoffAddress || "").trim() ||
    "Destino indisponível";

  usePrototypeMapOcclusion({
    routeKey: route?.key,
    layerId: route?.key || "prototype-driver-offer",
    occludedBottom: sheetBottom + cardHeight,
  });

  const handleDismiss = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate("RobotaxiPrototype");
  }, [navigation]);

  useEffect(() => {
    setAllowRouteFallback(Boolean(routeRequest));
  }, [routeRequest]);

  useEffect(() => {
    if (!routeRequest || liveRequest) {
      return undefined;
    }

    const timeoutId = setTimeout(() => {
      setAllowRouteFallback(false);
    }, 800);

    return () => clearTimeout(timeoutId);
  }, [liveRequest, routeRequest]);

  useEffect(() => {
    if (hasRequest) {
      hadVisibleRequestRef.current = true;
      return undefined;
    }

    if (!hadVisibleRequestRef.current || busyAction) {
      return undefined;
    }

    const timeoutId = setTimeout(() => {
      handleDismiss();
    }, 250);

    return () => clearTimeout(timeoutId);
  }, [busyAction, handleDismiss, hasRequest]);

  const handleCardLayout = useCallback((event) => {
    const nextHeight = event?.nativeEvent?.layout?.height;
    if (Number.isFinite(nextHeight) && nextHeight > 0) {
      setCardHeight(nextHeight);
    }
  }, []);

  const handleAccept = useCallback(async () => {
    if (!hasRequest || !request) {
      return;
    }

    try {
      setBusyAction("accept");
      await acceptDriverOffer(request);
      navigation.navigate("RobotaxiPrototypeDriverTrip", { request });
    } catch (error) {
      if (isCompetitiveAcceptLossMessage(error?.message || error)) {
        navigation.goBack();
        return;
      }
      Alert.alert(
        "Não foi possível aceitar",
        error?.message || "Falha ao aceitar corrida.",
      );
    } finally {
      setBusyAction("");
    }
  }, [acceptDriverOffer, hasRequest, navigation, request]);

  const handleReject = useCallback(async () => {
    if (!hasRequest || !request) {
      return;
    }

    try {
      setBusyAction("reject");
      await rejectDriverOffer(request, "Recusada pelo motorista.");
      navigation.goBack();
    } catch (error) {
      Alert.alert(
        "Não foi possível recusar",
        error?.message || "Falha ao recusar corrida.",
      );
    } finally {
      setBusyAction("");
    }
  }, [hasRequest, navigation, rejectDriverOffer, request]);

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
          <PrototypeCard onLayout={handleCardLayout} style={styles.offerCard}>
            <CardHandle />

            <ScrollView
              bounces={false}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.scrollContent}
            >
              {hasRequest ? (
                <>
                  <View style={styles.headerRow}>
                    <View style={styles.headerInfo}>
                      <Text style={styles.headerEyebrow}>Nova solicitação</Text>
                      <Text style={styles.headerTitle}>
                        Detalhes da corrida
                      </Text>
                    </View>
                    <View style={styles.fareBadge}>
                      <Text style={styles.fareBadgeLabel}>
                        {fareBadgeLabel}
                      </Text>
                      <Text style={styles.fareBadgeValue}>{fareLabel}</Text>
                    </View>
                  </View>

                  <View style={styles.metricsRow}>
                    <View style={styles.metricCard}>
                      <View
                        style={[
                          styles.metricIconWrap,
                          styles.metricIconDistance,
                        ]}
                      >
                        <Ionicons
                          name="git-network-outline"
                          size={16}
                          color="#1A7F37"
                        />
                      </View>
                      <View>
                        <Text style={styles.metricLabel}>Distância</Text>
                        <Text style={styles.metricValue}>
                          {distanceMi == null
                            ? "--"
                            : `${distanceMi.toFixed(1)} mi`}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.metricCard}>
                      <View
                        style={[styles.metricIconWrap, styles.metricIconRating]}
                      >
                        <Ionicons
                          name="star-outline"
                          size={16}
                          color="#486070"
                        />
                      </View>
                      <View>
                        <Text style={styles.metricLabel}>Avaliação</Text>
                        <Text style={styles.metricValue}>
                          {passengerRating == null
                            ? "--"
                            : passengerRating.toFixed(1)}
                        </Text>
                      </View>
                    </View>
                  </View>

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

                    {estimatedFees.hasAny ? (
                      <View style={styles.feeBreakdown}>
                        <View style={styles.feeBreakdownHeader}>
                          <Ionicons
                            name="receipt-outline"
                            size={15}
                            color="#365A6D"
                          />
                          <Text style={styles.feeBreakdownTitle}>
                            Breakdown estimado
                          </Text>
                        </View>

                        {Number.isFinite(estimatedFees.operational) ? (
                          <Text style={styles.feeBreakdownItem}>
                            Operacional:{" "}
                            {formatCurrency(estimatedFees.operational)}
                          </Text>
                        ) : null}
                        {Number.isFinite(estimatedFees.intermediation) ? (
                          <Text style={styles.feeBreakdownItem}>
                            Intermediação:{" "}
                            {formatCurrency(estimatedFees.intermediation)}
                          </Text>
                        ) : null}
                        {Number.isFinite(estimatedFees.total) ? (
                          <Text style={styles.feeBreakdownItem}>
                            Taxas totais: {formatCurrency(estimatedFees.total)}
                          </Text>
                        ) : null}
                        {Number.isFinite(estimatedFees.net) ? (
                          <Text style={styles.feeBreakdownItemStrong}>
                            Líquido estimado:{" "}
                            {formatCurrency(estimatedFees.net)}
                          </Text>
                        ) : null}
                      </View>
                    ) : null}
                  </View>

                  <PrototypePrimaryButton
                    label={
                      busyAction === "accept"
                        ? "Aceitando..."
                        : "Aceitar corrida"
                    }
                    icon="arrow-forward"
                    testID="driver-offer-screen-accept-button"
                    accessibilityLabel="driver-offer-screen-accept-button"
                    onPress={busyAction ? undefined : handleAccept}
                    style={styles.acceptButton}
                  />

                  <TouchableOpacity
                    style={styles.rejectButtonGhost}
                    activeOpacity={0.86}
                    onPress={busyAction ? undefined : handleReject}
                    testID="driver-offer-screen-reject-button"
                    accessibilityLabel="driver-offer-screen-reject-button"
                  >
                    <Text style={styles.rejectText}>
                      {busyAction === "reject" ? "Recusando..." : "Recusar"}
                    </Text>
                  </TouchableOpacity>
                </>
              ) : (
                <View style={styles.emptyWrap}>
                  <Text style={styles.emptyTitle}>Sem corrida no momento</Text>
                  <Text style={styles.emptyText}>
                    A próxima oferta aparecerá aqui assim que houver uma
                    solicitação ativa.
                  </Text>
                  <PrototypePrimaryButton
                    label="Voltar para o mapa"
                    icon="map-outline"
                    onPress={() => navigation.navigate("RobotaxiPrototype")}
                    style={styles.emptyButton}
                  />
                </View>
              )}

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
  offerCard: {
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
    alignItems: "flex-start",
    gap: 10,
  },
  headerInfo: {
    flex: 1,
  },
  headerEyebrow: {
    color: "#1A7F37",
    fontFamily: fonts.SemiBold,
    fontSize: 12,
    lineHeight: 14,
    letterSpacing: 1.3,
    textTransform: "uppercase",
  },
  headerTitle: {
    marginTop: 4,
    color: color.text.primary,
    fontFamily: fonts.Bold,
    fontSize: 22,
    lineHeight: 26,
    letterSpacing: -0.6,
  },
  fareBadge: {
    minWidth: 112,
    borderRadius: 18,
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: "rgba(226,229,163,0.82)",
    alignItems: "center",
  },
  fareBadgeLabel: {
    color: "#6C6D3C",
    fontFamily: fonts.SemiBold,
    fontSize: 11.5,
    lineHeight: 14,
    textTransform: "uppercase",
    letterSpacing: 0.7,
  },
  fareBadgeValue: {
    marginTop: 2,
    color: "#4B4A27",
    fontFamily: fonts.Bold,
    fontSize: 23,
    lineHeight: 25,
  },
  metricsRow: {
    marginTop: 12,
    flexDirection: "row",
    gap: 8,
  },
  metricCard: {
    flex: 1,
    minHeight: 76,
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 10,
    backgroundColor: color.surface.secondary,
    borderWidth: 1,
    borderColor: color.border.subtle,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  metricIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  metricIconDistance: {
    backgroundColor: "rgba(164,226,176,0.58)",
  },
  metricIconRating: {
    backgroundColor: "rgba(208,225,236,0.65)",
  },
  metricLabel: {
    color: color.text.secondary,
    fontFamily: fonts.SemiBold,
    fontSize: 11.5,
    lineHeight: 14,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  metricValue: {
    marginTop: 2,
    color: color.text.primary,
    fontFamily: fonts.Bold,
    fontSize: 23,
    lineHeight: 27,
  },
  routeCard: {
    marginTop: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: color.border.subtle,
    backgroundColor: color.surface.secondary,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  routeRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  routeDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 3,
    marginTop: 2,
  },
  routeDotPickup: {
    borderColor: "#1A7F37",
    backgroundColor: "rgba(26,127,55,0.16)",
  },
  routeDotDropoff: {
    borderColor: "#5D7382",
    backgroundColor: "rgba(93,115,130,0.17)",
  },
  routeTextWrap: {
    flex: 1,
  },
  routeLabel: {
    color: "#2B6345",
    fontFamily: fonts.SemiBold,
    fontSize: 12,
    lineHeight: 14.5,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  routeValue: {
    marginTop: 2,
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: 16,
    lineHeight: 20,
  },
  routeDivider: {
    marginLeft: 8,
    width: 2,
    height: 34,
    backgroundColor: "rgba(176,186,193,0.75)",
    marginVertical: 6,
  },
  feeBreakdown: {
    marginTop: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(93,115,130,0.18)",
    backgroundColor: "rgba(208,225,236,0.44)",
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  feeBreakdownHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  feeBreakdownTitle: {
    color: "#365A6D",
    fontFamily: fonts.SemiBold,
    fontSize: 12,
    lineHeight: 15,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  feeBreakdownItem: {
    marginTop: 4,
    color: "#365A6D",
    fontFamily: fonts.Medium,
    fontSize: 13,
    lineHeight: 16,
  },
  feeBreakdownItemStrong: {
    marginTop: 5,
    color: "#1F3440",
    fontFamily: fonts.SemiBold,
    fontSize: 13,
    lineHeight: 16,
  },
  acceptButton: {
    marginTop: 14,
    minHeight: 58,
    borderRadius: 20,
  },
  rejectButtonGhost: {
    marginTop: 8,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  rejectText: {
    color: "#3D4853",
    fontFamily: fonts.SemiBold,
    fontSize: 14,
    lineHeight: 18,
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  errorText: {
    marginTop: 8,
    color: "#8A1F2B",
    fontFamily: fonts.Medium,
    fontSize: 13,
    lineHeight: 17,
  },
  emptyWrap: {
    marginTop: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: color.border.subtle,
    backgroundColor: color.surface.secondary,
    paddingHorizontal: 14,
    paddingVertical: 16,
  },
  emptyTitle: {
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: 18,
    lineHeight: 22,
  },
  emptyText: {
    marginTop: 6,
    color: color.text.secondary,
    fontFamily: fonts.Medium,
    fontSize: 13,
    lineHeight: 18,
  },
  emptyButton: {
    marginTop: 12,
  },
});
