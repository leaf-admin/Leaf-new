const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '../../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

describe('createBooking availability precheck contract', () => {
  it('uses the shared non-blocking precheck in the canonical VPS runtime', () => {
    const runtime = read('leaf-websocket-backend/server.vps.js');

    expect(runtime).toContain("performCreateBookingAvailabilityPrecheck({");
    expect(runtime).toContain('checkAvailability: hasEligibleDriversForPickupFast');
    expect(runtime).not.toContain('No driver found before booking creation');
    expect(runtime).not.toContain('createBooking_no_driver');
  });

  it('uses the shared non-blocking precheck in the modular socket handler', () => {
    const handler = read('leaf-websocket-backend/bootstrap/register-socket-create-booking-handler.js');

    expect(handler).toContain("scheduleCreateBookingAvailabilityPrecheck({");
  });
});
