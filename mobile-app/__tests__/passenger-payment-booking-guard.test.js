const fs = require('fs');
const path = require('path');

const passengerUiPath = path.join(
  __dirname,
  '../src/components/map/PassengerUI.js',
);

function extractFunctionBlock(source, marker) {
  const start = source.indexOf(marker);
  if (start < 0) {
    throw new Error(`Marker not found: ${marker}`);
  }

  const nextMarker = source.indexOf('const onPaymentConfirmed', start);
  if (nextMarker < 0) {
    throw new Error('Unable to locate end of createBookingAfterPayment block');
  }

  return source.slice(start, nextMarker);
}

describe('Passenger payment to booking guard', () => {
  const source = fs.readFileSync(passengerUiPath, 'utf8');

  it('does not present driver search before backend bookingCreated confirms a canonical ride', () => {
    const paymentBlock = extractFunctionBlock(source, 'const createBookingAfterPayment');

    expect(paymentBlock).toContain("setTripStatus('finalizing_booking')");
    expect(paymentBlock).not.toContain("setTripStatus('searching')");
  });

  it('keeps a visible non-dismissible finalizing state after Pix confirmation', () => {
    expect(source).toContain("tripStatus === 'finalizing_booking'");
    expect(source).toContain('passenger-booking-finalizing-sheet');
    expect(source).toContain('Pagamento confirmado. Estamos criando sua corrida com segurança.');
  });
});
