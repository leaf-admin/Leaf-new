const {
  clamp,
  linearInterpolation,
  normalizeRange,
  safeDivide,
  roundCurrency
} = require('../../../../services/pricing/utils');

describe('pricing/utils', () => {
  test('clamp deve respeitar limites e fallback numérico', () => {
    expect(clamp(1.2)).toBe(1);
    expect(clamp(-0.5)).toBe(0);
    expect(clamp('0.42')).toBe(0.42);
    expect(clamp('foo', 0, 10)).toBe(0);
  });

  test('linearInterpolation e normalizeRange devem interpolar sem degraus bruscos', () => {
    expect(linearInterpolation(1, 0.2, 2, 0.8, 1.5)).toBeCloseTo(0.5, 6);
    expect(
      normalizeRange(1.5, [
        { x: 1, y: 0.2 },
        { x: 2, y: 0.8 }
      ])
    ).toBeCloseTo(0.5, 6);
  });

  test('safeDivide e roundCurrency devem lidar com bordas com segurança', () => {
    expect(safeDivide(10, 2)).toBe(5);
    expect(safeDivide(10, 0, 7)).toBe(7);
    expect(roundCurrency(12.345)).toBe(12.35);
    expect(roundCurrency(-1)).toBe(-1);
  });
});
