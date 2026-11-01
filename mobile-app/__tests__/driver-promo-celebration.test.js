const fs = require('fs');
const path = require('path');
const React = require('react');
const { act, fireEvent, render } = require('@testing-library/react-native');
const DriverPromoCelebrationCard = require('../src/screens/prototype/home/DriverPromoCelebrationCard').default;
const {
  buildDriverPromoTimeline,
  buildOdometerColumns,
  resolveDriverPromoCelebration,
} = require('../src/screens/prototype/home/driverPromoCelebration');

const promoSnapshot = (overrides = {}) => ({
  version: 'ride_financial_snapshot_v1',
  driverIntroFee: { eligible: true, qualifiedCompletedRides: 11 },
  authoritativeSnapshot: true,
  financialSnapshotSource: 'backend_final',
  passengerPaidCents: 2497,
  grossFareCents: 2497,
  tollFeeCents: 0,
  operationalFeeCents: 49,
  paymentIntermediationFeeCents: 50,
  subscriptionRetainedFeeCents: 0,
  driverNetAmountCents: 2398,
  balanced: true,
  ...overrides,
});

describe('resolveDriverPromoCelebration', () => {
  it('reads the settled values of the ride validated on 2026-10-31', () => {
    expect(
      resolveDriverPromoCelebration({
        bookingId: 'booking_1',
        fareBreakdown: { financialSnapshot: promoSnapshot() },
      }),
    ).toEqual({ bookingId: 'booking_1', paidCents: 2497, tollCents: 0, feeCents: 99, netCents: 2398 });
  });

  it('keeps the toll inside what the driver received', () => {
    const celebration = resolveDriverPromoCelebration({
      financialSnapshot: promoSnapshot({
        passengerPaidCents: 3392,
        grossFareCents: 2497,
        tollFeeCents: 895,
        driverNetAmountCents: 3293,
      }),
    });
    expect(celebration).toMatchObject({ paidCents: 3392, tollCents: 895, feeCents: 99, netCents: 3293 });
  });

  it.each([
    ['a ride outside the promotion', { financialSnapshot: promoSnapshot({ driverIntroFee: { eligible: false } }) }],
    ['a ride without intro context', { financialSnapshot: promoSnapshot({ driverIntroFee: undefined }) }],
    ['a snapshot that is not final', { financialSnapshot: promoSnapshot({ financialSnapshotSource: 'locked_offer_snapshot' }) }],
    ['a snapshot that is not authoritative', { financialSnapshot: promoSnapshot({ authoritativeSnapshot: false }) }],
    ['an unbalanced snapshot', { financialSnapshot: promoSnapshot({ balanced: false }) }],
    ['a subscription discount', { financialSnapshot: promoSnapshot({ subscriptionRetainedFeeCents: 100, driverNetAmountCents: 2298 }) }],
    ['a ride ended early', { completionType: 'DRIVER_EARLY_END', financialSnapshot: promoSnapshot() }],
    ['a ride under settlement review', { settlementReviewRequired: true, financialSnapshot: promoSnapshot() }],
    ['a local fallback', { localFallback: true, financialSnapshot: promoSnapshot() }],
    ['a missing amount', { financialSnapshot: promoSnapshot({ driverNetAmountCents: undefined }) }],
    ['no result', null],
  ])('goes straight to the receipt for %s', (_label, result) => {
    expect(resolveDriverPromoCelebration(result)).toBeNull();
  });
});

describe('buildDriverPromoTimeline', () => {
  const withoutToll = { paidCents: 2497, tollCents: 0, feeCents: 99, netCents: 2398 };
  const withToll = { paidCents: 3392, tollCents: 895, feeCents: 99, netCents: 3293 };

  it('goes from paid to received without a toll', () => {
    const timeline = buildDriverPromoTimeline(withoutToll);
    expect(timeline.labels).toEqual(['O passageiro pagou', 'Você recebeu']);
    expect(timeline.steps.filter((step) => step.valueCents !== undefined).map((step) => step.valueCents)).toEqual([2497, 2398]);
  });

  it('adds the toll before taking the fee', () => {
    const timeline = buildDriverPromoTimeline(withToll);
    expect(timeline.labels).toEqual(['Valor da corrida', 'O passageiro pagou', 'Você recebeu']);
    expect(timeline.steps.filter((step) => step.valueCents !== undefined).map((step) => step.valueCents)).toEqual([2497, 3392, 3293]);
  });

  it.each([[withoutToll], [withToll]])('ends turned on the received amount with the button after it', (celebration) => {
    const timeline = buildDriverPromoTimeline(celebration);
    const last = timeline.steps[timeline.steps.length - 1];
    expect(last).toMatchObject({ valueCents: celebration.netCents, turned: true });
    expect(timeline.buttonAtMs).toBeGreaterThan(last.atMs);
    expect(timeline.finishAtMs).toBeGreaterThan(timeline.buttonAtMs);
  });
});

describe('buildOdometerColumns', () => {
  const read = (columns) =>
    columns.map((column) => (column.hidden ? ' ' : column.isComma ? ',' : column.digit)).join('');

  it('splits the amount in digits and comma', () => {
    expect(read(buildOdometerColumns(2398, 2497))).toBe('23,98');
  });

  it('hides the leading column when the value gets shorter', () => {
    expect(read(buildOdometerColumns(901, 1000))).toBe(' 9,01');
  });

  it('keeps stable keys per column between values', () => {
    expect(buildOdometerColumns(0, 2497).map((column) => column.key)).toEqual(
      buildOdometerColumns(2497, 2497).map((column) => column.key),
    );
  });
});

describe('driver promo celebration contract', () => {
  const source = (relative) => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
  const home = source('src/screens/prototype/RobotaxiHomeScreen.js');
  const card = source('src/screens/prototype/home/DriverPromoCelebrationCard.js');

  it('builds the receipt params at completion, before the ride state clears', () => {
    expect(home).toContain('const openDriverReceiptAfterCompletion = useCallback((result) => {');
    expect(home).toContain('const receiptParams = buildHomeReceiptParams({');
    expect(home).toContain('resolveDriverPromoCelebration(result)');
  });

  it('never delays the receipt once a new offer arrives', () => {
    expect(home).toContain('driverOffers?.length > 0');
    expect(home).toContain('finishDriverPromoCelebration();');
  });

  it('skips the motion for reduced motion users', () => {
    expect(card).toContain('useReducedMotion');
    expect(card).toContain('reduceMotion ? timeline.steps.length - 1 : -1');
  });

  it('uses the milestone haptic once the card turns', () => {
    expect(card).toContain('Haptics.NotificationFeedbackType.Success');
  });
});

describe('DriverPromoCelebrationCard', () => {
  const withoutToll = { paidCents: 2497, tollCents: 0, feeCents: 99, netCents: 2398 };
  const withToll = { paidCents: 3392, tollCents: 895, feeCents: 99, netCents: 3293 };

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const advance = (ms) => act(() => {
    jest.advanceTimersByTime(ms);
  });

  it('shows the fee and opens the receipt on its own without a toll', () => {
    const onFinish = jest.fn();
    const screen = render(<DriverPromoCelebrationCard celebration={withoutToll} onFinish={onFinish} />);
    expect(screen.queryByText('A taxa foi apenas R$ 0,99')).toBeNull();
    advance(2000);
    expect(screen.getByText('A taxa foi apenas R$ 0,99')).toBeTruthy();
    expect(screen.queryByText(/pedágio/)).toBeNull();
    advance(4400);
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it('adds the toll before the fee and reads the amount each step', () => {
    const screen = render(<DriverPromoCelebrationCard celebration={withToll} onFinish={jest.fn()} />);
    advance(1000);
    expect(screen.getByLabelText('Valor da corrida: R$ 24,97')).toBeTruthy();
    advance(1200);
    expect(screen.getByText('+ R$ 8,95 de pedágio')).toBeTruthy();
    expect(screen.getByLabelText('O passageiro pagou: R$ 33,92')).toBeTruthy();
    advance(1600);
    expect(screen.getByLabelText('Você recebeu: R$ 32,93')).toBeTruthy();
    expect(screen.getByText('A taxa foi apenas R$ 0,99')).toBeTruthy();
  });

  it('opens the receipt only once when the driver taps the button', () => {
    const onFinish = jest.fn();
    const screen = render(<DriverPromoCelebrationCard celebration={withoutToll} onFinish={onFinish} />);
    advance(4000);
    fireEvent.press(screen.getByTestId('driver-promo-celebration-receipt'));
    advance(5000);
    expect(onFinish).toHaveBeenCalledTimes(1);
  });
});
