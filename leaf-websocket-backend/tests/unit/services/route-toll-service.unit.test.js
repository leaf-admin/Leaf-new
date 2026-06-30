const {
  estimateRouteTollsFromCoordinates,
  estimateRouteTollsFromPolyline,
  resolveTollFeeFromPricingPayload,
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
});
