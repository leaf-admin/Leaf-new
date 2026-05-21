import React, { memo } from "react";
import { Animated, Easing, Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { fonts } from "../../../theme/runtimeTokens";
import LeafCampaignSlot from "../../../components/campaigns/LeafCampaignSlot";
import { leafRideColors } from "../../../components/prototype/LeafRideUI";

const HOME_CARD_BOTTOM_OFFSET = 16;
const LEAF_GREEN = "#1A330E";
const CARD_SURFACE = "#FFFFFF";
const CARD_BORDER = "#ECE5DC";
const TEXT_PRIMARY = "#171412";
const TEXT_MUTED = "#827B73";

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
}) {
  const safeBottom = Math.max(0, Number(insetsBottom) || 0);
  const resolvedPickupLabel = pickupLabel || pickupAddress || "Local atual";
  const entrance = React.useRef(new Animated.Value(0)).current;

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
    <>
      <LeafCampaignSlot
        userId={userId}
        role="customer"
        surface="passenger_home"
        placement="above_search_card"
        style={{ bottom: safeBottom + HOME_CARD_BOTTOM_OFFSET + 154 }}
        testID="passenger-home-campaign-slot"
      />
      <Animated.View
        onLayout={onCardLayout}
        style={[
          styles.searchCard,
          {
            bottom: safeBottom + HOME_CARD_BOTTOM_OFFSET,
            height: 142,
            paddingBottom: 18,
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
          activeOpacity={0.88}
          style={styles.destinationInput}
          onPress={onDestinationPress}
          testID="passenger-home-destination-input"
          accessibilityLabel="Escolher destino da viagem"
        >
          <View style={styles.destinationCopy}>
            <Text style={styles.destinationLabel}>Destino</Text>
            <Text style={styles.destinationText} numberOfLines={1}>
              {destinationLabel}
            </Text>
          </View>
          <Text style={styles.chevron} accessibilityElementsHidden importantForAccessibility="no">
            {">"}
          </Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        activeOpacity={0.86}
        onPress={onMicrophonePress}
        style={styles.hiddenMicButton}
        testID="passenger-home-destination-mic"
        accessibilityLabel="Ditar destino por voz"
      />
      </Animated.View>
    </>
  );
}

export default memo(PassengerHomeOverlay);

const styles = StyleSheet.create({
  searchCard: {
    position: "absolute",
    left: 24,
    right: 24,
    zIndex: 16,
    height: 142,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    backgroundColor: CARD_SURFACE,
    paddingLeft: 24,
    paddingRight: 24,
    paddingTop: 22,
    paddingBottom: 18,
    flexDirection: "row",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.12,
    shadowRadius: 17,
    elevation: Platform.OS === "android" ? 0 : 12,
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
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  destinationCopy: {
    flex: 1,
    minWidth: 0,
  },
  destinationLabel: {
    color: TEXT_MUTED,
    fontFamily: fonts.Medium,
    fontSize: 11,
    lineHeight: 15,
  },
  destinationText: {
    marginTop: 2,
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 16,
    lineHeight: 21,
  },
  chevron: {
    marginTop: 11,
    marginLeft: 12,
    color: TEXT_PRIMARY,
    fontFamily: fonts.Medium,
    fontSize: 18,
    lineHeight: 22,
    textAlign: "center",
  },
  hiddenMicButton: {
    position: "absolute",
    width: 1,
    height: 1,
    opacity: 0,
  },
});
