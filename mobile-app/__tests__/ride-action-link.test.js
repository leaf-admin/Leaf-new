import { parseRideActionLink } from '../src/services/rideActionLink';

describe('ride action deep link', () => {
  it('reads the stage action and the booking from the bubble link', () => {
    expect(parseRideActionLink('leafapp://robotaxi/home?rideAction=end_trip&rideBookingId=booking_1')).toEqual({
      action: 'end_trip',
      bookingId: 'booking_1',
    });
    expect(parseRideActionLink('leafapp://robotaxi/home?rideAction=arrived_at_pickup')).toEqual({
      action: 'arrived_at_pickup',
      bookingId: '',
    });
  });

  it('ignores links without a known ride action', () => {
    expect(parseRideActionLink('leafapp://robotaxi/home')).toBeNull();
    expect(parseRideActionLink('leafapp://robotaxi/home?rideAction=cancel_ride')).toBeNull();
    expect(parseRideActionLink('https://leaf.app.br/convite?code=x')).toBeNull();
    expect(parseRideActionLink(null)).toBeNull();
  });
});
