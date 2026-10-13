const { buildFareSignal } = require('../../../../services/pricing/fareSignal');

describe('fare signal', () => {
  it('stays normal below 10% and gives no reasons', () => {
    const signal = buildFareSignal({ dynamicPercent: 6, trafficAdjusted: true, demandPercent: 6 });

    expect(signal).toMatchObject({ percent: 6, level: 'normal', above_normal: false, reasons: [] });
  });

  it('warns from 10% with a level per range', () => {
    expect(buildFareSignal({ dynamicPercent: 10, demandPercent: 10 }).level).toBe('moderate');
    expect(buildFareSignal({ dynamicPercent: 22, demandPercent: 22 }).level).toBe('high');
    expect(buildFareSignal({ dynamicPercent: 35, demandPercent: 35 }).level).toBe('very_high');
  });

  it('adds the night surcharge to the percentage and names every reason', () => {
    const signal = buildFareSignal({
      dynamicPercent: 8,
      nightPercent: 15,
      trafficAdjusted: true,
      demandSupplyRatioNorm: 0.4
    });

    expect(signal).toMatchObject({
      percent: 23,
      level: 'high',
      above_normal: true,
      reasons: ['demand', 'traffic', 'night'],
      reason_labels: ['alta demanda na região', 'trânsito intenso', 'tarifa noturna']
    });
  });

  it('does not blame demand when only the night surcharge applies', () => {
    const signal = buildFareSignal({ nightPercent: 15 });

    expect(signal.reasons).toEqual(['night']);
  });

  it('in active mode demand counts only when the demand model charged something', () => {
    const signal = buildFareSignal({
      dynamicPercent: 12,
      demandPercent: 0,
      demandSupplyRatioNorm: 0.9,
      pricingModelMode: 'active'
    });

    expect(signal.reasons).toEqual([]);
    expect(signal.above_normal).toBe(true);
  });

  it('ignores invalid numbers', () => {
    expect(buildFareSignal({ dynamicPercent: 'x', nightPercent: null })).toMatchObject({ percent: 0, level: 'normal' });
  });
});
