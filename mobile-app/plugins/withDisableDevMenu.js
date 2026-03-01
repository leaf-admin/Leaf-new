const { withAndroidManifest } = require('@expo/config-plugins');

const withDisableDevMenu = (config) => {
  return withAndroidManifest(config, (config) => {
    const androidManifest = config.modResults;
    
    const application = androidManifest.manifest.application?.[0];
    if (!application) {
      return config;
    }
    
    if (!application['meta-data']) {
      application['meta-data'] = [];
    }
    
    const existingMetaData = application['meta-data'].find(
      (meta) => meta.$ && meta.$['android:name'] === 'expo.modules.devmenu.enabled'
    );
    
    if (!existingMetaData) {
      application['meta-data'].push({
        $: {
          'android:name': 'expo.modules.devmenu.enabled',
          'android:value': 'false'
        }
      });
    }
    
    return config;
  });
};

module.exports = withDisableDevMenu;

