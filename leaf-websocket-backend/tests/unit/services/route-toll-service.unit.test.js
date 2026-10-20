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

  describe('praça de duas cabines (P10 Transolímpica)', () => {
    // Passagem real no sentido sul, pontos da rota sugerida da QA (2026-10-20).
    const southbound = [
      { latitude: -22.91885, longitude: -43.39671 },
      { latitude: -22.91910, longitude: -43.39671 },
      { latitude: -22.91942, longitude: -43.39674 },
      { latitude: -22.91966, longitude: -43.39677 },
      { latitude: -22.92005, longitude: -43.39683 },
    ];

    test('uma passagem no sentido sul conta só a P10b', () => {
      expect(findCrossedTolls(southbound).map((toll) => toll.id)).toEqual(['p10b_transolimpica']);
    });

    test('cobra a tarifa atual de carro (R$ 9,95, conferida em 2026-10-20)', () => {
      expect(findCrossedTolls(southbound)[0].amount).toBe(9.95);
    });

    test('oscilação de poucos metros para o norte não conta a P10a', () => {
      const jitter = [
        { latitude: -22.91942, longitude: -43.39674 },
        { latitude: -22.91938, longitude: -43.39674 },
      ];
      expect(findCrossedTolls(jitter)).toEqual([]);
    });

    test('a cabine gêmea não soma na mesma janela de passagem', () => {
      const at = 1792481675018;
      const merged = mergeTollCrossings(
        [{ id: 'p10b_transolimpica', amount: 8.95, at }],
        [{ id: 'p10a_transolimpica', amount: 8.95, at: at + 10800 }]
      );
      expect(merged.map((crossing) => crossing.id)).toEqual(['p10b_transolimpica']);
      expect(summarizeTollCrossings({ tollCrossingsTracked: true, tollCrossings: merged }).crossedTollFee).toBe(8.95);

      const laterReturn = mergeTollCrossings(merged, [{ id: 'p10a_transolimpica', amount: 8.95, at: at + 11 * 60 * 1000 }]);
      expect(laterReturn.map((crossing) => crossing.id)).toEqual(['p10b_transolimpica', 'p10a_transolimpica']);
    });
  });

  describe('praça de duas cabines (P06/P07 Viúva Graça)', () => {
    const throughPlaza = [
      { latitude: -22.74, longitude: -43.49 },
      { latitude: -22.7525, longitude: -43.5005 },
      { latitude: -22.765, longitude: -43.51 },
    ];

    test('a rota estimada cobra uma cabine só', () => {
      const result = estimateRouteTollsFromCoordinates(throughPlaza, {
        now: new Date('2026-10-20T12:00:00.000Z'),
      });
      expect(result.tolls).toHaveLength(1);
      expect(result.tollFee).toBe(16.4);
    });

    test('a travessia real conta uma cabine só', () => {
      expect(findCrossedTolls(throughPlaza)).toHaveLength(1);
    });
  });
});
