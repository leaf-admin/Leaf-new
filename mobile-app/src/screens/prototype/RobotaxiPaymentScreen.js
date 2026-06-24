import React, { useCallback, useEffect, useRef, useState } from "react";
import { Alert, StatusBar, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fonts } from "../../theme/runtimeTokens";
import PrototypeScreenTransition from "../../components/prototype/PrototypeScreenTransition";
import PrototypeDismissibleSheet from "../../components/prototype/PrototypeDismissibleSheet";
import {
  LeafButton,
  LeafDivider,
  LeafInfoRow,
  LeafMetricRow,
  LeafRideSheet,
  LeafStateHeader,
  leafButtonMetrics,
  leafRideColors,
} from "../../components/prototype/LeafRideUI";
import WooviPaymentModal from "../../components/payment/WooviPaymentModal";
import SecurePaymentBadge from "../../components/payment/SecurePaymentBadge";
import { usePrototypeMapOcclusion } from "./prototypeMapOcclusion";
import { usePrototypeRideRuntime } from "./prototypeRideRuntime";
import { resolveMeaningfulAddress } from "./addressLabelUtils";
import { buildOverlaySheetViewportMetrics } from "./prototypeRouteViewport";

const SHEET_BOTTOM_OFFSET = 0;
const FALLBACK_CARD_HEIGHT = 356;
const STATE_HEADER_TOP_OFFSET = 50;
const STATE_HEADER_FALLBACK_HEIGHT = 76;
const MIN_VISIBLE_ROUTE_MAP_HEIGHT = 220;

function formatCurrency(value) {
  return `R$ ${Number(value || 0)
    .toFixed(2)
    .replace(".", ",")}`;
}

function resolveLeafFee(fare) {
  const numeric = Number(fare);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  if (numeric > 50) {
    return numeric * 0.03;
  }
  return numeric > 25 ? 1.49 : 0.99;
}

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

function resolveAvailabilityNotice(availability) {
  return String(
    availability?.message ||
      availability?.error ||
      "Não há motoristas disponíveis",
  ).trim();
}

function resolveQuoteLockParam(params = {}) {
  const initialPricingQuote = params?.initialPricingQuote || params?.pricingQuote || {};
  const quote = initialPricingQuote?.quote || {};
  const lock = params?.paymentQuoteLock || params?.quoteLock || {};

  const quoteLockId =
    String(
      params?.quoteLockId ||
        lock?.quoteLockId ||
        initialPricingQuote?.quoteLockId ||
        quote?.quoteLockId ||
        "",
    ).trim() || null;
  const quoteSessionId =
    String(
      params?.quoteSessionId ||
        lock?.quoteSessionId ||
        initialPricingQuote?.quoteSessionId ||
        quote?.quoteSessionId ||
        "",
    ).trim() || null;
  const quoteLockExpiresAt =
    String(
      params?.quoteLockExpiresAt ||
        lock?.quoteLockExpiresAt ||
        initialPricingQuote?.quoteLockExpiresAt ||
        quote?.quoteLockExpiresAt ||
        "",
    ).trim() || null;

  return {
    quoteLockId,
    quoteSessionId,
    quoteLockExpiresAt,
  };
}

function normalizePositiveMoney(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function resolveLockedFareParam(params = {}) {
  const initialPricingQuote = params?.initialPricingQuote || params?.pricingQuote || {};
  const quote = initialPricingQuote?.quote || {};
  const lock = params?.paymentQuoteLock || params?.quoteLock || {};

  return normalizePositiveMoney(
    lock?.fare ??
      lock?.estimatedFare ??
      quote?.fare ??
      quote?.estimatedFare ??
      initialPricingQuote?.fare ??
      initialPricingQuote?.estimatedFare ??
      params?.fare ??
      params?.selectedFare,
  );
}

function isQuoteLockExpired(value) {
  if (!value) {
    return false;
  }

  const expiresAtMs = Date.parse(String(value));
  return Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now();
}

export default function RobotaxiPaymentScreen({ navigation, route }) {
  const {
    selectedDestination,
    currentAddress,
    currentCoordinate,
    profileUid,
    riderProfile,
    checkRideAvailability,
    paymentState,
    selectDestination,
    requestRide,
  } = usePrototypeRideRuntime();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [cardHeight, setCardHeight] = useState(FALLBACK_CARD_HEIGHT);
  const [isPixModalVisible, setPixModalVisible] = useState(false);
  const [checkingAvailability, setCheckingAvailability] = useState(false);
  const [availabilityNotice, setAvailabilityNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [stateHeaderHeight, setStateHeaderHeight] = useState(
    STATE_HEADER_FALLBACK_HEIGHT,
  );
  const autoOpenPixAttemptedRef = useRef(false);
  const sheetBottom = insets.bottom + SHEET_BOTTOM_OFFSET;
  const stateHeaderTop = insets.top + STATE_HEADER_TOP_OFFSET;
  const stateHeaderOcclusion = stateHeaderTop + stateHeaderHeight + 14;
  const sheetViewport = buildOverlaySheetViewportMetrics({
    windowHeight,
    topOcclusion: stateHeaderOcclusion,
    bottomOffset: sheetBottom,
    measuredHeight: cardHeight,
    fallbackHeight: FALLBACK_CARD_HEIGHT,
    minVisibleMapHeight: MIN_VISIBLE_ROUTE_MAP_HEIGHT,
  });

  const destination =
    route?.params?.destination ||
    route?.params?.initialSelectedDestination?.name ||
    selectedDestination?.name ||
    "Destino";
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
  const originAddress =
    resolveMeaningfulAddress(route?.params?.originAddress, currentAddress) ||
    "Origem atual";
  const vehicle = route?.params?.vehicle || "Leaf Plus";
  const { quoteLockId, quoteSessionId, quoteLockExpiresAt } =
    resolveQuoteLockParam(route?.params);
  const quoteLockReady =
    Boolean(quoteLockId) && !isQuoteLockExpired(quoteLockExpiresAt);
  const fare = quoteLockReady ? resolveLockedFareParam(route?.params) : null;
  const fareReady = Number.isFinite(Number(fare)) && Number(fare) > 0;
  const paymentQuoteReady = quoteLockReady && fareReady;
  const canRequestRide = Boolean(
    destinationCoordinate &&
    Number.isFinite(destinationCoordinate?.latitude) &&
    Number.isFinite(destinationCoordinate?.longitude),
  );
  const leafFee = resolveLeafFee(fare);
  const qaAutoConfirmPix = true;

  usePrototypeMapOcclusion({
    routeKey: route?.key,
    layerId: route?.key || "prototype-payment",
    occludedTop: stateHeaderOcclusion,
    occludedBottom: sheetViewport.occludedBottom,
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

  const handleStateHeaderLayout = useCallback((event) => {
    const nextHeight = event?.nativeEvent?.layout?.height;
    if (Number.isFinite(nextHeight) && nextHeight > 0) {
      setStateHeaderHeight(nextHeight);
    }
  }, []);

  useEffect(() => {
    if (!destinationCoordinate || typeof selectDestination !== "function") {
      return;
    }

    const currentKey = [
      selectedDestination?.name || "",
      selectedDestination?.coordinate?.latitude || "",
      selectedDestination?.coordinate?.longitude || "",
    ].join(":");
    const nextKey = [
      destination || "",
      destinationCoordinate.latitude,
      destinationCoordinate.longitude,
    ].join(":");

    if (currentKey === nextKey) {
      return;
    }

    selectDestination({
      name: destination,
      address: destinationAddress || destination,
      coordinate: destinationCoordinate,
    }).catch(() => {
      // Route params still keep this payment screen usable if hydration fails.
    });
  }, [
    destination,
    destinationAddress,
    destinationCoordinate,
    selectDestination,
    selectedDestination?.coordinate?.latitude,
    selectedDestination?.coordinate?.longitude,
    selectedDestination?.name,
  ]);

  const handleOpenPixModal = useCallback(async () => {
    if (!canRequestRide) {
      navigation.navigate("RobotaxiPrototypeDestination", {
        initialSelectedDestination:
          destination && destination !== "Destino"
            ? {
                name: destination,
                address: destinationAddress || destination,
                coordinate: destinationCoordinate,
              }
            : null,
        initialSelectedPlan: route?.params?.initialSelectedPlan || "plus",
        initialPickupAddress: originAddress,
      });
      return;
    }

    if (checkingAvailability || submitting) {
      return;
    }

    if (!paymentQuoteReady) {
      setAvailabilityNotice(
        "Cotação expirada, ausente ou sem valor. Recalcule a tarifa antes de pagar.",
      );
      return;
    }

    if (typeof checkRideAvailability !== "function") {
      setAvailabilityNotice("Não foi possível validar disponibilidade agora.");
      return;
    }

    try {
      setCheckingAvailability(true);
      setAvailabilityNotice("");

      const availability = await checkRideAvailability({
        destination: {
          name: destination,
          address: destinationAddress,
          coordinate: destinationCoordinate,
        },
        vehicle,
      });

      if (!availability?.available) {
        setAvailabilityNotice(resolveAvailabilityNotice(availability));
        return;
      }

      setPixModalVisible(true);
    } catch (error) {
      setAvailabilityNotice(
        error?.message || "Não foi possível validar disponibilidade agora.",
      );
    } finally {
      setCheckingAvailability(false);
    }
  }, [
    canRequestRide,
    checkRideAvailability,
    checkingAvailability,
    destination,
    destinationAddress,
    destinationCoordinate,
    navigation,
    originAddress,
    paymentQuoteReady,
    route?.params?.initialSelectedPlan,
    submitting,
    vehicle,
  ]);

  useEffect(() => {
    if (
      !route?.params?.autoOpenPix ||
      autoOpenPixAttemptedRef.current ||
      !canRequestRide
    ) {
      return;
    }

    autoOpenPixAttemptedRef.current = true;
    handleOpenPixModal();
  }, [
    canRequestRide,
    handleOpenPixModal,
    route?.params?.autoOpenPix,
  ]);

  const handleClosePixModal = useCallback(() => {
    if (submitting) {
      return;
    }
    setPixModalVisible(false);
  }, [submitting]);

  const handlePixPaymentConfirmed = useCallback(
    async (paymentConfirmation = null) => {
      if (!canRequestRide) {
        Alert.alert(
          "Selecione um destino",
          "Defina um destino válido antes de confirmar o pagamento.",
        );
        return;
      }

      try {
        setSubmitting(true);
        setPixModalVisible(false);
        await requestRide({
          destination: {
            name: destination,
            address: destinationAddress,
            coordinate: destinationCoordinate,
          },
          originAddress,
          vehicle,
          fare,
          paymentMethod: "pix",
          paymentConfirmation,
        });

        navigation.replace("RobotaxiPrototypePaymentSuccess", {
          destination,
          destinationAddress,
          destinationCoordinate,
          initialSelectedDestination:
            route?.params?.initialSelectedDestination || {
              name: destination,
              address: destinationAddress,
              coordinate: destinationCoordinate,
            },
          selectedFare: route?.params?.selectedFare || fare,
          fare,
          originAddress,
          vehicle,
          autoAdvance: true,
        });
      } catch (error) {
        const normalizedCode = String(error?.code || "")
          .trim()
          .toUpperCase();
        const normalizedMessage = String(error?.message || "").toLowerCase();
        if (
          normalizedCode === "NO_DRIVERS_AVAILABLE" ||
          normalizedMessage.includes("não há motoristas") ||
          normalizedMessage.includes("nao ha motoristas")
        ) {
          const refundPayload = error?.payload || {};
          navigation.replace("RobotaxiPrototypeNoDrivers", {
            reason: error?.message || "Nenhum motorista disponível no momento.",
            refundStatus: refundPayload?.refundStatus || null,
            refundAmount: Number(refundPayload?.refundAmount || 0),
            cancellationFee: Number(refundPayload?.cancellationFee || 0),
            chargeId: refundPayload?.chargeId || null,
          });
          return;
        }

        navigation.replace("RobotaxiPrototypePaymentFailed", {
          errorMessage:
            error?.message || "Falha ao enviar a corrida para o servidor.",
          retryRouteName: "RobotaxiPrototypePayment",
          retryParams: {
            ...route?.params,
            destination,
            destinationAddress,
            destinationCoordinate,
            originAddress,
            vehicle,
            fare,
            autoOpenPix: true,
          },
        });
      } finally {
        setSubmitting(false);
      }
    },
    [
      canRequestRide,
      destination,
      destinationAddress,
      destinationCoordinate,
      fare,
      navigation,
      originAddress,
      requestRide,
      route?.params,
      vehicle,
    ],
  );

  return (
    <PrototypeScreenTransition>
      <View style={styles.container} pointerEvents="box-none">
        <StatusBar
          translucent
          backgroundColor="transparent"
          barStyle="dark-content"
        />
        <LeafStateHeader
          title="Pagar corrida"
          subtitle={destination}
          rightLabel="Pix"
          rightTone="dark"
          insetsTop={insets.top}
          onLayout={handleStateHeaderLayout}
        />
        <PrototypeDismissibleSheet
          onClose={handleDismiss}
          backdropDismissEnabled={false}
          dragEnabled={false}
          sheetStyle={[styles.sheetWrap, { bottom: sheetBottom }]}
        >
          <LeafRideSheet
            onLayout={handleCardLayout}
            style={[
              styles.paymentCard,
              { maxHeight: sheetViewport.maxSheetHeight },
            ]}
            scrollEnabled
            scrollStyle={styles.paymentScroll}
            scrollContentContainerStyle={styles.paymentScrollContent}
          >
            <View style={styles.headerRow}>
              <Text style={styles.title}>Código Pix</Text>
              <Text style={styles.price}>
                {fareReady ? formatCurrency(fare) : "Cotação pendente"}
              </Text>
            </View>

            <LeafDivider style={styles.divider} />

            <LeafMetricRow
              metrics={[
                { value: "4 min", label: "buscar" },
                { value: "2,8 km", label: "distancia" },
                {
                  value: leafFee == null ? "--" : formatCurrency(leafFee),
                  label: "taxa Leaf",
                },
              ]}
            />

            <LeafDivider style={styles.dividerLarge} />

            <LeafInfoRow
              marker="$"
              title="Pagamento via PIX"
              subtitle="QR Code no próximo passo"
              style={styles.paymentRow}
            />
            <SecurePaymentBadge style={styles.securePaymentBadge} />

            <Text style={styles.hiddenText}>{destination}</Text>
            <Text style={styles.hiddenText}>{vehicle}</Text>

            <View style={styles.actionsRow}>
              <LeafButton
                label="Editar"
                tone="ghost"
                onPress={handleDismiss}
                style={styles.editButton}
              />
              <LeafButton
                label={
                  submitting
                    ? "Enviando..."
                    : checkingAvailability
                      ? "Verificando..."
                      : canRequestRide
                        ? "Confirmar"
                        : "Escolher destino"
                }
                tone="primary"
                testID="passenger-payment-pay-pix-button"
                accessibilityLabel="passenger-payment-pay-pix-button"
                disabled={submitting || checkingAvailability}
                onPress={handleOpenPixModal}
                style={styles.ctaButton}
              />
            </View>

            {!canRequestRide ? (
              <Text style={styles.pendingText}>
                Escolha um destino válido para seguir com o Pix.
              </Text>
            ) : null}
            {availabilityNotice ? (
              <Text style={styles.pendingText}>{availabilityNotice}</Text>
            ) : null}

            {paymentState?.status === "pending" && paymentState?.error ? (
              <Text style={styles.pendingText}>
                Pagamento pendente de confirmação: {paymentState.error}
              </Text>
            ) : null}
          </LeafRideSheet>
        </PrototypeDismissibleSheet>

        <WooviPaymentModal
          visible={isPixModalVisible}
          onClose={handleClosePixModal}
          onPaymentConfirmed={handlePixPaymentConfirmed}
          tripData={{
            pickup: {
              add: originAddress,
              lat: currentCoordinate?.latitude,
              lng: currentCoordinate?.longitude,
            },
            drop: {
              add: destinationAddress || destination,
              lat: destinationCoordinate?.latitude,
              lng: destinationCoordinate?.longitude,
            },
            carType: vehicle,
            estimatedFare: Number(fare),
          }}
          estimates={{ estimateFare: Number(fare) }}
          quoteSessionId={quoteSessionId}
          quoteLockId={quoteLockId}
          passengerId={profileUid || riderProfile?.uid || riderProfile?.id || ""}
          passengerName={riderProfile?.name || "Passageira Leaf"}
          passengerEmail={riderProfile?.email || "passageiro@leaf.app.br"}
          qaAutoConfirm={qaAutoConfirmPix}
        />
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
  paymentCard: {
    minHeight: 356,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    paddingHorizontal: 24,
    paddingTop: 14,
  },
  paymentScroll: {
    flexGrow: 0,
  },
  paymentScrollContent: {
    paddingBottom: 4,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  title: {
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 18,
    lineHeight: 24,
  },
  price: {
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 20,
    lineHeight: 26,
  },
  divider: {
    marginTop: 16,
    marginBottom: 22,
  },
  dividerLarge: {
    marginTop: 28,
    marginBottom: 20,
  },
  paymentRow: {
    minHeight: 44,
  },
  securePaymentBadge: {
    marginTop: 4,
  },
  actionsRow: {
    marginTop: 22,
    flexDirection: "row",
    gap: 16,
  },
  editButton: {
    flex: 1,
    minHeight: leafButtonMetrics.height,
    borderRadius: leafButtonMetrics.radius,
  },
  ctaButton: {
    flex: 1.08,
    minHeight: leafButtonMetrics.height,
    borderRadius: leafButtonMetrics.radius,
  },
  pendingText: {
    marginTop: 10,
    color: leafRideColors.dangerText,
    fontFamily: fonts.Regular,
    fontSize: 11,
    lineHeight: 15,
    textAlign: "center",
  },
  hiddenText: {
    position: "absolute",
    width: 1,
    height: 1,
    opacity: 0,
  },
});
