import {
  buildStreetBands,
  carRevealDistances,
  nearestNodeIndex,
  segmentsToSvgPath,
  streetDistances,
} from '../src/components/prototype/streetSearchGraph';

// A small L-shaped street: 0 - 1 - 2, and 2 - 3 going north. Node 4 is unconnected.
const GRAPH = {
  nodes: [
    [-22.9500, -43.3600],
    [-22.9500, -43.3590],
    [-22.9500, -43.3580],
    [-22.9490, -43.3580],
    [-22.9400, -43.3400],
  ],
  edges: [[0, 1], [1, 2], [2, 3]],
};

describe('street search graph', () => {
  it('walks distances along the streets, not in a straight line', () => {
    const dist = streetDistances(GRAPH, 0);
    expect(dist[0]).toBe(0);
    expect(dist[2]).toBeGreaterThan(dist[1]);
    // node 3 is reached through nodes 1 and 2 (≈ 102 + 102 + 111 m)
    expect(dist[3]).toBeGreaterThan(200);
    expect(dist[4]).toBe(Infinity);
  });

  it('groups reached streets into distance bands for the wave', () => {
    const dist = streetDistances(GRAPH, 0);
    const bands = buildStreetBands({
      graph: GRAPH, dist, maxDistanceM: 300, bandCount: 3,
      project: (lat, lng) => ({ x: (lng + 43.36) * 1e4, y: (-22.95 - lat) * 1e4 }),
    });
    expect(bands.map((b) => b.length)).toEqual([1, 1, 1]);
    expect(segmentsToSvgPath(bands[0])).toMatch(/^M0\.0 -?0\.0L10\.0 -?0\.0$/);
  });

  it('reveals a car when the wave reaches its street', () => {
    const dist = streetDistances(GRAPH, nearestNodeIndex(GRAPH.nodes, [-22.95, -43.36]).index);
    const [near, unreachable] = carRevealDistances({
      graph: GRAPH,
      dist,
      cars: [{ id: 'a', latitude: -22.9491, longitude: -43.3581 }, { id: 'b', latitude: -22.94, longitude: -43.34 }],
    });
    expect(near.revealM).toBeGreaterThan(300);
    expect(near.revealM).toBeLessThan(340);
    expect(unreachable.revealM).toBe(Infinity);
  });
});

describe('wave distances', () => {
  // Two streets that are close in a straight line but only connected far away.
  const SPLIT = {
    nodes: [
      [-22.9500, -43.3600], // 0 pickup side
      [-22.9500, -43.3590], // 1
      [-22.9490, -43.3590], // 2 across the expressway, 111 m north of 1
      [-22.9400, -43.3590], // 3 far connection point
    ],
    edges: [[0, 1], [1, 3], [3, 2]],
  };

  it('crosses a barrier with a small delay instead of the long detour', () => {
    const { streetDistances, waveDistances } = require('../src/components/prototype/streetSearchGraph');
    const street = streetDistances(SPLIT, 0);
    const wave = waveDistances(SPLIT, 0, SPLIT.nodes[0], 1.3);
    expect(street[2]).toBeGreaterThan(1500);
    expect(wave[2]).toBeLessThan(250);
    expect(wave[1]).toBeCloseTo(street[1], 0);
  });
});
