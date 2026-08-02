const fs = require('fs');
const path = require('path');

const MOBILE_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(MOBILE_ROOT, '..');

function listJavaScriptFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listJavaScriptFiles(absolutePath);
    return entry.isFile() && /\.(?:js|jsx|ts|tsx)$/.test(entry.name)
      ? [absolutePath]
      : [];
  });
}

describe('canonical trip persistence boundary', () => {
  it('keeps direct trip_data writes out of the mobile runtime', () => {
    const retiredTripDataSurfaces = [
      'src/services/TripDataService.js',
      'src/services/SyncService.js',
      'src/common-local/redisTrackingService.js',
      'src/common-local/services/redisTrackingService.js',
      'src/services/runtime/locationActionsBridge.js',
      'src/hooks/useTripTracking.js',
      'src/hooks/useTripHistory.js',
    ];
    retiredTripDataSurfaces.forEach((relativePath) => {
      expect(fs.existsSync(path.join(MOBILE_ROOT, relativePath))).toBe(false);
    });

    const directWriterPatterns = [
      /database\(\)\.ref\(\s*[`'"]trip_data\//,
      /firestore\(\)\.collection\(\s*['"]trip_data['"]\s*\)/,
    ];
    const violations = listJavaScriptFiles(path.join(MOBILE_ROOT, 'src'))
      .flatMap((filePath) => {
        const source = fs.readFileSync(filePath, 'utf8');
        return directWriterPatterns.some((pattern) => pattern.test(source))
          ? [path.relative(MOBILE_ROOT, filePath)]
          : [];
      });

    expect(violations).toEqual([]);
  });

  it('keeps lifecycle intents and locations on the backend-governed path', () => {
    const runtimeSource = fs.readFileSync(
      path.join(MOBILE_ROOT, 'src/screens/prototype/prototypeRideRuntime.js'),
      'utf8',
    );

    expect(runtimeSource).toContain('from "../../services/RideEventOutboxService";');
    expect(runtimeSource).toContain('await socket.updateDriverLocation(');
  });

  it('keeps both Firebase client surfaces closed to trip_data', () => {
    const firestoreRules = fs.readFileSync(
      path.join(REPO_ROOT, 'config/firebase/firestore.rules'),
      'utf8',
    );
    const databaseRules = JSON.parse(
      fs.readFileSync(
        path.join(REPO_ROOT, 'config/firebase/database.rules.json'),
        'utf8',
      ),
    );

    expect(firestoreRules).toMatch(
      /match \/trip_data\/\{tripId\} \{[\s\S]*?allow read, write: if false;/,
    );
    expect(databaseRules.rules['.read']).toBe(false);
    expect(databaseRules.rules['.write']).toBe(false);
    expect(databaseRules.rules.trip_data).toBeUndefined();
  });
});
