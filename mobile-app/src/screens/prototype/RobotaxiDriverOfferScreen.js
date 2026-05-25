import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, StatusBar, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fonts } from "../../theme/runtimeTokens";
import SecurePaymentBadge from "../../components/payment/SecurePaymentBadge";
import PrototypeScreenTransition from "../../components/prototype/PrototypeScreenTransition";
import PrototypeDismissibleSheet from "../../components/prototype/PrototypeDismissibleSheet";
import PrototypeMapLayer from "../../components/prototype/PrototypeMapLayer";
import {
  LeafButton,
  LeafRideSheet,
  LeafStateHeader,
  leafRideColors,
} from "../../components/prototype/LeafRideUI";
import { usePrototypeMapOcclusion } from "./prototypeMapOcclusion";
import { usePrototypeRideRuntime } from "./prototypeRideRuntime";
import { PROTOTYPE_ORIGIN_COORDINATE, PROTOTYPE_REGION } from "./robotaxiPrototypeData";
import {
  getDriverOfferPayoutLabel,
  hasAuthoritativeDriverOfferPricing,
  selectDisplayableDriverOffer,
} from "./driverOfferPricingSnapshot";
import useCampaignAssetOverride from "../../hooks/useCampaignAssetOverride";

const SHEET_BOTTOM_OFFSET = 0;
const FALLBACK_CARD_HEIGHT = 356;

export const DRIVER_OFFER_RENDERED_CARD_FIELDS = Object.freeze([
  "net_payout",
  "gross_fare",
  "pickup_address",
  "destination_address",
  "pickup_eta",
  "pickup_distance",
  "trip_distance",
  "trip_duration",
  "passenger_name",
  "passenger_photo",
  "passenger_rating",
  "passenger_verified_badge",
  "ride_preferences",
  "payment_confirmed",
  "response_timer",
  "accept_action",
  "reject_action",
]);

function isCompetitiveAcceptLossMessage(message) {
  return String(message || "")
    .trim()
    .toLowerCase()
    .includes("outro motorista aceitou");
}

function normalizeDriverStatusError(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function isActivationOrVehicleStatusError(message) {
  const normalized = normalizeDriverStatusError(message);
  if (!normalized) {
    return false;
  }

  return (
    normalized.includes("ativar seu status") ||
    normalized.includes("veiculo valido") ||
    normalized.includes("veiculo ativo") ||
    normalized.includes("vehicle_required") ||
    normalized.includes("driver_not_eligible") ||
    normalized.includes("ativacao do motorista pendente")
  );
}

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function formatCurrency(value) {
  return `R$ ${toNumber(value, 0).toFixed(2).replace(".", ",")}`;
}

function formatDistanceKm(valueMi) {
  const numeric = Number(valueMi);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "--";
  }

  const km = numeric * 1.60934;
  const digits = km >= 10 ? 0 : 1;
  return `${km.toFixed(digits).replace(".", ",")} km`;
}

function formatDistanceKmValue(valueKm) {
  const numeric = Number(valueKm);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "--";
  }

  if (numeric < 1) {
    return `${Math.max(10, Math.round((numeric * 1000) / 10) * 10)} m`;
  }

  const digits = numeric >= 10 ? 0 : 1;
  return `${numeric.toFixed(digits).replace(".", ",")} km`;
}

function formatCountdown(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric >= 0) {
    return `${Math.round(numeric)}s`;
  }

  const normalized = String(value || "").trim();
  if (!normalized) {
    return "18s";
  }

  return normalized.endsWith("s") ? normalized : `${normalized}s`;
}

function resolveRidePreferenceItems(source = {}) {
  const preferences =
    source?.preferences ||
    source?.ridePreferences ||
    source?.comfortPreferences ||
    {};
  if (!preferences || typeof preferences !== "object") {
    return [];
  }

  const temperatureLabel = String(
    preferences.temperatureLabel ||
      preferences.temperaturePreferenceLabel ||
      preferences.comfort?.temperature?.label ||
      "",
  ).trim();
  const soundLabel = String(
    preferences.soundLabel ||
      preferences.soundPreferenceLabel ||
      preferences.comfort?.sound?.label ||
      "",
  ).trim();

  return [
    temperatureLabel ? { key: "temperature", label: temperatureLabel } : null,
    soundLabel ? { key: "sound", label: soundLabel } : null,
  ].filter(Boolean);
}

function toRouteNumber(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeMapCoordinate(value) {
  const latitude = Number(value?.latitude ?? value?.lat);
  const longitude = Number(value?.longitude ?? value?.lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }
  return { latitude, longitude };
}

function buildFallbackOfferRegion(points = []) {
  const normalizedPoints = points
    .map(normalizeMapCoordinate)
    .filter(Boolean);

  if (normalizedPoints.length === 0) {
    return PROTOTYPE_REGION;
  }

  const latitudes = normalizedPoints.map(point => point.latitude);
  const longitudes = normalizedPoints.map(point => point.longitude);
  const minLatitude = Math.min(...latitudes);
  const maxLatitude = Math.max(...latitudes);
  const minLongitude = Math.min(...longitudes);
  const maxLongitude = Math.max(...longitudes);

  return {
    latitude: (minLatitude + maxLatitude) / 2,
    longitude: (minLongitude + maxLongitude) / 2,
    latitudeDelta: Math.max(0.018, (maxLatitude - minLatitude) * 1.7),
    longitudeDelta: Math.max(0.018, (maxLongitude - minLongitude) * 1.7),
  };
}

function buildDriverOfferFromRouteParams(params = {}) {
  if (!params || typeof params !== "object") {
    return null;
  }

  if (params.request && typeof params.request === "object") {
    return params.request;
  }

  if (typeof params.request === "string") {
    try {
      const parsed = JSON.parse(params.request);
      if (parsed && typeof parsed === "object") {
        return parsed;
      }
    } catch (_error) {
      // Continue with scalar deep-link params.
    }
  }

  const bookingId = String(params.bookingId || params.qaBookingId || params.id || "").trim();
  if (!bookingId) {
    return null;
  }

  const driverNetAmount = toRouteNumber(params.driverNetAmount ?? params.estimatedDriverNetAmount, null);
  const fare = toRouteNumber(params.fare ?? params.grossFare ?? params.amount, null);

  return {
    bookingId,
    id: bookingId,
    passengerName: String(params.passengerName || params.passenger || "Passageiro Leaf").trim(),
    passenger: String(params.passengerName || params.passenger || "Passageiro Leaf").trim(),
    pickupAddress: String(params.pickupAddress || params.pickup || "Embarque indisponível").trim(),
    pickup: String(params.pickupAddress || params.pickup || "Embarque indisponível").trim(),
    dropoffAddress: String(params.dropoffAddress || params.dropoff || "Destino indisponível").trim(),
    dropoff: String(params.dropoffAddress || params.dropoff || "Destino indisponível").trim(),
    ...(fare !== null ? { fare, grossFare: fare, totalAmount: fare, amount: fare } : {}),
    ...(driverNetAmount !== null
      ? {
          driverNetAmount,
          estimatedDriverNetAmount: driverNetAmount,
        }
      : {}),
    estimatedOperationalFee: toRouteNumber(params.estimatedOperationalFee, undefined),
    estimatedPaymentIntermediationFee: toRouteNumber(params.estimatedPaymentIntermediationFee, undefined),
    estimatedTotalFees: toRouteNumber(params.estimatedTotalFees, undefined),
    distanceKm: toRouteNumber(params.distanceKm, undefined),
    tripDistanceKm: toRouteNumber(params.tripDistanceKm, undefined),
    pickupEtaMin: toRouteNumber(params.pickupEtaMin, undefined),
    tripDurationMin: toRouteNumber(params.tripDurationMin, undefined),
    passengerRating: toRouteNumber(params.passengerRating, undefined),
    expiresInSec: toRouteNumber(params.expiresInSec, 18),
    paymentMethod: String(params.paymentMethod || "pix").trim(),
    pricingSnapshotLocked: String(params.pricingSnapshotLocked || "true") !== "false",
  };
}

export default function RobotaxiDriverOfferScreen({ navigation, route }) {
  const {
    currentCoordinate,
    currentHeading,
    driverCoordinate,
    driverOffers,
    driverTripMeta,
    profile,
    acceptDriverOffer,
    rejectDriverOffer,
    lastError,
  } =
    usePrototypeRideRuntime();
  const insets = useSafeAreaInsets();
  const [cardHeight, setCardHeight] = useState(FALLBACK_CARD_HEIGHT);
  const [busyAction, setBusyAction] = useState("");
  const safeBottom = Math.max(0, Number(insets.bottom) || 0);
  const sheetBottom = SHEET_BOTTOM_OFFSET;
  const mapRef = useRef(null);
  const routeRequest = useMemo(() => {
    const candidate = buildDriverOfferFromRouteParams(route?.params);
    if (
      (candidate?.bookingId || candidate?.id) &&
      hasAuthoritativeDriverOfferPricing(candidate)
    ) {
      return candidate;
    }
    return null;
  }, [route?.params]);
  const [allowRouteFallback, setAllowRouteFallback] = useState(
    Boolean(routeRequest),
  );
  const qaKeepRouteRequestVisible = Boolean(
    route?.params?.qaKeepVisible || route?.params?.__qaKeepVisible,
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
  const visibleLastError =
    hasRequest && isActivationOrVehicleStatusError(lastError) ? "" : lastError;

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

  const pickupLabel =
    String(request?.pickup || request?.pickupAddress || "").trim() ||
    "Origem indisponível";
  const dropoffLabel =
    String(request?.dropoff || request?.dropoffAddress || "").trim() ||
    "Destino indisponível";
  const pickupDistanceLabel = formatDistanceKm(distanceMi);
  const tripDistanceLabel = formatDistanceKmValue(
    request?.tripDistanceKm ||
      request?.routeDistanceKm ||
      request?.estimatedTripDistanceKm ||
      route?.params?.tripDistanceKm,
  );
  const pickupEtaLabel = `${Math.max(
    1,
    toNumber(
      request?.pickupEtaMin ||
        request?.pickupDurationMin ||
        request?.etaMin ||
        route?.params?.pickupEtaMin,
      4,
    ),
  )} min`;
  const tripDurationLabel = `${Math.max(
    1,
    toNumber(
      request?.tripDurationMin ||
        request?.durationMin ||
        request?.durationMinutes ||
        route?.params?.tripDurationMin,
      12,
    ),
  )} min`;
  const passengerRatingLabel =
    passengerRating == null
      ? "4,9"
      : passengerRating.toFixed(1).replace(".", ",");
  const passengerName =
    String(request?.passengerName || request?.passenger || "Passageiro Leaf").trim() ||
    "Passageiro Leaf";
  const passengerInitial = passengerName.charAt(0).toUpperCase() || "P";
  const countdownLabel = formatCountdown(
    request?.expiresInSec ||
      request?.expiresInSeconds ||
      route?.params?.expiresInSec,
  );
  const grossFareLabel = formatCurrency(
    request?.grossFare ||
      request?.totalAmount ||
      request?.amount ||
      request?.fare,
  );
  const ridePreferenceItems = resolveRidePreferenceItems(request);
  const routeDriverCoordinate =
    normalizeMapCoordinate(request?.driverCoordinate) ||
    normalizeMapCoordinate(request?.currentCoordinate) ||
    normalizeMapCoordinate(request?.originCoordinate);
  const offerRouteCoordinates = useMemo(() => {
    const routePlan = driverTripMeta?.routePlan || {};
    const candidateRoute =
      routePlan.pickupCoordinates ||
      request?.pickupRouteCoordinates ||
      request?.routeCoordinates ||
      [];
    const normalizedCandidate = Array.isArray(candidateRoute)
      ? candidateRoute.map(normalizeMapCoordinate).filter(Boolean)
      : [];
    if (normalizedCandidate.length >= 2) {
      return normalizedCandidate;
    }

    const origin =
      routeDriverCoordinate ||
      normalizeMapCoordinate(driverCoordinate) ||
      normalizeMapCoordinate(currentCoordinate) ||
      PROTOTYPE_ORIGIN_COORDINATE;
    const pickup =
      normalizeMapCoordinate(driverTripMeta?.pickupCoordinate) ||
      normalizeMapCoordinate(request?.pickupCoordinate) ||
      origin;
    return [origin, pickup].filter(Boolean);
  }, [
    currentCoordinate,
    driverCoordinate,
    driverTripMeta?.pickupCoordinate,
    driverTripMeta?.routePlan,
    request?.pickupCoordinate,
    request?.pickupRouteCoordinates,
    request?.routeCoordinates,
    routeDriverCoordinate,
  ]);
  const offerOriginCoordinate =
    routeDriverCoordinate ||
    normalizeMapCoordinate(driverCoordinate) ||
    normalizeMapCoordinate(currentCoordinate) ||
    offerRouteCoordinates[0] ||
    PROTOTYPE_ORIGIN_COORDINATE;
  const offerVehicleColor = String(
    profile?.vehicleColor ||
      profile?.vehicle?.color ||
      profile?.carColor ||
      profile?.car?.color ||
      driverTripMeta?.vehicleColor ||
      driverTripMeta?.vehicle?.color ||
      '',
  ).trim();
  const vehicleMarkerCampaignAsset = useCampaignAssetOverride({
    surface: 'ride_map',
    placement: 'vehicle_marker',
    role: 'driver',
    userId: profile?.uid || '',
    context: {
      city: 'rio_de_janeiro',
    },
    eventMetadata: {
      screen: 'robotaxi_driver_offer',
      state: hasRequest ? 'offer_visible' : 'empty',
    },
  });
  const offerPickupCoordinate =
    normalizeMapCoordinate(driverTripMeta?.pickupCoordinate) ||
    normalizeMapCoordinate(request?.pickupCoordinate) ||
    offerRouteCoordinates[offerRouteCoordinates.length - 1] ||
    offerOriginCoordinate;
  const offerMapRegion = useMemo(
    () =>
      buildFallbackOfferRegion([
        offerOriginCoordinate,
        offerPickupCoordinate,
        ...offerRouteCoordinates,
      ]),
    [offerOriginCoordinate, offerPickupCoordinate, offerRouteCoordinates]
  );

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
    if (!routeRequest || liveRequest || qaKeepRouteRequestVisible) {
      return undefined;
    }

    const timeoutId = setTimeout(() => {
      setAllowRouteFallback(false);
    }, 4000);

    return () => clearTimeout(timeoutId);
  }, [liveRequest, qaKeepRouteRequestVisible, routeRequest]);

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
      if (typeof navigation.replace === "function") {
        navigation.replace("RobotaxiPrototypeDriverTrip", { request });
        return;
      }
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
        <PrototypeMapLayer
          mapRef={mapRef}
          region={offerMapRegion}
          forceRegionUpdate
          userCoordinate={offerOriginCoordinate}
          userHeading={currentHeading}
          userAvatarLetter="M"
          driverCoordinate={offerOriginCoordinate}
          driverHeading={currentHeading}
          routeCoordinates={offerRouteCoordinates}
          originCoordinate={offerOriginCoordinate}
          destinationCoordinate={offerPickupCoordinate}
          destinationLabel="Embarque"
          destinationAddress={pickupLabel}
          originLabel="Motorista"
          originAddress="Sua localização atual"
          interactionEnabled={false}
          hideRouteEndpointMarkers
          hideUserMarker
          animateRoute
          driverMarkerMode="car"
          driverVehicleColor={offerVehicleColor}
          driverMarkerAssetUrl={vehicleMarkerCampaignAsset.imageUrl}
          driverMarkerLetter="M"
          destinationMarkerMode="avatar"
          destinationMarkerLetter={passengerInitial}
          mapSafetyProfile="driver"
        />
        {hasRequest ? (
          <LeafStateHeader
            title="Nova corrida"
            subtitle="Pagamento confirmado"
            rightLabel={countdownLabel}
            rightTone="dark"
            insetsTop={insets.top}
          />
        ) : null}
        <PrototypeDismissibleSheet
          onClose={handleDismiss}
          sheetStyle={[styles.sheetWrap, { bottom: sheetBottom }]}
        >
          <LeafRideSheet
            onLayout={handleCardLayout}
            style={[styles.offerCard, { paddingBottom: 18 + safeBottom }]}
            testID="driver-offer-screen"
            accessibilityLabel="driver-offer-screen"
          >
            {hasRequest ? (
              <>
                <View style={styles.sheetHandle} />
                <View style={styles.offerHeader}>
                  <View style={styles.offerHeaderCopy}>
                    <Text style={styles.offerTitle} numberOfLines={1}>
                      Nova solicitação
                    </Text>
                    <Text style={styles.offerTimer} numberOfLines={1}>
                      {countdownLabel} para responder
                    </Text>
                  </View>
                  <View
                    style={styles.netPayout}
                    accessibilityLabel={`Líquido ${fareLabel}`}
                  >
                    <Text style={styles.netPayoutValue} numberOfLines={1}>
                      {fareLabel} líquido
                    </Text>
                  </View>
                </View>

                <View style={styles.passengerRow}>
                  <View style={styles.passengerAvatar}>
                    <Text style={styles.passengerAvatarText}>{passengerInitial}</Text>
                  </View>
                  <View style={styles.passengerCopy}>
                    <Text style={styles.passengerName} numberOfLines={1}>
                      {passengerName}
                    </Text>
                    <Text style={styles.passengerMeta} numberOfLines={1}>
                      Passageiro verificado · {passengerRatingLabel}
                    </Text>
                  </View>
                </View>

                <View
                  style={styles.routeSummary}
                  testID="driver-offer-screen-summary"
                  accessibilityLabel={`Resumo da corrida. Embarque em ${pickupEtaLabel}, ${pickupDistanceLabel}. Viagem de ${tripDurationLabel}, ${tripDistanceLabel}. Total ${grossFareLabel}.`}
                >
                  <View style={styles.routeStep}>
                    <View style={styles.routeIcon}>
                      <Ionicons name="locate-outline" size={15} color={leafRideColors.text} />
                    </View>
                    <View style={styles.routeCopy}>
                      <Text style={styles.routeAddress} numberOfLines={1}>
                        {pickupLabel}
                      </Text>
                      <Text style={styles.routeMeta} numberOfLines={1}>
                        {pickupEtaLabel} · {pickupDistanceLabel} até o embarque
                      </Text>
                    </View>
                  </View>

                  <View style={styles.routeStep}>
                    <View style={styles.routeIcon}>
                      <Ionicons name="location-outline" size={15} color={leafRideColors.leaf} />
                    </View>
                    <View style={styles.routeCopy}>
                      <Text style={styles.routeAddress} numberOfLines={1}>
                        {dropoffLabel}
                      </Text>
                      <Text style={styles.routeMeta} numberOfLines={1}>
                        {tripDurationLabel} · {tripDistanceLabel} de viagem
                      </Text>
                    </View>
                  </View>
                </View>

                <View style={styles.confirmedLine}>
                  <Ionicons name="checkmark-circle" size={15} color={leafRideColors.leaf} />
                  <Text style={styles.confirmedText} numberOfLines={1}>
                    PIX confirmado
                  </Text>
                  <SecurePaymentBadge style={styles.confirmedSecurePaymentBadge} />
                </View>

                {ridePreferenceItems.length > 0 ? (
                  <View
                    style={styles.preferencePanel}
                    testID="driver-offer-screen-preferences"
                    accessibilityLabel="Preferências do passageiro"
                  >
                    <Text style={styles.hiddenText}>Preferências</Text>
                    <View style={styles.preferenceRow}>
                      {ridePreferenceItems.map((item) => (
                        <View key={item.key} style={styles.preferenceChip}>
                          <Text style={styles.preferenceChipText} numberOfLines={1}>
                            {item.label}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </View>
                ) : null}

                <View style={styles.offerActionsRow}>
                  <LeafButton
                    label={busyAction === "reject" ? "Recusando..." : "Recusar"}
                    tone="ghost"
                    disabled={Boolean(busyAction)}
                    onPress={handleReject}
                    style={styles.rejectButton}
                    testID="driver-offer-screen-reject-button"
                    accessibilityLabel="driver-offer-screen-reject-button"
                  />
                  <LeafButton
                    label={
                      busyAction === "accept"
                        ? "Aceitando..."
                        : "Aceitar corrida"
                    }
                    tone="primary"
                    disabled={Boolean(busyAction)}
                    onPress={handleAccept}
                    style={styles.acceptButton}
                    testID="driver-offer-screen-accept-button"
                    accessibilityLabel="driver-offer-screen-accept-button"
                  />
                </View>
              </>
            ) : (
              <View style={styles.emptyWrap}>
                <Text style={styles.emptyTitle}>Sem corrida no momento</Text>
                <Text style={styles.emptyText}>
                  A próxima oferta aparece aqui quando houver solicitação ativa.
                </Text>
                <LeafButton
                  label="Voltar para o mapa"
                  tone="primary"
                  onPress={() => navigation.navigate("RobotaxiPrototype")}
                  style={styles.emptyButton}
                />
              </View>
            )}

            {visibleLastError ? (
              <Text style={styles.errorText}>{visibleLastError}</Text>
            ) : null}
          </LeafRideSheet>
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
  offerCard: {
    minHeight: 318,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    paddingTop: 12,
    paddingBottom: 18,
  },
  sheetHandle: {
    width: 50,
    height: 4,
    borderRadius: 3,
    backgroundColor: "#D8D0C7",
    alignSelf: "center",
    marginBottom: 18,
  },
  offerHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 14,
    marginBottom: 12,
  },
  offerHeaderCopy: {
    flex: 1,
    minWidth: 0,
  },
  offerTimer: {
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 10.5,
    lineHeight: 14,
    marginTop: 2,
  },
  offerTitle: {
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 18,
    lineHeight: 23,
  },
  netPayout: {
    minWidth: 108,
    minHeight: 30,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: "#D9E3D3",
    backgroundColor: "#EEF3EA",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
    marginTop: 2,
  },
  netPayoutValue: {
    color: leafRideColors.leaf,
    fontFamily: fonts.Medium,
    fontSize: 11,
    lineHeight: 14,
  },
  passengerRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
  },
  passengerAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "#E5DCD2",
    backgroundColor: "#EFEAE2",
    alignItems: "center",
    justifyContent: "center",
  },
  passengerAvatarText: {
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 16,
    lineHeight: 20,
  },
  passengerCopy: {
    flex: 1,
    minWidth: 0,
    marginLeft: 12,
  },
  passengerName: {
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 15,
    lineHeight: 20,
  },
  passengerMeta: {
    marginTop: 2,
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 12,
    lineHeight: 16,
  },
  routeSummary: {
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: leafRideColors.line,
    paddingVertical: 10,
    gap: 8,
  },
  routeStep: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  routeIcon: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  routeCopy: {
    flex: 1,
    minWidth: 0,
  },
  routeMeta: {
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 10.5,
    lineHeight: 14,
    marginTop: 2,
  },
  routeAddress: {
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 14,
    lineHeight: 18,
  },
  confirmedLine: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  confirmedText: {
    flex: 1,
    minWidth: 0,
    color: leafRideColors.secondary,
    fontFamily: fonts.Medium,
    fontSize: 12,
    lineHeight: 16,
  },
  confirmedSecurePaymentBadge: {
    marginLeft: 4,
  },
  preferencePanel: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  preferenceRow: {
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  preferenceChip: {
    minHeight: 24,
    borderRadius: 12,
    paddingHorizontal: 0,
    justifyContent: "center",
  },
  preferenceChipText: {
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 12,
    lineHeight: 16,
  },
  offerActionsRow: {
    marginTop: 14,
    flexDirection: "row",
    gap: 12,
  },
  rejectButton: {
    width: 116,
    height: 48,
    borderRadius: 24,
  },
  acceptButton: {
    flex: 1,
    height: 48,
    borderRadius: 24,
  },
  emptyWrap: {
    paddingTop: 6,
  },
  emptyTitle: {
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 18,
    lineHeight: 24,
  },
  emptyText: {
    marginTop: 4,
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 13,
    lineHeight: 17,
  },
  emptyButton: {
    marginTop: 18,
    alignSelf: "flex-start",
  },
  hiddenText: {
    position: "absolute",
    width: 1,
    height: 1,
    opacity: 0,
  },
  errorText: {
    marginTop: 10,
    color: leafRideColors.dangerText,
    fontFamily: fonts.Medium,
    fontSize: 13,
    lineHeight: 17,
    textAlign: "center",
  },
});
