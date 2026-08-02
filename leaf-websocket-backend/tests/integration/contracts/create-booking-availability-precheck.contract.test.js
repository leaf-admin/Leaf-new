const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '../../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

describe('createBooking availability precheck contract', () => {
  it('blocks paid booking creation before RequestRideCommand in the modular socket handler', () => {
    const handler = read('leaf-websocket-backend/bootstrap/register-socket-create-booking-handler.js');
    const availabilityIndex = handler.indexOf('const createBookingAvailability = await performCreateBookingAvailabilityPrecheck({');
    const commandIndex = handler.indexOf('const command = new RequestRideCommand({');

    expect(availabilityIndex).toBeGreaterThan(-1);
    expect(commandIndex).toBeGreaterThan(-1);
    expect(availabilityIndex).toBeLessThan(commandIndex);
    expect(handler).toContain('checkAvailability: findAvailableDriversForPickup');
    expect(handler).toContain("code: 'NO_DRIVERS_AVAILABLE'");
    expect(handler).toContain('await releaseIdempotencyLock();');
    expect(handler).not.toContain('scheduleCreateBookingAvailabilityPrecheck');
  });

  it('blocks confirmPayment when no eligible driver is available in the modular runtime', () => {
    const handler = read('leaf-websocket-backend/bootstrap/register-socket-confirm-payment-handler.js');

    expect(handler).toContain("boolEnv('CONFIRM_PAYMENT_SKIP_AVAILABILITY_CHECK', false)");
    expect(handler).toContain('const availability = await performCreateBookingAvailabilityPrecheck({');
    expect(handler).toContain("operationLabel: 'confirmPayment'");
    expect(handler).toContain("code: 'NO_DRIVERS_AVAILABLE'");
    expect(handler).toContain("socket.emit('paymentError'");
    expect(handler).toContain('confirmPayment bloqueado por ausência de motorista elegível');
    expect(handler).not.toContain('mantendo corrida em busca');
    expect(handler).not.toContain('pre-check de disponibilidade, seguindo fluxo');
  });
});
