const {
  estimateRouteTollsFromCoordinates,
  estimateRouteTollsFromPolyline,
  resolveTollFeeFromPricingPayload,
  normalizeCatalog,
  getCatalogSnapshot,
  applyCatalogSnapshot,
  DEFAULT_CATALOG,
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

  test('normaliza e valida catálogo editável sem aceitar duplicidade de praça', () => {
    const catalog = normalizeCatalog({
      enabled: true,
      toleranceKm: 25,
      plazas: [{
        id: 'P09_LINHA_AMARELA',
        name: 'Linha Amarela',
        road: 'RJ-065',
        direction: 'bidirectional',
        lat: -22.87,
        lng: -43.3,
        fees: { car: { weekday: 4, weekend: 4 } }
      }]
    }, { strict: true, currentVersion: 2 });

    expect(catalog.version).toBe(2);
    expect(catalog.toleranceKm).toBe(10);
    expect(catalog.plazas[0]).toEqual(expect.objectContaining({
      id: 'p09_linha_amarela',
      active: true,
      fees: expect.objectContaining({
        truck: { weekday: 4, weekend: 4 }
      })
    }));

    expect(() => normalizeCatalog({
      plazas: [catalog.plazas[0], catalog.plazas[0]]
    }, { strict: true, currentVersion: 2 })).toThrow('ID de praça duplicado');
  });

  test('aplica snapshot editável imediatamente ao cálculo de rota', () => {
    const original = getCatalogSnapshot();
    try {
      applyCatalogSnapshot({
        ...DEFAULT_CATALOG,
        version: 8,
        toleranceKm: 2,
        plazas: [{
          ...DEFAULT_CATALOG.plazas.find((plaza) => plaza.id === 'p09_linha_amarela'),
          fees: { car: { weekday: 6.5, weekend: 6.5 }, truck: { weekday: 13, weekend: 13 } }
        }]
      });

      const result = estimateRouteTollsFromPolyline('nuujC~|kgG_|B_|B_|B_|B', {
        now: new Date('2026-06-26T12:00:00.000Z')
      });
      expect(result.tollFee).toBe(6.5);
      expect(result.catalogVersion).toBe(8);
    } finally {
      applyCatalogSnapshot(original);
    }
  });
});
