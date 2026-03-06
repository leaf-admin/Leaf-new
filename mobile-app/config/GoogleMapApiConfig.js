const key =
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ||
    'AIzaSyBLwKg0KRiLVjAHVBQAUP7pB3Q80G246KY';

module.exports.GoogleMapApiConfig = {
    ios: key,
    android: key
};
