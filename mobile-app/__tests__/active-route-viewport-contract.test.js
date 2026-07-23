const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');

function readMobileSource(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function listJavaScriptFiles(relativeDir) {
  const absoluteDir = path.join(repoRoot, relativeDir);
  return fs.readdirSync(absoluteDir, { withFileTypes: true }).flatMap((entry) => {
    const childRelativePath = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      return listJavaScriptFiles(childRelativePath);
    }
    return entry.isFile() && /\.jsx?$/.test(entry.name) ? [childRelativePath] : [];
  });
}

const DIRECT_ROUTE_MAP_RENDERER_ALLOWLIST = [
  'src/components/TaxiModal.js',
  'src/components/ridelist.js',
  'src/components/prototype/PrototypeMapLayer.js',
  'src/screens/BookedCabScreen.js',
  'src/screens/DriverTrips.js',
  'src/screens/MapScreen.js',
  'src/screens/NewMapScreen.js',
  'src/screens/TripTrackingScreen.js',
  'src/screens/prototype/RobotaxiReceiptScreen.js',
].sort();

function isDirectRouteMapRenderer(source) {
  return (
    source.includes('react-native-maps') &&
    /<MapView\b/.test(source) &&
    /<Polyline\b/.test(source)
  );
}

function expectPrototypeMapLayerContract(source, {
  viewportPadding,
  routeViewportRegion,
  forceRegionUpdate,
  interactionEnabled = null,
}) {
  expect(source).toContain('<PrototypeMapLayer');
  expect(source).toContain(`viewportPadding={${viewportPadding}}`);
  expect(source).toContain(`routeViewportRegion={${routeViewportRegion}}`);
  expect(source).toContain('forceRegionUpdate');

  if (interactionEnabled === true) {
    expect(source).toMatch(/\n\s+interactionEnabled\n/);
  } else if (interactionEnabled) {
    const normalizeJsxWhitespace = value => value
      .replace(/\s+/g, ' ')
      .replace(/\{\s+/g, '{')
      .replace(/\s+\}/g, '}');
    const normalizedSource = normalizeJsxWhitespace(source);
    const normalizedContract = normalizeJsxWhitespace(
      `interactionEnabled={${interactionEnabled}}`,
    );
    expect(normalizedSource).toContain(normalizedContract);
  }
}

describe('active route viewport contract', () => {
  it('keeps active passenger trip routes fitted to the visible map frame', () => {
    const source = readMobileSource('src/screens/prototype/RobotaxiTripScreen.js');

    expect(source).toContain('buildVisibleRouteEdgePadding');
    expect(source).toContain('buildRouteViewportRegion');
    expect(source).toContain('tripMapActiveOcclusion');
    expectPrototypeMapLayerContract(source, {
      viewportPadding: 'tripMapViewportPadding',
      routeViewportRegion: 'tripVisibleRouteRegion',
      interactionEnabled: 'tripMapPresentation.interactionEnabled',
    });
  });

  it('keeps active driver trip routes fitted to the visible map frame', () => {
    const source = readMobileSource('src/screens/prototype/RobotaxiDriverTripScreen.js');

    expect(source).toContain('buildVisibleRouteEdgePadding');
    expect(source).toContain('buildRouteViewportRegion');
    expect(source).toContain('driverTripMapOcclusion');
    expectPrototypeMapLayerContract(source, {
      viewportPadding: 'driverTripViewportPadding',
      routeViewportRegion: 'driverTripVisibleRouteRegion',
      interactionEnabled:
        'isLifecycleNavigationLocked && driverTripMapPresentation.interactionEnabled',
    });
  });

  it('keeps paid driver offer routes fitted above the offer sheet', () => {
    const source = readMobileSource('src/screens/prototype/RobotaxiDriverOfferScreen.js');

    expect(source).toContain('buildVisibleRouteEdgePadding');
    expect(source).toContain('buildRouteViewportRegion');
    expect(source).toContain('offerMapOcclusion');
    expectPrototypeMapLayerContract(source, {
      viewportPadding: 'offerViewportPadding',
      routeViewportRegion: 'offerVisibleRouteRegion',
      interactionEnabled: 'offerMapPresentation.interactionEnabled',
    });
  });

  it('keeps active home-map ride routes fitted and manipulable above home chrome', () => {
    const source = readMobileSource('src/screens/prototype/RobotaxiHomeScreen.js');

    expect(source).toContain('buildVisibleRouteEdgePadding');
    expect(source).toContain('buildRouteViewportRegion');
    expect(source).toContain('isLiveTripMapInteractionAllowed');
    expect(source).toContain('homeMapInteractionEnabled');
    expect(source).toMatch(
      /const isLiveTripMapInteractionAllowed = Boolean\(\s*isScreenFocused &&\s*shouldRenderRuntimeMapState &&\s*isLiveTripMapActive\s*\);/
    );
    expect(source).toContain('const routeViewportLayoutKey = useMemo(() => {');
    expect(source).toContain('Math.round(Number(mapWidth || windowWidth) || 0)');
    expect(source).toContain('Math.round(Number(mapHeight || windowHeight) || 0)');
    expect(source).toContain('Math.round(routeViewportOcclusion.top)');
    expect(source).toContain('Math.round(routeViewportOcclusion.bottom)');
    expect(source).toContain('const routeViewportOcclusion = effectiveRouteOcclusion;');
    expect(source).toContain('PASSENGER_HOME_CARD_METRICS.categoryBottomOffset');
    expect(source).toContain('PREBOOKING_ROUTE_SHORT_DELTA_MULTIPLIER');
    expect(source).toContain('PREBOOKING_ROUTE_LONG_DELTA_MULTIPLIER');
    expect(source).not.toContain('PREBOOKING_ROUTE_BOTTOM_OCCLUSION_RELIEF');
    expect(source).not.toContain('PREBOOKING_ROUTE_VIEWPORT_DELTA_SCALE');
    expect(source).toContain('shouldRevealNavigationRoute');
    expect(source).toContain("appendPrototypeRuntimeDebugStep('leaf_native_camera_route_reveal'");
    expect(source).toContain('nativeNavigationRouteRevealKey === leafNativeNavigationKey');
    expect(source).toContain('const nextRouteFocusKey = `${routeViewportLayoutKey}|${routeFocusTrackingKey}`;');
    expect(source).toContain('lastRouteLayoutKeyRef.current = nextRouteFocusKey;');
    expect(source).toContain('(hasActiveRoute && !driverNavigationCameraOwnsMap) ||');
    expect(source).toContain('shouldForceHomePickupRegionUpdate');
    expectPrototypeMapLayerContract(source, {
      viewportPadding: 'homeRouteViewportPadding',
      routeViewportRegion: 'homeRouteViewportRegion',
      interactionEnabled: 'homeMapInteractionEnabled',
    });
  });

  it('keeps passenger booking routes visible above top and bottom overlays', () => {
    const source = readMobileSource('src/screens/prototype/RobotaxiBookingScreen.js');

    expect(source).toContain('buildOverlaySheetViewportMetrics');
    expect(source).toContain('useWindowDimensions');
    expect(source).toContain('occludedTop: routeIslandOcclusion');
    expect(source).toContain('occludedBottom: sheetViewport.occludedBottom');
    expect(source).toContain('backdropDismissEnabled={false}');
    expect(source).toContain('dragEnabled={false}');
    expect(source).toContain('maxHeight: sheetViewport.maxSheetHeight');
    expect(source).toContain('<ScrollView');
  });

  it('keeps passenger payment routes visible and prevents passive sheet dismissal', () => {
    const source = readMobileSource('src/screens/prototype/RobotaxiPaymentScreen.js');

    expect(source).toContain('buildOverlaySheetViewportMetrics');
    expect(source).toContain('useWindowDimensions');
    expect(source).toContain('occludedTop: stateHeaderOcclusion');
    expect(source).toContain('occludedBottom: sheetViewport.occludedBottom');
    expect(source).toContain('backdropDismissEnabled={false}');
    expect(source).toContain('dragEnabled={false}');
    expect(source).toContain('maxHeight: sheetViewport.maxSheetHeight');
    expect(source).toContain('scrollEnabled');
  });

  it('keeps passenger destination quote routes fitted to a bounded visible map area', () => {
    const source = readMobileSource('src/screens/prototype/RobotaxiDestinationScreen.js');

    expect(source).toContain('buildOverlaySheetViewportMetrics');
    expect(source).toContain('destinationSheetViewport');
    expect(source).toContain('destinationSheetMaxHeight');
    expect(source).toContain('occludedBottom: mapOccludedBottom');
    expect(source).toContain('destinationSheetViewport.occludedBottom');
    expect(source).toContain('Math.min(searchSurfaceMaxHeight, destinationSheetMaxHeight)');
    expect(source).toContain('maxHeight: destinationSheetMaxHeight');
    expect(source).toContain('scrollEnabled');
  });

  it('keeps direct MapView route renderers explicitly classified', () => {
    const scannedFiles = [
      ...listJavaScriptFiles('src/components'),
      ...listJavaScriptFiles('src/screens'),
    ].sort();
    const directRouteMapRenderers = scannedFiles.filter((relativePath) =>
      isDirectRouteMapRenderer(readMobileSource(relativePath))
    );

    expect(directRouteMapRenderers).toEqual(DIRECT_ROUTE_MAP_RENDERER_ALLOWLIST);
  });
});
