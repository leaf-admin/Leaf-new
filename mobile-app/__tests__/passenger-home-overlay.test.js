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

    expect(getByTestId("passenger-home-pickup-input")).toHaveProp("accessible", false);
    fireEvent.changeText(getByTestId("passenger-home-pickup-search-input"), "Carioca Shopping");
    expect(onPickupSearchChange).toHaveBeenCalledWith("Carioca Shopping");
    expect(getByTestId("passenger-home-pickup-dropdown")).toBeTruthy();
    fireEvent.press(getByText("Carioca Shopping"));
    expect(onPickupResultPress).toHaveBeenCalledTimes(1);
  });

  it("renders destination search input as the active text target", () => {
    const onDestinationSearchChange = jest.fn();
    const onDestinationResultPress = jest.fn();
    const { getByTestId, getByText } = render(
      <PassengerHomeOverlay
        destinationSearchActive
        destinationSearchQuery="Barra"
        destinationSearchResults={[
          {
            id: "place-barra-shopping",
            name: "BarraShopping",
            address: "Av. das Américas, 4.666",
          },
        ]}
        onDestinationSearchChange={onDestinationSearchChange}
        onDestinationResultPress={onDestinationResultPress}
      />
    );

    expect(getByTestId("passenger-home-destination-input")).toHaveProp("accessible", false);
    fireEvent.changeText(getByTestId("passenger-home-destination-search-input"), "Barra Shopping");
    expect(onDestinationSearchChange).toHaveBeenCalledWith("Barra Shopping");
    expect(getByTestId("passenger-home-destination-dropdown")).toBeTruthy();
    fireEvent.press(getByText("BarraShopping"));
    expect(onDestinationResultPress).toHaveBeenCalledTimes(1);
  });

  it("submits typed destination text when the dropdown has no result", () => {
    const onDestinationResultPress = jest.fn();
    const { getByTestId } = render(
      <PassengerHomeOverlay
        destinationSearchActive
        destinationSearchQuery="Barra Shopping"
        destinationSearchResults={[]}
        onDestinationResultPress={onDestinationResultPress}
      />
    );

    fireEvent(getByTestId("passenger-home-destination-search-input"), "submitEditing", {
      nativeEvent: { text: "Barra Shopping" },
    });

    expect(onDestinationResultPress).toHaveBeenCalledWith({
      name: "Barra Shopping",
      address: "Barra Shopping",
    });
  });

  it("does not render a duplicated destination search action inside the input", () => {
    const onDestinationResultPress = jest.fn();
    const { queryByTestId, queryByText } = render(
      <PassengerHomeOverlay
        destinationSearchActive
        destinationSearchQuery="Barra Shopping"
        destinationSearchResults={[]}
        onDestinationResultPress={onDestinationResultPress}
      />
    );

    expect(queryByTestId("passenger-home-destination-search-submit")).toBeNull();
    expect(queryByText("Destino")).toBeNull();
    expect(onDestinationResultPress).not.toHaveBeenCalled();
  });

  it("keeps the category decision focused on price and arrival, with route detail progressive", () => {
    const { getByText, queryByTestId, queryByText } = render(
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
            durationMin: 27,
            distanceKm: 16.4,
            pickupEtaLabel: "4 min",
            arrivalLabel: "15:30",
          },
        ]}
        selectedCategoryId="plus"
      />
    );

    expect(getByText("Sua viagem")).toBeTruthy();
    expect(getByText("Local de partida")).toBeTruthy();
    expect(getByText("Local de destino")).toBeTruthy();
    expect(getByText("R$ 18,55")).toBeTruthy();
    expect(getByText("Chegada estimada")).toBeTruthy();
    expect(getByText("15:30")).toBeTruthy();
    expect(queryByText("27 min")).toBeNull();
    expect(queryByText("16,4 km")).toBeNull();
    expect(queryByTestId("passenger-home-traffic-status")).toBeNull();
  });

  it("shows unavailable driver state only in the primary action", () => {
    const { getByTestId, getByText, queryByText } = render(
      <PassengerHomeOverlay
        pickupAddress="R. Alecrim, 497"
        destinationLabel="BarraShopping"
        categoryVisible
        categoryOptions={[
          {
            id: "plus",
            label: "Plus",
            description: "Confortável e acessível",
            priceLabel: "R$ 58,23",
            pickupEtaLabel: "Sem motorista",
            arrivalLabel: "19:34",
          },
        ]}
        selectedCategoryId="plus"
        categoryNotice="Não foi possível validar motoristas agora."
        categoryConfirmDisabled
        categoryConfirmLabel="Sem motorista disponível"
      />
    );

    expect(getByTestId("passenger-home-category-confirm")).toBeDisabled();
    expect(getByText("Sem motorista disponível")).toBeTruthy();
    expect(queryByText("Não foi possível validar motoristas agora.")).toBeNull();
  });

  it("rolls category selection infinitely with side arrows", () => {
    const onCategorySelect = jest.fn();
    const { getByTestId } = render(
      <PassengerHomeOverlay
        pickupAddress="Carioca Shopping"
        destinationLabel="BarraShopping"
        categoryVisible
        categoryOptions={[
          { id: "plus", label: "Plus", priceLabel: "R$ 18,55" },
          { id: "elite", label: "Elite", priceLabel: "R$ 28,10" },
          { id: "moto", label: "Moto", priceLabel: "R$ 12,30" },
        ]}
        selectedCategoryId="plus"
        onCategorySelect={onCategorySelect}
      />
    );

    fireEvent.press(getByTestId("passenger-home-category-next"));
    expect(onCategorySelect).toHaveBeenCalledWith("elite");

    fireEvent.press(getByTestId("passenger-home-category-prev"));
    expect(onCategorySelect).toHaveBeenCalledWith("moto");
  });

  it("opens the fare breakdown from the category price", () => {
    const { getAllByText, getByTestId, getByText, queryByTestId, queryByText } = render(
      <PassengerHomeOverlay
        pickupAddress="Carioca Shopping"
        destinationLabel="BarraShopping"
        categoryVisible
        categoryOptions={[
          {
            id: "plus",
            label: "Plus",
            description: "Confortável e acessível",
            fare: 60.43,
            priceLabel: "R$ 60,43",
            pickupEtaLabel: "4 min",
            arrivalLabel: "01:00",
            fareBreakdown: {
              distanceKm: 17,
              durationMin: 31,
              tollFee: 4.9,
              pricingPayload: {
                base_fare: 2.79,
                fixed_fee: 1.1,
                distance_component: 42.38,
                time_component: 8.06,
                pickup_adjustment: 1.2,
                final_price: 60.43,
              },
              rateCard: {
                base_fare: 2.79,
                fixed_fee: 1.1,
                rate_per_unit_distance: 1.53,
                rate_per_hour: 15.6,
                min_fare: 8.5,
              },
            },
          },
        ]}
        selectedCategoryId="plus"
      />
    );

    fireEvent.press(getByTestId("passenger-home-fare-breakdown-trigger"));

    expect(getByTestId("passenger-home-fare-breakdown")).toBeTruthy();
    expect(queryByText("Bandeirada")).toBeNull();
    expect(queryByText("Ajuste da cotação")).toBeNull();
    expect(queryByText("Escolha a categoria")).toBeNull();
    expect(queryByTestId("passenger-home-category-elite")).toBeNull();
    expect(getByText("Tarifa base")).toBeTruthy();
    expect(getByText("Distância")).toBeTruthy();
    expect(getByText("Tempo")).toBeTruthy();
    expect(getByText("Adicional de embarque")).toBeTruthy();
    expect(getByText("Pedágio")).toBeTruthy();
    expect(getByText("Total")).toBeTruthy();
    expect(getAllByText("R$ 60,43")).toHaveLength(1);
    expect(getByText("Rota estimada: 31 min · 17,0 km")).toBeTruthy();

    fireEvent.press(getByTestId("passenger-home-pickup-adjustment-info"));

    expect(getByTestId("passenger-home-pickup-adjustment-info-modal")).toBeTruthy();
    expect(
      getByText(
        "Adicional de embarque refere-se ao valor pago ao motorista parceiro para deslocamento até o seu local de partida."
      )
    ).toBeTruthy();
  });
});
