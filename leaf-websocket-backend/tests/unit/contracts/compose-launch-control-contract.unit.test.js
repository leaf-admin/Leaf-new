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
  const gatewayScaleSource = fs.readFileSync(
    path.resolve(__dirname, '../../../docker-compose.gateway-scale.yml'),
    'utf8',
  );
  const realtimeSecondarySource = fs.readFileSync(
    path.resolve(__dirname, '../../../docker-compose.realtime-secondary.yml'),
    'utf8',
  );
  const rideFlowProfileSource = fs.readFileSync(
    path.resolve(__dirname, '../../../config/ride-flow-validation.env.example'),
    'utf8',
  );

  it('propagates the no-intake pilot policy to the side-effects worker preflight', () => {
    expect(workerStart).toBeGreaterThan(-1);
    expect(workerEnd).toBeGreaterThan(workerStart);

    for (const key of [
      'LEAF_LAUNCH_PROFILE',
      'LEAF_RIDE_FLOW_VALIDATION_ACK',
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

  it('propagates the physical offer timeout only through dispatch gateways', () => {
    expect(composeSource).toContain(
      '- SMOKE_DRIVER_RESPONSE_TIMEOUT_SECONDS=${SMOKE_DRIVER_RESPONSE_TIMEOUT_SECONDS:-21600}',
    );
    expect(
      gatewayScaleSource.match(/- SMOKE_DRIVER_RESPONSE_TIMEOUT_SECONDS=/g),
    ).toHaveLength(2);
    expect(realtimeSecondarySource).toContain(
      '- SMOKE_DRIVER_RESPONSE_TIMEOUT_SECONDS=${SMOKE_DRIVER_RESPONSE_TIMEOUT_SECONDS:-21600}',
    );
    expect(rideFlowProfileSource).toContain(
      'SMOKE_DRIVER_RESPONSE_TIMEOUT_SECONDS=20',
    );
    expect(workerSource).not.toContain('SMOKE_DRIVER_RESPONSE_TIMEOUT_SECONDS');
  });
});
