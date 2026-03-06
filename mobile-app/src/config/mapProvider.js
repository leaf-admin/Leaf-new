const MAP_PROVIDER_CONFIG = {
  defaultProvider: "google",
  enableOsmTiles: false,
  enableOsmApiFallback: false,
};

const isGooglePrimary = MAP_PROVIDER_CONFIG.defaultProvider === "google";

module.exports = {
  MAP_PROVIDER_CONFIG,
  isGooglePrimary,
};
