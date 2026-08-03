const fs = require('fs');
const path = require('path');

const MOBILE_ROOT = path.resolve(__dirname, '..');

function listJavaScriptFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listJavaScriptFiles(absolutePath);
    return entry.isFile() && /\.(?:js|jsx|ts|tsx)$/.test(entry.name)
      ? [absolutePath]
      : [];
  });
}

function resolveLocalModule(importerPath, request) {
  if (!request.startsWith('.')) return null;

  const basePath = path.resolve(path.dirname(importerPath), request);
  const candidates = [
    basePath,
    `${basePath}.js`,
    `${basePath}.jsx`,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    path.join(basePath, 'index.js'),
    path.join(basePath, 'index.jsx'),
    path.join(basePath, 'index.ts'),
    path.join(basePath, 'index.tsx'),
  ];

  return candidates.find((candidate) => {
    try {
      return fs.statSync(candidate).isFile();
    } catch (_error) {
      return false;
    }
  }) || null;
}

function collectReachableJavaScriptFiles(entryPath) {
  const pending = [entryPath];
  const reachable = new Set();
  const importPattern = /(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)/g;

  while (pending.length > 0) {
    const filePath = pending.pop();
    if (!filePath || reachable.has(filePath)) continue;
    reachable.add(filePath);

    const source = fs.readFileSync(filePath, 'utf8');
    for (const match of source.matchAll(importPattern)) {
      const resolved = resolveLocalModule(filePath, match[1] || match[2]);
      if (resolved && /\.(?:js|jsx|ts|tsx)$/.test(resolved) && !reachable.has(resolved)) {
        pending.push(resolved);
      }
    }
  }

  return reachable;
}

describe('canonical common runtime boundary', () => {
  it('keeps the retired common package out of the mobile workspace', () => {
    expect(fs.existsSync(path.join(MOBILE_ROOT, 'common'))).toBe(false);
  });

  it('does not load the legacy common package barrel from mobile runtime code', () => {
    const barrelImportPattern = /(?:from\s+|require\()\s*['"](?:\.\.\/)+common['"]/;
    const legacyPackageImportPattern = /common\/common-packages\/src\//;
    const violations = listJavaScriptFiles(path.join(MOBILE_ROOT, 'src'))
      .flatMap((filePath) => {
        const source = fs.readFileSync(filePath, 'utf8');
        return barrelImportPattern.test(source) || legacyPackageImportPattern.test(source)
          ? [path.relative(MOBILE_ROOT, filePath)]
          : [];
      });

    expect(violations).toEqual([]);
  });

  it('routes shared map helpers through canonical runtime bridges', () => {
    const source = fs.readFileSync(
      path.join(MOBILE_ROOT, 'src/common/sharedFunctions.js'),
      'utf8',
    );

    expect(source).toContain("from '../services/runtime/locationRouteBridge';");
    expect(source).toContain("from '../services/runtime/mapGeoService';");
    expect(source).not.toContain("from '../../common';");
  });

  it('keeps exactly one Redux store implementation in the common runtime', () => {
    const reachable = collectReachableJavaScriptFiles(path.join(MOBILE_ROOT, 'index.js'));
    const commonRuntimeFiles = listJavaScriptFiles(path.join(MOBILE_ROOT, 'src/common-local'));
    const storeImplementations = commonRuntimeFiles.filter((filePath) =>
      fs.readFileSync(filePath, 'utf8').includes('configureStore('),
    );

    expect(fs.existsSync(path.join(MOBILE_ROOT, 'src/common-local/store/store.js'))).toBe(false);
    expect(storeImplementations).toEqual([path.join(MOBILE_ROOT, 'src/common-local/store.js')]);
    expect(reachable.has(path.join(MOBILE_ROOT, 'src/common-local/store.js'))).toBe(true);
    expect(fs.existsSync(path.join(MOBILE_ROOT, 'src/common-local/index.js'))).toBe(false);
    expect(fs.existsSync(path.join(MOBILE_ROOT, 'src/services/canonical/legacyApiService.js'))).toBe(false);
  });

  it('keeps the retired Realtime Database client outside mobile source', () => {
    const violations = listJavaScriptFiles(path.join(MOBILE_ROOT, 'src'))
      .filter((filePath) => (
        fs.readFileSync(filePath, 'utf8').includes('@react-native-firebase/database')
      ))
      .map((filePath) => path.relative(MOBILE_ROOT, filePath))
      .sort();

    expect(violations).toEqual([]);
    expect(fs.existsSync(path.join(MOBILE_ROOT, 'src/firebase-refs.js'))).toBe(false);
    expect(fs.existsSync(path.join(MOBILE_ROOT, 'src/common-local/config/configureFirebase.js'))).toBe(false);
    expect(fs.existsSync(path.join(MOBILE_ROOT, 'src/services/DatabaseBypass.js'))).toBe(false);
    expect(fs.existsSync(path.join(MOBILE_ROOT, 'src/services/VehicleNotificationService.js'))).toBe(false);
  });

  it('keeps the retired ride Redux action graph out of the runtime', () => {
    const commonLocalDirectory = path.join(MOBILE_ROOT, 'src/common-local');
    const actionsDirectory = path.join(commonLocalDirectory, 'actions');
    const duplicatedRootActions = fs.readdirSync(commonLocalDirectory)
      .filter((fileName) => fileName.endsWith('actions.js'))
      .sort();
    const remainingActionModules = fs.existsSync(actionsDirectory)
      ? fs.readdirSync(actionsDirectory).filter((fileName) => fileName.endsWith('.js')).sort()
      : [];
    const ratingServiceSource = fs.readFileSync(
      path.join(MOBILE_ROOT, 'src/services/RatingService.js'),
      'utf8',
    );

    expect(duplicatedRootActions).toEqual([]);
    expect(remainingActionModules).toEqual([]);
    expect(fs.existsSync(path.join(MOBILE_ROOT, 'src/services/canonical/rideService.js'))).toBe(false);
    expect(fs.existsSync(path.join(MOBILE_ROOT, 'src/services/runtime/bookingStateBridge.js'))).toBe(false);
    expect(fs.existsSync(path.join(MOBILE_ROOT, 'src/services/runtime/ratingStateBridge.js'))).toBe(false);
    expect(ratingServiceSource).not.toContain('ratingStateBridge');
    expect(ratingServiceSource).not.toContain('store.dispatch');
  });
});
