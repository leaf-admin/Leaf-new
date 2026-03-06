const { withAndroidManifest } = require('@expo/config-plugins');

const withGoogleMapsApiKey = (config) => {
  const mapsApiKey =
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ||
    'AIzaSyBLwKg0KRiLVjAHVBQAUP7pB3Q80G246KY';

  return withAndroidManifest(config, (config) => {
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
    
    return config;
  });
};

module.exports = withGoogleMapsApiKey;
