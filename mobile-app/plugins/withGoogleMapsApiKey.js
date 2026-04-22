const { withAndroidManifest, withInfoPlist } = require('@expo/config-plugins');
const { loadConfigEnv } = require('../config/loadConfigEnv');

loadConfigEnv();

const withGoogleMapsApiKey = (config) => {
  const mapsApiKey =
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ||
    '';
  const allowInsecureHttp =
    String(process.env.EXPO_PUBLIC_ALLOW_INSECURE_HTTP || 'false').toLowerCase() === 'true';

  config = withAndroidManifest(config, (config) => {
    const androidManifest = config.modResults;
    
    // Encontrar ou criar o elemento <application>
    let application = androidManifest.manifest.application?.[0];
    if (!application) {
      application = {
        $: {},
        'meta-data': []
      };
      androidManifest.manifest.application = [application];
    }
    
    // Garantir que meta-data seja um array
    if (!application['meta-data']) {
      application['meta-data'] = [];
    }
    
    // Verificar se a API key já existe
    const existingApiKey = application['meta-data'].find(
      meta => meta.$['android:name'] === 'com.google.android.geo.API_KEY'
    );
    
    if (!existingApiKey) {
      // Adicionar a API key do Google Maps
      application['meta-data'].push({
        $: {
          'android:name': 'com.google.android.geo.API_KEY',
          'android:value': mapsApiKey
        }
      });
      
      console.log('✅ Google Maps API Key adicionada ao AndroidManifest.xml');
    } else {
      existingApiKey.$['android:value'] = mapsApiKey;
      console.log('✅ Google Maps API Key já existe no AndroidManifest.xml');
    }
    if (!mapsApiKey) {
      console.warn('⚠️ Google Maps API Key ausente durante prebuild (AndroidManifest ficará sem chave).');
    }

    return config;
  });

  config = withInfoPlist(config, (config) => {
    config.modResults.GMSApiKey = mapsApiKey;
    config.modResults.GOOGLE_MAPS_API_KEY = mapsApiKey;
    const currentAts = config.modResults.NSAppTransportSecurity || {};
    const currentExceptionDomains = currentAts.NSExceptionDomains || {};
    config.modResults.NSAppTransportSecurity = {
        ...currentAts,
        NSAllowsArbitraryLoads: allowInsecureHttp,
        NSAllowsLocalNetworking: true,
        NSExceptionDomains: {
          ...currentExceptionDomains,
        '62.169.31.231': {
          ...(currentExceptionDomains['62.169.31.231'] || {}),
          NSExceptionAllowsInsecureHTTPLoads: true,
          NSIncludesSubdomains: true
        }
      }
    };

    if (!mapsApiKey) {
      console.warn('⚠️ Google Maps API Key ausente durante prebuild (Info.plist ficará sem chave).');
    } else {
      console.log('✅ Google Maps API Key adicionada ao Info.plist (iOS)');
    }

    return config;
  });

  return config;
};

module.exports = withGoogleMapsApiKey;
