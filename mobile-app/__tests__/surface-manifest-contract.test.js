const fs = require('fs');
const path = require('path');

const surfaceManifest = require('../src/navigation/surfaceManifest.json');
const {
  getManifestRouteCategory,
  normalizeManifestDeepLinkPath,
} = require('../src/navigation/surfaceManifestContract');

const MOBILE_ROOT = path.resolve(__dirname, '..');
const APP_NAVIGATOR_PATH = path.join(MOBILE_ROOT, 'src/navigation/AppNavigator.js');
const PROTOTYPE_ROOT = path.join(MOBILE_ROOT, 'src/screens/prototype');
const appNavigatorSource = fs.readFileSync(APP_NAVIGATOR_PATH, 'utf8');

function read(relativePath) {
  return fs.readFileSync(path.join(MOBILE_ROOT, relativePath), 'utf8');
}

function stackRegistrations(source) {
  return [...source.matchAll(/<Stack\.Screen\b[\s\S]*?\/>/g)]
    .map(match => match[0])
    .map(tag => ({
      route: tag.match(/\bname=["']([^"']+)["']/)?.[1] || '',
      component: tag.match(/\bcomponent=\{([^}]+)\}/)?.[1]?.trim() || '',
    }))
    .filter(registration => registration.route);
}

function extractFunctionBody(source, functionName) {
  const marker = `function ${functionName}`;
  const start = source.indexOf(marker);
  if (start < 0) return '';
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(bodyStart + 1, index);
    }
  }
  return '';
}

function jsFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return jsFiles(absolute);
    return entry.name.endsWith('.js') ? [absolute] : [];
  });
}

function literalNavigationTargets(source) {
  const patterns = [
    /navigation\.(?:navigate|replace|push)\(\s*["']([^"']+)["']/g,
    /\b(?:route|routeName|targetRoute)\s*:\s*["']([^"']+)["']/g,
    /\breturn\s+["']([^"']+)["'];/g,
  ];
  return patterns.flatMap(pattern => [...source.matchAll(pattern)].map(match => match[1]));
}

function inlineRunFlowReferences(source) {
  return [...source.matchAll(/^\s*-?\s*runFlow:[ \t]+([^\s#]+)[ \t]*$/gm)]
    .map(match => match[1].replace(/^["']|["']$/g, ''));
}

function samplePath(template) {
  return template.replace(/:([A-Za-z0-9_]+)/g, (_match, key) => `sample-${key}`);
}

describe('canonical product surface manifest', () => {
  it('classifies every AppNavigator route exactly once', () => {
    expect(surfaceManifest.schemaVersion).toBe(1);
    expect(surfaceManifest.categories).toEqual([
      'current',
      'compatibility_redirect',
      'legacy',
    ]);

    const classifiedRoutes = Object.values(surfaceManifest.routeCategories).flat();
    expect(new Set(classifiedRoutes).size).toBe(classifiedRoutes.length);

    const registeredRoutes = [...new Set(stackRegistrations(appNavigatorSource).map(item => item.route))];
    registeredRoutes.forEach(routeName => {
      expect(getManifestRouteCategory(routeName)).not.toBeNull();
    });

    Object.keys(surfaceManifest.retiredRouteComponents).forEach(routeName => {
      expect(getManifestRouteCategory(routeName)).toBe('legacy');
      expect(registeredRoutes).not.toContain(routeName);
    });
    surfaceManifest.retiredRoutes.forEach(routeName => {
      expect(getManifestRouteCategory(routeName)).not.toBeNull();
      expect(getManifestRouteCategory(routeName)).not.toBe('current');
      expect(registeredRoutes).not.toContain(routeName);
    });
    expect([...classifiedRoutes].sort()).toEqual([
      ...registeredRoutes,
      ...surfaceManifest.retiredRoutes,
      ...Object.keys(surfaceManifest.retiredRouteComponents),
    ].sort());
  });

  it('never resolves a current route to a legacy component', () => {
    const legacyComponents = new Set(surfaceManifest.legacyComponents);
    stackRegistrations(appNavigatorSource)
      .filter(registration => getManifestRouteCategory(registration.route) === 'current')
      .forEach(registration => {
        expect(legacyComponents.has(registration.component)).toBe(false);
      });
  });

  it('keeps standalone retired components out of the current navigator branch', () => {
    const currentBranchSource = [
      extractFunctionBody(appNavigatorSource, 'renderPrototypeCompanionScreens'),
      extractFunctionBody(appNavigatorSource, 'renderSharedPrototypeScreens'),
      extractFunctionBody(appNavigatorSource, 'renderCustomerPrototypeScreens'),
      extractFunctionBody(appNavigatorSource, 'renderDriverPrototypeScreens'),
    ].join('\n');

    Object.entries(surfaceManifest.retiredRouteComponents).forEach(([routeName, component]) => {
      expect(currentBranchSource).not.toContain(`name="${routeName}"`);
      expect(currentBranchSource).not.toContain(`component={${component}}`);
      expect(fs.existsSync(path.join(PROTOTYPE_ROOT, `${component}.js`))).toBe(true);
    });
  });

  it('keeps current prototype navigation targets outside legacy routes', () => {
    const legacyRoutes = new Set(surfaceManifest.routeCategories.legacy);
    const legacyFiles = new Set(surfaceManifest.legacyPrototypeFiles);
    const violations = [];

    jsFiles(PROTOTYPE_ROOT).forEach(filePath => {
      if (legacyFiles.has(path.basename(filePath))) return;
      literalNavigationTargets(fs.readFileSync(filePath, 'utf8')).forEach(target => {
        if (legacyRoutes.has(target)) {
          violations.push(`${path.relative(PROTOTYPE_ROOT, filePath)} -> ${target}`);
        }
      });
    });

    expect(violations).toEqual([]);
    expect(read('src/screens/prototype/RobotaxiDestinationScreen.js')).toContain(
      "requestedReturnRouteName === 'RobotaxiPrototypeTrip'",
    );
    expect(read('src/screens/prototype/RobotaxiPaymentFailedScreen.js')).toContain(
      "requestedRetryRouteName === 'RobotaxiPrototype'",
    );
  });

  it('redirects every retired deep link to a current route and preserves query params', () => {
    surfaceManifest.deepLinks
      .filter(entry => entry.category === 'compatibility_redirect')
      .forEach(entry => {
        expect(getManifestRouteCategory(entry.targetRoute)).toBe('current');
        const inputPath = samplePath(entry.path);
        const expectedTarget = samplePath(entry.targetPath);
        expect(normalizeManifestDeepLinkPath(inputPath)).toBe(expectedTarget);
        expect(normalizeManifestDeepLinkPath(`${inputPath}?bookingId=booking-1`)).toBe(
          `${expectedTarget}?bookingId=booking-1`,
        );
      });

    expect(appNavigatorSource).toContain('getStateFromPath(normalizeLeafAppLinkPath(path), options)');
    expect(appNavigatorSource).not.toContain("RobotaxiPrototypeDriverOffer: 'robotaxi/driver/offer'");
    expect(appNavigatorSource).not.toContain("RobotaxiPrototypeDriverTrip: 'robotaxi/driver/trip'");
  });

  it('keeps FCM and canonical state seeders on the integrated driver Home', () => {
    const fcmSource = read('src/services/FCMNotificationService.js');
    const iosSeeder = read('scripts/qa/seed-prototype-ios-state.cjs');
    const androidSeeder = read('scripts/qa/seed-prototype-android-state.cjs');
    const lifecycleMatrix = read('src/screens/prototype/rideLifecycleSurfaceMatrix.js');
    const allowedRoutesBlock = fcmSource.match(
      /const ALLOWED_NOTIFICATION_ROUTES = new Set\(\[([\s\S]*?)\]\);/,
    )?.[1] || '';
    const aliasesBlock = fcmSource.match(
      /const NOTIFICATION_SCREEN_ALIASES = \{([\s\S]*?)\n\};/,
    )?.[1] || '';
    const allowedRoutes = [...allowedRoutesBlock.matchAll(/["']([^"']+)["']/g)]
      .map(match => match[1]);
    const aliasedRoutes = [...aliasesBlock.matchAll(/:\s*["']([^"']+)["']/g)]
      .map(match => match[1]);

    expect(fcmSource).toContain("driver_offer: 'RobotaxiPrototype'");
    expect(fcmSource).toContain("new_ride_offer: 'RobotaxiPrototype'");
    expect(fcmSource).toContain("payment: 'RobotaxiPrototype'");
    expect(fcmSource).not.toContain("'RobotaxiPrototypeDriverOffer',");
    expect(fcmSource).not.toContain("'RobotaxiPrototypeDriverTrip',");
    expect(fcmSource).not.toContain("'RobotaxiPrototypePayment',");
    [...allowedRoutes, ...aliasedRoutes].forEach(routeName => {
      expect(getManifestRouteCategory(routeName)).toBe('current');
    });
    expect(iosSeeder).not.toContain('leafapp://robotaxi/driver/offer');
    expect(iosSeeder).not.toContain('leafapp://robotaxi/driver/trip');
    expect(androidSeeder).not.toContain('leafapp://robotaxi/driver/offer');
    expect(androidSeeder).not.toContain('leafapp://robotaxi/driver/trip');
    expect(lifecycleMatrix).not.toContain("routeName: 'RobotaxiPrototypeDriverOffer'");
    expect(lifecycleMatrix).not.toContain("routeName: 'RobotaxiPrototypeDriverTrip'");
  });

  it('keeps acceptance automation transitively current-only', () => {
    const packageJson = JSON.parse(read('package.json'));
    const automation = surfaceManifest.acceptanceAutomation;
    const currentRoot = path.join(MOBILE_ROOT, automation.current.root);
    const compatibilityLinks = surfaceManifest.deepLinks
      .filter(entry => entry.category === 'compatibility_redirect')
      .map(entry => `leafapp://${entry.path}`);

    automation.current.scripts.forEach(scriptName => {
      expect(packageJson.scripts[scriptName]).toContain(automation.current.root);
    });
    automation.legacy.scripts.forEach(scriptName => {
      expect(packageJson.scripts[scriptName]).toBeDefined();
    });

    const queue = fs.readdirSync(currentRoot)
      .filter(file => /\.ya?ml$/.test(file))
      .map(file => path.join(currentRoot, file));
    const visited = new Set();
    while (queue.length) {
      const flowPath = queue.pop();
      if (visited.has(flowPath)) continue;
      visited.add(flowPath);
      const source = fs.readFileSync(flowPath, 'utf8');
      expect(source).not.toContain(automation.legacy.requiredMarker);
      compatibilityLinks.forEach(link => expect(source).not.toContain(link));
      inlineRunFlowReferences(source).forEach(reference => {
        const dependency = path.resolve(path.dirname(flowPath), reference);
        expect(fs.existsSync(dependency)).toBe(true);
        queue.push(dependency);
      });
    }

    fs.readdirSync(currentRoot)
      .filter(file => /\.ya?ml$/.test(file))
      .forEach(file => {
        const source = fs.readFileSync(path.join(currentRoot, file), 'utf8');
        expect(source).toContain(automation.current.requiredMarker);
        expect(source).toContain(automation.canonicalStart);
      });
  });
});
