const streetGraphService = require('../../../services/street-graph-service');
const { readOsmPbf } = require('../../../utils/osm-pbf-reader');

// --- Minimal OSM PBF writer, just enough for a fixture -----------------------------------
const varint = (value) => {
  const out = [];
  let v = value;
  while (v >= 0x80) {
    out.push((v % 128) | 0x80);
    v = Math.floor(v / 128);
  }
  out.push(v);
  return Buffer.from(out);
};
const zz = (value) => (value < 0 ? -2 * value - 1 : 2 * value);
const key = (field, type) => varint(field * 8 + type);
const bytesField = (field, buf) => Buffer.concat([key(field, 2), varint(buf.length), buf]);
const varintField = (field, value) => Buffer.concat([key(field, 0), varint(value)]);
const packed = (field, values) => bytesField(field, Buffer.concat(values.map(varint)));
const deltaPacked = (field, values) => {
  let prev = 0;
  return packed(field, values.map((v) => {
    const d = zz(v - prev);
    prev = v;
    return d;
  }));
};

function osmPbf({ strings, nodes, ways }) {
  const stringTable = bytesField(1, Buffer.concat(strings.map((s) => bytesField(1, Buffer.from(s)))));
  const dense = bytesField(2, Buffer.concat([
    deltaPacked(1, nodes.map((n) => n.id)),
    deltaPacked(8, nodes.map((n) => Math.round(n.lat * 1e7))),
    deltaPacked(9, nodes.map((n) => Math.round(n.lng * 1e7))),
  ]));
  const wayMsgs = ways.map((w) => bytesField(3, Buffer.concat([
    varintField(1, w.id),
    packed(2, w.keys),
    packed(3, w.vals),
    deltaPacked(8, w.refs),
  ])));
  const block = Buffer.concat([stringTable, bytesField(2, dense), bytesField(2, Buffer.concat(wayMsgs))]);
  const blob = bytesField(1, block);
  const header = Buffer.concat([bytesField(1, Buffer.from('OSMData')), varintField(3, blob.length)]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(header.length);
  return Buffer.concat([len, header, blob]);
}
// -------------------------------------------------------------------------------------------

const FIXTURE = osmPbf({
  strings: ['', 'highway', 'residential', 'footway'],
  nodes: [
    { id: 1, lat: -22.9468, lng: -43.3577 },
    { id: 2, lat: -22.9470, lng: -43.3560 },
    { id: 3, lat: -22.9480, lng: -43.3550 },
    { id: 4, lat: -22.9490, lng: -43.3540 },
  ],
  ways: [
    { id: 10, keys: [1], vals: [2], refs: [1, 2, 3] },
    { id: 11, keys: [1], vals: [3], refs: [3, 4] },
  ],
});

function memoryRedis() {
  const hashes = new Map();
  const strings = new Map();
  return {
    async del(k) { hashes.delete(k); },
    async hset(k, obj) { hashes.set(k, { ...(hashes.get(k) || {}), ...obj }); },
    async hmget(k, ...fields) { const h = hashes.get(k) || {}; return fields.map((f) => h[f] ?? null); },
    async rename(a, b) { hashes.set(b, hashes.get(a)); hashes.delete(a); },
    async set(k, v) { strings.set(k, v); },
    async get(k) { return strings.get(k) ?? null; },
  };
}

describe('street graph service', () => {
  it('reads dense nodes and ways from an OSM PBF', () => {
    const nodes = [];
    const ways = [];
    readOsmPbf(FIXTURE, {
      onNode: (id, lat, lng) => nodes.push([id, Number(lat.toFixed(4)), Number(lng.toFixed(4))]),
      onWay: (id, tags, refs) => ways.push([id, tags.highway, refs]),
    });
    expect(nodes[0]).toEqual([1, -22.9468, -43.3577]);
    expect(ways).toEqual([[10, 'residential', [1, 2, 3]], [11, 'footway', [3, 4]]]);
  });

  it('keeps only drivable streets and serves the neighbourhood around a point', async () => {
    const graph = streetGraphService.buildStreetGraph(FIXTURE);
    expect(graph.wayCount).toBe(1); // the footway is dropped
    expect(graph.edgeCount).toBe(2);

    const redis = memoryRedis();
    await streetGraphService.storeStreetGraph(redis, graph, { source: 'fixture' });
    const around = await streetGraphService.getStreetGraphAround(redis, { lat: -22.9468, lng: -43.3577, radiusM: 1200 });
    expect(around.nodes).toHaveLength(3);
    expect(around.edges).toEqual([[0, 1], [1, 2]]);

    const meta = await streetGraphService.getStreetGraphMeta(redis);
    expect(meta.edges).toBe(2);
  });

  it('only rebuilds when the graph is missing or older than a month', async () => {
    const redis = memoryRedis();
    const axios = { get: jest.fn(async () => ({ data: FIXTURE, headers: { 'last-modified': 'x' } })) };
    const first = await streetGraphService.rebuildStreetGraphIfStale(redis, { axios });
    const second = await streetGraphService.rebuildStreetGraphIfStale(redis, { axios });
    expect(first.rebuilt).toBe(true);
    expect(second).toMatchObject({ rebuilt: false, reason: 'fresh' });
    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  it('rejects a request without coordinates', async () => {
    await expect(streetGraphService.getStreetGraphAround(memoryRedis(), {})).rejects.toMatchObject({ statusCode: 400 });
  });
});
