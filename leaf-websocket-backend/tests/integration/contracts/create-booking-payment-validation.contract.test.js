const fs = require('fs');
const path = require('path');

function read(relativePath) {
  return fs.readFileSync(
    path.resolve(__dirname, '../../../..', relativePath),
    'utf8'
  );
}

describe('createBooking payment validation contract', () => {
  it('keeps server-side payment validation before paid dispatch in modular handler', () => {
    const handler = read('leaf-websocket-backend/bootstrap/register-socket-create-booking-handler.js');

    expect(handler).toContain("code: 'PAYMENT_REQUIRED'");
    expect(handler).toContain("code: 'PAYMENT_REFERENCE_REQUIRED'");
    expect(handler).toContain("code: 'PAYMENT_NOT_CONFIRMED'");
    expect(handler).toContain("code: 'PAYMENT_ALREADY_CONSUMED'");
    expect(handler).toContain('getAdvancePaymentIntent');
    expect(handler).toContain('markAdvancePaymentIntentConsumed');
    expect(handler).toContain('resolveAuthoritativePaymentConfirmation');
    expect(handler).toContain("providerCode: providerConfirmation?.code || 'PAYMENT_NOT_PROVIDER_CONFIRMED'");
    expect(handler).toContain('paymentServerValidated = true');
    expect(handler).toContain('commandPaymentData.serverValidated');
  });

  it('keeps RequestRideCommand blocked without serverValidated payment flag', () => {
    const commandSource = read('leaf-websocket-backend/commands/RequestRideCommand.js');

    expect(commandSource).toContain('paymentServerValidated');
    expect(commandSource).toContain("normalizedPaymentStatus = hasConfirmedPayment");
    expect(commandSource).toContain("'pending_payment'");
  });
});
