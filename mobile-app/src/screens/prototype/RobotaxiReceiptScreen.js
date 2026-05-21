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
import SecurePaymentBadge from "../../components/payment/SecurePaymentBadge";
import PrototypeScreenTransition from "../../components/prototype/PrototypeScreenTransition";
import {
  PrototypeCard,
  PrototypePrimaryButton,
} from "../../components/prototype/PrototypeUI";
import { PrototypeMenuCloseButton } from "../../components/prototype/PrototypeMenuSurface";
import robotaxiPrototypeTokens from "../../components/design-system/robotaxiPrototypeTokens";
import { usePrototypeMapOcclusion } from "./prototypeMapOcclusion";
import { usePrototypeRideRuntime } from "./prototypeRideRuntime";
import {
  formatCurrencyBRL,
  resolveTripFeeAmount,
  resolveTripGrossAmount,
  resolveTripNetAmount,
  resolveTripTollAmount,
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
    return "--";
  }
  if (numeric < 1) {
    const meters = Math.max(10, Math.round((numeric * 1000) / 10) * 10);
    return `${meters} m`;
  }
  return `${Math.max(1, Math.round(numeric))} km`;
}

function formatDurationMin(value) {
  const numeric = Math.max(0, Math.round(toNumber(value, 0)));
  if (!numeric) {
    return "--";
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
  const directPickup = String(
    item?.pickupAddress || item?.pickup || "",
  ).trim();
  const directDrop = String(
    item?.destinationAddress || item?.dropoffAddress || item?.drop || "",
  ).trim();
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
      if (typeof navigation.navigate === "function") {
        navigation.navigate("RobotaxiPrototypeRating", params);
        return;
      }

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
  const tollAmount = resolveTripTollAmount(selected);
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
  const safeFeeAmount = Number.isFinite(finalTotalFees) ? finalTotalFees : 0;
  const safeTollAmount = Number.isFinite(tollAmount) ? tollAmount : 0;
  const passengerRideSubtotal = Math.max(
    0,
    Number((totalAmount - safeFeeAmount - safeTollAmount).toFixed(2)),
  );
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
    selected?.pickupAddress ||
    selected?.pickup ||
    selected?.route?.split("->")?.[0]?.trim() ||
    "Origem";
  const dropoffLabel =
    selected?.destinationAddress ||
    selected?.dropoffAddress ||
    selected?.drop ||
    selected?.route?.split("->")?.[1]?.trim() ||
    "Destino";
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
  const driverSummaryAsideSecondaryLabel = Number.isFinite(finalTotalFees)
    ? "Taxas"
    : "Passag.";
  const driverSummaryAsideSecondaryValue = Number.isFinite(finalTotalFees)
    ? formatCurrency(finalTotalFees)
    : `${passengersCount}`;
  const closeButtonTestId = isDriverView
    ? "driver-receipt-back-to-map-button"
    : "passenger-receipt-back-to-map-button";
  const headerTitle = isDriverView ? "Corrida finalizada" : "Resumo da viagem";
  const headerSubtitle = isDriverView
    ? "Ganhos, rota e próximos passos em um só lugar."
    : "Pagamento, rota e suporte em um layout mais direto.";
  const heroTitle = isDriverView
    ? selected?.passengerName
      ? `Viagem com ${selected.passengerName}`
      : "Recebimento concluído"
    : selected?.driverName
      ? `Viagem com ${selected.driverName}`
      : "Corrida concluída";
  const heroSubtitle = [selected?.date, paymentStatusLabel]
    .filter(Boolean)
    .join(" • ");
  const driverReceivedAmount = formatCurrency(
    Number.isFinite(finalDriverNetAmount) ? finalDriverNetAmount : totalAmount,
  );
  const passengerRecentHistory = runtimeHistory.filter(
    (item) => item.id !== selected?.id,
  );
  const driverRecentHistory = runtimeHistory.filter(
    (item) => item.id !== selected?.id,
  );

  usePrototypeMapOcclusion({
    routeKey: route?.key,
    layerId: route?.key || "prototype-receipt",
    occludedBottom: sheetBottom + cardHeight,
  });

  const navigateBackToPrototype = useCallback(() => {
    if (typeof navigation.dispatch === "function") {
      navigation.dispatch(StackActions.replace("RobotaxiPrototype"));
      return;
    }

    navigation.navigate("RobotaxiPrototype");
  }, [navigation]);

  const handleDismiss = () => {
    if (!isDriverView) {
      dismissCompletedReceipt();
    }

    const shouldReturnToPrototypeHome =
      fromTrip && Boolean(route?.params?.fromRating);

    if (shouldReturnToPrototypeHome) {
      navigateBackToPrototype();
      return;
    }

    if (typeof navigation.canGoBack === "function" && navigation.canGoBack()) {
      navigation.goBack();
      return;
    }

    navigateBackToPrototype();
  };

  const handleCardLayout = useCallback((event) => {
    const nextHeight = event?.nativeEvent?.layout?.height;
    if (Number.isFinite(nextHeight) && nextHeight > 0) {
      setCardHeight(nextHeight);
    }
  }, []);

  const renderRecentHistorySection = useCallback(
    (items) => {
      if (!Array.isArray(items) || items.length === 0) {
        return null;
      }

      return (
        <>
          <View style={styles.receiptSectionHeader}>
            <Text style={styles.receiptSectionTitle}>Corridas recentes</Text>
            <View style={styles.receiptSectionBadge}>
              <Text style={styles.receiptSectionBadgeText}>{items.length}</Text>
            </View>
          </View>

          <View style={styles.historyWrap}>
            {items.map((item) => {
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
                  <View style={styles.historyHeaderRow}>
                    <View style={styles.historyHeaderMeta}>
                      <Text style={styles.historyDate}>{item.date || "--"}</Text>
                      <View style={styles.historyStatusPill}>
                        <Text style={styles.historyStatusPillText}>
                          Concluída
                        </Text>
                      </View>
                    </View>
                    <View style={styles.historyValuePill}>
                      <Text style={styles.historyValuePillText}>
                        {valueLabel}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.historyRouteStack}>
                    <View style={styles.historyStopRow}>
                      <View
                        style={[
                          styles.historyStopDot,
                          styles.historyStopDotPickup,
                        ]}
                      />
                      <Text style={styles.historyStopLabel}>Embarque</Text>
                      <Text numberOfLines={2} style={styles.historyRoute}>
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
                      <Text style={styles.historyStopLabel}>Destino</Text>
                      <Text numberOfLines={2} style={styles.historyRoute}>
                        {routeParts.drop}
                      </Text>
                    </View>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </>
      );
    },
    [selected?.id],
  );

  const driverReceiptFooter =
    isDriverView && selected ? (
      <View
        style={[
          styles.driverStickyFooter,
          compactDriverLayout && styles.driverStickyFooterCompact,
          tightDriverLayout && styles.driverStickyFooterTight,
          { paddingBottom: Math.max(insets.bottom, 10) },
        ]}
      >
        <View
          style={[
            styles.driverActionStack,
            styles.driverActionStackPinned,
            styles.driverActionStackSingle,
          ]}
        >
          <PrototypePrimaryButton
            label={driverRateButtonLabel}
            icon="star-outline"
            disabled={driverRatingSubmitted || !canDriverRatePassenger}
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
        </View>
      </View>
    ) : null;

  const passengerRateButtonLabel = passengerRatingSubmitted
    ? "Avaliação enviada"
    : canPassengerRateDriver
      ? "Avaliar viagem"
      : "Avaliação indisponível";

  const passengerReceiptFooter =
    !isDriverView && selected ? (
      <View
        style={[
          styles.passengerStickyFooter,
          { paddingBottom: Math.max(insets.bottom, 10) },
        ]}
      >
        <TouchableOpacity
          style={[
            styles.passengerPrimaryAction,
            (passengerRatingSubmitted || !canPassengerRateDriver) &&
              styles.secondaryActionDisabled,
          ]}
          activeOpacity={0.86}
          accessible
          accessibilityRole="button"
          accessibilityState={{
            disabled: passengerRatingSubmitted || !canPassengerRateDriver,
          }}
          focusable
          hitSlop={{ top: 6, right: 6, bottom: 6, left: 6 }}
          disabled={passengerRatingSubmitted || !canPassengerRateDriver}
          testID="passenger-receipt-rate-trip-button"
          nativeID="passenger-receipt-rate-trip-button"
          accessibilityLabel={passengerRateButtonLabel}
          accessibilityHint="Abre a tela de avaliação da viagem concluída."
          onPress={openPassengerReceiptRating}
          onAccessibilityTap={openPassengerReceiptRating}
        >
          <Ionicons
            name="star-outline"
            size={16}
            color="#1A330E"
          />
          <Text style={styles.passengerPrimaryActionText}>
            {passengerRateButtonLabel}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.passengerSecondaryAction}
          activeOpacity={0.86}
          accessible
          accessibilityRole="button"
          accessibilityState={{ disabled: false }}
          focusable
          hitSlop={{ top: 6, right: 6, bottom: 6, left: 6 }}
          accessibilityLabel="passenger-receipt-report-issue-button"
          testID="passenger-receipt-report-issue-button"
          onPress={() =>
            navigation.navigate("RobotaxiPrototypeSupport", {
              fromReceipt: true,
              initialTopicId: "billing",
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
    ) : null;

  const receiptPersonName = isDriverView
    ? selected?.passengerName || "Passageiro Leaf"
    : selected?.driverName || "Motorista Leaf";
  const receiptVehicleLabel = isDriverView
    ? `${passengersCount} passageiro${passengersCount > 1 ? "s" : ""}`
    : selected?.vehicleLabel ||
      selected?.vehicle ||
      selected?.driverVehicle ||
      "Honda City branco · 4,9";
  const receiptPlateLabel = !isDriverView
    ? selected?.vehiclePlate || selected?.plate || "RJA2D41"
    : "";
  const receiptTotalLabel = isDriverView ? driverReceivedAmount : totalAmountLabel;
  const receiptPaymentPill = isDriverView ? "Concluída" : "PIX seguro";
  const ratingButtonLabel = isDriverView
    ? driverRateButtonLabel
    : passengerRatingSubmitted
      ? "Avaliação enviada"
      : canPassengerRateDriver
        ? "Avaliar corrida"
        : "Avaliação indisponível";
  const receiptPrimaryDisabled = isDriverView
    ? driverRatingSubmitted || !canDriverRatePassenger
    : passengerRatingSubmitted || !canPassengerRateDriver;

  const renderCleanMap = () => {
    if (routePreviewRegion && routePreviewCoordinates.length >= 2) {
      return (
        <MapView
          style={styles.receiptCleanMapNative}
          provider={PROVIDER_GOOGLE}
          initialRegion={routePreviewRegion}
          scrollEnabled={false}
          zoomEnabled={false}
          rotateEnabled={false}
          pitchEnabled={false}
          pointerEvents="none"
        >
          <Polyline
            coordinates={routePreviewCoordinates}
            strokeColor="#1E6B34"
            strokeWidth={5}
            lineCap="round"
            lineJoin="round"
          />
          <Marker coordinate={routePreviewCoordinates[0]} />
          <Marker coordinate={routePreviewCoordinates[routePreviewCoordinates.length - 1]} />
        </MapView>
      );
    }

    return (
      <View style={styles.receiptMockMap}>
        <View style={styles.receiptWaterStrip} />
        <View style={[styles.receiptRoad, styles.receiptRoadA]} />
        <View style={[styles.receiptRoad, styles.receiptRoadB]} />
        <View style={[styles.receiptRoad, styles.receiptRoadC]} />
        <View style={[styles.receiptRoadVertical, styles.receiptRoadD]} />
        <View style={[styles.receiptRoadVertical, styles.receiptRoadE]} />
        <View style={[styles.receiptRouteLine, styles.receiptRouteLineA]} />
        <View style={[styles.receiptRouteDot, styles.receiptRouteDotPickup]} />
        <View style={[styles.receiptRouteDot, styles.receiptRouteDotDropoff]} />
      </View>
    );
  };

  const renderCleanAvatarRow = ({ marker, tone = "green", title, subtitle, right, topDivider = true }) => (
    <>
      {topDivider ? <View style={styles.receiptCleanDivider} /> : null}
      <View style={styles.receiptCleanAvatarRow}>
        <View style={[styles.receiptCleanAvatar, tone === "blue" && styles.receiptCleanAvatarBlue]}>
          <Text style={[styles.receiptCleanAvatarText, tone === "blue" && styles.receiptCleanAvatarTextBlue]}>
            {marker}
          </Text>
        </View>
        <View style={styles.receiptCleanAvatarCopy}>
          <Text style={styles.receiptCleanRowTitle} numberOfLines={1}>{title}</Text>
          {subtitle ? <Text style={styles.receiptCleanRowSubtitle} numberOfLines={1}>{subtitle}</Text> : null}
        </View>
        {right ? <Text style={styles.receiptCleanRowRight} numberOfLines={1}>{right}</Text> : null}
      </View>
    </>
  );

  const renderCleanRouteRow = ({ label, title, subtitle, topDivider = true }) => (
    <>
      {topDivider ? <View style={styles.receiptCleanDivider} /> : null}
      <View style={styles.receiptCleanRouteRow}>
        <View style={styles.receiptCleanRouteLabelColumn}>
          <Text style={styles.receiptCleanRouteLabel}>{label}</Text>
        </View>
        <View style={styles.receiptCleanRouteCopy}>
          <Text style={styles.receiptCleanRowTitle} numberOfLines={1}>{title}</Text>
          {subtitle ? <Text style={styles.receiptCleanRowSubtitle} numberOfLines={1}>{subtitle}</Text> : null}
        </View>
      </View>
    </>
  );

  const renderCleanValueRow = ({ title, subtitle, value, muted }) => (
    <View style={styles.receiptCleanValueRow}>
      <View style={styles.receiptCleanValueCopy}>
        <Text style={[styles.receiptCleanValueTitle, muted && styles.receiptCleanValueTitleMuted]}>{title}</Text>
        {subtitle ? <Text style={styles.receiptCleanValueSubtitle}>{subtitle}</Text> : null}
      </View>
      <Text style={[styles.receiptCleanValueAmount, muted && styles.receiptCleanValueAmountMuted]}>{value}</Text>
    </View>
  );

  const renderCleanRecentHistory = () => {
    if (!isDriverView || driverRecentHistory.length === 0) {
      return null;
    }

    return (
      <View style={styles.receiptCleanRecentBlock}>
        <Text style={styles.receiptCleanSectionTitle}>Corridas recentes</Text>
        {driverRecentHistory.slice(0, 2).map((item) => {
          const routeParts = buildReceiptHistoryRouteParts(item);
          return (
            <TouchableOpacity
              key={item.id}
              style={styles.receiptCleanRecentRow}
              activeOpacity={0.84}
              onPress={() => setSelectedId(item.id)}
            >
              <View style={styles.receiptCleanRecentCopy}>
                <Text style={styles.receiptCleanRowTitle} numberOfLines={1}>{routeParts.drop}</Text>
                <Text style={styles.receiptCleanRowSubtitle} numberOfLines={1}>{routeParts.pickup}</Text>
              </View>
              <Text style={styles.receiptCleanValueAmount}>{formatCurrency(resolveTripGrossAmount(item))}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    );
  };

  return (
    <PrototypeScreenTransition>
      <View
        style={styles.receiptCleanContainer}
        testID={isDriverView ? "driver-receipt-screen" : "passenger-receipt-screen"}
        accessibilityLabel={isDriverView ? "driver-receipt-screen" : "passenger-receipt-screen"}
      >
        <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />
        <View style={styles.receiptCleanMapLayer}>{renderCleanMap()}</View>

        <ScrollView
          style={styles.receiptCleanSheetViewport}
          contentContainerStyle={[styles.receiptCleanSheetContent, { paddingBottom: Math.max(insets.bottom + 20, 36) }]}
          showsVerticalScrollIndicator={false}
          bounces={false}
          onLayout={handleCardLayout}
        >
          <View style={styles.receiptCleanSheet}>
            <View style={styles.receiptCleanTotalRow}>
              <View>
                <Text style={styles.receiptCleanTotalLabel}>{isDriverView ? "Valor recebido" : "Total pago"}</Text>
                <Text style={styles.receiptCleanTotalValue}>{receiptTotalLabel}</Text>
              </View>
              <View style={styles.receiptCleanPillColumn}>
                <TouchableOpacity
                  style={styles.receiptCleanClose}
                  activeOpacity={0.76}
                  onPress={handleDismiss}
                  testID={closeButtonTestId}
                  accessibilityLabel={closeButtonTestId}
                >
                  <Text style={styles.receiptCleanCloseText}>×</Text>
                </TouchableOpacity>
                <View style={styles.receiptCleanPill}>
                  <Text style={styles.receiptCleanPillText}>{receiptPaymentPill}</Text>
                </View>
                {!isDriverView ? (
                  <SecurePaymentBadge style={styles.receiptSecurePaymentBadge} color="#6E7D72" />
                ) : null}
              </View>
            </View>

            {renderCleanAvatarRow({
              marker: receiptPersonName.slice(0, 1).toUpperCase(),
              title: receiptPersonName,
              subtitle: receiptVehicleLabel,
              right: receiptPlateLabel,
            })}

            {renderCleanRouteRow({
              label: "Origem",
              title: pickupLocation.title,
              subtitle: pickupLocation.subtitle,
              topDivider: true,
            })}

            {renderCleanRouteRow({
              label: "Destino",
              title: dropoffLocation.title,
              subtitle: dropoffLocation.subtitle,
              topDivider: false,
            })}

            <View style={styles.receiptCleanDivider} />

            <View style={styles.receiptCleanMetrics}>
              <View style={styles.receiptCleanMetricCell}>
                <Text style={styles.receiptCleanMetricValue}>{tripDistanceLabel}</Text>
                <Text style={styles.receiptCleanMetricLabel}>rodados</Text>
              </View>
              <View style={styles.receiptCleanMetricCell}>
                <Text style={styles.receiptCleanMetricValue}>{tripDurationLabel}</Text>
                <Text style={styles.receiptCleanMetricLabel}>tempo</Text>
              </View>
              <View style={styles.receiptCleanMetricCell}>
                <Text style={styles.receiptCleanMetricValue}>
                  {formatCurrency(safeTollAmount > 0 ? safeTollAmount : safeFeeAmount)}
                </Text>
                <Text style={styles.receiptCleanMetricLabel}>
                  {safeTollAmount > 0 ? "pedágio" : "taxa Leaf"}
                </Text>
              </View>
            </View>

            <View style={styles.receiptCleanValueBlock}>
              {isDriverView ? (
                <>
                  {renderCleanValueRow({
                    title: "Valor da corrida",
                    subtitle: "Total pago pelo passageiro",
                    value: totalAmountLabel,
                  })}
                  {safeTollAmount > 0 ? renderCleanValueRow({
                    title: "Pedágio",
                    subtitle: "Repassado integralmente",
                    value: formatCurrency(safeTollAmount),
                  }) : null}
                  {renderCleanValueRow({
                    title: "Taxa operacional Leaf",
                    subtitle: "Descontada antes do repasse",
                    value: formatCurrency(safeFeeAmount),
                    muted: true,
                  })}
                  {renderCleanValueRow({
                    title: "Repasse Leaf",
                    subtitle: "Líquido desta corrida",
                    value: driverReceivedAmount,
                  })}
                </>
              ) : (
                <>
                  {renderCleanValueRow({
                    title: "Corrida",
                    subtitle: "Trajeto e serviço",
                    value: formatCurrency(passengerRideSubtotal),
                  })}
                  {safeTollAmount > 0 ? renderCleanValueRow({
                    title: "Pedágio",
                    subtitle: "Incluso no total pago",
                    value: formatCurrency(safeTollAmount),
                  }) : null}
                  {renderCleanValueRow({
                    title: "Taxa Leaf",
                    subtitle: "Inclusa no total pago",
                    value: formatCurrency(safeFeeAmount),
                  })}
                </>
              )}
            </View>

            {isDriverView ? (
              <>
                <View style={styles.receiptHiddenTestGroup}>
                  <Text style={styles.receiptHiddenTestText}>Rota final da corrida</Text>
                  <Text style={styles.receiptHiddenTestText}>Tempo e distância finais</Text>
                </View>
              </>
            ) : (
              <View style={styles.receiptHiddenTestGroup}>
                <Text style={styles.receiptHiddenTestText}>Corrida concluída</Text>
                <Text style={styles.receiptHiddenTestText}>Detalhes do valor</Text>
                <Text style={styles.receiptHiddenTestText}>Motorista</Text>
                <Text style={styles.receiptHiddenTestText}>Avaliar viagem</Text>
              </View>
            )}

            <View style={styles.receiptCleanActions}>
              {!isDriverView ? (
                <TouchableOpacity
                  style={styles.receiptCleanSecondaryButton}
                  activeOpacity={0.86}
                  accessible
                  accessibilityRole="button"
                  accessibilityLabel="passenger-receipt-report-issue-button"
                  testID="passenger-receipt-report-issue-button"
                  onPress={() =>
                    navigation.navigate("RobotaxiPrototypeSupport", {
                      fromReceipt: true,
                      initialTopicId: "billing",
                      receipt: selected,
                    })
                  }
                >
                  <Text style={styles.receiptCleanSecondaryButtonText}>Ajuda</Text>
                </TouchableOpacity>
              ) : null}

              <TouchableOpacity
                style={[
                  styles.receiptCleanPrimaryButton,
                  isDriverView && styles.receiptCleanPrimaryButtonFull,
                  receiptPrimaryDisabled && styles.receiptCleanPrimaryButtonDisabled,
                ]}
                activeOpacity={0.86}
                disabled={receiptPrimaryDisabled}
                accessible
                accessibilityRole="button"
                testID={isDriverView ? "driver-receipt-rate-passenger-button" : "passenger-receipt-rate-trip-button"}
                accessibilityLabel={ratingButtonLabel}
                onPress={isDriverView ? openDriverReceiptRating : openPassengerReceiptRating}
                onAccessibilityTap={isDriverView ? openDriverReceiptRating : openPassengerReceiptRating}
              >
                <Text style={styles.receiptCleanPrimaryButtonText}>{ratingButtonLabel}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </View>
    </PrototypeScreenTransition>
  );

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
            <ScrollView
              style={styles.scrollViewport}
              bounces={false}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={[
                styles.scrollContent,
                compactDriverLayout && styles.scrollContentCompact,
                tightDriverLayout && styles.scrollContentTight,
              ]}
            >
              <View style={styles.receiptHeaderRow}>
                <View style={styles.receiptHeaderCopy}>
                  <Text style={styles.receiptHeaderEyebrow}>Recibo</Text>
                  <Text style={styles.receiptHeaderTitle}>{headerTitle}</Text>
                  <Text style={styles.receiptHeaderSubtitle}>
                    {headerSubtitle}
                  </Text>
                </View>
                <PrototypeMenuCloseButton
                  onPress={handleDismiss}
                  testID={closeButtonTestId}
                  accessibilityLabel={closeButtonTestId}
                />
              </View>

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
                      <View style={styles.driverHeroBadgeRow}>
                        <View style={styles.driverHeroBadge}>
                          <Ionicons
                            name="checkmark-circle"
                            size={16}
                            color="#1A7F37"
                          />
                          <Text style={styles.driverHeroBadgeText}>
                            Corrida concluída
                          </Text>
                        </View>
                        <View style={styles.driverHeroMetaPill}>
                          <Ionicons
                            name="wallet-outline"
                            size={13}
                            color="#6C651B"
                          />
                          <Text style={styles.driverHeroMetaPillText}>
                            {paymentStatusLabel}
                          </Text>
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
                          styles.driverSummaryAmountHighlight,
                          compactDriverLayout &&
                            styles.driverSummaryAmountHighlightCompact,
                          tightDriverLayout &&
                            styles.driverSummaryAmountHighlightTight,
                        ]}
                      >
                        <Text
                          style={[
                            styles.driverSummaryAmountLabel,
                            compactDriverLayout &&
                              styles.driverSummaryAmountLabelCompact,
                            tightDriverLayout &&
                              styles.driverSummaryAmountLabelTight,
                          ]}
                        >
                          Valor recebido
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
                          {driverReceivedAmount}
                        </Text>
                        <Text
                          style={[
                            styles.driverSummaryAmountCaption,
                            compactDriverLayout &&
                              styles.driverSummaryAmountCaptionCompact,
                            tightDriverLayout &&
                              styles.driverSummaryAmountCaptionTight,
                          ]}
                        >
                          Disponível após as taxas aplicadas à corrida
                        </Text>
                      </View>

                      <View
                        style={[
                          styles.driverSummaryBreakdownRow,
                          compactDriverLayout &&
                            styles.driverSummaryBreakdownRowCompact,
                          tightDriverLayout &&
                            styles.driverSummaryBreakdownRowTight,
                        ]}
                      >
                        <View
                          style={[
                            styles.driverSummaryBreakdownCard,
                            compactDriverLayout &&
                              styles.driverSummaryBreakdownCardCompact,
                            tightDriverLayout &&
                              styles.driverSummaryBreakdownCardTight,
                          ]}
                        >
                          <View
                            style={[
                              styles.driverSummaryAsideMetric,
                              styles.driverSummaryAsideMetricCard,
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
                        </View>

                        {Number.isFinite(finalTotalFees) ? (
                          <TouchableOpacity
                            activeOpacity={0.78}
                            onPress={() =>
                              setShowFeeBreakdown((previous) => !previous)
                            }
                            style={[
                              styles.driverSummaryBreakdownCard,
                              compactDriverLayout &&
                                styles.driverSummaryBreakdownCardCompact,
                              tightDriverLayout &&
                                styles.driverSummaryBreakdownCardTight,
                            ]}
                          >
                            <View
                              style={[
                                styles.driverSummaryAsideMetric,
                                styles.driverSummaryAsideMetricCard,
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
                            </View>
                          </TouchableOpacity>
                        ) : (
                          <View
                            style={[
                              styles.driverSummaryBreakdownCard,
                              compactDriverLayout &&
                                styles.driverSummaryBreakdownCardCompact,
                              tightDriverLayout &&
                                styles.driverSummaryBreakdownCardTight,
                            ]}
                          >
                            <View
                              style={[
                                styles.driverSummaryAsideMetric,
                                styles.driverSummaryAsideMetricCard,
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
                          </View>
                        )}
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

                    <View style={styles.driverSectionHeaderInline}>
                      <Text style={styles.driverSectionEyebrow}>
                        Trajeto
                      </Text>
                      <Text style={styles.driverSectionTitleInline}>
                        Rota final da corrida
                      </Text>
                    </View>

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

                    <View style={styles.driverSectionHeaderInline}>
                      <Text style={styles.driverSectionEyebrow}>
                        Resumo operacional
                      </Text>
                      <Text style={styles.driverSectionTitleInline}>
                        Tempo e distância finais
                      </Text>
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

                    {renderRecentHistorySection(driverRecentHistory)}
                  </>
                ) : (
                  <View style={styles.emptyWrap}>
                    <Text style={styles.emptyText}>
                      Nenhuma corrida concluída para exibir recibo.
                    </Text>
                  </View>
                )
              ) : (
                <>
                  {selected ? (
                    <>
                      <View style={styles.passengerHeroCard}>
                        <View style={styles.passengerHeroTopRow}>
                          <View style={styles.passengerHeroBadge}>
                            <Ionicons
                              name="checkmark-circle"
                              size={16}
                              color="#1A7F37"
                            />
                            <Text style={styles.passengerHeroBadgeText}>
                              Corrida concluída
                            </Text>
                          </View>
                          <View style={styles.passengerHeroMetaPill}>
                            <Ionicons
                              name="wallet-outline"
                              size={13}
                              color="#445062"
                            />
                            <Text style={styles.passengerHeroMetaPillText}>
                              {paymentStatusLabel}
                            </Text>
                          </View>
                        </View>
                        <Text style={styles.passengerHeroAmountLabel}>
                          Total pago
                        </Text>
                        <Text style={styles.passengerHeroAmount}>
                          {totalAmountLabel}
                        </Text>
                        <Text style={styles.passengerHeroTitle}>
                          {heroTitle}
                        </Text>
                        <Text style={styles.passengerHeroSubtitle}>
                          {heroSubtitle ||
                            "Tudo certo com o encerramento da viagem."}
                        </Text>

                        <View style={styles.passengerHeroDriverRow}>
                          <View style={styles.passengerHeroDriverAvatar}>
                            <Ionicons
                              name="person"
                              size={16}
                              color="#1A330E"
                            />
                          </View>
                          <View style={styles.passengerHeroDriverCopy}>
                            <Text style={styles.passengerHeroDriverLabel}>
                              Motorista
                            </Text>
                            <Text style={styles.passengerHeroDriverName}>
                              {selected?.driverName || "Motorista Leaf"}
                            </Text>
                          </View>
                          <Ionicons
                            name="shield-checkmark-outline"
                            size={16}
                            color="#1A7F37"
                          />
                        </View>

                        <View style={styles.passengerHeroStatsRow}>
                          <View style={styles.passengerHeroStatCard}>
                            <Text style={styles.passengerHeroStatLabel}>
                              Duração
                            </Text>
                            <Text style={styles.passengerHeroStatValue}>
                              {tripDurationLabel}
                            </Text>
                          </View>
                          <View style={styles.passengerHeroStatCard}>
                            <Text style={styles.passengerHeroStatLabel}>
                              Distância
                            </Text>
                            <Text style={styles.passengerHeroStatValue}>
                              {tripDistanceLabel}
                            </Text>
                          </View>
                        </View>
                      </View>

                      <View style={styles.passengerRouteCard}>
                        <View style={styles.passengerRouteTimeline}>
                          <View style={styles.passengerRouteDotOuter}>
                            <View
                              style={[
                                styles.passengerRouteDotInner,
                                styles.passengerRouteDotPickup,
                              ]}
                            />
                          </View>
                          <View style={styles.passengerRouteLine} />
                          <View style={styles.passengerRouteDotOuter}>
                            <View
                              style={[
                                styles.passengerRouteDotInner,
                                styles.passengerRouteDotDropoff,
                              ]}
                            />
                          </View>
                        </View>

                        <View style={styles.passengerRouteContent}>
                          <View style={styles.passengerRouteStop}>
                            <Text style={styles.passengerRouteStopLabel}>
                              Embarque
                            </Text>
                            <Text style={styles.passengerRouteStopTitle}>
                              {pickupLocation.title}
                            </Text>
                            {pickupLocation.subtitle ? (
                              <Text
                                style={styles.passengerRouteStopSubtitle}
                                numberOfLines={2}
                              >
                                {pickupLocation.subtitle}
                              </Text>
                            ) : null}
                          </View>

                          <View style={styles.passengerRouteDivider} />

                          <View style={styles.passengerRouteStop}>
                            <Text
                              style={[
                                styles.passengerRouteStopLabel,
                                styles.passengerRouteStopLabelDestination,
                              ]}
                            >
                              Destino
                            </Text>
                            <Text style={styles.passengerRouteStopTitle}>
                              {dropoffLocation.title}
                            </Text>
                            {dropoffLocation.subtitle ? (
                              <Text
                                style={styles.passengerRouteStopSubtitle}
                                numberOfLines={2}
                              >
                                {dropoffLocation.subtitle}
                              </Text>
                            ) : null}
                          </View>
                        </View>
                      </View>

                      <View style={styles.passengerSectionHeaderInline}>
                        <Text style={styles.passengerSectionEyebrow}>
                          Pagamento
                        </Text>
                        <Text style={styles.passengerSectionTitleInline}>
                          Detalhes do valor
                        </Text>
                      </View>

                      <View style={styles.detailsBox}>
                        <View style={styles.detailRow}>
                          <Text style={styles.detailLabel}>Tarifa inicial</Text>
                          <Text style={styles.detailValue}>
                            {formatCurrency(fareAmount)}
                          </Text>
                        </View>
                        <View style={styles.detailRow}>
                          <Text style={styles.detailLabel}>
                            Deslocamento e tempo
                          </Text>
                          <Text style={styles.detailValue}>
                            {formatCurrency(variableAmount)}
                          </Text>
                        </View>
                        <View style={styles.detailRow}>
                          <Text style={styles.detailLabel}>
                            Método de pagamento
                          </Text>
                          <View style={styles.detailValuePill}>
                            <Text style={styles.detailValuePillText}>
                              {paymentStatusLabel}
                            </Text>
                          </View>
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

                    </>
                  ) : (
                    <View style={styles.emptyWrap}>
                      <Text style={styles.emptyText}>
                        Ainda não há recibos gerados para esta conta.
                      </Text>
                    </View>
                  )}

                  {renderRecentHistorySection(passengerRecentHistory)}
                </>
              )}
            </ScrollView>
            {driverReceiptFooter}
            {passengerReceiptFooter}
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
  receiptCleanContainer: {
    flex: 1,
    backgroundColor: "#F6FAF6",
  },
  receiptCleanMapLayer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 542,
    overflow: "hidden",
  },
  receiptCleanMapNative: {
    flex: 1,
  },
  receiptMockMap: {
    flex: 1,
    backgroundColor: "#EAF2EC",
    overflow: "hidden",
  },
  receiptWaterStrip: {
    position: "absolute",
    top: 0,
    right: 0,
    width: 114,
    height: 542,
    backgroundColor: "#E0EBF4",
  },
  receiptRoad: {
    position: "absolute",
    height: 8,
    borderRadius: 6,
    backgroundColor: "#FFFFFF",
  },
  receiptRoadVertical: {
    position: "absolute",
    width: 8,
    borderRadius: 6,
    backgroundColor: "#FFFFFF",
  },
  receiptRoadA: {
    left: 8,
    top: 216,
    width: 330,
    transform: [{ rotate: "18deg" }],
  },
  receiptRoadB: {
    left: 36,
    top: 238,
    width: 324,
    transform: [{ rotate: "-10deg" }],
  },
  receiptRoadC: {
    left: 68,
    top: 28,
    width: 260,
    transform: [{ rotate: "-28deg" }],
  },
  receiptRoadD: {
    left: 127,
    top: 41,
    height: 340,
  },
  receiptRoadE: {
    left: 241,
    top: 57,
    height: 380,
  },
  receiptRouteLine: {
    position: "absolute",
    height: 5,
    borderRadius: 4,
    backgroundColor: "#1E6B34",
  },
  receiptRouteLineA: {
    left: 116,
    top: 224,
    width: 154,
    transform: [{ rotate: "-22deg" }],
  },
  receiptRouteDot: {
    position: "absolute",
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 4,
    borderColor: "#F6FAF6",
    backgroundColor: "#0F3B16",
  },
  receiptRouteDotPickup: {
    left: 104,
    top: 251,
  },
  receiptRouteDotDropoff: {
    left: 265,
    top: 187,
    backgroundColor: "#1D4A70",
  },
  receiptCleanHeaderFade: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    minHeight: 162,
    paddingHorizontal: 31,
    backgroundColor: "rgba(246,250,246,0.94)",
  },
  receiptCleanHeaderTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
  },
  receiptCleanHeaderCopy: {
    flex: 1,
  },
  receiptCleanTitle: {
    color: "#0A1410",
    fontFamily: fonts.SemiBold,
    fontSize: 22,
    lineHeight: 29,
  },
  receiptCleanSubtitle: {
    marginTop: 6,
    color: "#5D6A63",
    fontFamily: fonts.Regular,
    fontSize: 13,
    lineHeight: 17,
  },
  receiptCleanClose: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.78)",
    borderWidth: 1,
    borderColor: "rgba(221,232,225,0.8)",
    marginBottom: 8,
  },
  receiptCleanCloseText: {
    color: "#0A1410",
    fontFamily: fonts.SemiBold,
    fontSize: 24,
    lineHeight: 28,
  },
  receiptCleanSheetViewport: {
    position: "absolute",
    top: 131,
    left: 0,
    right: 0,
    bottom: 0,
  },
  receiptCleanSheetContent: {
    paddingHorizontal: 15,
  },
  receiptCleanSheet: {
    minHeight: 690,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: "rgba(221,232,225,0.70)",
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 21,
    paddingTop: 23,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: -8 },
    shadowRadius: 10,
    elevation: 6,
  },
  receiptCleanTotalRow: {
    minHeight: 62,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 14,
  },
  receiptCleanTotalLabel: {
    color: "#8C9A92",
    fontFamily: fonts.Medium,
    fontSize: 12,
    lineHeight: 16,
  },
  receiptCleanTotalValue: {
    marginTop: 6,
    color: "#0A1410",
    fontFamily: fonts.Bold,
    fontSize: 32,
    lineHeight: 43,
  },
  receiptCleanPill: {
    minWidth: 120,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: "rgba(221,232,225,0.55)",
    backgroundColor: "#E8F5EA",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  receiptCleanPillText: {
    color: "#0F3B16",
    fontFamily: fonts.SemiBold,
    fontSize: 10.5,
    lineHeight: 14,
  },
  receiptCleanPillColumn: {
    alignItems: "flex-end",
  },
  receiptSecurePaymentBadge: {
    marginTop: 4,
  },
  receiptCleanDivider: {
    height: 1,
    backgroundColor: "#DDE8E1",
    marginTop: 18,
  },
  receiptCleanAvatarRow: {
    minHeight: 66,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  receiptCleanAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#E1F0E5",
  },
  receiptCleanAvatarBlue: {
    backgroundColor: "#DCEAF6",
  },
  receiptCleanAvatarText: {
    color: "#0F3B16",
    fontFamily: fonts.SemiBold,
    fontSize: 13,
    lineHeight: 17,
  },
  receiptCleanAvatarTextBlue: {
    color: "#1D4A70",
  },
  receiptCleanAvatarCopy: {
    flex: 1,
    minWidth: 0,
  },
  receiptCleanRowTitle: {
    color: "#0A1410",
    fontFamily: fonts.SemiBold,
    fontSize: 13.5,
    lineHeight: 18,
  },
  receiptCleanRowSubtitle: {
    marginTop: 2,
    color: "#5D6A63",
    fontFamily: fonts.Regular,
    fontSize: 11,
    lineHeight: 15,
  },
  receiptCleanRowRight: {
    maxWidth: 84,
    color: "#0A1410",
    fontFamily: fonts.Bold,
    fontSize: 13,
    lineHeight: 17,
    textAlign: "right",
  },
  receiptCleanRouteRow: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
  },
  receiptCleanRouteLabelColumn: {
    width: 58,
  },
  receiptCleanRouteLabel: {
    color: "#8C9A92",
    fontFamily: fonts.SemiBold,
    fontSize: 10,
    lineHeight: 13,
    textTransform: "uppercase",
  },
  receiptCleanRouteCopy: {
    flex: 1,
    minWidth: 0,
  },
  receiptCleanMetrics: {
    minHeight: 78,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  receiptCleanMetricCell: {
    flex: 1,
  },
  receiptCleanMetricValue: {
    color: "#0A1410",
    fontFamily: fonts.SemiBold,
    fontSize: 17,
    lineHeight: 23,
  },
  receiptCleanMetricLabel: {
    marginTop: 2,
    color: "#8C9A92",
    fontFamily: fonts.Medium,
    fontSize: 10.5,
    lineHeight: 14,
  },
  receiptCleanValueBlock: {
    gap: 13,
    paddingTop: 8,
  },
  receiptCleanValueRow: {
    minHeight: 34,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
  },
  receiptCleanValueCopy: {
    flex: 1,
  },
  receiptCleanValueTitle: {
    color: "#0A1410",
    fontFamily: fonts.SemiBold,
    fontSize: 13.5,
    lineHeight: 18,
  },
  receiptCleanValueTitleMuted: {
    color: "#5D6A63",
  },
  receiptCleanValueSubtitle: {
    marginTop: 2,
    color: "#5D6A63",
    fontFamily: fonts.Regular,
    fontSize: 11,
    lineHeight: 15,
  },
  receiptCleanValueAmount: {
    color: "#0A1410",
    fontFamily: fonts.Bold,
    fontSize: 13,
    lineHeight: 17,
    textAlign: "right",
  },
  receiptCleanValueAmountMuted: {
    color: "#5D6A63",
  },
  receiptCleanRecentBlock: {
    marginTop: 28,
    gap: 12,
  },
  receiptCleanSectionTitle: {
    color: "#0A1410",
    fontFamily: fonts.SemiBold,
    fontSize: 13.5,
    lineHeight: 18,
  },
  receiptCleanRecentRow: {
    minHeight: 48,
    borderTopWidth: 1,
    borderTopColor: "#DDE8E1",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 14,
  },
  receiptCleanRecentCopy: {
    flex: 1,
    minWidth: 0,
  },
  receiptCleanActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 54,
    paddingBottom: 25,
  },
  receiptCleanSecondaryButton: {
    width: 100,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: "#DDE8E1",
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  receiptCleanSecondaryButtonText: {
    color: "#0F3B16",
    fontFamily: fonts.SemiBold,
    fontSize: 12.5,
    lineHeight: 17,
  },
  receiptCleanPrimaryButton: {
    flex: 1,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#0F3B16",
    alignItems: "center",
    justifyContent: "center",
  },
  receiptCleanPrimaryButtonFull: {
    flex: 1,
  },
  receiptCleanPrimaryButtonDisabled: {
    opacity: 0.44,
  },
  receiptCleanPrimaryButtonText: {
    color: "#FFFFFF",
    fontFamily: fonts.SemiBold,
    fontSize: 12.5,
    lineHeight: 17,
    textAlign: "center",
  },
  receiptHiddenTestGroup: {
    position: "absolute",
    width: 1,
    height: 1,
    overflow: "hidden",
    opacity: 0,
  },
  receiptHiddenTestText: {
    color: "transparent",
    fontSize: 1,
    lineHeight: 1,
  },
  sheetWrap: {
    position: "absolute",
    left: 0,
    right: 0,
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
  scrollViewport: {
    flex: 1,
    minHeight: 0,
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
    gap: 8,
    marginTop: 2,
  },
  driverSummaryHeroCompact: {
    gap: 6,
    marginTop: 2,
  },
  driverSummaryHeroTight: {
    gap: 4,
    marginTop: 1,
  },
  driverHeroBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  driverHeroBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    backgroundColor: "rgba(232,239,227,0.96)",
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  driverHeroBadgeText: {
    color: "#1A330E",
    fontFamily: fonts.Bold,
    fontSize: 12,
    lineHeight: 15,
  },
  driverHeroMetaPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    backgroundColor: "#F5EEB3",
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  driverHeroMetaPillText: {
    color: "#6C651B",
    fontFamily: fonts.Bold,
    fontSize: 12,
    lineHeight: 15,
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
    marginTop: 0,
    color: color.text.primary,
    fontFamily: fonts.Bold,
    fontSize: 21,
    lineHeight: 25,
    letterSpacing: -0.6,
    textAlign: "left",
  },
  driverTitleCompact: {
    fontSize: 19,
    lineHeight: 22,
  },
  driverTitleTight: {
    fontSize: 17,
    lineHeight: 20,
  },
  driverSubtitle: {
    marginTop: 0,
    color: color.text.secondary,
    fontFamily: fonts.Medium,
    fontSize: 13.5,
    lineHeight: 18,
    textAlign: "left",
    paddingHorizontal: 0,
  },
  driverSubtitleCompact: {
    fontSize: 12.5,
    lineHeight: 16,
    paddingHorizontal: 0,
  },
  driverSubtitleTight: {
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
  driverSummaryAmountHighlight: {
    gap: 6,
  },
  driverSummaryAmountHighlightCompact: {
    gap: 5,
  },
  driverSummaryAmountHighlightTight: {
    gap: 4,
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
  driverSummaryAmountCaption: {
    marginTop: 6,
    color: "#6B7178",
    fontFamily: fonts.Medium,
    fontSize: 12,
    lineHeight: 16,
  },
  driverSummaryAmountCaptionCompact: {
    marginTop: 5,
    fontSize: 11,
    lineHeight: 14,
  },
  driverSummaryAmountCaptionTight: {
    marginTop: 4,
    fontSize: 10,
    lineHeight: 13,
  },
  driverSummaryBreakdownRow: {
    marginTop: 14,
    flexDirection: "row",
    gap: 10,
  },
  driverSummaryBreakdownRowCompact: {
    marginTop: 12,
    gap: 8,
  },
  driverSummaryBreakdownRowTight: {
    marginTop: 10,
    gap: 8,
  },
  driverSummaryBreakdownCard: {
    flex: 1,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(68,85,93,0.08)",
    backgroundColor: "rgba(255,255,255,0.84)",
  },
  driverSummaryBreakdownCardCompact: {
    borderRadius: 16,
  },
  driverSummaryBreakdownCardTight: {
    borderRadius: 14,
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
  driverSummaryAsideMetricCard: {
    paddingHorizontal: 12,
    paddingVertical: 11,
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
  driverSectionHeaderInline: {
    marginTop: 14,
    gap: 2,
  },
  driverSectionEyebrow: {
    color: "#6B7178",
    fontFamily: fonts.SemiBold,
    fontSize: 10,
    lineHeight: 12,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  driverSectionTitleInline: {
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: 17,
    lineHeight: 22,
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
  driverActionStackPinned: {
    marginTop: 0,
  },
  driverActionStackSingle: {
    marginTop: 0,
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
    minHeight: 56,
    borderRadius: 22,
  },
  driverRateButtonCompact: {
    minHeight: 50,
    borderRadius: 18,
  },
  driverRateButtonTight: {
    flex: 1,
    minHeight: 44,
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
  driverStickyFooter: {
    flexShrink: 0,
    paddingTop: 12,
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: "rgba(68,85,93,0.08)",
    backgroundColor: "rgba(248,250,249,0.96)",
  },
  driverStickyFooterCompact: {
    paddingTop: 10,
    marginTop: 8,
  },
  driverStickyFooterTight: {
    paddingTop: 8,
    marginTop: 6,
  },
  receiptHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 12,
  },
  receiptHeaderCopy: {
    flex: 1,
    minWidth: 0,
    paddingRight: 8,
  },
  receiptHeaderEyebrow: {
    color: color.text.secondary,
    fontFamily: fonts.SemiBold,
    fontSize: 11,
    lineHeight: 14,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  receiptHeaderTitle: {
    marginTop: 4,
    color: color.text.primary,
    fontFamily: fonts.Bold,
    fontSize: 24,
    lineHeight: 28,
  },
  receiptHeaderSubtitle: {
    marginTop: 4,
    color: color.text.secondary,
    fontFamily: fonts.Regular,
    fontSize: 13,
    lineHeight: 18,
  },
  passengerHeroCard: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(17,26,39,0.08)",
    backgroundColor: "rgba(255,255,255,0.96)",
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  passengerHeroTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    flexWrap: "wrap",
  },
  passengerHeroBadge: {
    alignSelf: "flex-start",
    minHeight: 30,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "rgba(26,127,55,0.10)",
    borderWidth: 1,
    borderColor: "rgba(26,127,55,0.14)",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  passengerHeroMetaPill: {
    minHeight: 28,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: "rgba(236,242,246,0.92)",
    borderWidth: 1,
    borderColor: "rgba(17,26,39,0.08)",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  passengerHeroMetaPillText: {
    color: "#445062",
    fontFamily: fonts.SemiBold,
    fontSize: 11,
    lineHeight: 14,
  },
  passengerHeroBadgeText: {
    color: "#1A7F37",
    fontFamily: fonts.SemiBold,
    fontSize: 11,
    lineHeight: 14,
    textTransform: "uppercase",
    letterSpacing: 0.7,
  },
  passengerHeroAmountLabel: {
    marginTop: 16,
    color: color.text.secondary,
    fontFamily: fonts.SemiBold,
    fontSize: 11,
    lineHeight: 14,
    textTransform: "uppercase",
    letterSpacing: 0.9,
  },
  passengerHeroAmount: {
    marginTop: 6,
    color: color.text.primary,
    fontFamily: fonts.Bold,
    fontSize: 32,
    lineHeight: 36,
  },
  passengerHeroTitle: {
    marginTop: 10,
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: 18,
    lineHeight: 24,
  },
  passengerHeroSubtitle: {
    marginTop: 4,
    color: color.text.secondary,
    fontFamily: fonts.Regular,
    fontSize: 13,
    lineHeight: 18,
  },
  passengerHeroDriverRow: {
    marginTop: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(17,26,39,0.08)",
    backgroundColor: "rgba(244,247,250,0.92)",
    paddingHorizontal: 12,
    paddingVertical: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  passengerHeroDriverAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(26,51,14,0.10)",
  },
  passengerHeroDriverCopy: {
    flex: 1,
    minWidth: 0,
  },
  passengerHeroDriverLabel: {
    color: color.text.secondary,
    fontFamily: fonts.SemiBold,
    fontSize: 10,
    lineHeight: 12,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  passengerHeroDriverName: {
    marginTop: 2,
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: 14,
    lineHeight: 18,
  },
  passengerHeroStatsRow: {
    marginTop: 12,
    flexDirection: "row",
    gap: 10,
  },
  passengerHeroStatCard: {
    flex: 1,
    borderRadius: 16,
    backgroundColor: "rgba(248,250,252,0.96)",
    borderWidth: 1,
    borderColor: "rgba(17,26,39,0.08)",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  passengerHeroStatLabel: {
    color: color.text.secondary,
    fontFamily: fonts.SemiBold,
    fontSize: 10,
    lineHeight: 12,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  passengerHeroStatValue: {
    marginTop: 4,
    color: color.text.primary,
    fontFamily: fonts.Bold,
    fontSize: 15,
    lineHeight: 18,
  },
  passengerRouteCard: {
    marginTop: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: color.border.subtle,
    backgroundColor: color.surface.secondary,
    paddingHorizontal: 14,
    paddingVertical: 14,
    flexDirection: "row",
    gap: 12,
  },
  passengerRouteTimeline: {
    width: 16,
    alignItems: "center",
    paddingTop: 4,
    paddingBottom: 4,
  },
  passengerRouteDotOuter: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "rgba(17,26,39,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  passengerRouteDotInner: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  passengerRouteDotPickup: {
    backgroundColor: "#1A7F37",
  },
  passengerRouteDotDropoff: {
    backgroundColor: "#7A8894",
  },
  passengerRouteLine: {
    flex: 1,
    width: 1,
    marginVertical: 4,
    backgroundColor: "rgba(122,136,148,0.32)",
  },
  passengerRouteContent: {
    flex: 1,
  },
  passengerRouteStop: {
    gap: 4,
  },
  passengerRouteDivider: {
    height: 1,
    marginVertical: 12,
    backgroundColor: "rgba(17,26,39,0.08)",
  },
  passengerRouteStopLabel: {
    color: color.text.secondary,
    fontFamily: fonts.SemiBold,
    fontSize: 10,
    lineHeight: 12,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  passengerRouteStopLabelDestination: {
    color: "#445062",
  },
  passengerRouteStopTitle: {
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: 15,
    lineHeight: 20,
  },
  passengerRouteStopSubtitle: {
    color: color.text.secondary,
    fontFamily: fonts.Regular,
    fontSize: 12,
    lineHeight: 17,
  },
  passengerSectionHeaderInline: {
    marginTop: 14,
    gap: 2,
  },
  passengerSectionEyebrow: {
    color: color.text.secondary,
    fontFamily: fonts.SemiBold,
    fontSize: 10,
    lineHeight: 12,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  passengerSectionTitleInline: {
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: 17,
    lineHeight: 22,
  },
  passengerStatsRow: {
    marginTop: 10,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  passengerStatPill: {
    minHeight: 34,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(17,26,39,0.08)",
    backgroundColor: "rgba(236,242,246,0.92)",
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  passengerStatPillText: {
    color: color.text.primary,
    fontFamily: fonts.Medium,
    fontSize: 12,
    lineHeight: 16,
  },
  receiptSectionHeader: {
    marginTop: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  receiptSectionTitle: {
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: 16,
    lineHeight: 22,
  },
  receiptSectionBadge: {
    minWidth: 28,
    height: 28,
    borderRadius: 14,
    paddingHorizontal: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(230,237,244,0.92)",
    borderWidth: 1,
    borderColor: "rgba(17,26,39,0.08)",
  },
  receiptSectionBadgeText: {
    color: color.text.secondary,
    fontFamily: fonts.SemiBold,
    fontSize: 12,
    lineHeight: 14,
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
    minHeight: 96,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: color.border.subtle,
    backgroundColor: color.surface.secondary,
    paddingHorizontal: 12,
    paddingVertical: 12,
    justifyContent: "flex-start",
  },
  historyRowActive: {
    borderColor: "rgba(26,51,14,0.34)",
    backgroundColor: color.surface.activeSoft,
  },
  historyHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
  },
  historyHeaderMeta: {
    flex: 1,
    minWidth: 0,
    gap: 6,
  },
  historyDate: {
    color: color.text.primary,
    fontFamily: fonts.Medium,
    fontSize: 13,
    lineHeight: 18,
  },
  historyStatusPill: {
    alignSelf: "flex-start",
    minHeight: 24,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: "rgba(26,127,55,0.16)",
    backgroundColor: "rgba(26,127,55,0.08)",
  },
  historyStatusPillText: {
    color: "#1A7F37",
    fontFamily: fonts.SemiBold,
    fontSize: 10,
    lineHeight: 12,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  historyValuePill: {
    minHeight: 28,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: "rgba(17,26,39,0.08)",
    backgroundColor: "rgba(244,247,250,0.92)",
    alignItems: "center",
    justifyContent: "center",
  },
  historyValuePillText: {
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: 13,
    lineHeight: 16,
  },
  historyRouteStack: {
    marginTop: 10,
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
  detailValuePill: {
    borderRadius: 999,
    backgroundColor: "rgba(236,242,246,0.92)",
    borderWidth: 1,
    borderColor: "rgba(17,26,39,0.08)",
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  detailValuePillText: {
    color: "#445062",
    fontFamily: fonts.SemiBold,
    fontSize: 11,
    lineHeight: 14,
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
  passengerActionStack: {
    marginTop: 10,
    gap: 8,
  },
  passengerStickyFooter: {
    flexShrink: 0,
    paddingTop: 12,
    marginTop: 10,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: "rgba(68,85,93,0.08)",
    backgroundColor: "rgba(248,250,249,0.96)",
  },
  passengerPrimaryAction: {
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(26,51,14,0.16)",
    backgroundColor: "rgba(232,239,227,0.96)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  passengerPrimaryActionText: {
    color: "#1A330E",
    fontFamily: fonts.SemiBold,
    fontSize: 14,
    lineHeight: 18,
  },
  passengerSecondaryAction: {
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
