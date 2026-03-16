const key =
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ||
    '';

module.exports.GoogleMapApiConfig = {
    ios: key,
    android: key
};
