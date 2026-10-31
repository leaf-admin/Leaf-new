import {
  DRIVER_FEE_POLICY,
  buildDriverFeeRows,
  formatCents,
  resolveDriverNetExample,
  resolvePaymentProcessingCents,
  resolveServiceFeeCents,
} from '../src/config/driverFeePolicy';

describe('driver fee policy shown in onboarding', () => {
  it('applies the same service fee bands as the backend (inclusive upper limits)', () => {
    expect(resolveServiceFeeCents(1000)).toBe(79);
    expect(resolveServiceFeeCents(1001)).toBe(99);
    expect(resolveServiceFeeCents(2500)).toBe(99);
    expect(resolveServiceFeeCents(2501)).toBe(149);
    expect(resolveServiceFeeCents(5000)).toBe(149);
    expect(resolveServiceFeeCents(6000)).toBe(180);
  });

  it('charges payment processing at 0.8% with a R$ 0,50 minimum', () => {
    expect(resolvePaymentProcessingCents(3000)).toBe(50);
    expect(resolvePaymentProcessingCents(10000)).toBe(80);
  });

  it('computes the R$ 30,00 example the screen shows', () => {
    expect(resolveDriverNetExample(3000)).toEqual({
      fareCents: 3000,
      serviceFeeCents: 149,
      processingCents: 50,
      netCents: 2801,
      netPercent: 93.4,
      promoNetCents: 2901,
    });
    expect(formatCents(2801)).toBe('R$ 28,01');
  });

  it('lists every fee without provider names', () => {
    const rows = buildDriverFeeRows();
    expect(rows.map((row) => row.key)).toEqual(['promo', 'service', 'processing', 'toll', 'withdrawal', 'subscription', 'cancel']);
    const text = JSON.stringify(rows).toLowerCase();
    expect(text).not.toMatch(/woovi|openpix|stripe|mercado ?pago/);
    expect(text).toContain('r$ 1,00');
    expect(text).toContain('pix incluso');
    expect(text).toContain('condição promocional');
    expect(text).toContain('grátis até r$ 100,00, r$ 4,90 até r$ 200,00, r$ 7,90 até r$ 300,00, r$ 12,90 até r$ 500,00, r$ 14,90 acima de r$ 500,00');
    expect(DRIVER_FEE_POLICY.withdrawalFeeCents).toBe(100);
  });
});
