const fs = require('fs');
const path = require('path');

describe('payment refund boundary', () => {
  it('keeps the modular socket handler read-only for fee and refund decisions', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../../../bootstrap/register-socket-cancel-ride-handler.js'),
      'utf8'
    );

    expect(source).toContain('const canonicalCancellationFeeInCents = Math.max(');
    expect(source).not.toContain('const { bookingId, reason, cancellationFee } = data');
    expect(source).not.toContain('paymentService.processRideRefund({');
    expect(source).not.toContain('paymentService.markPaymentRefunded(');
  });
});
