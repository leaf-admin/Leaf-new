import {
  resolveTripGrossAmount,
  resolveTripNetAmount,
  resolveTripNetAmountOrNull,
  resolveTripPassengerPaidAmount,
  resolveTripTollAmount,
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
