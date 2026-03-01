export default {
  name: "Leaf App",
  slug: "leafapp-reactnative",
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/images/logo1024x1024.png",
  userInterfaceStyle: "light",
  splash: {
    image: "./assets/images/splash.png",
    resizeMode: "contain",
    backgroundColor: "#ffffff"
  },
  assetBundlePatterns: [
    "**/*"
  ],
  ios: {
    supportsTablet: true,
    bundleIdentifier: "br.com.leaf.ride",
    buildNumber: "1"
  },
  android: {
    package: "br.com.leaf.ride",
    versionCode: 1,
    adaptiveIcon: {
      foregroundImage: "./assets/images/logo1024x1024.png",
      backgroundColor: "#ffffff"
    },
    permissions: [
      "ACCESS_FINE_LOCATION",
      "ACCESS_COARSE_LOCATION",
      "CAMERA",
      "READ_EXTERNAL_STORAGE",
      "READ_MEDIA_IMAGES",
      "READ_MEDIA_VIDEO"
    ]
  },
  extra: {
    eas: {
      projectId: "91dfdce0-9705-4fde-8417-747273ab7cc2"
    }
  },
  plugins: [
    "expo-font",
    "expo-localization"
  ]
};




