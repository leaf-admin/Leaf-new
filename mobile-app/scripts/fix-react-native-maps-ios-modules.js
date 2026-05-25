const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const mapsRoot = path.resolve(projectRoot, '..', 'node_modules', 'react-native-maps', 'ios', 'AirGoogleMaps');

const targetFiles = [
  'AIRGoogleMapCalloutManager.h',
  'AIRGoogleMapCalloutSubviewManager.h',
  'AIRGoogleMapCircleManager.h',
  'AIRGoogleMapHeatmapManager.h',
  'AIRGoogleMapManager.h',
  'AIRGoogleMapMarkerManager.h',
  'AIRGoogleMapOverlayManager.h',
  'AIRGoogleMapPolygonManager.h',
  'AIRGoogleMapPolylineManager.h',
  'AIRGoogleMapUrlTileManager.h',
  'AIRGoogleMapWMSTileManager.h',
];

const legacyImportBlock = /#if __has_include\(<react_native_maps\/AIRMapCalloutManager\.h>\)\s*#import <react_native_maps\/AIRMapCalloutManager\.h>\s*#else\s*#import <React\/RCTViewManager\.h>\s*#endif/gm;

function patchHeader(filePath) {
  const original = fs.readFileSync(filePath, 'utf8');
  const patched = original.replace(legacyImportBlock, '#import <React/RCTViewManager.h>');

  if (patched !== original) {
    fs.writeFileSync(filePath, patched);
    return true;
  }

  return false;
}

function main() {
  if (!fs.existsSync(mapsRoot)) {
    console.log('[fix-react-native-maps-ios-modules] react-native-maps not found, skipping');
    return;
  }

  let patchedCount = 0;

  for (const fileName of targetFiles) {
    const filePath = path.join(mapsRoot, fileName);
    if (!fs.existsSync(filePath)) {
      continue;
    }

    if (patchHeader(filePath)) {
      patchedCount += 1;
    }
  }

  console.log(`[fix-react-native-maps-ios-modules] patched ${patchedCount} header(s)`);
}

main();
