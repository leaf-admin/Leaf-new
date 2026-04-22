import { resolveDriverOnlineLocationSeed } from "../src/screens/prototype/driverOnlineLocationSeed";

describe("resolveDriverOnlineLocationSeed", () => {
  it("returns immediately with cached runtime coordinates and refreshes in background", async () => {
    const cachedSeed = { lat: -23.55, lng: -46.63, heading: 0, speed: 0 };
    let releaseRefresh;
    const refreshCurrentLocation = jest.fn(
      () =>
        new Promise((resolve) => {
          releaseRefresh = resolve;
        }),
    );

    const resultPromise = resolveDriverOnlineLocationSeed({
      getCachedSeed: () => cachedSeed,
      refreshCurrentLocation,
    });

    await expect(resultPromise).resolves.toEqual({
      statusLocationSeed: cachedSeed,
      seedSource: "cached_runtime_coordinate",
    });
    expect(refreshCurrentLocation).toHaveBeenCalledTimes(1);

    releaseRefresh();
  });

  it("awaits a fresh location fetch when no cached coordinate exists", async () => {
    const refreshedSeed = {
      lat: 37.7749,
      lng: -122.4194,
      heading: 12,
      speed: 0,
    };
    let cachedSeed = null;
    const refreshCurrentLocation = jest.fn(async () => {
      cachedSeed = refreshedSeed;
    });

    await expect(
      resolveDriverOnlineLocationSeed({
        getCachedSeed: () => cachedSeed,
        refreshCurrentLocation,
      }),
    ).resolves.toEqual({
      statusLocationSeed: refreshedSeed,
      seedSource: "fresh_current_position",
    });
    expect(refreshCurrentLocation).toHaveBeenCalledTimes(1);
  });
});
