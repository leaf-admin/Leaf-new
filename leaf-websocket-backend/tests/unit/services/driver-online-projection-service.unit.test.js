'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  DRIVER_ONLINE_PROJECTION_SCRIPT,
  commitDriverOnlineProjection,
  normalizeGeoCoordinates,
  normalizeExpectedHashFields,
  normalizeHashFields
} = require('../../../services/driver-online-projection-service');

describe('driver-online-projection-service', () => {
  it('projects online hash and discovery indices in one guarded Redis script', async () => {
    const redis = {
      eval: jest.fn().mockResolvedValue([1, 1, 1])
    };

    const result = await commitDriverOnlineProjection(redis, {
      driverId: 'driver_1',
      driverKey: 'driver:driver_1',
      eligibleGeoKey: 'driver_locations_eligible',
      isOnline: true,
      dispatchEligible: true,
      lat: -22.9207,
      lng: -43.4059,
      fields: {
        driverId: 'driver_1',
        status: 'AVAILABLE',
        isOnline: true,
        dispatchEligible: true
      }
    });

    expect(result).toEqual({
      success: true,
      isOnline: true,
      dispatchEligible: true,
      hasLocation: true,
      projectionScope: 'full',
      ttlSeconds: 0
    });
    expect(redis.eval).toHaveBeenCalledTimes(1);
    expect(redis.eval).toHaveBeenCalledWith(
      DRIVER_ONLINE_PROJECTION_SCRIPT,
      5,
      'driver:driver_1',
      'driver_locations',
      'driver_locations_eligible',
      'online_drivers',
      'driver_offline_locations',
      'driver_1',
      '1',
      '1',
      '-43.4059',
      '-22.9207',
      '1',
      'full',
      '0',
      '4',
      'driverId',
      'driver_1',
      'status',
      'AVAILABLE',
      'isOnline',
      'true',
      'dispatchEligible',
      'true'
    );
    expect(DRIVER_ONLINE_PROJECTION_SCRIPT).toContain("local key_expectations = { 'hash', 'zset', 'zset', 'set', 'zset' }");
    expect(DRIVER_ONLINE_PROJECTION_SCRIPT).toContain('if not valid then');
    expect(DRIVER_ONLINE_PROJECTION_SCRIPT).toContain("redis.call('HSET', KEYS[1], unpack(hash_args))");
    expect(DRIVER_ONLINE_PROJECTION_SCRIPT).toContain("redis.call('GEOADD', KEYS[3]");
  });

  it('removes offline drivers through the same atomic script contract', async () => {
    const redis = {
      eval: jest.fn().mockResolvedValue([1, 0, 0])
    };

    const result = await commitDriverOnlineProjection(redis, {
      driverId: 'driver_1',
      isOnline: false,
      dispatchEligible: false,
      fields: {
        driverId: 'driver_1',
        status: 'OFFLINE',
        isOnline: false,
        dispatchEligible: false
      }
    });

    expect(result).toMatchObject({
      success: true,
      isOnline: false,
      dispatchEligible: false,
      hasLocation: false
    });
    const args = redis.eval.mock.calls[0];
    expect(args.slice(2, 7)).toEqual([
      'driver:driver_1',
      'driver_locations',
      'driver_locations_eligible',
      'online_drivers',
      'driver_offline_locations'
    ]);
    expect(args.slice(7, 15)).toEqual(['driver_1', '0', '0', '', '', '0', 'full', '0']);
    expect(DRIVER_ONLINE_PROJECTION_SCRIPT).toContain("redis.call('SREM', KEYS[4], driver_id)");
  });

  it('stores the last offline location in the full atomic projection', async () => {
    const redis = {
      eval: jest.fn().mockResolvedValue([1, 0, 0])
    };

    const result = await commitDriverOnlineProjection(redis, {
      driverId: 'driver_1',
      isOnline: false,
      dispatchEligible: false,
      lat: -22.9207,
      lng: -43.4059,
      ttlSeconds: 86400,
      fields: {
        status: 'OFFLINE',
        isOnline: false,
        dispatchEligible: false
      }
    });

    expect(result).toMatchObject({
      isOnline: false,
      dispatchEligible: false,
      hasLocation: true,
      projectionScope: 'full',
      ttlSeconds: 86400
    });
    expect(redis.eval.mock.calls[0]).toEqual(expect.arrayContaining([
      'driver_offline_locations',
      '-43.4059',
      '-22.9207',
      'full',
      '86400'
    ]));
    expect(DRIVER_ONLINE_PROJECTION_SCRIPT).toContain(
      "if has_location then\n    redis.call('GEOADD', KEYS[5]"
    );
  });

  it('fails closed when the atomic Redis primitive is unavailable or rejects', async () => {
    await expect(commitDriverOnlineProjection({}, {
      driverId: 'driver_1',
      fields: { status: 'ONLINE' }
    })).rejects.toMatchObject({ code: 'DRIVER_ONLINE_PROJECTION_ATOMIC_UNAVAILABLE' });

    await expect(commitDriverOnlineProjection({
      eval: jest.fn().mockResolvedValue([0])
    }, {
      driverId: 'driver_1',
      fields: { status: 'ONLINE' }
    })).rejects.toMatchObject({ code: 'DRIVER_ONLINE_PROJECTION_ATOMIC_REJECTED' });
  });

  it('skips a conditional projection when the observed driver hash changed', async () => {
    const redis = {
      eval: jest.fn().mockResolvedValue([0, 'PRECONDITION_MISMATCH'])
    };

    const result = await commitDriverOnlineProjection(redis, {
      driverId: 'driver_1',
      isOnline: false,
      dispatchEligible: false,
      expectedFields: {
        isOnline: 'true',
        timestamp: null
      },
      fields: {
        status: 'OFFLINE',
        isOnline: 'false',
        dispatchEligible: 'false'
      }
    });

    expect(result).toEqual({
      success: false,
      skipped: true,
      code: 'PRECONDITION_MISMATCH'
    });
    expect(redis.eval.mock.calls[0]).toEqual(expect.arrayContaining([
      '2',
      'isOnline',
      'true',
      'timestamp',
      '\u0000',
      '0'
    ]));
    expect(normalizeExpectedHashFields({ present: false, missing: null })).toEqual([
      'present', 'false', 'missing', '\u0000'
    ]);
    expect(DRIVER_ONLINE_PROJECTION_SCRIPT).toContain("return { 0, 'PRECONDITION_MISMATCH' }");
  });

  it('rejects an unknown conditional script response instead of treating it as a safe skip', async () => {
    const redis = {
      eval: jest.fn().mockResolvedValue([0, 'UNKNOWN_CONDITIONAL_RESULT'])
    };

    await expect(commitDriverOnlineProjection(redis, {
      driverId: 'driver_1',
      expectedFields: { isOnline: 'true' },
      fields: { isOnline: 'false' }
    })).rejects.toMatchObject({ code: 'DRIVER_ONLINE_PROJECTION_ATOMIC_REJECTED' });
  });

  it('guards stale cleanup against a fresh distributed driver socket in the same script', async () => {
    const redis = {
      eval: jest.fn().mockResolvedValue([0, 'ACTIVE_SOCKET_PRESENCE'])
    };

    const result = await commitDriverOnlineProjection(redis, {
      driverId: 'driver_1',
      isOnline: false,
      dispatchEligible: false,
      presenceFreshAfterMs: 1782388800000,
      fields: {
        status: 'OFFLINE',
        isOnline: 'false',
        dispatchEligible: 'false'
      }
    });

    expect(result).toEqual({
      success: false,
      skipped: true,
      code: 'ACTIVE_SOCKET_PRESENCE'
    });
    expect(redis.eval.mock.calls[0].slice(0, 9)).toEqual([
      DRIVER_ONLINE_PROJECTION_SCRIPT,
      6,
      'driver:driver_1',
      'driver_locations',
      'driver_locations_eligible',
      'online_drivers',
      'driver_offline_locations',
      'driver_socket_presence:driver_1',
      'driver_1'
    ]);
    expect(DRIVER_ONLINE_PROJECTION_SCRIPT).toContain("return { 0, 'ACTIVE_SOCKET_PRESENCE' }");
  });

  it('rejects invalid geo coordinates before Redis can perform a partial script write', async () => {
    const redis = { eval: jest.fn() };

    await expect(commitDriverOnlineProjection(redis, {
      driverId: 'driver_1',
      isOnline: true,
      lat: -90,
      lng: -43.4059,
      fields: { status: 'AVAILABLE' }
    })).rejects.toMatchObject({ code: 'DRIVER_ONLINE_PROJECTION_INVALID_LOCATION' });

    expect(redis.eval).not.toHaveBeenCalled();
    expect(normalizeGeoCoordinates(undefined, undefined, { required: true })).toEqual({
      hasLocation: false,
      lat: null,
      lng: null
    });
  });

  it('supports an atomic eligibility-only patch without changing online discovery indices', async () => {
    const redis = { eval: jest.fn().mockResolvedValue([1, -1, 0]) };

    const result = await commitDriverOnlineProjection(redis, {
      driverId: 'driver_1',
      projectionScope: 'eligibility_only',
      dispatchEligible: false,
      fields: {
        dispatchEligible: 'false',
        dispatchEligibilityCode: 'KYC_REQUIRED'
      }
    });

    expect(result.projectionScope).toBe('eligibility_only');
    expect(redis.eval.mock.calls[0]).toContain('eligibility_only');
    expect(DRIVER_ONLINE_PROJECTION_SCRIPT).toContain("projection_scope == 'eligibility_only'");
  });

  it('projects an online location snapshot and TTL without changing dispatch eligibility', async () => {
    const redis = { eval: jest.fn().mockResolvedValue([1, 1, 0]) };

    const result = await commitDriverOnlineProjection(redis, {
      driverId: 'driver_1',
      projectionScope: 'location_only',
      isOnline: true,
      lat: -22.9207,
      lng: -43.4059,
      ttlSeconds: 120,
      fields: {
        id: 'driver_1',
        isOnline: 'true',
        status: 'AVAILABLE'
      }
    });

    expect(result).toMatchObject({
      success: true,
      isOnline: true,
      hasLocation: true,
      projectionScope: 'location_only',
      ttlSeconds: 120
    });
    expect(redis.eval.mock.calls[0]).toEqual(expect.arrayContaining([
      'location_only',
      '120'
    ]));
    expect(DRIVER_ONLINE_PROJECTION_SCRIPT).toContain(
      "projection_scope == 'location_only' and online"
    );
    expect(DRIVER_ONLINE_PROJECTION_SCRIPT).toContain("redis.call('EXPIRE', KEYS[1], ttl_seconds)");
  });

  it('projects an offline location into the offline GEO in the same script', async () => {
    const redis = { eval: jest.fn().mockResolvedValue([1, 0, 0]) };

    await commitDriverOnlineProjection(redis, {
      driverId: 'driver_1',
      projectionScope: 'location_only',
      isOnline: false,
      lat: -22.9207,
      lng: -43.4059,
      ttlSeconds: 86400,
      fields: {
        id: 'driver_1',
        isOnline: 'false',
        status: 'OFFLINE'
      }
    });

    expect(DRIVER_ONLINE_PROJECTION_SCRIPT).toContain("redis.call('GEOADD', KEYS[5]");
    expect(DRIVER_ONLINE_PROJECTION_SCRIPT).toContain("redis.call('ZREM', KEYS[2], driver_id)");
    expect(DRIVER_ONLINE_PROJECTION_SCRIPT).toContain("redis.call('SREM', KEYS[4], driver_id)");
  });

  it('rejects a location-only projection without coordinates or a positive TTL', async () => {
    const redis = { eval: jest.fn() };

    await expect(commitDriverOnlineProjection(redis, {
      driverId: 'driver_1',
      projectionScope: 'location_only',
      isOnline: false,
      ttlSeconds: 86400,
      fields: { status: 'OFFLINE' }
    })).rejects.toMatchObject({ code: 'DRIVER_ONLINE_PROJECTION_INVALID_LOCATION' });

    await expect(commitDriverOnlineProjection(redis, {
      driverId: 'driver_1',
      projectionScope: 'location_only',
      isOnline: true,
      lat: -22.9207,
      lng: -43.4059,
      fields: { status: 'AVAILABLE' }
    })).rejects.toMatchObject({ code: 'DRIVER_ONLINE_PROJECTION_INVALID_TTL' });

    expect(redis.eval).not.toHaveBeenCalled();
  });

  it('keeps the shared location writer on the atomic projection contract', () => {
    const serverSource = fs.readFileSync(
      path.resolve(__dirname, '../../../server.js'),
      'utf8'
    );
    const writerStart = serverSource.indexOf('const saveDriverLocation = async');
    const writerEnd = serverSource.indexOf('// =========================================================================================', writerStart);
    const writerSource = serverSource.slice(writerStart, writerEnd);

    expect(writerStart).toBeGreaterThan(-1);
    expect(writerEnd).toBeGreaterThan(writerStart);
    expect(writerSource).toContain('await commitDriverOnlineProjection(redis, {');
    expect(writerSource).toContain("projectionScope: hasDispatchProjection ? 'full' : 'location_only'");
    expect(writerSource).toContain("typeof dispatchProjection?.eligible === 'boolean'");
    expect(writerSource).not.toMatch(/redis\.(hset|geoadd|zrem|sadd|srem|expire)\(/);
  });

  it('keeps disconnect discovery cleanup on the atomic projection contract', () => {
    const disconnectSource = fs.readFileSync(
      path.resolve(__dirname, '../../../bootstrap/register-socket-disconnect-handler.js'),
      'utf8'
    );

    expect(disconnectSource).toContain('await commitDriverOnlineProjection(redis, {');
    expect(disconnectSource).toContain("code: 'OFFLINE'");
    expect(disconnectSource).not.toMatch(/redis\.(geoadd|zrem|sadd|srem)\(/);
  });

  it('keeps administrative driver status revocation on the atomic projection contract', () => {
    const adminStatusSource = fs.readFileSync(
      path.resolve(__dirname, '../../../services/dashboard-user-management-service.js'),
      'utf8'
    );

    expect(adminStatusSource).toContain('await commitDriverOnlineProjection(redis, {');
    expect(adminStatusSource).not.toMatch(/redis\.(geoadd|zrem|sadd|srem)\(/);
    expect(adminStatusSource).not.toContain('const multi = redis.multi();');
  });

  it('keeps administrative vehicle revocation on the atomic projection contract', () => {
    const dashboardSource = fs.readFileSync(
      path.resolve(__dirname, '../../../routes/dashboard.js'),
      'utf8'
    );
    const revocationStart = dashboardSource.indexOf('if (requestsOperationalRevocation)');
    const revocationEnd = dashboardSource.indexOf('// Melhor esforço: atualizar metadados', revocationStart);
    const revocationSource = dashboardSource.slice(revocationStart, revocationEnd);

    expect(revocationStart).toBeGreaterThan(-1);
    expect(revocationEnd).toBeGreaterThan(revocationStart);
    expect(revocationSource).toContain('await commitDriverOnlineProjection(redis, {');
    expect(revocationSource).not.toMatch(/redis\.(hset|geoadd|zrem|sadd|srem)\(/);
  });

  it('keeps stale-heartbeat cleanup on the atomic projection contract', () => {
    const cleanupSource = fs.readFileSync(
      path.resolve(__dirname, '../../../services/connection-cleanup-service.js'),
      'utf8'
    );
    const methodStart = cleanupSource.indexOf('async cleanupExpiredHeartbeats()');
    const methodEnd = cleanupSource.indexOf('async cleanupOrphanedConnections()', methodStart);
    const methodSource = cleanupSource.slice(methodStart, methodEnd);

    expect(methodStart).toBeGreaterThan(-1);
    expect(methodEnd).toBeGreaterThan(methodStart);
    expect(methodSource).toContain('await commitDriverOnlineProjection(this.redis, {');
    expect(methodSource).not.toMatch(/this\.redis\.(hset|geoadd|zrem|sadd|srem|multi)\(/);
  });

  it('keeps eligible GEO reconciliation on the conditional atomic projection contract', () => {
    const cleanupSource = fs.readFileSync(
      path.resolve(__dirname, '../../../services/connection-cleanup-service.js'),
      'utf8'
    );
    const methodStart = cleanupSource.indexOf('async cleanupEligibleGeoStaleDrivers()');
    const methodEnd = cleanupSource.indexOf('async getStats()', methodStart);
    const methodSource = cleanupSource.slice(methodStart, methodEnd);

    expect(methodStart).toBeGreaterThan(-1);
    expect(methodEnd).toBeGreaterThan(methodStart);
    expect(methodSource).toContain('commitDriverOnlineProjection(this.redis, projection)');
    expect(methodSource).toContain('expectedFields: {');
    expect(methodSource).toContain('presenceFreshAfterMs: isOnline && shouldRemoveForStale');
    expect(methodSource).not.toMatch(/this\.redis\.(hset|geoadd|zrem|sadd|srem|multi)\(/);
  });

  it('keeps KYC forced-offline transitions on the canonical atomic projection', () => {
    const kycStatusSource = fs.readFileSync(
      path.resolve(__dirname, '../../../services/kyc-driver-status-service.js'),
      'utf8'
    );
    const methodStart = kycStatusSource.indexOf('async forceDriverOffline(driverId, statusFields = {})');
    const methodEnd = kycStatusSource.indexOf('async processOnboardingResult', methodStart);
    const methodSource = kycStatusSource.slice(methodStart, methodEnd);

    expect(methodStart).toBeGreaterThan(-1);
    expect(methodEnd).toBeGreaterThan(methodStart);
    expect(methodSource).toContain('await commitDriverOnlineProjection(this.redis, {');
    expect(methodSource).toContain("dispatchEligibilityCode: 'KYC_BLOCKED'");
    expect(methodSource).not.toMatch(/this\.redis\.(hset|geoadd|sadd|srem|multi)\(/);
    expect(methodSource).not.toMatch(/this\.redis\.zrem\(['"]driver_locations/);
  });

  it('keeps the identity-reverification dispatch gate on one atomic projection', () => {
    const kycPolicySource = fs.readFileSync(
      path.resolve(__dirname, '../../../services/kyc-policy-service.js'),
      'utf8'
    );
    const methodStart = kycPolicySource.indexOf('async applyIdentityReverificationGate({');
    const methodEnd = kycPolicySource.indexOf('async markDriverForLivenessAttemptsExhausted', methodStart);
    const methodSource = kycPolicySource.slice(methodStart, methodEnd);

    expect(methodStart).toBeGreaterThan(-1);
    expect(methodEnd).toBeGreaterThan(methodStart);
    expect(methodSource).toContain('await commitDriverOnlineProjection(this.redis, {');
    expect(methodSource).toContain("projectionScope: 'eligibility_only'");
    expect(methodSource).toContain("dispatchEligibilityCode: 'KYC_REVERIFY_REQUIRED'");
    expect(methodSource).not.toMatch(/this\.redis\.(hset|geoadd|zrem|sadd|srem|multi)\(/);
  });

  it('serializes only defined hash fields', () => {
    expect(normalizeHashFields({
      status: 'AVAILABLE',
      dispatchEligible: true,
      empty: null,
      missing: undefined
    })).toEqual([
      'status', 'AVAILABLE',
      'dispatchEligible', 'true'
    ]);
  });
});
