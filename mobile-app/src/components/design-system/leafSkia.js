import { Platform, TurboModuleRegistry } from 'react-native';

// Android-only Skia handle for the glass material and lens. iOS 26 uses the
// system Liquid Glass. Null when the binary was built without RNSkia, so old
// dev clients and tests keep the plain blur.
let Skia = null;
if (Platform.OS === 'android') {
  try {
    if (TurboModuleRegistry.get?.('RNSkiaModule')) {
      Skia = require('@shopify/react-native-skia');
    }
  } catch (_error) {
    Skia = null;
  }
}

export default Skia;
