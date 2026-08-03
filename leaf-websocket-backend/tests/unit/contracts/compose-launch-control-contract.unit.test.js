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
  const strictKycProfileSource = fs.readFileSync(
    path.resolve(__dirname, '../../../config/kyc-aws-strict.env.example'),
    'utf8',
  );
  const softReleaseProfileSource = fs.readFileSync(
    path.resolve(__dirname, '../../../config/soft-release.env.example'),
    'utf8',
  );
  const deploySource = fs.readFileSync(
    path.resolve(__dirname, '../../../scripts/deploy-contabo-docker.sh'),
    'utf8',
  );
  const opsWorkersSource = fs.readFileSync(
    path.resolve(__dirname, '../../../docker-compose.ops-workers.yml'),
    'utf8',
  );
  const tripLocationWorkerSource = fs.readFileSync(
    path.resolve(__dirname, '../../../workers/worker-trip-location.js'),
    'utf8',
  );
  const dockerIgnoreSource = fs.readFileSync(
    path.resolve(__dirname, '../../../.dockerignore'),
    'utf8',
  );
  const dockerfileSource = fs.readFileSync(
    path.resolve(__dirname, '../../../Dockerfile'),
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

  it('keeps legacy GraphQL and driverResponse acceptance isolated from production gateways', () => {
    for (const setting of [
      'ENABLE_LEGACY_GRAPHQL=false',
      'ENABLE_LEGACY_DRIVER_RESPONSE_ACCEPT=false'
    ]) {
      expect(strictKycProfileSource).toContain(setting);
      expect(softReleaseProfileSource).toContain(setting);
    }

    expect(composeSource).toContain(
      '- ENABLE_LEGACY_GRAPHQL=${ENABLE_LEGACY_GRAPHQL:-false}',
    );
    expect(composeSource).toContain(
      '- ENABLE_LEGACY_DRIVER_RESPONSE_ACCEPT=${ENABLE_LEGACY_DRIVER_RESPONSE_ACCEPT:-false}',
    );
    expect(gatewayScaleSource).toContain(
      '- ENABLE_LEGACY_GRAPHQL=${ENABLE_LEGACY_GRAPHQL:-false}',
    );
    expect(gatewayScaleSource).toContain(
      '- ENABLE_LEGACY_DRIVER_RESPONSE_ACCEPT=${ENABLE_LEGACY_DRIVER_RESPONSE_ACCEPT:-false}',
    );
    expect(workerSource).not.toContain('ENABLE_LEGACY_GRAPHQL');
    expect(workerSource).not.toContain('ENABLE_LEGACY_DRIVER_RESPONSE_ACCEPT');
  });

  it('propagates Firestore-only positive KYC authority through strict runtime profiles', () => {
    expect(strictKycProfileSource).toContain('KYC_STRICT_PRODUCTION_MODE=true');
    expect(softReleaseProfileSource).toContain('KYC_STRICT_PRODUCTION_MODE=false');
    expect(
      composeSource.match(/- KYC_STRICT_PRODUCTION_MODE=\$\{KYC_STRICT_PRODUCTION_MODE:-false\}/g),
    ).toHaveLength(1);
    expect(
      gatewayScaleSource.match(/- KYC_STRICT_PRODUCTION_MODE=\$\{KYC_STRICT_PRODUCTION_MODE:-false\}/g),
    ).toHaveLength(2);
    expect(strictKycProfileSource).toContain(
      'KYC_TRUST_POLICY_VERSION=driver_identity_recurring_v2',
    );
    for (const approvedSetting of [
      'KYC_TRUST_T0_MAX_AGE_HOURS=24',
      'KYC_TRUST_T1_MAX_AGE_HOURS=72',
      'KYC_TRUST_T2_MAX_AGE_HOURS=168',
      'KYC_TRUST_T1_MIN_DISTINCT_SUCCESS_DAYS=7',
      'KYC_TRUST_T2_MIN_AGE_DAYS=30',
      'KYC_TRUST_T2_MIN_SUCCESS_COUNT=14',
      'KYC_TRUST_T2_MIN_DISTINCT_SUCCESS_DAYS=14',
      'KYC_TRUSTED_RANDOM_AUDIT_PERCENT=10',
    ]) {
      expect(strictKycProfileSource).toContain(approvedSetting);
    }
    expect(softReleaseProfileSource).toContain(
      'KYC_TRUST_POLICY_VERSION=driver_identity_recurring_v1',
    );
    for (const profile of [strictKycProfileSource, softReleaseProfileSource]) {
      expect(profile).toContain('KYC_TRUST_T2_MIN_DISTINCT_SUCCESS_DAYS=14');
      expect(profile).toContain('KYC_TRUSTED_RANDOM_AUDIT_PERCENT=10');
    }
    expect(composeSource).toContain(
      '- KYC_TRUST_POLICY_VERSION=${KYC_TRUST_POLICY_VERSION:-driver_identity_recurring_v1}',
    );
    expect(
      gatewayScaleSource.match(/KYC_TRUST_POLICY_VERSION:-driver_identity_recurring_v1/g),
    ).toHaveLength(2);
    expect(composeSource).toContain(
      '- KYC_TRUST_T2_MIN_DISTINCT_SUCCESS_DAYS=${KYC_TRUST_T2_MIN_DISTINCT_SUCCESS_DAYS:-14}',
    );
    expect(gatewayScaleSource.match(/KYC_TRUSTED_RANDOM_AUDIT_PERCENT:-10/g)).toHaveLength(2);
  });

  it('keeps AWS liveness credentials dormant by default and rejects unknown authority modes', () => {
    expect(composeSource).toContain(
      '- KYC_AWS_LIVENESS_CREDENTIALS_ENABLED=${KYC_AWS_LIVENESS_CREDENTIALS_ENABLED:-false}',
    );
    expect(composeSource).not.toContain(
      '- KYC_AWS_LIVENESS_CREDENTIALS_ENABLED=${KYC_AWS_LIVENESS_CREDENTIALS_ENABLED:-true}',
    );
    expect(deploySource).toContain(
      'KYC_ACTIVE_TRIP_AUTHORITY_MODE must be empty or redis_noeviction.',
    );
    expect(deploySource).toContain("''|redis_noeviction)");
  });

  it('hardens Redis as a live-attested noeviction authority without exposing auth in health args', () => {
    const productionRedisSource = composeSource.slice(
      composeSource.indexOf('  redis:'),
      composeSource.indexOf('  # ===== WEBSOCKET SERVER =====')
    );
    const scaleRedisSource = gatewayScaleSource.slice(
      gatewayScaleSource.indexOf('  redis:'),
      gatewayScaleSource.indexOf('\n\n  websocket:')
    );

    expect(productionRedisSource).toContain('--appendonly yes --appendfsync everysec');
    expect(productionRedisSource).toContain('--maxmemory 2304mb --maxmemory-policy noeviction');
    expect(productionRedisSource).toContain(
      'image: redis:7.4.9-alpine3.21@sha256:6ab0b6e7381779332f97b8ca76193e45b0756f38d4c0dcda72dbb3c32061ab99',
    );
    expect(productionRedisSource).not.toContain('image: redis:7-alpine');
    expect(productionRedisSource).toContain('REDISCLI_AUTH=\\"$${REDIS_PASSWORD}\\"');
    expect(productionRedisSource).toContain('redis-cli --no-auth-warning --raw ping');
    expect(productionRedisSource).not.toContain('redis-cli -a');
    expect(productionRedisSource).not.toContain('incr');
    expect(scaleRedisSource).toContain('mem_limit: 3072m');

    for (const setting of [
      'KYC_ACTIVE_TRIP_AUTHORITY_MODE=redis_noeviction',
      'REDIS_CRITICAL_AUTHORITY_ATTESTATION_ENABLED=true',
      'REDIS_CRITICAL_DATASET_QUARANTINE_ENABLED=true',
      'REDIS_CRITICAL_DATASET_GENERATION=',
      'REDIS_CRITICAL_DATASET_GENERATION_KEY=leaf:runtime:critical-dataset:generation',
      'REDIS_CRITICAL_MEMORY_WARNING_PERCENT=60',
      'REDIS_CRITICAL_MEMORY_HIGH_PERCENT=75',
      'REDIS_CRITICAL_MEMORY_CRITICAL_PERCENT=85',
      'REDIS_CRITICAL_ATTESTATION_CACHE_TTL_MS=5000'
    ]) {
      expect(strictKycProfileSource).toContain(setting);
    }
    expect(strictKycProfileSource).toContain('application never creates or repairs the marker');
    expect(composeSource.match(/REDIS_CRITICAL_AUTHORITY_ATTESTATION_ENABLED=/g)).toHaveLength(1);
    expect(gatewayScaleSource.match(/REDIS_CRITICAL_AUTHORITY_ATTESTATION_ENABLED=/g)).toHaveLength(2);
    expect(composeSource).toContain(
      '- TRIP_LOCATION_WORKER_GROUP=${TRIP_LOCATION_WORKER_GROUP:-trip-location-workers}',
    );
    expect(composeSource).toContain(
      '- TRIP_LOCATION_CONSUMER_MAX_IDLE_MS=${TRIP_LOCATION_CONSUMER_MAX_IDLE_MS:-30000}',
    );
    expect(
      gatewayScaleSource.match(/TRIP_LOCATION_CONSUMER_MAX_IDLE_MS:-30000/g),
    ).toHaveLength(2);
    expect(strictKycProfileSource).toContain('TRIP_LOCATION_CONSUMER_MAX_IDLE_MS=30000');
    expect(strictKycProfileSource).toContain('TRIP_LOCATION_STREAM_SAFE_TRIM_THRESHOLD=500000');
  });

  it('blocks modular rollout until live Redis authority and readiness are proven', () => {
    for (const contract of [
      'CONFIG GET maxmemory-policy',
      'CONFIG GET appendonly',
      'CONFIG GET appendfsync',
      'INFO persistence',
      'INFO stats',
      'TTL \\"\\$generation_key\\"',
      'XINFO GROUPS',
      'XINFO CONSUMERS',
      'TRIP_LOCATION_CONSUMER_MAX_IDLE_MS',
      "validator_image=\\$(docker inspect --format '{{.Image}}' leaf-websocket)",
      '-e ENV_FILE=/dev/null',
      '--entrypoint node',
      'scripts/deploy/validate-runtime-config.js',
      '/health/readiness'
    ]) {
      expect(deploySource).toContain(contract);
    }
    expect(deploySource).toContain('This script never tears down the compose project, Redis, or named volumes.');
    expect(deploySource).toContain('It never converts or restarts Redis.');
    expect(deploySource).toContain(
      'Trip-location stream disabled; consumer liveness gate skipped.',
    );
    expect(deploySource).toContain(
      'ENABLE_TRIP_LOCATION_STREAM must be an explicit boolean.',
    );
    const remoteValidator = deploySource.indexOf(
      "validator_image=\\$(docker inspect --format '{{.Image}}' leaf-websocket)",
    );
    const firstServiceUp = deploySource.indexOf(
      '\\$compose up -d',
      remoteValidator,
    );
    expect(remoteValidator).toBeGreaterThan(-1);
    expect(firstServiceUp).toBeGreaterThan(remoteValidator);
  });

  it('pins an immutable production release, removes stale source and keeps automatic image rollback', () => {
    expect(deploySource).toContain('StrictHostKeyChecking=yes');
    expect(deploySource).toContain('ssh-keygen -F "$CONTABO_HOST"');
    expect(deploySource).not.toContain('StrictHostKeyChecking=no');
    expect(deploySource).not.toContain('UserKnownHostsFile=/dev/null');

    expect(deploySource).toContain('--from0');
    expect(deploySource).toContain('--files-from="$TRACKED_MANIFEST"');
    expect(deploySource).toContain('git -C "$REPO_ROOT" archive --format=tar');
    expect(deploySource).toContain(
      'RSYNC_TRANSFER_ARGS=(--no-owner --no-group --chmod=Du=rwx,Dgo=rx)',
    );
    expect(deploySource).toContain(
      'RSYNC_TRANSFER_ARGS+=(--from0 --files-from="$TRACKED_MANIFEST")',
    );
    expect(deploySource).toContain('RSYNC_TRANSFER_ARGS+=(--delete --delete-delay)');
    expect(deploySource.match(/"\$\{RSYNC_TRANSFER_ARGS\[@\]\}"/g)).toHaveLength(2);
    expect(deploySource).not.toContain('RSYNC_SOURCE_ARGS=()');
    expect(deploySource).not.toContain('RSYNC_DELETE_ARGS=()');
    expect(deploySource).toContain('SYNC_SOURCE_DIR="$RELEASE_STAGING_DIR/"');
    expect(deploySource).toContain('--dry-run --itemize-changes');
    expect(deploySource).toContain('--exclude "/docker-compose.yml"');
    expect(deploySource).toContain('DEPLOY_TRACKED_PATHS');
    expect(deploySource).toContain('GATEWAY_ONLY_DEPLOY');
    expect(deploySource).toContain('PRODUCTION_RELEASE_SHA');
    expect(deploySource).toContain('CURRENT_BRANCH" != "main"');
    expect(deploySource).toContain('refs/remotes/origin/main');
    expect(deploySource).toContain("GIT_SHA='$RELEASE_SHA' \\$compose build");
    expect(deploySource).toContain('org.opencontainers.image.revision');
    expect(deploySource).toContain('grep -Fxq \'GIT_SHA=$RELEASE_SHA\'');

    expect(dockerfileSource).toContain('ARG GIT_SHA=unknown');
    expect(dockerfileSource).toContain('LABEL org.opencontainers.image.revision="$GIT_SHA"');
    expect(dockerfileSource).toContain('ENV GIT_SHA="$GIT_SHA"');
    expect(composeSource.match(/GIT_SHA: \$\{GIT_SHA:-unknown\}/g)).toHaveLength(3);
    expect(gatewayScaleSource.match(/GIT_SHA: \$\{GIT_SHA:-unknown\}/g)).toHaveLength(2);
    expect(opsWorkersSource.match(/GIT_SHA: \$\{GIT_SHA:-unknown\}/g)).toHaveLength(3);

    for (const credentialPattern of [
      '*.env',
      '*.pem',
      '*.p12',
      '*.pfx',
      '*.jks',
      '*.keystore',
      '*.key',
      '*.crt',
      '*.cer',
      'leaf-reactnative-firebase-adminsdk-*.json',
    ]) {
      expect(deploySource).toContain(credentialPattern);
      expect(dockerIgnoreSource).toContain(credentialPattern);
    }

    expect(dockerIgnoreSource).toContain('.env*');
    expect(dockerIgnoreSource).toContain('backups');
    expect(dockerIgnoreSource).toContain('reports');
    expect(dockerIgnoreSource).toContain('.tmp-*');
    expect(deploySource).toContain('container-images-before.txt');
    expect(deploySource).toContain('leaf-app-rollback:$STAMP-');
    expect(deploySource).toContain('rollback_on_error');
    expect(deploySource).toContain('Automatic rollback completed.');
    expect(deploySource).toContain('docker image tag \\"\\$previous_image\\" \\"\\$configured_image\\"');
    expect(deploySource).toContain('cmp -s .env');
  });

  it('runs the trip-location consumer as a health-attested canonical Docker worker', () => {
    const tripWorkerStart = opsWorkersSource.indexOf('  trip-location-worker:');
    const tripWorkerEnd = opsWorkersSource.indexOf('\n  pricing-baseline-worker:', tripWorkerStart);
    const tripWorkerCompose = opsWorkersSource.slice(tripWorkerStart, tripWorkerEnd);

    expect(tripWorkerStart).toBeGreaterThan(-1);
    expect(tripWorkerEnd).toBeGreaterThan(tripWorkerStart);
    expect(tripWorkerCompose).toContain('container_name: leaf-trip-location-worker');
    expect(tripWorkerCompose).toContain('command: ["node", "workers/worker-trip-location.js"]');
    expect(tripWorkerCompose).not.toContain('env_file:');
    expect(tripWorkerCompose).toContain('restart: unless-stopped');
    expect(tripWorkerCompose).toContain('mem_limit: 768m');
    expect(tripWorkerCompose).toContain('cpus: "0.50"');
    expect(tripWorkerCompose).toContain('GOOGLE_APPLICATION_CREDENTIALS=/app/firebase-credentials.json');
    expect(tripWorkerCompose).toContain('./firebase-credentials.json:/app/firebase-credentials.json:ro');
    expect(dockerfileSource).toContain('adduser -S leaf -u 1001 -G nodejs');
    expect(dockerIgnoreSource).toContain('firebase-credentials.json');
    expect(dockerIgnoreSource).toContain('leaf-reactnative-firebase-adminsdk-*.json');
    expect(deploySource).toContain('--exclude "leaf-reactnative-firebase-adminsdk-*.json"');
    expect(tripWorkerCompose).toContain('TRIP_LOCATION_STREAM_NAME=${TRIP_LOCATION_STREAM_NAME:-trip_location_events}');
    expect(tripWorkerCompose).toContain('TRIP_LOCATION_WORKER_CONSUMER=${TRIP_LOCATION_WORKER_CONSUMER:-trip-location-worker-1}');
    expect(tripWorkerCompose).toContain('TRIP_LOCATION_WORKER_DLQ_STREAM_NAME=${TRIP_LOCATION_WORKER_DLQ_STREAM_NAME:-trip_location_events_dlq}');
    expect(tripWorkerCompose).toContain('TRIP_LOCATION_WORKER_HEALTH_KEY=${TRIP_LOCATION_WORKER_HEALTH_KEY:-leaf:runtime:trip-location-worker:health}');
    expect(tripWorkerCompose).toContain('TRIP_LOCATION_WORKER_HEALTH_TTL_SECONDS=${TRIP_LOCATION_WORKER_HEALTH_TTL_SECONDS:-90}');
    expect(tripWorkerCompose).toContain('TRIP_LOCATION_WORKER_HEALTH_MAX_AGE_MS=${TRIP_LOCATION_WORKER_HEALTH_MAX_AGE_MS:-45000}');
    expect(tripWorkerCompose).toContain("redis.xinfo('CONSUMERS',stream,group)");
    expect(tripWorkerCompose).toContain("entry.name===consumer");
    expect(tripWorkerCompose).toContain('Number(own.idle)>maxIdleMs');
    expect(tripWorkerCompose).toContain('redis.hgetall(healthKey)');
    expect(tripWorkerCompose).toContain("!['healthy','idle'].includes");
    expect(tripWorkerCompose).toContain('heartbeatAgeMs>maxHealthAgeMs');
    expect(tripWorkerCompose).not.toContain('websocket:\n        condition: service_healthy');

    for (const source of [composeSource, gatewayScaleSource]) {
      expect(source).toContain('ENABLE_TRIP_LOCATION_PERSISTENCE_WORKER=${ENABLE_TRIP_LOCATION_PERSISTENCE_WORKER:-true}');
      expect(source).toContain('ENABLE_TRIP_LOCATION_FIRESTORE_PERSISTENCE=${ENABLE_TRIP_LOCATION_FIRESTORE_PERSISTENCE:-true}');
      expect(source).toContain('TRIP_LOCATION_WORKER_HEALTH_KEY=${TRIP_LOCATION_WORKER_HEALTH_KEY:-leaf:runtime:trip-location-worker:health}');
      expect(source).toContain('TRIP_LOCATION_WORKER_HEALTH_MAX_AGE_MS=${TRIP_LOCATION_WORKER_HEALTH_MAX_AGE_MS:-45000}');
    }

    expect(tripLocationWorkerSource).toContain(
      "streamName: process.env.TRIP_LOCATION_STREAM_NAME || 'trip_location_events'",
    );
    expect(tripLocationWorkerSource).toContain(
      "consumerName: process.env.TRIP_LOCATION_WORKER_CONSUMER || 'trip-location-worker-1'",
    );
    expect(tripLocationWorkerSource).toContain(
      "dlqStreamName: process.env.TRIP_LOCATION_WORKER_DLQ_STREAM_NAME || 'trip_location_events_dlq'",
    );
    expect(deploySource).toContain(
      'trip-location-worker pricing-baseline-worker ride-health-monitor-worker',
    );
    const tripWorkerUp = deploySource.indexOf(
      '\\$compose up -d --no-deps trip-location-worker',
    );
    const firstGatewayUp = deploySource.indexOf(
      '\\$compose up -d --no-deps websocket-gateway-2',
    );
    expect(tripWorkerUp).toBeGreaterThan(-1);
    expect(firstGatewayUp).toBeGreaterThan(tripWorkerUp);
    expect(deploySource).toContain(
      'wait_healthy trip-location-worker leaf-trip-location-worker',
    );
    expect(deploySource).toContain('trip_worker_health_status=\\$(redis_cmd HGET');
    expect(deploySource).toContain('trip_worker_heartbeat_at=\\$(redis_cmd HGET');
    expect(deploySource).toContain('trip_worker_health_ttl=\\$(redis_cmd TTL');
    expect(deploySource).toContain('Trip-location consumer and persistence heartbeat validated.');
  });
});
