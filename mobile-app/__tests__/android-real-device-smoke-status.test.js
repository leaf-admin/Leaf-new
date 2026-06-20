const {
  resolvePostSandboxPaymentStatus,
} = require('../scripts/qa/real-smoke-payment-status.cjs');

describe('android real-device smoke payment status', () => {
  it.each([
    'passenger_booking_finalizing',
    'passenger_searching_driver',
    'passenger_active_trip',
    'passenger_receipt',
    'passenger_rating',
  ])('recognizes a successful sandbox confirmation followed by %s', screen => {
    expect(
      resolvePostSandboxPaymentStatus({
        confirmationOk: true,
        paymentStatus: 'not_visible',
        screen,
      })
    ).toBe('confirmed');
  });

  it('does not hide a failed confirmation or an unrelated screen', () => {
    expect(
      resolvePostSandboxPaymentStatus({
        confirmationOk: false,
        paymentStatus: 'not_visible',
        screen: 'passenger_home',
      })
    ).toBe('not_visible');
  });
});
