'use strict';

const {
  DRIVER_ONLINE_PROJECTION_SCRIPT,
  commitDriverOnlineProjection,
  normalizeGeoCoordinates,
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
      hasLocation: true
    });
    expect(redis.eval).toHaveBeenCalledTimes(1);
    expect(redis.eval).toHaveBeenCalledWith(
      DRIVER_ONLINE_PROJECTION_SCRIPT,
      4,
      'driver:driver_1',
      'driver_locations',
      'driver_locations_eligible',
      'online_drivers',
      'driver_1',
      '1',
      '1',
      '-43.4059',
      '-22.9207',
      '1',
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
    expect(DRIVER_ONLINE_PROJECTION_SCRIPT).toContain("local key_expectations = { 'hash', 'zset', 'zset', 'set' }");
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
    expect(args.slice(2, 6)).toEqual([
      'driver:driver_1',
      'driver_locations',
      'driver_locations_eligible',
      'online_drivers'
    ]);
    expect(args.slice(6, 12)).toEqual(['driver_1', '0', '0', '', '', '0']);
    expect(DRIVER_ONLINE_PROJECTION_SCRIPT).toContain("redis.call('SREM', KEYS[4], driver_id)");
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
