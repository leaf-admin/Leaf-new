import {
  AVOIDED_AREA_SIZES,
  buildAvoidedAreaLabel,
  buildAvoidedAreasSummary,
  canAddAvoidedArea,
  cellsForRingSize,
  countAvoidedCells,
  describeAvoidedAreaLimit,
  resolveAvoidedAreaSize,
} from '../src/screens/prototype/driverAvoidedAreas';

describe('driver avoided areas helpers', () => {
  it('counts the cells of a hexagonal disk per size', () => {
    expect(AVOIDED_AREA_SIZES.map((size) => cellsForRingSize(size.ringSize))).toEqual([1, 7, 19]);
    expect(cellsForRingSize(9)).toBe(19);
    expect(cellsForRingSize('x')).toBe(1);
  });

  it('counts distinct server cells and estimates areas not saved yet', () => {
    expect(countAvoidedCells([
      { cells: ['a', 'b'] },
      { cells: ['b', 'c'] },
      { ringSize: 1 },
    ])).toBe(3 + 7);
    expect(countAvoidedCells(null)).toBe(0);
  });

  it('refuses a new area beyond the server limits', () => {
    const limits = { maxCells: 20, maxAreas: 2 };
    expect(canAddAvoidedArea([], 2, limits)).toEqual({ ok: true, reason: '' });
    expect(canAddAvoidedArea([{ ringSize: 2 }], 1, limits)).toEqual({ ok: false, reason: 'MAX_CELLS' });
    expect(canAddAvoidedArea([{ ringSize: 0 }, { ringSize: 0 }], 0, limits)).toEqual({ ok: false, reason: 'MAX_AREAS' });
  });

  it('labels an area with the neighbourhood, falling back to a numbered name', () => {
    expect(buildAvoidedAreaLabel([{ district: ' Copacabana ', city: 'Rio de Janeiro' }], 1)).toBe('Copacabana');
    expect(buildAvoidedAreaLabel([{ street: 'Av. Brasil' }], 1)).toBe('Av. Brasil');
    expect(buildAvoidedAreaLabel([], 3)).toBe('Área 3');
    expect(buildAvoidedAreaLabel([{ district: 'x'.repeat(90) }], 1)).toHaveLength(60);
  });

  it('describes limits and the list in plain words', () => {
    expect(describeAvoidedAreaLimit('MAX_AREAS')).toMatch(/limite de áreas/);
    expect(describeAvoidedAreaLimit('AVOIDED_AREAS_LIMIT_EXCEEDED')).toMatch(/máximo permitido/);
    expect(describeAvoidedAreaLimit('NETWORK_ERROR')).toMatch(/Tente novamente/);
    expect(buildAvoidedAreasSummary([])).toBe('Nenhuma área marcada');
    expect(buildAvoidedAreasSummary([{}])).toBe('1 área marcada');
    expect(buildAvoidedAreasSummary([{}, {}])).toBe('2 áreas marcadas');
    expect(resolveAvoidedAreaSize(7).ringSize).toBe(0);
  });
});
