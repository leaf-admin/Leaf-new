const h3 = require('h3-js');
const pricingH3ReadModelService = require('../../../services/pricing-h3-read-model-service');

class FakeRedis {
  constructor() {
    this.hashes = new Map();
    this.strings = new Map();
  }

  _ensureHash(key) {
    if (!this.hashes.has(key)) {
      this.hashes.set(key, {});
    }
    return this.hashes.get(key);
  }

  async hget(key, field) {
    return this.hashes.get(key)?.[field] ?? null;
  }

  async hgetall(key) {
    return { ...(this.hashes.get(key) || {}) };
  }

  async get(key) {
    return this.strings.get(key) ?? null;
  }

  pipeline() {
    const steps = [];
    const api = {
      hset: (key, fieldOrObject, value) => {
        steps.push(async () => {
          const hash = this._ensureHash(key);
          if (typeof fieldOrObject === 'object' && fieldOrObject !== null && value === undefined) {
            Object.entries(fieldOrObject).forEach(([field, fieldValue]) => {
              hash[field] = String(fieldValue);
            });
          } else {
            hash[fieldOrObject] = String(value);
          }
          return 'OK';
        });
        return api;
      },
      hdel: (key, field) => {
        steps.push(async () => {
          const hash = this.hashes.get(key) || {};
          delete hash[field];
          return 1;
        });
        return api;
      },
      hincrby: (key, field, delta) => {
        steps.push(async () => {
          const hash = this._ensureHash(key);
          const current = Number(hash[field] || 0);
          hash[field] = String(current + Number(delta));
          return Number(hash[field]);
        });
        return api;
      },
      hgetall: (key) => {
        steps.push(async () => ({ ...(this.hashes.get(key) || {}) }));
        return api;
      },
      get: (key) => {
        steps.push(async () => this.strings.get(key) ?? null);
        return api;
      },
      set: (key, value) => {
        steps.push(async () => {
          this.strings.set(key, String(value));
          return 'OK';
        });
        return api;
      },
      expire: () => {
        steps.push(async () => 1);
        return api;
      },
      exec: async () => {
        const results = [];
        for (const step of steps) {
          try {
            results.push([null, await step()]);
          } catch (error) {
            results.push([error, null]);
          }
        }
        return results;
      }
    };
    return api;
  }
}

describe('pricing-h3-read-model-service', () => {
  test('mantém contadores H3 coerentes ao mover driver e booking pelo lifecycle ativo', async () => {
    const redis = new FakeRedis();
    const pickup = { lat: -22.9075, lng: -43.1736 };
    const tripLocation = { lat: -22.909, lng: -43.18 };
    const resolution = pricingH3ReadModelService.DEFAULT_RESOLUTION;
    const pickupCell = h3.latLngToCell(pickup.lat, pickup.lng, resolution);
    const tripCell = h3.latLngToCell(tripLocation.lat, tripLocation.lng, resolution);

    await pricingH3ReadModelService.applyDriverSnapshot(redis, {
      driverId: 'driver-1',
      lat: pickup.lat,
      lng: pickup.lng,
      isOnline: true,
      available: true
    });

    await pricingH3ReadModelService.applyBookingSnapshot(redis, {
      bookingId: 'booking-1',
      status: 'SEARCHING',
      pickupLocation: pickup
    });

    let aggregated = await pricingH3ReadModelService.getAggregatedCells(redis, {
      cells: [pickupCell],
      maxStaleMs: 60_000
    });

    expect(aggregated.usable).toBe(true);
    expect(aggregated.cells[0].metrics.availableDrivers).toBe(1);
    expect(aggregated.cells[0].metrics.openRequests).toBe(1);
    expect(aggregated.cells[0].metrics.activeTrips).toBe(0);

    await pricingH3ReadModelService.applyDriverSnapshot(redis, {
      driverId: 'driver-1',
      lat: pickup.lat,
      lng: pickup.lng,
      isOnline: true,
      available: false
    });

    await pricingH3ReadModelService.applyBookingSnapshot(redis, {
      bookingId: 'booking-1',
      status: 'ACCEPTED',
      pickupLocation: pickup,
      currentLocation: tripLocation
    });

    aggregated = await pricingH3ReadModelService.getAggregatedCells(redis, {
      cells: [pickupCell, tripCell],
      maxStaleMs: 60_000
    });

    const pickupMetrics = aggregated.cells.find((cell) => cell.h3Index === pickupCell)?.metrics;
    const tripMetrics = aggregated.cells.find((cell) => cell.h3Index === tripCell)?.metrics;

    expect(pickupMetrics.availableDrivers).toBe(0);
    expect(pickupMetrics.busyDrivers).toBe(1);
    expect(pickupMetrics.openRequests).toBe(0);
    expect(tripMetrics.activeTrips).toBe(1);

    await pricingH3ReadModelService.clearBookingSnapshot(redis, 'booking-1');
    await pricingH3ReadModelService.applyDriverSnapshot(redis, {
      driverId: 'driver-1',
      lat: pickup.lat,
      lng: pickup.lng,
      isOnline: true,
      available: true
    });

    aggregated = await pricingH3ReadModelService.getAggregatedCells(redis, {
      cells: [pickupCell, tripCell],
      maxStaleMs: 60_000
    });

    const finalPickupMetrics = aggregated.cells.find((cell) => cell.h3Index === pickupCell)?.metrics;
    const finalTripMetrics = aggregated.cells.find((cell) => cell.h3Index === tripCell)?.metrics;

    expect(finalPickupMetrics.availableDrivers).toBe(1);
    expect(finalPickupMetrics.busyDrivers).toBe(0);
    expect(finalTripMetrics.activeTrips).toBe(0);
  });

  test('usa células frescas mesmo quando parte do anel está stale', async () => {
    const redis = new FakeRedis();
    const resolution = pricingH3ReadModelService.DEFAULT_RESOLUTION;
    const freshCell = h3.latLngToCell(-22.9075, -43.1736, resolution);
    const staleCell = h3.latLngToCell(-22.909, -43.18, resolution);
    const nowIso = new Date().toISOString();
    const staleIso = new Date(Date.now() - 60_000).toISOString();

    const freshKey = pricingH3ReadModelService.__private.buildCellKey(resolution, freshCell);
    const staleKey = pricingH3ReadModelService.__private.buildCellKey(resolution, staleCell);

    redis.hashes.set(freshKey, {
      availableDrivers: '2',
      updatedAt: nowIso
    });

    redis.hashes.set(staleKey, {
      availableDrivers: '7',
      openRequests: '3',
      updatedAt: staleIso
    });

    const aggregated = await pricingH3ReadModelService.getAggregatedCells(redis, {
      cells: [freshCell, staleCell],
      maxStaleMs: 15_000
    });

    expect(aggregated.usable).toBe(true);
    expect(aggregated.reason).toBe('partial_stale');
    expect(aggregated.touchedCells).toBe(2);
    expect(aggregated.staleCells).toBe(1);
    expect(aggregated.freshTouchedCells).toBe(1);

    const freshMetrics = aggregated.cells.find((cell) => cell.h3Index === freshCell)?.metrics;
    const staleMetrics = aggregated.cells.find((cell) => cell.h3Index === staleCell)?.metrics;

    expect(freshMetrics.availableDrivers).toBe(2);
    expect(staleMetrics.availableDrivers).toBe(0);
    expect(staleMetrics.openRequests).toBe(0);
  });

  test('considera anel vazio como utilizável quando o read-model global está fresco', async () => {
    const redis = new FakeRedis();
    const resolution = pricingH3ReadModelService.DEFAULT_RESOLUTION;
    const originCell = h3.latLngToCell(-22.9075, -43.1736, resolution);
    const neighborCell = h3.gridDisk(originCell, 1).find((cell) => cell !== originCell);
    const metaKey = pricingH3ReadModelService.__private.buildMetaKey(resolution);

    redis.strings.set(metaKey, new Date().toISOString());

    const aggregated = await pricingH3ReadModelService.getAggregatedCells(redis, {
      cells: [originCell, neighborCell],
      maxStaleMs: 15_000
    });

    expect(aggregated.usable).toBe(true);
    expect(aggregated.reason).toBe('empty_fresh_model');
    expect(aggregated.touchedCells).toBe(0);
    expect(aggregated.cells).toHaveLength(2);
    aggregated.cells.forEach((cell) => {
      expect(cell.metrics.availableDrivers).toBe(0);
      expect(cell.metrics.openRequests).toBe(0);
      expect(cell.metrics.activeTrips).toBe(0);
    });
  });

  test('aceita anel totalmente stale quando o modelo global segue vivo', async () => {
    const redis = new FakeRedis();
    const resolution = pricingH3ReadModelService.DEFAULT_RESOLUTION;
    const staleCell = h3.latLngToCell(-22.9075, -43.1736, resolution);
    const metaKey = pricingH3ReadModelService.__private.buildMetaKey(resolution);
    const cellKey = pricingH3ReadModelService.__private.buildCellKey(resolution, staleCell);

    redis.strings.set(metaKey, new Date().toISOString());
    redis.hashes.set(cellKey, {
      availableDrivers: '3',
      openRequests: '2',
      updatedAt: new Date(Date.now() - 60_000).toISOString()
    });

    const aggregated = await pricingH3ReadModelService.getAggregatedCells(redis, {
      cells: [staleCell],
      maxStaleMs: 15_000
    });

    expect(aggregated.usable).toBe(true);
    expect(aggregated.reason).toBe('all_stale_but_model_live');
    expect(aggregated.touchedCells).toBe(1);
    expect(aggregated.staleCells).toBe(1);
    expect(aggregated.freshTouchedCells).toBe(0);
    expect(aggregated.cells[0].metrics.availableDrivers).toBe(3);
    expect(aggregated.cells[0].metrics.openRequests).toBe(2);
  });
});
