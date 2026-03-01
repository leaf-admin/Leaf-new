export default {
    name: "Leaf App",
    description: "Leaf - Transporte Inteligente",
    owner: "leaf-app",
    slug: "leafapp-reactnative",
    scheme: "leafapp-reactnative",
    privacy: "public",
    runtimeVersion: "1.0.0",
    platforms: [
        "ios",
        "android"
    ],
    androidStatusBar: {
        hidden: true,
        translucent: true
    },
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/images/logo1024x1024.png",
    splash: {
        "image": "./assets/images/splash.png",
        "resizeMode":'cover',
        "backgroundColor": "#ffffff"
    },
    updates: {
        "fallbackToCacheTimeout": 0,
        "url": "https://u.expo.dev/leafapp-reactnative",
    },
    extra: {
        eas: {
          projectId: "leafapp-reactnative"
        }
    },
    assetBundlePatterns: [
        "**/*"
    ],
    packagerOpts: {
        config: "metro.config.js"
    },
    ios: {
        splash: {
            image: "./assets/images/splash_ios.png",
            resizeMode: "cover",
            backgroundColor: "#ffffff",
          },
        supportsTablet: true,
        usesAppleSignIn: true,
        bundleIdentifier: "br.com.leaf.ride",
        infoPlist: {
            "NSLocationAlwaysUsageDescription": "This app uses the always location access in the background for improved pickups and dropoffs, customer support and safety purpose.",
            "NSLocationAlwaysAndWhenInUseUsageDescription": "This app uses the always location access in the background for improved pickups and dropoffs, customer support and safety purpose.",
            "NSLocationWhenInUseUsageDescription": "For a reliable ride, App collects location data from the time you open the app until a trip ends. This improves pickups, support, and more.",
            "NSCameraUsageDescription": "This app uses the camera to take your profile picture.",
            "NSPhotoLibraryUsageDescription": "This app uses Photo Library for uploading your profile picture.",
            "ITSAppUsesNonExemptEncryption":false,
            "UIBackgroundModes": [
                "location",
                "fetch",
                "remote-notification",
                "audio"
            ]
        },
        buildNumber: "1"
    },
    android: {
        package: "br.com.leaf.ride",
        versionCode: 1,
        permissions: [
            "CAMERA",
            "READ_EXTERNAL_STORAGE",
            "WRITE_EXTERNAL_STORAGE",
            "ACCESS_FINE_LOCATION",
            "ACCESS_COARSE_LOCATION",
            "CAMERA_ROLL",
            "FOREGROUND_SERVICE",
            "FOREGROUND_SERVICE_LOCATION",
            "ACCESS_BACKGROUND_LOCATION",
            "SCHEDULE_EXACT_ALARM",
            "RECEIVE_SMS",
            "READ_SMS"
        ],
        blockedPermissions:["com.google.android.gms.permission.AD_ID"],
        googleServicesFile: "./google-services.json"
    },
    plugins: [
        "expo-asset",
        "expo-font",
        "expo-apple-authentication",
        "expo-localization",
        "@react-native-firebase/app", 
        "@react-native-firebase/auth",
        [
            "expo-notifications",
            {
                sounds: [
                    "./assets/sounds/horn.wav",
                    "./assets/sounds/repeat.wav"
                ]
            }
        ],
        [
            "expo-image-picker",
            {
              "photosPermission": "This app uses Photo Library for uploading your profile picture.",
              "cameraPermission": "This app uses the camera to take your profile picture."
            }
        ],
        [
            "expo-location",
            {
                "locationAlwaysAndWhenInUsePermission": "This app uses the always location access in the background for improved pickups and dropoffs, customer support and safety purpose.",
                "locationAlwaysPermission": "This app uses the always location access in the background for improved pickups and dropoffs, customer support and safety purpose.",
                "locationWhenInUsePermission": "For a reliable ride, App collects location data from the time you open the app until a trip ends. This improves pickups, support, and more.",
                "isIosBackgroundLocationEnabled": true,
                "isAndroidBackgroundLocationEnabled": true,
                "isAndroidForegroundServiceEnabled": true
            }
        ]
    ]
} 