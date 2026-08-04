const fs = require('fs');
const path = require('path');

const backendRoot = path.resolve(__dirname, '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(backendRoot, relativePath), 'utf8');
}

describe('assisted launch admission contract', () => {
  it('keeps the driver cohort guard on every path that can establish online presence', () => {
    const files = [
      'bootstrap/register-socket-driver-control-handlers.js',
      'bootstrap/register-socket-update-location-handler.js',
      'bootstrap/register-socket-driver-heartbeat-handler.js'
    ];

    files.forEach((file) => {
      const source = read(file);
      expect(source).toContain('enforceDriverOnlineCohort');
      expect(source).toContain('buildPublicDriverCohortDenial');
    });
  });

  it('keeps the same cohort enforced by canonical dispatch eligibility', () => {
    const source = read('services/driver-eligibility-service.js');

    expect(source).toContain("role: 'driver'");
    expect(source).toContain("operation: 'driver_dispatch'");
    expect(source).toContain("code: pilotAccess.code || 'PILOT_COHORT_ACCESS_DENIED'");
  });

  it('keeps broad passengers behind authenticated payment, quote lock and driver reservation', () => {
    const source = read('routes/payment.js');

    expect(source).toContain("router.post('/payment/advance', authenticatePaymentActor, requirePassengerScope");
    expect(source).toContain('shouldRequireQuoteLockForPayment()');
    expect(source).toContain('reserveDriver: true');
    expect(source).toContain("code: 'PAYMENT_DRIVER_RESERVATION_FAILED'");
  });

  it('keeps the booking kill switch enforced after payment admission', () => {
    const source = read('bootstrap/register-socket-create-booking-handler.js');

    expect(source).toContain("operation: 'booking'");
    expect(source).toContain("role: 'passenger'");
    expect(source).toContain("recordFailure('active_guard', pilotAccess.code");
  });
});
