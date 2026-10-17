const {
  estimateRouteTollsFromCoordinates,
  estimateRouteTollsFromPolyline,
  resolveTollFeeFromPricingPayload,
  findCrossedTolls,
  mergeTollCrossings,
  summarizeTollCrossings,
  TOLL_PLAZAS,
} = require('../../../services/route-toll-service');

describe('route-toll-service', () => {
  test('detecta Linha Amarela quando a polyline cruza a praca P09', () => {
    const result = estimateRouteTollsFromPolyline('nuujC~|kgG_|B_|B_|B_|B', {
      now: new Date('2026-06-26T12:00:00.000Z'),
    });

    expect(result.tollFee).toBe(4);
    expect(result.tolls).toEqual([
      expect.objectContaining({
        id: 'p09_linha_amarela',
        name: 'P09 - Linha Amarela',
        amount: 4,
      }),
    ]);
  });

  test('nao cobra pedágio quando a rota nao cruza nenhuma praca cadastrada', () => {
    const result = estimateRouteTollsFromCoordinates([
      { latitude: -22.9068, longitude: -43.1729 },
      { latitude: -22.91, longitude: -43.18 },
    ]);

    expect(result.tollFee).toBe(0);
    expect(result.tolls).toEqual([]);
  });

  test('resolve pedágio por geometria antes do fallback tollFee do payload', () => {
    const result = resolveTollFeeFromPricingPayload({
      routePolyline: 'nuujC~|kgG_|B_|B_|B_|B',
      tollFee: 99,
    });

    expect(result.tollFee).toBe(4);
    expect(result.source).toBe('leaf_toll_catalog');
  });

  describe('crossing detection for the executed trip', () => {
    const plaza = TOLL_PLAZAS.find((toll) => toll.id === 'p10a_transolimpica');

    test('counts a north-bound segment that passes the plaza', () => {
      const crossed = findCrossedTolls([
        { lat: plaza.lat - 0.003, lng: plaza.lng },
        { lat: plaza.lat + 0.003, lng: plaza.lng },
      ]);
      expect(crossed.map((toll) => toll.id)).toEqual(['p10a_transolimpica']);
    });

    test('does not count a car that stayed about 1 km away (production case, 2026-10-16)', () => {
      const pickup = { lat: -22.9207704, lng: -43.4059848 };
      expect(findCrossedTolls([pickup, { lat: pickup.lat + 0.0001, lng: pickup.lng }])).toEqual([]);
    });

    test('counts one crossing when consecutive segments both touch the plaza', () => {
      const merged = mergeTollCrossings(
        [{ id: 'p09_linha_amarela', amount: 4, at: 1000 }],
        [{ id: 'p09_linha_amarela', amount: 4, at: 5000 }]
      );
      expect(merged).toHaveLength(1);
      expect(mergeTollCrossings(merged, [{ id: 'p09_linha_amarela', amount: 4, at: 1000 + 11 * 60 * 1000 }])).toHaveLength(2);
    });

    test('summarizes only crossings after the trip start and flags untracked trips', () => {
      const metrics = {
        tollCrossingsTracked: true,
        tollCrossings: [
          { id: 'p09_linha_amarela', amount: 4, at: 500 },
          { id: 'p10a_transolimpica', amount: 8.95, at: 2000 },
        ],
      };
      expect(summarizeTollCrossings(metrics, { startedAtMs: 1000 })).toEqual({
        verified: true,
        crossedTollFee: 8.95,
        plazas: ['p10a_transolimpica'],
      });
      expect(summarizeTollCrossings({ tollCrossingsTracked: false, tollCrossings: [] }).verified).toBe(false);
      expect(summarizeTollCrossings(null).verified).toBe(false);
    });
  });
});
