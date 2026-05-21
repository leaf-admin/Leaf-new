import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  dismissCampaign,
  refreshEligibleCampaigns,
} from "../src/services/runtime/campaignCenterService";

describe("campaignCenterService", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    global.__LEAF_CAMPAIGN_FIXTURES__ = [
      {
        id: "cmp_passenger_home",
        template: "compact_banner",
        surface: "passenger_home",
        placement: "above_search_card",
        content: {
          eyebrow: "Bem-vindo",
          title: "Bem-vindo à Leaf.",
          body: "Peça sua corrida com clareza.",
          cta: { label: "Escolher destino", action: "open_destination" },
        },
      },
    ];
  });

  afterEach(() => {
    delete global.__LEAF_CAMPAIGN_FIXTURES__;
  });

  it("returns eligible campaigns from the test-safe runtime bridge", async () => {
    const result = await refreshEligibleCampaigns({
      userId: "user_1",
      role: "customer",
      surface: "passenger_home",
      placement: "above_search_card",
    });

    expect(result.campaigns).toHaveLength(1);
    expect(result.campaigns[0]).toEqual(
      expect.objectContaining({
        id: "cmp_passenger_home",
        surface: "passenger_home",
        placement: "above_search_card",
      }),
    );
  });

  it("keeps local dismissals from coming back before backend refresh catches up", async () => {
    const first = await refreshEligibleCampaigns({
      userId: "user_2",
      role: "customer",
      surface: "passenger_home",
      placement: "above_search_card",
    });

    await dismissCampaign(first.campaigns[0], {
      userId: "user_2",
      role: "customer",
      surface: "passenger_home",
      placement: "above_search_card",
    });

    const afterDismiss = await refreshEligibleCampaigns({
      userId: "user_2",
      role: "customer",
      surface: "passenger_home",
      placement: "above_search_card",
    });

    expect(afterDismiss.campaigns).toHaveLength(0);
  });
});
