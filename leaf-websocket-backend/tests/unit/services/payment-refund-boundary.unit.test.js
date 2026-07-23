const fs = require('fs');
const path = require('path');

describe('payment refund boundary', () => {
  it('keeps VPS ride cancellation on the canonical refund path', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../../../server.vps.js'),
      'utf8'
    );
    const cancelRideStart = source.indexOf("socket.on('cancelRide'");
    const cancelRideEnd = source.indexOf("socket.on('reportIncident'", cancelRideStart);
    const cancelRideSource = source.slice(cancelRideStart, cancelRideEnd);

    expect(cancelRideStart).toBeGreaterThan(-1);
    expect(cancelRideEnd).toBeGreaterThan(cancelRideStart);
    expect(cancelRideSource).toContain('paymentService.processRideRefund({');
    expect(cancelRideSource).not.toContain('paymentService.processRefund(');
  });

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
