const AppConfig = require('./config/AppConfig').AppConfig;
const GoogleMapApiConfig = require('./config/GoogleMapApiConfig').GoogleMapApiConfig;

module.exports = {
    name: AppConfig.app_name,
    description: AppConfig.app_description,
    owner: "leaf-app",
    slug: "leafapp-reactnative",
    privacy: "public",
    runtimeVersion: AppConfig.ios_app_version,
    scheme: "leafapp",
    android: {
        ...this.android,
        intentFilters: [{
            action: "VIEW",
            data: {
                scheme: "br.com.leaf.ride"
            },
            category: ["BROWSABLE", "DEFAULT"]
        }]
    },
    platforms: [
        "ios",
        "android"
    ],
    version: AppConfig.ios_app_version,
    splash: {
        image: "./assets/images/splash.png",
        resizeMode: "cover",
        backgroundColor: "#003002"
    },
    updates: {
        "fallbackToCacheTimeout": 0,
        "url": "https://u.expo.dev/" + AppConfig.expo_project_id,
    },
    extra: {
        eas: {
          projectId: AppConfig.expo_project_id
        },
        privacyPolicyUrl: AppConfig.privacy_policy_url,
        termsOfServiceUrl: AppConfig.terms_of_service_url,
        supportEmail: AppConfig.support_email,
        isReview: process.env.APP_REVIEW === 'true'
    },
    assetBundlePatterns: [
        "**/*"
    ],
    packagerOpts: {
        config: "metro.config.js"
    },
    android: {
        package: "br.com.leaf.ride",
        googleServicesFile: "./google-services.json",
        icon: "./assets/icon.png",
        adaptiveIcon: {
            foregroundImage: "./assets/adaptive-icon.png",
            backgroundColor: "#1A330E"
        },
        jsEngine: "hermes",
        config: {
            googleMaps: {
                apiKey: GoogleMapApiConfig.android
            }
        }
    },
    android: {
        package: "br.com.leaf.ride",
        googleServicesFile: "./google-services.json",
        icon: "./assets/icon.png",
        adaptiveIcon: {
            foregroundImage: "./assets/adaptive-icon.png",
            backgroundColor: "#1A330E"
        },
        jsEngine: "hermes"
    },
    ios: {
        bundleIdentifier: "br.com.leaf.ride",
        googleServicesFile: "./GoogleService-Info.plist",
        icon: "./assets/icon.png"
    },
    plugins: [
        "expo-asset",
        "expo-font",
        "expo-apple-authentication",
        "expo-localization",
        "@react-native-firebase/app",
        "@react-native-firebase/auth",
        "./plugins/withGoogleMapsApiKey",
        "./plugins/withDisableDevMenu",
        "./plugins/withNetworkSecurityConfig",
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
            "expo-build-properties",
            {
              "ios": {
                "useFrameworks": "static"
              },
            }
        ],
        [
            "expo-image-picker",
            {
              "photosPermission": "A Leaf utiliza sua galeria de fotos para fazer upload da sua foto de perfil e documentos de verificação.",
              "cameraPermission": "A Leaf utiliza a câmera para tirar sua foto de perfil e verificar sua identidade."
            }
        ],
        [
            "expo-location",
            {
                "locationAlwaysAndWhenInUsePermission": "A Leaf utiliza sua localização em primeiro e segundo plano exclusivamente para motoristas receberem corridas, manter navegação ativa e acompanhar viagens em tempo real.",
                "locationAlwaysPermission": "A Leaf utiliza sua localização em segundo plano para permitir que motoristas recebam corridas e tenham a navegação ativa mesmo com o app minimizado, garantindo uma experiência contínua e segura.",
                "locationWhenInUsePermission": "A Leaf utiliza sua localização para encontrar motoristas próximos, calcular rotas e permitir o acompanhamento da corrida em tempo real, melhorando a experiência de uso e segurança.",
                "isIosBackgroundLocationEnabled": true,
                "isAndroidBackgroundLocationEnabled": true,
                "isAndroidForegroundServiceEnabled": true
            }
        ],
        "expo-screen-orientation"
    ]
}
