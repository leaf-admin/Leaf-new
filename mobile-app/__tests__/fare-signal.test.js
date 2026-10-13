import { resolveFareSignal } from '../src/screens/prototype/fareSignal';

describe('fare signal (mobile)', () => {
  it('says normal below 10%', () => {
    expect(resolveFareSignal({ dynamic_percentage: 6 })).toMatchObject({
      aboveNormal: false,
      label: 'Tarifa normal',
      tone: null,
      reasonText: '',
    });
  });

  it('uses the server signal when present', () => {
    const signal = resolveFareSignal({
      dynamic_percentage: 3,
      fare_signal: { percent: 23, level: 'high', reasons: ['demand', 'traffic', 'night'] },
    });

    expect(signal).toMatchObject({ aboveNormal: true, percent: 23, level: 'high', label: 'Tarifa +23%' });
    expect(signal.reasonText).toBe('alta demanda na região, trânsito intenso e tarifa noturna');
    expect(signal.tone).toBeTruthy();
  });

  it('derives the signal from the older quote fields', () => {
    const signal = resolveFareSignal({
      dynamic_percentage: 12,
      traffic_adjusted: true,
      night_surcharge_applied: true,
      night_surcharge_percentage: 15,
    });

    expect(signal).toMatchObject({ percent: 27, level: 'high' });
    expect(signal.reasonText).toContain('trânsito intenso');
  });

  it('reads an offer signal object directly', () => {
    expect(resolveFareSignal({ percent: 31, reasons: ['demand'] })).toMatchObject({
      level: 'very_high',
      label: 'Tarifa +31%',
      reasonText: 'alta demanda na região',
    });
  });

  it('handles missing data', () => {
    expect(resolveFareSignal(null).aboveNormal).toBe(false);
  });
});
