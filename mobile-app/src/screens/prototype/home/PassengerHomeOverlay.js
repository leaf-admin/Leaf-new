import React, { memo } from "react";
import { StyleSheet } from "react-native";
import {
  CardHandle,
  DestinationInput,
  PrototypeCard,
} from "../../../components/prototype/PrototypeUI";

const HOME_CARD_BOTTOM_OFFSET = 102;

function PassengerHomeOverlay({
  insetsBottom = 0,
  destinationLabel = "Para onde vamos?",
  onDestinationPress,
  onCardLayout,
  onMicrophonePress,
}) {
  return (
    <PrototypeCard
      onLayout={onCardLayout}
      style={[
        styles.searchCard,
        { bottom: insetsBottom + HOME_CARD_BOTTOM_OFFSET },
      ]}
    >
      <CardHandle />
      <DestinationInput
        value={destinationLabel}
        editable={false}
        onPress={onDestinationPress}
        onPressRightIcon={onMicrophonePress}
        testID="passenger-home-destination-input"
        accessibilityLabel="Escolher destino da viagem"
        rightIconTestID="passenger-home-destination-mic"
        rightIconAccessibilityLabel="Ditar destino por voz"
      />
    </PrototypeCard>
  );
}

export default memo(PassengerHomeOverlay);

const styles = StyleSheet.create({
  searchCard: {
    position: "absolute",
    left: 10,
    right: 10,
    zIndex: 16,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 12,
  },
});
