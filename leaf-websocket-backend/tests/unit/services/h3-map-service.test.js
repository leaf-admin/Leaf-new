const { H3MapService, helpers } = require('../../../services/h3-map-service');

describe('H3MapService', () => {
  test('resolve resolution from zoom bands', () => {
    expect(helpers.resolutionForZoom(10)).toBe(6);
    expect(helpers.resolutionForZoom(12)).toBe(7);
    expect(helpers.resolutionForZoom(14)).toBe(8);
    expect(helpers.resolutionForZoom(16)).toBe(9);
    expect(helpers.resolutionForZoom(17)).toBe(10);
  });

  test('driver surface exposes dynamic fare regions only when surcharge exists', () => {
    const normalStyle = helpers.buildStyle('low', 'driver', 8, {
      demand: 0,
      availableDrivers: 3,
      imbalance: 0,
      surplus: 3,
    });
    expect(normalStyle.fillOpacity).toBe(0);
    expect(normalStyle.strokeOpacity).toBe(0);

    const surge = helpers.buildSurgeDisplay({
      demand: 8,
      availableDrivers: 0,
      openRequests: 8,
      activeTrips: 0,
      imbalance: 8,
      surplus: -8,
    }, 'critical');
    expect(surge.percent).toBeLessThanOrEqual(35);
    expect(surge.level).toBe('purple');
    expect(surge.label).toMatch(/^\+/);

    const hotStyle = helpers.buildStyle('critical', 'driver', 8, {
      demand: 8,
      availableDrivers: 0,
      openRequests: 8,
      activeTrips: 0,
      imbalance: 8,
      surplus: -8,
    });
    expect(hotStyle.fill).toBe('#7E22CE');
    expect(hotStyle.fillOpacity).toBeGreaterThan(0);
  });

  test('applies backend visual policy without changing the surcharge cap', () => {
    const visualPolicy = {
      opacity: 0.5,
      palette: {
        purple: '#123456',
        purpleStroke: '#654321',
      },
      label: {
        enabled: true,
        minPercent: 20,
        template: 'extra {percent}%'
      }
    };
    const metrics = {
      demand: 8,
      availableDrivers: 0,
      openRequests: 8,
      activeTrips: 0,
      imbalance: 8,
      surplus: -8,
    };

    const surge = helpers.buildSurgeDisplay(metrics, 'critical', visualPolicy);
    const style = helpers.buildStyle('critical', 'driver', 8, metrics, visualPolicy);

    expect(surge.percent).toBe(35);
    expect(surge.label).toBe('extra 35%');
    expect(surge.labelVisible).toBe(true);
    expect(style.fill).toBe('#123456');
    expect(style.stroke).toBe('#654321');
    expect(style.fillOpacity).toBeLessThan(0.3);
    expect(style.strokeOpacity).toBeLessThan(style.fillOpacity);
    expect(style.strokeWidth).toBeLessThanOrEqual(0.4);
  });

  test('hides the driver overlay when runtime policy is disabled', () => {
    const metrics = {
      demand: 8,
      availableDrivers: 0,
      openRequests: 8,
      activeTrips: 0,
      imbalance: 8,
      surplus: -8,
    };
    const policy = {
      enabled: false,
      label: {
        enabled: true,
        minPercent: 1,
        template: '+{percent}%'
      }
    };

    const surge = helpers.buildSurgeDisplay(metrics, 'critical', policy);
    const style = helpers.buildStyle('critical', 'driver', 8, metrics, policy);

    expect(surge.percent).toBe(35);
    expect(surge.labelVisible).toBe(false);
    expect(style.fillOpacity).toBe(0);
    expect(style.strokeOpacity).toBe(0);
  });

  test('builds h3 payload from redis-backed snapshot', async () => {
    const service = new H3MapService();
    const driverGeo = {
      d1: [-46.6335, -23.5505],
      d2: [-46.6341, -23.5511],
      d3: [-46.6402, -23.556],
    };
    const driverHashes = {
      d1: { status: 'available', isOnline: 'true' },
      d2: { status: 'busy', isOnline: 'true' },
      d3: { status: 'available', isOnline: 'true' },
    };
    const searchHashes = {
      'booking_search:b1': {
        state: 'SEARCHING',
        pickupLocation: JSON.stringify({ lat: -23.5507, lng: -46.6338 }),
        createdAt: String(Date.now()),
      },
    };
    const activeHash = {
      a1: JSON.stringify({
        status: 'ACCEPTED',
        driverId: 'd2',
        currentLocation: { lat: -23.5512, lng: -46.6342 },
      }),
    };

    const redis = {
      async zrange(key) {
        if (key === 'driver_locations') return Object.keys(driverGeo);
        if (key === 'driver_locations_eligible') return ['d1', 'd3'];
        return [];
      },
      pipeline() {
        const commands = [];
        return {
          geopos(key, id) {
            commands.push(['geopos', key, id]);
          },
          hgetall(key) {
            commands.push(['hgetall', key]);
          },
          async exec() {
            return commands.map(([op, key, value]) => {
              if (op === 'geopos') return [null, [driverGeo[value] || null]];
              if (op === 'hgetall') {
                if (key.startsWith('driver:')) return [null, driverHashes[key.replace('driver:', '')] || {}];
                return [null, searchHashes[key] || {}];
              }
              return [null, null];
            });
          },
        };
      },
      async scan(cursor, _matchLiteral, pattern) {
        return [String(0), pattern === 'booking_search:*' ? Object.keys(searchHashes) : []];
      },
      async hgetall(key) {
        if (key === 'bookings:active') return activeHash;
        return {};
      },
    };

    const result = await service.getCells({
      redis,
      bbox: '-46.65,-23.57,-46.62,-23.54',
      zoom: 14,
      surface: 'dashboard',
      includeBoundary: true,
    });

    expect(result.resolution).toBe(8);
    expect(result.summary.driversOnline).toBe(3);
    expect(result.summary.openRequests).toBe(1);
    expect(result.summary.activeTrips).toBe(1);
    expect(result.summary).toHaveProperty('surgeCells');
    expect(result.summary).toHaveProperty('maxSurgePercent');
    expect(result.source).toBe('leaf_internal_supply_demand');
    expect(result.paidProviderCalls).toBe(false);
    expect(result.refreshPolicy.pollIntervalMs).toBeGreaterThanOrEqual(30000);
    expect(result.refreshPolicy.trafficLayerEnabled).toBe(true);
    expect(result.cells.reduce((sum, cell) => sum + cell.metrics.demand, 0)).toBe(1);
    expect(Array.isArray(result.cells)).toBe(true);
    expect(result.cells.length).toBeGreaterThan(0);
    expect(result.cells[0].boundary.length).toBeGreaterThanOrEqual(6);
  });

  test('collectActiveTrips limpa bookings terminais e stale do hash ativo', async () => {
    const service = new H3MapService();
    const deleted = [];
    const staleTs = Date.now() - (13 * 60 * 60 * 1000);
    const activeHash = {
      keep_active: JSON.stringify({
        status: 'IN_PROGRESS',
        updatedAt: new Date().toISOString(),
        currentLocation: { lat: -23.5512, lng: -46.6342 },
      }),
      drop_completed: JSON.stringify({
        status: 'COMPLETED',
        completedAt: new Date(staleTs).toISOString(),
        currentLocation: { lat: -23.5512, lng: -46.6342 },
      }),
      drop_stale: JSON.stringify({
        status: 'IN_PROGRESS',
        updatedAt: String(staleTs),
        currentLocation: { lat: -23.5512, lng: -46.6342 },
      }),
    };

    const redis = {
      async hgetall(key) {
        if (key === 'bookings:active') return activeHash;
        return {};
      },
      pipeline() {
        return {
          hdel(_key, bookingId) {
            deleted.push(bookingId);
          },
          async exec() {
            return [];
          },
        };
      },
    };

    const trips = await service.collectActiveTrips(redis, {
      minLng: -46.65,
      minLat: -23.57,
      maxLng: -46.62,
      maxLat: -23.54,
    });

    expect(trips).toHaveLength(1);
    expect(trips[0].bookingId).toBe('keep_active');
    expect(deleted.sort()).toEqual(['drop_completed', 'drop_stale']);
  });
});
