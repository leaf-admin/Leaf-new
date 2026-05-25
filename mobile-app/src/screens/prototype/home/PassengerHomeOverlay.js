import React, { memo } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Keyboard,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
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
const HOME_CARD_HORIZONTAL_INSET = 24;
const HOME_CARD_RADIUS = 28;
const HOME_CARD_PADDING_HORIZONTAL = 24;
const HOME_CARD_PADDING_TOP = 22;
const HOME_CARD_PADDING_BOTTOM = 18;
const HOME_STACK_GAP = 18;
const HOME_PROMO_CARD_HEIGHT = 188;
const HOME_CATEGORY_CARD_HEIGHT = HOME_PROMO_CARD_HEIGHT + 25;
const HOME_SEARCH_DROPDOWN_MIN_HEIGHT = 72;
const HOME_SEARCH_DROPDOWN_MAX_HEIGHT = 140;
const HOME_SEARCH_DROPDOWN_ROW_HEIGHT = 44;
const HOME_SEARCH_DROPDOWN_VERTICAL_PADDING = 8;
const HOME_SEARCH_DROPDOWN_TOP_GAP = 10;
const HOME_STACK_HEIGHT = HOME_CARD_HEIGHT + HOME_STACK_GAP + HOME_PROMO_CARD_HEIGHT;
const HOME_SEARCH_KEYBOARD_CLEARANCE = 52;
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

function PassengerHomeOverlay({
  insetsBottom = 0,
  userId = "",
  pickupLabel = "",
  pickupAddress = "",
  destinationLabel = "Para onde?",
  onPickupPress,
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
  categoryConfirmDisabled = false,
  categoryConfirmLabel = "Confirmar",
  tariffStatusLabel = "Tarifa normal",
  tariffHigh = false,
  leafDelasEnabled = false,
  onLeafDelasToggle,
}) {
  const safeBottom = Math.max(0, Number(insetsBottom) || 0);
  const resolvedPickupLabel = pickupLabel || pickupAddress || "Local atual";
  const entrance = React.useRef(new Animated.Value(0)).current;
  const inputRef = React.useRef(null);
  const [keyboardHeight, setKeyboardHeight] = React.useState(0);
  const visibleResults = Array.isArray(destinationSearchResults)
    ? destinationSearchResults.slice(0, 3)
    : [];
  const visibleCategoryOptions = Array.isArray(categoryOptions)
    ? categoryOptions.slice(0, 3)
    : [];
  const selectedCategory =
    visibleCategoryOptions.find((item) => item?.id === selectedCategoryId) ||
    visibleCategoryOptions[0] ||
    null;
  const shouldShowCategoryCard =
    categoryVisible && !destinationSearchActive && Boolean(selectedCategory);
  const searchDropdownHeight = destinationSearchActive
    ? Math.min(
        HOME_SEARCH_DROPDOWN_MAX_HEIGHT,
        Math.max(
          HOME_SEARCH_DROPDOWN_MIN_HEIGHT,
          destinationSearchSearching || visibleResults.length === 0
            ? HOME_SEARCH_DROPDOWN_MIN_HEIGHT
            : visibleResults.length * HOME_SEARCH_DROPDOWN_ROW_HEIGHT +
                HOME_SEARCH_DROPDOWN_VERTICAL_PADDING,
        ),
      )
    : 0;
  const activeSearchCardHeight = destinationSearchActive
    ? HOME_CARD_HEIGHT + HOME_SEARCH_DROPDOWN_TOP_GAP + searchDropdownHeight
    : HOME_CARD_HEIGHT;
  const lowerPanelHeight = shouldShowCategoryCard
      ? HOME_CATEGORY_CARD_HEIGHT
      : HOME_PROMO_CARD_HEIGHT;
  const stackHeight = destinationSearchActive
    ? activeSearchCardHeight
    : activeSearchCardHeight + HOME_STACK_GAP + lowerPanelHeight;

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
    if (!destinationSearchActive) {
      return undefined;
    }

    const timer = setTimeout(() => {
      inputRef.current?.focus?.();
    }, 80);

    return () => clearTimeout(timer);
  }, [destinationSearchActive]);

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

  return (
    <Animated.View
      onLayout={onCardLayout}
      style={[
        styles.homeStack,
        {
          height: stackHeight,
          bottom: destinationSearchActive
            ? Math.max(
                safeBottom + HOME_CARD_BOTTOM_OFFSET,
                keyboardHeight - safeBottom + HOME_SEARCH_KEYBOARD_CLEARANCE,
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
            {
              bottom: destinationSearchActive ? 0 : lowerPanelHeight + HOME_STACK_GAP,
              height: activeSearchCardHeight,
            },
          ]}
        >
          <View style={styles.searchCardMain}>
            <View pointerEvents="none" style={styles.routeRail}>
              <View style={styles.originDot} />
              <View style={styles.routeStem} />
              <View style={styles.destinationDot} />
            </View>

            <View style={styles.copyColumn}>
              <TouchableOpacity
                activeOpacity={0.88}
                style={styles.pickupInput}
                onPress={onPickupPress}
                testID="passenger-home-pickup-input"
                accessibilityLabel="Alterar local de partida"
              >
                <Text style={styles.label}>Partida</Text>
                <Text style={styles.pickupText} numberOfLines={1}>
                  {resolvedPickupLabel}
                </Text>
                {pickupAddress ? (
                  <Text style={styles.hiddenPickupAddress}>{pickupAddress}</Text>
                ) : null}
              </TouchableOpacity>

              <View style={styles.divider} />

              <TouchableOpacity
                activeOpacity={destinationSearchActive ? 1 : 0.88}
                style={styles.destinationInput}
                onPress={destinationSearchActive ? undefined : onDestinationPress}
                testID="passenger-home-destination-input"
                accessibilityLabel="Escolher destino da viagem"
              >
                <View style={styles.destinationCopy}>
                  <Text style={styles.destinationLabel}>Destino</Text>
                  {destinationSearchActive ? (
                    <TextInput
                      ref={inputRef}
                      value={destinationSearchQuery}
                      onChangeText={onDestinationSearchChange}
                      placeholder={destinationLabel || "Para onde vamos?"}
                      placeholderTextColor={TEXT_MUTED}
                      autoCorrect={false}
                      returnKeyType="search"
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
            </View>
          </View>

          <TouchableOpacity
            activeOpacity={0.86}
            onPress={onMicrophonePress}
            style={styles.hiddenMicButton}
            testID="passenger-home-destination-mic"
            accessibilityLabel="Ditar destino por voz"
          />

          {destinationSearchActive ? (
            <View
              style={[styles.dropdownInline, { height: searchDropdownHeight }]}
              testID="passenger-home-destination-dropdown"
            >
              {destinationSearchSearching ? (
                <View style={styles.destinationResultStatus}>
                  <ActivityIndicator size="small" color={LEAF_GREEN} />
                  <Text style={styles.destinationResultStatusText}>Buscando...</Text>
                </View>
              ) : visibleResults.length > 0 ? (
                visibleResults.map((item, index) => (
                  <TouchableOpacity
                    key={item?.id || `${item?.name || "destino"}-${index}`}
                    activeOpacity={0.86}
                    onPress={() => onDestinationResultPress?.(item)}
                    style={styles.destinationResultRow}
                    testID={`passenger-home-destination-result-${index}`}
                    accessibilityLabel={`Escolher ${item?.name || "destino"}`}
                  >
                    <View style={styles.destinationResultCopyPlain}>
                      <Text numberOfLines={1} style={styles.destinationResultTitle}>
                        {item?.name || "Destino"}
                      </Text>
                      <Text numberOfLines={1} style={styles.destinationResultAddress}>
                        {item?.address || item?.description || "Rio de Janeiro"}
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))
              ) : (
                <Text style={styles.destinationResultEmpty}>
                  {String(destinationSearchQuery || "").trim().length >= 3
                    ? "Não encontrei esse destino ainda."
                    : "Destinos recentes aparecem aqui."}
                </Text>
              )}
            </View>
          ) : null}
        </View>
      {destinationSearchActive ? null : shouldShowCategoryCard ? (
        <View
          style={[
            styles.categoryCard,
            styles.promoCardInStack,
            { height: HOME_CATEGORY_CARD_HEIGHT },
          ]}
          testID="passenger-home-category-card"
          accessibilityLabel="Escolha a categoria da corrida"
        >
          <View style={styles.categoryHandle} />
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

          <View style={styles.categorySummaryRow}>
            <View style={styles.categorySummaryCopy}>
              <Text style={styles.categorySummaryTitle} numberOfLines={1}>
                {selectedCategory?.label || "Plus"}
              </Text>
              <Text style={styles.categorySummarySubtitle} numberOfLines={1}>
                {selectedCategory?.description || "Confortável e acessível"}
              </Text>
            </View>
            <View style={styles.categoryPriceWrap}>
              <Text style={styles.categoryPrice} numberOfLines={1}>
                {selectedCategory?.priceLabel || "--"}
              </Text>
              <Text style={styles.categoryPriceCaption}>valor da corrida</Text>
            </View>
          </View>

          <View style={styles.categoryMetaRow}>
            <View style={styles.categoryMetaItem}>
              <Text style={styles.categoryMetaLabel}>Embarque</Text>
              <Text style={styles.categoryMetaValue}>
                {selectedCategory?.pickupEtaLabel || "--"}
              </Text>
            </View>
            <View style={styles.categoryMetaItem}>
              <Text style={styles.categoryMetaLabel}>Chegada</Text>
              <Text style={styles.categoryMetaValue}>
                {selectedCategory?.arrivalLabel || "--"}
              </Text>
            </View>
            <View style={styles.categoryMetaItem}>
              <Text
                style={[
                  styles.categoryMetaLabel,
                  tariffHigh && styles.categoryMetaLabelHigh,
                ]}
              >
                {tariffStatusLabel}
              </Text>
              <TouchableOpacity
                activeOpacity={0.84}
                onPress={onLeafDelasToggle}
                style={[
                  styles.categoryLeafDelasPill,
                  leafDelasEnabled && styles.categoryLeafDelasPillActive,
                ]}
                accessibilityRole="switch"
                accessibilityLabel="Leaf Delas"
                accessibilityState={{ checked: leafDelasEnabled }}
              >
                <Text
                  style={[
                    styles.categoryLeafDelasText,
                    leafDelasEnabled && styles.categoryLeafDelasTextActive,
                  ]}
                >
                  Leaf Delas
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          <TouchableOpacity
            activeOpacity={categoryConfirmDisabled ? 1 : 0.88}
            disabled={categoryConfirmDisabled}
            onPress={onCategoryConfirm}
            style={[
              styles.categoryConfirmButton,
              categoryConfirmDisabled && styles.categoryConfirmButtonDisabled,
            ]}
            testID="passenger-home-category-confirm"
            accessibilityRole="button"
            accessibilityLabel="Confirmar categoria"
          >
            <Text style={styles.categoryConfirmText}>{categoryConfirmLabel}</Text>
          </TouchableOpacity>
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
  destinationSearchCloseButton: {
    marginTop: 7,
    marginLeft: 12,
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
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#E9E2D8",
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
  },
  destinationResultTitle: {
    color: TEXT_PRIMARY,
    fontFamily: fonts.SemiBold,
    fontSize: 13,
    lineHeight: 16,
  },
  destinationResultAddress: {
    marginTop: 2,
    color: TEXT_MUTED,
    fontFamily: fonts.Regular,
    fontSize: 10,
    lineHeight: 12,
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
    borderRadius: 18,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    backgroundColor: "#FBFCF8",
    paddingHorizontal: 14,
    paddingTop: 6,
    paddingBottom: 6,
    overflow: "hidden",
  },
  categoryCard: {
    position: "absolute",
    borderRadius: HOME_CARD_RADIUS,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    backgroundColor: CARD_SURFACE,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 14,
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
    marginBottom: 8,
  },
  categoryEyebrow: {
    color: TEXT_PRIMARY,
    fontFamily: fonts.SemiBold,
    fontSize: 16,
    lineHeight: 21,
  },
  categoryTabs: {
    marginTop: 10,
    minHeight: 38,
    flexDirection: "row",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#E9E2D8",
  },
  categoryTab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderBottomWidth: 1,
    borderBottomColor: "transparent",
  },
  categoryTabActive: {
    borderBottomWidth: 2,
    borderBottomColor: TEXT_PRIMARY,
  },
  categoryTabText: {
    color: TEXT_MUTED,
    fontFamily: fonts.Medium,
    fontSize: 12,
    lineHeight: 16,
  },
  categoryTabTextActive: {
    color: TEXT_PRIMARY,
    fontFamily: fonts.SemiBold,
  },
  categorySummaryRow: {
    minHeight: 38,
    marginTop: 12,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
  },
  categorySummaryCopy: {
    flex: 1,
    minWidth: 0,
  },
  categorySummaryTitle: {
    color: TEXT_PRIMARY,
    fontFamily: fonts.SemiBold,
    fontSize: 14,
    lineHeight: 18,
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
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8,
  },
  categoryMetaItem: {
    flex: 1,
    minWidth: 0,
  },
  categoryMetaLabel: {
    color: TEXT_MUTED,
    fontFamily: fonts.Regular,
    fontSize: 9.5,
    lineHeight: 12,
  },
  categoryMetaLabelHigh: {
    color: "#8A5A17",
    fontFamily: fonts.SemiBold,
  },
  categoryMetaValue: {
    marginTop: 2,
    color: TEXT_PRIMARY,
    fontFamily: fonts.SemiBold,
    fontSize: 11,
    lineHeight: 14,
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
  categoryConfirmButton: {
    marginTop: 12,
    minHeight: leafButtonMetrics.height,
    borderRadius: leafButtonMetrics.radius,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: TEXT_PRIMARY,
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
