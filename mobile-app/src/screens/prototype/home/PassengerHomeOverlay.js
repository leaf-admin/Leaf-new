import React, { memo } from "react";
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Easing,
  Keyboard,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { fonts } from "../../../theme/runtimeTokens";
import LeafCampaignCarousel from "../../../components/campaigns/LeafCampaignCarousel";
import { leafButtonMetrics } from "../../../components/prototype/LeafRideUI";

const HOME_CARD_BOTTOM_OFFSET = 16;
const LEAF_GREEN = "#1A330E";
const CARD_SURFACE = "#FFFFFF";
const CARD_BORDER = "#ECE5DC";
const TEXT_PRIMARY = "#171412";
const TEXT_MUTED = "#827B73";
const HOME_CARD_HEIGHT = 142;
const HOME_SEARCH_ACTIVE_CARD_HEIGHT = 92;
const HOME_CARD_HORIZONTAL_INSET = 24;
const HOME_CARD_RADIUS = 28;
const HOME_CARD_PADDING_HORIZONTAL = 24;
const HOME_CARD_PADDING_TOP = 22;
const HOME_CARD_PADDING_BOTTOM = 18;
const HOME_STACK_GAP = 18;
const HOME_PROMO_CARD_HEIGHT = 188;
const HOME_CATEGORY_CARD_HEIGHT = 312;
const HOME_CATEGORY_BREAKDOWN_CARD_HEIGHT = 344;
const HOME_SEARCH_DROPDOWN_MIN_HEIGHT = 72;
const HOME_SEARCH_DROPDOWN_MAX_HEIGHT = 168;
const HOME_SEARCH_DROPDOWN_ROW_HEIGHT = 56;
const HOME_SEARCH_DROPDOWN_VERTICAL_PADDING = 8;
const HOME_SEARCH_DROPDOWN_TOP_GAP = 10;
const HOME_STACK_HEIGHT = HOME_CARD_HEIGHT + HOME_STACK_GAP + HOME_PROMO_CARD_HEIGHT;
const HOME_SEARCH_KEYBOARD_CLEARANCE = 52;
const EARTH_RADIUS_METERS = 6371000;
const LEAF_WELCOME_RIO_BANNER_IMAGE_URL =
  "https://storage.googleapis.com/leaf-reactnative.firebasestorage.app/campaign-center/assets/asset_mpgam7le_f7f03d20_leaf-welcome-rio-1035x564.webp?GoogleAccessId=firebase-adminsdk-fbsvc%40leaf-reactnative.iam.gserviceaccount.com&Expires=2051222400&Signature=pgIHEiHVb5lkRxw9ca%2F9PR8jeIUe2kA03Tou08WveLCBJ%2B5wTYiDFpCW9v%2FXXMCCNUuPpNXVF7ZpHD9tK43x%2B71JC6u4Khq7hSQu9Nvkl3GIuWheGcO4K901olK9OgQJDw6HN4VmsWvvod%2BiE9pu%2B2%2BodJbth3FHwW5nieThVZtdW0QovD9E1SKsjWfpDnIWTw6STwC0fca33awqvQ7eO4tMwc8KQGrQswZIR2GGHChTgFApcKs7oArhjRk6jrlfua0B%2BYVFgr%2FJXXFoMUouY%2BUYuyoSQmqGeKQqItTdYjg2Utcm81bonilMyJ8%2B%2FGSi%2FpNBetSRasPoLPc2T%2F8MxA%3D%3D";
const PASSENGER_HOME_FALLBACK_CAMPAIGNS = Object.freeze([
  {
    id: "local_leaf_rio_comfort",
    name: "Leaf no Rio",
    template: "home_banner_card",
    content: {
      eyebrow: "Leaf no Rio",
      title: "Viaje com mais conforto",
      body: "Motoristas verificados, ar ligado e uma experiência mais calma para chegar bem.",
      backgroundColor: "#FBFCF8",
      imageUrl: LEAF_WELCOME_RIO_BANNER_IMAGE_URL,
      imageAlt: "Banner de boas-vindas da Leaf no Rio de Janeiro",
      displayMode: "image_only",
      hideTextOverlay: true,
      cta: { label: "Novidades", action: "open_campaign_details" },
    },
    rules: { autoRotateSeconds: 6 },
  },
]);

export const PASSENGER_HOME_CARD_METRICS = Object.freeze({
  horizontalInset: HOME_CARD_HORIZONTAL_INSET,
  bottomOffset: HOME_CARD_BOTTOM_OFFSET,
  height: HOME_CARD_HEIGHT,
  promoHeight: HOME_PROMO_CARD_HEIGHT,
  stackGap: HOME_STACK_GAP,
  stackHeight: HOME_STACK_HEIGHT,
  borderRadius: HOME_CARD_RADIUS,
  paddingHorizontal: HOME_CARD_PADDING_HORIZONTAL,
  paddingTop: HOME_CARD_PADDING_TOP,
  paddingBottom: HOME_CARD_PADDING_BOTTOM,
  campaignGap: 12,
  campaignBottomOffset: HOME_CARD_BOTTOM_OFFSET + HOME_STACK_HEIGHT + 12,
});

function isRecentSearchResult(item) {
  const sourceType = String(item?.sourceType || item?.source || item?.type || "")
    .trim()
    .toLowerCase();

  return (
    item?.isRecent === true ||
    item?.recent === true ||
    sourceType.includes("recent") ||
    sourceType.includes("history")
  );
}

function normalizeSearchResultText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function isAddressPrimaryText(value = "") {
  return /^(rua|r\.|avenida|av\.|alameda|praça|pça\.|travessa|tv\.|via|estrada|rod\.|rodovia)\b/i.test(
    normalizeSearchResultText(value),
  );
}

function splitSearchResultDescription(description = "") {
  const parts = normalizeSearchResultText(description)
    .split(",")
    .map((part) => normalizeSearchResultText(part))
    .filter(Boolean);

  if (parts.length >= 3) {
    return {
      primary: `${parts[0]}, ${parts[1]}`,
      secondary: parts.slice(2, 4).join(", "),
    };
  }

  if (parts.length === 2) {
    return {
      primary: parts[0],
      secondary: parts[1],
    };
  }

  return {
    primary: normalizeSearchResultText(description),
    secondary: "",
  };
}

function resolvePlaceAddressLine(value = "") {
  const normalized = normalizeSearchResultText(value);
  if (!normalized) {
    return "";
  }

  const [beforeNeighborhoodSeparator] = normalized.split(" - ");
  const parts = beforeNeighborhoodSeparator
    .split(",")
    .map((part) => normalizeSearchResultText(part))
    .filter(Boolean);

  if (parts.length >= 2) {
    return `${parts[0]}, ${parts[1]}`;
  }

  return beforeNeighborhoodSeparator;
}

function resolveAddressContextLine(primary = "", secondary = "") {
  const primaryParts = normalizeSearchResultText(primary)
    .split(",")
    .map((part) => normalizeSearchResultText(part))
    .filter(Boolean);
  const secondaryParts = normalizeSearchResultText(secondary)
    .split(",")
    .map((part) => normalizeSearchResultText(part))
    .filter(Boolean);

  if (secondaryParts.length === 0) {
    return "";
  }

  const secondaryStartsWithSameStreet =
    primaryParts[0] &&
    secondaryParts[0] &&
    primaryParts[0].toLowerCase() === secondaryParts[0].toLowerCase();

  return secondaryStartsWithSameStreet
    ? secondaryParts.slice(2, 4).join(", ")
    : secondaryParts.slice(0, 2).join(", ");
}

function resolveSearchResultDisplay(item = {}, fallbackLabel = "Local") {
  const description = normalizeSearchResultText(item?.description);
  const primaryCandidate = normalizeSearchResultText(
    item?.name ||
      item?.mainText ||
      item?.structured_formatting?.main_text,
  );
  const secondaryCandidate = normalizeSearchResultText(
    item?.address ||
      item?.secondaryText ||
      item?.formatted_address ||
      item?.structured_formatting?.secondary_text,
  );

  if (!primaryCandidate && description) {
    const parsed = splitSearchResultDescription(description);
    return {
      title: parsed.primary || fallbackLabel,
      address: parsed.secondary,
    };
  }

  const descriptionHasMoreContext =
    description &&
    primaryCandidate &&
    description.length > primaryCandidate.length &&
    description.toLowerCase().startsWith(primaryCandidate.toLowerCase());

  if (
    (!secondaryCandidate && descriptionHasMoreContext) ||
    (/^\d+$/.test(primaryCandidate) && description)
  ) {
    const parsed = splitSearchResultDescription(description);
    return {
      title: parsed.primary || primaryCandidate || fallbackLabel,
      address: parsed.secondary,
    };
  }

  if (primaryCandidate && secondaryCandidate) {
    const secondaryParts = secondaryCandidate
      .split(",")
      .map((part) => normalizeSearchResultText(part))
      .filter(Boolean);
    const primaryIsOnlyNumber = /^\d+$/.test(primaryCandidate);
    const primaryIsAddress = isAddressPrimaryText(primaryCandidate);
    const primaryIsPlaceName = !primaryIsOnlyNumber && !primaryIsAddress;
    const shouldCombineStreetNumber =
      primaryIsOnlyNumber && secondaryParts.length > 0;

    if (shouldCombineStreetNumber) {
      return {
        title: `${secondaryParts[0]}, ${primaryCandidate}`,
        address: secondaryParts.slice(1, 3).join(", "),
      };
    }

    return {
      title: primaryCandidate || fallbackLabel,
      address: primaryIsPlaceName
        ? resolvePlaceAddressLine(secondaryCandidate)
        : resolveAddressContextLine(primaryCandidate, secondaryCandidate),
    };
  }

  return {
    title: primaryCandidate || secondaryCandidate || fallbackLabel,
    address:
      primaryCandidate && secondaryCandidate && primaryCandidate !== secondaryCandidate
        ? secondaryCandidate
        : "",
  };
}

function normalizeResultCoordinate(coordinate = null) {
  const latitude = Number(coordinate?.latitude ?? coordinate?.lat);
  const longitude = Number(coordinate?.longitude ?? coordinate?.lng);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return { latitude, longitude };
}

function calculateCoordinateDistanceMeters(origin = null, destination = null) {
  const normalizedOrigin = normalizeResultCoordinate(origin);
  const normalizedDestination = normalizeResultCoordinate(destination);

  if (!normalizedOrigin || !normalizedDestination) {
    return null;
  }

  const lat1 = normalizedOrigin.latitude * (Math.PI / 180);
  const lat2 = normalizedDestination.latitude * (Math.PI / 180);
  const deltaLat = (normalizedDestination.latitude - normalizedOrigin.latitude) * (Math.PI / 180);
  const deltaLng = (normalizedDestination.longitude - normalizedOrigin.longitude) * (Math.PI / 180);
  const haversine =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;

  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function formatResultDistanceLabel(origin = null, destination = null) {
  const distanceMeters = calculateCoordinateDistanceMeters(origin, destination);
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) {
    return "";
  }

  return `${Math.max(1, Math.round(distanceMeters / 1000))}km`;
}

function formatCurrencyBRL(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    return "--";
  }

  return `R$ ${amount.toFixed(2).replace(".", ",")}`;
}

function pickFirstFiniteMoney(...values) {
  for (const value of values) {
    const amount = Number(value);
    if (Number.isFinite(amount)) {
      return Math.max(0, amount);
    }
  }

  return null;
}

function resolveFareBreakdownTollFee(category = {}, breakdown = {}) {
  const direct = pickFirstFiniteMoney(
    breakdown?.tollFee,
    breakdown?.tollAmount,
    breakdown?.tollFeeReais,
    breakdown?.pedagio,
    breakdown?.["pedágio"],
    breakdown?.paymentBreakdown?.tollFee,
    breakdown?.financialBreakdown?.tollFee,
    breakdown?.calculation?.breakdown?.tollFee,
    category?.tollFee,
    category?.tollAmount,
    category?.tollFeeReais,
    category?.pedagio,
    category?.["pedágio"],
  );

  if (direct !== null && direct > 0) {
    return direct;
  }

  const cents = pickFirstFiniteMoney(
    breakdown?.tollFeeCents,
    breakdown?.calculation?.tollFee,
    breakdown?.paymentBreakdown?.calculation?.tollFee,
    breakdown?.financialBreakdown?.calculation?.tollFee,
    category?.tollFeeCents,
  );

  return cents !== null && cents > 0 ? cents / 100 : 0;
}

function normalizeFareBreakdownRows(rows = []) {
  return rows.map((row) => ({
    ...row,
    label: row?.label === "Bandeirada" ? "Tarifa base" : row?.label,
  }));
}

function isPickupAdjustmentRow(row = {}) {
  return String(row?.label || "").toLowerCase() === "adicional de embarque";
}

function buildCanonicalPricingRows(category = {}, breakdown = {}) {
  const pricingPayload = breakdown?.pricingPayload || category?.pricingPayload || null;
  if (!pricingPayload || typeof pricingPayload !== "object") {
    return [];
  }

  const distanceKm = Number(
    breakdown.distanceKm ?? pricingPayload.routeDistanceKm ?? pricingPayload.distance_km,
  );
  const durationMin = Number(
    breakdown.durationMin ?? pricingPayload.duration_min_traffic ?? pricingPayload.durationMin,
  );
  const distanceRate = Number(
    breakdown?.rateCard?.rate_per_unit_distance ?? category?.rateCard?.rate_per_unit_distance,
  );
  const timeRate = Number(
    breakdown?.rateCard?.rate_per_hour ?? category?.rateCard?.rate_per_hour,
  );
  const baseFare = Number(pricingPayload.base_fare);
  const fixedFee = Number(pricingPayload.fixed_fee);
  const distanceComponent = Number(pricingPayload.distance_component);
  const timeComponent = Number(pricingPayload.time_component);
  const dynamicMarkup = Number(pricingPayload.dynamic_markup_value);
  const pickupAdjustment = Number(pricingPayload.pickup_adjustment);

  return [
    Number.isFinite(baseFare)
      ? { label: "Tarifa base", detail: "", amount: baseFare }
      : null,
    Number.isFinite(fixedFee)
      ? { label: "Taxa fixa", detail: "", amount: fixedFee }
      : null,
    Number.isFinite(distanceComponent)
      ? {
          label: "Distância",
          detail:
            Number.isFinite(distanceKm) && Number.isFinite(distanceRate)
              ? `${distanceKm.toFixed(1).replace(".", ",")} km x ${formatCurrencyBRL(distanceRate)}`
              : "",
          amount: distanceComponent,
        }
      : null,
    Number.isFinite(timeComponent)
      ? {
          label: "Tempo",
          detail:
            Number.isFinite(durationMin) && Number.isFinite(timeRate)
              ? `${Math.max(1, Math.round(durationMin))} min x ${formatCurrencyBRL(timeRate)}/h`
              : "",
          amount: timeComponent,
        }
      : null,
    Number.isFinite(dynamicMarkup) && dynamicMarkup > 0
      ? { label: "Tarifa dinâmica", detail: "", amount: dynamicMarkup }
      : null,
    Number.isFinite(pickupAdjustment) && pickupAdjustment > 0
      ? { label: "Adicional de embarque", detail: "", amount: pickupAdjustment }
      : null,
  ].filter(Boolean);
}

function buildFareBreakdownRows(category = {}) {
  const breakdown = category?.fareBreakdown || {};
  const rows = Array.isArray(breakdown.rows) ? breakdown.rows : [];
  if (rows.length > 0) {
    const tollFee = resolveFareBreakdownTollFee(category, breakdown);
    const normalizedRows = normalizeFareBreakdownRows(rows);
    const hasTollRow = normalizedRows.some((row) =>
      String(row?.label || "").toLowerCase().includes("pedágio"),
    );
    return tollFee > 0 && !hasTollRow
      ? [...normalizedRows, { label: "Pedágio", detail: "Pass-through", amount: tollFee }]
      : normalizedRows;
  }

  const canonicalRows = buildCanonicalPricingRows(category, breakdown);
  if (canonicalRows.length > 0) {
    const tollFee = resolveFareBreakdownTollFee(category, breakdown);
    return tollFee > 0
      ? [...canonicalRows, { label: "Pedágio", detail: "Pass-through", amount: tollFee }]
      : canonicalRows;
  }

  const rateCard = breakdown.rateCard || category?.rateCard || {};
  const distanceKm = Number(breakdown.distanceKm);
  const durationMin = Number(breakdown.durationMin);
  const baseFare = Number(rateCard?.base_fare);
  const fixedFee = Number(rateCard?.fixed_fee);
  const distanceRate = Number(rateCard?.rate_per_unit_distance);
  const timeRate = Number(rateCard?.rate_per_hour);
  const minFare = Number(rateCard?.min_fare);
  const tollFee = resolveFareBreakdownTollFee(category, breakdown);
  const distanceAmount =
    Number.isFinite(distanceKm) && Number.isFinite(distanceRate)
      ? distanceKm * distanceRate
      : null;
  const timeAmount =
    Number.isFinite(durationMin) && Number.isFinite(timeRate)
      ? (durationMin / 60) * timeRate
      : null;
  const computedRows = [
    Number.isFinite(baseFare)
      ? { label: "Tarifa base", detail: "", amount: baseFare }
      : null,
    Number.isFinite(fixedFee)
      ? { label: "Taxa fixa", detail: "", amount: fixedFee }
      : null,
    Number.isFinite(distanceAmount)
      ? {
          label: "Distância",
          detail: `${distanceKm.toFixed(1).replace(".", ",")} km x ${formatCurrencyBRL(distanceRate)}`,
          amount: distanceAmount,
        }
      : null,
    Number.isFinite(timeAmount)
      ? {
          label: "Tempo",
          detail: `${Math.max(1, Math.round(durationMin))} min x ${formatCurrencyBRL(timeRate)}/h`,
          amount: timeAmount,
        }
      : null,
  ].filter(Boolean);
  const subtotal = computedRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);

  if (Number.isFinite(minFare) && minFare > subtotal) {
    computedRows.push({
      label: "Tarifa mínima",
      detail: "Complemento mínimo",
      amount: minFare - subtotal,
    });
  }

  if (tollFee > 0) {
    computedRows.push({
      label: "Pedágio",
      detail: "Pass-through",
      amount: tollFee,
    });
  }

  return computedRows;
}

function PassengerHomeOverlay({
  insetsBottom = 0,
  userId = "",
  pickupLabel = "",
  pickupAddress = "",
  pickupCoordinate = null,
  destinationLabel = "Para onde?",
  onPickupPress,
  pickupSearchActive = false,
  pickupSearchQuery = "",
  pickupSearchResults = [],
  pickupSearchSearching = false,
  onPickupSearchChange,
  onPickupSearchClose,
  onPickupResultPress,
  onPickupMapPress,
  onDestinationPress,
  onCardLayout,
  onMicrophonePress,
  destinationSearchActive = false,
  destinationSearchQuery = "",
  destinationSearchResults = [],
  destinationSearchSearching = false,
  onDestinationSearchChange,
  onDestinationSearchClose,
  onDestinationResultPress,
  categoryVisible = false,
  categoryOptions = [],
  selectedCategoryId = "plus",
  onCategorySelect,
  onCategoryConfirm,
  categoryNotice = "",
  categoryConfirmDisabled = false,
  categoryConfirmSoftDisabled = false,
  categoryConfirmLabel = "Confirmar",
  tariffStatusLabel = "Tarifa normal",
  tariffHigh = false,
}) {
  const safeBottom = Math.max(0, Number(insetsBottom) || 0);
  const { height: windowHeight } = useWindowDimensions();
  const screenHeight = Dimensions.get("screen").height;
  const resolvedPickupLabel = pickupLabel || pickupAddress || "Local atual";
  const pickupLatitude = Number(pickupCoordinate?.latitude ?? pickupCoordinate?.lat);
  const pickupLongitude = Number(pickupCoordinate?.longitude ?? pickupCoordinate?.lng);
  const pickupQaCoordinateLabel =
    Number.isFinite(pickupLatitude) && Number.isFinite(pickupLongitude)
      ? [
          `pickup:${pickupLatitude.toFixed(6)},${pickupLongitude.toFixed(6)}`,
          `address:${pickupAddress || resolvedPickupLabel || ""}`,
        ].join(";")
      : "";
  const entrance = React.useRef(new Animated.Value(0)).current;
  const inputRef = React.useRef(null);
  const [keyboardHeight, setKeyboardHeight] = React.useState(0);
  const [fareBreakdownVisible, setFareBreakdownVisible] = React.useState(false);
  const [pickupAdjustmentInfoVisible, setPickupAdjustmentInfoVisible] =
    React.useState(false);
  const activeSearchKind = pickupSearchActive ? "pickup" : destinationSearchActive ? "destination" : "";
  const visibleResults = Array.isArray(destinationSearchResults)
    ? destinationSearchResults.slice(0, 3)
    : [];
  const visiblePickupResults = Array.isArray(pickupSearchResults)
    ? pickupSearchResults.slice(0, 3)
    : [];
  const activeResults = pickupSearchActive ? visiblePickupResults : visibleResults;
  const activeSearchSearching = pickupSearchActive
    ? pickupSearchSearching
    : destinationSearchSearching;
  const shouldShowPickupMapRow =
    pickupSearchActive && typeof onPickupMapPress === "function";
  const activeResultCount = activeResults.length + (shouldShowPickupMapRow ? 1 : 0);
  const shouldShowSearchDropdown = Boolean(
    activeSearchKind &&
      (activeSearchSearching || activeResultCount > 0)
  );
  const shouldShowPickupField = !destinationSearchActive;
  const shouldShowDestinationField = !pickupSearchActive;
  const shouldShowBothFields = shouldShowPickupField && shouldShowDestinationField;
  const visibleCategoryOptions = Array.isArray(categoryOptions)
    ? categoryOptions.slice(0, 3)
    : [];
  const selectedCategory =
    visibleCategoryOptions.find((item) => item?.id === selectedCategoryId) ||
    visibleCategoryOptions[0] ||
    null;
  const shouldShowCategoryCard =
    categoryVisible && !destinationSearchActive && Boolean(selectedCategory);
  const fareBreakdownRows = buildFareBreakdownRows(selectedCategory);
  const canShowFareBreakdown = Boolean(
    selectedCategory?.fare != null && fareBreakdownRows.length > 0,
  );
  const categoryCardHeight =
    shouldShowCategoryCard && fareBreakdownVisible
      ? HOME_CATEGORY_BREAKDOWN_CARD_HEIGHT
      : HOME_CATEGORY_CARD_HEIGHT;
  const searchDropdownHeight = shouldShowSearchDropdown
    ? Math.min(
        HOME_SEARCH_DROPDOWN_MAX_HEIGHT,
        activeSearchSearching
          ? HOME_SEARCH_DROPDOWN_MIN_HEIGHT
          : activeResultCount * HOME_SEARCH_DROPDOWN_ROW_HEIGHT +
              HOME_SEARCH_DROPDOWN_VERTICAL_PADDING,
      )
    : 0;
  const searchCardBaseHeight = activeSearchKind
    ? HOME_SEARCH_ACTIVE_CARD_HEIGHT
    : HOME_CARD_HEIGHT;
  const activeSearchCardHeight = activeSearchKind && shouldShowSearchDropdown
    ? searchCardBaseHeight + HOME_SEARCH_DROPDOWN_TOP_GAP + searchDropdownHeight
    : searchCardBaseHeight;
  const lowerPanelHeight = shouldShowCategoryCard
    ? categoryCardHeight
    : HOME_PROMO_CARD_HEIGHT;
  const activeStackGap = shouldShowCategoryCard ? 16 : HOME_STACK_GAP;
  const stackHeight = activeSearchKind
    ? activeSearchCardHeight
    : activeSearchCardHeight + activeStackGap + lowerPanelHeight;
  const androidKeyboardFallbackHeight =
    Platform.OS === "android" && activeSearchKind
      ? Math.max(300, Math.round(Math.max(windowHeight, screenHeight) * 0.42))
      : 0;
  const effectiveKeyboardHeight = activeSearchKind
    ? Math.max(keyboardHeight, androidKeyboardFallbackHeight)
    : keyboardHeight;

  React.useEffect(() => {
    if (!shouldShowCategoryCard) {
      setFareBreakdownVisible(false);
      setPickupAdjustmentInfoVisible(false);
    }
  }, [shouldShowCategoryCard]);

  React.useEffect(() => {
    setFareBreakdownVisible(false);
    setPickupAdjustmentInfoVisible(false);
  }, [selectedCategory?.id, selectedCategory?.priceLabel]);

  React.useEffect(() => {
    if (!fareBreakdownVisible) {
      setPickupAdjustmentInfoVisible(false);
    }
  }, [fareBreakdownVisible]);

  React.useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSubscription = Keyboard.addListener(showEvent, (event) => {
      const nextHeight = Number(event?.endCoordinates?.height || 0);
      setKeyboardHeight(Number.isFinite(nextHeight) ? nextHeight : 0);
    });
    const hideSubscription = Keyboard.addListener(hideEvent, () => {
      setKeyboardHeight(0);
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  React.useEffect(() => {
    if (!activeSearchKind) {
      return undefined;
    }

    const timer = setTimeout(() => {
      inputRef.current?.focus?.();
    }, 80);

    return () => clearTimeout(timer);
  }, [activeSearchKind]);

  React.useEffect(() => {
    const animation = Animated.timing(entrance, {
      toValue: 1,
      duration: 240,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [entrance]);

  const submitPickupSearch = React.useCallback((value = null) => {
    const submittedText = String(value ?? pickupSearchQuery ?? "").trim();
    const firstResult = visiblePickupResults[0] || null;
    onPickupResultPress?.(
      firstResult ||
        (submittedText
          ? { name: submittedText, address: submittedText }
          : null),
    );
  }, [onPickupResultPress, pickupSearchQuery, visiblePickupResults]);

  const handlePickupSubmit = React.useCallback((event) => {
    submitPickupSearch(event?.nativeEvent?.text);
  }, [submitPickupSearch]);

  const submitDestinationSearch = React.useCallback((value = null) => {
    const submittedText = String(value ?? destinationSearchQuery ?? "").trim();
    const firstResult = visibleResults[0] || null;
    onDestinationResultPress?.(
      firstResult ||
        (submittedText
          ? { name: submittedText, address: submittedText }
          : null),
    );
  }, [destinationSearchQuery, onDestinationResultPress, visibleResults]);

  const handleDestinationSubmit = React.useCallback((event) => {
    submitDestinationSearch(event?.nativeEvent?.text);
  }, [submitDestinationSearch]);

  return (
    <Animated.View
      onLayout={onCardLayout}
      style={[
        styles.homeStack,
        {
          height: stackHeight,
          bottom: activeSearchKind
            ? Math.max(
                safeBottom + HOME_CARD_BOTTOM_OFFSET,
                effectiveKeyboardHeight - safeBottom + HOME_SEARCH_KEYBOARD_CLEARANCE,
              )
            : safeBottom + HOME_CARD_BOTTOM_OFFSET,
        },
        {
          opacity: entrance.interpolate({
            inputRange: [0, 1],
            outputRange: [0.98, 1],
          }),
          transform: [
            {
              translateY: entrance.interpolate({
                inputRange: [0, 1],
                outputRange: [7, 0],
              }),
            },
          ],
        },
      ]}
    >
        <View
          style={[
            styles.searchCard,
            styles.searchCardInStack,
            shouldShowCategoryCard && styles.searchCardReviewMode,
            {
              bottom: activeSearchKind ? 0 : lowerPanelHeight + activeStackGap,
              height: activeSearchCardHeight,
            },
          ]}
        >
          <View
            style={[
              styles.searchCardMain,
              activeSearchKind && styles.searchCardMainSingleField,
            ]}
          >
            {shouldShowBothFields ? (
              <View pointerEvents="none" style={styles.routeRail}>
                <View style={styles.originDot} />
                <View style={styles.routeStem} />
                <View style={styles.destinationDot} />
              </View>
            ) : null}

            <View
              style={[
                styles.copyColumn,
                !shouldShowBothFields && styles.copyColumnSingleField,
              ]}
            >
              {shouldShowPickupField ? (
                <TouchableOpacity
                  activeOpacity={pickupSearchActive ? 1 : 0.88}
                  style={styles.pickupInput}
                  onPress={pickupSearchActive ? undefined : onPickupPress}
                  testID="passenger-home-pickup-input"
                  accessibilityRole="button"
                  accessible={!pickupSearchActive}
                  accessibilityLabel="Alterar local de partida"
                >
                  <Text style={styles.label}>Partida</Text>
                  {pickupSearchActive ? (
                    <View style={styles.inlineSearchRow}>
                      <TextInput
                        ref={inputRef}
                        value={pickupSearchQuery}
                        onChangeText={onPickupSearchChange}
                        placeholder=""
                        placeholderTextColor={TEXT_MUTED}
                        autoCorrect={false}
                        autoFocus={pickupSearchActive}
                        blurOnSubmit={false}
                        returnKeyType="search"
                        submitBehavior="submit"
                        onSubmitEditing={handlePickupSubmit}
                        style={styles.pickupSearchInput}
                        testID="passenger-home-pickup-search-input"
                        accessibilityLabel="Buscar partida"
                      />
                      <TouchableOpacity
                        activeOpacity={0.84}
                        onPress={() => submitPickupSearch()}
                        style={styles.inlineSearchSubmitButton}
                        testID="passenger-home-pickup-search-submit"
                        accessibilityRole="button"
                        accessibilityLabel="Buscar partida digitada"
                      >
                        <Ionicons name="search" size={16} color={LEAF_GREEN} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        activeOpacity={0.84}
                        onPress={onPickupSearchClose}
                        style={styles.inlineSearchCloseButton}
                        testID="passenger-home-pickup-search-close"
                        accessibilityRole="button"
                        accessibilityLabel="Fechar busca de partida"
                      >
                        <Ionicons name="close" size={17} color={TEXT_PRIMARY} />
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <Text style={styles.pickupText} numberOfLines={1}>
                      {resolvedPickupLabel}
                    </Text>
                  )}
                  {pickupAddress ? (
                    <Text style={styles.hiddenPickupAddress}>{pickupAddress}</Text>
                  ) : null}
                </TouchableOpacity>
              ) : null}

              {shouldShowBothFields ? <View style={styles.divider} /> : null}

              {shouldShowDestinationField ? (
                <TouchableOpacity
                  activeOpacity={destinationSearchActive ? 1 : 0.88}
                  style={styles.destinationInput}
                  onPress={destinationSearchActive ? undefined : onDestinationPress}
                  testID="passenger-home-destination-input"
                  accessibilityRole="button"
                  accessible={!destinationSearchActive}
                  accessibilityLabel="Escolher destino da viagem"
                >
                  <View style={styles.destinationCopy}>
                    <Text style={styles.destinationLabel}>Destino</Text>
                    {destinationSearchActive ? (
                      <TextInput
                        ref={inputRef}
                        value={destinationSearchQuery}
                        onChangeText={onDestinationSearchChange}
                        placeholder=""
                        placeholderTextColor={TEXT_MUTED}
                        autoCorrect={false}
                        autoFocus={destinationSearchActive}
                        blurOnSubmit={false}
                        returnKeyType="search"
                        submitBehavior="submit"
                        onSubmitEditing={handleDestinationSubmit}
                        style={styles.destinationSearchInput}
                        testID="passenger-home-destination-search-input"
                        accessibilityLabel="Buscar destino"
                      />
                    ) : (
                      <Text style={styles.destinationText} numberOfLines={1}>
                        {destinationLabel}
                      </Text>
                    )}
                  </View>
                  {destinationSearchActive ? (
                    <View style={styles.destinationSearchActions}>
                      <TouchableOpacity
                        activeOpacity={0.84}
                        onPress={() => submitDestinationSearch()}
                        style={styles.destinationSearchSubmitButton}
                        testID="passenger-home-destination-search-submit"
                        accessibilityRole="button"
                        accessibilityLabel="Buscar destino digitado"
                      >
                        <Ionicons name="search" size={16} color={LEAF_GREEN} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        activeOpacity={0.84}
                        onPress={onDestinationSearchClose}
                        style={styles.destinationSearchCloseButton}
                        testID="passenger-home-destination-search-close"
                        accessibilityRole="button"
                        accessibilityLabel="Fechar busca de destino"
                      >
                        <Ionicons name="close" size={17} color={TEXT_PRIMARY} />
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <View
                      style={styles.destinationActionButton}
                      accessibilityElementsHidden
                      importantForAccessibility="no"
                    >
                      <Ionicons name="arrow-forward" size={18} color={LEAF_GREEN} />
                    </View>
                  )}
                </TouchableOpacity>
              ) : null}
            </View>
          </View>

          {shouldShowDestinationField ? (
            <TouchableOpacity
              activeOpacity={0.86}
              onPress={onMicrophonePress}
              style={styles.hiddenMicButton}
              testID="passenger-home-destination-mic"
              accessibilityLabel="Ditar destino por voz"
            />
          ) : null}

          {shouldShowSearchDropdown ? (
            <View
              style={[styles.dropdownInline, { height: searchDropdownHeight }]}
              testID={
                pickupSearchActive
                  ? "passenger-home-pickup-dropdown"
                  : "passenger-home-destination-dropdown"
              }
            >
              {activeSearchSearching ? (
                <View style={styles.destinationResultStatus}>
                  <ActivityIndicator size="small" color={LEAF_GREEN} />
                  <Text style={styles.destinationResultStatusText}>Buscando...</Text>
                </View>
              ) : activeResultCount > 0 ? (
                <>
                  {activeResults.map((item, index) => {
                    const recentResult = isRecentSearchResult(item);
                    const display = resolveSearchResultDisplay(
                      item,
                      pickupSearchActive ? "Partida" : "Destino",
                    );
                    const distanceLabel = formatResultDistanceLabel(
                      pickupCoordinate,
                      item?.coordinate,
                    );

                    return (
                      <TouchableOpacity
                        key={item?.id || `${item?.name || activeSearchKind}-${index}`}
                        activeOpacity={0.86}
                        onPress={() => (
                          pickupSearchActive
                            ? onPickupResultPress?.(item)
                            : onDestinationResultPress?.(item)
                        )}
                        style={styles.destinationResultRow}
                        testID={
                          pickupSearchActive
                            ? `passenger-home-pickup-result-${index}`
                            : `passenger-home-destination-result-${index}`
                        }
                        accessibilityLabel={`Resultado de ${pickupSearchActive ? "partida" : "destino"} ${index + 1}: ${display.title}`}
                        accessibilityHint={display.address || `Seleciona este ${pickupSearchActive ? "local de partida" : "destino"}`}
                      >
                        <Ionicons
                          name={recentResult ? "time-outline" : "location-outline"}
                          size={16}
                          color={TEXT_MUTED}
                          style={styles.destinationResultClockIcon}
                        />
                        <View style={styles.destinationResultCopyPlain}>
                          <View style={styles.destinationResultTitleRow}>
                            <Text
                              numberOfLines={1}
                              style={[
                                pickupSearchActive
                                  ? styles.pickupResultTitle
                                  : styles.destinationResultTitle,
                                styles.destinationResultTitleText,
                              ]}
                            >
                              {display.title}
                            </Text>
                            {distanceLabel ? (
                              <Text numberOfLines={1} style={styles.destinationResultDistance}>
                                {distanceLabel}
                              </Text>
                            ) : null}
                          </View>
                          {display.address ? (
                            <Text numberOfLines={1} style={styles.destinationResultAddress}>
                              {display.address}
                            </Text>
                          ) : null}
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                  {shouldShowPickupMapRow ? (
                    <TouchableOpacity
                      activeOpacity={0.86}
                      onPress={onPickupMapPress}
                      style={styles.destinationResultRow}
                      testID="passenger-home-pickup-map-option"
                      accessibilityLabel="Ajustar partida no mapa"
                    >
                      <Ionicons
                        name="map-outline"
                        size={15}
                        color={TEXT_MUTED}
                        style={styles.destinationResultClockIcon}
                      />
                      <View style={styles.destinationResultCopyPlain}>
                        <Text numberOfLines={1} style={styles.destinationResultTitle}>
                          Ajustar no mapa
                        </Text>
                      </View>
                    </TouchableOpacity>
                  ) : null}
                </>
              ) : null}
            </View>
          ) : null}
        </View>
      {activeSearchKind ? null : shouldShowCategoryCard ? (
        <View
          style={[
            styles.categoryCard,
            styles.promoCardInStack,
            { height: categoryCardHeight },
          ]}
          testID="passenger-home-category-card"
          accessibilityLabel="Escolha a categoria da corrida"
        >
          <View style={styles.categoryHandle} />
          {pickupQaCoordinateLabel ? (
            <Text
              style={styles.hiddenPickupAddress}
              testID="passenger-destination-pickup-coordinate"
              accessibilityLabel={`passenger-destination-pickup-coordinate ${pickupQaCoordinateLabel}`}
            >
              {pickupQaCoordinateLabel}
            </Text>
          ) : null}
          {fareBreakdownVisible ? null : (
            <>
              <Text style={styles.categoryEyebrow}>Escolha a categoria</Text>
              <View style={styles.categoryTabs}>
                {visibleCategoryOptions.map((item) => {
                  const selected = item?.id === selectedCategory?.id;
                  return (
                    <TouchableOpacity
                      key={item?.id}
                      activeOpacity={0.84}
                      onPress={() => onCategorySelect?.(item?.id)}
                      style={[styles.categoryTab, selected && styles.categoryTabActive]}
                      testID={`passenger-home-category-${item?.id}`}
                      accessibilityRole="tab"
                      accessibilityState={{ selected }}
                    >
                      <Text
                        numberOfLines={1}
                        style={[
                          styles.categoryTabText,
                          selected && styles.categoryTabTextActive,
                        ]}
                      >
                        {item?.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          )}

          <View
            style={[
              styles.categorySummaryRow,
              fareBreakdownVisible && styles.categorySummaryRowBreakdown,
            ]}
          >
            <View style={styles.categorySummaryCopy}>
              <View style={styles.categorySummaryTitleRow}>
                <Text style={styles.categorySummaryTitle} numberOfLines={1}>
                  {selectedCategory?.label || "Plus"}
                </Text>
                <View
                  style={[
                    styles.categoryTariffPill,
                    tariffHigh && styles.categoryTariffPillHigh,
                  ]}
                  testID="passenger-home-traffic-status"
                  accessibilityLabel={`Status da tarifa: ${tariffStatusLabel}`}
                >
                  <Text
                    style={[
                      styles.categoryTariffPillText,
                      tariffHigh && styles.categoryTariffPillTextHigh,
                    ]}
                    numberOfLines={1}
                  >
                    {tariffStatusLabel}
                  </Text>
                </View>
              </View>
              <Text style={styles.categorySummarySubtitle} numberOfLines={1}>
                {selectedCategory?.description || "Confortável e acessível"}
              </Text>
            </View>
            <TouchableOpacity
              activeOpacity={canShowFareBreakdown ? 0.82 : 1}
              disabled={!canShowFareBreakdown}
              onPress={() => setFareBreakdownVisible((current) => !current)}
              style={styles.categoryPriceWrap}
              testID="passenger-home-fare-breakdown-trigger"
              accessibilityRole="button"
              accessibilityLabel="Ver composição do valor da corrida"
              accessibilityState={{ expanded: fareBreakdownVisible }}
            >
              <Text style={styles.categoryPrice} numberOfLines={1}>
                {selectedCategory?.priceLabel || "--"}
              </Text>
              <View style={styles.categoryPriceCaptionRow}>
                <Text style={styles.categoryPriceCaption}>valor da corrida</Text>
                {canShowFareBreakdown ? (
                  <Ionicons
                    name={fareBreakdownVisible ? "chevron-up" : "chevron-down"}
                    size={11}
                    color={TEXT_MUTED}
                  />
                ) : null}
              </View>
            </TouchableOpacity>
          </View>

          <View
            style={[
              styles.categoryMetaRow,
              fareBreakdownVisible && styles.categoryMetaRowBreakdown,
            ]}
          >
            <View style={styles.categoryEtaItem}>
              <Text style={styles.categoryMetaLabel}>Embarque</Text>
              <Text style={styles.categoryMetaValue}>
                {selectedCategory?.pickupEtaLabel || "--"}
              </Text>
            </View>
            <View style={styles.categoryMetaDivider} />
            <View style={styles.categoryEtaItem}>
              <Text style={styles.categoryMetaLabel}>Chegada</Text>
              <Text style={styles.categoryMetaValue}>
                {selectedCategory?.arrivalLabel || "--"}
              </Text>
            </View>
          </View>

          {fareBreakdownVisible ? (
            <View
              style={styles.fareBreakdownPanel}
              testID="passenger-home-fare-breakdown"
              accessibilityLabel="Composição do valor da corrida"
            >
              {fareBreakdownRows.map((row, index) => (
                <View
                  key={`${row.label}-${index}`}
                  style={styles.fareBreakdownRow}
                >
                  <View style={styles.fareBreakdownCopy}>
                    <View style={styles.fareBreakdownLabelRow}>
                      <Text style={styles.fareBreakdownLabel} numberOfLines={1}>
                        {row.label}
                      </Text>
                      {isPickupAdjustmentRow(row) ? (
                        <TouchableOpacity
                          activeOpacity={0.78}
                          onPress={() => setPickupAdjustmentInfoVisible(true)}
                          style={styles.fareBreakdownInfoButton}
                          testID="passenger-home-pickup-adjustment-info"
                          accessibilityRole="button"
                          accessibilityLabel="Explicar adicional de embarque"
                        >
                          <Text style={styles.fareBreakdownInfoText}>i</Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>
                    {row.detail ? (
                      <Text style={styles.fareBreakdownDetail} numberOfLines={1}>
                        {row.detail}
                      </Text>
                    ) : null}
                  </View>
                  <Text style={styles.fareBreakdownAmount} numberOfLines={1}>
                    {formatCurrencyBRL(row.amount)}
                  </Text>
                </View>
              ))}
              <View style={[styles.fareBreakdownRow, styles.fareBreakdownTotalRow]}>
                <Text style={styles.fareBreakdownTotalLabel}>Total</Text>
                <Text style={styles.fareBreakdownTotalAmount}>
                  {selectedCategory?.priceLabel || "--"}
                </Text>
              </View>
            </View>
          ) : null}

          {categoryNotice ? (
            <Text
              style={styles.categoryNotice}
              testID="passenger-home-category-availability-notice"
              accessibilityLabel="Aviso de disponibilidade da categoria"
            >
              {categoryNotice}
            </Text>
          ) : null}

          <TouchableOpacity
            activeOpacity={categoryConfirmDisabled ? 1 : 0.88}
            disabled={categoryConfirmDisabled}
            onPress={onCategoryConfirm}
            style={[
              styles.categoryConfirmButton,
              fareBreakdownVisible && styles.categoryConfirmButtonBreakdown,
              (categoryConfirmDisabled || categoryConfirmSoftDisabled) &&
                styles.categoryConfirmButtonDisabled,
            ]}
            testID="passenger-home-category-confirm"
            accessibilityRole="button"
            accessibilityLabel="Confirmar categoria"
          >
            <Text style={styles.categoryConfirmText}>{categoryConfirmLabel}</Text>
          </TouchableOpacity>
          <Modal
            visible={pickupAdjustmentInfoVisible}
            transparent
            animationType="fade"
            onRequestClose={() => setPickupAdjustmentInfoVisible(false)}
          >
            <TouchableOpacity
              activeOpacity={1}
              style={styles.pickupAdjustmentModalBackdrop}
              onPress={() => setPickupAdjustmentInfoVisible(false)}
              testID="passenger-home-pickup-adjustment-info-backdrop"
            >
              <View
                style={styles.pickupAdjustmentBubble}
                testID="passenger-home-pickup-adjustment-info-modal"
              >
                <View style={styles.pickupAdjustmentBubbleArrow} />
                <Text style={styles.pickupAdjustmentBubbleText}>
                  Adicional de embarque refere-se ao valor pago ao motorista parceiro para deslocamento até o seu local de partida.
                </Text>
              </View>
            </TouchableOpacity>
          </Modal>
        </View>
      ) : (
        <LeafCampaignCarousel
          userId={userId}
          role="customer"
          surface="passenger_home"
          placement="below_search_card"
          limit={3}
          height={HOME_PROMO_CARD_HEIGHT}
          borderRadius={HOME_CARD_RADIUS}
          fallbackCampaigns={PASSENGER_HOME_FALLBACK_CAMPAIGNS}
          style={styles.promoCardInStack}
          testID="passenger-home-promo-carousel"
        />
      )}
    </Animated.View>
  );
}

export function PassengerHomeOverlaySkeleton({
  insetsBottom = 0,
  onCardLayout,
}) {
  const safeBottom = Math.max(0, Number(insetsBottom) || 0);

  return (
    <View
      pointerEvents="none"
      onLayout={onCardLayout}
      style={[styles.homeStack, { bottom: safeBottom + HOME_CARD_BOTTOM_OFFSET }]}
      testID="passenger-home-overlay-skeleton"
      accessibilityRole="progressbar"
      accessibilityLabel="Carregando busca de destino"
    >
      <View style={[styles.searchCard, styles.searchCardInStack, styles.skeletonCard]}>
        <View style={styles.routeRail}>
          <View style={[styles.originDot, styles.skeletonDot]} />
          <View style={styles.routeStem} />
          <View style={[styles.destinationDot, styles.skeletonDestinationDot]} />
        </View>

        <View style={styles.copyColumn}>
          <View style={styles.pickupInput}>
            <View style={[styles.skeletonLine, styles.skeletonLabelLine]} />
            <View style={[styles.skeletonLine, styles.skeletonPickupLine]} />
          </View>

          <View style={styles.divider} />

          <View style={styles.destinationInput}>
            <View style={styles.destinationCopy}>
              <View style={[styles.skeletonLine, styles.skeletonLabelLine]} />
              <View style={[styles.skeletonLine, styles.skeletonDestinationLine]} />
            </View>
            <View style={styles.skeletonChevron} />
          </View>
        </View>
      </View>

      <View style={[styles.promoCard, styles.promoCardInStack, styles.skeletonPromoCard]}>
        <View style={[styles.skeletonLine, styles.skeletonPromoEyebrow]} />
        <View style={[styles.skeletonLine, styles.skeletonPromoTitle]} />
        <View style={[styles.skeletonLine, styles.skeletonPromoBody]} />
        <View style={[styles.skeletonLine, styles.skeletonPromoBodyShort]} />
        <View style={styles.skeletonPromoFooter}>
          <View style={[styles.skeletonLine, styles.skeletonPromoPill]} />
          <View style={styles.promoDots}>
            <View style={[styles.promoDot, styles.skeletonPromoDot]} />
            <View style={[styles.promoDot, styles.skeletonPromoDot]} />
            <View style={[styles.promoDot, styles.skeletonPromoDot]} />
          </View>
        </View>
      </View>
    </View>
  );
}

export default memo(PassengerHomeOverlay);

const styles = StyleSheet.create({
  homeStack: {
    position: "absolute",
    left: HOME_CARD_HORIZONTAL_INSET,
    right: HOME_CARD_HORIZONTAL_INSET,
    height: HOME_STACK_HEIGHT,
    zIndex: 16,
    elevation: Platform.OS === "android" ? 0 : 12,
  },
  searchCard: {
    position: "absolute",
    left: HOME_CARD_HORIZONTAL_INSET,
    right: HOME_CARD_HORIZONTAL_INSET,
    zIndex: 16,
    height: HOME_CARD_HEIGHT,
    borderRadius: HOME_CARD_RADIUS,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    backgroundColor: CARD_SURFACE,
    paddingLeft: HOME_CARD_PADDING_HORIZONTAL,
    paddingRight: HOME_CARD_PADDING_HORIZONTAL,
    paddingTop: HOME_CARD_PADDING_TOP,
    paddingBottom: HOME_CARD_PADDING_BOTTOM,
    flexDirection: "column",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.12,
    shadowRadius: 17,
    elevation: Platform.OS === "android" ? 0 : 12,
  },
  searchCardInStack: {
    left: 0,
    right: 0,
    bottom: HOME_PROMO_CARD_HEIGHT + HOME_STACK_GAP,
  },
  searchCardReviewMode: {
    borderColor: "rgba(236,229,220,0.72)",
    backgroundColor: "rgba(255,255,255,0.94)",
    shadowOpacity: 0.05,
    shadowRadius: 12,
  },
  promoCard: {
    position: "absolute",
    left: 0,
    right: 0,
    height: HOME_PROMO_CARD_HEIGHT,
    borderRadius: HOME_CARD_RADIUS,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    backgroundColor: "#FBFCF8",
    paddingHorizontal: 24,
    paddingTop: 22,
    paddingBottom: 18,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.1,
    shadowRadius: 18,
    elevation: Platform.OS === "android" ? 0 : 10,
  },
  promoCardInStack: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
  },
  skeletonCard: {
    backgroundColor: "rgba(255,255,255,0.96)",
  },
  skeletonPromoCard: {
    backgroundColor: "rgba(251,252,248,0.96)",
  },
  searchCardMain: {
    minHeight: HOME_CARD_HEIGHT - HOME_CARD_PADDING_TOP - HOME_CARD_PADDING_BOTTOM,
    flexDirection: "row",
  },
  searchCardMainSingleField: {
    minHeight: HOME_SEARCH_ACTIVE_CARD_HEIGHT - HOME_CARD_PADDING_TOP - HOME_CARD_PADDING_BOTTOM,
    alignItems: "center",
  },
  routeRail: {
    width: 13,
    paddingTop: 8,
    alignItems: "center",
  },
  originDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: TEXT_PRIMARY,
  },
  routeStem: {
    width: 1.5,
    height: 31,
    marginTop: 5,
    marginBottom: 7,
    borderRadius: 1,
    backgroundColor: "#E9E2D8",
  },
  destinationDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: LEAF_GREEN,
  },
  copyColumn: {
    flex: 1,
    minWidth: 0,
    marginLeft: 15,
  },
  copyColumnSingleField: {
    marginLeft: 0,
  },
  pickupInput: {
    minHeight: 43,
    justifyContent: "flex-start",
  },
  label: {
    color: TEXT_MUTED,
    fontFamily: fonts.Medium,
    fontSize: 11,
    lineHeight: 15,
  },
  pickupText: {
    marginTop: 2,
    color: TEXT_PRIMARY,
    fontFamily: fonts.SemiBold,
    fontSize: 14,
    lineHeight: 18,
  },
  inlineSearchRow: {
    marginTop: 1,
    minHeight: 24,
    flexDirection: "row",
    alignItems: "center",
  },
  pickupSearchInput: {
    flex: 1,
    minWidth: 0,
    color: TEXT_PRIMARY,
    fontFamily: fonts.SemiBold,
    fontSize: 15,
    lineHeight: 20,
    paddingVertical: 0,
  },
  inlineSearchCloseButton: {
    marginLeft: 10,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F7F8F5",
  },
  inlineSearchSubmitButton: {
    marginLeft: 10,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#DDE8D7",
    backgroundColor: "#F5F8F2",
  },
  hiddenPickupAddress: {
    position: "absolute",
    width: 1,
    height: 1,
    opacity: 0,
  },
  divider: {
    width: "100%",
    height: StyleSheet.hairlineWidth,
    marginTop: 3,
    marginBottom: 8,
    backgroundColor: "#E9E2D8",
  },
  destinationInput: {
    minHeight: 45,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  destinationCopy: {
    flex: 1,
    minWidth: 0,
    paddingRight: 12,
  },
  destinationLabel: {
    color: LEAF_GREEN,
    fontFamily: fonts.SemiBold,
    fontSize: 11,
    lineHeight: 15,
  },
  destinationText: {
    marginTop: 2,
    color: LEAF_GREEN,
    fontFamily: fonts.SemiBold,
    fontSize: 17,
    lineHeight: 22,
  },
  destinationActionButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#DDE8D7",
    backgroundColor: "#F5F8F2",
  },
  destinationSearchInput: {
    flex: 1,
    minWidth: 0,
    marginTop: 1,
    color: TEXT_PRIMARY,
    fontFamily: fonts.SemiBold,
    fontSize: 16,
    lineHeight: 21,
    paddingVertical: 0,
  },
  destinationSearchActions: {
    marginTop: 7,
    marginLeft: 12,
    flexDirection: "row",
    alignItems: "center",
  },
  destinationSearchSubmitButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#DDE8D7",
    backgroundColor: "#F5F8F2",
  },
  destinationSearchCloseButton: {
    marginLeft: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F7F8F5",
  },
  destinationResultRow: {
    minHeight: HOME_SEARCH_DROPDOWN_ROW_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 4,
  },
  destinationResultIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F2F7F4",
  },
  destinationResultCopy: {
    flex: 1,
    minWidth: 0,
    marginLeft: 12,
  },
  destinationResultCopyPlain: {
    flex: 1,
    minWidth: 0,
    marginLeft: 10,
  },
  destinationResultClockIcon: {
    width: 18,
    textAlign: "center",
  },
  destinationResultTitleRow: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
  },
  destinationResultTitleText: {
    flex: 1,
    minWidth: 0,
    paddingRight: 10,
  },
  pickupResultTitle: {
    color: TEXT_PRIMARY,
    fontFamily: fonts.Regular,
    fontSize: 13,
    lineHeight: 18,
  },
  destinationResultTitle: {
    color: TEXT_PRIMARY,
    fontFamily: fonts.Regular,
    fontSize: 14,
    lineHeight: 19,
  },
  destinationResultDistance: {
    color: TEXT_PRIMARY,
    fontFamily: fonts.Regular,
    fontSize: 13,
    lineHeight: 18,
    textAlign: "right",
  },
  destinationResultAddress: {
    marginTop: 2,
    color: TEXT_MUTED,
    fontFamily: fonts.Regular,
    fontSize: 12,
    lineHeight: 15,
  },
  destinationResultStatus: {
    minHeight: 60,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  destinationResultStatusText: {
    color: TEXT_MUTED,
    fontFamily: fonts.Medium,
    fontSize: 12,
    lineHeight: 16,
  },
  destinationResultEmpty: {
    paddingTop: 12,
    color: TEXT_MUTED,
    fontFamily: fonts.Regular,
    fontSize: 12,
    lineHeight: 16,
  },
  dropdownInline: {
    marginTop: HOME_SEARCH_DROPDOWN_TOP_GAP,
    marginLeft: 28,
    paddingTop: 2,
    paddingBottom: 4,
    overflow: "hidden",
  },
  categoryCard: {
    position: "absolute",
    borderRadius: HOME_CARD_RADIUS,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    backgroundColor: CARD_SURFACE,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 24,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: Platform.OS === "android" ? 0 : 10,
  },
  categoryHandle: {
    alignSelf: "center",
    width: 34,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#D8D2CA",
    marginBottom: 10,
  },
  categoryEyebrow: {
    color: TEXT_PRIMARY,
    fontFamily: fonts.SemiBold,
    fontSize: 16,
    lineHeight: 21,
  },
  categoryTabs: {
    marginTop: 12,
    minHeight: 44,
    flexDirection: "row",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#E9E2D8",
  },
  categoryTab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 38,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "transparent",
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  categoryTabActive: {
    borderBottomWidth: 2,
    borderBottomColor: TEXT_PRIMARY,
    borderColor: "rgba(26,51,14,0.14)",
    backgroundColor: "#F6F8F3",
  },
  categoryTabText: {
    color: TEXT_MUTED,
    fontFamily: fonts.SemiBold,
    fontSize: 13.5,
    lineHeight: 17,
  },
  categoryTabTextActive: {
    color: TEXT_PRIMARY,
    fontFamily: fonts.SemiBold,
  },
  categorySummaryRow: {
    minHeight: 38,
    marginTop: 11,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
  },
  categorySummaryRowBreakdown: {
    marginTop: 6,
  },
  categorySummaryCopy: {
    flex: 1,
    minWidth: 0,
  },
  categorySummaryTitleRow: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
  },
  categorySummaryTitle: {
    flexShrink: 1,
    maxWidth: "58%",
    color: TEXT_PRIMARY,
    fontFamily: fonts.SemiBold,
    fontSize: 15.5,
    lineHeight: 20,
  },
  categoryTariffPill: {
    marginLeft: 7,
    minHeight: 22,
    maxWidth: 112,
    borderRadius: 11,
    paddingHorizontal: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F4F8F1",
    borderWidth: 1,
    borderColor: "rgba(26,51,14,0.12)",
  },
  categoryTariffPillHigh: {
    backgroundColor: "#FFF7E8",
    borderColor: "rgba(138,90,23,0.18)",
  },
  categoryTariffPillText: {
    color: LEAF_GREEN,
    fontFamily: fonts.SemiBold,
    fontSize: 8.8,
    lineHeight: 11,
  },
  categoryTariffPillTextHigh: {
    color: "#8A5A17",
  },
  categorySummarySubtitle: {
    marginTop: 1,
    color: TEXT_MUTED,
    fontFamily: fonts.Regular,
    fontSize: 11,
    lineHeight: 14,
  },
  categoryPriceWrap: {
    alignItems: "flex-end",
    minWidth: 82,
  },
  categoryPrice: {
    color: TEXT_PRIMARY,
    fontFamily: fonts.SemiBold,
    fontSize: 14,
    lineHeight: 18,
    textAlign: "right",
  },
  categoryPriceCaption: {
    color: TEXT_MUTED,
    fontFamily: fonts.Regular,
    fontSize: 9.5,
    lineHeight: 12,
  },
  categoryMetaRow: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  categoryMetaRowBreakdown: {
    marginTop: 8,
  },
  categoryEtaItem: {
    flex: 1,
    minWidth: 0,
    minHeight: 30,
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: 8,
  },
  categoryMetaDivider: {
    width: StyleSheet.hairlineWidth,
    height: 28,
    marginHorizontal: 16,
    backgroundColor: "rgba(23,20,18,0.13)",
  },
  categoryMetaLabel: {
    color: TEXT_MUTED,
    fontFamily: fonts.Regular,
    fontSize: 10.5,
    lineHeight: 13,
  },
  categoryMetaValue: {
    color: TEXT_PRIMARY,
    fontFamily: fonts.SemiBold,
    fontSize: 13,
    lineHeight: 16,
  },
  categoryLeafDelasPill: {
    alignSelf: "flex-start",
    marginTop: 2,
    minHeight: 20,
    borderRadius: 11,
    paddingHorizontal: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F7F8F5",
    borderWidth: 1,
    borderColor: "rgba(26,51,14,0.08)",
  },
  categoryLeafDelasPillActive: {
    backgroundColor: LEAF_GREEN,
    borderColor: LEAF_GREEN,
  },
  categoryLeafDelasText: {
    color: TEXT_MUTED,
    fontFamily: fonts.SemiBold,
    fontSize: 8.5,
    lineHeight: 10,
  },
  categoryLeafDelasTextActive: {
    color: "#FFFFFF",
  },
  categoryNotice: {
    marginTop: 12,
    color: "#D21F4A",
    fontFamily: fonts.Medium,
    fontSize: 12,
    lineHeight: 16,
    textAlign: "center",
  },
  categoryConfirmButton: {
    marginTop: 12,
    minHeight: leafButtonMetrics.height,
    borderRadius: leafButtonMetrics.radius,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: TEXT_PRIMARY,
  },
  categoryConfirmButtonBreakdown: {
    marginTop: 10,
  },
  categoryConfirmButtonDisabled: {
    opacity: 0.5,
  },
  categoryConfirmText: {
    color: "#FFFFFF",
    fontFamily: fonts.SemiBold,
    fontSize: 12,
    lineHeight: 15,
  },
  categoryPriceCaptionRow: {
    marginTop: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 3,
  },
  fareBreakdownPanel: {
    marginTop: 9,
    paddingTop: 9,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(23,20,18,0.12)",
  },
  fareBreakdownRow: {
    minHeight: 24,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  fareBreakdownCopy: {
    flex: 1,
    minWidth: 0,
  },
  fareBreakdownLabelRow: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  fareBreakdownLabel: {
    color: TEXT_PRIMARY,
    fontFamily: fonts.Regular,
    fontSize: 11,
    lineHeight: 14,
  },
  fareBreakdownInfoButton: {
    width: 15,
    height: 15,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F4F8F1",
    borderWidth: 1,
    borderColor: "rgba(26,51,14,0.2)",
  },
  fareBreakdownInfoText: {
    color: LEAF_GREEN,
    fontFamily: fonts.SemiBold,
    fontSize: 9,
    lineHeight: 11,
  },
  fareBreakdownDetail: {
    marginTop: 0,
    color: TEXT_MUTED,
    fontFamily: fonts.Regular,
    fontSize: 9,
    lineHeight: 11,
  },
  fareBreakdownAmount: {
    color: TEXT_PRIMARY,
    fontFamily: fonts.Medium,
    fontSize: 11,
    lineHeight: 14,
    textAlign: "right",
  },
  fareBreakdownTotalRow: {
    marginTop: 5,
    paddingTop: 7,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(23,20,18,0.12)",
  },
  fareBreakdownTotalLabel: {
    color: TEXT_PRIMARY,
    fontFamily: fonts.SemiBold,
    fontSize: 11,
    lineHeight: 14,
  },
  fareBreakdownTotalAmount: {
    color: TEXT_PRIMARY,
    fontFamily: fonts.SemiBold,
    fontSize: 11,
    lineHeight: 14,
    textAlign: "right",
  },
  pickupAdjustmentModalBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    paddingHorizontal: HOME_CARD_HORIZONTAL_INSET + 10,
    paddingBottom: 196,
    backgroundColor: "rgba(23,20,18,0.08)",
  },
  pickupAdjustmentBubble: {
    alignSelf: "stretch",
    position: "relative",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: "#171412",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.14,
    shadowRadius: 18,
    elevation: Platform.OS === "android" ? 4 : 0,
  },
  pickupAdjustmentBubbleArrow: {
    position: "absolute",
    right: 42,
    bottom: -7,
    width: 14,
    height: 14,
    borderRadius: 2,
    backgroundColor: "#171412",
    transform: [{ rotate: "45deg" }],
  },
  pickupAdjustmentBubbleText: {
    color: "#FFFFFF",
    fontFamily: fonts.Regular,
    fontSize: 12,
    lineHeight: 16,
  },
  hiddenMicButton: {
    position: "absolute",
    width: 1,
    height: 1,
    opacity: 0,
  },
  promoCopy: {
    flex: 1,
  },
  promoEyebrow: {
    color: TEXT_MUTED,
    fontFamily: fonts.Medium,
    fontSize: 11,
    lineHeight: 15,
  },
  promoTitle: {
    marginTop: 7,
    color: TEXT_PRIMARY,
    fontFamily: fonts.SemiBold,
    fontSize: 22,
    lineHeight: 28,
  },
  promoBody: {
    marginTop: 8,
    maxWidth: "88%",
    color: TEXT_MUTED,
    fontFamily: fonts.Regular,
    fontSize: 13,
    lineHeight: 18,
  },
  promoFooter: {
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  promoPill: {
    minHeight: 34,
    borderRadius: 17,
    backgroundColor: "#1A330E",
    paddingHorizontal: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  promoPillText: {
    color: "#FFFFFF",
    fontFamily: fonts.SemiBold,
    fontSize: 12,
    lineHeight: 16,
  },
  promoDots: {
    flexDirection: "row",
    alignItems: "center",
  },
  promoDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginLeft: 6,
    backgroundColor: "#DDE6D9",
  },
  promoDotActive: {
    width: 18,
    backgroundColor: "#1A330E",
  },
  skeletonDot: {
    backgroundColor: "#B8C1B4",
  },
  skeletonDestinationDot: {
    backgroundColor: "#DDE6D9",
  },
  skeletonLine: {
    borderRadius: 999,
    backgroundColor: "#EEF2EA",
  },
  skeletonLabelLine: {
    width: 58,
    height: 11,
  },
  skeletonPickupLine: {
    width: "72%",
    height: 18,
    marginTop: 7,
  },
  skeletonDestinationLine: {
    width: "84%",
    height: 21,
    marginTop: 7,
  },
  skeletonChevron: {
    width: 26,
    height: 26,
    borderRadius: 13,
    marginTop: 8,
    marginLeft: 12,
    backgroundColor: "#EEF2EA",
  },
  skeletonPromoEyebrow: {
    width: 78,
    height: 11,
  },
  skeletonPromoTitle: {
    width: "72%",
    height: 24,
    marginTop: 11,
  },
  skeletonPromoBody: {
    width: "86%",
    height: 13,
    marginTop: 13,
  },
  skeletonPromoBodyShort: {
    width: "66%",
    height: 13,
    marginTop: 7,
  },
  skeletonPromoFooter: {
    marginTop: 22,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  skeletonPromoPill: {
    width: 98,
    height: 34,
  },
  skeletonPromoDot: {
    backgroundColor: "#E4E9E0",
  },
});
