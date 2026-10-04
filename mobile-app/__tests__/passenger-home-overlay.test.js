import React from "react";
import { fireEvent, render } from "@testing-library/react-native";

import PassengerHomeOverlay from "../src/screens/prototype/home/PassengerHomeOverlay";
import LeafPassengerSearch from "../src/screens/prototype/home/LeafPassengerSearch";

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

describe("PassengerHomeOverlay", () => {
  it("keeps empty search compact with the keyboard and expands for recent rows", () => {
    const screen = render(<LeafPassengerSearch kind="destination" query="" results={[]} keyboardHeight={300} />);
    expect(screen.getByTestId('passenger-home-destination-search-sheet')).toHaveStyle({ height: 300 });
    expect(screen.getByTestId('passenger-home-destination-search-close')).toBeTruthy();
    screen.rerender(<LeafPassengerSearch kind="destination" query="" keyboardHeight={300}
      results={[1, 2, 3].map(id => ({ item: { id }, display: { title: `Destino ${id}`, address: `Rua ${id}` } }))} />);
    expect(screen.getByTestId('passenger-home-destination-search-sheet')).toHaveStyle({ height: 480 });
    expect(screen.getByTestId('passenger-home-destination-result-2')).toBeTruthy();
  });

  it("shows recent destinations only in the empty destination search and preserves the selected item", () => {
    const recent = { id: 'recent-home', name: 'Casa', address: 'Rua das Flores, 24', coordinate: { latitude: -22.9, longitude: -43.2 } };
    const onDestinationResultPress = jest.fn();
    const screen = render(<PassengerHomeOverlay destinationSearchActive destinationSearchQuery=""
      destinationSearchResults={[recent]} onDestinationResultPress={onDestinationResultPress} />);
    expect(screen.getByText('Destinos recentes')).toBeTruthy();
    expect(screen.getByText('Casa')).toBeTruthy();
    expect(screen.getByText('Rua das Flores, 24')).toBeTruthy();
    expect(screen.getByTestId('passenger-home-destination-result-0')).toHaveProp('accessibilityLabel', 'Destino recente: Casa');
    fireEvent.press(screen.getByTestId('passenger-home-destination-result-0'));
    expect(onDestinationResultPress).toHaveBeenCalledWith(recent);
    screen.rerender(<PassengerHomeOverlay destinationSearchActive destinationSearchQuery="Casa"
      destinationSearchResults={[recent]} onDestinationResultPress={onDestinationResultPress} />);
    expect(screen.queryByText('Destinos recentes')).toBeNull();
  });

  it("keeps the search empty state concise and avoids premature no-results feedback", () => {
    const screen = render(<PassengerHomeOverlay destinationSearchActive destinationSearchQuery="" destinationSearchResults={[]} />);
    expect(screen.queryByText('Destinos recentes')).toBeNull();
    expect(screen.queryByText('Seu próximo destino')).toBeNull();
    expect(screen.getByText('Busque um endereço ou lugar.')).toBeTruthy();
    expect(screen.getByTestId('passenger-home-destination-search-sheet')).toHaveStyle({ height: 300 });
    screen.rerender(<PassengerHomeOverlay destinationSearchActive destinationSearchQuery="Ca" destinationSearchResults={[]} />);
    expect(screen.queryByText('Nenhum lugar encontrado')).toBeNull();
    expect(screen.getByText('Continue digitando para buscar.')).toBeTruthy();
    screen.rerender(<PassengerHomeOverlay destinationSearchActive destinationSearchQuery="Casa" destinationSearchResults={[]} />);
    expect(screen.getByText('Nenhum lugar encontrado')).toBeTruthy();
  });

  it("keeps pickup search distinct from destination recents and opens the map adjustment", () => {
    const onPickupMapPress = jest.fn();
    const screen = render(<PassengerHomeOverlay pickupSearchActive pickupSearchQuery="" pickupSearchResults={[]} onPickupMapPress={onPickupMapPress} />);
    expect(screen.queryByText('Destinos recentes')).toBeNull();
    expect(screen.queryByText('Seu próximo destino')).toBeNull();
    fireEvent.press(screen.getByTestId('passenger-home-pickup-map-option'));
    expect(onPickupMapPress).toHaveBeenCalledTimes(1);
  });

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
    const onPickupPress = jest.fn();
    const { getByText, getByTestId, queryByTestId, queryByText } = render(
      <PassengerHomeOverlay
        pickupAddress="Carioca Shopping"
        destinationLabel="Mercadão de Madureira"
        onPickupPress={onPickupPress}
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

    expect(getByTestId("passenger-home-category-card")).toHaveProp("accessible", true);
    expect(getByText("Sua viagem")).toBeTruthy();
    expect(getByText("Local de partida")).toBeTruthy();
    expect(getByText("Local de destino")).toBeTruthy();
    expect(getByText("R$ 18,55")).toBeTruthy();
    expect(getByText("Chegada ~15:30")).toBeTruthy();
    fireEvent.press(getByTestId("passenger-home-pickup-input"));
    expect(onPickupPress).not.toHaveBeenCalled();
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
    expect(getByTestId("passenger-home-category-confirm")).toHaveProp(
      "accessibilityLabel",
      "Sem motorista disponível",
    );
    expect(getByText("Sem motorista disponível")).toBeTruthy();
    expect(queryByText("Não foi possível validar motoristas agora.")).toBeNull();
  });

  it("selects categories from the three typographic rows", () => {
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

    fireEvent.press(getByTestId("passenger-home-category-elite"));
    expect(onCategorySelect).toHaveBeenCalledWith("elite");

    fireEvent.press(getByTestId("passenger-home-category-moto"));
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
