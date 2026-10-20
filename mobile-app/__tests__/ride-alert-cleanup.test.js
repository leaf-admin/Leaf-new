import { findStaleRideAlertIds } from '../src/services/rideAlertCleanup';

describe('stale ride alerts', () => {
  const presented = (identifier, data, asString = false) => ({
    request: {
      identifier,
      content: asString ? { dataString: JSON.stringify(data) } : { data },
    },
  });

  it('picks only the progress alerts of the ride that ended', () => {
    const ids = findStaleRideAlertIds(
      [
        presented('a', { type: 'trip_in_progress', bookingId: 'b1' }),
        presented('b', { type: 'ride_accepted', bookingId: 'b1' }, true),
        presented('c', { type: 'trip_in_progress', bookingId: 'b2' }),
        presented('d', { type: 'trip_completed', bookingId: 'b1' }),
        presented('e', { type: 'payment_confirmed', bookingId: 'b1' }),
      ],
      'b1',
    );

    expect(ids).toEqual(['a', 'b']);
  });

  it('removes nothing without a ride id', () => {
    expect(findStaleRideAlertIds([presented('a', { type: 'trip_in_progress', bookingId: 'b1' })], '')).toEqual([]);
    expect(findStaleRideAlertIds(null, 'b1')).toEqual([]);
  });
});
