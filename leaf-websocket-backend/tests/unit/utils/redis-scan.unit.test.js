const fs = require('fs');
const path = require('path');

jest.mock('../../../utils/logger', () => ({
  logger: { debug: jest.fn(), error: jest.fn(), info: jest.fn(), warn: jest.fn() }
}));

const RedisScan = require('../../../utils/redis-scan');

describe('RedisScan.scanKeys', () => {
  it('iterates the cursor and drops keys SCAN returned more than once', async () => {
    const redis = {
      scan: jest.fn()
        .mockResolvedValueOnce(['7', ['driver_lock:a', 'driver_lock:b']])
        .mockResolvedValueOnce(['0', ['driver_lock:b', 'driver_lock:c']])
    };

    await expect(RedisScan.scanKeys(redis, 'driver_lock:*', 500)).resolves.toEqual([
      'driver_lock:a',
      'driver_lock:b',
      'driver_lock:c'
    ]);
    expect(redis.scan).toHaveBeenNthCalledWith(1, '0', 'MATCH', 'driver_lock:*', 'COUNT', 500);
    expect(redis.scan).toHaveBeenNthCalledWith(2, '7', 'MATCH', 'driver_lock:*', 'COUNT', 500);
  });

  it('stops early at maxKeys', async () => {
    const redis = { scan: jest.fn().mockResolvedValueOnce(['5', ['k:1', 'k:2', 'k:3']]) };

    await expect(RedisScan.scanKeys(redis, 'k:*', 100, 2)).resolves.toEqual(['k:1', 'k:2']);
    expect(redis.scan).toHaveBeenCalledTimes(1);
  });
});

const ROOT = path.resolve(__dirname, '../../..');
// Runtime code only; scripts and tests are not checked.
const RUNTIME_DIRS = [
  'services', 'routes', 'bootstrap', 'workers', 'middleware', 'commands',
  'listeners', 'utils', 'consumers', 'monitoring', 'graphql'
];

function runtimeFiles() {
  const walk = (dir) => (fs.existsSync(path.join(ROOT, dir))
    ? fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
      const relative = `${dir}/${entry.name}`;
      if (entry.isDirectory()) return walk(relative);
      return entry.name.endsWith('.js') ? [relative] : [];
    })
    : []);
  return RUNTIME_DIRS.flatMap(walk).filter((file) => file !== 'utils/redis-scan.js');
}

describe('blocking KEYS usage', () => {
  it('is not used by active ioredis runtime code, including split subfolders', () => {
    // Not loaded by the server: KYCFaceProcessor (legacy, node-redis client).
    const allowed = new Set(['services/KYCFaceProcessor.js']);
    const offenders = runtimeFiles()
      .filter((file) => !allowed.has(file))
      .filter((file) => /\.keys\(\s*['`]/.test(fs.readFileSync(path.join(ROOT, file), 'utf8')));

    expect(offenders).toEqual([]);
  });
});

// Every keyspace SCAN grows with the number of keys. These are the call sites
// that exist today (2026-10-15); hot paths use index sets or caches instead
// (#290, #307). A new SCAN, or more SCANs in a file, must be a deliberate
// choice: prefer an index set, and only then raise the budget here.
const SCAN_BUDGET = {
  'services/IntegratedKYCService.js': 3,
  'services/booking-search-index.js': 1, // reconcile at most once a minute (#310)
  'services/KYCAnalyticsService.js': 2,
  'services/KYCFaceProcessor.js': 2,
  'services/connection-cleanup-service.js': 4, // reconcile every 30 cycles
  'services/driver-lock-manager.js': 2,
  'services/fcm-service.js': 5,
  'services/geospatial-cache.js': 3,
  'services/h3-map-service.js': 3, // booking_search key list cached 30 s
  'services/metrics-collector.js': 1,
  'services/metrics-history-service.js': 2,
  'services/radius-expansion-manager.js': 1,
  'services/ride-health-monitor.js': 1,
  'services/ride-queue-manager.js': 3, // index first; scan only as fallback/reconcile
  'services/trip-location-persistence-service.js': 1,
  'services/vehicle-lock-manager.js': 2,
  'routes/dashboard/03-overview-stats.js': 1,
  'routes/dashboard/shared.js': 1,
  'routes/notifications.js': 4,
  'routes/queue-monitoring.js': 2,
  'middleware/websocket-rate-limiter.js': 3,
  'utils/intelligent-cache.js': 1,
  'monitoring/smart-sync-alert-system.js': 2
};

describe('keyspace SCAN budget', () => {
  it('does not grow beyond the reviewed call sites', () => {
    const pattern = /\b(scanKeys|countKeys|scanIds)\s*\(|\.scan\s*\(|scanStream\s*\(|\.keys\(\s*['`]/g;
    const overBudget = runtimeFiles()
      .map((file) => [file, (fs.readFileSync(path.join(ROOT, file), 'utf8').match(pattern) || []).length])
      .filter(([file, count]) => count > (SCAN_BUDGET[file] || 0))
      .map(([file, count]) => `${file}: ${count} (budget ${SCAN_BUDGET[file] || 0})`);

    expect(overBudget).toEqual([]);
  });
});
