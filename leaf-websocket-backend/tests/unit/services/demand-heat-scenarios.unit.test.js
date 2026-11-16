const { runScenario, SCENARIOS } = require('../../../services/demand-heat-scenarios');

function places(result) {
  return result.heat.cells.map((cell) => cell.place);
}

function levelOf(result, place) {
  return result.heat.cells.find((cell) => cell.place === place)?.level || null;
}

describe('demand heat simulated scenarios (Zona Sul)', () => {
  it('weekday 8h: residential Zona Sul lights up, strongest where demand is steady', async () => {
    const result = await runScenario('manha_dia_util');
    expect(places(result)[0]).toBe('copacabanaPostoCinco');
    expect(levelOf(result, 'botafogoPraia')).toBe('high');
    expect(levelOf(result, 'leblonBaixo')).toBe('medium');
  });

  it('saturday 23h shows the bar areas', async () => {
    const result = await runScenario('sabado_noite');
    expect(places(result)).toEqual(expect.arrayContaining(['baixoGavea', 'lapaArcos', 'humaitaCobal']));
    expect(levelOf(result, 'baixoGavea')).toBe('high');
  });

  it('saturday night demand does not leak into a tuesday night', async () => {
    const result = await runScenario('terca_noite');
    expect(places(result)).not.toContain('baixoGavea');
  });

  it('a sudden spike in the last hours shows up without any history', async () => {
    const result = await runScenario('chuva_repentina');
    expect(places(result)[0]).toBe('leblonBaixo');
    expect(places(result)).toContain('ipanemaPraca');
  });

  it('never shows a cell with fewer than the minimum requests (privacy)', async () => {
    const result = await runScenario('pedido_isolado');
    expect(result.heat.cells).toEqual([]);
  });

  it('returns an empty map, not an error, when there is no data', async () => {
    const result = await runScenario('sem_dados');
    expect(result.heat.cells).toEqual([]);
    expect(result.heat.generatedAt).toBe(SCENARIOS.sem_dados.now);
  });

  it('a dominant airport does not erase the neighbourhoods', async () => {
    const result = await runScenario('ponto_dominante');
    expect(places(result)[0]).toBe('santosDumont');
    expect(levelOf(result, 'flamengo')).not.toBeNull();
    expect(levelOf(result, 'botafogoPraia')).not.toBeNull();
  });

  it('every cell carries a polygon the app can draw', async () => {
    const result = await runScenario('manha_dia_util');
    for (const cell of result.heat.cells) {
      expect(cell.boundary.length).toBeGreaterThanOrEqual(6);
      expect(cell.intensity).toBeGreaterThan(0);
      expect(cell.intensity).toBeLessThanOrEqual(1);
    }
  });
});

describe('demand heat QA preview', () => {
  const demandHistoryService = require('../../../services/demand-history-service');

  it('only listed QA accounts get the preview', () => {
    const env = { DEMAND_HEAT_PREVIEW_UIDS: 'qa-driver-1, qa-driver-2' };
    expect(demandHistoryService.isPreviewUid('qa-driver-2', env)).toBe(true);
    expect(demandHistoryService.isPreviewUid('real-driver', env)).toBe(false);
    expect(demandHistoryService.isPreviewUid('qa-driver-1', {})).toBe(false);
    expect(demandHistoryService.isPreviewUid('', env)).toBe(false);
  });

  it('reads the preview from its own key, never the real heat key', async () => {
    const redis = { get: jest.fn().mockResolvedValue(JSON.stringify({ scenario: 'sabado_noite', cells: [] })) };
    await expect(demandHistoryService.getPreviewHeat(redis)).resolves.toEqual({ scenario: 'sabado_noite', cells: [] });
    expect(redis.get).toHaveBeenCalledWith('leaf:h3:demand-heat:preview');
    expect(demandHistoryService.helpers.PREVIEW_HEAT_KEY).not.toBe(demandHistoryService.helpers.HEAT_KEY);
  });
});
