const fs = require('fs');
const path = require('path');

describe('production compose launch-control contract', () => {
  const composeSource = fs.readFileSync(
    path.resolve(__dirname, '../../../docker-compose.production.yml'),
    'utf8',
  );
  const workerStart = composeSource.indexOf('  sideeffects-worker:');
  const workerEnd = composeSource.indexOf('  # ===== BILLING WORKER =====', workerStart);
  const workerSource = composeSource.slice(workerStart, workerEnd);

  it('propagates the no-intake pilot policy to the side-effects worker preflight', () => {
    expect(workerStart).toBeGreaterThan(-1);
    expect(workerEnd).toBeGreaterThan(workerStart);

    for (const key of [
      'LEAF_LAUNCH_PROFILE',
      'PILOT_ALLOWED_PASSENGER_IDS',
      'PILOT_ALLOWED_DRIVER_IDS',
      'PILOT_REGION_IDS',
      'LEAF_ACCEPT_NEW_PIX',
      'LEAF_ACCEPT_NEW_BOOKINGS',
      'LEAF_RUNTIME_POLICY_VERSION',
      'GEOFENCE_REGION_FILE',
      'GEOFENCE_REGION_VERSION',
    ]) {
      expect(workerSource).toContain(`- ${key}=\${${key}`);
    }
  });
});
