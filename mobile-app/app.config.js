const { loadConfigEnv } = require('./config/loadConfigEnv');
loadConfigEnv();

const AppConfig = require('./config/AppConfig').AppConfig;
const GoogleMapApiConfig = require('./config/GoogleMapApiConfig').GoogleMapApiConfig;
const fs = require('fs');
const path = require('path');
const TRUTHY_VALUES = new Set(['1', 'true', 'yes', 'on']);
const allowInsecureHttp = String(process.env.EXPO_PUBLIC_ALLOW_INSECURE_HTTP || 'false').toLowerCase() === 'true';
const disableUpdatesForLocalSimulator =
    String(process.env.LEAF_DISABLE_UPDATES_FOR_SIMULATOR || 'false').toLowerCase() === 'true';
const normalizeFlag = (value, defaultValue = false) => {
    if (value === undefined || value === null || value === '') {
        return defaultValue;
    }

    return TRUTHY_VALUES.has(String(value).trim().toLowerCase());
};
const firstDefined = (...values) => values.find(value => value !== undefined && value !== null && value !== '');
const resolveNumber = (value, defaultValue) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : defaultValue;
};
const resolveLaunchProfile = () => {
    const rawProfile = firstDefined(
        process.env.EXPO_PUBLIC_LEAF_LAUNCH_PROFILE,
        process.env.LEAF_LAUNCH_PROFILE
    );

    const normalized = String(rawProfile || 'full')
        .trim()
        .toLowerCase();

    if (['pilot', 'pilot_controlled', 'controlled_pilot'].includes(normalized)) {
        return 'pilot_controlled';
    }

    return normalized || 'full';
};
const launchProfile = resolveLaunchProfile();
const otaUpdatesEnabled = normalizeFlag(
    firstDefined(process.env.LEAF_ENABLE_OTA_UPDATES, process.env.EXPO_PUBLIC_LEAF_ENABLE_OTA_UPDATES),
    true
);
const buildProfile = String(firstDefined(process.env.EAS_BUILD_PROFILE, process.env.LEAF_BUILD_PROFILE, '') || '')
    .trim()
    .toLowerCase();
const updatesChannel = String(
    firstDefined(
        process.env.EXPO_UPDATE_CHANNEL,
        process.env.EAS_UPDATE_CHANNEL,
        process.env.LEAF_UPDATES_CHANNEL,
        buildProfile === 'release-test' ? 'production' : '',
        buildProfile.includes('production') ? 'production' : '',
        buildProfile.includes('preview') ? 'preview' : ''
    ) || ''
).trim();
const includeDevClient = normalizeFlag(
    firstDefined(process.env.LEAF_INCLUDE_DEV_CLIENT, process.env.EXPO_PUBLIC_LEAF_INCLUDE_DEV_CLIENT),
    buildProfile.includes('development')
);
const productionAutolinkingExcludes = includeDevClient
    ? []
    : [
        'expo-dev-client',
        'expo-dev-launcher',
        'expo-dev-menu',
        'expo-dev-menu-interface'
    ];
const canonicalInterFonts = [
    '../node_modules/@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf',
    '../node_modules/@expo-google-fonts/inter/500Medium/Inter_500Medium.ttf',
    '../node_modules/@expo-google-fonts/inter/600SemiBold/Inter_600SemiBold.ttf',
    '../node_modules/@expo-google-fonts/inter/700Bold/Inter_700Bold.ttf',
    '../node_modules/@expo-google-fonts/inter/300Light/Inter_300Light.ttf'
];
const expoUpdatesConfig = disableUpdatesForLocalSimulator || !otaUpdatesEnabled
    ? {
        enabled: false,
        checkAutomatically: 'NEVER',
        fallbackToCacheTimeout: 0
    }
    : {
        fallbackToCacheTimeout: 0,
        url: "https://u.expo.dev/" + AppConfig.expo_project_id,
        requestHeaders: updatesChannel
            ? {
                'expo-channel-name': updatesChannel
            }
            : undefined,
    };
const pilotControlled =
    launchProfile === 'pilot_controlled' ||
    normalizeFlag(firstDefined(process.env.EXPO_PUBLIC_PILOT_CONTROLLED, process.env.LEAF_PILOT_CONTROLLED), false);
const resolvePilotFeature = (publicKey, privateKey, enabledOutsidePilot = true) => {
    const fallback = pilotControlled ? false : enabledOutsidePilot;
    return normalizeFlag(firstDefined(process.env[publicKey], process.env[privateKey]), fallback);
};
const pilotFeatureFlags = {
    driverWithdrawalsEnabled: resolvePilotFeature('EXPO_PUBLIC_ENABLE_DRIVER_WITHDRAWALS', 'LEAF_ENABLE_DRIVER_WITHDRAWALS', false),
    referralProgramsEnabled: resolvePilotFeature('EXPO_PUBLIC_ENABLE_REFERRAL_PROGRAMS', 'LEAF_ENABLE_REFERRAL_PROGRAMS', true),
    leafDelasEnabled: resolvePilotFeature('EXPO_PUBLIC_ENABLE_LEAF_DELAS', 'LEAF_ENABLE_LEAF_DELAS', true),
    driverDestinationModeEnabled: resolvePilotFeature('EXPO_PUBLIC_ENABLE_DRIVER_DESTINATION_MODE', 'LEAF_ENABLE_DRIVER_DESTINATION_MODE', true),
    dynamicPricingEnabled: resolvePilotFeature('EXPO_PUBLIC_ENABLE_DYNAMIC_PRICING', 'LEAF_ENABLE_DYNAMIC_PRICING', true),
    smartPushEnabled: resolvePilotFeature('EXPO_PUBLIC_ENABLE_SMART_PUSH', 'LEAF_ENABLE_SMART_PUSH', false),
    softBanEnforcementEnabled: resolvePilotFeature('EXPO_PUBLIC_ENABLE_SOFT_BAN_ENFORCEMENT', 'LEAF_ENABLE_SOFT_BAN_ENFORCEMENT', true),
    adminMutationsEnabled: resolvePilotFeature('EXPO_PUBLIC_ENABLE_ADMIN_MUTATIONS', 'LEAF_ENABLE_ADMIN_MUTATIONS', true),
};
const prototypePlayback = {
    tickMs: resolveNumber(
        firstDefined(
            process.env.EXPO_PUBLIC_PROTOTYPE_ROUTE_PLAYBACK_TICK_MS,
            process.env.LEAF_PROTOTYPE_ROUTE_PLAYBACK_TICK_MS
        ),
        2500
    ),
    pickupSpeedMetersPerSecond: resolveNumber(
        firstDefined(
            process.env.EXPO_PUBLIC_PROTOTYPE_PICKUP_SPEED_MPS,
            process.env.LEAF_PROTOTYPE_PICKUP_SPEED_MPS
        ),
        8
    ),
    tripSpeedMetersPerSecond: resolveNumber(
        firstDefined(
            process.env.EXPO_PUBLIC_PROTOTYPE_TRIP_SPEED_MPS,
            process.env.LEAF_PROTOTYPE_TRIP_SPEED_MPS
        ),
        10
    ),
    qaMultiplier: resolveNumber(
        firstDefined(
            process.env.EXPO_PUBLIC_PROTOTYPE_ROUTE_PLAYBACK_QA_MULTIPLIER,
            process.env.LEAF_PROTOTYPE_ROUTE_PLAYBACK_QA_MULTIPLIER
        ),
        1.75
    ),
};
const iosTransportSecurity = allowInsecureHttp
    ? {
        NSAllowsArbitraryLoads: true,
        NSAllowsLocalNetworking: true,
        NSExceptionDomains: {
            "api.leaf.app.br": {
                NSExceptionAllowsInsecureHTTPLoads: true,
                NSIncludesSubdomains: true
            }
        }
    }
    : {
        NSAllowsArbitraryLoads: false,
        NSAllowsLocalNetworking: false
    };

const resolveIosFirebaseUrlScheme = () => {
    const googleServicesPath = process.env.GOOGLE_SERVICES_INFO_PLIST || './GoogleService-Info.plist';
    try {
        const plist = fs.readFileSync(googleServicesPath, 'utf8');
        const match = plist.match(/<key>GOOGLE_APP_ID<\/key>\s*<string>([^<]+)<\/string>/);
        const googleAppId = match?.[1]?.trim();
        return googleAppId ? `app-${googleAppId.replace(/:/g, '-')}` : 'app-1-106504629884-ios-a1a7afe5fbe33c4aa1a3f9';
    } catch (_error) {
        return 'app-1-106504629884-ios-a1a7afe5fbe33c4aa1a3f9';
    }
};

const iosFirebaseUrlScheme = resolveIosFirebaseUrlScheme();

module.exports = {
    name: AppConfig.app_name,
    description: AppConfig.app_description,
    owner: "leaf-app",
    slug: "leafapp-reactnative",
    runtimeVersion: AppConfig.ios_app_version,
    scheme: "leafapp",
    autolinking: productionAutolinkingExcludes.length
        ? {
            exclude: productionAutolinkingExcludes
        }
        : undefined,
    platforms: [
        "ios",
        "android"
    ],
    orientation: "portrait",
    version: AppConfig.ios_app_version,
    icon: "./assets/images/logo1024x1024.png",
    splash: {
        image: "./assets/images/splash.png",
        resizeMode: "contain",
        backgroundColor: "#003002"
    },
    updates: expoUpdatesConfig,
    extra: {
        eas: {
          projectId: AppConfig.expo_project_id
        },
        privacyPolicyUrl: AppConfig.privacy_policy_url,
        termsOfServiceUrl: AppConfig.terms_of_service_url,
        refundPolicyUrl: AppConfig.refund_policy_url,
        accountDeletionUrl: AppConfig.account_deletion_url,
        supportEmail: AppConfig.support_email,
        isReview: process.env.APP_REVIEW === 'true',
        e2eTest: process.env.EXPO_PUBLIC_E2E_TEST === 'true' || process.env.EXPO_PUBLIC_E2E_TEST === '1',
        forcePaymentBypass:
            process.env.EXPO_PUBLIC_FORCE_PAYMENT_BYPASS === 'true' ||
            process.env.EXPO_PUBLIC_FORCE_PAYMENT_BYPASS === '1' ||
            process.env.EXPO_PUBLIC_BYPASS_PAYMENTS === 'true' ||
            process.env.EXPO_PUBLIC_BYPASS_PAYMENTS === '1',
        enableTestUserTools:
            process.env.EXPO_PUBLIC_ENABLE_TEST_USER_TOOLS === 'true' ||
            process.env.EXPO_PUBLIC_ENABLE_TEST_USER_TOOLS === '1',
        allowClientDirectGoogleFallback:
            process.env.EXPO_PUBLIC_ALLOW_CLIENT_DIRECT_GOOGLE_FALLBACK === 'true' ||
            process.env.EXPO_PUBLIC_ALLOW_CLIENT_DIRECT_GOOGLE_FALLBACK === '1',
        launchProfile,
        pilotControlled,
        pilotFeatureFlags,
        prototypePlayback
    },
    assetBundlePatterns: [
        "**/*"
    ],
    packagerOpts: {
        config: "metro.config.js"
    },
    android: {
        package: "br.com.leaf.ride",
        versionCode: AppConfig.android_app_version,
        googleServicesFile: process.env.GOOGLE_SERVICES_JSON || (fs.existsSync("./google-services.json") ? "./google-services.json" : undefined),
        permissions: [
            "ACCESS_COARSE_LOCATION",
            "ACCESS_FINE_LOCATION",
            "ACCESS_BACKGROUND_LOCATION",
            "FOREGROUND_SERVICE",
            "FOREGROUND_SERVICE_LOCATION",
            "CAMERA",
            "RECORD_AUDIO",
            "INTERNET",
            "POST_NOTIFICATIONS",
            "VIBRATE"
        ],
        blockedPermissions: [
            "android.permission.SYSTEM_ALERT_WINDOW",
            "android.permission.READ_EXTERNAL_STORAGE",
            "android.permission.WRITE_EXTERNAL_STORAGE",
            "android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK"
        ],
        icon: "./assets/images/android-icon.png",
        adaptiveIcon: {
            foregroundImage: "./assets/images/android-adaptive-foreground.png",
            backgroundColor: "#002C00"
        },
        jsEngine: "hermes",
        intentFilters: [
            {
                action: "VIEW",
                data: {
                    scheme: "br.com.leaf.ride"
                },
                category: ["BROWSABLE", "DEFAULT"]
            },
            {
                action: "VIEW",
                autoVerify: true,
                data: [
                    { scheme: "https", host: "leaf.app.br", pathPrefix: "/convite" },
                    { scheme: "https", host: "www.leaf.app.br", pathPrefix: "/convite" },
                    { scheme: "https", host: "leaf.app.br", pathPrefix: "/motorista/convite" },
                    { scheme: "https", host: "www.leaf.app.br", pathPrefix: "/motorista/convite" },
                    { scheme: "https", host: "leaf.app.br", pathPrefix: "/viagem" },
                    { scheme: "https", host: "www.leaf.app.br", pathPrefix: "/viagem" }
                ],
                category: ["BROWSABLE", "DEFAULT"]
            }
        ],
        config: {
            googleMaps: {
                apiKey: GoogleMapApiConfig.android
            }
        }
    },
    ios: {
        bundleIdentifier: "br.com.leaf.ride",
        jsEngine: "hermes",
        associatedDomains: [
            "applinks:leaf.app.br",
            "applinks:www.leaf.app.br"
        ],
        config: {
            googleMapsApiKey: GoogleMapApiConfig.ios
        },
        googleServicesFile: process.env.GOOGLE_SERVICES_INFO_PLIST || (fs.existsSync("./GoogleService-Info.plist") ? "./GoogleService-Info.plist" : undefined),
        icon: "./assets/images/logo1024x1024.png",
        buildNumber: AppConfig.ios_build_number,
        deploymentTarget: "17.0",
        infoPlist: {
            ITSAppUsesNonExemptEncryption: false,
            CFBundleURLTypes: [
                {
                    CFBundleURLSchemes: ["leafapp", "br.com.leaf.ride"]
                },
                {
                    CFBundleURLSchemes: ["com.googleusercontent.apps.106504629884-laja6e1vn4utkn93ftd99p42mu8qus9s"]
                },
                {
                    CFBundleURLSchemes: ["exp+leafapp-reactnative"]
                },
                {
                    CFBundleURLSchemes: [iosFirebaseUrlScheme]
                }
            ],
            UIRequiresFullScreen: true,
            UISupportedInterfaceOrientations: ["UIInterfaceOrientationPortrait"],
            "UISupportedInterfaceOrientations~ipad": ["UIInterfaceOrientationPortrait"],
            NSAppTransportSecurity: iosTransportSecurity,
            UIBackgroundModes: ["fetch", "location", "remote-notification"],
            NSMicrophoneUsageDescription: "A Leaf usa o microfone para capturar o destino por voz quando você tocar no ícone de microfone.",
            NSSpeechRecognitionUsageDescription: "A Leaf converte sua fala em texto para preencher o destino com mais rapidez."
        }
    },
    plugins: [
        "expo-asset",
        [
            "expo-splash-screen",
            {
                android: {
                    image: "./assets/images/splash_android_icon.png",
                    resizeMode: "contain",
                    backgroundColor: "#003002",
                    imageWidth: 288
                }
            }
        ],
        [
            "expo-font",
            {
                fonts: canonicalInterFonts
            }
        ],
        [
            "expo-audio",
            {
                "microphonePermission": false,
                "recordAudioAndroid": false,
                "enableBackgroundRecording": false
            }
        ],
        [
            "expo-speech-recognition",
            {
                "microphonePermission": "A Leaf usa o microfone para capturar o destino por voz quando você tocar no ícone de microfone.",
                "speechRecognitionPermission": "A Leaf converte sua fala em texto para preencher o destino com mais rapidez.",
                "androidSpeechServicePackages": ["com.google.android.googlequicksearchbox"]
            }
        ],
        "expo-apple-authentication",
        "expo-localization",
        "@react-native-firebase/app",
        "@react-native-firebase/auth",
        "./plugins/withGoogleMapsApiKey",
        "./plugins/withDisableDevMenu",
        "./plugins/withDevLauncherPortScanFix",
        "./plugins/withGradleNodeFix",
        "./plugins/withExpoModulesCoreFix",
        "./plugins/withNetworkSecurityConfig",
        "./plugins/withLeafAwsLiveness",
        "./plugins/withLeafFaceEmbedding",
        "./plugins/withLeafRideNotification",
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
              "android": {
                "compileSdkVersion": 36,
                "targetSdkVersion": 36
              },
              "ios": {
                "useFrameworks": "static",
                "deploymentTarget": "17.0"
              },
            }
        ],
        "./plugins/withBoringSSLFix",
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
