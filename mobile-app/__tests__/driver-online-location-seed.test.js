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

  it("can prefer a fresh location over cached runtime coordinates", async () => {
    const cachedSeed = { lat: 39.237255, lng: -123.150032, heading: 0, speed: 0 };
    const refreshedSeed = { lat: -22.971177, lng: -43.182543, heading: 8, speed: 0 };
    let currentSeed = cachedSeed;
    const refreshCurrentLocation = jest.fn(async () => {
      currentSeed = refreshedSeed;
    });

    await expect(
      resolveDriverOnlineLocationSeed({
        getCachedSeed: () => currentSeed,
        refreshCurrentLocation,
        preferFresh: true,
      }),
    ).resolves.toEqual({
      statusLocationSeed: refreshedSeed,
      seedSource: "fresh_current_position",
    });
    expect(refreshCurrentLocation).toHaveBeenCalledTimes(1);
  });
});
