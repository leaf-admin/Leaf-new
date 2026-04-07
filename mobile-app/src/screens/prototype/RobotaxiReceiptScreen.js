import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from "react-native-maps";
import { StackActions } from "@react-navigation/native";
import { fonts } from "../../theme/runtimeTokens";
import PrototypeScreenTransition from "../../components/prototype/PrototypeScreenTransition";
import {
  CardHandle,
  PrototypeCard,
  PrototypePrimaryButton,
} from "../../components/prototype/PrototypeUI";
import robotaxiPrototypeTokens from "../../components/design-system/robotaxiPrototypeTokens";
import { usePrototypeMapOcclusion } from "./prototypeMapOcclusion";
import { usePrototypeRideRuntime } from "./prototypeRideRuntime";
import {
  formatCurrencyBRL,
  resolveTripFeeAmount,
  resolveTripGrossAmount,
  resolveTripNetAmount,
} from "./tripFinancialSummary";

const { color } = robotaxiPrototypeTokens;
const SHEET_TOP_OFFSET = 8;
const SHEET_BOTTOM_OFFSET = 8;
const FALLBACK_CARD_HEIGHT = 420;

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function formatCurrency(value) {
  return formatCurrencyBRL(value);
}

function formatDistanceKm(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "Em cálculo";
  }
  return `${numeric.toFixed(numeric >= 10 ? 0 : 1).replace(".", ",")} km`;
}

function formatDurationMin(value) {
  const numeric = Math.max(0, Math.round(toNumber(value, 0)));
  if (!numeric) {
    return "Em cálculo";
  }
  return `${numeric} min`;
}

function formatPaymentMethod(method) {
  const normalized = String(method || "")
    .trim()
    .toLowerCase();
  if (normalized === "pix") {
    return "PIX recebido";
  }
  if (
    normalized === "card" ||
    normalized === "cartão" ||
    normalized === "cartao"
  ) {
    return "Cartão confirmado";
  }
  return "Pagamento confirmado";
}

function splitLocationLabel(label = "") {
  const clean = String(label || "").trim();
  if (!clean) {
    return {
      title: "Endereço indisponível",
      subtitle: "",
    };
  }

  const separator = clean.indexOf(",");
  if (separator > 0 && separator < clean.length - 1) {
    return {
      title: clean.slice(0, separator).trim(),
      subtitle: clean.slice(separator + 1).trim(),
    };
  }

  return {
    title: clean,
    subtitle: "",
  };
}

function buildReceiptHistoryRouteParts(item = {}) {
  const directPickup = String(item?.pickup || "").trim();
  const directDrop = String(item?.drop || "").trim();
  if (directPickup || directDrop) {
    return {
      pickup: directPickup || "Origem indisponível",
      drop: directDrop || "Destino indisponível",
    };
  }

  const routeLabel = String(item?.route || "").trim();
  if (!routeLabel) {
    return {
      pickup: "Origem indisponível",
      drop: "Destino indisponível",
    };
  }

  const arrowIndex = routeLabel.includes("->")
    ? routeLabel.indexOf("->")
    : routeLabel.indexOf("→");

  if (arrowIndex > 0) {
    const pickup = routeLabel.slice(0, arrowIndex).trim();
    const drop = routeLabel
      .slice(arrowIndex + (routeLabel.includes("->") ? 2 : 1))
      .trim();
    return {
      pickup: pickup || "Origem indisponível",
      drop: drop || "Destino indisponível",
    };
  }

  return {
    pickup: routeLabel,
    drop: "Destino indisponível",
  };
}

function normalizeCoordinate(value) {
  const latitude = Number(value?.latitude ?? value?.lat);
  const longitude = Number(value?.longitude ?? value?.lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return { latitude, longitude };
}

function simplifyRouteCoordinates(coordinates = [], maxPoints = 24) {
  const sanitized = coordinates.map(normalizeCoordinate).filter(Boolean);
  if (sanitized.length <= maxPoints) {
    return sanitized;
  }

  const sampled = [sanitized[0]];
  const stride = Math.ceil((sanitized.length - 2) / Math.max(1, maxPoints - 2));
  for (let index = stride; index < sanitized.length - 1; index += stride) {
    sampled.push(sanitized[index]);
    if (sampled.length >= maxPoints - 1) {
      break;
    }
  }
  sampled.push(sanitized[sanitized.length - 1]);
  return sampled;
}

function buildRoutePreviewCoordinates({
  pickupCoordinate,
  destinationCoordinate,
  routeCoordinates = [],
}) {
  const origin = normalizeCoordinate(pickupCoordinate);
  const destination = normalizeCoordinate(destinationCoordinate);
  if (!origin || !destination) {
    return [];
  }

  const points = simplifyRouteCoordinates(routeCoordinates, 22);
  return points.length >= 2 ? points : [origin, destination];
}

function buildRoutePreviewRegion(coordinates = []) {
  if (!Array.isArray(coordinates) || coordinates.length === 0) {
    return null;
  }

  const latitudes = coordinates.map((point) => point.latitude);
  const longitudes = coordinates.map((point) => point.longitude);
  const minLatitude = Math.min(...latitudes);
  const maxLatitude = Math.max(...latitudes);
  const minLongitude = Math.min(...longitudes);
  const maxLongitude = Math.max(...longitudes);
  const latitudeDelta = Math.max((maxLatitude - minLatitude) * 1.7, 0.012);
  const longitudeDelta = Math.max((maxLongitude - minLongitude) * 1.7, 0.012);

  return {
    latitude: (minLatitude + maxLatitude) / 2,
    longitude: (minLongitude + maxLongitude) / 2,
    latitudeDelta,
    longitudeDelta,
  };
}

export default function RobotaxiReceiptScreen({ navigation, route }) {
  const {
    tripHistory,
    lastReceipt,
    activeRole,
    driverTripMeta,
    dismissCompletedReceipt,
  } =
    usePrototypeRideRuntime();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [cardHeight, setCardHeight] = useState(FALLBACK_CARD_HEIGHT);
  const [showFeeBreakdown, setShowFeeBreakdown] = useState(false);
  const [lastTouchProbe, setLastTouchProbe] = useState("");
  const runtimeHistory = Array.isArray(tripHistory) ? tripHistory : [];
  const [selectedId, setSelectedId] = useState(
    lastReceipt?.id || runtimeHistory[0]?.id || null,
  );
  const fromTrip = Boolean(route?.params?.fromTrip);
  const isDriverView = activeRole === "driver";
  const compactDriverLayout = isDriverView && windowHeight <= 920;

  useEffect(() => {
    if (lastReceipt?.id) {
      setSelectedId(lastReceipt.id);
      return;
    }

    if (
      !runtimeHistory.find((item) => item.id === selectedId) &&
      runtimeHistory[0]?.id
    ) {
      setSelectedId(runtimeHistory[0].id);
    }
  }, [lastReceipt?.id, runtimeHistory, selectedId]);

  useEffect(() => {
    setShowFeeBreakdown(false);
  }, [selectedId, lastReceipt?.id]);

  const selected = useMemo(() => {
    if (selectedId) {
      const fromHistory = runtimeHistory.find((item) => item.id === selectedId);
      if (fromHistory) {
        return fromHistory;
      }
    }

    if (lastReceipt?.id) {
      return lastReceipt;
    }

    return runtimeHistory[0] || null;
  }, [lastReceipt, runtimeHistory, selectedId]);

  const openRatingScreen = useCallback(
    (params) => {
      if (typeof navigation.dispatch === "function") {
        navigation.dispatch(
          StackActions.replace("RobotaxiPrototypeRating", params),
        );
        return;
      }

      navigation.navigate("RobotaxiPrototypeRating", params);
    },
    [navigation],
  );

  const openDriverReceiptRating = useCallback(() => {
    openRatingScreen({
      fromReceipt: true,
      reviewerType: "driver",
      tripId: selected?.id,
      targetUserId: selected?.passengerId || null,
      targetName: selected?.passengerName || "Passageiro Leaf",
      receipt: selected,
    });
  }, [openRatingScreen, selected]);

  const openPassengerReceiptRating = useCallback(() => {
    openRatingScreen({
      fromReceipt: true,
      reviewerType: "passenger",
      tripId: selected?.id,
      targetUserId: selected?.driverId || null,
      targetName: selected?.driverName || "Motorista Leaf",
      receipt: selected,
    });
  }, [openRatingScreen, selected]);

  const rawBaseFare = toNumber(selected?.baseFare, NaN);
  const rawVariableFare = toNumber(selected?.variableFare, NaN);
  const totalAmount = Math.max(0, resolveTripGrossAmount(selected));
  const hasExplicitBreakdown =
    Number.isFinite(rawBaseFare) &&
    Number.isFinite(rawVariableFare) &&
    rawBaseFare + rawVariableFare > 0;
  const fareAmount = hasExplicitBreakdown
    ? rawBaseFare
    : Number((totalAmount * 0.55).toFixed(2));
  const variableAmount = hasExplicitBreakdown
    ? rawVariableFare
    : Number(Math.max(0, totalAmount - fareAmount).toFixed(2));
  const totalAmountLabel = formatCurrency(totalAmount);
  const finalOperationalFee = toNumber(selected?.operationalFee, NaN);
  const finalIntermediationFee = toNumber(
    selected?.paymentIntermediationFee,
    NaN,
  );
  const resolvedFeeAmount = resolveTripFeeAmount(selected);
  const finalTotalFees = toNumber(resolvedFeeAmount, NaN);
  const finalDriverNetAmount = toNumber(resolveTripNetAmount(selected), NaN);
  const hasFinalFeeBreakdown =
    Number.isFinite(finalOperationalFee) ||
    Number.isFinite(finalIntermediationFee) ||
    Number.isFinite(finalTotalFees) ||
    Number.isFinite(finalDriverNetAmount);
  const tripDuration = Math.max(
    0,
    Math.round(toNumber(selected?.durationMin || selected?.duration, 0)),
  );
  const tripDistance = Math.max(
    0,
    toNumber(selected?.distanceKm || selected?.distance, 0),
  );
  const passengersCount = Math.max(
    1,
    Math.round(toNumber(selected?.passengerCount, 1)),
  );
  const pickupLabel =
    selected?.pickup || selected?.route?.split("->")?.[0]?.trim() || "Origem";
  const dropoffLabel =
    selected?.drop || selected?.route?.split("->")?.[1]?.trim() || "Destino";
  const pickupLocation = splitLocationLabel(pickupLabel);
  const dropoffLocation = splitLocationLabel(dropoffLabel);
  const driverRouteDensity = [
    pickupLocation.title,
    pickupLocation.subtitle,
    dropoffLocation.title,
    dropoffLocation.subtitle,
  ]
    .join(" ")
    .trim().length;
  const tightDriverLayout =
    isDriverView && (windowHeight <= 860 || driverRouteDensity >= 92);
  const routeTextLineLimit = tightDriverLayout ? 1 : 2;
  const tripDistanceLabel = formatDistanceKm(tripDistance);
  const tripDurationLabel = formatDurationMin(tripDuration);
  const paymentStatusLabel = formatPaymentMethod(selected?.paymentMethod);
  const driverRatingSubmitted = Boolean(selected?.driverRatedPassengerAt);
  const canDriverRatePassenger = Boolean(selected?.passengerId);
  const passengerRatingSubmitted = Boolean(selected?.passengerRatedDriverAt);
  const canPassengerRateDriver = Boolean(selected?.driverId);
  const pickupCoordinate = normalizeCoordinate(
    selected?.pickupCoordinate || driverTripMeta?.pickupCoordinate,
  );
  const destinationCoordinate = normalizeCoordinate(
    selected?.destinationCoordinate || driverTripMeta?.destinationCoordinate,
  );
  const routeCoordinates = Array.isArray(selected?.routeCoordinates)
    ? selected.routeCoordinates.map(normalizeCoordinate).filter(Boolean)
    : [];
  const routePreviewCoordinates = useMemo(
    () =>
      buildRoutePreviewCoordinates({
        pickupCoordinate,
        destinationCoordinate,
        routeCoordinates,
      }),
    [
      pickupCoordinate?.latitude,
      pickupCoordinate?.longitude,
      destinationCoordinate?.latitude,
      destinationCoordinate?.longitude,
      JSON.stringify(routeCoordinates),
    ],
  );
  const routePreviewRegion = useMemo(
    () => buildRoutePreviewRegion(routePreviewCoordinates),
    [JSON.stringify(routePreviewCoordinates)],
  );
  const sheetTop =
    insets.top +
    (tightDriverLayout ? 16 : compactDriverLayout ? 12 : SHEET_TOP_OFFSET);
  const sheetBottom =
    insets.bottom +
    (tightDriverLayout ? 8 : compactDriverLayout ? 6 : SHEET_BOTTOM_OFFSET);
  const driverRateButtonLabel = driverRatingSubmitted
    ? tightDriverLayout
      ? "Avaliado"
      : "Avaliação já enviada"
    : canDriverRatePassenger
      ? tightDriverLayout
        ? "Avaliar"
        : "Avaliar passageiro"
      : tightDriverLayout
        ? "Indisponível"
        : "Avaliação indisponível";
  const driverBackButtonLabel = "Voltar";
  const driverSummaryAsideSecondaryLabel = Number.isFinite(finalTotalFees)
    ? "Taxas"
    : "Passag.";
  const driverSummaryAsideSecondaryValue = Number.isFinite(finalTotalFees)
    ? formatCurrency(finalTotalFees)
    : `${passengersCount}`;

  usePrototypeMapOcclusion({
    routeKey: route?.key,
    layerId: route?.key || "prototype-receipt",
    occludedBottom: sheetBottom + cardHeight,
  });

  const handleDismiss = () => {
    if (route?.params?.fromRating) {
      navigation.navigate("RobotaxiPrototypeReceipt", { fromTrip: true });
      return;
    }

    if (!isDriverView) {
      dismissCompletedReceipt();
    }

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

  return (
    <PrototypeScreenTransition>
      <View style={styles.container}>
        <StatusBar
          translucent
          backgroundColor="transparent"
          barStyle="dark-content"
        />

        <View style={[styles.sheetWrap, { top: sheetTop, bottom: sheetBottom }]}>
          <PrototypeCard
            onLayout={handleCardLayout}
            style={[
              styles.receiptCard,
              compactDriverLayout && styles.receiptCardCompact,
              tightDriverLayout && styles.receiptCardTight,
            ]}
            testID={isDriverView ? "driver-receipt-screen" : "passenger-receipt-screen"}
            accessibilityLabel={isDriverView ? "driver-receipt-screen" : "passenger-receipt-screen"}
          >
            {tightDriverLayout ? (
              <View style={styles.cardHandleTight} />
            ) : (
              <CardHandle />
            )}
            <ScrollView
              bounces={false}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={[
                styles.scrollContent,
                compactDriverLayout && styles.scrollContentCompact,
                tightDriverLayout && styles.scrollContentTight,
              ]}
            >
              {isDriverView ? (
                selected ? (
                  <>
                    <View
                      style={[
                        styles.driverSummaryHero,
                        compactDriverLayout && styles.driverSummaryHeroCompact,
                        tightDriverLayout && styles.driverSummaryHeroTight,
                      ]}
                    >
                      <View
                        style={[
                          styles.driverSuccessHalo,
                          compactDriverLayout &&
                            styles.driverSuccessHaloCompact,
                          tightDriverLayout && styles.driverSuccessHaloTight,
                        ]}
                      >
                        <View
                          style={[
                            styles.driverSuccessCenter,
                            compactDriverLayout &&
                              styles.driverSuccessCenterCompact,
                            tightDriverLayout &&
                              styles.driverSuccessCenterTight,
                          ]}
                        >
                          <Ionicons
                            name="checkmark"
                            size={
                              tightDriverLayout
                                ? 18
                                : compactDriverLayout
                                  ? 20
                                  : 24
                            }
                            color="#FFFFFF"
                          />
                        </View>
                      </View>
                      <Text
                        style={[
                          styles.driverTitle,
                          compactDriverLayout && styles.driverTitleCompact,
                          tightDriverLayout && styles.driverTitleTight,
                        ]}
                      >
                        Corrida concluída
                      </Text>
                      <Text
                        style={[
                          styles.driverSubtitle,
                          compactDriverLayout && styles.driverSubtitleCompact,
                          tightDriverLayout && styles.driverSubtitleTight,
                        ]}
                        numberOfLines={tightDriverLayout ? 1 : 2}
                      >
                        {selected?.passengerName
                          ? `Viagem com ${selected.passengerName} finalizada com sucesso.`
                          : "Excelente trabalho. Seus ganhos já estão prontos."}
                      </Text>
                    </View>

                    <View
                      style={[
                        styles.driverSummaryAmountCard,
                        compactDriverLayout &&
                          styles.driverSummaryAmountCardCompact,
                        tightDriverLayout &&
                          styles.driverSummaryAmountCardTight,
                      ]}
                    >
                      <View
                        style={[
                          styles.driverSummaryAmountRow,
                          compactDriverLayout &&
                            styles.driverSummaryAmountRowCompact,
                          tightDriverLayout &&
                            styles.driverSummaryAmountRowTight,
                        ]}
                      >
                        <View style={styles.driverSummaryAmountMain}>
                          <Text
                            style={[
                              styles.driverSummaryAmountLabel,
                              compactDriverLayout &&
                                styles.driverSummaryAmountLabelCompact,
                              tightDriverLayout &&
                                styles.driverSummaryAmountLabelTight,
                            ]}
                          >
                            {Number.isFinite(finalDriverNetAmount)
                              ? "Ganho líquido"
                              : "Valor da corrida"}
                          </Text>
                          <Text
                            style={[
                              styles.driverSummaryAmountValue,
                              compactDriverLayout &&
                                styles.driverSummaryAmountValueCompact,
                              tightDriverLayout &&
                                styles.driverSummaryAmountValueTight,
                            ]}
                            adjustsFontSizeToFit
                          >
                            {formatCurrency(
                              Number.isFinite(finalDriverNetAmount)
                                ? finalDriverNetAmount
                                : totalAmount,
                            )}
                          </Text>
                        </View>

                        <View
                          style={[
                            styles.driverSummaryAside,
                            compactDriverLayout &&
                              styles.driverSummaryAsideCompact,
                            tightDriverLayout && styles.driverSummaryAsideTight,
                          ]}
                        >
                          <View
                            style={[
                              styles.driverSummaryAsideDivider,
                              compactDriverLayout &&
                                styles.driverSummaryAsideDividerCompact,
                              tightDriverLayout &&
                                styles.driverSummaryAsideDividerTight,
                            ]}
                          />
                          <View
                            style={[
                              styles.driverSummaryAsideMetric,
                              compactDriverLayout &&
                                styles.driverSummaryAsideMetricCompact,
                              tightDriverLayout &&
                                styles.driverSummaryAsideMetricTight,
                            ]}
                          >
                            <Text
                              style={[
                                styles.driverSummaryAsideLabel,
                                compactDriverLayout &&
                                  styles.driverSummaryAsideLabelCompact,
                                tightDriverLayout &&
                                  styles.driverSummaryAsideLabelTight,
                              ]}
                            >
                              Bruto
                            </Text>
                            <Text
                              style={[
                                styles.driverSummaryAsideValue,
                                compactDriverLayout &&
                                  styles.driverSummaryAsideValueCompact,
                                tightDriverLayout &&
                                  styles.driverSummaryAsideValueTight,
                              ]}
                              numberOfLines={2}
                            >
                              {formatCurrency(totalAmount)}
                            </Text>
                          </View>

                          {Number.isFinite(finalTotalFees) ? (
                            <TouchableOpacity
                              activeOpacity={0.78}
                              onPress={() =>
                                setShowFeeBreakdown((previous) => !previous)
                              }
                              style={[
                                styles.driverSummaryAsideMetric,
                                compactDriverLayout &&
                                  styles.driverSummaryAsideMetricCompact,
                                tightDriverLayout &&
                                  styles.driverSummaryAsideMetricTight,
                              ]}
                            >
                              <View style={styles.driverSummaryAsideLabelRow}>
                                <Text
                                  style={[
                                    styles.driverSummaryAsideLabel,
                                    compactDriverLayout &&
                                      styles.driverSummaryAsideLabelCompact,
                                    tightDriverLayout &&
                                      styles.driverSummaryAsideLabelTight,
                                  ]}
                                >
                                  {driverSummaryAsideSecondaryLabel}
                                </Text>
                                <Ionicons
                                  name={
                                    showFeeBreakdown
                                      ? "chevron-up-outline"
                                      : "chevron-down-outline"
                                  }
                                  size={tightDriverLayout ? 11 : 13}
                                  color="#6B7178"
                                />
                              </View>
                              <Text
                                style={[
                                  styles.driverSummaryAsideValue,
                                  compactDriverLayout &&
                                    styles.driverSummaryAsideValueCompact,
                                  tightDriverLayout &&
                                    styles.driverSummaryAsideValueTight,
                                ]}
                                numberOfLines={2}
                              >
                                {driverSummaryAsideSecondaryValue}
                              </Text>
                            </TouchableOpacity>
                          ) : (
                            <View
                              style={[
                                styles.driverSummaryAsideMetric,
                                compactDriverLayout &&
                                  styles.driverSummaryAsideMetricCompact,
                                tightDriverLayout &&
                                  styles.driverSummaryAsideMetricTight,
                              ]}
                            >
                              <Text
                                style={[
                                  styles.driverSummaryAsideLabel,
                                  compactDriverLayout &&
                                    styles.driverSummaryAsideLabelCompact,
                                  tightDriverLayout &&
                                    styles.driverSummaryAsideLabelTight,
                                ]}
                              >
                                {driverSummaryAsideSecondaryLabel}
                              </Text>
                              <Text
                                style={[
                                  styles.driverSummaryAsideValue,
                                  compactDriverLayout &&
                                    styles.driverSummaryAsideValueCompact,
                                  tightDriverLayout &&
                                    styles.driverSummaryAsideValueTight,
                                ]}
                                numberOfLines={2}
                              >
                                {driverSummaryAsideSecondaryValue}
                              </Text>
                            </View>
                          )}
                        </View>
                      </View>

                      <View
                        style={[
                          styles.driverSummaryPill,
                          compactDriverLayout &&
                            styles.driverSummaryPillCompact,
                          tightDriverLayout && styles.driverSummaryPillTight,
                        ]}
                      >
                        <Ionicons
                          name="checkmark-circle-outline"
                          size={tightDriverLayout ? 13 : 15}
                          color="#6C651B"
                        />
                        <Text
                          style={[
                            styles.driverSummaryPillText,
                            compactDriverLayout &&
                              styles.driverSummaryPillTextCompact,
                            tightDriverLayout &&
                              styles.driverSummaryPillTextTight,
                          ]}
                        >
                          {paymentStatusLabel}
                        </Text>
                      </View>
                    </View>

                    {showFeeBreakdown && hasFinalFeeBreakdown ? (
                      <View
                        style={[
                          styles.driverFeeDisclosure,
                          compactDriverLayout &&
                            styles.driverFeeDisclosureCompact,
                          tightDriverLayout && styles.driverFeeDisclosureTight,
                        ]}
                      >
                        <View style={styles.driverFeeDisclosureHeader}>
                          <Text style={styles.driverFeeDisclosureEyebrow}>
                            Detalhes das taxas
                          </Text>
                          <Text style={styles.driverFeeDisclosureHint}>
                            Líquido = bruto - taxas
                          </Text>
                        </View>

                        <View style={styles.driverFeeDisclosureGrid}>
                          {Number.isFinite(finalOperationalFee) ? (
                            <View style={styles.driverFeeDisclosureMetricCard}>
                              <Text
                                style={styles.driverFeeDisclosureMetricLabel}
                              >
                                Operacional
                              </Text>
                              <Text
                                style={styles.driverFeeDisclosureMetricValue}
                              >
                                {formatCurrency(finalOperationalFee)}
                              </Text>
                            </View>
                          ) : null}
                          {Number.isFinite(finalIntermediationFee) ? (
                            <View style={styles.driverFeeDisclosureMetricCard}>
                              <Text
                                style={styles.driverFeeDisclosureMetricLabel}
                              >
                                Intermediação
                              </Text>
                              <Text
                                style={styles.driverFeeDisclosureMetricValue}
                              >
                                {formatCurrency(finalIntermediationFee)}
                              </Text>
                            </View>
                          ) : null}
                        </View>

                        {Number.isFinite(finalTotalFees) ? (
                          <View style={styles.driverFeeDisclosureTotalRow}>
                            <Text style={styles.driverFeeDisclosureTotalLabel}>
                              Total
                            </Text>
                            <Text style={styles.driverFeeDisclosureTotalValue}>
                              {formatCurrency(finalTotalFees)}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                    ) : null}

                    {routePreviewRegion &&
                    routePreviewCoordinates.length >= 2 ? (
                      <View
                        style={[
                          styles.driverRouteSnapshotCard,
                          compactDriverLayout &&
                            styles.driverRouteSnapshotCardCompact,
                          tightDriverLayout &&
                            styles.driverRouteSnapshotCardTight,
                        ]}
                      >
                        <MapView
                          pointerEvents="none"
                          style={styles.driverRouteSnapshotImage}
                          provider={PROVIDER_GOOGLE}
                          initialRegion={routePreviewRegion}
                          region={routePreviewRegion}
                          scrollEnabled={false}
                          zoomEnabled={false}
                          rotateEnabled={false}
                          pitchEnabled={false}
                          toolbarEnabled={false}
                          showsCompass={false}
                          showsScale={false}
                          showsPointsOfInterest={false}
                          showsBuildings={false}
                        >
                          <Polyline
                            coordinates={routePreviewCoordinates}
                            strokeColor="#1A7F37"
                            strokeWidth={4}
                          />
                          {pickupCoordinate ? (
                            <Marker
                              coordinate={pickupCoordinate}
                              anchor={{ x: 0.5, y: 0.5 }}
                            >
                              <View
                                style={styles.driverRouteSnapshotMarkerOuter}
                              >
                                <View
                                  style={[
                                    styles.driverRouteSnapshotMarkerInner,
                                    styles.driverRouteSnapshotMarkerPickup,
                                  ]}
                                />
                              </View>
                            </Marker>
                          ) : null}
                          {destinationCoordinate ? (
                            <Marker
                              coordinate={destinationCoordinate}
                              anchor={{ x: 0.5, y: 0.5 }}
                            >
                              <View
                                style={styles.driverRouteSnapshotMarkerOuter}
                              >
                                <View
                                  style={[
                                    styles.driverRouteSnapshotMarkerInner,
                                    styles.driverRouteSnapshotMarkerDropoff,
                                  ]}
                                />
                              </View>
                            </Marker>
                          ) : null}
                        </MapView>
                        <View style={styles.driverRouteSnapshotBadge}>
                          <Ionicons
                            name="git-commit-outline"
                            size={12}
                            color="#FFFFFF"
                          />
                          <Text style={styles.driverRouteSnapshotBadgeText}>
                            Rota seguida
                          </Text>
                        </View>
                      </View>
                    ) : null}

                    <View
                      style={[
                        styles.driverRoutePanel,
                        compactDriverLayout && styles.driverRoutePanelCompact,
                        tightDriverLayout && styles.driverRoutePanelTight,
                      ]}
                    >
                      <View
                        style={[
                          styles.driverRouteTimeline,
                          compactDriverLayout &&
                            styles.driverRouteTimelineCompact,
                          tightDriverLayout && styles.driverRouteTimelineTight,
                        ]}
                      >
                        <View
                          style={[
                            styles.driverTimelineNodeOuter,
                            compactDriverLayout &&
                              styles.driverTimelineNodeOuterCompact,
                            tightDriverLayout &&
                              styles.driverTimelineNodeOuterTight,
                          ]}
                        >
                          <View
                            style={[
                              styles.driverTimelineNodeInner,
                              styles.driverPickupDot,
                              compactDriverLayout &&
                                styles.driverTimelineNodeInnerCompact,
                              tightDriverLayout &&
                                styles.driverTimelineNodeInnerTight,
                            ]}
                          />
                        </View>
                        <View
                          style={[
                            styles.driverTimelineLine,
                            tightDriverLayout && styles.driverTimelineLineTight,
                          ]}
                        />
                        <View
                          style={[
                            styles.driverTimelineNodeOuter,
                            compactDriverLayout &&
                              styles.driverTimelineNodeOuterCompact,
                            tightDriverLayout &&
                              styles.driverTimelineNodeOuterTight,
                          ]}
                        >
                          <View
                            style={[
                              styles.driverTimelineNodeInner,
                              styles.driverDropoffDot,
                              compactDriverLayout &&
                                styles.driverTimelineNodeInnerCompact,
                              tightDriverLayout &&
                                styles.driverTimelineNodeInnerTight,
                            ]}
                          />
                        </View>
                      </View>

                      <View
                        style={[
                          styles.driverRoutePanelContent,
                          compactDriverLayout &&
                            styles.driverRoutePanelContentCompact,
                          tightDriverLayout &&
                            styles.driverRoutePanelContentTight,
                        ]}
                      >
                        <View
                          style={[
                            styles.driverRouteStop,
                            compactDriverLayout &&
                              styles.driverRouteStopCompact,
                            tightDriverLayout && styles.driverRouteStopTight,
                          ]}
                        >
                          <Text
                            style={[
                              styles.driverRouteStopLabel,
                              compactDriverLayout &&
                                styles.driverRouteStopLabelCompact,
                              tightDriverLayout &&
                                styles.driverRouteStopLabelTight,
                            ]}
                          >
                            Embarque
                          </Text>
                          <Text
                            style={[
                              styles.driverRouteStopTitle,
                              compactDriverLayout &&
                                styles.driverRouteStopTitleCompact,
                              tightDriverLayout &&
                                styles.driverRouteStopTitleTight,
                            ]}
                            numberOfLines={routeTextLineLimit}
                          >
                            {pickupLocation.title}
                          </Text>
                          {pickupLocation.subtitle ? (
                            <Text
                              style={[
                                styles.driverRouteStopSubtitle,
                                compactDriverLayout &&
                                  styles.driverRouteStopSubtitleCompact,
                                tightDriverLayout &&
                                  styles.driverRouteStopSubtitleTight,
                              ]}
                              numberOfLines={routeTextLineLimit}
                            >
                              {pickupLocation.subtitle}
                            </Text>
                          ) : null}
                        </View>

                        <View
                          style={[
                            styles.driverRouteStopDivider,
                            compactDriverLayout &&
                              styles.driverRouteStopDividerCompact,
                            tightDriverLayout &&
                              styles.driverRouteStopDividerTight,
                          ]}
                        />

                        <View
                          style={[
                            styles.driverRouteStop,
                            compactDriverLayout &&
                              styles.driverRouteStopCompact,
                            tightDriverLayout && styles.driverRouteStopTight,
                          ]}
                        >
                          <Text
                            style={[
                              styles.driverRouteStopLabel,
                              styles.driverRouteStopLabelDestination,
                              compactDriverLayout &&
                                styles.driverRouteStopLabelCompact,
                              tightDriverLayout &&
                                styles.driverRouteStopLabelTight,
                            ]}
                          >
                            Destino
                          </Text>
                          <Text
                            style={[
                              styles.driverRouteStopTitle,
                              compactDriverLayout &&
                                styles.driverRouteStopTitleCompact,
                              tightDriverLayout &&
                                styles.driverRouteStopTitleTight,
                            ]}
                            numberOfLines={routeTextLineLimit}
                          >
                            {dropoffLocation.title}
                          </Text>
                          {dropoffLocation.subtitle ? (
                            <Text
                              style={[
                                styles.driverRouteStopSubtitle,
                                compactDriverLayout &&
                                  styles.driverRouteStopSubtitleCompact,
                                tightDriverLayout &&
                                  styles.driverRouteStopSubtitleTight,
                              ]}
                              numberOfLines={routeTextLineLimit}
                            >
                              {dropoffLocation.subtitle}
                            </Text>
                          ) : null}
                        </View>
                      </View>
                    </View>

                    <View
                      style={[
                        styles.driverMetricGrid,
                        compactDriverLayout && styles.driverMetricGridCompact,
                        tightDriverLayout && styles.driverMetricGridTight,
                      ]}
                    >
                      <View
                        style={[
                          styles.driverMetricCard,
                          compactDriverLayout && styles.driverMetricCardCompact,
                          tightDriverLayout && styles.driverMetricCardTight,
                        ]}
                      >
                        <View
                          style={[
                            styles.driverMetricIconWrap,
                            styles.driverMetricIconAccent,
                            compactDriverLayout &&
                              styles.driverMetricIconWrapCompact,
                            tightDriverLayout &&
                              styles.driverMetricIconWrapTight,
                          ]}
                        >
                          <Ionicons
                            name="time-outline"
                            size={
                              tightDriverLayout
                                ? 14
                                : compactDriverLayout
                                  ? 16
                                  : 18
                            }
                            color="#1A7A3E"
                          />
                        </View>
                        <View style={styles.driverMetricCopy}>
                          <Text
                            style={[
                              styles.driverMetricLabel,
                              compactDriverLayout &&
                                styles.driverMetricLabelCompact,
                              tightDriverLayout &&
                                styles.driverMetricLabelTight,
                            ]}
                          >
                            Duração
                          </Text>
                          <Text
                            style={[
                              styles.driverMetricValue,
                              compactDriverLayout &&
                                styles.driverMetricValueCompact,
                              tightDriverLayout &&
                                styles.driverMetricValueTight,
                            ]}
                          >
                            {tripDurationLabel}
                          </Text>
                        </View>
                      </View>

                      <View
                        style={[
                          styles.driverMetricCard,
                          compactDriverLayout && styles.driverMetricCardCompact,
                          tightDriverLayout && styles.driverMetricCardTight,
                        ]}
                      >
                        <View
                          style={[
                            styles.driverMetricIconWrap,
                            styles.driverMetricIconSoft,
                            compactDriverLayout &&
                              styles.driverMetricIconWrapCompact,
                            tightDriverLayout &&
                              styles.driverMetricIconWrapTight,
                          ]}
                        >
                          <Ionicons
                            name="map-outline"
                            size={
                              tightDriverLayout
                                ? 14
                                : compactDriverLayout
                                  ? 16
                                  : 18
                            }
                            color="#365A6D"
                          />
                        </View>
                        <View style={styles.driverMetricCopy}>
                          <Text
                            style={[
                              styles.driverMetricLabel,
                              compactDriverLayout &&
                                styles.driverMetricLabelCompact,
                              tightDriverLayout &&
                                styles.driverMetricLabelTight,
                            ]}
                          >
                            Distância
                          </Text>
                          <Text
                            style={[
                              styles.driverMetricValue,
                              compactDriverLayout &&
                                styles.driverMetricValueCompact,
                              tightDriverLayout &&
                                styles.driverMetricValueTight,
                            ]}
                          >
                            {tripDistanceLabel}
                          </Text>
                        </View>
                      </View>
                    </View>

                    <View
                      style={[
                        styles.driverActionStack,
                        tightDriverLayout && styles.driverActionRow,
                        tightDriverLayout && styles.driverActionRowTight,
                      ]}
                    >
                      <PrototypePrimaryButton
                        label={driverRateButtonLabel}
                        icon="star-outline"
                        disabled={
                          driverRatingSubmitted || !canDriverRatePassenger
                        }
                        accessible
                        accessibilityRole="button"
                        testID="driver-receipt-rate-passenger-button"
                        accessibilityLabel="driver-receipt-rate-passenger-button"
                        onPress={openDriverReceiptRating}
                        onAccessibilityTap={openDriverReceiptRating}
                        style={[
                          styles.driverRateButton,
                          compactDriverLayout && styles.driverRateButtonCompact,
                          tightDriverLayout && styles.driverRateButtonTight,
                        ]}
                      />

                      <TouchableOpacity
                        activeOpacity={0.86}
                        style={[
                          styles.driverBackSecondaryButton,
                          compactDriverLayout &&
                            styles.driverBackSecondaryButtonCompact,
                          tightDriverLayout &&
                            styles.driverBackSecondaryButtonTight,
                        ]}
                        onPress={() => navigation.navigate("RobotaxiPrototype")}
                      >
                        <Ionicons
                          name="arrow-back-outline"
                          size={tightDriverLayout ? 15 : 17}
                          color="#4F5A63"
                        />
                        <Text
                          style={[
                            styles.driverBackSecondaryText,
                            compactDriverLayout &&
                              styles.driverBackSecondaryTextCompact,
                            tightDriverLayout &&
                              styles.driverBackSecondaryTextTight,
                          ]}
                        >
                          {driverBackButtonLabel}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </>
                ) : (
                  <View style={styles.emptyWrap}>
                    <Text style={styles.emptyText}>
                      Nenhuma corrida concluída para exibir recibo.
                    </Text>
                    <PrototypePrimaryButton
                      label="Voltar para o mapa"
                      icon="map-outline"
                      onPress={() => navigation.navigate("RobotaxiPrototype")}
                      style={styles.closeButton}
                    />
                  </View>
                )
              ) : (
                <>
                  <Text style={styles.title}>Recibos</Text>
                  <Text style={styles.subtitle}>
                    Resumo financeiro e histórico recente
                  </Text>
                  {lastTouchProbe ? (
                    <Text style={styles.touchProbeText}>
                      Toque detectado: {lastTouchProbe}
                    </Text>
                  ) : null}

                  <View style={styles.historyWrap}>
                    {runtimeHistory.length > 0 ? (
                      runtimeHistory.map((item) => {
                        const active = selected?.id === item.id;
                        const valueLabel = formatCurrency(resolveTripGrossAmount(item));
                        const routeParts = buildReceiptHistoryRouteParts(item);
                        return (
                          <TouchableOpacity
                            key={item.id}
                            activeOpacity={0.88}
                            onPress={() => setSelectedId(item.id)}
                            style={[
                              styles.historyRow,
                              active && styles.historyRowActive,
                            ]}
                          >
                            <View style={styles.historyTextWrap}>
                              <View style={styles.historyHeaderRow}>
                                <Text style={styles.historyDate}>
                                  {item.date || "--"}
                                </Text>
                                <Text style={styles.historyValue}>
                                  {valueLabel}
                                </Text>
                              </View>

                              <View style={styles.historyRouteStack}>
                                <View style={styles.historyStopRow}>
                                  <View
                                    style={[
                                      styles.historyStopDot,
                                      styles.historyStopDotPickup,
                                    ]}
                                  />
                                  <Text style={styles.historyStopLabel}>
                                    Embarque
                                  </Text>
                                  <Text
                                    numberOfLines={2}
                                    style={styles.historyRoute}
                                  >
                                    {routeParts.pickup}
                                  </Text>
                                </View>

                                <View style={styles.historyStopRow}>
                                  <View
                                    style={[
                                      styles.historyStopDot,
                                      styles.historyStopDotDropoff,
                                    ]}
                                  />
                                  <Text style={styles.historyStopLabel}>
                                    Destino
                                  </Text>
                                  <Text
                                    numberOfLines={2}
                                    style={styles.historyRoute}
                                  >
                                    {routeParts.drop}
                                  </Text>
                                </View>
                              </View>
                            </View>
                          </TouchableOpacity>
                        );
                      })
                    ) : (
                      <View style={styles.emptyWrap}>
                        <Text style={styles.emptyText}>
                          Ainda não há recibos gerados para esta conta.
                        </Text>
                      </View>
                    )}
                  </View>

                  {selected ? (
                    <>
                      <View style={styles.detailsBox}>
                        <View style={styles.detailRow}>
                          <Text style={styles.detailLabel}>Tarifa base</Text>
                          <Text style={styles.detailValue}>
                            {formatCurrency(fareAmount)}
                          </Text>
                        </View>
                        <View style={styles.detailRow}>
                          <Text style={styles.detailLabel}>
                            Distância e tempo
                          </Text>
                          <Text style={styles.detailValue}>
                            {formatCurrency(variableAmount)}
                          </Text>
                        </View>
                        <View style={[styles.detailRow, styles.detailRowLast]}>
                          <Text style={styles.detailLabelStrong}>
                            Total pago
                          </Text>
                          <Text style={styles.detailValueStrong}>
                            {totalAmountLabel}
                          </Text>
                        </View>
                      </View>

                      <View style={styles.actionsRow}>
                      <TouchableOpacity
                        style={[
                          styles.secondaryAction,
                          (passengerRatingSubmitted ||
                              !canPassengerRateDriver) &&
                              styles.secondaryActionDisabled,
                        ]}
                        activeOpacity={0.86}
                        accessible
                        accessibilityRole="button"
                        accessibilityState={{
                          disabled:
                            passengerRatingSubmitted || !canPassengerRateDriver,
                        }}
                        focusable
                        hitSlop={{ top: 6, right: 6, bottom: 6, left: 6 }}
                        disabled={
                          passengerRatingSubmitted || !canPassengerRateDriver
                        }
                        onPressIn={() => setLastTouchProbe("avaliar_viagem")}
                        testID="passenger-receipt-rate-trip-button"
                        accessibilityLabel="passenger-receipt-rate-trip-button"
                        onPress={openPassengerReceiptRating}
                        onAccessibilityTap={openPassengerReceiptRating}
                        >
                          <Ionicons
                            name="star-outline"
                            size={15}
                            color={color.text.primary}
                          />
                          <Text style={styles.secondaryActionText}>
                            {passengerRatingSubmitted
                              ? "Avaliação enviada"
                              : canPassengerRateDriver
                                ? "Avaliar viagem"
                                : "Avaliação indisponível"}
                          </Text>
                        </TouchableOpacity>

                      <TouchableOpacity
                        style={styles.secondaryAction}
                        activeOpacity={0.86}
                        accessible
                        accessibilityRole="button"
                        accessibilityState={{ disabled: false }}
                        focusable
                        hitSlop={{ top: 6, right: 6, bottom: 6, left: 6 }}
                        onPressIn={() => setLastTouchProbe("reportar_problema")}
                        accessibilityLabel="passenger-receipt-report-issue-button"
                        testID="passenger-receipt-report-issue-button"
                        onPress={() =>
                            navigation.navigate("RobotaxiPrototypeComplain", {
                              fromReceipt: true,
                              receipt: selected,
                            })
                          }
                        >
                          <Ionicons
                            name="warning-outline"
                            size={15}
                            color={color.text.primary}
                          />
                          <Text style={styles.secondaryActionText}>
                            Reportar problema
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </>
                  ) : null}

                  <PrototypePrimaryButton
                    label="Voltar para o mapa"
                    icon="map-outline"
                    onPress={() => {
                      setLastTouchProbe("voltar_mapa");
                      handleDismiss();
                    }}
                    style={styles.closeButton}
                    testID={
                      isDriverView
                        ? "driver-receipt-back-to-map-button"
                        : "passenger-receipt-back-to-map-button"
                    }
                    accessibilityLabel={
                      isDriverView
                        ? "driver-receipt-back-to-map-button"
                        : "passenger-receipt-back-to-map-button"
                    }
                  />
                </>
              )}
            </ScrollView>
          </PrototypeCard>
        </View>
      </View>
    </PrototypeScreenTransition>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "rgba(241, 245, 249, 0.94)",
  },
  sheetWrap: {
    position: "absolute",
    left: 10,
    right: 10,
  },
  receiptCard: {
    flex: 1,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 12,
  },
  receiptCardCompact: {
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 8,
  },
  receiptCardTight: {
    paddingHorizontal: 8,
    paddingTop: 6,
    paddingBottom: 6,
  },
  scrollContent: {
    paddingBottom: 8,
  },
  scrollContentCompact: {
    paddingTop: 6,
    paddingBottom: 6,
  },
  scrollContentTight: {
    paddingTop: 12,
    paddingBottom: 8,
  },
  cardHandleTight: {
    width: 42,
    height: 4,
    borderRadius: 999,
    backgroundColor: "rgba(142,154,169,0.54)",
    alignSelf: "center",
    marginBottom: 6,
  },
  driverSummaryHero: {
    alignItems: "center",
    marginTop: 2,
  },
  driverSummaryHeroCompact: {
    marginTop: 4,
  },
  driverSummaryHeroTight: {
    marginTop: 6,
  },
  driverSuccessWrap: {
    alignItems: "center",
    marginTop: 2,
  },
  driverSuccessHalo: {
    width: 102,
    height: 102,
    borderRadius: 51,
    backgroundColor: "rgba(125,216,140,0.28)",
    alignItems: "center",
    justifyContent: "center",
  },
  driverSuccessHaloCompact: {
    width: 78,
    height: 78,
    borderRadius: 39,
  },
  driverSuccessHaloTight: {
    width: 62,
    height: 62,
    borderRadius: 31,
  },
  driverSuccessCenter: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#1A7F37",
    alignItems: "center",
    justifyContent: "center",
  },
  driverSuccessCenterCompact: {
    width: 50,
    height: 50,
    borderRadius: 25,
  },
  driverSuccessCenterTight: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  driverTitle: {
    marginTop: 12,
    color: color.text.primary,
    fontFamily: fonts.Bold,
    fontSize: 24,
    lineHeight: 28,
    letterSpacing: -0.6,
    textAlign: "center",
  },
  driverTitleCompact: {
    marginTop: 9,
    fontSize: 21,
    lineHeight: 25,
  },
  driverTitleTight: {
    marginTop: 7,
    fontSize: 18,
    lineHeight: 21,
  },
  driverSubtitle: {
    marginTop: 4,
    color: color.text.secondary,
    fontFamily: fonts.Medium,
    fontSize: 15,
    lineHeight: 20,
    textAlign: "center",
    paddingHorizontal: 12,
  },
  driverSubtitleCompact: {
    marginTop: 3,
    fontSize: 13,
    lineHeight: 17,
    paddingHorizontal: 4,
  },
  driverSubtitleTight: {
    marginTop: 2,
    fontSize: 11.5,
    lineHeight: 14,
    paddingHorizontal: 0,
  },
  driverSummaryAmountCard: {
    marginTop: 16,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.7)",
    backgroundColor: "rgba(249,250,247,0.96)",
    paddingHorizontal: 20,
    paddingVertical: 18,
    shadowColor: "#15381F",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.12,
    shadowRadius: 22,
    elevation: 6,
  },
  driverSummaryAmountCardCompact: {
    marginTop: 12,
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  driverSummaryAmountCardTight: {
    marginTop: 8,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  driverSummaryAmountRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  driverSummaryAmountRowCompact: {
    flexWrap: "wrap",
    rowGap: 12,
  },
  driverSummaryAmountRowTight: {
    flexWrap: "wrap",
    rowGap: 10,
  },
  driverSummaryAmountMain: {
    flex: 1,
    minWidth: 0,
  },
  driverSummaryAmountLabel: {
    color: color.text.secondary,
    fontFamily: fonts.SemiBold,
    fontSize: 12,
    lineHeight: 14,
    textTransform: "uppercase",
    letterSpacing: 1.1,
  },
  driverSummaryAmountLabelCompact: {
    fontSize: 11,
    lineHeight: 13,
  },
  driverSummaryAmountLabelTight: {
    fontSize: 10,
    lineHeight: 12,
  },
  driverSummaryAmountValue: {
    marginTop: 8,
    color: "#1A7F37",
    fontFamily: fonts.Bold,
    fontSize: 34,
    lineHeight: 38,
    letterSpacing: -1,
  },
  driverSummaryAmountValueCompact: {
    marginTop: 6,
    fontSize: 28,
    lineHeight: 32,
  },
  driverSummaryAmountValueTight: {
    marginTop: 4,
    fontSize: 24,
    lineHeight: 28,
  },
  driverSummaryAside: {
    width: 112,
    marginLeft: 14,
    gap: 8,
    position: "relative",
    paddingLeft: 14,
    justifyContent: "center",
  },
  driverSummaryAsideCompact: {
    width: "100%",
    marginLeft: 0,
    marginTop: 12,
    gap: 8,
    paddingLeft: 0,
    paddingTop: 12,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  driverSummaryAsideTight: {
    width: "100%",
    marginLeft: 0,
    marginTop: 10,
    gap: 8,
    paddingLeft: 0,
    paddingTop: 10,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  driverSummaryAsideDivider: {
    position: "absolute",
    left: 0,
    top: 2,
    bottom: 2,
    width: 1,
    backgroundColor: "rgba(68,85,93,0.12)",
  },
  driverSummaryAsideDividerCompact: {
    left: 0,
    right: 0,
    top: 0,
    bottom: "auto",
    width: "auto",
    height: 1,
  },
  driverSummaryAsideDividerTight: {
    left: 0,
    right: 0,
    top: 0,
    bottom: "auto",
    width: "auto",
    height: 1,
  },
  driverSummaryAsideMetric: {
    paddingVertical: 1,
  },
  driverSummaryAsideMetricCompact: {
    flexGrow: 1,
    flexBasis: "47%",
    minWidth: 0,
    paddingVertical: 1,
  },
  driverSummaryAsideMetricTight: {
    flexGrow: 1,
    flexBasis: "47%",
    minWidth: 0,
    paddingVertical: 0,
  },
  driverSummaryAsideLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  driverSummaryAsideLabel: {
    color: "#6B7178",
    fontFamily: fonts.Bold,
    fontSize: 10,
    lineHeight: 12,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  driverSummaryAsideLabelCompact: {
    fontSize: 9.5,
    lineHeight: 11,
  },
  driverSummaryAsideLabelTight: {
    fontSize: 8.5,
    lineHeight: 10,
  },
  driverSummaryAsideValue: {
    marginTop: 2,
    color: color.text.primary,
    fontFamily: fonts.Bold,
    fontSize: 15,
    lineHeight: 18,
  },
  driverSummaryAsideValueCompact: {
    marginTop: 3,
    fontSize: 13.5,
    lineHeight: 17,
  },
  driverSummaryAsideValueTight: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 15,
  },
  driverSummaryPill: {
    marginTop: 14,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 999,
    backgroundColor: "#F5EEB3",
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  driverSummaryPillCompact: {
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  driverSummaryPillTight: {
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  driverSummaryPillText: {
    marginLeft: 6,
    color: "#6C651B",
    fontFamily: fonts.Bold,
    fontSize: 13,
    lineHeight: 16,
  },
  driverSummaryPillTextCompact: {
    fontSize: 12,
    lineHeight: 14,
  },
  driverSummaryPillTextTight: {
    marginLeft: 5,
    fontSize: 10.5,
    lineHeight: 12,
  },
  driverMetricGrid: {
    marginTop: 14,
    flexDirection: "row",
    gap: 12,
  },
  driverMetricGridCompact: {
    marginTop: 10,
    gap: 10,
  },
  driverMetricGridTight: {
    marginTop: 8,
    gap: 8,
  },
  driverMetricCard: {
    flex: 1,
    minHeight: 82,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(68,85,93,0.06)",
    backgroundColor: "rgba(255,255,255,0.76)",
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
  },
  driverMetricCardCompact: {
    minHeight: 68,
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  driverMetricCardTight: {
    minHeight: 58,
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  driverMetricIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  driverMetricIconWrapCompact: {
    width: 36,
    height: 36,
    borderRadius: 12,
    marginRight: 10,
  },
  driverMetricIconWrapTight: {
    width: 30,
    height: 30,
    borderRadius: 10,
    marginRight: 8,
  },
  driverMetricIconAccent: {
    backgroundColor: "rgba(105, 198, 127, 0.22)",
  },
  driverMetricIconSoft: {
    backgroundColor: "rgba(112, 150, 175, 0.14)",
  },
  driverMetricCopy: {
    flex: 1,
  },
  driverMetricLabel: {
    fontFamily: fonts.Bold,
    fontSize: 11,
    textTransform: "uppercase",
    color: "#6B7178",
    marginBottom: 4,
  },
  driverMetricLabelCompact: {
    fontSize: 10,
    marginBottom: 2,
  },
  driverMetricLabelTight: {
    fontSize: 9,
    marginBottom: 1,
  },
  driverMetricValue: {
    fontFamily: fonts.Bold,
    fontSize: 18,
    color: color.text.primary,
  },
  driverMetricValueCompact: {
    fontSize: 16,
  },
  driverMetricValueTight: {
    fontSize: 14,
  },
  driverFeeDisclosure: {
    marginTop: 10,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(68,85,93,0.06)",
    backgroundColor: "rgba(246,248,246,0.92)",
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 8,
  },
  driverFeeDisclosureCompact: {
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 6,
  },
  driverFeeDisclosureTight: {
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 5,
  },
  driverFeeDisclosureHeader: {
    gap: 2,
  },
  driverFeeDisclosureEyebrow: {
    color: "#6B7178",
    fontFamily: fonts.Bold,
    fontSize: 10,
    lineHeight: 12,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  driverFeeDisclosureHint: {
    color: "#7C868D",
    fontFamily: fonts.Medium,
    fontSize: 11,
    lineHeight: 14,
  },
  driverFeeDisclosureGrid: {
    flexDirection: "row",
    gap: 8,
  },
  driverFeeDisclosureMetricCard: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(68,85,93,0.06)",
    backgroundColor: "rgba(255,255,255,0.78)",
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  driverFeeDisclosureMetricLabel: {
    color: "#6B7178",
    fontFamily: fonts.Bold,
    fontSize: 10,
    lineHeight: 12,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  driverFeeDisclosureMetricValue: {
    marginTop: 4,
    color: color.text.primary,
    fontFamily: fonts.Bold,
    fontSize: 13,
    lineHeight: 16,
  },
  driverFeeDisclosureTotalRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "rgba(68,85,93,0.08)",
  },
  driverFeeDisclosureTotalLabel: {
    color: "#4F5A63",
    fontFamily: fonts.SemiBold,
    fontSize: 12,
    lineHeight: 16,
  },
  driverFeeDisclosureTotalValue: {
    color: "#1A7F37",
    fontFamily: fonts.Bold,
    fontSize: 14,
    lineHeight: 16,
  },
  driverRouteSnapshotCard: {
    marginTop: 12,
    borderRadius: 24,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(68,85,93,0.08)",
    backgroundColor: "rgba(255,255,255,0.68)",
    height: 132,
  },
  driverRouteSnapshotCardCompact: {
    marginTop: 10,
    borderRadius: 20,
    height: 118,
  },
  driverRouteSnapshotCardTight: {
    marginTop: 8,
    borderRadius: 18,
    height: 104,
  },
  driverRouteSnapshotImage: {
    width: "100%",
    height: "100%",
  },
  driverRouteSnapshotMarkerOuter: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "rgba(255,255,255,0.94)",
    borderWidth: 1,
    borderColor: "rgba(25,42,33,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  driverRouteSnapshotMarkerInner: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
  },
  driverRouteSnapshotMarkerPickup: {
    backgroundColor: "#1A7F37",
  },
  driverRouteSnapshotMarkerDropoff: {
    backgroundColor: "#4D6575",
  },
  driverRouteSnapshotBadge: {
    position: "absolute",
    top: 12,
    left: 12,
    borderRadius: 999,
    backgroundColor: "rgba(25,42,33,0.76)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  driverRouteSnapshotBadgeText: {
    color: "#FFFFFF",
    fontFamily: fonts.Bold,
    fontSize: 11,
    lineHeight: 13,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  driverRoutePanel: {
    marginTop: 12,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: "rgba(68,85,93,0.06)",
    backgroundColor: "rgba(255,255,255,0.74)",
    paddingHorizontal: 18,
    paddingVertical: 18,
    flexDirection: "row",
    alignItems: "stretch",
  },
  driverRoutePanelCompact: {
    marginTop: 10,
    borderRadius: 22,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  driverRoutePanelTight: {
    marginTop: 8,
    borderRadius: 18,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  driverRouteTimeline: {
    width: 28,
    alignItems: "center",
    paddingTop: 8,
    paddingBottom: 8,
  },
  driverRouteTimelineCompact: {
    width: 24,
    paddingTop: 4,
    paddingBottom: 4,
  },
  driverRouteTimelineTight: {
    width: 20,
    paddingTop: 2,
    paddingBottom: 2,
  },
  driverTimelineNodeOuter: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(33,53,46,0.08)",
    backgroundColor: "rgba(245,248,246,0.95)",
    alignItems: "center",
    justifyContent: "center",
  },
  driverTimelineNodeOuterCompact: {
    width: 20,
    height: 20,
    borderRadius: 10,
  },
  driverTimelineNodeOuterTight: {
    width: 18,
    height: 18,
    borderRadius: 9,
  },
  driverTimelineNodeInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  driverTimelineNodeInnerCompact: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  driverTimelineNodeInnerTight: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  driverTimelineLine: {
    flex: 1,
    width: 3,
    borderRadius: 999,
    backgroundColor: "rgba(148,170,158,0.45)",
    marginVertical: 6,
  },
  driverTimelineLineTight: {
    width: 2,
    marginVertical: 4,
  },
  driverPickupDot: {
    backgroundColor: "#1A7A3E",
  },
  driverDropoffDot: {
    backgroundColor: "#4D6575",
  },
  driverRoutePanelContent: {
    flex: 1,
    paddingLeft: 14,
  },
  driverRoutePanelContentCompact: {
    paddingLeft: 10,
  },
  driverRoutePanelContentTight: {
    paddingLeft: 8,
  },
  driverRouteStop: {
    minHeight: 84,
    justifyContent: "center",
  },
  driverRouteStopCompact: {
    minHeight: 60,
  },
  driverRouteStopTight: {
    minHeight: 44,
  },
  driverRouteStopLabel: {
    fontFamily: fonts.Bold,
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1.6,
    color: "#1A7A3E",
    marginBottom: 6,
  },
  driverRouteStopLabelCompact: {
    fontSize: 10,
    letterSpacing: 1.2,
    marginBottom: 4,
  },
  driverRouteStopLabelTight: {
    fontSize: 8.5,
    letterSpacing: 0.9,
    marginBottom: 2,
  },
  driverRouteStopLabelDestination: {
    color: "#4D6575",
  },
  driverRouteStopTitle: {
    fontFamily: fonts.Bold,
    fontSize: 17,
    lineHeight: 23,
    color: color.text.primary,
  },
  driverRouteStopTitleCompact: {
    fontSize: 15,
    lineHeight: 19,
  },
  driverRouteStopTitleTight: {
    fontSize: 13,
    lineHeight: 16,
  },
  driverRouteStopSubtitle: {
    marginTop: 4,
    fontFamily: fonts.Medium,
    fontSize: 14,
    lineHeight: 19,
    color: color.text.secondary,
  },
  driverRouteStopSubtitleCompact: {
    marginTop: 2,
    fontSize: 12.5,
    lineHeight: 16,
  },
  driverRouteStopSubtitleTight: {
    marginTop: 1,
    fontSize: 10.5,
    lineHeight: 13,
  },
  driverRouteStopDivider: {
    height: 1,
    backgroundColor: "rgba(68,85,93,0.08)",
    marginVertical: 12,
  },
  driverRouteStopDividerCompact: {
    marginVertical: 8,
  },
  driverRouteStopDividerTight: {
    marginVertical: 5,
  },
  driverFeePanel: {
    marginTop: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(68,85,93,0.08)",
    backgroundColor: "rgba(255,255,255,0.68)",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  driverFeePanelCompact: {
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  driverFeePanelTight: {
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  driverFeeTopRow: {
    flexDirection: "row",
    alignItems: "stretch",
  },
  driverFeeTopRowTight: {
    marginBottom: 1,
  },
  driverFeeMetric: {
    flex: 1,
  },
  driverFeeDivider: {
    width: 1,
    marginHorizontal: 10,
    backgroundColor: "rgba(68,85,93,0.1)",
  },
  driverFeeMetricLabel: {
    color: "#6B7178",
    fontFamily: fonts.Bold,
    fontSize: 10,
    lineHeight: 12,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  driverFeeMetricLabelCompact: {
    fontSize: 9.5,
    lineHeight: 11,
  },
  driverFeeMetricLabelTight: {
    fontSize: 8.5,
    lineHeight: 10,
  },
  driverFeeMetricValue: {
    marginTop: 3,
    color: color.text.primary,
    fontFamily: fonts.Bold,
    fontSize: 14,
    lineHeight: 17,
  },
  driverFeeMetricValueCompact: {
    fontSize: 13,
    lineHeight: 15,
  },
  driverFeeMetricValueTight: {
    marginTop: 2,
    fontSize: 11.5,
    lineHeight: 13,
  },
  driverFeeTextMuted: {
    marginTop: 8,
    color: "#506372",
    fontFamily: fonts.Medium,
    fontSize: 13,
    lineHeight: 18,
  },
  driverFeeTextMutedCompact: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 16,
  },
  driverFeeTextMutedTight: {
    marginTop: 3,
    fontSize: 10.5,
    lineHeight: 13.5,
  },
  driverActionStack: {
    marginTop: 14,
  },
  driverActionRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "stretch",
  },
  driverActionRowTight: {
    marginTop: 10,
  },
  driverRateButton: {
    minHeight: 62,
    borderRadius: 24,
  },
  driverRateButtonCompact: {
    minHeight: 54,
    borderRadius: 20,
  },
  driverRateButtonTight: {
    flex: 1,
    minHeight: 46,
    borderRadius: 16,
  },
  driverBackSecondaryButton: {
    marginTop: 12,
    minHeight: 52,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(68,85,93,0.12)",
    backgroundColor: "rgba(255,255,255,0.72)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  driverBackSecondaryButtonCompact: {
    marginTop: 10,
    minHeight: 46,
    borderRadius: 16,
  },
  driverBackSecondaryButtonTight: {
    marginTop: 0,
    minHeight: 46,
    minWidth: 112,
    borderRadius: 16,
    paddingHorizontal: 14,
  },
  driverBackSecondaryText: {
    color: "#4F5A63",
    fontFamily: fonts.Bold,
    fontSize: 15,
    lineHeight: 18,
  },
  driverBackSecondaryTextCompact: {
    fontSize: 14,
    lineHeight: 16,
  },
  driverBackSecondaryTextTight: {
    fontSize: 13,
    lineHeight: 15,
  },
  earningsCard: {
    marginTop: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: color.border.subtle,
    backgroundColor: color.surface.secondary,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  earningsCardLabel: {
    color: color.text.secondary,
    fontFamily: fonts.SemiBold,
    fontSize: 12,
    lineHeight: 14,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  earningsCardValue: {
    marginTop: 5,
    color: "#1A7F37",
    fontFamily: fonts.Bold,
    fontSize: 36,
    lineHeight: 40,
    letterSpacing: -0.9,
  },
  feeRow: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  feeText: {
    color: "#365A6D",
    fontFamily: fonts.SemiBold,
    fontSize: 13,
    lineHeight: 18,
  },
  splitRow: {
    marginTop: 10,
    flexDirection: "row",
    gap: 8,
  },
  splitCard: {
    flex: 1,
    minHeight: 92,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: color.border.subtle,
    backgroundColor: color.surface.secondary,
    paddingHorizontal: 12,
    paddingVertical: 12,
    justifyContent: "center",
  },
  splitCardHighlight: {
    borderColor: "rgba(26,127,55,0.24)",
  },
  splitLabel: {
    color: color.text.secondary,
    fontFamily: fonts.SemiBold,
    fontSize: 11.5,
    lineHeight: 14,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  splitValue: {
    marginTop: 4,
    color: color.text.primary,
    fontFamily: fonts.Bold,
    fontSize: 24,
    lineHeight: 28,
  },
  splitValueHighlight: {
    color: "#1A7F37",
  },
  feeDetailCard: {
    marginTop: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(93,115,130,0.18)",
    backgroundColor: "rgba(208,225,236,0.44)",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  feeDetailText: {
    color: "#365A6D",
    fontFamily: fonts.Medium,
    fontSize: 13,
    lineHeight: 17,
  },
  feeDetailTextStrong: {
    marginTop: 3,
    color: "#1F3440",
    fontFamily: fonts.SemiBold,
    fontSize: 13,
    lineHeight: 17,
  },
  routeSummaryCard: {
    marginTop: 10,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: color.border.subtle,
    backgroundColor: color.surface.secondary,
    overflow: "hidden",
  },
  routeMapArea: {
    height: 108,
    backgroundColor: "rgba(176,188,196,0.42)",
  },
  routeSummaryBody: {
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  routeSummaryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  routeSummaryDot: {
    width: 11,
    height: 11,
    borderRadius: 5.5,
  },
  routeSummaryDotMuted: {
    backgroundColor: "#A9B4BD",
  },
  routeSummaryDotStrong: {
    backgroundColor: "#1A7F37",
  },
  routeSummaryTextMuted: {
    color: "#556271",
    fontFamily: fonts.Medium,
    fontSize: 16,
    lineHeight: 20,
  },
  routeSummaryTextStrong: {
    marginTop: 1,
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: 16,
    lineHeight: 20,
  },
  routeMetaRow: {
    marginTop: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.border.separator,
    paddingTop: 10,
  },
  routeMetaItem: {
    color: color.text.secondary,
    fontFamily: fonts.Medium,
    fontSize: 12.5,
    lineHeight: 16,
  },
  driverBackButton: {
    marginTop: 12,
    minHeight: 56,
    borderRadius: 18,
  },
  title: {
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: 18,
    lineHeight: 24,
  },
  subtitle: {
    marginTop: 1,
    color: color.text.secondary,
    fontFamily: fonts.Regular,
    fontSize: 13,
    lineHeight: 18,
  },
  historyWrap: {
    marginTop: 10,
    gap: 8,
  },
  historyRow: {
    minHeight: 84,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: color.border.subtle,
    backgroundColor: color.surface.secondary,
    paddingHorizontal: 10,
    paddingVertical: 10,
    justifyContent: "center",
  },
  historyRowActive: {
    borderColor: "rgba(26,51,14,0.34)",
    backgroundColor: color.surface.activeSoft,
  },
  historyTextWrap: {
    flex: 1,
    marginRight: 10,
    minWidth: 0,
  },
  historyHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  historyDate: {
    color: color.text.primary,
    fontFamily: fonts.Medium,
    fontSize: 13,
    lineHeight: 18,
  },
  historyRouteStack: {
    marginTop: 6,
    gap: 5,
  },
  historyStopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
  },
  historyStopDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 5,
    flexShrink: 0,
  },
  historyStopDotPickup: {
    backgroundColor: "#1A7F37",
  },
  historyStopDotDropoff: {
    backgroundColor: "#7A8894",
  },
  historyStopLabel: {
    width: 54,
    color: color.text.secondary,
    fontFamily: fonts.SemiBold,
    fontSize: 10,
    lineHeight: 14,
    textTransform: "uppercase",
    letterSpacing: 0.7,
  },
  historyRoute: {
    flex: 1,
    minWidth: 0,
    color: color.text.secondary,
    fontFamily: fonts.Regular,
    fontSize: 11.5,
    lineHeight: 15,
  },
  historyValue: {
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: 14,
    lineHeight: 18,
  },
  detailsBox: {
    marginTop: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: color.border.subtle,
    backgroundColor: color.surface.secondary,
    overflow: "hidden",
  },
  detailRow: {
    minHeight: 40,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.border.separator,
  },
  detailRowLast: {
    borderBottomWidth: 0,
  },
  detailLabel: {
    color: color.text.secondary,
    fontFamily: fonts.Medium,
    fontSize: 13,
    lineHeight: 18,
  },
  detailValue: {
    color: color.text.primary,
    fontFamily: fonts.Medium,
    fontSize: 13,
    lineHeight: 18,
  },
  detailLabelStrong: {
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: 15,
    lineHeight: 20,
  },
  detailValueStrong: {
    color: color.accent.primary,
    fontFamily: fonts.SemiBold,
    fontSize: 15,
    lineHeight: 20,
  },
  actionsRow: {
    marginTop: 10,
    flexDirection: "row",
    gap: 8,
  },
  secondaryAction: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: color.border.strong,
    backgroundColor: color.surface.secondary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  secondaryActionDisabled: {
    opacity: 0.55,
  },
  secondaryActionText: {
    color: color.text.primary,
    fontFamily: fonts.Medium,
    fontSize: 13,
    lineHeight: 18,
  },
  touchProbeText: {
    marginTop: 6,
    color: color.text.muted,
    fontFamily: fonts.Medium,
    fontSize: 11,
    lineHeight: 14,
  },
  emptyWrap: {
    minHeight: 80,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: color.border.subtle,
    backgroundColor: color.surface.secondary,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  emptyText: {
    color: color.text.secondary,
    fontFamily: fonts.Medium,
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center",
  },
  closeButton: {
    marginTop: 10,
  },
});
