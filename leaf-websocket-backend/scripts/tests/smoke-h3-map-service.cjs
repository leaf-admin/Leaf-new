const service = require('../../services/h3-map-service');

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
  'booking_search:b1': { state: 'SEARCHING', pickupLocation: JSON.stringify({ lat: -23.5507, lng: -46.6338 }), createdAt: String(Date.now()) },
  'booking_search:b2': { state: 'REASSIGNMENT_PENDING', pickupLocation: JSON.stringify({ lat: -23.5558, lng: -46.6401 }), createdAt: String(Date.now()) },
};
const activeHash = {
  a1: JSON.stringify({ status: 'ACCEPTED', driverId: 'd2', currentLocation: { lat: -23.5512, lng: -46.6342 } }),
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

(async () => {
  const payload = await service.getCells({
    redis,
    bbox: '-46.65,-23.57,-46.62,-23.54',
    zoom: 14,
    surface: 'dashboard',
    includeBoundary: true,
  });

  console.log(JSON.stringify({
    ok: true,
    resolution: payload.resolution,
    summary: payload.summary,
    firstCell: payload.cells[0],
  }, null, 2));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
