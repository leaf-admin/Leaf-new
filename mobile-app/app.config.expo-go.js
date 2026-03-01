export default {
    name: "Leaf App",
    slug: "leaf-app",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/images/logo1024x1024.png",
    userInterfaceStyle: "light",
    splash: {
        image: "./assets/images/splash.png",
        resizeMode: "cover",
        backgroundColor: "#1A330E"
    },
    assetBundlePatterns: [
        "**/*"
    ],
    ios: {
        supportsTablet: true
    },
    android: {
        adaptiveIcon: {
            foregroundImage: "./assets/images/logo1024x1024.png",
            backgroundColor: "#1A330E"
        }
    },
    web: {
        favicon: "./assets/images/logo1024x1024.png"
    },
    plugins: [
        "expo-font",
        "expo-asset"
    ]
}
