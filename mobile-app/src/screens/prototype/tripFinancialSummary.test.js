import {
  resolveTripGrossAmount,
  resolveTripNetAmount,
  resolveTripNetAmountOrNull,
  resolveTripPassengerPaidAmount,
  resolveTripTollAmount,
  resolveTripTollAmountOrNull,
} from "./tripFinancialSummary";

describe("tripFinancialSummary", () => {
  it("mantem total pago separado do liquido do motorista", () => {
    const receipt = {
      totalPaid: 27.5,
      tollFee: 4.9,
      totalFees: 1.49,
      driverNetAmount: 26.01,
    };

    expect(resolveTripPassengerPaidAmount(receipt)).toBe(27.5);
    expect(resolveTripGrossAmount(receipt)).toBe(27.5);
    expect(resolveTripNetAmount(receipt)).toBe(26.01);
    expect(resolveTripTollAmount(receipt)).toBe(4.9);
  });

  it("le pedagio vindo do calculation do backend em centavos", () => {
    expect(
      resolveTripTollAmount({
        fareBreakdown: {
          calculation: {
            tollFee: 490,
          },
        },
      }),
    ).toBe(4.9);
  });

  it("preserva zero explicito sem reaproveitar uma estimativa antiga", () => {
    const receipt = {
      tollFee: 0,
      fareBreakdown: {
        tollFee: 8.95,
      },
    };

    expect(resolveTripTollAmountOrNull(receipt)).toBe(0);
    expect(resolveTripTollAmount(receipt)).toBe(0);
  });

  it("distingue pedagio ausente de pedagio zero", () => {
    expect(resolveTripTollAmountOrNull({})).toBeNull();
    expect(resolveTripTollAmount({})).toBe(0);
  });

  it("nao trata bruto isolado como liquido do motorista", () => {
    const receipt = {
      fare: 27.5,
      grossFare: 27.5,
    };

    expect(resolveTripNetAmountOrNull(receipt)).toBeNull();
    expect(resolveTripNetAmount(receipt)).toBe(0);
    expect(resolveTripGrossAmount(receipt)).toBe(27.5);
  });
});

describe('seguro APP no extrato do motorista', () => {
  const { buildTripFinancialTotals } = require('./tripFinancialSummary');
  const insured = { finalFare: 30.13, totalFees: 1.12, driverNetAmount: 29.01, rideInsuranceFee: 0.13 };

  it('não soma o seguro nas taxas nem no bruto do motorista', () => {
    const totals = buildTripFinancialTotals([insured], { role: 'driver' });
    expect(totals.totalFees).toBe(0.99);
    expect(totals.totalGross).toBe(30);
    expect(totals.totalNet).toBe(29.01);
  });

  it('mostra ao passageiro o total pago com o seguro', () => {
    const totals = buildTripFinancialTotals([insured], { role: 'passenger' });
    expect(totals.totalGross).toBe(30.13);
  });
});
