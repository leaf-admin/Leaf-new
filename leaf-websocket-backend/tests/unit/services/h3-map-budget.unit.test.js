const { H3MapService } = require('../../../services/h3-map-service');
const bbox = { minLat: -22.96, maxLat: -22.95, minLng: -43.4, maxLng: -43.39 };

describe('H3 compute admission', () => {
  test('coalesces an identical viewport and does not retain failed promises', async () => {
    const service = new H3MapService();
    let release;
    service.computeCells = jest.fn(() => new Promise(resolve => { release = resolve; }));
    const first = service.getCells({ redis: {}, bbox: '-43.4,-22.96,-43.39,-22.95', zoom: 14 });
    const second = service.getCells({ redis: {}, bbox: '-43.4,-22.96,-43.39,-22.95', zoom: 14 });
    expect(service.computeCells).toHaveBeenCalledTimes(1);
    release({ cells: [] });
    expect(await first).toEqual(await second);
    expect(service.inflight.size).toBe(0);
    service.computeCells.mockRejectedValueOnce(new Error('unavailable'));
    await expect(service.getCells({ redis: {}, bbox: '-43.4,-22.96,-43.39,-22.95', zoom: 14 })).rejects.toThrow('unavailable');
    expect(service.inflight.size).toBe(0);
  });

  test('rejects extra distinct misses instead of growing an unbounded compute queue', async () => {
    const service = new H3MapService();
    const release = [];
    service.computeCells = jest.fn(() => new Promise(resolve => release.push(resolve)));
    const pending = Array.from({ length: 8 }, (_, i) => service.getCells({ redis: {},
      bbox: `-43.4,${bbox.minLat - i * .001},-43.39,-22.95`, zoom: 14 }));
    await expect(service.getCells({ redis: {}, bbox: '-43.4,-22.96,-43.39,-22.95', zoom: 16 })).rejects.toMatchObject({ statusCode: 503 });
    release.forEach(resolve => resolve({ cells: [] }));
    await Promise.all(pending);
  });
});
