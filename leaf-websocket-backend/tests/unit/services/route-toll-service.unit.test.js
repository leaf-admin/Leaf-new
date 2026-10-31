const {
  decodePolyline,
  estimateRouteTollsFromCoordinates,
  estimateRouteTollsFromPolyline,
  resolveTollFeeFromPricingPayload,
  findCrossedTolls,
  mergeTollCrossings,
  summarizeTollCrossings,
  TOLL_PLAZAS,
} = require('../../../services/route-toll-service');
const tollRoutes = require('./fixtures/toll-routes.json');

describe('route-toll-service', () => {
  test('detecta Linha Amarela quando a polyline cruza a praca P09', () => {
    const result = estimateRouteTollsFromPolyline(tollRoutes.linhaAmarelaWestbound, {
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
      routePolyline: tollRoutes.linhaAmarelaWestbound,
      tollFee: 99,
    });

    expect(result.tollFee).toBe(4);
    expect(result.source).toBe('leaf_toll_catalog');
  });

  describe('cotação perto de praça com posição conferida', () => {
    const now = new Date('2026-10-31T12:00:00.000Z');

    test('não cobra a P10 numa rota curta que passa a 1 km da praça (estudo de 2026-10-31)', () => {
      const result = estimateRouteTollsFromPolyline(tollRoutes.pastorinhasToPauDaFome, { now });

      expect(result.tollFee).toBe(0);
      expect(result.tolls).toEqual([]);
    });

    test.each([
      ['sul', tollRoutes.transolimpicaSouthbound, 'p10b_transolimpica'],
      ['norte', tollRoutes.transolimpicaNorthbound, 'p10a_transolimpica'],
    ])('cobra uma vez a rota que cruza a P10 no sentido %s', (_direction, polyline, tollId) => {
      const result = estimateRouteTollsFromPolyline(polyline, { now });

      expect(result.tolls.map((toll) => toll.id)).toEqual([tollId]);
      expect(result.tollFee).toBe(9.95);
    });

    test.each([
      ['oeste', tollRoutes.linhaAmarelaWestbound],
      ['leste', tollRoutes.linhaAmarelaEastbound],
    ])('cobra e confirma a travessia da Linha Amarela no sentido %s', (_direction, polyline) => {
      const result = estimateRouteTollsFromPolyline(polyline, { now });

      expect(result.tolls.map((toll) => toll.id)).toEqual(['p09_linha_amarela']);
      expect(result.tollFee).toBe(4);
      expect(findCrossedTolls(decodePolyline(polyline)).map((toll) => toll.id)).toEqual(['p09_linha_amarela']);
    });

    test('não cobra nem conta travessia da P09 numa rota do Méier fora da Linha Amarela', () => {
      const result = estimateRouteTollsFromPolyline(tollRoutes.meierNearOldP09Point, { now });

      expect(result.tollFee).toBe(0);
      expect(findCrossedTolls(decodePolyline(tollRoutes.meierNearOldP09Point))).toEqual([]);
    });

    test('praça sem posição conferida mantém a tolerância geral de 2 km', () => {
      const plaza = TOLL_PLAZAS.find((toll) => toll.id === 'p17_mage');
      const result = estimateRouteTollsFromCoordinates([
        { latitude: plaza.lat + 0.015, longitude: plaza.lng - 0.01 },
        { latitude: plaza.lat + 0.015, longitude: plaza.lng + 0.01 },
      ], { now });

      expect(result.tolls.map((toll) => toll.id)).toEqual(['p17_mage']);
    });

    test.each([
      ['Bangu', -22.89, -43.5],
      ['Campo Grande', -22.9, -43.6],
      ['Santa Cruz', -22.91, -43.7],
      ['Nova Iguaçu', -22.752, -43.5],
    ])('não cobra as posições antigas sem praça real em %s', (_area, latitude, longitude) => {
      const result = estimateRouteTollsFromCoordinates([
        { latitude: latitude - 0.01, longitude },
        { latitude: latitude + 0.01, longitude },
      ], { now });

      expect(result.tolls).toEqual([]);
      expect(result.tollFee).toBe(0);
    });

    test.each([
      ['sul', tollRoutes.transolimpicaThroughSouthbound, ['p10d_transolimpica', 'p10b_transolimpica']],
      ['norte', tollRoutes.transolimpicaThroughNorthbound, ['p10a_transolimpica', 'p10c_transolimpica']],
    ])('cobra as duas praças da Transolímpica no sentido %s', (_direction, polyline, tollIds) => {
      const result = estimateRouteTollsFromPolyline(polyline, { now });

      expect(result.tolls.map((toll) => toll.id).sort()).toEqual([...tollIds].sort());
      expect(result.tollFee).toBe(19.9);
      expect(findCrossedTolls(decodePolyline(polyline))).toHaveLength(2);
    });

    test('duas praças diferentes contam na mesma janela de passagem', () => {
      const at = 1792481675018;
      const merged = mergeTollCrossings(
        [{ id: 'p10d_transolimpica', amount: 9.95, at }],
        [{ id: 'p10b_transolimpica', amount: 9.95, at: at + 120000 }]
      );

      expect(summarizeTollCrossings({ tollCrossingsTracked: true, tollCrossings: merged }).crossedTollFee).toBe(19.9);
    });

    test('a Ponte cobra só no sentido Região dos Lagos', () => {
      const toNiteroi = estimateRouteTollsFromPolyline(tollRoutes.ponteTowardNiteroi, { now });
      const toRio = estimateRouteTollsFromPolyline(tollRoutes.ponteTowardRio, { now });

      expect(toNiteroi.tolls.map((toll) => toll.id)).toEqual(['p08_ponte_rio_niteroi']);
      expect(toNiteroi.tollFee).toBe(6.6);
      expect(findCrossedTolls(decodePolyline(tollRoutes.ponteTowardNiteroi))).toHaveLength(1);
      expect(toRio.tollFee).toBe(0);
      expect(findCrossedTolls(decodePolyline(tollRoutes.ponteTowardRio))).toEqual([]);
    });

    test('todas as praças dentro da área de destino têm posição conferida', () => {
      const insideDestinationBounds = TOLL_PLAZAS.filter((toll) =>
        toll.lat >= -23.0823 && toll.lat <= -22.7423 && toll.lng >= -43.7958 && toll.lng <= -43.0990
      );

      expect(insideDestinationBounds.length).toBeGreaterThan(0);
      expect(insideDestinationBounds.filter((toll) => !toll.positionVerified)).toEqual([]);
    });

    test('a geometria da rota vale mais que um tollFee antigo guardado na rota', () => {
      const result = resolveTollFeeFromPricingPayload({
        routePolyline: tollRoutes.pastorinhasToPauDaFome,
        routeDetails: { tollFee: 9.95 },
      });

      expect(result.tollFee).toBe(0);
      expect(result.source).toBe('leaf_toll_catalog');
    });

    test('sem geometria, ainda usa o tollFee informado', () => {
      const result = resolveTollFeeFromPricingPayload({ routeDetails: { tollFee: 4 } });

      expect(result.tollFee).toBe(4);
      expect(result.source).toBe('payload_toll_fee_fallback');
    });
  });

  describe('tarifa de moto', () => {
    const now = new Date('2026-10-31T12:00:00.000Z');

    test.each(['leaf_moto', 'Leaf Moto', 'type_moto'])('cota R$ 4,00 na Transolímpica para %s', (carType) => {
      const result = resolveTollFeeFromPricingPayload({
        routePolyline: tollRoutes.transolimpicaSouthbound,
        vehicleTollClass: carType,
      });

      expect(result.tollFee).toBe(4);
    });

    test('moto é isenta na Linha Amarela, sem cair no tollFee guardado na rota', () => {
      const result = resolveTollFeeFromPricingPayload({
        routePolyline: tollRoutes.linhaAmarelaWestbound,
        routeDetails: { tollFee: 4 },
        vehicleTollClass: 'leaf_moto',
      });

      expect(result.tollFee).toBe(0);
      expect(result.tolls.map((toll) => toll.id)).toEqual(['p09_linha_amarela']);
    });

    test('cota R$ 3,30 na Ponte e R$ 8,00 nas duas praças da Transolímpica', () => {
      expect(estimateRouteTollsFromPolyline(tollRoutes.ponteTowardNiteroi, { now, vehicleType: 'leaf_moto' }).tollFee).toBe(3.3);
      expect(estimateRouteTollsFromPolyline(tollRoutes.transolimpicaThroughSouthbound, { now, vehicleType: 'leaf_moto' }).tollFee).toBe(8);
    });

    test('carro segue na tarifa de carro', () => {
      expect(estimateRouteTollsFromPolyline(tollRoutes.transolimpicaSouthbound, {
        now,
        vehicleType: 'leaf_plus',
      }).tollFee).toBe(9.95);
    });
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
      { latitude: -22.7145, longitude: -43.72 },
      { latitude: -22.7151, longitude: -43.7307 },
      { latitude: -22.7157, longitude: -43.74 },
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
