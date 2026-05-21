import React from "react";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import LeafCampaignSlot from "../src/components/campaigns/LeafCampaignSlot";

describe("LeafCampaignSlot", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    global.__LEAF_CAMPAIGN_FIXTURES__ = [
      {
        id: "cmp_leaf_welcome_passenger",
        template: "compact_banner",
        surface: "passenger_home",
        placement: "above_search_card",
        content: {
          eyebrow: "Bem-vindo",
          title: "Bem-vindo à Leaf.",
          body: "Peça sua corrida com clareza no valor e no trajeto.",
          cta: { label: "Escolher", action: "open_destination" },
        },
      },
    ];
  });

  afterEach(() => {
    delete global.__LEAF_CAMPAIGN_FIXTURES__;
  });

  it("renders the matching campaign and can dismiss it locally", async () => {
    const { findByText, getByTestId, queryByText } = render(
      <LeafCampaignSlot
        userId="user_1"
        role="customer"
        surface="passenger_home"
        placement="above_search_card"
      />,
    );

    expect(await findByText("Bem-vindo à Leaf.")).toBeTruthy();
    expect(await findByText("Escolher")).toBeTruthy();

    fireEvent.press(getByTestId("leaf-campaign-slot-dismiss"));

    await waitFor(() => {
      expect(queryByText("Bem-vindo à Leaf.")).toBeNull();
    });
  });
});
