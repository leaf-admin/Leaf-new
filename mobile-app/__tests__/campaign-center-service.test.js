import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  dismissCampaign,
  normalizeCampaign,
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
      {
        id: "cmp_passenger_home_banner",
        template: "home_banner_card",
        surface: "passenger_home",
        placement: "below_search_card",
        content: {
          eyebrow: "Leaf no Rio",
          title: "Viaje com conforto",
          body: "Motoristas verificados.",
          imageUrl: "https://cdn.leaf.test/banner-rio.webp",
          imageAlt: "Banner Rio",
          displayMode: "image_only",
          cta: { label: "Novidades", action: "open_campaign_details" },
        },
        rules: {
          autoRotateSeconds: 6,
          rotationWeight: 1,
        },
      },
      {
        id: "cmp_ride_map_vehicle_marker",
        template: "map_vehicle_marker",
        surface: "ride_map",
        placement: "vehicle_marker",
        role: "all",
        content: {
          imageUrl: "https://cdn.leaf.test/map-car-marker.webp",
          imageAlt: "Marcador de carro no mapa",
          displayMode: "image_only",
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

  it("normalizes image campaigns for the passenger home carousel", async () => {
    const result = await refreshEligibleCampaigns({
      userId: "user_3",
      role: "customer",
      surface: "passenger_home",
      placement: "below_search_card",
      limit: 3,
    });

    expect(result.campaigns).toHaveLength(1);
    expect(result.campaigns[0]).toEqual(
      expect.objectContaining({
        id: "cmp_passenger_home_banner",
        template: "home_banner_card",
        content: expect.objectContaining({
          imageUrl: "https://cdn.leaf.test/banner-rio.webp",
          imageAlt: "Banner Rio",
          displayMode: "image_only",
          hideTextOverlay: true,
        }),
        rules: expect.objectContaining({
          autoRotateSeconds: 6,
          rotationWeight: 1,
        }),
      }),
    );
  });

  it("keeps asset-only campaigns eligible for map marker overrides", async () => {
    const result = await refreshEligibleCampaigns({
      userId: "driver_1",
      role: "driver",
      surface: "ride_map",
      placement: "vehicle_marker",
      limit: 1,
    });

    expect(result.campaigns).toHaveLength(1);
    expect(result.campaigns[0]).toEqual(
      expect.objectContaining({
        id: "cmp_ride_map_vehicle_marker",
        template: "map_vehicle_marker",
        content: expect.objectContaining({
          title: "",
          imageUrl: "https://cdn.leaf.test/map-car-marker.webp",
          displayMode: "image_only",
        }),
      }),
    );
  });

  it("normalizes full-art campaigns without app text overlay", () => {
    const campaign = normalizeCampaign({
      id: "cmp_full_art",
      content: {
        title: "Bem-vindo à Leaf",
        imageUrl: "https://cdn.leaf.test/full-art.webp",
        hideTextOverlay: true,
      },
    });

    expect(campaign.content).toEqual(
      expect.objectContaining({
        displayMode: "image_only",
        hideTextOverlay: true,
      }),
    );
  });
});
