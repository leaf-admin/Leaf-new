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

  it("renders pickup search input and result dropdown", () => {
    const onPickupSearchChange = jest.fn();
    const onPickupResultPress = jest.fn();
    const { getByTestId, getByText } = render(
      <PassengerHomeOverlay
        pickupSearchActive
        pickupSearchQuery="Carioca"
        pickupSearchResults={[
          {
            id: "place-carioca",
            name: "Carioca Shopping",
            address: "Av. Vicente de Carvalho, 909",
          },
        ]}
        onPickupSearchChange={onPickupSearchChange}
        onPickupResultPress={onPickupResultPress}
      />
    );

    fireEvent.changeText(getByTestId("passenger-home-pickup-search-input"), "Carioca Shopping");
    expect(onPickupSearchChange).toHaveBeenCalledWith("Carioca Shopping");
    expect(getByTestId("passenger-home-pickup-dropdown")).toBeTruthy();
    fireEvent.press(getByText("Carioca Shopping"));
    expect(onPickupResultPress).toHaveBeenCalledTimes(1);
  });

  it("exposes the traffic status in the category card", () => {
    const { getByTestId } = render(
      <PassengerHomeOverlay
        pickupAddress="Carioca Shopping"
        destinationLabel="Mercadão de Madureira"
        categoryVisible
        categoryOptions={[
          {
            id: "plus",
            label: "Plus",
            description: "Confortável e acessível",
            priceLabel: "R$ 18,55",
            pickupEtaLabel: "4 min",
            arrivalLabel: "15:30",
          },
        ]}
        selectedCategoryId="plus"
        tariffStatusLabel="Trânsito intenso"
        tariffHigh
      />
    );

    expect(getByTestId("passenger-home-traffic-status")).toHaveTextContent(
      "Trânsito intenso"
    );
  });
});
