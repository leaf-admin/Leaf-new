export async function resolveDriverOnlineLocationSeed({
  getCachedSeed,
  refreshCurrentLocation,
  onAsyncRefreshError,
  preferFresh = false,
}) {
  const cachedSeed =
    typeof getCachedSeed === "function" ? getCachedSeed() : null;

  if (preferFresh && typeof refreshCurrentLocation === "function") {
    try {
      await refreshCurrentLocation();
      const refreshedSeed =
        typeof getCachedSeed === "function" ? getCachedSeed() : null;
      if (refreshedSeed) {
        return {
          statusLocationSeed: refreshedSeed,
          seedSource: "fresh_current_position",
        };
      }
    } catch (error) {
      if (typeof onAsyncRefreshError === "function") {
        onAsyncRefreshError(error);
      }
    }
  }

  if (cachedSeed) {
    Promise.resolve()
      .then(() =>
        typeof refreshCurrentLocation === "function"
          ? refreshCurrentLocation()
          : null,
      )
      .catch((error) => {
        if (typeof onAsyncRefreshError === "function") {
          onAsyncRefreshError(error);
        }
      });

    return {
      statusLocationSeed: cachedSeed,
      seedSource: "cached_runtime_coordinate",
    };
  }

  if (typeof refreshCurrentLocation === "function") {
    await refreshCurrentLocation();
  }

  return {
    statusLocationSeed:
      typeof getCachedSeed === "function" ? getCachedSeed() : null,
    seedSource: "fresh_current_position",
  };
}
