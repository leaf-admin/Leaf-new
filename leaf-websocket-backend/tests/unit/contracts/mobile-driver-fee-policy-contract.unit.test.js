const fs = require('fs');
const path = require('path');

const { DEFAULT_POLICY } = require('../../../services/ride-financial-contract');

// O app explica as taxas ao motorista com os valores de
// mobile-app/src/config/driverFeePolicy.js. Quem cobra é este backend: se uma
// taxa mudar aqui e não no app (ou o contrário), o motorista vê um número falso.
const MOBILE_POLICY_PATH = path.resolve(__dirname, '../../../../mobile-app/src/config/driverFeePolicy.js');
const mobileSource = fs.readFileSync(MOBILE_POLICY_PATH, 'utf8');

function numbersAfter(key) {
  const match = mobileSource.match(new RegExp(`${key}:\\s*([0-9.]+)`));
  return match ? Number(match[1]) : null;
}

function bandPairs(listKey, limitKey) {
  const block = mobileSource.match(new RegExp(`${listKey}: Object\\.freeze\\(\\[([\\s\\S]*?)\\]\\)`));
  if (!block) return [];
  return [...block[1].matchAll(new RegExp(`${limitKey}: (null|[0-9]+), feeCents: ([0-9]+)`, 'g'))]
    .map(([, limit, fee]) => [limit === 'null' ? null : Number(limit), Number(fee)]);
}

describe('mobile driver fee policy matches the backend', () => {
  test('service fee bands and payment processing', () => {
    expect(bandPairs('serviceFeeBands', 'upToCents')).toEqual([
      [DEFAULT_POLICY.threshold10Cents, DEFAULT_POLICY.operationalFeeUpTo10Cents],
      [DEFAULT_POLICY.threshold25Cents, DEFAULT_POLICY.operationalFee10To25Cents],
      [DEFAULT_POLICY.threshold50Cents, DEFAULT_POLICY.operationalFee25To50Cents]
    ]);
    expect(numbersAfter('serviceFeeAbovePercentage')).toBe(DEFAULT_POLICY.operationalFeeAbove50Percentage);
    expect(numbersAfter('paymentProcessingPercentage')).toBe(DEFAULT_POLICY.paymentIntermediationPercentage);
    expect(numbersAfter('paymentProcessingMinimumCents')).toBe(DEFAULT_POLICY.paymentIntermediationMinimumCents);
  });

  test('withdrawal fee', () => {
    jest.isolateModules(() => {
      const PaymentService = require('../../../services/payment-service');
      expect(numbersAfter('withdrawalFeeCents')).toBe(new PaymentService().WITHDRAW_FEE_FLAT_CENTS);
    });
  });

  test('daily subscription tiers and conditions', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../services/daily-subscription-service.js'), 'utf8');
    const backendTiers = [...source.matchAll(/maxGrossCents: (null|[0-9]+), dailyFeeCents: ([0-9]+)/g)]
      .map(([, limit, fee]) => [limit === 'null' ? null : Number(limit), Number(fee)]);
    expect(bandPairs('dailySubscriptionTiers', 'upToGrossCents')).toEqual(backendTiers);
    expect(numbersAfter('dailySubscriptionMinAccountAgeDays')).toBe(60);
    expect(numbersAfter('dailySubscriptionNoticeDays')).toBe(60);
    expect(source).toMatch(/SUBSCRIPTION_DAILY_MIN_ACCOUNT_AGE_DAYS, 60\)/);
    expect(source).toMatch(/SUBSCRIPTION_DAILY_NOTICE_DAYS, 60\)/);
  });

  test('passenger no-show grace period', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../commands/CancelRideCommand.js'), 'utf8');
    expect(source).toMatch(new RegExp(`elapsedMinutes >= ${numbersAfter('passengerNoShowGraceMinutes')}\\b`));
  });
});
