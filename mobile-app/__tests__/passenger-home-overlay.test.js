import React from "react";
import { fireEvent, render } from "@testing-library/react-native";

import PassengerHomeOverlay from "../src/screens/prototype/home/PassengerHomeOverlay";

describe("PassengerHomeOverlay", () => {
  it("keeps recent destinations out of the initial passenger card", () => {
    const onDestinationPress = jest.fn();
    const onPickupPress = jest.fn();
    const { getAllByText, getByTestId, queryByText } = render(
      <PassengerHomeOverlay
        pickupAddress="Rua das Pastorinhas"
        onPickupPress={onPickupPress}
        onDestinationPress={onDestinationPress}
      />
    );

    expect(queryByText("Casa")).toBeNull();
    expect(queryByText("Shopping Leblon")).toBeNull();
    expect(getAllByText("Rua das Pastorinhas").length).toBeGreaterThan(0);

    fireEvent.press(getByTestId("passenger-home-pickup-input"));
    expect(onPickupPress).toHaveBeenCalledTimes(1);

    fireEvent.press(getByTestId("passenger-home-destination-input"));
    expect(onDestinationPress).toHaveBeenCalledTimes(1);
  });
});
