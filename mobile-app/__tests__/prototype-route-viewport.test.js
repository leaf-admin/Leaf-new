import {
  buildOverlaySheetViewportMetrics,
  buildRouteViewportRegion,
  buildShortRouteViewportRegion,
  buildVisibleRouteEdgePadding,
  buildVisibleRouteViewportFrame,
  distanceBetweenCoordinatesKm,
  validateRoadRouteGeometry,
} from '../src/screens/prototype/prototypeRouteViewport';

describe('prototype route viewport', () => {
  const shortRoute = [
    { latitude: -22.881, longitude: -43.343 },
    { latitude: -22.884, longitude: -43.348 },
  ];
  const projectY = ({ coordinate, region, mapHeight }) => (
    mapHeight / 2 - ((coordinate.latitude - region.latitude) / region.latitudeDelta) * mapHeight
  );
  const projectX = ({ coordinate, region, mapWidth }) => (
    mapWidth / 2 + ((coordinate.longitude - region.longitude) / region.longitudeDelta) * mapWidth
  );

  it('rejects a continental outlier and keeps only a local camera fallback without a fake polyline', () => {
    const origin = { latitude: -22.9868, longitude: -43.2254 };
    const destination = { latitude: -22.9844, longitude: -43.2236 };
    const geometry = validateRoadRouteGeometry({
      origin,
      destination,
      coordinates: [
        origin,
        { latitude: 0.2, longitude: 12.4 },
        { latitude: -22.9852, longitude: -43.2242 },
        destination,
      ],
    });

    expect(geometry).toEqual(expect.objectContaining({
      valid: false,
      reason: 'implausible_extent',
      coordinates: [],
    }));
    expect(buildRouteViewportRegion({ coordinates: geometry.coordinates })).toBeNull();

    const localCamera = buildRouteViewportRegion({
      coordinates: [origin, destination],
      mapWidth: 390,
      mapHeight: 844,
      activeOcclusion: { top: 0, bottom: 348 },
      insets: { top: 24, bottom: 34 },
      viewportPadding: { top: 96, right: 24, bottom: 348, left: 24 },
    });
    expect(localCamera).toBeTruthy();
    expect(localCamera.latitudeDelta).toBeLessThan(0.08);
    expect(localCamera.longitudeDelta).toBeLessThan(0.08);
  });

  it('rejects swapped endpoint coordinates before fitting the route', () => {
    const origin = { latitude: -22.9868, longitude: -43.2254 };
    const destination = { latitude: -22.9844, longitude: -43.2236 };
    const geometry = validateRoadRouteGeometry({
      origin,
      destination,
      coordinates: [
        { latitude: -43.2254, longitude: -22.9868 },
        { latitude: -22.9857, longitude: -43.2248 },
        destination,
      ],
    });

    expect(geometry.valid).toBe(false);
    expect(geometry.reason).toBe('endpoint_mismatch');
  });

  it('rejects two-point straight-line geometry for active ride maps', () => {
    const origin = { latitude: -22.9836, longitude: -43.2192 };
    const destination = { latitude: -22.98488, longitude: -43.22215 };

    expect(validateRoadRouteGeometry({
      origin,
      destination,
      coordinates: [origin, destination],
    })).toEqual(expect.objectContaining({
      valid: false,
      reason: 'insufficient_geometry',
      coordinates: [],
    }));
  });

  it('rejects the four-point locally generated fallback curve', () => {
    const origin = { latitude: -22.9836, longitude: -43.2192 };
    const destination = { latitude: -22.98488, longitude: -43.22215 };
    const latitudeDelta = destination.latitude - origin.latitude;
    const longitudeDelta = destination.longitude - origin.longitude;
    const syntheticFallback = [
      origin,
      {
        latitude: origin.latitude + latitudeDelta * 0.34 - longitudeDelta * 0.14,
        longitude: origin.longitude + longitudeDelta * 0.34 + latitudeDelta * 0.14,
      },
      {
        latitude: origin.latitude + latitudeDelta * 0.68 - longitudeDelta * 0.14 * 0.55,
        longitude: origin.longitude + longitudeDelta * 0.68 + latitudeDelta * 0.14 * 0.55,
      },
      destination,
    ];

    expect(validateRoadRouteGeometry({
      origin,
      destination,
      coordinates: syntheticFallback,
    })).toEqual(expect.objectContaining({
      valid: false,
      reason: 'synthetic_fallback',
      coordinates: [],
    }));
  });

  it('accepts plausible backend road geometry with intermediate shape points', () => {
    const origin = { latitude: -22.9836, longitude: -43.2192 };
    const destination = { latitude: -22.98488, longitude: -43.22215 };
    const backendRoadGeometry = [
      origin,
      { latitude: -22.98378, longitude: -43.21992 },
      { latitude: -22.98412, longitude: -43.22074 },
      { latitude: -22.98466, longitude: -43.22153 },
      destination,
    ];

    expect(validateRoadRouteGeometry({
      origin,
      destination,
      coordinates: backendRoadGeometry,
    })).toEqual(expect.objectContaining({
      valid: true,
      reason: 'road_geometry',
      coordinates: backendRoadGeometry,
    }));
  });

  it('caps an oversized card occlusion before it can inflate a Leblon route to continental scale', () => {
    const route = [
      { latitude: -22.9836, longitude: -43.2192 },
      { latitude: -22.9836222, longitude: -43.2203822 },
      { latitude: -22.98424325, longitude: -43.22130456 },
      { latitude: -22.98488, longitude: -43.22215 },
    ];
    const viewport = {
      mapWidth: 390,
      mapHeight: 844,
      activeOcclusion: { top: 0, bottom: 900 },
      insets: { top: 59, bottom: 34 },
      viewportPadding: { top: 96, right: 24, bottom: 900, left: 24 },
      minVisibleHeight: 220,
    };
    const frame = buildVisibleRouteViewportFrame(viewport);
    const region = buildRouteViewportRegion({
      ...viewport,
      coordinates: route,
      shortRouteMaxDistanceKm: 10,
      shortRouteLatitudeDeltaMultiplier: 1.1,
      shortRouteLongitudeDeltaMultiplier: 1.2,
    });

    expect(frame.height).toBeGreaterThanOrEqual(220);
    expect(region).toBeTruthy();
    expect(region.latitude).toBeGreaterThan(-23.1);
    expect(region.latitude).toBeLessThan(-22.8);
    expect(region.longitude).toBeGreaterThan(-43.4);
    expect(region.longitude).toBeLessThan(-43.0);
    expect(region.latitudeDelta).toBeLessThanOrEqual(0.12);
    expect(region.longitudeDelta).toBeLessThanOrEqual(0.12);
  });

  it('defines the explicit map frame that remains visible above overlays', () => {
    const frame = buildVisibleRouteViewportFrame({
      mapWidth: 390,
      mapHeight: 844,
      activeOcclusion: { top: 144, bottom: 468 },
      insets: { top: 24, bottom: 16, left: 0, right: 0 },
      viewportPadding: { top: 172, right: 52, bottom: 488, left: 52 },
    });

    expect(frame).toEqual({
      mapWidth: 390,
      mapHeight: 844,
      top: 172,
      left: 52,
      right: 338,
      bottom: 356,
      width: 286,
      height: 184,
      insets: {
        top: 172,
        right: 52,
        bottom: 488,
        left: 52,
      },
    });
  });

  it('caps overlay sheets before they can consume the route viewport', () => {
    const metrics = buildOverlaySheetViewportMetrics({
      windowHeight: 640,
      topOcclusion: 132,
      bottomOffset: 28,
      measuredHeight: 560,
      fallbackHeight: 356,
      minVisibleMapHeight: 220,
    });

    expect(metrics.maxSheetHeight).toBeLessThanOrEqual(260);
    expect(metrics.effectiveSheetHeight).toBe(metrics.maxSheetHeight);
    expect(metrics.occludedBottom).toBe(28 + metrics.maxSheetHeight);
    expect(metrics.visibleMapHeight).toBeGreaterThanOrEqual(220);
  });

  it('pads route fitting above the active bottomsheet visible area', () => {
    const padding = buildVisibleRouteEdgePadding({
      mapHeight: 800,
      activeOcclusion: { top: 0, bottom: 430 },
      insets: { top: 24, bottom: 16 },
      sidePadding: 44,
      topPaddingMin: 128,
      minVisibleHeight: 220,
    });

    expect(padding.left).toBe(44);
    expect(padding.right).toBe(44);
    expect(padding.top).toBeGreaterThanOrEqual(128);
    expect(padding.bottom).toBeGreaterThan(430);
    expect(padding.top + padding.bottom).toBeLessThan(800);
  });

  it('keeps native fallback padding aligned with the measured bottomsheet when the ideal visible height cannot fit', () => {
    const padding = buildVisibleRouteEdgePadding({
      mapHeight: 640,
      activeOcclusion: { top: 0, bottom: 400 },
      insets: { top: 0, bottom: 0 },
      sidePadding: 44,
      topPaddingMin: 118,
      minVisibleHeight: 220,
    });

    expect(padding.bottom).toBeGreaterThanOrEqual(400);
    expect(padding.top).toBeGreaterThanOrEqual(118);
    expect(padding.top + padding.bottom).toBeLessThan(640);
  });

  it('recenters short routes into the visible map area instead of the full screen center', () => {
    const plainRegion = buildShortRouteViewportRegion({
      coordinates: shortRoute,
      mapHeight: 800,
      activeOcclusion: { top: 0, bottom: 0 },
      insets: { top: 0, bottom: 0 },
      minVisibleHeight: 220,
    });
    const sheetRegion = buildShortRouteViewportRegion({
      coordinates: shortRoute,
      mapHeight: 800,
      activeOcclusion: { top: 0, bottom: 430 },
      insets: { top: 0, bottom: 0 },
      minVisibleHeight: 220,
    });

    expect(plainRegion).toBeTruthy();
    expect(sheetRegion).toBeTruthy();
    expect(sheetRegion.latitude).not.toBeCloseTo(plainRegion.latitude, 6);
    expect(sheetRegion.latitudeDelta).toBeGreaterThanOrEqual(0.014);
  });

  it('does not apply short-route zoom rules to long routes', () => {
    const longRoute = [
      { latitude: -22.881, longitude: -43.343 },
      { latitude: -22.971, longitude: -43.183 },
    ];

    expect(distanceBetweenCoordinatesKm(longRoute[0], longRoute[1])).toBeGreaterThan(1.8);
    expect(
      buildShortRouteViewportRegion({
        coordinates: longRoute,
        mapHeight: 800,
        activeOcclusion: { top: 0, bottom: 430 },
        insets: { top: 0, bottom: 0 },
      }),
    ).toBeNull();
  });

  it('builds an explicit visible viewport region for long active routes above the bottomsheet', () => {
    const longRoute = [
      { latitude: -22.881, longitude: -43.343 },
      { latitude: -22.971, longitude: -43.183 },
    ];
    const plainRegion = buildRouteViewportRegion({
      coordinates: longRoute,
      mapHeight: 800,
      activeOcclusion: { top: 0, bottom: 0 },
      insets: { top: 0, bottom: 0 },
      minVisibleHeight: 220,
    });
    const sheetRegion = buildRouteViewportRegion({
      coordinates: longRoute,
      mapHeight: 800,
      activeOcclusion: { top: 0, bottom: 430 },
      insets: { top: 0, bottom: 0 },
      minVisibleHeight: 220,
    });

    expect(plainRegion).toBeTruthy();
    expect(sheetRegion).toBeTruthy();
    expect(sheetRegion.latitude).toBeLessThan(plainRegion.latitude);
    expect(sheetRegion.latitudeDelta).toBeGreaterThanOrEqual(0.028);
    expect(sheetRegion.longitudeDelta).toBeGreaterThan(0.1);
  });

  it('fits a long vertical route entirely inside the exposed area, not the full map', () => {
    const mapHeight = 800;
    const viewportPadding = { top: 128, right: 44, bottom: 452, left: 44 };
    const route = [
      { latitude: -22.881, longitude: -43.343 },
      { latitude: -22.971, longitude: -43.343 },
    ];
    const region = buildRouteViewportRegion({
      coordinates: route,
      mapWidth: 390,
      mapHeight,
      activeOcclusion: { top: 0, bottom: 430 },
      insets: { top: 0, bottom: 0 },
      viewportPadding,
      minVisibleHeight: 220,
    });

    expect(region.latitudeDelta).toBeGreaterThan(0.4);
    route.forEach(coordinate => {
      const y = projectY({ coordinate, region, mapHeight });
      expect(y).toBeGreaterThanOrEqual(viewportPadding.top);
      expect(y).toBeLessThanOrEqual(mapHeight - viewportPadding.bottom);
    });
  });

  it('allows pre-booking preview routes to use a tighter long-route viewport', () => {
    const mapWidth = 390;
    const mapHeight = 844;
    const activeOcclusion = { top: 0, bottom: 448 };
    const insets = { top: 24, bottom: 16 };
    const viewportPadding = buildVisibleRouteEdgePadding({
      mapHeight,
      activeOcclusion,
      insets,
      sidePadding: 72,
      topExtraPadding: 14,
      bottomExtraPadding: 12,
      minVisibleHeight: 180,
      overlayBiasRatio: 0.18,
    });
    const route = [
      { latitude: -22.857, longitude: -43.309 },
      { latitude: -22.902, longitude: -43.342 },
      { latitude: -22.9997, longitude: -43.3659 },
    ];
    const defaultRegion = buildRouteViewportRegion({
      coordinates: route,
      mapWidth,
      mapHeight,
      activeOcclusion,
      insets,
      viewportPadding,
      minVisibleHeight: 180,
    });
    const compactRegion = buildRouteViewportRegion({
      coordinates: route,
      mapWidth,
      mapHeight,
      activeOcclusion,
      insets,
      viewportPadding,
      minVisibleHeight: 180,
      longRouteLatitudeDeltaMultiplier: 1.72,
      longRouteLongitudeDeltaMultiplier: 1.86,
    });

    expect(compactRegion.latitudeDelta).toBeLessThan(defaultRegion.latitudeDelta);
    route.forEach(coordinate => {
      const x = projectX({ coordinate, region: compactRegion, mapWidth });
      const y = projectY({ coordinate, region: compactRegion, mapHeight });
      expect(x).toBeGreaterThanOrEqual(viewportPadding.left);
      expect(x).toBeLessThanOrEqual(mapWidth - viewportPadding.right);
      expect(y).toBeGreaterThanOrEqual(viewportPadding.top);
      expect(y).toBeLessThanOrEqual(mapHeight - viewportPadding.bottom);
    });
  });

  it.each([
    {
      deviceClass: 'compact Android',
      mapWidth: 360,
      mapHeight: 640,
      insets: { top: 24, bottom: 24 },
      categoryCardHeight: 390,
      categoryBottomOffset: 41,
    },
    {
      deviceClass: 'standard iOS',
      mapWidth: 390,
      mapHeight: 844,
      insets: { top: 47, bottom: 34 },
      categoryCardHeight: 390,
      categoryBottomOffset: 41,
    },
    {
      deviceClass: 'large iOS',
      mapWidth: 430,
      mapHeight: 932,
      insets: { top: 59, bottom: 34 },
      categoryCardHeight: 390,
      categoryBottomOffset: 41,
    },
    {
      deviceClass: 'tall Android',
      mapWidth: 412,
      mapHeight: 915,
      insets: { top: 32, bottom: 24 },
      categoryCardHeight: 390,
      categoryBottomOffset: 41,
    },
  ])(
    'tightly fits the route above the measured category card on $deviceClass',
    ({
      mapWidth,
      mapHeight,
      insets,
      categoryCardHeight,
      categoryBottomOffset,
    }) => {
      const activeOcclusion = {
        top: 0,
        bottom: insets.bottom + categoryBottomOffset + categoryCardHeight,
      };
      const viewportPadding = buildVisibleRouteEdgePadding({
        mapHeight,
        activeOcclusion,
        insets,
        sidePadding: 28,
        topExtraPadding: 8,
        bottomExtraPadding: 6,
        minVisibleHeight: 180,
        overlayBiasRatio: 0.04,
      });
      const route = [
        { latitude: -22.9428, longitude: -43.3652 },
        { latitude: -22.9524, longitude: -43.2921 },
        { latitude: -22.96722, longitude: -43.17874 },
      ];
      const region = buildRouteViewportRegion({
        coordinates: route,
        mapWidth,
        mapHeight,
        activeOcclusion,
        insets,
        viewportPadding,
        minVisibleHeight: 180,
        shortRouteMinLatitudeDelta: 0.0015,
        minLatitudeDelta: 0.0015,
        shortRouteLatitudeDeltaMultiplier: 1.12,
        shortRouteLongitudeDeltaMultiplier: 1.12,
        longRouteLatitudeDeltaMultiplier: 1.12,
        longRouteLongitudeDeltaMultiplier: 1.12,
      });
      const frame = buildVisibleRouteViewportFrame({
        mapWidth,
        mapHeight,
        activeOcclusion,
        insets,
        viewportPadding,
      });
      const projectedPoints = route.map(coordinate => ({
        x: projectX({ coordinate, region, mapWidth }),
        y: projectY({ coordinate, region, mapHeight }),
      }));
      const projectedWidth =
        Math.max(...projectedPoints.map(point => point.x)) -
        Math.min(...projectedPoints.map(point => point.x));
      const projectedHeight =
        Math.max(...projectedPoints.map(point => point.y)) -
        Math.min(...projectedPoints.map(point => point.y));

      expect(viewportPadding.bottom).toBeGreaterThanOrEqual(activeOcclusion.bottom);
      const dominantAxisUtilization = Math.max(
        projectedWidth / frame.width,
        projectedHeight / frame.height,
      );

      expect(viewportPadding.left).toBe(28);
      expect(viewportPadding.right).toBe(28);
      expect(dominantAxisUtilization).toBeGreaterThanOrEqual(0.88);
      expect(dominantAxisUtilization).toBeLessThanOrEqual(0.96);
      projectedPoints.forEach(({ x, y }) => {
        expect(x).toBeGreaterThanOrEqual(frame.left);
        expect(x).toBeLessThanOrEqual(frame.right);
        expect(y).toBeGreaterThanOrEqual(frame.top);
        expect(y).toBeLessThanOrEqual(frame.bottom);
      });
    },
  );

  it('fits a horizontal route within the measured map width and side padding', () => {
    const mapWidth = 390;
    const viewportPadding = { top: 128, right: 56, bottom: 452, left: 56 };
    const route = [
      { latitude: -22.881, longitude: -43.55 },
      { latitude: -22.881, longitude: -43.17 },
    ];
    const region = buildRouteViewportRegion({
      coordinates: route,
      mapWidth,
      mapHeight: 800,
      activeOcclusion: { top: 0, bottom: 430 },
      insets: { top: 0, bottom: 0 },
      viewportPadding,
      minVisibleHeight: 220,
    });

    route.forEach(coordinate => {
      const x = projectX({ coordinate, region, mapWidth });
      expect(x).toBeGreaterThanOrEqual(viewportPadding.left);
      expect(x).toBeLessThanOrEqual(mapWidth - viewportPadding.right);
    });
  });

  it('recenters a route into the visible frame when lateral UI occludes one side of the map', () => {
    const mapWidth = 390;
    const mapHeight = 800;
    const activeOcclusion = { top: 0, bottom: 430, left: 112, right: 24 };
    const viewportPadding = { top: 128, right: 40, bottom: 452, left: 112 };
    const route = [
      { latitude: -22.881, longitude: -43.55 },
      { latitude: -22.881, longitude: -43.42 },
      { latitude: -22.881, longitude: -43.17 },
    ];
    const frame = buildVisibleRouteViewportFrame({
      mapWidth,
      mapHeight,
      activeOcclusion,
      insets: { top: 0, bottom: 0, left: 0, right: 0 },
      viewportPadding,
    });
    const region = buildRouteViewportRegion({
      coordinates: route,
      mapWidth,
      mapHeight,
      activeOcclusion,
      insets: { top: 0, bottom: 0, left: 0, right: 0 },
      viewportPadding,
      minVisibleHeight: 220,
    });

    expect(region).toBeTruthy();
    route.forEach(coordinate => {
      const x = projectX({ coordinate, region, mapWidth });
      const y = projectY({ coordinate, region, mapHeight });
      expect(x).toBeGreaterThanOrEqual(frame.left);
      expect(x).toBeLessThanOrEqual(frame.right);
      expect(y).toBeGreaterThanOrEqual(frame.top);
      expect(y).toBeLessThanOrEqual(frame.bottom);
    });
  });

  it('keeps every route vertex inside the visible area when the bottomsheet is tall', () => {
    const mapWidth = 390;
    const mapHeight = 844;
    const viewportPadding = { top: 136, right: 48, bottom: 488, left: 48 };
    const route = [
      { latitude: -22.885, longitude: -43.35 },
      { latitude: -22.905, longitude: -43.42 },
      { latitude: -22.945, longitude: -43.38 },
      { latitude: -22.92, longitude: -43.26 },
      { latitude: -22.975, longitude: -43.22 },
    ];
    const region = buildRouteViewportRegion({
      coordinates: route,
      mapWidth,
      mapHeight,
      activeOcclusion: { top: 0, bottom: 470 },
      insets: { top: 24, bottom: 16 },
      viewportPadding,
      minVisibleHeight: 220,
    });

    expect(region).toBeTruthy();
    route.forEach(coordinate => {
      const x = projectX({ coordinate, region, mapWidth });
      const y = projectY({ coordinate, region, mapHeight });
      expect(x).toBeGreaterThanOrEqual(viewportPadding.left);
      expect(x).toBeLessThanOrEqual(mapWidth - viewportPadding.right);
      expect(y).toBeGreaterThanOrEqual(viewportPadding.top);
      expect(y).toBeLessThanOrEqual(mapHeight - viewportPadding.bottom);
    });
  });

  it('keeps route endpoints and the live vehicle together in the exposed frame', () => {
    const mapWidth = 390;
    const mapHeight = 844;
    const viewportPadding = { top: 132, right: 48, bottom: 470, left: 48 };
    const routeAndVehicle = [
      { latitude: -22.97104, longitude: -43.18349 },
      { latitude: -22.9694, longitude: -43.1812 },
      { latitude: -22.967311, longitude: -43.178954 },
    ];
    const region = buildRouteViewportRegion({
      coordinates: routeAndVehicle,
      mapWidth,
      mapHeight,
      activeOcclusion: { top: 0, bottom: 452 },
      insets: { top: 24, bottom: 16 },
      viewportPadding,
      minVisibleHeight: 220,
    });

    routeAndVehicle.forEach(coordinate => {
      const x = projectX({ coordinate, region, mapWidth });
      const y = projectY({ coordinate, region, mapHeight });
      expect(x).toBeGreaterThanOrEqual(viewportPadding.left);
      expect(x).toBeLessThanOrEqual(mapWidth - viewportPadding.right);
      expect(y).toBeGreaterThanOrEqual(viewportPadding.top);
      expect(y).toBeLessThanOrEqual(mapHeight - viewportPadding.bottom);
    });
  });

  it('keeps route vertices inside the visible map when a top overlay and bottomsheet are both active', () => {
    const mapWidth = 390;
    const mapHeight = 844;
    const activeOcclusion = { top: 156, bottom: 452 };
    const insets = { top: 24, bottom: 16 };
    const viewportPadding = buildVisibleRouteEdgePadding({
      mapHeight,
      activeOcclusion,
      insets,
      sidePadding: 52,
      topPaddingMin: 172,
      topExtraPadding: 18,
      bottomExtraPadding: 34,
      minVisibleHeight: 220,
    });
    const route = [
      { latitude: -22.8529, longitude: -43.3106 },
      { latitude: -22.8782, longitude: -43.3454 },
      { latitude: -22.8897, longitude: -43.3769 },
      { latitude: -22.9124, longitude: -43.3621 },
    ];
    const region = buildRouteViewportRegion({
      coordinates: route,
      mapWidth,
      mapHeight,
      activeOcclusion,
      insets,
      viewportPadding,
      minVisibleHeight: 220,
    });
    const frame = buildVisibleRouteViewportFrame({
      mapWidth,
      mapHeight,
      activeOcclusion,
      insets,
      viewportPadding,
    });

    expect(region).toBeTruthy();
    expect(frame.top).toBeGreaterThan(150);
    expect(frame.bottom).toBeLessThan(420);
    route.forEach(coordinate => {
      const x = projectX({ coordinate, region, mapWidth });
      const y = projectY({ coordinate, region, mapHeight });
      expect(x).toBeGreaterThanOrEqual(frame.left);
      expect(x).toBeLessThanOrEqual(frame.right);
      expect(y).toBeGreaterThanOrEqual(frame.top);
      expect(y).toBeLessThanOrEqual(frame.bottom);
    });
  });

  it('fits the route inside the actual exposed area when the bottomsheet exceeds the ideal minimum height', () => {
    const mapWidth = 390;
    const mapHeight = 844;
    const activeOcclusion = { top: 0, bottom: 690 };
    const insets = { top: 24, bottom: 16 };
    const viewportPadding = buildVisibleRouteEdgePadding({
      mapHeight,
      activeOcclusion,
      insets,
      sidePadding: 48,
      topPaddingMin: 96,
      minVisibleHeight: 220,
    });
    const route = [
      { latitude: -22.885, longitude: -43.35 },
      { latitude: -22.93, longitude: -43.41 },
      { latitude: -22.975, longitude: -43.22 },
    ];
    const region = buildRouteViewportRegion({
      coordinates: route,
      mapWidth,
      mapHeight,
      activeOcclusion,
      insets,
      viewportPadding,
      minVisibleHeight: 220,
    });
    const frame = buildVisibleRouteViewportFrame({
      mapWidth,
      mapHeight,
      activeOcclusion,
      insets,
      viewportPadding,
      minVisibleHeight: 220,
    });

    expect(region).toBeTruthy();
    expect(frame.height).toBeGreaterThanOrEqual(220);
    route.forEach(coordinate => {
      const x = projectX({ coordinate, region, mapWidth });
      const y = projectY({ coordinate, region, mapHeight });
      expect(x).toBeGreaterThanOrEqual(frame.left);
      expect(x).toBeLessThanOrEqual(frame.right);
      expect(y).toBeGreaterThanOrEqual(frame.top);
      expect(y).toBeLessThanOrEqual(frame.bottom);
    });
  });
});
