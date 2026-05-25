const {
  normalizeOperationalCarType,
  resolveOperationalCarTypeLabel
} = require('../../../utils/operational-car-type');

describe('operational-car-type', () => {
  it('maps prototype vehicle labels to operational categories', () => {
    expect(normalizeOperationalCarType('Model 3')).toBe('leaf_plus');
    expect(normalizeOperationalCarType('Model Y')).toBe('leaf_plus');
    expect(normalizeOperationalCarType('Model S')).toBe('leaf_elite');
  });

  it('preserves canonical operational labels', () => {
    expect(normalizeOperationalCarType('Leaf Plus')).toBe('leaf_plus');
    expect(normalizeOperationalCarType('Leaf Elite')).toBe('leaf_elite');
    expect(normalizeOperationalCarType('Leaf Moto')).toBe('leaf_moto');
  });

  it('returns presentation labels for normalized operational categories', () => {
    expect(resolveOperationalCarTypeLabel('plus')).toBe('Leaf Plus');
    expect(resolveOperationalCarTypeLabel('leaf_plus')).toBe('Leaf Plus');
    expect(resolveOperationalCarTypeLabel('model y')).toBe('Leaf Plus');
    expect(resolveOperationalCarTypeLabel('model s')).toBe('Leaf Elite');
  });
});
